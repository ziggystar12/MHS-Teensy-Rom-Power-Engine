# GGVM 1.2.24 - direct ROM startup fix

[Runtime download](../vms/GGVM.zip) · [Build record](GGVM-build.json)

This update holds audio until the first display has been acknowledged. It fixes
SID-before-BASE error 09 when a `.gg` file is launched directly from the browser.
The picker, F1 display, ROM cache, boot speech and battery-save format remain compatible.

Requires MPE firmware **V1.1.13 or newer** on TeensyROM+ Fab 0.4 / Teensy 4.1.
This is a development candidate. Host/core/client checks pass; physical C64
speed, sound, picture quality and SD timing still require testing.

Extract `GGVM.zip` to the SD root. Place your own `.gg` cartridges in
`/VMS/GGVM/ROMS`, then launch `GGVM.crt`. You can also select a `.gg` file
directly in the firmware browser. No game ROMs are included in this ZIP.
For the updated Travis text browser, use MPE firmware 1.2.24; the MHS GUI
firmware 1.2.23 also supports this package and direct `.gg` routing.

The picker lists up to **256 games** per ROM folder, sorted by filename.
Up/Down moves one game and Left/Right moves 17 entries. If more than 256
cartridges are found, a message reports that only the first 256 are listed.

The supported file limit is **1 MiB (1,048,576 bytes)** after any verified
512-byte copier header. The first profile supports power-of-two sizes from
32 KiB, GG headers and the standard Sega mapper. Known other mappers are
rejected. Codemasters, link cable, SMS mode, FM and save states are not offered.
A `.gg` extension alone does not establish compatibility with every cartridge.

Cartridges use a 512 KiB RAM cache with 16 KiB banks read from SD on demand.
This supports larger ROMs without extra PSRAM. Read delays can affect speed;
the module preserves emulation time debt and yields after cache misses.

F1 preserves all **160x144 Game Gear pixels**, two C64 pixels wide and with
28 black rows above and below. The native 12-bit palette is reduced to RGB332
before shared C64 color conversion. F1 is the only enabled display mode.
Sound is a mono PSG-to-SID approximation; noise shares one of three SID voices.
NTSC SID pitch is the current baseline; PAL sound needs separate validation.

The 2026-09-07 candidate adds **Sonic 2's boot-time "SEGA" speech**. It captures
the cartridge's volume stream, buffers a 4-bit 8 kHz clip, and holds the logo
while playing it through the SID. This adds a short boot delay. No separate
audio file is needed. Replace both engine and client from this ZIP together.
The player includes a volume boost for 8580 SIDs; physical loudness and quality
still need testing on both SID models.

This is a bounded boot-voice feature: one clip in the first eight emulated
seconds, using the three constant-tone/channel-3-volume method seen in Sonic 2.
Clips over roughly two seconds are skipped. It does not provide general sampled
effects, mixed music/speech or streaming audio. Controls resume after playback.

| Control | Action |
| --- | --- |
| Joystick port 2 / cursors | Move or choose a cartridge |
| Port-2 Fire | Game Gear button 1 / launch selected cartridge |
| C64GS pin-9 POTX | Game Gear button 2 |
| Space | Game Gear button 2 |
| Return | Start / launch selected cartridge |
| Shift + Return | Save and return to the cartridge picker |

Shifted cursors remain Up/Left. Release the menu chord before selecting again.
Return to the picker before powering off or resetting back to the main GUI.

Battery RAM is checkpointed around every five seconds and on return to the
picker. `/VMS/GGVM/SAVES/<ROM-CRC32>.s0` and `.s1` hold alternate 32 KiB SRAM
generations with header/payload checksums. A failed save blocks loading another
cartridge; Fire retries. Keep power on until the save succeeds. Abrupt power
loss can lose changes since the last checkpoint. These are cartridge battery
saves, not snapshots of the running machine. Foreign `.sav` files are untouched.

For updates, replace the supplied runtime files together and preserve ROMS and
SAVES. Keep a backup of SAVES. Firmware is distributed separately.

Sonic The Hedgehog 2 (World), 512 KiB, reached Underground Zone Act 1 in the
host run with movement/fire input. Picker checks cover slot 256, page/wrap
navigation, full filenames and return/relaunch. Synthetic tests execute code in bank 63 of
a 1 MiB cartridge and stress all banks with only five cache slots. Neither
result establishes physical playability or broad game compatibility. The speech
receiver reproduces the captured 12,282 samples exactly in functional tests;
independent VICE checks run the CIA/SID player on NTSC 6581/8580 and PAL 8580.

See the package's `NOTICES.md` for component licenses. This release provides the
runtime package only; component license rights remain unchanged. The
[build record](GGVM-build.json) documents matching engine and client rebuilds
from a retained developer source snapshot.
