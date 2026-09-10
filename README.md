# MHS TeensyROM Power Engine

Visit [MeanHamster.com](https://MeanHamster.com) for more of our projects and developments.

Support MPE development: [Buy me a coffee](https://buymeacoffee.com/ziggystar12).

**MHS Power Engine (MPE) is the system we created for the TeensyROM+ cartridge
to run our MPE Cartridge VM format directly on the Teensy processor.** Our
firmware includes that platform alongside our custom C64 desktop GUI.

MPE turns the cartridge into a programmable computing platform for the C64.
Downloadable VM engines use the Teensy's ARM processing power, while the
Commodore 64 provides the display, SID sound, keyboard and joystick. DoomVM
is our first public example of what this approach makes possible.

Requires TeensyROM+ v0.4 with a Teensy 4.1. No extra PSRAM is needed.
The same Doom download works on PAL and NTSC machines.

TeensyROM hardware and Travis's original firmware:
[SensoriumEmbedded/TeensyROM](https://github.com/SensoriumEmbedded/TeensyROM/tree/main).
For Doom, use our MPE-enabled firmware below; stock upstream firmware is separate.

**TR+ is required for our current MPE VMs, including DoomVM.** MPE uses its full
bus-mastering DMA to transfer display data directly into C64 memory. Original
TeensyROM v0.2/v0.3 is not supported by this VM implementation; the proposed
stock-interface firmware also requires TR+ hardware for VMs.

## The platform

MHS developed the MPE system and MPE Cartridge VM package format: the firmware
host, module loader, shared services and C64 communication that let our VM
engines run from SD on the cartridge. A package brings together a familiar
`.crt` launcher, a C64 client, an `engine.mvm` module and a manifest describing
the module's requirements.

Open the launcher on your C64 and MPE loads the engine onto the Teensy. The
engine runs there and exchanges graphics, sound and input with its C64 client.
Compatible engines can be delivered as new SD packages using the same host;
new platform capabilities can still require a firmware update.

This shared execution platform is our contribution, and it works independently
of the desktop interface. We are also contributing [MPE support for Travis's
original TeensyROM interface](https://github.com/SensoriumEmbedded/TeensyROM/pull/20).
That firmware integration is a draft under review and still needs physical
testing; it uses the same DoomVM package and MPE contract.

**DoomVM and NESVM are available publicly.** Other VMs remain in development.

## Downloads

- [GUI firmware 1.2.6](firmware/MPE_Firmware-V1.2.6.hex)
- [DoomVM 1.2](vms/DOOMVM.zip)
- [NESVM 1.1.1](vms/NESVM.zip) — centered NUFLIX F5, improved greens, mappers 0/1/2/3/4/7/11 and cartridge saves
  ([setup and controls](docs/NESVM.md))

VMs and firmware have separate version numbers: DoomVM 1.2 pairs with
firmware 1.2.6. Use the same current firmware for NESVM. VM ZIPs contain
runtime files, with firmware downloaded separately.

Firmware 1.2.6 includes Travis's latest TeensyROM updates and Final Cartridge
III support. It retains the graphical Clock, repaired Appearance/Input pages,
NUFLIX display support and MHS colour fitting for Doom F1. The status bar uses
solid colours. The two-button startup flasher has been removed; the normal
firmware updater remains. Install both downloads for the new Doom picture.
F7 Sharp, controls, sound and game data are unchanged. Keep existing music.

See the [release notes](docs/FIRMWARE-1.2.6.md), or use the
[1.2.6 downloads](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/releases/tag/v1.2.6).

## Install

1. Copy the firmware file to your SD card. Install it through the GUI's
   firmware updater, then restart.
2. Extract `DOOMVM.zip` to the root of the SD card.
3. Open `DOOMVM.crt` from the desktop.

The download includes the engine, launcher and ready-to-use `doom1.gbd` from
**Doom shareware 1.9 (the free demo)**. Music is optional; gameplay and sound
effects work without music files. See [controls and optional music](docs/DOOM.md).

For NESVM, extract `NESVM.zip` to the SD card root and launch `NESVM.crt`,
or select a `.nes` file in the GUI. Keep your existing ROMs and saves.
The ZIP includes the authorized Crossbow demo; add compatible NTSC mapper
0/1/2/3/4/7/11 ROMs to `/VMS/NESVM/ROMS/`. NESVM 1.1.1 requires firmware 1.2.6 or later.
F5 now centers the native 256-pixel width, fits the visible 224 rows into 200,
and tracks changed cells to reduce conversion work. F5 green tones are improved
across games. Mapper 1/4 saves remain in `/VMS/NESVM/SAVES/`.
SID sound is approximate. [Controls, display modes and compatibility](docs/NESVM.md).

## What's included

The GUI provides the desktop, file browser, settings and firmware updater.
Doom now follows a four-level route: **E1M1 → E1M4 → E1M5 → E1M8**, with
keyboard or joystick controls, SID sound effects and optional SID music.
Oversized maps are skipped automatically. Saving is not supported.
The added levels pass host tests; physical gameplay testing is still needed.

Hold Commodore + Control and press F1, F3, F5 or F7 to change Doom's display.
F1 uses multicolor, F7 is sharp, and F3/F5 offer additional colour detail.
Reset returns to the desktop.

## Source

GUI and firmware source is in `Source/`. Shared VM services, the C64 client
and Doom adapters are in `Source/VM/`. Complete corresponding Doom engine source
is in [Source/DoomEngine](Source/DoomEngine/). NESVM engine source is in
[Source/NESEngine](Source/NESEngine/) and its launcher source in
[Source/NESClient](Source/NESClient/). Source stays separate from runtime ZIPs.
[Build instructions](docs/BUILDING.md).

## Credits

The MPE system, MPE Cartridge VM format, custom GUI and TeensyROM+ integration
are developed by MHS. TeensyROM hardware and the original firmware were created
by Travis Smith / Sensorium Embedded; this project builds on his
[TeensyROM](https://github.com/SensoriumEmbedded/TeensyROM) work.
Our DoomVM integration uses the [GBADoom](https://github.com/doomhack/GBADoom)
engine, building on the work of its authors and the original Doom creators.
The F1 colour converter is developed by MHS. Advanced display support uses
[NUFLIX Studio](https://github.com/cobbpg/nuflix-studio) by Patai Gergely;
its MIT notice is included with the display source.
Original copyright notices and licences are included with the source.
NESVM uses Matthew Conte's Nofrendo, ported through Jean-Marc Harvengt's
MCUME; its GNU Library GPL v2 licence and notices accompany the download
and [corresponding source](Source/NESEngine/).
