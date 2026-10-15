import { LocalizedError } from '../i18n';
import {
  emptyPack,
  MAX_EMOJIS,
  validateEmoji,
  validatePack,
  type EmojiEntry,
  type EmojiPack,
} from './pack';

const MAX_FOLDER_FILES = MAX_EMOJIS + 100;
const MAX_FOLDER_BYTES = 8 * 1024 * 1024;
const MAX_FOLDER_FILE_BYTES = 4 * 1024 * 1024;
const READ_WRITE = { mode: 'readwrite' as const };

export type PermissionState = 'granted' | 'denied' | 'prompt';

export interface FileWritable {
  write(data: string): Promise<void> | void;
  close(): Promise<void> | void;
  abort?(): Promise<void> | void;
}

export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileWritable>;
}

export interface DirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: {
    mode: 'readwrite';
  }): Promise<PermissionState>;
}

export interface DirectorySource {
  handle: DirectoryHandle;
  name: string;
  packId: string;
  /** Exact UTF-8 text for root metadata and the managed emoji recipe files. */
  files: Record<string, string>;
  recipePaths: Record<string, string>;
  /** Physical recipe values imported from the folder, or last successfully saved. */
  savedPack: EmojiPack;
}

interface FolderSnapshot {
  pack: EmojiPack;
  files: Record<string, string>;
  recipePaths: Record<string, string>;
  namespaces: Set<string>;
  metadata: Record<string, unknown> | undefined;
}

interface PlannedChange {
  path: string;
  before: string | undefined;
  after: string | undefined;
}

function folderError(
  key: 'folder.invalid' | 'folder.tooLarge',
): LocalizedError {
  return new LocalizedError(key);
}

function isNotFound(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'NotFoundError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'NotFoundError')
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return hasOwn(record, key) ? record[key] : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw folderError('folder.invalid');
  }
}

function validatePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw folderError('folder.invalid');
  }
}

function validateRecipePath(path: string): void {
  validatePath(path);
  if (
    !/^data\/[a-z0-9_.-]+\/recipes\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.json$/.test(
      path,
    )
  )
    throw folderError('folder.invalid');
}

function countReadBytes(fileBytes: number, totals: { bytes: number }): void {
  if (fileBytes > MAX_FOLDER_FILE_BYTES) throw folderError('folder.tooLarge');
  totals.bytes += fileBytes;
  if (totals.bytes > MAX_FOLDER_BYTES) throw folderError('folder.tooLarge');
}

async function readTextFile(
  handle: FileHandle,
  totals: { bytes: number },
): Promise<string> {
  const file = await handle.getFile();
  countReadBytes(file.size, totals);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw folderError('folder.invalid');
  }
}

