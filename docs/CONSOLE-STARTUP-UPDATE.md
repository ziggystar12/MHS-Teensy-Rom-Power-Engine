# Console startup fixes and Travis's .MPE integration

Release **v1.2.23-r3** updates **NESVM 1.2.1**, **GBVM 1.2.24** and
**GGVM 1.2.24**. GUI firmware **1.2.23** and its Prism+ host,
and **DoomVM 1.2.1** are unchanged. VM versions are independent of firmware
versions. [Downloads](../README.md#downloads) · [Checksums](../SHA256SUMS.txt).

## Direct ROM startup

Opening a `.nes` file directly presets the ROM path and skips the picker.
The old NES adapter could publish a changed SID packet while catching up,
before uploading its first BASE picture. The C64 correctly rejected it with
`STAGE 03 ERROR 09`, `SID OR END BEFORE BASE IMAGE`, packet type `02`.
Going through the picker had already established a BASE, masking the bug.

NESVM 1.2.1 submits that initial picture before catch-up audio. Related
early-audio paths in GBVM and GGVM now wait for the first picture's completion
acknowledgement. After that, normal audio updates remain enabled.

| Selected SD file | Required installed package |
| --- | --- |
| `.nes` | NESVM 1.2.1 |
| `.gb`, `.gbc`, `.gc` | GBVM 1.2.24 |
| `.gg` | GGVM 1.2.24 |

Extract the complete matching runtime ZIP to the SD root. Replace its engine
and client together and preserve your ROMs and saves. Then select the ROM in
the firmware SD browser, or open `NESVM.crt`, `GBVM.crt` or `GGVM.crt` and use
its picker. A filename extension does not guarantee cartridge compatibility.

## Self-contained .MPE games in the text firmware

[Travis integration PR #23](https://github.com/SensoriumEmbedded/TeensyROM/pull/23)
now supplies **MPE integration 1.2.24**, built on TeensyROM 0.8.0.8 with the
existing compiled host library 1.2.23. It adds the text-browser and minimal-boot
dispatch that were missing from the previous handoff. All console extensions
above are included. The original text interface, ordinary cartridges and
Travis's RAM-saving updater choice remain in place.

A properly packed MGC1 `.MPE` file contains its engine, C64 client and game
content. Put that single file on SD and select it; no separate `/VMS` install
is needed. Older MGC1 `.CRT` containers also work. Renaming an ordinary ROM
or CRT does not create an MPE container. Embedded files are read-only; games
that use host save services write sidecar files next to the cartridge. Keep
the cartridge's filename and its sidecars together when preserving saves.
This launch path requires physical SD, rather than USB or a virtual disk image.

Existing self-contained games embed their own engines. Installing a newer
`/VMS` package does not replace the engine inside a previously packed game;
repack it with the corrected engine where applicable. The GUI already has
the MGC1 loading path, so this change does not require a new GUI firmware.

## Verification

The NES regression runs the real module with the staged host scheduler and
indexed-video implementation, then replays its actual packet and DMA journal
through the generated C64 receiver. All 16 corrected cases pass: direct and
picker boot, PAL and NTSC, Standard and Prism+, and prompt and delayed
handshakes. The 16 pre-fix controls reproduce error 09 in all eight direct
cases while all eight picker cases succeed.

GBVM/GGVM checks cover 12 adapter/core/file-service startup cases and 20
PAL/NTSC C64 receiver cases, including error-09 controls. Their host video
handshake is simulated. All three published engines rebuild exactly from
the corresponding source snapshots. The NES source remains public; GB/GG
developer snapshots are retained separately from the public runtime downloads.
These checks establish the tested startup order;
physical gameplay, audio, controller timing and save persistence still need
C64 acceptance testing.

The text integration also checks actual browser routing, all four released
package preflights, `.MPE` parsing and boot dispatch, compressed virtual reads
and sidecar-save operations. Its stock and stock-plus outputs remain byte for
byte identical to the upstream baseline. Detailed firmware evidence and build
instructions accompany PR #23.

Prism+ retains its two display banks, changed-area updates, motion path and
settled-picture refinement. Its new implementation is still supplied as
compiled code. This update changes the VM startup order and the public text
integration; it does not publish private Prism+ implementation source.
