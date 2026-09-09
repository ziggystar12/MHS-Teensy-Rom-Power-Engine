# Doom engine source

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
