# GGVM 1.2.24 — Game Gear

[Download GGVM.zip](../vms/GGVM.zip) · [Download checksums](../vms/SHA256SUMS.txt)

Use [GUI firmware 1.2.23](../firmware/README.md) on TeensyROM+ v0.4 with a
Teensy 4.1. No extra PSRAM is required. Firmware is a separate download.

## Install and launch

Extract the complete ZIP to the SD root. Replace the engine and both launcher
copies together, preserving your existing ROMS and SAVES folders.
Put your own compatible `.gg` files in `/VMS/GGVM/ROMS/`, then open `GGVM.crt`
to use the picker. You can also open a `.gg` file directly in the GUI SD browser.
No game ROMs or Sega BIOS are included.

The picker lists up to **256 games**, sorted by filename. Up/Down moves one
entry; Left/Right moves 17. A message reports when only the first 256 are listed.

## Controls and display

| Control | Action |
| --- | --- |
| Joystick port 2 / cursors | Move or choose a cartridge |
| Port-2 Fire | Button 1 / launch the selected cartridge |
| Space / C64GS pin-9 second button | Button 2 |
| Return | Start / launch the selected cartridge |
| Shift + Return | Save and return to the picker |

Shifted cursors remain Up/Left. Release the menu chord before selecting again.
F1 shows all 160×144 pixels at double width, with 28 black rows above and below.
Colors are converted to the C64 palette. F1 is the only gameplay display mode.
Sound is a mono PSG-to-SID approximation; PAL pitch still needs validation.

Sonic 2's boot-time “SEGA” speech is supported without a separate audio file.
The logo pauses briefly during playback, then controls resume. This feature
handles one short boot clip; it does not provide general sampled effects,
mixed music/speech or streaming audio. Clips over roughly two seconds are skipped.

## Cartridge compatibility

Standard Sega-mapper Game Gear cartridges are supported in power-of-two sizes
from 32 KiB to **1 MiB**, excluding a verified 512-byte copier header if present.
A 512 KiB RAM cache reads additional banks from SD; read delays can affect speed.
Codemasters cartridges, Master System mode, link cable, FM and save states are
unsupported. A `.gg` extension alone does not establish cartridge compatibility.

## Preserve your saves

Battery RAM is saved approximately every five seconds and when you return to
the picker. **Return to the picker before resetting or powering off.**
A reset or power loss can lose changes since the last checkpoint.
If saving fails, keep power on and press Fire to retry. Loading another game
is blocked until the save succeeds.

Back up the whole `/VMS/GGVM/SAVES/` folder. Each ROM uses alternating
`<ROM-CRC32>.s0` and `.s1` files containing checked 32 KiB battery-RAM generations.
These preserve cartridge saves, not snapshots of the running machine.
Other emulators' `.sav` files are untouched. Keep ROMS and SAVES when updating.

Physical C64 speed, sound, picture quality, controller behavior and SD timing
remain subject to testing; a supported cartridge format is not a playability guarantee.
Keep the package's `NOTICES.md` and component licenses: the adapter retains
GNU GPL version 2 or later terms; TotalSMS and the scheduler retain MIT terms.
