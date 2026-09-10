# MHS Prism

**320x200. 4-bit color. Designed for games.**

MHS Prism is the live graphics system developed by Mean Hamster Software for
MHS Power Engine. It brings a 320x200 display using the C64's 16 colors to our
game engines, combining automatic real-time conversion with the delivery
system needed to keep a changing game screen, controls and sound working
together.

MHS developed the live converter, fast color selection, caching, change
detection, double buffering, transfer management and coordinated input/audio
delivery. These are the foundations of Prism's game-focused design.

## Built for changing game screens

- **Automatic real-time conversion:** MPE converts the running game's picture
  for the C64 as it changes. Game screens do not need individually prepared
  display files.
- **Fast color selection:** bounded color searches select suitable C64 colors
  quickly enough for repeated live updates.
- **Caching and change detection:** Prism detects unchanged regions and reuses
  conversion work, concentrating processing on the parts that changed.
- **Double buffering:** a complete picture remains visible while the next
  picture is prepared and transferred to the inactive buffer, ready to swap.
- **Transfer management:** picture uploads are divided into controlled chunks
  and coordinated with the C64 receiver.
- **Coordinated input/audio delivery:** controls and sound are serviced around
  picture transfers, allowing the game to keep handling input and delivering
  audio while an image update is in progress.

Prism's 320x200 canvas retains its width during movement. Each VM controls how
its game picture is fitted to that canvas and integrates the appropriate
presentation features. Update speed depends on the game, conversion workload
and amount of picture data transferred.

## A significant upgrade to the usual C64 experience

Prism combines full-width detail with the C64's complete 16-color palette.
Its overall color richness is superior to standard RGB CGA at 320x200, which
uses four simultaneous colors. At 320x200 with 16 colors, Prism is in the same
ballpark as Tandy 1000 and EGA in resolution and on-screen color count.
The reference modes are documented in the
[IBM CGA manual](https://www.manualslib.com/manual/819833/Ibm-5150.html?page=70),
[Tandy 1000 service manual](https://ftp.oldskool.org/pub/drivers/Tandy/1000/Tandy_1000_Service_Manual.pdf)
and [IBM EGA technical reference](https://bitsavers.org/pdf/ibm/pc/cards/Technical_Reference_Options_and_Adapters_Volume_2_Apr84.pdf).

The C64's own palette and local bitmap/sprite color restrictions still apply.
Prism automatically fits source artwork to those rules, preserving the C64's
distinctive colors while opening up much richer game presentation.

The specification **320x200, 4-bit color** means a 16-color palette; it is also
written **320x200x16 colors**. It describes the display canvas and palette,
with the C64 color-placement rules above.

## Available now and coming next

**NESVM 1.1.2 includes MHS Prism on F5.** Hold Commodore + Control and press F5.
The native 256-pixel NES picture sits between 32-pixel black side borders;
eight source lines are trimmed from each end and the remaining 224 lines fit
into 200. It retains changed-region conversion reuse and the improved green
color matching. See [NESVM setup, controls and compatibility](NESVM.md).

**DOSVM is in development, with its public launch planned for later in 2026.**
Its Prism presentation brings together the full-width live converter,
caching, double buffering, transfer management and coordinated input/audio
delivery. DOSVM is not available as a public download yet.

**MHS Prism is not compatible with DOOMVM.** DoomVM retains its own separate
display modes. See [DoomVM's display controls](DOOM.md#display).

## Launch copy

MHS Prism brings 320x200, 4-bit color game graphics to the Commodore 64 through
MHS Power Engine. Designed for games, our graphics system combines automatic
real-time conversion and fast color selection with caching, unchanged-region
detection, reused conversion work, double buffering, managed transfers and
coordinated input/audio delivery. With 16 C64 colors, Prism offers superior
overall color richness to standard 320x200 RGB CGA and puts resolution and
color count in the same ballpark as Tandy 1000 and EGA: a significant upgrade
to the usual C64 experience. MHS Prism is available in NESVM and is part of
the DOSVM launch planned for later in 2026. It is not compatible with DOOMVM.
