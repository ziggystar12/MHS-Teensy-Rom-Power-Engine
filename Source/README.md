# Source and building

## MPE runtime extension

[MPE RFE integration preview](../rfe/README.md) provides MIT-licensed launch
integration code, the proposed memory contract and standalone image-validation
tools. It does not contain the private Prism+ implementation or a loadable `.trx`
yet. The same compiled runtime is intended for both the GUI and text firmware.

## NESVM

[NESEngine](NESEngine/README.md) contains the corresponding NESVM 1.2.1 engine
source and standalone rebuild instructions. It rebuilds without game ROMs
or a firmware build. Keep the matching client from the runtime download.

[NESClient](NESClient/) is an older public client snapshot under its original
terms. It does not build the current Prism+ client.

## DoomVM

[DoomEngine](DoomEngine/) contains the corresponding DoomVM 1.2.1 engine
source. From that folder, use Node.js and GNU Arm Embedded 11.3.1:

```powershell
$env:MPE_ARM_PREFIX='C:/path/to/arm-none-eabi-'
node scripts/rebuild-doomvm.mjs output
```

The resulting `output/engine.mvm` replaces `VMS/DOOMVM/engine.mvm`.
The source manifest pins the build date; no game data is needed to rebuild.

The public C64 launcher can be built from the repository root with
`node scripts/build-doom-client.mjs`. Copy both generated launcher copies
from `build/doom-client/SD/` together.

## Game Boy and Game Gear

Complete matching source and build tools are available separately:

- [GBVM 1.2.24 source](https://github.com/ziggystar12/TeensyROM/raw/refs/heads/codex/mpe-prism-plus-update/mpe/review/console-sources/GBVM-1.2.24-source.zip)
- [GGVM 1.2.24 source](https://github.com/ziggystar12/TeensyROM/raw/refs/heads/codex/mpe-prism-plus-update/mpe/review/console-sources/GGVM-1.2.24-source.zip)

Extract the archive and use Windows, Node.js 24 or later and GNU Arm
Embedded 11.3.1. Set `MPE_ARM_PREFIX` as above, then run
`node scripts/package-gbvm.mjs build/rebuilt` or
`node scripts/package-ggvm.mjs build/rebuilt`. Choose a fresh output folder.

## GUI source

The retained `Teensy/` and `C64/` directories are the earlier public GUI
source, not the current Prism+ firmware source. Their original licenses
remain effective. [Toolchain reference](BuildInfo.md).

To build that retained GUI source on Windows, place the tool cache under
`build/toolchain/` or set `MPE_TOOLCHAIN_ROOT` to it. The cache contains
`arduino-cli.exe`, `Arduino15/`, and `acme-0.97-r20/acme0.97win/acme/acme.exe`.
Run `.\scripts\build-firmware.ps1` from the repository root; its combined
output is written under `build/fw/SD/`. This does not rebuild the current
Prism+ firmware.

New Prism+ implementation source remains private.
[Component licenses and source boundaries](../docs/PRISM-PLUS-LICENSE.md).
