# Building from source

## GUI firmware

On Windows, the combined firmware build uses Node.js, Arduino CLI 1.4.1,
Teensy core 1.61.0 (GCC 11.3.1), CRC32 2.0.0 and ACME 0.97.

Place the tool cache under `build/toolchain/`, or set `MPE_TOOLCHAIN_ROOT`
to an existing cache. It contains `arduino-cli.exe`, the `Arduino15/`
packages and `acme-0.97-r20/acme0.97win/acme/acme.exe`.

From the repository root:

```powershell
.\scripts\build-firmware.ps1
```

The script assembles the C64 desktop, builds the GUI and VM host, then creates
the combined HEX under `build/fw/SD/`. It does not flash hardware.
The two firmware halves have separate link maps; don't substitute a GUI-only
build for the combined image.

See [Source/BuildInfo.md](../Source/BuildInfo.md) for the underlying tools.

## Doom engine

Complete corresponding source is in [Source/DoomEngine](../Source/DoomEngine/).
Run the following from that folder using Node.js
and the Teensy GCC 11.3.1 toolchain:

```powershell
$env:MPE_ARM_PREFIX='C:/path/to/arm-none-eabi-'
node scripts/rebuild-doomvm.mjs output
```

Copy the resulting `output/engine.mvm` to `VMS/DOOMVM/` on the SD card.
No game data is needed to rebuild the engine.
The source manifest pins the original build date so the result matches the
released engine, not a binary that changes with today's date.

## C64 launcher

From the repository root, run `node scripts/build-doom-client.mjs`.
The universal PAL/NTSC launcher is written under `build/doom-client/SD/`.
Copy both `DOOMVM.crt` and `VMS/DOOMVM/client.crt` to the SD card together.

The current launcher includes [bounded status-read recovery](DOOM-STATUS-RECOVERY.md).
That page includes the receiver tests; it does not require a firmware rebuild.

Shared client and adapter source is under `Source/VM/` in this repository.
Local build products belong under `build/`; downloads belong under `vms/`.

## F1 and RAM2 video checks

With MinGW C++ available, run `node scripts/test-color-f1.mjs` from the root.
Set CXX if your compiler is not in the default MinGW64 location.
The shared-host tests also check RAM2 source bounds and RAM1-only workspace.
These tests do not require game data and do not replace hardware testing.

## NESVM

The released NES engine has its own complete corresponding source and
rebuild instructions in [Source/NESEngine](../Source/NESEngine/).
The C64 launcher source and instructions are in
[Source/NESClient](../Source/NESClient/). Both can be rebuilt without game ROMs.
See the [NESVM build record](NESVM-build.json) for the released hashes.
