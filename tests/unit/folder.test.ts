import { describe, expect, it } from 'vitest';
import { emptyPack } from '../../web/src/lib/pack';
import {
  readDirectoryPack,
  readDirectoryFiles,
  saveDirectoryPack,
  ensureDirectoryWritePermission,
} from '../../web/src/lib/folder';

const recipe = (name = 'wave', url = 'https://example.com/wave.png') =>
  JSON.stringify({
    type: 'emojiful:emoji_recipe',
    name,
    url,
    category: 'Reactions',
    conditions: [{ type: 'example:condition' }],
  });
const metadata = JSON.stringify({
  pack: {
    pack_format: 15,
    description: 'Original',
    supported_formats: [15, 18],
  },
  extra: { keep: true },
});
const packData = () => ({
  ...emptyPack(),
  id: 'sample',
  name: 'Sample',
  description: 'Original',
  emojis: [
    { name: 'wave', url: 'https://example.com/old.png', category: 'Old' },
  ],
});

class MemoryDirectory {
  readonly kind = 'directory' as const;
  readonly name: string;
  readonly files: Map<string, string>;
  readonly directories: Set<string>;
  failOnce = new Set<string>();
  beforeClose?: (path: string, text: string) => void;
  permission: PermissionState = 'granted';
  requests = 0;
  private readonly root: MemoryDirectory;
  constructor(
    files: Record<string, string> = {},
    private prefix = '',
    root?: MemoryDirectory,
  ) {
    this.root = root ?? this;
    this.files = root?.files ?? new Map(Object.entries(files));
    this.directories = root?.directories ?? new Set();
    this.name = prefix.split('/').filter(Boolean).at(-1) ?? 'Sample Folder';
  }
  private path(name: string) {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name))
      throw new DOMException('Bad path', 'TypeMismatchError');
    return this.prefix + name;
  }
  async *values(): AsyncGenerator<
    MemoryDirectory | ReturnType<MemoryDirectory['file']>
  > {
    const children = new Map<string, boolean>();
    for (const path of [...this.files.keys(), ...this.directories]) {
      if (!path.startsWith(this.prefix)) continue;
      const relative = path.slice(this.prefix.length);
      if (!relative) continue;
      children.set(relative.split('/')[0], relative.includes('/'));
    }
    for (const [name, directory] of children)
      yield directory
        ? new MemoryDirectory({}, this.prefix + name + '/', this.root)
        : this.file(name);
  }
  private file(name: string) {
    const path = this.path(name);
    return {
      kind: 'file' as const,
      name,
      getFile: async () => {
        if (!this.files.has(path))
          throw new DOMException('Missing', 'NotFoundError');
        return new File([this.files.get(path)!], name);
      },
      createWritable: async () => {
        let pending = '';
        return {
          write: async (data: string) => {
            pending = data;
          },
          close: async () => {
            this.root.beforeClose?.(path, pending);
            if (this.root.failOnce.delete(path))
              throw new DOMException('Disk failure', 'UnknownError');
            this.files.set(path, pending);
          },
          abort: async () => {},
        };
      },
    };
  }
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const path = this.path(name);
    if (!this.files.has(path)) {
      if (!options.create) throw new DOMException('Missing', 'NotFoundError');
      this.files.set(path, '');
    }
    return this.file(name);
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const path = this.path(name) + '/';
    if (
      ![...this.files.keys(), ...this.directories].some((item) =>
        item.startsWith(path),
      )
    ) {
      if (!options.create) throw new DOMException('Missing', 'NotFoundError');
      this.directories.add(path);
    }
    return new MemoryDirectory({}, path, this.root);
  }
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (options?.recursive) throw new Error('Recursive deletion is forbidden');
    if (!this.files.delete(this.path(name)))
      throw new DOMException('Missing', 'NotFoundError');
  }
  async queryPermission() {
    return this.root.permission;
  }
  async requestPermission() {
    this.root.requests++;
    return this.root.permission;
  }
}

const folder = () =>
  new MemoryDirectory({
    'pack.mcmeta': metadata,
    'emojiful-web-gui.json': JSON.stringify(packData()),
    'data/sample/recipes/nested/original.json': recipe(),
    'data/sample/recipes/crafting.json': JSON.stringify({
      type: 'minecraft:crafting_shapeless',
      keep: true,
    }),
    'assets/texture.png': 'untouched image',
    'notes.txt': 'untouched notes',
  });

