import { LocalizedError } from '../i18n';

export const DEFAULT_LEGACY_OPTIONS = { maxEdge: 128 } as const;

export interface LegacyOptions {
  maxEdge: number;
}

export type LegacyFormat = 'gif' | 'webm' | 'webp' | 'apng';

export interface LegacyInputInfo {
  format: LegacyFormat;
  width?: number;
  height?: number;
  frames?: number;
  /** Per-frame GIF delay in centiseconds, when the input has known frame timing. */
  delays?: number[];
  /** GIF repeat count, or the converted GIF repeat count for other formats. */
  loop: number;
}

export interface LegacyGifFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Delay in hundredths of a second, as stored by GIF. */
  delay: number;
  disposal: number;
}

export interface LegacyGifInfo {
  width: number;
  height: number;
  frames: LegacyGifFrame[];
  loop: number;
}

function quantizeFrameDelays(durationsMs: readonly number[]): number[] {
  let cumulativeMilliseconds = 0;
  let emittedCentiseconds = 0;
  return durationsMs.map((duration) => {
    cumulativeMilliseconds += duration;
    const nextCentiseconds = Math.round(cumulativeMilliseconds / 10);
    const delay = nextCentiseconds - emittedCentiseconds;
    emittedCentiseconds = nextCentiseconds;
    return delay;
  });
}

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_FRAMES = 1200;
const MAX_DURATION_SECONDS = 60;
const ALLOWED_EDGES = new Set([64, 128, 256, 512]);
const GIF_SIGNATURES = ['GIF87a', 'GIF89a'];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function invalid(): never {
  throw new LocalizedError('legacy.invalid');
}

function limits(): never {
  throw new LocalizedError('legacy.limits');
}

function outputInvalid(): never {
  throw new LocalizedError('legacy.outputInvalid');
}

function settingsInvalid(): never {
  throw new LocalizedError('legacy.settingsInvalid');
}

function hasBytes(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.length &&
    length <= bytes.length - offset
  );
}

function u16le(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 2)) invalid();
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u16be(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 2)) invalid();
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function u24le(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 3)) invalid();
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function u32le(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 4)) invalid();
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function u32be(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 4)) invalid();
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (!hasBytes(bytes, offset, length)) invalid();
  let value = '';
  for (let index = offset; index < offset + length; index++)
    value += String.fromCharCode(bytes[index]);
  return value;
}

function enforceDimensions(width: number, height: number): void {
  if (width <= 0 || height <= 0) invalid();
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) limits();
}

interface ParsedGifFrame extends LegacyGifFrame {
  imageStart: number;
  gcePackedOffset?: number;
  hasControl: boolean;
}

interface ParsedGif extends LegacyGifInfo {
  parsedFrames: ParsedGifFrame[];
  durationKnown: boolean;
  durationCentiseconds: number;
}

