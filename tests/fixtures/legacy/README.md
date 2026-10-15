# Synthetic legacy media fixtures

These tiny test files contain only colored squares generated for this project.
No user media or downloaded emoji are included. Their source canvas is 8×8:
red in the upper-left 4×4, blue in the upper-right, then green in the lower-left,
with a transparent background. The large static GIF is a red 256×128 canvas.

- `optimized.gif`: omggif `GifWriter`, four-color palette, transparent index 3,
  background index 3, 4×4 offset frames with disposal 2, delays 7/13/19 cs,
  and GIF repeat count 3. Exercises genuine partial frames.
- `opaque-background.gif`: ImageMagick `-layers Optimize`, disposal 3 with an
  opaque red GIF background and repeat count 2 (3 total plays). Its outside
  pixels should stay red after conversion.
- `animated.webp`: ImageMagick lossless WebP, 70/130/190 ms, infinite looping.
  Its opaque ANIM background hint must not flatten transparent emoji pixels.
- `static-alpha.webp`: lossy WebP with VP8X/ALPH/VP8 chunks.
- `animated.apng`: FFmpeg `-framerate 10 -pix_fmt rgba -plays 2`.
- `fractional.apng`: FFmpeg `color=red:s=4x4:r=60:d=1`, RGBA APNG, infinite
  looping. 60 frames of 1/60 s must sum to 100 GIF centiseconds after rounding.
- `transparent.webm`: FFmpeg `-framerate 10 -c:v libvpx-vp9 -pix_fmt yuva420p
-lossless 1 -auto-alt-ref 0`.

Browser tests decode each output frame independently with omggif, checking
rectangle dimensions, disposal, transparency, colors, stale pixels, timing and
loop metadata. The production conversion engine does not use omggif.
