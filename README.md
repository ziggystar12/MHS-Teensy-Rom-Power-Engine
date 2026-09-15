# MHS TeensyROM Power Engine

**MHS Power Engine (MPE) runs downloadable virtual machines on the TeensyROM+
cartridge, with the Commodore 64 providing the display, SID sound and controls.**
Our firmware combines the MPE platform with a C64 desktop GUI.

Visit [MeanHamster.com](https://MeanHamster.com) for our other projects.
Support development: [Buy me a coffee](https://buymeacoffee.com/ziggystar12).

Requires **TeensyROM+ v0.4 with a Teensy 4.1**. No extra PSRAM is required.
Original TeensyROM v0.2/v0.3 hardware does not provide the DMA needed by these VMs.
Hardware and original firmware: [SensoriumEmbedded/TeensyROM](https://github.com/SensoriumEmbedded/TeensyROM).

## Downloads

| Download | What's new | Guide |
| --- | --- | --- |
| [GUI firmware 1.2.23](firmware/MPE_Firmware-V1.2.23.hex) | Remembered drives, desktop shortcuts, direct NES ROM launch, .MPE games and the current Prism+ host | [Firmware notes](docs/FIRMWARE-1.2.23.md) |
| [NESVM 1.2.1](vms/NESVM.zip) | Fixes direct-ROM startup error 09; retains Prism+ and sound updates during picture uploads | [Setup and controls](docs/NESVM.md) |
| [DoomVM 1.2.1](vms/DOOMVM.zip) | Updated adapter and matching runtime/source package | [Setup and controls](docs/DOOM.md) |
| [GBVM 1.2.24](vms/GBVM.zip) | Fixes direct `.gb`, `.gbc` and `.gc` startup; retains SD bank caching and battery saves | [Setup and controls](vms/README.md#gbvm--game-boy-and-game-boy-color) |
| [GGVM 1.2.24](vms/GGVM.zip) | Fixes direct `.gg` startup; retains battery saves and Sonic 2 boot speech | [Setup and controls](vms/README.md#ggvm--game-gear) |

Use firmware **1.2.23** with these current VM packages. Firmware and VMs have
separate version numbers. Each VM has one complete runtime ZIP; firmware is a
separate download. Existing ROMs, game files, music and saves should be preserved.

[Startup fix and Travis integration](docs/CONSOLE-STARTUP-UPDATE.md) · [Release asset checksums](SHA256SUMS.txt) · [Release manifest](docs/RELEASE-1.2.23-r3.json)

[Game Boy and Game Gear download checksums](vms/SHA256SUMS.txt)

## MHS Prism+

**Prism+ is our next-generation C64 graphics system for MPE games.** It presents
320×200 pictures using the C64's 16-color palette, with a fast update path for
movement and additional fitting when the picture settles. Two display banks
keep the previous complete picture visible while the next is prepared.

Prism+ reuses unchanged regions and sends changed picture data in bounded
transfers. This reduces repeated conversion and upload work. NESVM also sends
sound updates while a picture is uploading, keeping music from waiting for the
entire transfer. The result is richer game graphics with less work spent on
parts of the screen that have not changed.

NESVM selects Prism+ with **Ctrl + Commodore + F5**. Its native 256-pixel width
is centered in the 320-pixel canvas. Standard and Pan and scan remain available.
Performance varies with the game and scene; the C64's palette and raster rules
still apply. [How Prism+ works and what it improves](docs/MHS-PRISM.md).

**DoomVM uses its own four display modes and does not use Prism or Prism+.**
Other MPE VMs remain in development and are not included in these downloads.

## Install and play

1. Copy the firmware HEX to the SD root, install it through the GUI updater,
   restart, and confirm **1.2.23** in About.
2. Extract the chosen VM ZIP to the SD root, retaining the existing ROM and save folders.
3. Open the chosen launcher: `NESVM.crt`, `DOOMVM.crt`, `GBVM.crt` or `GGVM.crt`.
   With the matching VM installed, supported `.nes`, `.gb`, `.gbc`, `.gc` and `.gg`
   files can also open directly from the SD browser, including nested folders.

NESVM includes the authorized Crossbow demo. Supply your other compatible NTSC
NES games; supported mappers are 0, 1, 2, 3, 4, 7 and 11. Mapper 1/4 cartridge
saves remain in `/VMS/NESVM/SAVES/`. Its current display choices are Standard
(Ctrl + Commodore + F1), Pan and scan (F3 with the same modifiers), and Prism+
(F5 with the same modifiers). F7 Sharp was removed following a hardware crash.

DoomVM includes converted Doom shareware 1.9 data and follows
**E1M1 → E1M4 → E1M5 → E1M8**. Music is optional. Its own F1/F3/F5/F7 display
modes remain, selected with Ctrl + Commodore. Saving is not supported.

The GUI now remembers Main, SD or USB across reboots. Select an SD/USB item and
choose **File > Add Desktop** or **Shift+S** to add a shortcut. Up to seven links
fit beside the built-in icons; deleting a desktop shortcut preserves its target.
[Desktop guide](docs/DESKTOP-SHORTCUTS.md).

## Source and licensing

The new MHS-owned Prism+ implementation is distributed as compiled code;
its source stays private. Its [license](LICENSE-PRISM-PLUS.txt) permits use and
unmodified redistribution, with prior-license and LGPL exceptions preserved.
[Component boundaries and source availability](docs/PRISM-PLUS-LICENSE.md).

Complete corresponding [NES engine source](Source/NESEngine/) and
[Doom engine source](Source/DoomEngine/) remain available under their existing
licenses. GBVM and GGVM are supplied here as runtime packages with their
component notices; their corresponding sources accompany
[Travis's developer handoff](https://github.com/ziggystar12/TeensyROM/tree/codex/mpe-prism-plus-update/mpe/review/console-sources).
[Engine and legacy GUI build instructions](docs/BUILDING.md).

The older public GUI and NES client source snapshots remain available under
their original terms. They do not build the new Prism+ release. Earlier MIT
grants are unchanged.

## Credits and validation

MHS developed the MPE host, VM package format, desktop integration and Prism+
renderer. TeensyROM hardware and original firmware are by Travis Smith /
Sensorium Embedded. [MPE integration in Travis's text firmware](https://github.com/SensoriumEmbedded/TeensyROM/pull/20)
has been merged upstream; that firmware has its own feature and release choices.
The current GUI/Prism+ download here is a separate build.
[PR #23](https://github.com/SensoriumEmbedded/TeensyROM/pull/23) supplies the
current compiled host and `.MPE` support for Travis's text firmware.

NESVM uses Matthew Conte's Nofrendo,
ported through Jean-Marc Harvengt's MCUME, under the GNU Library GPL v2.
DoomVM uses [GBADoom](https://github.com/doomhack/GBADoom) and its Doom ancestry;
engine and shareware notices accompany the package.

Source rebuilds, automated tests and package hashes are recorded with each
release. The accepted NES test build has user gameplay feedback; that does not
establish universal compatibility or a hardware FPS multiplier. Firmware 1.2.23
desktop/media and button behavior still require physical acceptance testing.
