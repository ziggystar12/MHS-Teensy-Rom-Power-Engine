# NESVM 1.2.0 corresponding engine source

This standalone snapshot rebuilds engine.mvm with SHA-256
`e924ef3402fd0cdd87d8021507996edeb50a9d5c73da710ca9f0b0bb6396d934`.
The compiled source and build script are exported unchanged from commit
`2cbde248ef6f67f8f487ca11bfa1bb1d0ee15561`. Documentation is adapted for this source layout.

## Build

Install Node.js and GNU Arm Embedded 11.3.1 (the compiler distributed with
Teensy 1.61). No Arduino libraries, ROM, firmware build, signing key, or
hardware flashing are needed. The toolchain is not included.

Set MPE_ARM_PREFIX to an absolute path ending in arm-none-eabi-.
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

The result is build/relinked/engine.mvm. Copy it over VMS/NESVM/engine.mvm
on the SD card, retaining the matching client from the NESVM 1.2.0 runtime
download. Use MPE GUI firmware 1.2.23 or later. Modified engines require no
signing or firmware relinking. Keep the ABI and memory limits in the build
script compatible with the installed host and client.

## Scope and licenses

The snapshot includes the NES module, CPU/PPU core and adapter, shared NES
ROM/input/audio/video code, ABI definitions, required generic video headers,
font, linker script, and standalone build script. It contains no ROM,
toolchain, firmware, runtime binary, or new Prism+ host/receiver implementation.
The engine negotiates display modes through the published ABI.

- Nofrendo and its MPE adapter: GNU Library General Public License version 2;
  see [license](engine/nofrendo/COPYING) and [provenance](engine/nofrendo/README.md).
- The chips reference CPU header retains its zlib/libpng license;
  see [provenance](engine/native-nes/vendor/chips/UPSTREAM.md).
- The font retains its public-domain attribution in vm/nes/font8x8.h.
- Original repository code uses the [MIT license](LICENSE.md), subject to
  the component-specific notices above. The Prism+ restricted license does
  not apply to this corresponding engine source snapshot.

SOURCE-MANIFEST.json records original commit paths and SHA-256 hashes,
plus the documentation-only addition. A fresh build from this exported
source was verified byte-for-byte against the distributed engine.