async function getOptionalFile(
  directory: DirectoryHandle,
  name: string,
): Promise<FileHandle | undefined> {
  try {
    return await directory.getFileHandle(name);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function getOptionalDirectory(
  directory: DirectoryHandle,
  name: string,
): Promise<DirectoryHandle | undefined> {
  try {
    return await directory.getDirectoryHandle(name);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function visitRecipeDirectory(
  directory: DirectoryHandle,
  prefix: string,
  namespace: string,
  snapshot: FolderSnapshot,
  totals: { bytes: number; files: number },
  emojiEntries: EmojiEntry[],
): Promise<void> {
  for await (const child of directory.values()) {
    if (
      !child.name ||
      child.name === '.' ||
      child.name === '..' ||
      /[\\/\0]/.test(child.name)
    )
      throw folderError('folder.invalid');
    const path = `${prefix}/${child.name}`;
    if (child.kind === 'directory') {
      validatePath(path);
      await visitRecipeDirectory(
        child,
        path,
        namespace,
        snapshot,
        totals,
        emojiEntries,
      );
      continue;
    }
    if (child.kind !== 'file' || !child.name.endsWith('.json')) continue;
    validateRecipePath(path);
    if (++totals.files > MAX_FOLDER_FILES) throw folderError('folder.tooLarge');
    const raw = await readTextFile(child, totals);
    const parsed = parseJson(raw);
    if (!isObject(parsed) || parsed.type !== 'emojiful:emoji_recipe') continue;
    let emoji: EmojiEntry;
    try {
      emoji = validateEmoji(parsed);
    } catch {
      throw folderError('folder.invalid');
    }
    if (hasOwn(snapshot.recipePaths, emoji.name))
      throw folderError('folder.invalid');
    snapshot.files[path] = raw;
    snapshot.recipePaths[emoji.name] = path;
    snapshot.namespaces.add(namespace);
    emojiEntries.push(emoji);
  }
}

async function scanFolder(handle: DirectoryHandle): Promise<FolderSnapshot> {
  const snapshot: FolderSnapshot = {
    pack: emptyPack(),
    files: {},
    recipePaths: Object.create(null) as Record<string, string>,
    namespaces: new Set(),
    metadata: undefined,
  };
  const totals = { bytes: 0, files: 0 };
  const emojiEntries: EmojiEntry[] = [];

  for (const name of ['pack.mcmeta', 'emojiful-web-gui.json']) {
    const fileHandle = await getOptionalFile(handle, name);
    if (!fileHandle) continue;
    const raw = await readTextFile(fileHandle, totals);
    snapshot.files[name] = raw;
    if (name === 'pack.mcmeta') {
      const metadata = parseJson(raw);
      if (!isObject(metadata) || !isObject(metadata.pack))
        throw folderError('folder.invalid');
      snapshot.metadata = metadata;
    }
  }

  const data = await getOptionalDirectory(handle, 'data');
  if (data) {
    for await (const namespaceDirectory of data.values()) {
      if (namespaceDirectory.kind !== 'directory') continue;
      const namespace = namespaceDirectory.name;
      if (!/^[a-z0-9_.-]+$/.test(namespace)) continue;
      const recipes = await getOptionalDirectory(namespaceDirectory, 'recipes');
      if (recipes)
        await visitRecipeDirectory(
          recipes,
          `data/${namespace}/recipes`,
          namespace,
          snapshot,
          totals,
          emojiEntries,
        );
    }
  }

  const guiText = snapshot.files['emojiful-web-gui.json'];
  let editorPack: EmojiPack | undefined;
  if (guiText !== undefined) {
    const document = parseJson(guiText);
    if (!isObject(document)) throw folderError('folder.invalid');
    try {
      // Emoji data in the GUI document can be stale; root metadata is authoritative only
      // for editor identity and descriptions. Recipe files below supply the emoji list.
      editorPack = validatePack({ ...document, emojis: [] }, true);
    } catch {
      throw folderError('folder.invalid');
    }
  }

  let description = '';
  if (snapshot.metadata && isObject(snapshot.metadata.pack)) {
    const rawDescription = snapshot.metadata.pack.description;
    if (typeof rawDescription === 'string') description = rawDescription;
  }
  const namespaceIds = [...snapshot.namespaces].map((namespace) =>
    namespace.replace(/[.-]/g, '_').slice(0, 64),
  );
  const derivedId =
    namespaceIds.length === 1 ? namespaceIds[0] : 'imported_pack';
  const base = editorPack ?? {
    ...emptyPack(),
    id: derivedId || 'imported_pack',
    name: derivedId || 'imported_pack',
    description,
  };
  try {
    snapshot.pack = validatePack({ ...base, emojis: emojiEntries }, true);
  } catch {
    throw folderError('folder.invalid');
  }

  if (
    !snapshot.files['pack.mcmeta'] &&
    !snapshot.files['emojiful-web-gui.json'] &&
    emojiEntries.length === 0
  ) {
    throw folderError('folder.invalid');
  }
  return snapshot;
}

export async function readDirectoryPack(
  handle: DirectoryHandle,
): Promise<{ pack: EmojiPack; source: DirectorySource }> {
  try {
    const snapshot = await scanFolder(handle);
    const pack = snapshot.pack;
    return {
      pack,
      source: {
        handle,
        name: handle.name,
        packId: pack.id,
        files: snapshot.files,
        recipePaths: snapshot.recipePaths,
        savedPack: validatePack(pack, true),
      },
    };
  } catch (error) {
    if (error instanceof LocalizedError) throw error;
    throw folderError('folder.invalid');
  }
}

class MemoryFileHandle implements FileHandle {
  readonly kind = 'file' as const;
  constructor(
    readonly name: string,
    private readonly files: Map<string, string>,
    private readonly path: string,
  ) {}
  async getFile(): Promise<File> {
    const text = this.files.get(this.path);
    if (text === undefined) throw new DOMException('Missing', 'NotFoundError');
    return new File([text], this.name, { type: 'application/json' });
  }
  async createWritable(): Promise<FileWritable> {
    let pending = '';
    return {
      write: (text) => {
        pending = text;
      },
      close: () => {
        this.files.set(this.path, pending);
      },
    };
  }
}

class MemoryDirectoryHandle implements DirectoryHandle {
  readonly kind = 'directory' as const;
  constructor(
    readonly name: string,
    private readonly files: Map<string, string>,
    private readonly prefix = '',
  ) {}
  async *values(): AsyncGenerator<FileHandle | DirectoryHandle> {
    const children = new Map<string, boolean>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(this.prefix)) continue;
      const rest = path.slice(this.prefix.length);
      if (!rest) continue;
      const [name, ...tail] = rest.split('/');
      children.set(name, tail.length > 0);
    }
    for (const [name, directory] of children) {
      if (directory)
        yield new MemoryDirectoryHandle(
          name,
          this.files,
          `${this.prefix}${name}/`,
        );
      else
        yield new MemoryFileHandle(name, this.files, `${this.prefix}${name}`);
    }
  }
  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<FileHandle> {
    validateChildName(name);
    const path = `${this.prefix}${name}`;
    if (!this.files.has(path)) {
      if (!options.create) throw new DOMException('Missing', 'NotFoundError');
      this.files.set(path, '');
    }
    return new MemoryFileHandle(name, this.files, path);
  }
  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<DirectoryHandle> {
    validateChildName(name);
    const prefix = `${this.prefix}${name}/`;
    if (![...this.files.keys()].some((path) => path.startsWith(prefix))) {
      if (!options.create) throw new DOMException('Missing', 'NotFoundError');
      // The in-memory fallback only needs directories that contain files.
      this.files.set(`${prefix}.directory-marker`, '');
    }
    return new MemoryDirectoryHandle(name, this.files, prefix);
  }
  async removeEntry(name: string): Promise<void> {
    validateChildName(name);
    const path = `${this.prefix}${name}`;
    if (!this.files.delete(path))
      throw new DOMException('Missing', 'NotFoundError');
  }
}

function validateChildName(name: string): void {
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name))
    throw new DOMException('Bad path', 'TypeMismatchError');
}