function parseGif(bytes: Uint8Array, maxBytes: number): ParsedGif {
  if (bytes.length > maxBytes) limits();
  if (!hasBytes(bytes, 0, 13)) invalid();
  const signature = readAscii(bytes, 0, 6);
  if (!GIF_SIGNATURES.includes(signature)) invalid();

  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  enforceDimensions(width, height);
  const screenPacked = bytes[10];
  let cursor = 13;
  let hasGlobalTable = false;
  if (screenPacked & 0x80) {
    hasGlobalTable = true;
    cursor += 3 * 2 ** ((screenPacked & 7) + 1);
    if (!hasBytes(bytes, 13, cursor - 13)) invalid();
  }

  const frames: ParsedGifFrame[] = [];
  let loop = -1;
  let pendingControl:
    { delay: number; disposal: number; packedOffset: number } | undefined;
  let durationKnown = true;
  let durationCentiseconds = 0;
  let sawTrailer = false;

  const skipSubBlocks = (
    start: number,
    firstBlock?: (blockStart: number, blockLength: number) => void,
  ): number => {
    let position = start;
    let isFirst = true;
    while (true) {
      if (!hasBytes(bytes, position, 1)) invalid();
      const length = bytes[position++];
      if (length === 0) return position;
      if (!hasBytes(bytes, position, length)) invalid();
      if (isFirst) firstBlock?.(position, length);
      position += length;
      isFirst = false;
    }
  };

  while (cursor < bytes.length) {
    const marker = bytes[cursor++];
    if (marker === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (marker === 0x21) {
      if (!hasBytes(bytes, cursor, 1)) invalid();
      const label = bytes[cursor++];
      if (label === 0xf9) {
        if (!hasBytes(bytes, cursor, 1)) invalid();
        const blockSize = bytes[cursor++];
        if (blockSize !== 4 || !hasBytes(bytes, cursor, 5)) invalid();
        const packedOffset = cursor;
        const packed = bytes[cursor];
        const delay = u16le(bytes, cursor + 1);
        cursor += 4;
        if (bytes[cursor++] !== 0) invalid();
        pendingControl = {
          delay,
          disposal: (packed >> 2) & 7,
          packedOffset,
        };
      } else if (label === 0xff) {
        if (!hasBytes(bytes, cursor, 1)) invalid();
        const headerLength = bytes[cursor++];
        if (!hasBytes(bytes, cursor, headerLength)) invalid();
        const application = readAscii(bytes, cursor, headerLength);
        cursor += headerLength;
        cursor = skipSubBlocks(cursor, (blockStart, blockLength) => {
          if (
            (application === 'NETSCAPE2.0' || application === 'ANIMEXTS1.0') &&
            blockLength >= 3 &&
            bytes[blockStart] === 1
          ) {
            loop = u16le(bytes, blockStart + 1);
          }
        });
      } else {
        // Comment, plain-text and unknown extension data all use sub-blocks.
        cursor = skipSubBlocks(cursor);
        if (label === 0x01) pendingControl = undefined;
      }
      continue;
    }
    if (marker !== 0x2c) invalid();
    const imageStart = cursor - 1;
    if (!hasBytes(bytes, cursor, 9)) invalid();
    const left = u16le(bytes, cursor);
    const top = u16le(bytes, cursor + 2);
    const frameWidth = u16le(bytes, cursor + 4);
    const frameHeight = u16le(bytes, cursor + 6);
    const imagePacked = bytes[cursor + 8];
    cursor += 9;
    if (
      frameWidth <= 0 ||
      frameHeight <= 0 ||
      left + frameWidth > width ||
      top + frameHeight > height
    ) {
      invalid();
    }
    let hasLocalTable = false;
    if (imagePacked & 0x80) {
      hasLocalTable = true;
      cursor += 3 * 2 ** ((imagePacked & 7) + 1);
      if (
        !hasBytes(
          bytes,
          cursor - 3 * 2 ** ((imagePacked & 7) + 1),
          3 * 2 ** ((imagePacked & 7) + 1),
        )
      )
        invalid();
    }
    if (!hasGlobalTable && !hasLocalTable) invalid();
    if (!hasBytes(bytes, cursor, 1)) invalid();
    const lzwMinimumCodeSize = bytes[cursor++];
    if (lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) invalid();
    cursor = skipSubBlocks(cursor);

    const control = pendingControl;
    const frame: ParsedGifFrame = {
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      delay: control?.delay ?? 0,
      disposal: control?.disposal ?? 0,
      imageStart,
      gcePackedOffset: control?.packedOffset,
      hasControl: !!control,
    };
    frames.push(frame);
    if (frames.length > MAX_FRAMES) limits();
    if (control) durationCentiseconds += control.delay;
    else durationKnown = false;
    pendingControl = undefined;
  }

  if (!sawTrailer || frames.length === 0) invalid();
  if (
    frames.length > MAX_FRAMES ||
    (durationKnown && durationCentiseconds > MAX_DURATION_SECONDS * 100)
  )
    limits();
  return {
    width,
    height,
    frames: frames.map(
      ({
        left,
        top,
        width: frameWidth,
        height: frameHeight,
        delay,
        disposal,
      }) => ({
        left,
        top,
        width: frameWidth,
        height: frameHeight,
        delay,
        disposal,
      }),
    ),
    loop,
    parsedFrames: frames,
    durationKnown,
    durationCentiseconds,
  };
}

export function inspectLegacyGif(bytes: Uint8Array): LegacyGifInfo {
  const { width, height, frames, loop } = parseGif(bytes, MAX_OUTPUT_BYTES);
  return { width, height, frames, loop };
}

interface ParsedPng extends LegacyInputInfo {
  width: number;
  height: number;
  frames: number;
}

function parseApng(bytes: Uint8Array): ParsedPng {
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  )
    invalid();
  let cursor = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  let declaredFrames = 0;
  let frameControls = 0;
  let plays = 0;
  let durationSeconds = 0;
  let expectedSequence = 0;
  const frameDurationsMs: number[] = [];

  while (cursor < bytes.length) {
    if (!hasBytes(bytes, cursor, 12)) invalid();
    const length = u32be(bytes, cursor);
    const type = readAscii(bytes, cursor + 4, 4);
    const data = cursor + 8;
    if (!hasBytes(bytes, data, length + 4)) invalid();
    const next = data + length + 4;
    if (!sawIhdr && type !== 'IHDR') invalid();

    if (type === 'IHDR') {
      if (sawIhdr || length !== 13) invalid();
      width = u32be(bytes, data);
      height = u32be(bytes, data + 4);
      enforceDimensions(width, height);
      sawIhdr = true;
    } else if (type === 'acTL') {
      if (declaredFrames || sawIdat || length !== 8) invalid();
      declaredFrames = u32be(bytes, data);
      plays = u32be(bytes, data + 4);
      if (!declaredFrames) invalid();
      if (declaredFrames > MAX_FRAMES) limits();
    } else if (type === 'fcTL') {
      if (length !== 26 || !declaredFrames) invalid();
      if (u32be(bytes, data) !== expectedSequence++) invalid();
      const frameWidth = u32be(bytes, data + 4);
      const frameHeight = u32be(bytes, data + 8);
      const left = u32be(bytes, data + 12);
      const top = u32be(bytes, data + 16);
      if (
        frameWidth <= 0 ||
        frameHeight <= 0 ||
        left + frameWidth > width ||
        top + frameHeight > height
      )
        invalid();
      const delayNumerator = u16be(bytes, data + 20);
      const delayDenominator = u16be(bytes, data + 22) || 100;
      const durationMs = (delayNumerator / delayDenominator) * 1000;
      durationSeconds += durationMs / 1000;
      frameDurationsMs.push(durationMs);
      frameControls++;
    } else if (type === 'fdAT') {
      if (
        !declaredFrames ||
        length < 4 ||
        u32be(bytes, data) !== expectedSequence++
      )
        invalid();
    } else if (type === 'IDAT') {
      sawIdat = true;
    } else if (type === 'IEND') {
      if (length !== 0) invalid();
      sawIend = true;
      cursor = next;
      break;
    }
    cursor = next;
  }

  if (
    !sawIhdr ||
    !sawIdat ||
    !sawIend ||
    !declaredFrames ||
    frameControls !== declaredFrames
  )
    invalid();
  if (durationSeconds > MAX_DURATION_SECONDS) limits();
  const loop = plays === 0 ? 0 : plays === 1 ? -1 : plays - 1;
  const delays = quantizeFrameDelays(frameDurationsMs);
  return {
    format: 'apng',
    width,
    height,
    frames: declaredFrames,
    delays,
    loop,
  };
}

