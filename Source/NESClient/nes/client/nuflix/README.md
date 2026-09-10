# NESVM MHS Prism receiver support

The F5 receiver uses the existing MHS Prism double-buffer handshake. NESVM
keeps Standard F1, the native-pixel F3 crop, and F7 hires. Its scatter layout
excludes `$7a00-$7fff`, preserving the ordinary bitmap at `$6000-$7f3f`.

`double-video.mjs` and `scatter-receiver.mjs` retain the shared MHS receiver
implementation. `emitter.mjs` contains only the small MHS bootstrap assembler.
The NES overlay and mode-request protocol live in `nes/tools/nes_nuflix.mjs`.
These sources contain no DOS runtime or game media.

`nufli-template.bin` is the unmodified display template from NUFLIX Studio by
Patai Gergely, pinned at commit `b33f4d93875a3fdbabaf52216811962847fdfcf1`:
<https://github.com/cobbpg/nuflix-studio>.
Its MIT license is retained in `LICENSE` and must accompany generated clients.
The firmware supplies the converted picture, raster program, mirrored display
bank and scheduling adaptation. This directory supplies the receiving client.