export async function readDirectoryFiles(
  files: Iterable<File>,
): Promise<EmojiPack> {
  const entries = [...files];
  if (!entries.length) throw folderError('folder.invalid');
  const paths = new Map<string, string>();
  let selectedRoot: string | undefined;
  const totals = { bytes: 0 };
  for (const file of entries) {
    const relative = (file as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    const rawPath = relative || file.name;
    if (
      rawPath.includes('\\') ||
      rawPath.startsWith('/') ||
      /^[a-z]:/i.test(rawPath)
    )
      throw folderError('folder.invalid');
    const segments = rawPath.split('/');
    if (
      segments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      )
    )
      throw folderError('folder.invalid');
    let path: string;
    if (relative) {
      if (selectedRoot !== undefined && selectedRoot !== segments[0])
        throw folderError('folder.invalid');
      selectedRoot = segments[0];
      path = segments.slice(1).join('/');
    } else {
      path = segments.join('/');
    }
    if (!path) throw folderError('folder.invalid');
    validatePath(path);
    // Directory uploads commonly include icons and documentation alongside
    // datapack files. Only inspect the same allowlist as the handle reader.
    const relevant =
      path === 'pack.mcmeta' ||
      path === 'emojiful-web-gui.json' ||
      /^data\/[a-z0-9_.-]+\/recipes\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.json$/.test(
        path,
      );
    if (!relevant) continue;
    countReadBytes(file.size, totals);
    if (paths.has(path)) throw folderError('folder.invalid');
    let raw: string;
    try {
      raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      );
    } catch {
      throw folderError('folder.invalid');
    }
    paths.set(path, raw);
  }
  if (
    [...paths.keys()].filter((path) => path.startsWith('data/')).length >
    MAX_FOLDER_FILES
  )
    throw folderError('folder.tooLarge');
  try {
    return (
      await readDirectoryPack(
        new MemoryDirectoryHandle(selectedRoot ?? 'Folder', paths),
      )
    ).pack;
  } catch (error) {
    if (error instanceof LocalizedError) throw error;
    throw folderError('folder.invalid');
  }
}

