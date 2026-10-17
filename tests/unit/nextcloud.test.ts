import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  buildNextcloudCommand,
  nextcloudImageEntry,
  parseNextcloudFolder,
  disambiguateNextcloudNames,
} from '../../web/src/lib/nextcloud';

describe('Nextcloud public folder terminal import', () => {
  it.skipIf(process.platform !== 'win32')(
    'PowerShell parses hostile URL characters as one literal argument',
    () => {
      const folder = parseNextcloudFolder(
        "https://cloud'$(1+1).example/s/Share123",
        "/a'$(1+1)`&{x}",
      );
      const command = buildNextcloudCommand(folder, 'powershell');
      // Replace curl with a local argument recorder: this never makes a request.
      const script =
        'function curl.exe { ConvertTo-Json -InputObject @($args) -Compress }\n' +
        command;
      const output = execFileSync(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true },
      );
      const args = JSON.parse(output.trim()) as string[];
      expect(args.at(-1)).toBe(folder.davUrl);
      expect(args).toContain('PROPFIND');
      expect(args).toContain('Depth: 1');
    },
  );
  it('supports installation prefixes, index.php links and share URL subfolders', () => {
    const folder = parseNextcloudFolder(
      'https://cloud.example/nextcloud/index.php/s/Share123?path=%2FFun%20%26%20Games',
      '',
    );
    expect(folder.davUrl).toBe(
      'https://cloud.example/nextcloud/public.php/dav/files/Share123/Fun%20%26%20Games/',
    );
    expect(
      parseNextcloudFolder(
        'https://cloud.example/s/Share123?path=%2Fother',
        '/',
      ).davUrl,
    ).toBe('https://cloud.example/public.php/dav/files/Share123/');
    expect(
      parseNextcloudFolder('https://cloud.example/s/Share123', '/日本語/100%')
        .davUrl,
    ).toBe(
      'https://cloud.example/public.php/dav/files/Share123/%E6%97%A5%E6%9C%AC%E8%AA%9E/100%25/',
    );
  });

  it('rejects credentials, unsafe URLs and folder traversal', () => {
    for (const url of [
      'http://cloud.example/s/Share123',
      'https://user:secret@cloud.example/s/Share123',
      'https://cloud.example/remote.php/dav/files/user/',
      'https://cloud.example/s/Share123/download',
      'javascript:alert(1)',
    ])
      expect(() => parseNextcloudFolder(url, '')).toThrow();
    for (const path of [
      '../elsewhere',
      '/one/../two',
      '/one/./two',
      '/one\\two',
      '/bad\npath',
    ])
      expect(() =>
        parseNextcloudFolder('https://cloud.example/s/Share123', path),
      ).toThrow();
  });

  it('generates a bounded read-only curl request without shell interpolation', () => {
    const folder = parseNextcloudFolder(
      'https://cloud.example/s/Share123',
      "/a'$(Get-Process)`&{x}",
    );
    const powershell = buildNextcloudCommand(folder, 'powershell');
    const sh = buildNextcloudCommand(folder, 'sh');
    expect(powershell.startsWith('curl.exe ')).toBe(true);
    expect(sh.startsWith('curl ')).toBe(true);
    for (const command of [powershell, sh]) {
      expect(command).toContain('--request PROPFIND');
      expect(command).toContain("--header 'Depth: 1'");
      expect(command).toContain("--header 'X-Requested-With: XMLHttpRequest'");
      expect(command).toContain('--max-time 30');
      expect(command).toContain('--globoff');
      expect(command).not.toMatch(/\$\(|`|\{x\}/);
      expect(command).not.toContain('--location');
      expect(command).not.toMatch(/--user|--insecure|--data|--output/);
    }
  });

  it('keeps filename case in image URLs and uses existing name normalization', () => {
    const folder = parseNextcloudFolder(
      'https://cloud.example/s/Share123',
      '/Animals',
    );
    expect(nextcloudImageEntry(folder, 'Happy Cat.PNG', 0, 'Animals')).toEqual({
      name: 'happy_cat',
      url: 'https://cloud.example/public.php/dav/files/Share123/Animals/Happy%20Cat.PNG',
      category: 'Animals',
    });
    expect(nextcloudImageEntry(folder, '猫.gif', 1, '動物')?.name).toBe(
      'emoji_2',
    );
    expect(
      nextcloudImageEntry(folder, 'a#b&c%.webp', 0, 'Custom')?.url,
    ).toContain('a%23b%26c%25.webp');
    for (const filename of ['notes.txt', 'vector.svg', 'folder'])
      expect(nextcloudImageEntry(folder, filename, 0, 'Custom')).toBeNull();
    expect(() =>
      nextcloudImageEntry(folder, '../cat.png', 0, 'Custom'),
    ).toThrow();
  });
});

describe('Nextcloud filename collisions', () => {
  const folder = parseNextcloudFolder('https://cloud.example/s/Share123');
  const entries = (filenames: string[]) =>
    filenames.map((filename, index) =>
      nextcloudImageEntry(folder, filename, index, 'Custom')!,
    );

  it('keeps GIF and PNG files with the same stem under distinct descriptive names', () => {
    const input = entries([
      'medetai-nya.gif',
      'medetai-nya.png',
      'medetai-tai-nya.png',
    ]);
    const original = structuredClone(input);
    const result = disambiguateNextcloudNames(input);
    expect(result.map((entry) => entry.name)).toEqual([
      'medetai-nya_gif',
      'medetai-nya_png',
      'medetai-tai-nya',
    ]);
    expect(result.map((entry) => entry.url)).toEqual(
      input.map((entry) => entry.url),
    );
    expect(input).toEqual(original);
  });

  it('reserves natural names before resolving case, punctuation and generated-name collisions', () => {
    const input = entries([
      'cat.png',
      'cat.gif',
      'cat_png.png',
      'CAT.PNG',
      'cat_png_2.png',
      'a b.png',
      'a_b.png',
      '猫.png',
      'emoji_8.png',
    ]);
    const result = disambiguateNextcloudNames(input);
    expect(result.map((entry) => entry.name)).toEqual([
      'cat_png_3',
      'cat_gif',
      'cat_png',
      'cat_png_4',
      'cat_png_2',
      'a_b_png',
      'a_b_png_2',
      'emoji_8_png',
      'emoji_8_png_2',
    ]);
    expect(new Set(result.map((entry) => entry.name)).size).toBe(input.length);
  });

  it('keeps suffixed names valid at the 64-character limit', () => {
    const result = disambiguateNextcloudNames(
      entries([
        `${'a'.repeat(70)}.png`,
        `${'a'.repeat(70)}.gif`,
        `${'a'.repeat(70)}.webp`,
      ]),
    );
    expect(new Set(result.map((entry) => entry.name)).size).toBe(3);
    for (const entry of result) {
      expect(entry.name.length).toBeLessThanOrEqual(64);
      expect(entry.name).toMatch(/^[a-z0-9_][a-z0-9_-]{0,63}$/);
    }
  });
});
