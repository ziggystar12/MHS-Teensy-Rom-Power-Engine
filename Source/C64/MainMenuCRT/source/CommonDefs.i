; MIT License
; 
; Copyright (c) 2023 Travis Smith
; 
; Permission is hereby granted, free of charge, to any person obtaining a copy of this software 
; and associated documentation files (the "Software"), to deal in the Software without 
; restriction, including without limitation the rights to use, copy, modify, merge, publish, 
; distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom 
; the Software is furnished to do so, subject to the following conditions:
; 
; The above copyright notice and this permission notice shall be included in all copies or 
; substantial portions of the Software.
; 
; THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING 
; BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND 
; NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, 
; DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, 
; OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


   ;symbols used by both crt/rom emulated at boot and main code running from C64 RAM

   ;!set DbgVerbose = 1   ;if defined, adds startup messages & does IO1 check
   ;!set DbgInitWait = 1  ;if defined, Prompts and waits for any key with startup info showing

   ;Zero page RAM Registers. Some .SIDs use these, so make sure SID/Music is off 
   PtrAddrLo   = $fb
   PtrAddrHi   = $fc
   Ptr2AddrLo  = $fd
   Ptr2AddrHi  = $fe
   
;RAM code locations:
   
   ;$033c-03fb is the tape buffer (192 bytes)
   PRGLoadStartReloc = $033c  ;during .PRG transfer, PRG transfer code location/execution point
   ;The expanded desktop owns the standard VIC-II bitmap at $2000-$3f3f while
   ;it is resident, plus off-screen layout/font at $4000-$47ff. The Teensy
   ;SID overlap check protects the full display and scratch memory;
   ;picture viewers may reuse it because the desktop redraws on return.
   MenuReservedRAMStart = $2000
!ifdef DesktopShell {
   ;The expanded payload follows the off-screen font, leaving 22 KiB below
   ;BASIC ROM. Keep the compact recovery cartridge's original location.
   MainCodeRAMStart  = $4800
   ;The native control/settings overlay lives below the displayed bitmap.
   ;Stable entry vectors let the packed desktop and app extension call it
   ;without consuming their nearly full resident reservations.
   GeosSettingsBase = $1000
   GeosPanelSettingsOpen = GeosSettingsBase+$00
   GeosPanelControlDraw = GeosSettingsBase+$03
   GeosPanelControlHitTest = GeosSettingsBase+$06
   GeosPanelControlItemUp = GeosSettingsBase+$09
   GeosPanelControlItemDown = GeosSettingsBase+$0c
   GeosPanelControlItemLeft = GeosSettingsBase+$0f
   GeosPanelControlItemRight = GeosSettingsBase+$12
   GeosPanelControlSetSelection = GeosSettingsBase+$15
   GeosPanelControlHandleKey = GeosSettingsBase+$18
   GeosPanelMusicActivate = GeosSettingsBase+$1b
   GeosPanelMusicOpen = GeosSettingsBase+$1e
   GeosPanelControlOrigin = GeosSettingsBase+$21
   GeosSettingsCode = GeosSettingsBase+$24
   GeosAppEntry = $c000
   GeosAppBackendAvailable = $c003
}
!ifndef DesktopShell {
   MainCodeRAMStart  = $6000  ;Main code location/execution point, synch w/ ParseSIDHeader checks
}