export async function ensureDirectoryWritePermission(
  handle: DirectoryHandle,
): Promise<void> {
  if (!handle.queryPermission && !handle.requestPermission) return;
  let permission: PermissionState = 'prompt';
  try {
    if (handle.queryPermission)
      permission = await handle.queryPermission(READ_WRITE);
    if (permission !== 'granted' && handle.requestPermission)
      permission = await handle.requestPermission(READ_WRITE);
  } catch {
    throw new LocalizedError('folder.permission');
  }
  if (permission !== 'granted') throw new LocalizedError('folder.permission');
}

function validateSource(source: DirectorySource): void {
  if (
    !source ||
    !source.handle ||
    source.handle.kind !== 'directory' ||
    !isObject(source.files) ||
    !isObject(source.recipePaths)
  )
    throw folderError('folder.invalid');
  const id = validatePack({ ...emptyPack(), id: source.packId }, true).id;
  if (id !== source.packId) throw folderError('folder.invalid');
  for (const [path, contents] of Object.entries(source.files)) {
    if (typeof contents !== 'string') throw folderError('folder.invalid');
    if (path === 'pack.mcmeta' || path === 'emojiful-web-gui.json') continue;
    validateRecipePath(path);
  }
  for (const [name, path] of Object.entries(source.recipePaths)) {
    if (
      !/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(name) ||
      typeof source.files[path] !== 'string'
    )
      throw folderError('folder.invalid');
    validateRecipePath(path);
    const recipe = parseJson(source.files[path]);
    if (
      !isObject(recipe) ||
      recipe.type !== 'emojiful:emoji_recipe' ||
      recipe.name !== name
    )
      throw folderError('folder.invalid');
  }
  const recipeFiles = Object.keys(source.files).filter((path) =>
    path.startsWith('data/'),
  );
  if (recipeFiles.length !== Object.keys(source.recipePaths).length)
    throw folderError('folder.invalid');
  try {
    validatePack(source.savedPack, true);
  } catch {
    throw folderError('folder.invalid');
  }
}