describe('folder pack editing', () => {
  it('reads physical recipes rather than stale editor metadata and retains original recipe paths', async () => {
    const directory = folder();
    const result = await readDirectoryPack(directory);
    expect(result.pack.name).toBe('Sample');
    expect(result.pack.emojis).toEqual([
      {
        name: 'wave',
        url: 'https://example.com/wave.png',
        category: 'Reactions',
      },
    ]);
    expect(result.source.recipePaths.wave).toBe(
      'data/sample/recipes/nested/original.json',
    );
    expect(result.source.files).not.toHaveProperty('notes.txt');
  });

  it('opens a normal datapack without editor metadata', async () => {
    const result = await readDirectoryPack(
      new MemoryDirectory({
        'pack.mcmeta': metadata,
        'data/my.namespace/recipes/nested/wave.json': recipe(),
      }),
    );
    expect(result.pack.id).toBe('my_namespace');
    expect(result.pack.description).toBe('Original');
    expect(result.pack.emojis[0].name).toBe('wave');
  });

  it('reads UTF-8 BOM files while retaining their exact original contents for conflict checks', async () => {
    const directory = new MemoryDirectory({
      'pack.mcmeta': '\uFEFF' + metadata,
      'data/sample/recipes/wave.json': '\uFEFF' + recipe(),
    });
    const { pack, source } = await readDirectoryPack(directory);
    expect(pack.emojis[0].name).toBe('wave');
    expect(source.files['pack.mcmeta']).toBe('\uFEFF' + metadata);
    await expect(saveDirectoryPack(source, pack)).resolves.toBeDefined();
  });

  it('reads a folder file list with the selected root stripped', async () => {
    const files = [
      ['Sample/pack.mcmeta', metadata],
      ['Sample/data/sample/recipes/wave.json', recipe()],
    ].map(([path, text]) =>
      Object.defineProperty(
        new File([text], path.split('/').at(-1)!),
        'webkitRelativePath',
        { value: path },
      ),
    );
    expect((await readDirectoryFiles(files)).emojis[0].name).toBe('wave');
  });

  it('rejects a non-pack folder and unsafe fallback paths', async () => {
    await expect(
      readDirectoryPack(new MemoryDirectory({ 'notes.txt': 'hello' })),
    ).rejects.toMatchObject({ key: 'folder.invalid' });
    const unsafe = Object.defineProperty(
      new File([recipe()], 'wave.json'),
      'webkitRelativePath',
      { value: 'Sample/../data/sample/recipes/wave.json' },
    );
    await expect(readDirectoryFiles([unsafe])).rejects.toThrow();
  });

  it('ignores binary icons and large unrelated assets in fallback folder imports', async () => {
    const selected = [
      ['Sample/pack.mcmeta', metadata],
      ['Sample/data/sample/recipes/wave.json', recipe()],
      ['Sample/pack.png', new Uint8Array([137, 80, 78, 71, 255])],
      ['Sample/assets/large.bin', new Uint8Array(9 * 1024 * 1024)],
    ].map(([path, contents]) =>
      Object.defineProperty(
        new File([contents as BlobPart], String(path).split('/').at(-1)!),
        'webkitRelativePath',
        { value: path },
      ),
    );
    expect((await readDirectoryFiles(selected)).emojis[0].name).toBe('wave');
  });

  it('supports valid emoji names that overlap Object prototype properties across multiple saves', async () => {
    const directory = new MemoryDirectory({
      'pack.mcmeta': metadata,
      'data/sample/recipes/constructor.json': recipe('constructor'),
      'data/sample/recipes/__proto__.json': recipe('__proto__'),
    });
    const { pack, source } = await readDirectoryPack(directory);
    expect(pack.emojis.map((emoji) => emoji.name).sort()).toEqual([
      '__proto__',
      'constructor',
    ]);
    const saved = await saveDirectoryPack(source, pack);
    await expect(saveDirectoryPack(saved, pack)).resolves.toBeDefined();
    const regular = await readDirectoryPack(folder());
    regular.pack.emojis.push({
      name: '__proto__',
      url: 'https://example.com/proto.png',
      category: 'Reactions',
    });
    const newSource = await saveDirectoryPack(regular.source, regular.pack);
    await expect(
      saveDirectoryPack(newSource, regular.pack),
    ).resolves.toBeDefined();
  });

  it('updates the original nested recipe and keeps unrelated files and metadata properties', async () => {
    const directory = folder();
    const before = new Map(directory.files);
    const { pack, source } = await readDirectoryPack(directory);
    pack.description = 'Updated';
    pack.emojis[0].url = 'https://example.com/new.png';
    const saved = await saveDirectoryPack(source, pack);
    expect(
      JSON.parse(
        directory.files.get('data/sample/recipes/nested/original.json')!,
      ),
    ).toMatchObject({
      url: 'https://example.com/new.png',
      conditions: [{ type: 'example:condition' }],
    });
    expect(JSON.parse(directory.files.get('pack.mcmeta')!)).toEqual({
      pack: {
        pack_format: 15,
        description: 'Updated',
        supported_formats: [15, 18],
      },
      extra: { keep: true },
    });
    for (const path of [
      'notes.txt',
      'assets/texture.png',
      'data/sample/recipes/crafting.json',
    ])
      expect(directory.files.get(path)).toBe(before.get(path));
    await expect(saveDirectoryPack(saved, pack)).resolves.toBeDefined();
  });

  it('adds recipes and removes only previously loaded emoji recipes, including the last emoji', async () => {
    const directory = folder();
    const { pack, source } = await readDirectoryPack(directory);
    pack.emojis = [
      { name: 'cat', url: 'https://example.com/cat.png', category: 'Animals' },
    ];
    const saved = await saveDirectoryPack(source, pack);
    expect(
      directory.files.has('data/sample/recipes/nested/original.json'),
    ).toBe(false);
    expect(
      JSON.parse(directory.files.get('data/sample/recipes/cat.json')!).name,
    ).toBe('cat');
    await saveDirectoryPack(saved, { ...pack, emojis: [] });
    expect(directory.files.has('data/sample/recipes/cat.json')).toBe(false);
    expect(directory.files.has('data/sample/recipes/crafting.json')).toBe(true);
    expect((await readDirectoryPack(directory)).pack.emojis).toEqual([]);
  });

  it('moves only managed recipes when the pack ID changes', async () => {
    const directory = folder();
    const { pack, source } = await readDirectoryPack(directory);
    await saveDirectoryPack(source, { ...pack, id: 'renamed' });
    expect(directory.files.has('data/renamed/recipes/wave.json')).toBe(true);
    expect(
      directory.files.has('data/sample/recipes/nested/original.json'),
    ).toBe(false);
    expect(directory.files.has('data/sample/recipes/crafting.json')).toBe(true);
  });

  it('renames an emoji into its old filename without deleting the new output', async () => {
    const directory = new MemoryDirectory({
      'pack.mcmeta': metadata,
      'data/sample/recipes/cat.json': recipe('wave'),
    });
    const { pack, source } = await readDirectoryPack(directory);
    pack.emojis[0].name = 'cat';
    const saved = await saveDirectoryPack(source, pack);
    expect(
      JSON.parse(directory.files.get('data/sample/recipes/cat.json')!).name,
    ).toBe('cat');
    await expect(saveDirectoryPack(saved, pack)).resolves.toBeDefined();
  });

  it('preserves rich pack descriptions when only an emoji is edited', async () => {
    const rich = {
      text: 'Special title',
      color: 'gold',
      extra: [{ text: ' ✨' }],
    };
    const directory = new MemoryDirectory({
      'pack.mcmeta': JSON.stringify({
        pack: { pack_format: 15, description: rich },
      }),
      'data/sample/recipes/wave.json': recipe(),
    });
    const { pack, source } = await readDirectoryPack(directory);
    pack.emojis[0].url = 'https://example.com/updated.png';
    const saved = await saveDirectoryPack(source, pack);
    expect(
      JSON.parse(directory.files.get('pack.mcmeta')!).pack.description,
    ).toEqual(rich);
    await saveDirectoryPack(saved, {
      ...pack,
      description: 'Explicit description change',
    });
    expect(
      JSON.parse(directory.files.get('pack.mcmeta')!).pack.description,
    ).toBe('Explicit description change');
  });

  it.each(['modified', 'removed', 'added'])(
    'refuses writes after a recipe was externally %s',
    async (change) => {
      const directory = folder();
      const { pack, source } = await readDirectoryPack(directory);
      if (change === 'modified')
        directory.files.set(
          'data/sample/recipes/nested/original.json',
          recipe('wave', 'https://example.com/external.png'),
        );
      if (change === 'removed')
        directory.files.delete('data/sample/recipes/nested/original.json');
      if (change === 'added')
        directory.files.set('data/sample/recipes/extra.json', recipe('extra'));
      const before = new Map(directory.files);
      await expect(saveDirectoryPack(source, pack)).rejects.toMatchObject({
        key: 'folder.conflict',
      });
      expect(directory.files).toEqual(before);
    },
  );

  it('refuses to overwrite an unrelated recipe at a new destination', async () => {
    const directory = folder();
    const { pack, source } = await readDirectoryPack(directory);
    directory.files.set(
      'data/sample/recipes/cat.json',
      JSON.stringify({ type: 'minecraft:crafting_shaped' }),
    );
    const before = new Map(directory.files);
    pack.emojis.push({
      name: 'cat',
      url: 'https://example.com/cat.png',
      category: 'Animals',
    });
    await expect(saveDirectoryPack(source, pack)).rejects.toMatchObject({
      key: 'folder.conflict',
    });
    expect(directory.files).toEqual(before);
  });

  it('checks write permission before touching files', async () => {
    const directory = folder();
    const { pack, source } = await readDirectoryPack(directory);
    directory.permission = 'denied';
    const before = new Map(directory.files);
    await expect(
      ensureDirectoryWritePermission(directory),
    ).rejects.toMatchObject({ key: 'folder.permission' });
    await expect(saveDirectoryPack(source, pack)).rejects.toMatchObject({
      key: 'folder.permission',
    });
    expect(directory.files).toEqual(before);
  });

  it('restores original file contents and removes newly created files after a failed write', async () => {
    const directory = folder();
    const before = new Map(directory.files);
    const { pack, source } = await readDirectoryPack(directory);
    pack.emojis = [
      { name: 'cat', url: 'https://example.com/cat.png', category: 'Animals' },
    ];
    directory.failOnce.add('emojiful-web-gui.json');
    await expect(saveDirectoryPack(source, pack)).rejects.toMatchObject({
      key: 'folder.writeFailed',
    });
    expect(directory.files).toEqual(before);
  });

  it.each(['restore failure', 'external edit'])(
    'reports incomplete rollback after a %s and preserves unrelated files',
    async (failure) => {
      const directory = folder();
      const { pack, source } = await readDirectoryPack(directory);
      const path = 'data/sample/recipes/nested/original.json';
      const original = directory.files.get(path)!;
      const external = recipe('wave', 'https://example.com/external.png');
      let rollingBack = false;
      directory.beforeClose = (currentPath, text) => {
        if (currentPath === 'emojiful-web-gui.json' && !rollingBack) {
          rollingBack = true;
          if (failure === 'external edit') directory.files.set(path, external);
          throw new DOMException('Commit failed', 'UnknownError');
        }
        if (
          failure === 'restore failure' &&
          rollingBack &&
          currentPath === path &&
          text === original
        )
          throw new DOMException('Restore failed', 'UnknownError');
      };
      pack.emojis[0].url = 'https://example.com/updated.png';
      await expect(saveDirectoryPack(source, pack)).rejects.toMatchObject({
        key: 'folder.rollbackFailed',
      });
      if (failure === 'external edit')
        expect(directory.files.get(path)).toBe(external);
      expect(directory.files.get('notes.txt')).toBe('untouched notes');
      expect(directory.files.has('data/sample/recipes/crafting.json')).toBe(
        true,
      );
    },
  );

  it('rejects invalid pack metadata and tampered source paths without changing files', async () => {
    const directory = folder();
    const { pack, source } = await readDirectoryPack(directory);
    const before = new Map(directory.files);
    await expect(
      saveDirectoryPack(source, { ...pack, id: '../outside' }),
    ).rejects.toThrow();
    await expect(
      saveDirectoryPack(
        { ...source, files: { ...source.files, '../outside.json': '{}' } },
        pack,
      ),
    ).rejects.toThrow();
    expect(directory.files).toEqual(before);
  });

  it('limits bytes read from pack files before parsing them', async () => {
    const directory = folder();
    directory.files.set('emojiful-web-gui.json', ' '.repeat(9 * 1024 * 1024));
    await expect(readDirectoryPack(directory)).rejects.toMatchObject({
      key: 'folder.tooLarge',
    });
  });
});
