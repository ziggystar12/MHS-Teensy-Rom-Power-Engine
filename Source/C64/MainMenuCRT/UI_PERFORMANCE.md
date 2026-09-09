# Desktop UI performance proof

The deterministic NMOS 6502 harness counts nominal CPU cycles while running the
assembled desktop. VIC DMA is outside this model. Pixel tests separately verify
the exact published bitmap and color bounds, including partial first/last bytes.

## Rendering cycles

Baseline is clean `0bb7b95`; current is the V1.0.10 UI-region work. The choice
and Music cases now begin from a fully drawn real panel instead of blank memory.

| Operation | Baseline | Current | Change |
| --- | ---: | ---: | ---: |
| Loading dialog | 1,367,924 | 1,125,740 | -17.7% |
| Activity strip | 64,600 | 54,253 | -16.0% |
| Long dialog body | 1,191,372 | 1,114,041 | -6.5% |
| Error dialog | 527,527 | 471,986 | -10.5% |
| Information dialog | 1,491,953 | 1,252,649 | -16.0% |
| Choice change | 476,772 | 99,867 | -79.1% |
| Action status | 502,861 | 456,245 | -9.3% |
| File dialog | 1,585,988 | 1,332,504 | -16.0% |
| Music selection | 66,813 | 62,669 | -6.2% |
| Music post-wait repaint | 1,441,797 | 1,207,382 | -16.3% |
| Firmware cancel dialog | 1,591,387 | 1,341,071 | -15.7% |
| Music Play/Pause | full repaint | 57,087 | saves startup preference; publishes only the 108x7 caption strip |

Menu work is measured in instructions by its dedicated retained-surface test:
open fell from 158,284 to 141,515, a row change from 158,305 to 141,536,
menu switches from 97,855-146,438 to 87,464-141,517, and close from 45,290 to
42,987. Every measured drawing path keeps IRQ masking at or below 96 cycles;
the current cases report zero drawing-time masking and service the real SID and
mouse IRQ wedge.

## Payload size

| Payload | Baseline | Current | Capacity | Free |
| --- | ---: | ---: | ---: | ---: |
| `DesktopShellCode.bin` | 22,466 | 22,506 | 22,528 | 22 bytes |
| `GeosApps.bin` | 4,074 | 4,093 | 4,096 | 3 bytes |
| `TeensyROMC64.bin` | 7,559 | 7,559 | 8,192 | 633 bytes |

The additional resident/app bytes include the bounded firmware preflight wait:
STOP, a fresh click, or ten 2.9-second activity sweeps sends the backend cancel
command. The armed byte is cleared before the non-cancellable flash transfer.

Run the proof with:

```powershell
node --test Source/C64/MainMenuCRT/tests/geos-dialog-irq.test.js `
  Source/C64/MainMenuCRT/tests/geos-loading.test.js `
  Source/C64/MainMenuCRT/tests/geos-menu-latency.test.js `
  Source/C64/MainMenuCRT/tests/geos-control.test.js `
  Source/C64/MainMenuCRT/tests/geos-widgets.test.js
```
