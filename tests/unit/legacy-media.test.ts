import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEGACY_OPTIONS,
  buildLegacyArgs,
  inspectLegacyInput,
  inspectLegacyGif,
  legacyOutputName,
  normalizeLegacyGif,
} from '../../web/src/lib/legacy-media';

const gif = (offset = 0) => new Uint8Array([
  ...new TextEncoder().encode('GIF89a'), 2, 0, 1, 0, 0x80, 0, 0,
  255, 0, 0, 0, 0, 255,
  0x21, 0xff, 11, ...new TextEncoder().encode('NETSCAPE2.0'), 3, 1, 3, 0, 0,
  0x21, 0xf9, 4, 4, 2, 0, 0, 0,
  0x2c, offset, 0, 0, 0, 2 - offset, 0, 1, 0, 0, 2, 2, 0x44, 1, 0,
  0x3b,
]);

describe('legacy conversion policy and GIF structure', () => {
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
    expect(inspectLegacyInput(gif(), 'renamed.webp')).toMatchObject({ format: 'gif', width: 2, height: 1, frames: 1, loop: 3 });
    expect(() => inspectLegacyInput(new TextEncoder().encode('<html>oops</html>'), 'image.gif')).toThrow();
    expect(() => inspectLegacyInput(gif().subarray(0, 14), 'broken.gif')).toThrow();
  });

  it('verifies full frame rectangles and makes transparent frames independent', () => {
    const original = gif();
    const normalized = normalizeLegacyGif(original, 128);
    expect(inspectLegacyGif(normalized)).toMatchObject({ width: 2, height: 1, frames: [{ left: 0, top: 0, width: 2, height: 1, delay: 2, disposal: 2 }], loop: 3 });
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
