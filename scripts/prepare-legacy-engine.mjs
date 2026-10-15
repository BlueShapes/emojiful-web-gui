import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const output = new URL('web/public/legacy-engine/generated/', root);
const core = new URL('node_modules/@ffmpeg/core/dist/esm/', root);
const version = '0.12.10';
const installed = JSON.parse(
  await readFile(
    new URL('node_modules/@ffmpeg/core/package.json', root),
    'utf8',
  ),
);
if (installed.version !== version)
  throw new Error(
    'Review the legacy engine source and license information before changing its pinned version',
  );
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function writeChanged(name, bytes) {
  const path = new URL(name, output);
  try {
    if ((await readFile(path)).equals(Buffer.from(bytes))) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(path, bytes);
}
const wasm = await readFile(new URL('ffmpeg-core.wasm', core));
const js = await readFile(new URL('ffmpeg-core.js', core));
const compressed = gzipSync(wasm, { level: 9 });
// Workers Static Assets permits at most 25 MiB per file. Decompress locally.
if (compressed.byteLength > 25 * 1024 * 1024)
  throw new Error('Compressed legacy engine exceeds Cloudflare asset limit');
await mkdir(output, { recursive: true });
await writeChanged('ffmpeg-core.js', js);
await writeChanged('ffmpeg-core.wasm.gz', compressed);
await writeChanged(
  'manifest.json',
  JSON.stringify(
    {
      version,
      core: 'ffmpeg-core.js',
      wasm: 'ffmpeg-core.wasm.gz',
      bytes: wasm.byteLength,
      sha256: digest(wasm),
      compressedBytes: compressed.byteLength,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(
  `Legacy engine: ${(compressed.byteLength / 1024 / 1024).toFixed(1)} MiB compressed, loaded on demand\n`,
);
