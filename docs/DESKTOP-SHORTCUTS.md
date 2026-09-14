# Remembered drive and desktop shortcuts

These features are included in [firmware 1.2.23](../firmware/README.md).
Install the firmware through the updater and confirm 1.2.23 in About after
restarting.

The GUI remembers the last Main, SD, or USB drive selected. After a reboot it
opens that drive at its root. Returning to the desktop with Home saves Main as
the next startup location. An unavailable saved drive falls back to the desktop
for that boot; reconnecting it restores the remembered choice on the next boot.
Classic-menu and autolaunch settings retain their existing behavior.

To add a shortcut, select a file or folder on SD or USB and choose **File >
Add Desktop** or press **Shift+S**. Press **Home** to see it beside the drive
icons. Double-click or press Return to open it. Drag it to an empty position,
or use **Edit > Arrange Icons**, to save its position.

The desktop supports seven shortcuts alongside its eight built-in icons.
Selecting a shortcut on the desktop and choosing **File > Delete** or pressing
**Shift+D** removes only that link. Its original file or folder is preserved.
The ordinary SD/USB Copy, Paste, and Delete commands continue to operate on
actual files; these commands are separate from adding a desktop shortcut.

Each device stores its own links in two small hidden files at its root:
`.tr-desktop-0.dat` and `.tr-desktop-1.dat`. They use alternating, checksummed
records so an interrupted update can recover the previous valid copy. Keep
these files to preserve the desktop layout. Links appear while their source
device is mounted. After attaching a device, press Home or choose Refresh on
the desktop to show its links.
If both devices contain more than seven links in total, SD links are shown
first. Removing or renaming a target file does not change a link; opening a
missing target reports an error.

The [1.2.23 release report](FIRMWARE-1.2.23.md) records build and automated
validation. Physical C64/TeensyROM testing of reboot, media removal and launch
remains separate.
