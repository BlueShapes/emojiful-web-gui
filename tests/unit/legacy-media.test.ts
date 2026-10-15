import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LEGACY_OPTIONS,
  buildLegacyArgs,
  inspectLegacyInput,
  inspectLegacyGif,
  legacyOutputName,
  normalizeLegacyGif,
} from '../../web/src/lib/legacy-media';

const gif = (offset = 0) =>
  new Uint8Array([
    ...new TextEncoder().encode('GIF89a'),
    2,
    0,
    1,
    0,
    0x80,
    0,
    0,
    255,
    0,
    0,
    0,
    0,
    255,
    0x21,
    0xff,
    11,
    ...new TextEncoder().encode('NETSCAPE2.0'),
    3,
    1,
    3,
    0,
    0,
    0x21,
    0xf9,
    4,
    4,
    2,
    0,
    0,
    0,
    0x2c,
    offset,
    0,
    0,
    0,
    2 - offset,
    0,
    1,
    0,
    0,
    2,
    2,
    0x44,
    1,
    0,
    0x3b,
  ]);

describe('legacy conversion policy and GIF structure', () => {
  it('rejects excessive dimensions, frame counts, duration and file size before decoding', () => {
    const oversizedGif = gif();
    oversizedGif[6] = 1;
    oversizedGif[7] = 16; // 4097px
    expect(() => inspectLegacyInput(oversizedGif, 'large.gif')).toThrowError(
      expect.objectContaining({ key: 'legacy.limits' }),
    );
    const apng = readFileSync(
      new URL('../fixtures/legacy/animated.apng', import.meta.url),
    );
    apng.writeUInt32BE(1201, apng.indexOf('acTL') + 4);
    expect(() => inspectLegacyInput(apng, 'too-many.apng')).toThrowError(
      expect.objectContaining({ key: 'legacy.limits' }),
    );
    const webp = readFileSync(
      new URL('../fixtures/legacy/animated.webp', import.meta.url),
    );
    webp.writeUIntLE(60_001, webp.indexOf('ANMF') + 20, 3);
    expect(() => inspectLegacyInput(webp, 'long.webp')).toThrowError(
      expect.objectContaining({ key: 'legacy.limits' }),
    );
    expect(() =>
      inspectLegacyInput(new Uint8Array(32 * 1024 * 1024 + 1), 'large.gif'),
    ).toThrowError(expect.objectContaining({ key: 'legacy.limits' }));
  });
  it('accepts extended static WebP', () => {
    const staticWebp = readFileSync(
      new URL('../fixtures/legacy/static-alpha.webp', import.meta.url),
    );
    expect(inspectLegacyInput(staticWebp, 'static.webp')).toMatchObject({
      format: 'webp',
      width: 8,
      height: 8,
    });
  });
  it('preserves cumulative fractional timing', () => {
    const fractional = readFileSync(
      new URL('../fixtures/legacy/fractional.apng', import.meta.url),
    );
    const info = inspectLegacyInput(fractional, 'fractional.apng');
    expect(info.frames).toBe(60);
    expect(info.delays?.reduce((sum, delay) => sum + delay, 0)).toBe(100);
  });
  it('defaults to a 128px bounding box and disables delta GIF encoding', () => {
    expect(DEFAULT_LEGACY_OPTIONS.maxEdge).toBe(128);
    const args = buildLegacyArgs('gif', DEFAULT_LEGACY_OPTIONS, 3);
    expect(args).toContain('-gifflags');
    expect(args[args.indexOf('-gifflags') + 1]).toBe('0');
    expect(args.join(' ')).toContain('128');
    expect(args).toContain('-an');
    expect(args[args.indexOf('-loop') + 1]).toBe('3');
    expect(() => buildLegacyArgs('webm', { maxEdge: 0 }, 0)).toThrow();
    expect(() => buildLegacyArgs('webm', { maxEdge: 8192 }, 0)).toThrow();
  });

  it('identifies file contents rather than trusting extensions and preserves GIF metadata', () => {
    expect(inspectLegacyInput(gif(), 'renamed.webp')).toMatchObject({
      format: 'gif',
      width: 2,
      height: 1,
      frames: 1,
      loop: 3,
    });
    expect(() =>
      inspectLegacyInput(
        new TextEncoder().encode('<html>oops</html>'),
        'image.gif',
      ),
    ).toThrow();
    expect(() =>
      inspectLegacyInput(gif().subarray(0, 14), 'broken.gif'),
    ).toThrow();
  });

  it('verifies full frame rectangles and makes transparent frames independent', () => {
    const original = gif();
    const normalized = normalizeLegacyGif(original, 128);
    expect(inspectLegacyGif(normalized)).toMatchObject({
      width: 2,
      height: 1,
      frames: [{ left: 0, top: 0, width: 2, height: 1, delay: 2, disposal: 2 }],
      loop: 3,
    });
    expect(original).toEqual(gif());
    expect(() => normalizeLegacyGif(gif(1), 128)).toThrow();
    expect(() => normalizeLegacyGif(gif(), 1)).toThrow();
  });

  it('gives each output an explicit GIF filename without path traversal', () => {
    expect(legacyOutputName('Happy Cat.WEBM')).toBe('Happy Cat.legacy.gif');
    expect(legacyOutputName('cat.gif')).toBe('cat.legacy.gif');
    expect(legacyOutputName('../../cat.apng')).not.toMatch(/[\\/]/);
  });
});
