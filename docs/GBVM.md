# GBVM 1.2.24 — Game Boy and Game Boy Color

[Download GBVM.zip](../vms/GBVM.zip) · [Download checksums](../vms/SHA256SUMS.txt)

Use [GUI firmware 1.2.23](../firmware/README.md) on TeensyROM+ v0.4 with a
Teensy 4.1. No extra PSRAM is required. Firmware is a separate download.

## Install and launch

Extract the complete ZIP to the SD root. Replace the engine and both launcher
copies together, preserving your existing ROMS and SAVES folders.
Put your own compatible `.gb`, `.gbc` or `.gc` files in `/VMS/GBVM/ROMS/`,
then open `GBVM.crt` to use the picker. It lists up to 128 ROMs.
You can also open a ROM directly in the GUI SD browser, including nested folders.
`.gc` is an alias for Game Boy Color. No game ROMs or saves are included.

## Controls and display

| Control | Action |
| --- | --- |
| Joystick port 2 / cursors | Move or select a cartridge |
| Port-2 Fire | A / launch the selected cartridge |
| Space / C64GS pin-9 second button | B |
| Return | Start |
| Standalone Shift | Select |
| Start + Select | Save and return to the picker |

Shifted cursors remain Up/Left and do not also press Select.
F1 shows all 160×144 pixels at double width, with 28 black rows above and below.
Original Game Boy uses four shades; Game Boy Color colors fit the C64 palette.
F1 is the only gameplay display mode; Ctrl + Commodore + F3/F5/F7 do not change it.
Sound is a SID approximation, without exact Game Boy PCM or stereo reproduction.

## Cartridge compatibility

ROMs up to **2 MiB** use SD bank caching. Supported cartridge types are 00,
MBC1 01/02/03, MBC3 0F/10/11/12/13 and MBC5 19/1A/1B.
Cartridge RAM may be 0, 8 or 32 KiB. MBC1 ROMs above 512 KiB require 0/8 KiB RAM.
Other RAM sizes, MBC1M multicarts and other mapper types are unsupported.
An extension alone does not establish compatibility with every game.
MBC3 clocks advance during emulation and are included in battery saves;
they pause in the picker and while powered off.

## Preserve your saves

Changed battery RAM is saved approximately every five seconds and when you
return to the picker. **Return to the picker before resetting or powering off.**
A reset or power loss can lose recent changes.
If saving fails, keep power on and press Fire to retry. Loading another game
is blocked until the save succeeds.

Back up the whole `/VMS/GBVM/SAVES/` folder. Each ROM uses alternating
`<ROM-CRC32>.s0` and `.s1` files with length and checksum validation.
A damaged nonempty slot falls back to its valid partner; if neither is valid,
loading stops. Empty slots contain no progress and are ignored.
Other emulators' `.sav` files are not imported or overwritten. ROMs are read-only.
Battery saves do not capture the full running machine state.

Physical C64 speed, audio quality, controller behavior and full-game compatibility
remain subject to testing; a supported cartridge format is not a playability guarantee.
GBVM retains GNU GPL version 2 or later terms, without warranty. Keep the
package's `NOTICES.md` and `LICENSE-gnuboy.txt` with the runtime files.
