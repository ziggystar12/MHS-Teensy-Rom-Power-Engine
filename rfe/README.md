# MPE RFE integration preview 0.1.0-dev

Public integration code for moving MPE into a separately installed TeensyROM+
Runtime Firmware Extension. The GUI and text firmware are intended to load the
same MHS-built runtime, including compiled Prism+. The Prism+ implementation
source and private runtime builder are not part of this kit.

This preview includes the decoded launch adapter, startup integration reference,
image validators, tests and proposed memory contract. **It is not an installable
`.trx`, and it does not add an extension loader to existing firmware.**

## Use this kit

Node.js 24 or later is sufficient for the standalone image-contract tests:

```powershell
node --test rfe/tests/contract.test.mjs
node rfe/validate.mjs path/to/development-host.bin
node rfe/validate.mjs path/to/development-host.hex
```

The tests use synthetic images. The optional linked-image test runs when
`RFE_HOST_HEX` names an actual development host HEX. A successful image check
establishes its startup envelope and partition bounds; it does not establish
compatibility with a loader or successful hardware execution.

The five files under `host/` are the exact vendor-side integration reference:

- `LaunchAdapter.h` validates a decoded request, discovers/preflights the VM
  package and admits a prepared launch once. Its includer supplies the existing
  `VmRegistry::Launch`, `vm_crc32`, `FLASHMEM` and `MinBootInd_FromMin` definitions.
- `RuntimeAdapter.h` binds that adapter to the existing SD, registry and VM-host
  services. It requires those services from the vendor host; it is not a public
  replacement for the host implementation.
- `Entry.h` and `EntryImpl.h` define startup and return integration. Startup
  requires a decoded selection and the already-consumed boot indicator. The
  entry admits one attempt per reset and rejects replay before touching the bus.
- `DevelopmentBinding.cpp` deliberately supplies no launch request until the
  loader's EEPROM contract is defined. It is not a working launch binding.

These headers do not build a standalone firmware image from this public kit.
The intended distribution is a compiled MPE extension plus public integration
interfaces; consumers do not need Prism+ implementation source to use it.

## Supported vendor launch routes

| Selection | Vendor runtime behavior |
| --- | --- |
| `.nes`, `.gb`, `.gbc`, `.gc`, `.gg` | Discover the matching package and retain the complete selected ROM path. |
| VMH1 `.crt` launcher | Select the named VM with an empty content path for its own menu. |
| `.MPE` or legacy MGC1 `.crt` | Validate and start the self-contained container, retaining its physical save identity. |

Ordinary CRT handling remains the core firmware's responsibility. Both VMH1 and
MGC1 signatures must be routed correctly before choosing MPE. The adapter uses
physical SD paths and does not create a temporary `/VMS/launch.vml` file.

## Build evidence and current integration status

The private ARM build at source revision
`a3f5eb479b1ed3a2840defa496b6c665334f9b0c` produced a validated **313,344-byte**
raw host at **0x60760000**. It ends before the 4 KiB metadata sector at
**0x607BF000**. Existing ABI-2 module memory is retained: 96 KiB code, 192 KiB
data and a 512 KiB guest arena. The host keeps a 16 KiB heap and 48 KiB stack.
The build, launch and startup checks passed; physical hardware is untested.
See [verification.json](verification.json) for the bounded results and hashes.

As checked on 19 September 2026, upstream `main` is
[`0e2b0a43`](https://github.com/SensoriumEmbedded/TeensyROM/commit/0e2b0a431b896638b91a504c257767b01aabe96e).
The newer `RFE_implementation` branch at
[`8e8aa3ae`](https://github.com/SensoriumEmbedded/TeensyROM/commit/8e8aa3ae3b3f36857d762a911d2acf8eb9a5dd32)
adds an Installed Extensions menu placeholder, not the loader or package codec.

A loadable `.trx` needs the authoritative package header, field sizes and CRC
rules. A runnable host also needs the shared bus export, exact EEPROM launch
binding and agreed crash-memory ownership. Revision 3's stated 128-byte header
does not account for all its listed fields, so this kit defines no provisional
wire encoding. [target.json](target.json) records the pending interfaces.

The core's proposed crash record overlaps the current VM guest arena. Its final
ownership must be agreed without silently reducing existing VM memory. Hardware
installation, reset/menu return, saves, controls, audio and PAL/NTSC behavior are
acceptance work after those interfaces are connected.

## Licensing

This kit's integration code is [MIT licensed](LICENSE.txt). It contains no new
Prism+ implementation, generated renderer code, private build tree, ELF, or
runtime binary. Existing component rights remain unchanged. Future compiled
runtime distributions will include matching component notices and the source
and relinking materials required by their component licenses, while retaining
private Prism+ implementation source.
