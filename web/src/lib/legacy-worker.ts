import { LocalizedError } from '../i18n';
import {
  buildLegacyArgs,
  inspectLegacyInput,
  inspectLegacyGif,
  normalizeLegacyGif,
  setLegacyGifDelays,
  legacyOutputName,
} from './legacy-media';
import type { LegacyOptions, LegacyInputInfo } from './legacy-media';

interface Core {
  FS: {
    writeFile(path: string, bytes: Uint8Array): void;
    readFile(path: string): Uint8Array<ArrayBuffer>;
    unlink(path: string): void;
  };
  exec(...args: string[]): number;
  ffprobe(...args: string[]): number;
  reset(): void;
  setTimeout(timeout: number): void;
  setLogger(callback: (message: { message: string }) => void): void;
}
const scope = self as unknown as {
  postMessage(value: unknown, transfer?: Transferable[]): void;
  onmessage: (
    event: MessageEvent<{
      id: number;
      bytes: ArrayBuffer;
      name: string;
      options: LegacyOptions;
    }>,
  ) => void;
};
let engine: Promise<Core> | null = null;

async function loadCore(): Promise<Core> {
  if (!('DecompressionStream' in self) || !('OffscreenCanvas' in self))
    throw new LocalizedError('legacy.unsupported');
  const base = '/legacy-engine/generated/';
  const manifestResponse = await fetch(`${base}manifest.json`);
  if (!manifestResponse.ok) throw new Error('Engine manifest');
  const manifest = await manifestResponse.json();
  if (
    manifest.bytes > 64 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw new Error('Engine integrity');
  const response = await fetch(`${base}ffmpeg-core.wasm.gz`, {
    cache: 'force-cache',
  });
  if (!response.ok || !response.body) throw new Error('Engine download');
  // Some static servers send .gz as Content-Encoding: gzip, so fetch has
  // already decompressed it. Other hosts serve the compressed file verbatim.
  const downloaded = new Uint8Array(await response.arrayBuffer());
  const binary =
    downloaded[0] === 0x1f && downloaded[1] === 0x8b
      ? await new Response(
          new Blob([downloaded])
            .stream()
            .pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer()
      : downloaded.buffer;
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', binary)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  if (binary.byteLength !== manifest.bytes || hash !== manifest.sha256)
    throw new Error('Engine integrity');
  const moduleUrl = `${base}ffmpeg-core.js`;
  const { default: createCore } = await import(/* @vite-ignore */ moduleUrl);
  const core: Core = await createCore({ wasmBinary: new Uint8Array(binary) });
  core.setLogger(() => {});
  return core;
}

const text = (bytes: Uint8Array, offset: number, length: number) =>
  new TextDecoder().decode(bytes.subarray(offset, offset + length));
const uint24 = (bytes: Uint8Array, offset: number) =>
  bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
function write24(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
}
function staticWebp(
  payload: Uint8Array,
  width: number,
  height: number,
): ArrayBuffer {
  const bytes = new Uint8Array(30 + payload.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode('WEBPVP8X'), 8);
  view.setUint32(16, 10, true);
  bytes[20] = 0x10; // Preserve alpha while decoding the standalone ANMF image.
  write24(bytes, 24, width - 1);
  write24(bytes, 27, height - 1);
  bytes.set(payload, 30);
  return bytes.buffer;
}

// Decode WebP patches with the browser's maintained WebP codec. FFmpeg 5.1's
// decoder does not support animated WebP. ANMF blend/dispose are applied here.
async function writeWebpFrames(
  core: Core,
  bytes: Uint8Array,
  info: LegacyInputInfo,
  edge: number,
  files: string[],
): Promise<number> {
  const width = info.width!,
    height = info.height!;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  const ratio = Math.min(1, edge / width, edge / height);
  const output = new OffscreenCanvas(
    Math.max(1, Math.floor(width * ratio)),
    Math.max(1, Math.floor(height * ratio)),
  );
  const resized = output.getContext('2d');
  if (!context || !resized) throw new LocalizedError('legacy.unsupported');
  let count = 0;
  async function emit() {
    resized!.clearRect(0, 0, output.width, output.height);
    resized!.drawImage(canvas, 0, 0, output.width, output.height);
    const name = `frame${String(count++).padStart(4, '0')}.png`;
    const png = await output.convertToBlob({ type: 'image/png' });
    files.push(name);
    core.FS.writeFile(name, new Uint8Array(await png.arrayBuffer()));
  }
  if (!info.frames) {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes).buffer], { type: 'image/webp' }),
    );
    try {
      context.drawImage(bitmap, 0, 0);
      await emit();
    } finally {
      bitmap.close();
    }
    return count;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = text(bytes, offset, 4),
      length = view.getUint32(offset + 4, true),
      data = offset + 8;
    if (data + length > bytes.length)
      throw new LocalizedError('legacy.invalid');
    // The WebP background is a presentation hint. Use a transparent canvas,
    // as browsers do, so emoji do not acquire an opaque background.
    if (type === 'ANMF') {
      const left = uint24(bytes, data) * 2,
        top = uint24(bytes, data + 3) * 2;
      const frameWidth = uint24(bytes, data + 6) + 1,
        frameHeight = uint24(bytes, data + 9) + 1;
      const flags = bytes[data + 15];
      const bitmap = await createImageBitmap(
        new Blob(
          [
            staticWebp(
              bytes.subarray(data + 16, data + length),
              frameWidth,
              frameHeight,
            ),
          ],
          { type: 'image/webp' },
        ),
      );
      try {
        if (flags & 2) context.clearRect(left, top, frameWidth, frameHeight);
        context.drawImage(bitmap, left, top);
        await emit();
      } finally {
        bitmap.close();
      }
      if (flags & 1) {
        context.clearRect(left, top, frameWidth, frameHeight);
      }
    }
    offset = data + length + (length & 1);
  }
  if (count !== info.frames) throw new LocalizedError('legacy.invalid');
  return count;
}

