; Desktop-specific controls, bundled into the firmware Help program.
DesktopHelp:
   jsr CommonInit
   lda #<MsgDesktopHelp
   ldy #>MsgDesktopHelp
   jsr PrintString
   jmp WaitHelpMenuKey
MsgDesktopHelp:
   !tx EscC,EscSourcesColor, ChrRvsOn, " Desktop controls ", ChrReturn
   !tx "Click selects; double-click opens.",ChrReturn
   !tx "Drag: ghost+grid; release snaps.",ChrReturn
   !tx "Browser: 5 rows; messages use a modal.",ChrReturn
   !tx "Loading bars fill from left to right.",ChrReturn
   !tx "F1 Help / F2 BASIC / F8 Control Panel",ChrReturn
   !tx "V: GUI / original-style text menu.",ChrReturn
   !tx "Panel Appearance: Light or Dark.",ChrReturn
   !tx "Background: Dots, Dithered, or Blank.",ChrReturn
   !tx "Panel Input: Mouse/Joy for each port.",ChrReturn
   !tx "One mouse max; two joysticks allowed.",ChrReturn
   !tx "Panel Storage: SD/USB ID, size, free.",ChrReturn
   !tx "Also shows firmware flash size/free.",ChrReturn
   !tx "TEENSY: Snake, Calculator, Text Viewer.",ChrReturn
   !tx "Apps load from firmware only when used.",ChrReturn
   !tx "Close/STOP returns; app RAM is reused.",ChrReturn
   !tx "Boot Disk: SHIFT+RUN/STOP, device 8/9.",ChrReturn
   !tx "SHIFT+C/P/D: Copy/Paste/Delete",ChrReturn
   !tx "Delete is permanent; no trash folder."
   !tx 0
