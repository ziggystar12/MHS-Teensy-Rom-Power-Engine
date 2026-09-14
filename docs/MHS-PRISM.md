# MHS Prism+

Prism+ is Mean Hamster Software's live C64 graphics system for MPE games.
It presents a 320×200 canvas with the C64's 16-color palette, combining an
independent color fitter, raster generator, picture layout and transfer system.
The C64's palette and local color-placement rules still shape the result.

## What improves

**Movement and detail receive different treatment.** Prism+ updates moving
regions promptly and refines their color fit when the source picture settles.
It keeps a bounded refinement deadline so continuous activity does not postpone
all quality work indefinitely.

**Unchanged pixels avoid repeated work.** Cached conversion and changed-region
tracking concentrate work on new content. Both display banks retain histories,
so updating the inactive picture includes the changes needed to catch it up.
Unchanged packed data does not need to be transferred again.

**Complete pictures remain visible.** A warm update is prepared in the inactive
display bank and becomes visible at a coordinated border switch. The previous
complete picture remains on screen during preparation and upload.

**Picture transfers leave room for sound and controls.** Transfers use bounded
windows. Current NESVM also delivers changing sound state while video is busy,
so music does not have to wait for a whole picture upload. Its emulation-core
improvements are separate from Prism+ rendering.

These changes reduce repeated processing and transferred data. They are not
a guarantee of a particular FPS or identical speed in every game. Current
NES-specific fitting tests also preserve exact output while
skipping its known black side margins.

## Available now in NESVM 1.2.0

Use [firmware 1.2.23](../firmware/) and the [current NESVM package](NESVM.md).
Hold **Ctrl + Commodore + F5** to select Prism+. All 256 NES columns remain
centered between 32-pixel margins; the retained 224 source rows fit into 200.
Standard (Ctrl + Commodore + F1) and Pan and scan (Ctrl + Commodore + F3) remain.
F7 Sharp has been removed following a hardware crash report.

Prism+ can improve color richness compared with simpler multicolor modes, but
retains the C64 palette and raster constraints. SID sound is an approximation
of NES audio. Original Prism and Prism+ are distinct renderer implementations.

**DoomVM does not use Prism or Prism+.** Its F1/F3/F5/F7 options are its own
display modes. Other Prism+ VM integrations remain in development and are not
part of the public downloads on this page.

## Licensing and credits

The new MHS-owned Prism+ implementation is distributed as compiled code with
its source kept private. Use and complete unmodified redistribution are allowed;
the [license](../LICENSE-PRISM-PLUS.txt) preserves earlier MIT grants and required
third-party/LGPL rights. [Source availability](PRISM-PLUS-LICENSE.md).
