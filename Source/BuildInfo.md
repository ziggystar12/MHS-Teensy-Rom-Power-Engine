# Firmware build tools

Use the [combined firmware build](../docs/BUILDING.md) for MHS Power Engine.
It assembles the C64 desktop and builds both Teensy firmware halves.
A GUI-only Arduino build does not include the VM host.

The build uses Node.js, Arduino CLI 1.4.1, Teensy core 1.61.0 with GCC 11.3.1,
CRC32 2.0.0 and ACME 0.97. The Teensy core supplies SD, SdFat, SPI,
USBHost_t36, NativeEthernet, FNET, EEPROM, Time and Bounce.

Tool sources:

- [Arduino CLI](https://arduino.github.io/arduino-cli/)
- [Teensy tools](https://www.pjrc.com/teensy/td_download.html)
- [ACME assembler](https://sourceforge.net/projects/acme-crossass/)

The original C64 component build scripts remain under `C64/`.
See [C64 source notes](C64/README.md) if working on an individual component.
