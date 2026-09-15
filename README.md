# MHS TeensyROM Power Engine

MHS Power Engine runs downloadable virtual machines on TeensyROM+, with the
Commodore 64 providing the display, SID sound and controls. The firmware
includes a C64 desktop GUI.

Requires **TeensyROM+ v0.4 with a Teensy 4.1**. No extra PSRAM is required.

## Downloads

| Download | Guide |
| --- | --- |
| [GUI firmware 1.2.23](firmware/MPE_Firmware-V1.2.23.hex) | [Install and use the firmware](firmware/README.md) |
| [NESVM 1.2.1](vms/NESVM.zip) | [NES setup, controls and compatibility](docs/NESVM.md) |
| [DoomVM 1.2.1](vms/DOOMVM.zip) | [Doom setup and controls](docs/DOOM.md) |
| [GBVM 1.2.24](vms/GBVM.zip) | [Game Boy and Game Boy Color](docs/GBVM.md) |
| [GGVM 1.2.24](vms/GGVM.zip) | [Game Gear](docs/GGVM.md) |

Install firmware **1.2.23**, then extract your chosen VM ZIP to the SD root.
Keep your existing ROMs, game data and saves. Open the VM's `.crt` launcher,
or select a supported `.nes`, `.gb`, `.gbc`/`.gc` or `.gg` file directly.

Firmware and VMs have separate version numbers. NESVM includes the authorized
Crossbow demo; DoomVM includes Doom shareware. Supply your own compatible
Game Boy and Game Gear ROMs.

[Download checksums](SHA256SUMS.txt) · [Latest VM versions](vms/latest.json) ·
[Desktop shortcuts](docs/DESKTOP-SHORTCUTS.md)

## MHS Prism+

Prism+ brings detailed 320×200 C64 pictures to NESVM. It keeps a complete
picture visible while preparing the next display bank, reuses unchanged
regions, and refines settled pictures. Select it with **Ctrl + Commodore + F5**.
[Prism+ features and benefits](docs/MHS-PRISM.md).

DoomVM uses its own display modes. GBVM and GGVM use their F1 display.

## Source and licensing

New MHS Prism+ implementation source stays private and is distributed as
compiled code. Existing component licenses and earlier grants remain intact.
[License details](docs/PRISM-PLUS-LICENSE.md) · [Source availability](Source/README.md).

## Credits

TeensyROM hardware and original firmware are by Travis Smith /
[Sensorium Embedded](https://github.com/SensoriumEmbedded/TeensyROM).
MHS develops the MPE platform, desktop and VM integrations. Component credits
and licenses accompany each VM package.

[MeanHamster.com](https://MeanHamster.com) ·
[Support development](https://buymeacoffee.com/ziggystar12)