function sameFiles(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

async function readPath(
  root: DirectoryHandle,
  path: string,
): Promise<string | undefined> {
  validatePath(path);
  const segments = path.split('/');
  let directory = root;
  try {
    for (const segment of segments.slice(0, -1))
      directory = await directory.getDirectoryHandle(segment);
    const handle = await directory.getFileHandle(segments.at(-1)!);
    const file = await handle.getFile();
    if (file.size > MAX_FOLDER_FILE_BYTES) throw folderError('folder.tooLarge');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await file.arrayBuffer(),
    );
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function readPathForSave(
  root: DirectoryHandle,
  path: string,
): Promise<string | undefined> {
  try {
    return await readPath(root, path);
  } catch {
    throw new LocalizedError('folder.conflict');
  }
}

async function writePath(
  root: DirectoryHandle,
  path: string,
  text: string,
): Promise<void> {
  validatePath(path);
  const segments = path.split('/');
  let directory = root;
  for (const segment of segments.slice(0, -1))
    directory = await directory.getDirectoryHandle(segment, { create: true });
  const file = await directory.getFileHandle(segments.at(-1)!, {
    create: true,
  });
  const writable = await file.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      /* The original write error is more useful. */
    }
    throw error;
  }
}

async function removePath(root: DirectoryHandle, path: string): Promise<void> {
  validatePath(path);
  const segments = path.split('/');
  let directory = root;
  for (const segment of segments.slice(0, -1))
    directory = await directory.getDirectoryHandle(segment);
  await directory.removeEntry(segments.at(-1)!);
}

async function rollback(
  handle: DirectoryHandle,
  changes: PlannedChange[],
): Promise<boolean> {
  let complete = true;
  for (const change of [...changes].reverse()) {
    try {
      const current = await readPath(handle, change.path);
      if (change.before === undefined) {
        if (current === undefined) continue;
        // getFileHandle({create:true}) may have left an empty placeholder when a write failed.
        if (current !== change.after && current !== '') {
          complete = false;
          continue;
        }
        await removePath(handle, change.path);
      } else if (current === change.before) {
        continue;
      } else if (
        current === change.after ||
        (change.after === undefined && current === undefined)
      ) {
        await writePath(handle, change.path, change.before);
      } else {
        // Never overwrite a third value that may have been written by another editor.
        complete = false;
      }
    } catch {
      complete = false;
    }
  }
  return complete;
}

