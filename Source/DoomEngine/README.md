# DoomVM 1.2.1 engine source

This folder contains the modified GBADoom engine used by the Doom VM.
The engine is GPL-2.0-or-later; see `COPYING.GPL-2.0` and the notices in each file.

`core/` contains the engine. `Source/VM/doom/` contains the Teensy adapter,
video, audio and resource handling. `source-manifest.json` lists the build
inputs and identifies the upstream version.

## Build

Install Node.js and the Teensy GCC 11.3.1 toolchain. From this folder:

```powershell
$env:MPE_ARM_PREFIX='C:/path/to/arm-none-eabi-'
node scripts/rebuild-doomvm.mjs output
```

Copy `output/engine.mvm` to `VMS/DOOMVM/` on the SD card. No game data is
needed to build the engine.

This release adds optional music lookup under the virtual cartridge root and
an equivalent CRC lookup. The published source rebuilds the released engine
byte for byte with the pinned compiler and date in source-manifest.json.

The focused adapter test needs MinGW C++ and no game data:

```powershell
g++ -std=c++17 -O2 -static -I core/include tests/doom_music_test.cpp -o doom_music_test.exe
./doom_music_test.exe
```

It covers both music roots and video-standard headers, 4,096 CRC comparisons,
short reads, corruption, audio scheduling and older video-profile fallbacks.