interface ParsedWebp extends LegacyInputInfo {
  width?: number;
  height?: number;
  frames?: number;
}

function parseVp8Dimensions(
  bytes: Uint8Array,
  offset: number,
  length: number,
): [number, number] {
  if (length < 10 || !hasBytes(bytes, offset, 10)) invalid();
  if (
    bytes[offset + 3] !== 0x9d ||
    bytes[offset + 4] !== 0x01 ||
    bytes[offset + 5] !== 0x2a
  )
    invalid();
  const width = u16le(bytes, offset + 6) & 0x3fff;
  const height = u16le(bytes, offset + 8) & 0x3fff;
  return [width, height];
}

function parseVp8lDimensions(
  bytes: Uint8Array,
  offset: number,
  length: number,
): [number, number] {
  if (length < 5 || !hasBytes(bytes, offset, 5) || bytes[offset] !== 0x2f)
    invalid();
  const bits =
    bytes[offset + 1] +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3] * 0x10000 +
    bytes[offset + 4] * 0x1000000;
  return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
}

function parseWebp(bytes: Uint8Array): ParsedWebp {
  if (
    bytes.length < 12 ||
    readAscii(bytes, 0, 4) !== 'RIFF' ||
    readAscii(bytes, 8, 4) !== 'WEBP'
  )
    invalid();
  const riffEnd = u32le(bytes, 4) + 8;
  if (riffEnd < 12 || riffEnd > bytes.length) invalid();

  let cursor = 12;
  let width: number | undefined;
  let height: number | undefined;
  let animated = false;
  let loop = -1;
  let sawAnimationControl = false;
  let sawExtendedHeader = false;
  let frameCount = 0;
  let durationMs = 0;
  const frameDurationsMs: number[] = [];
  let sawImage = false;
  let sawStaticBitstream = false;

  while (cursor < riffEnd) {
    if (!hasBytes(bytes.subarray(0, riffEnd), cursor, 8)) invalid();
    const type = readAscii(bytes, cursor, 4);
    const length = u32le(bytes, cursor + 4);
    const data = cursor + 8;
    const paddedLength = length + (length & 1);
    if (
      data + paddedLength > riffEnd ||
      !Number.isSafeInteger(data + paddedLength)
    )
      invalid();
    if (type === 'VP8X') {
      if (sawExtendedHeader || length !== 10) invalid();
      sawExtendedHeader = true;
      const flags = bytes[data];
      animated = !!(flags & 0x02);
      width = 1 + u24le(bytes, data + 4);
      height = 1 + u24le(bytes, data + 7);
    } else if (type === 'ANIM') {
      if (sawAnimationControl || length !== 6) invalid();
      sawAnimationControl = true;
      animated = true;
      loop = u16le(bytes, data + 4);
    } else if (type === 'ANMF') {
      if (length < 16) invalid();
      animated = true;
      const left = u24le(bytes, data) * 2;
      const top = u24le(bytes, data + 3) * 2;
      const frameWidth = 1 + u24le(bytes, data + 6);
      const frameHeight = 1 + u24le(bytes, data + 9);
      const duration = u24le(bytes, data + 12);
      if (
        width === undefined ||
        height === undefined ||
        left + frameWidth > width ||
        top + frameHeight > height
      )
        invalid();
      frameCount++;
      durationMs += duration;
      frameDurationsMs.push(duration);
      sawImage = true;
    } else if (type === 'VP8 ') {
      if (animated || sawStaticBitstream) invalid();
      const [imageWidth, imageHeight] = parseVp8Dimensions(bytes, data, length);
      if (
        (width !== undefined && width !== imageWidth) ||
        (height !== undefined && height !== imageHeight)
      )
        invalid();
      width = imageWidth;
      height = imageHeight;
      sawStaticBitstream = true;
      sawImage = true;
    } else if (type === 'VP8L') {
      if (animated || sawStaticBitstream) invalid();
      const [imageWidth, imageHeight] = parseVp8lDimensions(
        bytes,
        data,
        length,
      );
      if (
        (width !== undefined && width !== imageWidth) ||
        (height !== undefined && height !== imageHeight)
      )
        invalid();
      width = imageWidth;
      height = imageHeight;
      sawStaticBitstream = true;
      sawImage = true;
    }
    cursor = data + paddedLength;
  }

  if (cursor !== riffEnd || !sawImage) invalid();
  if (width !== undefined && height !== undefined)
    enforceDimensions(width, height);
  if (animated) {
    if (
      !sawExtendedHeader ||
      !sawAnimationControl ||
      width === undefined ||
      height === undefined ||
      !frameCount
    )
      invalid();
    if (frameCount > MAX_FRAMES) limits();
    if (durationMs > MAX_DURATION_SECONDS * 1000) limits();
    loop = loop === 0 ? 0 : loop === 1 ? -1 : loop - 1;
    const delays = quantizeFrameDelays(frameDurationsMs);
    return {
      format: 'webp',
      width,
      height,
      frames: frameCount,
      delays,
      loop,
    };
  }
  return { format: 'webp', width, height, loop: -1 };
}

