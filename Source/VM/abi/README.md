# Native VM interface

The GUI loads a VM from SD. Firmware supplies files, timing, input, video and
sound transport; the VM supplies the game engine. Doom uses this interface.

A package contains a six-line manifest: VM1, package ID, content extension,
module filename, client filename and END. The registry selects a package from
its manifest rather than a built-in list of engines.

Launching a VM resets into the small host firmware. Reset returns to the GUI.
Modules are trusted native code, not sandboxed programs.

## Memory

| Region | Use |
| --- | --- |
| RAM1 code below 0x18000 | Host code |
| RAM1 code 0x18000–0x2ffff | VM code, 96 KiB |
| RAM1 data below 0x20014000 | Host state and heap |
| RAM1 data 0x20014000–0x20043fff | VM data and workspace, 192 KiB |
| RAM1 data 0x20044000–0x2004ffff | Shared stack, 48 KiB |
| RAM2 | VM memory, 512 KiB |

Doom uses profile 1: the upper 96 KiB of RAM2 holds read-only constants,
leaving 416 KiB for game memory. This doesn't change the code, workspace or
stack reservations. No PSRAM is required.

The image header specifies the ABI, sizes, entry point and required services.
The loader validates the header, bounds and payload before executing it.
File operations reject paths outside the package's allowed storage.

Output packets remain unchanged until acknowledged, including retransmissions.
Video conversion is owned by firmware. See the structures and constants in
[VMABI.h](../../Teensy/MinimalBoot/Common/VMABI.h).
