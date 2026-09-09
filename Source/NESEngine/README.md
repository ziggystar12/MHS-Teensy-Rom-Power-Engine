# NESVM corresponding engine source

This source snapshot rebuilds the public NESVM engine with SHA-256
`8ad32d74846974bd539031190559d7cb76df2e098b92011b99f73a3dc646f2b0`.
The compiled source and build script are exported unchanged from commit
`10d27cd0cb6e4a3991850c14ea8a9225f2c1bc48`.
Documentation is adapted for this standalone source layout.

## Build

Install Node.js and GNU Arm Embedded 11.3.1 (the compiler distributed with
Teensy 1.61). No Arduino libraries, ROM, firmware build, signing key, or
hardware flashing are needed. The toolchain is not included.

Set `MPE_ARM_PREFIX` to the absolute path ending in `arm-none-eabi-`.
PowerShell example, from this source directory:

```powershell
$env:MPE_ARM_PREFIX = 'C:/toolchain/arm/bin/arm-none-eabi-'
node scripts/build-nes-core.mjs build/relinked
Get-FileHash build/relinked/engine.mvm -Algorithm SHA256
```

On Linux/macOS:

```sh
MPE_ARM_PREFIX=/opt/toolchain/arm/bin/arm-none-eabi- node scripts/build-nes-core.mjs build/relinked
sha256sum build/relinked/engine.mvm
```

The result is `build/relinked/engine.mvm`. Copy it over
`VMS/NESVM/engine.mvm` on the SD card, retaining the matching client from
the runtime download. Use the firmware requirement in that download's
README. Modified engines need no signing or firmware relinking.

## Scope and licenses

This snapshot includes the NES module, its CPU/PPU core and adapter, shared
NES ROM/input/audio/video code, ABI definitions, required generic video
header, font, linker script, and standalone build script. No ROM, toolchain,
firmware binary, other VM engine, or runtime binary is included.

- Nofrendo and its MPE adapter: GNU Library General Public License version 2;
  see [license](engine/nofrendo/COPYING) and [provenance](engine/nofrendo/README.md).
- The shared chips reference CPU header retains its zlib/libpng license;
  see [provenance](engine/native-nes/vendor/chips/UPSTREAM.md).
- The font retains its public-domain attribution in `vm/nes/font8x8.h`.
- Original repository code uses the [MIT license](LICENSE.md), subject to
  the component-specific notices above.

`SOURCE-MANIFEST.json` records original commit paths and SHA-256 hashes,
plus hashes of the files distributed in this snapshot. It identifies the
documentation-only adaptations.