function readEbmlVint(
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean,
): { value: number; length: number } {
  if (!hasBytes(bytes, offset, 1) || bytes[offset] === 0) invalid();
  let mask = 0x80;
  let length = 1;
  while (!(bytes[offset] & mask)) {
    mask >>= 1;
    length++;
    if (length > 8) invalid();
  }
  if (!hasBytes(bytes, offset, length)) invalid();
  let value = keepMarker ? bytes[offset] : bytes[offset] & (mask - 1);
  for (let index = 1; index < length; index++) {
    value = value * 256 + bytes[offset + index];
    if (!Number.isSafeInteger(value)) invalid();
  }
  return { value, length };
}

function isWebm(bytes: Uint8Array): boolean {
  if (
    !hasBytes(bytes, 0, 5) ||
    bytes[0] !== 0x1a ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0xdf ||
    bytes[3] !== 0xa3
  )
    return false;
  const size = readEbmlVint(bytes, 4, false);
  const start = 4 + size.length;
  const end = start + size.value;
  if (end > bytes.length) invalid();
  let cursor = start;
  while (cursor < end) {
    const id = readEbmlVint(bytes, cursor, true);
    cursor += id.length;
    const itemSize = readEbmlVint(bytes, cursor, false);
    cursor += itemSize.length;
    if (itemSize.value > end - cursor) invalid();
    if (id.value === 0x4282)
      return readAscii(bytes, cursor, itemSize.value).toLowerCase() === 'webm';
    cursor += itemSize.value;
  }
  return false;
}

