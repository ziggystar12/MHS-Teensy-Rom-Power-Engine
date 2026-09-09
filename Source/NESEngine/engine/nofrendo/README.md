# Nofrendo MPE adapter (2026-09-04)

CPU/PPU source: Jean-Marc Harvengt's MCUME, `MCUME_teensy41/teensynofrendo`,
pinned commit `27f6b906aca34e06d6647bdca8215e25f8d20aa5`.
Upstream: https://github.com/Jean-MarcHarvengt/MCUME/tree/27f6b906aca34e06d6647bdca8215e25f8d20aa5/MCUME_teensy41/teensynofrendo

Nofrendo copyright 1998-2000 Matthew Conte; GNU **Library** General Public
License version 2, in [COPYING](COPYING). Original legends are retained.
`machine.cpp` / `machine.h` are the MPE adapter, also under that license.
The unmodified imported headers are `bitmap.h`, `log.h`, `noftypes.h` and
`nes_ppu.h`; local changes to the other imported files are listed below.

## Local port changes

- `nes6502.c`: RAM-mirrored/16-bit wrapped instruction reads, zero-page word
  wrap, byte-safe cross-bank word fetches, mapped DMA reads, unsigned cycle
  accounting, and mapper read-modify-write dummy bus writes. Instruction-based
  CPU execution remains upstream Nofrendo.
- `nes6502.h`: unsigned elapsed-cycle counter avoids signed long-run overflow.
- `nes_ppu.c`: MPE guards exclude standalone allocation, drivers, input,
  palette setup and debug viewers; bounded 1 KiB page pointers; eight leading
  scanline guard pixels; wrap-safe sprite-zero comparison; OAMDATA reads.
- Adapter owns singleton lifecycle, safe CHR-ROM writes, palette RAM/read
  buffering, mapper 0/1/2/3/4/7/11 banking, discrete-board bus conflicts, DMA, controller
  serialization, APU/SID state, NMI edges, and instruction-overrun credit.
  A run never returns more cycles than requested. All PPU scanlines are
  evaluated even while a presentation frame is frozen; no fake sprite-zero
  shortcut changes gameplay with video backpressure.

This is a scanline-approximate core, not a cycle-accurate replacement. CPU I/O
within a line, NMI races, odd-frame dot skip and mid-line effects are not all
exact. The NTSC cartridge profiles are:

| Mapper | Board profile | PRG ROM | CHR | Cartridge RAM |
| --- | --- | --- | --- | --- |
| 0 | NROM | 16/32 KiB | 8 KiB ROM or RAM | None |
| 1 | Conventional MMC1B/C | 16–256 KiB | 8–128 KiB ROM or 8 KiB RAM | Zero or 8 KiB |
| 2 | UxROM | 32–256 KiB | 8 KiB RAM | None |
| 3 | CNROM | 16/32 KiB | 8–32 KiB ROM | None |
| 4 | Conventional MMC3B/C | 32–256 KiB | 8–128 KiB ROM or 8 KiB RAM | Zero or 8 KiB |
| 7 | AxROM | 32–256 KiB | 8 KiB RAM | None |
| 11 | Color Dreams | 32/64/128 KiB | 8–128 KiB ROM | None |

All variable ROM sizes are powers of two. MMC1/MMC3 support mirroring and
RAM protection; their legacy headers default to 8 KiB PRG RAM. NES 2.0
submappers 1 (no bus conflicts) and 2 (AND bus conflicts) are accepted for
mappers 2/3/7. Legacy mapper 2/3 use AND conflicts; legacy mapper 7 uses no
conflicts. Other nonzero submappers, MMC1A/extended MMC1 wiring, MMC6,
mixed CHR ROM/RAM boards and four-screen mirroring are excluded.

MMC3 IRQs use a modeled PPU fetch-address timeline, including background,
8x8/8x16 sprite and empty sprite fetches, plus CPU $2006/$2007 address changes.
A12 rising edges are filtered by three M2 falling edges spent low, with
MMC3B/C reload, zero-latch and IRQ acknowledgement behavior. The adapter
advances this model in CPU batches of at most eight requested cycles, with
instruction overrun, independently of scanline rendering. This preserves
address-transition ordering but does not provide cycle-exact raster timing,
sprite-evaluation quirks or every MMC3 board revision.

Mapper references: [MMC1](https://www.nesdev.org/wiki/MMC1),
[MMC3](https://www.nesdev.org/wiki/MMC3),
[NES 2.0 submappers](https://www.nesdev.org/wiki/NES_2.0_submappers).

DMC timer, DAC/shift state, mapped sample fetches, loop/restart and IRQ behavior run with four-cycle
DMA accounting. Cycle-exact DMA overlap and joypad glitches are not modeled.
DMC samples are not mixed into the SID. Existing SID sound is retained; MCUME's I2S driver/APU mixer is
not imported. The old chips/dot core remains a test reference, not linked
into the released NES module. No private ROM is included in source packages.

## Rebuilding or modifying the linked library

The repository and retained development source snapshots contain the module
source, this license, linker script and `scripts/build-nes-core.mjs`. SD
downloads contain runtime files and notices only. Install Node.js
and GNU Arm Embedded 11.3.1 (the Teensy 1.61 compiler). Set `MPE_ARM_PREFIX`
to the absolute compiler prefix ending in `arm-none-eabi-`, then run:

```
node scripts/build-nes-core.mjs build/relinked
```

From the repository or source snapshot root, this rebuilds `build/relinked/engine.mvm`.
Use that file with the matching client and firmware listed in the package README.
No signing key, firmware relink, ROM or hardware flashing is required to
rebuild. Modification and reverse engineering for debugging modifications
to this library are permitted under its license. Full repository tests:
`vm/tests/nofrendo_test.cpp`, `module_test.cpp`, `nes_timing_test.cpp`.
