# Doom receiver recovery

The C64 launcher used to stop on any single status byte at or above `$E0`.
Hardware reports showed that error screen while the firmware error register
still contained its normal video-timing marker. Injecting one bad status read
reproduces the false stop in the old receiver.

The new launcher makes up to 32 spaced rereads after a suspect value. It returns
to normal packet handling when it sees a valid startup, running or quiet status.
It does not clear the display, acknowledge a packet or bypass CRC checks during
this retry. The ordinary status-read path is unchanged apart from its branch.

An actual firmware error requires three consecutive `$E0` samples with the same
nonzero error code. Doom's normal `$80`–`$83` timing markers are not accepted as
error codes. If the link remains unreadable, retries end with a diagnostic rather
than hanging indefinitely. Genuine errors still stop the receiver.

The diagnostic includes a saturating recovery count and the last suspect status,
both in hexadecimal. On a terminal failure it requests a quiet host and refreshes
text colours so a late video upload does not leave the message unreadable.

No firmware timing constants, rendering code, Doom engine or game data changed.
The full ZIP replaces both launcher copies and works with firmware 1.1.13.

## Checks

Run from the repository root:

```powershell
node --test Source/VM/tests/doom_status_recovery_test.mjs Source/VM/tests/packet_replay_test.mjs
node Source/VM/tests/doom_video_controls.mjs
node Source/VM/tests/doom_music_client.mjs
node scripts/build-doom-client.mjs
```

The tests cover transient and burst corruption, recurring recoveries, persistent
failure, genuine firmware errors, CRC replay, controls and SID packet handling.
`Source/VM/tests/c64_boot_test.mjs` accepts `--standard pal` or `ntsc` and
`--vice <path-to-x64sc.exe>` to boot the generated launcher in VICE.

Software tests passed. Whether this prevents the reported failures on original
NTSC C64s still needs physical testing; the electrical cause is not established.
