# Cycle-stepped CPU provenance

- Upstream: https://github.com/floooh/chips
- Revision: `ca7d7ddd3ba77b48685d24120cf413ea53786767`
- File: `chips/m6502.h`, copied unchanged on 2026-09-04.
- SHA-256: `c8fb5979be406283db60ae5864da601cebb27dad2b114187a6dea2f90f8925dc`
- License: zlib/libpng; the complete copyright and license notice is preserved in the header.

The locally applied placement patch is preserved alongside this header.
The chips reference CPU is a compile-time dependency of shared NES types.
The released engine uses Nofrendo for CPU/PPU execution; unused reference-core
code is removed by the linker. The portable test core calls `m6502_tick`
once per CPU cycle with `bcd_disabled=true` for the RP2A03. PPU, APU, DMA
and mapper behavior are separate NESVM components with their own tests.