export async function saveDirectoryPack(
  source: DirectorySource,
  value: EmojiPack,
): Promise<DirectorySource> {
  validateSource(source);
  const pack = validatePack(value, true);
  await ensureDirectoryWritePermission(source.handle);

  let current: FolderSnapshot;
  try {
    current = await scanFolder(source.handle);
  } catch {
    throw new LocalizedError('folder.conflict');
  }
  if (
    !sameFiles(source.files, current.files) ||
    Object.keys(source.recipePaths).length !==
      Object.keys(current.recipePaths).length ||
    Object.entries(source.recipePaths).some(
      ([name, path]) => ownValue(current.recipePaths, name) !== path,
    )
  ) {
    throw new LocalizedError('folder.conflict');
  }

  const targetPaths = Object.create(null) as Record<string, string>;
  const outputs: Record<string, string> = {};
  const metadataRaw = source.files['pack.mcmeta'];
  let metadata: Record<string, unknown>;
  if (metadataRaw !== undefined) {
    const parsed = parseJson(metadataRaw);
    if (!isObject(parsed)) throw folderError('folder.invalid');
    metadata = { ...parsed };
  } else {
    metadata = {};
  }
  const packInfo = isObject(metadata.pack) ? { ...metadata.pack } : {};
  if (packInfo.pack_format === undefined) packInfo.pack_format = 15;
  const hasRawDescription = Object.prototype.hasOwnProperty.call(
    packInfo,
    'description',
  );
  if (!hasRawDescription || pack.description !== source.savedPack.description)
    packInfo.description = pack.description || pack.name;
  metadata.pack = packInfo;
  outputs['pack.mcmeta'] = JSON.stringify(metadata, null, 2);

  const newRecipePaths = new Set<string>();
  for (const emoji of pack.emojis) {
    const oldPath = ownValue(source.recipePaths, emoji.name);
    const path =
      oldPath && source.packId === pack.id
        ? oldPath
        : `data/${pack.id}/recipes/${emoji.name}.json`;
    validateRecipePath(path);
    if (newRecipePaths.has(path)) throw folderError('folder.invalid');
    newRecipePaths.add(path);
    targetPaths[emoji.name] = path;
    const oldRaw = oldPath ? source.files[oldPath] : undefined;
    let recipe: Record<string, unknown> = {};
    if (oldRaw !== undefined) {
      const parsed = parseJson(oldRaw);
      if (!isObject(parsed)) throw folderError('folder.invalid');
      recipe = { ...parsed };
    }
    outputs[path] = JSON.stringify(
      { ...recipe, type: 'emojiful:emoji_recipe', ...emoji },
      null,
      2,
    );
  }

  const obsolete = Object.entries(source.recipePaths)
    .filter(([, path]) => !newRecipePaths.has(path))
    .map(([, path]) => path);
  // Write the GUI document last so it marks the completed recipe transaction.
  outputs['emojiful-web-gui.json'] = JSON.stringify(pack, null, 2);
  const outputEncoder = new TextEncoder();
  let totalOutputBytes = 0;
  for (const text of Object.values(outputs)) {
    const bytes = outputEncoder.encode(text).byteLength;
    if (bytes > MAX_FOLDER_FILE_BYTES) throw folderError('folder.tooLarge');
    totalOutputBytes += bytes;
    if (totalOutputBytes > MAX_FOLDER_BYTES)
      throw folderError('folder.tooLarge');
  }
  const changes: PlannedChange[] = [];
  try {
    // Complete collision checks before creating directories or opening writers.
    for (const path of Object.keys(outputs)) {
      const actual = await readPathForSave(source.handle, path);
      const original = hasOwn(source.files, path)
        ? source.files[path]
        : undefined;
      if (actual !== original) throw new LocalizedError('folder.conflict');
    }
    for (const path of obsolete) {
      const actual = await readPathForSave(source.handle, path);
      if (actual !== source.files[path])
        throw new LocalizedError('folder.conflict');
    }

    const writes = Object.entries(outputs).filter(
      ([path]) => path !== 'emojiful-web-gui.json',
    );
    for (const [path, text] of writes) {
      const before = await readPathForSave(source.handle, path);
      const expected = hasOwn(source.files, path)
        ? source.files[path]
        : undefined;
      if (before !== expected) throw new LocalizedError('folder.conflict');
      changes.push({ path, before, after: text });
      await writePath(source.handle, path, text);
    }
    for (const path of obsolete) {
      const before = await readPathForSave(source.handle, path);
      if (before !== source.files[path])
        throw new LocalizedError('folder.conflict');
      changes.push({ path, before, after: undefined });
      await removePath(source.handle, path);
    }
    const guiMetadata = outputs['emojiful-web-gui.json'];
    const guiBefore = await readPathForSave(
      source.handle,
      'emojiful-web-gui.json',
    );
    const expectedGui = hasOwn(source.files, 'emojiful-web-gui.json')
      ? source.files['emojiful-web-gui.json']
      : undefined;
    if (guiBefore !== expectedGui) throw new LocalizedError('folder.conflict');
    changes.push({
      path: 'emojiful-web-gui.json',
      before: guiBefore,
      after: guiMetadata,
    });
    await writePath(source.handle, 'emojiful-web-gui.json', guiMetadata);
  } catch (error) {
    if (
      error instanceof LocalizedError &&
      error.key === 'folder.conflict' &&
      changes.length === 0
    )
      throw error;
    const restored = await rollback(source.handle, changes);
    if (!restored) throw new LocalizedError('folder.rollbackFailed');
    if (error instanceof LocalizedError && error.key === 'folder.conflict')
      throw error;
    throw new LocalizedError('folder.writeFailed');
  }

  const files: Record<string, string> = { ...outputs };
  const recipePaths = targetPaths;
  return {
    handle: source.handle,
    name: source.name,
    packId: pack.id,
    files,
    recipePaths,
    savedPack: validatePack(pack, true),
  };
}
