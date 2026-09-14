# Prism+ licensing and source availability

The new, independently implemented MHS Prism+ renderer is distributed as
compiled code under [LICENSE-PRISM-PLUS.txt](../LICENSE-PRISM-PLUS.txt). Its
implementation source is not included in this public release. Installation,
use, backup and redistribution of the complete unmodified distribution are
permitted. Modified MHS Prism+ distributions require MHS permission, subject
to the existing-license and LGPL exceptions in that license.

This policy applies to the new MHS Prism+ components identified in the
[release component manifest](PRISM-PLUS-COMPONENTS.json). It leaves previously granted MIT rights intact.
Original TeensyROM, the previously published MHS color converter, original
Prism/NUFLIX components and VM engines retain their respective licenses.

NESVM's Nofrendo engine and MPE adapter remain under the GNU Library General
Public License version 2. Exact engine source and standalone rebuild
instructions are published with this release. The separately executed C64
launcher is supplied as a binary; its older MIT components retain their
notices. A binary launcher does not remove the engine source or relinking
rights. DOOMVM retains its existing GPL-covered engine source and notices;
DOOMVM does not use Prism+.

The MPE firmware includes separately licensed Teensy/Arduino libraries,
including LGPL-covered components. The accompanying firmware relinking SDK
supplies linkable application objects, the corresponding library sources,
build recipes and image-combination tools. It permits rebuilding the libraries
and relinking the firmware without exposing the Prism+ implementation source.
The license expressly preserves the LGPL permissions for customer own-use
modification and reverse engineering to debug those modifications.

Third-party software and game/demo media are not relicensed by this notice.
Their copyright notices and distribution permissions remain with them.
