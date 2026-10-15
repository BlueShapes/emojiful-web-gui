# legacy conversion: engine licenses and corresponding source

The editor is MIT licensed. Its separately loaded conversion engine is the
unmodified single-thread `@ffmpeg/core` 0.12.10 distribution, under
GPL-2.0-or-later, compressed with gzip for transport. Compression does not change
the engine. The editor's source is available in this project's repository.

- [GNU GPL version 2](COPYING.GPL-2.0.txt)
- [GNU GPL version 3](COPYING.GPL-3.0.txt), available under the “or later” option
- [Engine package source and build instructions](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1)
- [Engine source archive](https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz)
- [Exact upstream build recipe and dependency versions](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile)
- [FFmpeg n5.1.4 source](https://github.com/FFmpeg/FFmpeg/tree/n5.1.4)
- [FFmpeg source archive](https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n5.1.4.tar.gz)

The build recipe above identifies the corresponding linked source: x264
(`ffmpegwasm/x264`, branch `4-cores`), x265 (`ffmpegwasm/x265`, `3.4`),
libvpx (`ffmpegwasm/libvpx`, `v1.13.1`), LAME (`ffmpegwasm/lame`, `master`),
Ogg (`ffmpegwasm/Ogg`, `v1.3.4`), Theora (`ffmpegwasm/theora`, `v1.1.1`),
Opus (`ffmpegwasm/opus`, `v1.3.1`), Vorbis (`ffmpegwasm/vorbis`, `v1.3.3`),
zlib (`ffmpegwasm/zlib`, `v1.2.11`), libwebp (`ffmpegwasm/libwebp`, `v1.3.2`),
FreeType (`ffmpegwasm/freetype2`, `VER-2-10-4`), FriBidi (`fribidi/fribidi`,
`v1.0.9`), HarfBuzz (`harfbuzz/harfbuzz`, `5.2.0`), libass
(`libass/libass`, `0.15.0`), and zimg (`sekrit-twc/zimg`, `release-3.0.5`).
These repositories and their build scripts are linked directly by the recipe.
Each component retains its own copyrights and license notices in its source.

The engine is provided without warranty. It is downloaded only when conversion
starts; selected media files remain on the user's device. No CDN is used at
runtime. `scripts/prepare-legacy-engine.mjs` reproduces the deployed gzip asset
from the pinned npm package and records its SHA256 in `generated/manifest.json`.
The source commit above is the release commit for core 0.12.10; wrapper-library
version tags are different and must not be used to identify the core source.
