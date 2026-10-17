import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  buildNextcloudCommand,
  nextcloudImageEntry,
  parseNextcloudFolder,
  importNextcloudListing,
} from '../../web/src/lib/nextcloud';
import {
  getBulkTableIssues,
  importBulkTable,
} from '../../web/src/lib/bulk-table';

afterEach(() => vi.unstubAllGlobals());

function stubListingDomParser() {
  const element = (
    localName: string,
    textContent = '',
    children: Element[] = [],
  ) =>
    ({
      namespaceURI: 'DAV:',
      localName,
      textContent,
      children,
    }) as unknown as Element;
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString(source: string) {
        const hrefs = [...source.matchAll(/<d:href>(.*?)<\/d:href>/g)].map(
          (match) => match[1],
        );
        const responses = hrefs.map((href) =>
          element('response', '', [
            element('href', href),
            element('propstat', '', [
              element('prop', '', [element('resourcetype')]),
              element('status', 'HTTP/1.1 200 OK'),
            ]),
          ]),
        );
        return {
          documentElement: element('multistatus', '', responses),
          getElementsByTagName: () => [],
        } as unknown as Document;
      }
    },
  );
}

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

  it('preserves the original filename stem and full filename', () => {
    const folder = parseNextcloudFolder(
      'https://cloud.example/s/Share123',
      '/Animals',
    );
    expect(nextcloudImageEntry(folder, 'Happy Cat.PNG', 0, 'Animals')).toEqual({
      name: 'Happy Cat',
      url: 'https://cloud.example/public.php/dav/files/Share123/Animals/Happy%20Cat.PNG',
      category: 'Animals',
      sourceFilename: 'Happy Cat.PNG',
    });
    expect(nextcloudImageEntry(folder, '猫.gif', 1, '動物')).toMatchObject({
      name: '猫',
      sourceFilename: '猫.gif',
    });
    expect(
      nextcloudImageEntry(folder, `${'a'.repeat(70)}.png`, 2, 'Custom')?.name,
    ).toBe('a'.repeat(70));
    expect(
      nextcloudImageEntry(folder, 'a#b&c%.webp', 3, 'Custom')?.url,
    ).toContain('a%23b%26c%25.webp');
    for (const filename of ['notes.txt', 'vector.svg', 'folder', 'png', 'GIF'])
      expect(nextcloudImageEntry(folder, filename, 4, 'Custom')).toBeNull();
    expect(() =>
      nextcloudImageEntry(folder, '../cat.png', 5, 'Custom'),
    ).toThrow();
  });
});

describe('Nextcloud filename preservation', () => {
  const folder = parseNextcloudFolder('https://cloud.example/s/Share123');
  const listing = (filenames: string[]) =>
    `<d:multistatus xmlns:d="DAV:">${filenames
      .map(
        (filename) =>
          `<d:response><d:href>${folder.davUrl}${encodeURIComponent(filename)}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      )
      .join('')}</d:multistatus>`;

  it('keeps same-stem images with their original filenames and URLs', () => {
    stubListingDomParser();
    const entries = importNextcloudListing(
      listing(['same.gif', 'same.png']),
      folder,
      'Custom',
    );
    expect(entries).toMatchObject([
      { name: 'same', sourceFilename: 'same.gif' },
      { name: 'same', sourceFilename: 'same.png' },
    ]);
    expect(entries.map(({ url }) => url)).toEqual([
      `${folder.davUrl}same.gif`,
      `${folder.davUrl}same.png`,
    ]);

    const issues = getBulkTableIssues(entries, 'Custom');
    expect(issues.map((row) => row.map(({ error }) => error.key))).toEqual([
      ['error.duplicate'],
      ['error.duplicate'],
    ]);
    expect(() => importBulkTable(entries, 'Custom')).toThrow();

    const corrected = entries.map((entry, index) =>
      index === 0 ? entry : { ...entry, name: 'same_png' },
    );
    expect(importBulkTable(corrected, 'Custom')).toEqual([
      { name: 'same', url: entries[0].url, category: 'Custom' },
      { name: 'same_png', url: entries[1].url, category: 'Custom' },
    ]);
  });

  it('retains Unicode, spaces, case, and names longer than 64 characters in previews', () => {
    stubListingDomParser();
    const entries = importNextcloudListing(
      listing([
        'ショパン-nya.png',
        'バッハ-nya.png',
        '猫.gif',
        'Happy Cat.PNG',
        `${'x'.repeat(70)}.webp`,
      ]),
      folder,
      'Custom',
    );
    expect(
      entries.map(({ name, sourceFilename }) => [name, sourceFilename]),
    ).toEqual([
      ['ショパン-nya', 'ショパン-nya.png'],
      ['バッハ-nya', 'バッハ-nya.png'],
      ['猫', '猫.gif'],
      ['Happy Cat', 'Happy Cat.PNG'],
      ['x'.repeat(70), `${'x'.repeat(70)}.webp`],
    ]);

    const invalidIssues = getBulkTableIssues(
      [entries[0], entries[2]],
      'Custom',
    );
    expect(invalidIssues.map((row) => row[0]?.error.key)).toEqual([
      'error.emojiName',
      'error.emojiName',
    ]);
    const fixed = [
      { ...entries[0], name: 'chopin_nya' },
      { ...entries[2], name: 'neko' },
    ];
    expect(importBulkTable(fixed, 'Custom')).toEqual([
      { name: 'chopin_nya', url: entries[0].url, category: 'Custom' },
      { name: 'neko', url: entries[2].url, category: 'Custom' },
    ]);
  });
});