function run(core: Core, args: string[]) {
  core.reset();
  core.setTimeout(120_000);
  if (core.exec(...args) !== 0) throw new LocalizedError('legacy.failed');
}

scope.onmessage = async ({ data: { id, bytes: buffer, name, options } }) => {
  const files: string[] = [];
  let core: Core | undefined;
  try {
    const bytes = new Uint8Array(buffer);
    const info = inspectLegacyInput(bytes, name);
    const args = buildLegacyArgs(info.format, options, info.loop);
    scope.postMessage({ id, type: 'stage', stage: 'loading' });
    core = await (engine ??= loadCore());
    scope.postMessage({ id, type: 'stage', stage: 'converting' });
    if (info.format === 'webp') {
      await writeWebpFrames(core, bytes, info, options.maxEdge, files);
      const inputIndex = args.indexOf('-i');
      args.splice(inputIndex, 2, '-framerate', '100', '-i', 'frame%04d.png');
    } else {
      const inputName = `input.${info.format}`;
      files.push(inputName);
      core.FS.writeFile(inputName, bytes);
      // Probe WebM dimensions/duration before decoding. GIF/APNG/WebP headers
      // have already supplied bounded dimensions and animation metadata.
      if (info.format === 'webm') {
        files.push('probe.json');
        core.reset();
        core.setTimeout(120_000);
        const ret = core.ffprobe(
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height,codec_name:format=duration',
          '-of',
          'json',
          '-o',
          'probe.json',
          inputName,
        );
        // The pinned core's ffprobe wrapper leaves its return value at -1
        // even after writing valid JSON. Validate the fresh probe output too.
        if (ret !== 0 && ret !== -1) throw new LocalizedError('legacy.invalid');
        const probe = JSON.parse(
          new TextDecoder().decode(core.FS.readFile('probe.json')),
        );
        const stream = probe.streams?.[0];
        if (
          !stream ||
          !Number.isSafeInteger(stream.width) ||
          stream.width < 1 ||
          !Number.isSafeInteger(stream.height) ||
          stream.height < 1
        )
          throw new LocalizedError('legacy.invalid');
        if (
          stream.width > 4096 ||
          stream.height > 4096 ||
          !Number.isFinite(Number(probe.format?.duration ?? 0)) ||
          Number(probe.format?.duration ?? 0) > 60
        )
          throw new LocalizedError('legacy.limits');
        const decoder =
          stream.codec_name === 'vp9'
            ? 'libvpx-vp9'
            : stream.codec_name === 'vp8'
              ? 'libvpx'
              : null;
        if (decoder) args.unshift('-c:v', decoder); // libvpx retains WebM alpha.
      }
    }
    files.push('output.gif');
    run(core, args);
    let output = normalizeLegacyGif(
      core.FS.readFile('output.gif'),
      options.maxEdge,
    );
    let gif = inspectLegacyGif(output);
    if (
      output.length >= 63 * 1024 * 1024 ||
      (info.frames !== undefined && gif.frames.length !== info.frames)
    )
      throw new LocalizedError('legacy.limits');
    if (info.delays) {
      output = setLegacyGifDelays(output, info.delays);
      gif = inspectLegacyGif(output);
    }
    const result = {
      bytes: output,
      filename: legacyOutputName(name),
      width: gif.width,
      height: gif.height,
      frames: gif.frames.length,
    };
    scope.postMessage({ id, type: 'result', result }, [
      output.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    engine = null;
    scope.postMessage({
      id,
      type: 'error',
      key: error instanceof LocalizedError ? error.key : 'legacy.failed',
    });
  } finally {
    for (const file of files) {
      try {
        core?.FS.unlink(file);
      } catch {
        /* Failed conversions may not have created every file. */
      }
    }
  }
};