export function inspectLegacyInput(
  bytes: Uint8Array,
  _filename: string,
): LegacyInputInfo {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_INPUT_BYTES)
    limits();
  const signature = hasBytes(bytes, 0, 6) ? readAscii(bytes, 0, 6) : '';
  if (GIF_SIGNATURES.includes(signature)) {
    const gif = parseGif(bytes, MAX_INPUT_BYTES);
    return {
      format: 'gif',
      width: gif.width,
      height: gif.height,
      frames: gif.frames.length,
      delays: gif.frames.map((frame) => frame.delay),
      loop: gif.loop,
    };
  }
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  )
    return parseApng(bytes);
  if (hasBytes(bytes, 0, 4) && readAscii(bytes, 0, 4) === 'RIFF')
    return parseWebp(bytes);
  if (isWebm(bytes)) return { format: 'webm', loop: 0 };
  return invalid();
}

export function normalizeLegacyGif(
  bytes: Uint8Array,
  maxEdge: number,
): Uint8Array {
  if (!ALLOWED_EDGES.has(maxEdge)) settingsInvalid();
  const parsed = parseGif(bytes, MAX_OUTPUT_BYTES);
  if (parsed.frames.length > MAX_FRAMES) limits();
  if (parsed.width > maxEdge || parsed.height > maxEdge) outputInvalid();
  if (
    parsed.parsedFrames.some(
      (frame) =>
        frame.left !== 0 ||
        frame.top !== 0 ||
        frame.width !== parsed.width ||
        frame.height !== parsed.height,
    )
  )
    outputInvalid();

  const insertCount = parsed.parsedFrames.filter(
    (frame) => frame.gcePackedOffset === undefined,
  ).length;
  const output = new Uint8Array(bytes.length + insertCount * 8);
  const defaultControl = new Uint8Array([0x21, 0xf9, 0x04, 0x08, 0, 0, 0, 0]);
  let sourceCursor = 0;
  let outputCursor = 0;
  for (const frame of parsed.parsedFrames) {
    const segmentLength = frame.imageStart - sourceCursor;
    output.set(bytes.subarray(sourceCursor, frame.imageStart), outputCursor);
    if (frame.gcePackedOffset !== undefined) {
      const packedOffset = outputCursor + frame.gcePackedOffset - sourceCursor;
      output[packedOffset] = (output[packedOffset] & 0xe3) | 0x08;
    }
    outputCursor += segmentLength;
    if (frame.gcePackedOffset === undefined) {
      output.set(defaultControl, outputCursor);
      outputCursor += defaultControl.length;
    }
    sourceCursor = frame.imageStart;
  }
  output.set(bytes.subarray(sourceCursor), outputCursor);

  const normalized = inspectLegacyGif(output);
  if (
    normalized.width > maxEdge ||
    normalized.height > maxEdge ||
    normalized.frames.some(
      (frame) =>
        frame.left !== 0 ||
        frame.top !== 0 ||
        frame.width !== normalized.width ||
        frame.height !== normalized.height ||
        frame.disposal !== 2,
    )
  )
    outputInvalid();
  return output;
}

