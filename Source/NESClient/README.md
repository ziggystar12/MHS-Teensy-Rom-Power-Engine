# NESVM C64 client source

This source snapshot rebuilds the C64 client in the public NESVM runtime
download. Its SHA-256 is
`c664db0e05c7840aab80f4845c025068b50f111cef3fd3d2457c855ebc7423bd`.
The source files are exported unchanged from commit
`145f4b7646a4666d9ee841e05627df89bcdab72b`.

## Build

Install Node.js 24 or later. From this source directory, run:

```sh
node nes/tools/build_nesvm_terminal.mjs --output-prg build/client/nesvm.prg --output-boot-bank build/client/boot.bin --manifest build/client/client.json
node nes/tools/build_nesvm_cartridge.mjs --id NESVM --boot-bank build/client/boot.bin --output build/client/client.crt --manifest build/client/cartridge.json
```

The result is `build/client/client.crt` (24,688 bytes). In PowerShell, check
it with `Get-FileHash build/client/client.crt -Algorithm SHA256`; on Linux,
use `sha256sum build/client/client.crt`.

Copy the rebuilt file to `VMS/NESVM/client.crt` on the SD card and also to
the root as `NESVM.crt`. Retain the engine and other files from the runtime
download. The matching engine source is distributed alongside this
snapshot in `Source/NESEngine`. Use the firmware requirement in the runtime
download's README.

The JavaScript sources include the assembler and the shared C64 client
helpers used by NESVM. No external assembler, ROM, firmware compilation,
or hardware flashing is needed to build the client. No game media or
other VM engine is included in this snapshot.

## License and provenance

See [LICENSE.md](LICENSE.md) for the MHS MIT license. The NUFLIX display
template by Patai Gergely has its retained MIT license in
[nes/client/nuflix/LICENSE](nes/client/nuflix/LICENSE); see the adjacent README
for pinned upstream provenance. Both licenses accompany generated clients.
`CLIENT-SOURCE.json` records each original source path, size, and SHA-256.
