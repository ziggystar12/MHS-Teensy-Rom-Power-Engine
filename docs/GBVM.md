# GBVM 1.2.24 — direct ROM startup fix

[Runtime download](../vms/GBVM.zip) · [Build record](GBVM-build.json)

This update holds audio until the first display has been acknowledged. It fixes
SID-before-BASE error 09 when a ROM is launched directly during startup catch-up.
The picker, F1 display, 2 MiB cache and battery-save format remain compatible.

Requires MPE firmware **V1.1.9 or newer** for the new packet recovery service.
Update firmware and extract this download to the SD root. Put your
own `.gb`, `.gbc` and `.gc` ROMs in `/VMS/GBVM/ROMS`, then launch `GBVM.crt`.
For direct browser launch of all three extensions, use the Travis text MPE
firmware 1.2.24 or the MHS GUI firmware 1.2.23 or newer. The `.gc` extension is
treated as the Game Boy Color alias.
No commercial ROMs are supplied or copied from the local test folder.

ROMs up to **2 MiB (2,097,152 bytes)** are supported through SD bank caching.
Large ROMs stay on SD; GBVM keeps 16 KiB banks in RAM and loads missing banks
as needed. No firmware update is required if V1.1.9 or newer is installed.
The previous window-layer and packet-recovery fixes remain included.

It retains the first battery-save fix reported when starting Mario 2.
The save writer now follows the Teensy's SD file-position rules. The exact
512 KiB non-DX `ZELDA.GB` passes the same first-save/reload regression tests.
No manual save-file deletion is needed.

Default F1 preserves all 160 x 144 Game Boy pixels: each is two C64 pixels
wide, with 28 black rows above and below. Original GB retains four shades;
GBC colors are reduced by the shared firmware renderer. F1 is the only
supported gameplay mode; Commodore + Control + F3/F5/F7 do not change it.
This release retains the established F1 display.
These controls do not change AGI's existing presentation.

Joystick port 2/cursors select and move; Fire = A; the C64GS pin-9 POTX
button = B; Space = B; Return = Start; Shift = Select. Start + Select returns
to the picker. Shifted cursors are
Up/Left, not simultaneous Select. The picker supports up to 128 ROMs.

Supported cartridges: type 00; MBC1 types 01/02/03; MBC3 types 0F/10/11/12/13;
MBC5 types 19/1A/1B. Cartridge RAM may be 0, 8 or 32 KiB. MBC1 ROMs above
512 KiB require 0/8 KiB RAM, matching standard cartridge wiring. Other RAM
sizes, MBC1M multicarts and other mapper types are not supported.
This is not all-ROM compatibility.
Sound is a SID approximation, not exact Game Boy PCM/stereo.

Mario 2 and original Zelda/Link's Awakening (512 KiB, MBC1 + 8 KiB battery RAM)
passed local core/module tests, as did Kirby's Dream Land (256 KiB, MBC1).
Mario 1 and the supplied 256 KiB Pac-Man GBC remain regression-tested.
The supplied Oracle of Ages (2 MiB), Pokemon Crystal (2 MiB), Super Mario
Bros. Deluxe (1 MiB) and Super Mario Land 2 GBC (1 MiB) passed 90-second
local runs with input, SD cache eviction, and battery save/reload tests.
Cached and fully resident execution matched video, SID output, SRAM and
clock state. Captures show Zelda name entry, Crystal's opening dialogue and
characters, and both Mario games in play. Full-game and physical playtesting
remain open. File extension alone does not establish cartridge compatibility.

MBC3 cartridge clocks advance while the game is emulating and are included
in battery saves. They pause in the picker and while powered off; this host
does not provide calendar time for offline advancement.

## Battery saves

Changed battery RAM is checkpointed approximately every five seconds at a
safe module boundary, and when Start + Select returns to the picker. Return
to the picker before resetting/powering off. A reset can lose recent changes.
Save failures return to the picker and block loading another ROM until Fire
successfully retries; keep power on if the picker reports a save failure.

`/VMS/GBVM/SAVES/<ROM-CRC32>.s0` and `.s1` are alternating, length/CRC-checked
slots. The last verified slot is retained during replacement. Back up the
whole SAVES directory. Empty files left by the earlier failed first save contain
no saved progress and are safely ignored. Nonempty damaged slots fall back to a
valid partner; without one they stop loading rather than silently starting over.
This is not a guarantee
against filesystem/media failure. Existing raw `.sav` files from other emulators
are **not imported or overwritten** by this update. ROM files are read-only.

The ZIP includes neither games nor saves and does not clear your ROMS/SAVES
folders. Replace the module and launcher/client together; leave other VM
packages alone. The [build record](GBVM-build.json) records matching engine and
client rebuilds from a retained developer source snapshot and the startup checks
for this release.

GNU GPL version 2 or later; no warranty. LICENSE-gnuboy.txt contains the license.
This release provides the runtime package only. Component license rights remain
unchanged. Physical speed, audio quality and controller acceptance still require
testing on the C64.