export function setLegacyGifDelays(
  bytes: Uint8Array,
  delays: readonly number[],
): Uint8Array {
  const parsed = parseGif(bytes, MAX_OUTPUT_BYTES);
  if (
    !Array.isArray(delays) ||
    delays.length !== parsed.parsedFrames.length ||
    parsed.parsedFrames.some(
      (frame) =>
        frame.gcePackedOffset === undefined ||
        frame.left !== 0 ||
        frame.top !== 0 ||
        frame.width !== parsed.width ||
        frame.height !== parsed.height ||
        frame.disposal !== 2,
    )
  )
    outputInvalid();
  if (
    delays.some(
      (delay) => !Number.isInteger(delay) || delay < 0 || delay > 65535,
    )
  )
    settingsInvalid();

  const output = bytes.slice();
  for (const [index, frame] of parsed.parsedFrames.entries()) {
    const offset = frame.gcePackedOffset! + 1;
    output[offset] = delays[index] & 0xff;
    output[offset + 1] = delays[index] >>> 8;
  }
  return output;
}

export function legacyOutputName(filename: string): string {
  const leaf = filename.split(/[\\/]/).at(-1) ?? '';
  const withoutExtension = leaf.replace(/\.[^.]*$/, '');
  const safe = withoutExtension
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*\\/]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return `${safe || 'emoji'}.legacy.gif`;
}

export function buildLegacyArgs(
  format: LegacyFormat,
  options: LegacyOptions,
  loop: number,
): string[] {
  if (!['gif', 'webm', 'webp', 'apng'].includes(format)) settingsInvalid();
  if (!options || !ALLOWED_EDGES.has(options.maxEdge)) settingsInvalid();
  if (!Number.isInteger(loop) || loop < -1 || loop > 65535) settingsInvalid();

  const args: string[] = [];
  if (format === 'gif') args.push('-ignore_loop', '1', '-min_delay', '0');
  if (format === 'apng') args.push('-ignore_loop', '1');
  const edge = options.maxEdge;
  const filter =
    `[0:v]scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:flags=lanczos,` +
    `split=2[frames][paletteFrames];[paletteFrames]palettegen=stats_mode=single[palette];` +
    `[frames][palette]paletteuse=new=1[v]`;
  args.push(
    '-i',
    `input.${format}`,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-an',
    '-vsync',
    '0',
    '-frames:v',
    String(MAX_FRAMES + 1),
    '-gifflags',
    '0',
    '-loop',
    String(loop),
    '-fs',
    String(MAX_OUTPUT_BYTES),
    'output.gif',
  );
  return args;
}
