// MIT License
// 
// Copyright (c) 2023 Travis Smith
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software 
// and associated documentation files (the "Software"), to deal in the Software without 
// restriction, including without limitation the rights to use, copy, modify, merge, publish, 
// distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom 
// the Software is furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in all copies or 
// substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING 
// BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND 
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, 
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, 
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


//  !!!!!!!!!!!!!!!!!!!!These need to match C64 Code: MainMenu.asm !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

#define MaxItemDispLength  35
#define MaxItemsPerPage    19
#define MaxDesktopItemsPerPage 25
#define DesktopViewportItems 20
#define DesktopViewportColumns 4
#define DesktopLabelLength 22
#define NumHotKeys          5
#define NumDesktopSlots     9

enum IO1_Registers  //offset from 0xDE00
{
   //skipping 0: Used by many others and accessed on reset
   rwRegStatus         =  1 , // Indicates busy when waiting for FW to complete something
   rRegStrAvailable    =  2 , // Stream PRG: zero when inactive/complete 
   rRegStreamData      =  3 , // Stream PRG: next byte of data to transfer, auto increments when read
   wRegControl         =  4 , // RegCtlCommands: execute specific functions
   rRegPresence1       =  5 , // HW detect: 0x55
   rRegPresence2       =  6 , // HW detect: 0xAA
   rRegLastHourBCD     =  7 , // Last TOD: Hours read
   rRegLastMinBCD      =  8 , // Last TOD: Minutes read
   rRegLastSecBCD      =  9 , // Last TOD: Seconds read
   rWRegCurrMenuWAIT   = 10 , // enum RegMenuTypes: select Menu type: SD, USB, etc
   rwRegSelItemOnPage  = 11 , // Item sel/info: (zero based) select Menu Item On Current Page for name, type, execution, etc
   rwRegCursorItemOnPg = 12 , // Item sel/info: (zero based) Highlighted/cursor Menu Item On Current Page
   rRegNumItemsOnPage  = 13 , // Item sel/info: num items on current menu page
   rwRegPageNumber     = 14 , // Item sel/info: (one based) current page number
   rRegNumPages        = 15 , // Item sel/info: total number of pages
   rRegItemTypePlusIOH = 16 , // Item sel/info: regItemTypes: type of item, bit 7 indicates there's an assigned IOHandler (from TR mem menu) 
   rwRegMIDISettings   = 17 , // EEPROM stored: MIDI Settings reg, see RegMIDISettingsMasks
   rwRegMIDISettings2  = 18 , // EEPROM stored: MIDI Settings reg #2, see RegMIDISettingsMasks2
   rwRegPwrUpDefaults  = 19 , // EEPROM stored: power up default reg, see RegPowerUpDefaultMasks
   rwRegPwrUpDefaults2 = 20 , // EEPROM stored: power up default reg#2, see RegPowerUpDefaultMasks2
   rwRegTimezone       = 21 , // EEPROM stored: signed char for timezone: UTC +/-12 
   rwRegNextIOHndlr    = 22 , // EEPROM stored: Which IO handler will take over upone exit/execute/emulate
   rwRegSerialString   = 23 , // Write selected item (RegSerialStringSelect) to select/reset, then Serially read out until 0 read.
   wRegSearchLetterWAIT= 24 , // Put cursor on first menu item with letter written
   rRegSIDInitHi       = 25 , // SID Play Info: Init address Hi
   rRegSIDInitLo       = 26 , // SID Play Info: Init Address Lo
   rRegSIDPlayHi       = 27 , // SID Play Info: Play Address Hi
   rRegSIDPlayLo       = 28 , // SID Play Info: Play Address Lo
   rRegSIDDefSpeedHi   = 29 , // SID Play Info: Default CIA interrupt timer speed Hi
   rRegSIDDefSpeedLo   = 30 , // SID Play Info: Default CIA interrupt timer speed Lo
   rwRegSIDCurSpeedHi  = 31 , // SID Play Info: Current CIA interrupt timer speed Hi
   rwRegSIDCurSpeedLo  = 32 , // SID Play Info: Current CIA interrupt timer speed Lo
   wRegSIDSpeedChange  = 33 , // SID Play Control: Change speed as indicated by RegSIDSpeedChanges
   rwRegSIDSongNumZ    = 34 , // SID Play Info: Current Song Number (Zero Based)
   rRegSIDNumSongsZ    = 35 , // SID Play Info: Number of Songs in SID (Zero Based)
   wRegVid_TOD_Clks    = 36 , // C64/128 Video Standard and TOD clock frequencies
   wRegIRQ_ACK         = 37 , // IRQ Ack from C64 app
   rwRegIRQ_CMD        = 38 , // IRQ Command from TeensyROM
   rwRegCodeStartPage  = 39 , // TR Code Start page in C64 RAM
   rwRegCodeLastPage   = 40 , // TR Code last page used in C64 RAM
   rwRegScratch        = 41 , // Bi-Directional Scratch Register
   rwRegColorRefStart  = 42 , // Color ref transfer eeprom<->C64, WAIT on Write
                              //offsets defined in enum ColorRefOffsets
   //NextReg = rwRegColorRefStart+NumColorRefs,
   wRegIRQNMITest      = 50 , // logs receipt of IRQ/DMA, and used for IO2 test via IO2Scratch
   wRegGameExROMCtl    = 51 , // Allows Exp Port test app to control Game and ExROM signals
   rwRegPwrUpDefaults3 = 52 , // EEPROM stored: power up default reg#3, see RegPowerUpDefaultMasks3
   rwRegDesktopFlags   = 53 , // EEPROM stored: desktop layout flags
   rwRegDesktopSlotStart=54 , // EEPROM stored: desktop layout slots 0..8 (through register 62)
   rRegFileOpState     = 63 , // RAM-only desktop file operation state (RegFileOpStates)

   // These are used for the MIDI2SID app, keep in synch or make separate handler
   StartSIDRegs        = 64 , // start of SID Regs, matching SID Reg order ($D400)
   rRegSIDFreqLo1      = StartSIDRegs +  0, 
   rRegSIDFreqHi1      = StartSIDRegs +  1,
   rRegSIDDutyLo1      = StartSIDRegs +  2,
   rRegSIDDutyHi1      = StartSIDRegs +  3,
   rRegSIDVoicCont1    = StartSIDRegs +  4,
   rRegSIDAttDec1      = StartSIDRegs +  5,
   rRegSIDSusRel1      = StartSIDRegs +  6,
                                         
   rRegSIDFreqLo2      = StartSIDRegs +  7, 
   rRegSIDFreqHi2      = StartSIDRegs +  8,
   rRegSIDDutyLo2      = StartSIDRegs +  9,
   rRegSIDDutyHi2      = StartSIDRegs + 10,
   rRegSIDVoicCont2    = StartSIDRegs + 11,
   rRegSIDAttDec2      = StartSIDRegs + 12,
   rRegSIDSusRel2      = StartSIDRegs + 13,
                       
   rRegSIDFreqLo3      = StartSIDRegs + 14, 
   rRegSIDFreqHi3      = StartSIDRegs + 15,
   rRegSIDDutyLo3      = StartSIDRegs + 16,
   rRegSIDDutyHi3      = StartSIDRegs + 17,
   rRegSIDVoicCont3    = StartSIDRegs + 18,
   rRegSIDAttDec3      = StartSIDRegs + 19,
   rRegSIDSusRel3      = StartSIDRegs + 20,
                       
   rRegSIDFreqCutLo    = StartSIDRegs + 21,
   rRegSIDFreqCutHi    = StartSIDRegs + 22,
   rRegSIDFCtlReson    = StartSIDRegs + 23,
   rRegSIDVolFltSel    = StartSIDRegs + 24,
   EndSIDRegs          = StartSIDRegs + 25,
                       
   rRegSIDStrStart     = StartSIDRegs + 26,
   //  9: 3 chars per voice (oct, note, shrp)
   //  1: Out of voices indicator
   //  3: spaces betw
   // 14 total w// term:  ON# ON# ON# X
   rRegSIDOutOfVoices  = StartSIDRegs + 38,
   rRegSIDStringTerm   = StartSIDRegs + 39,

   rRegFileOpProgress  = 104, // Copy + verification progress, 0..100
   rRegFileClipboard   = 105, // 1 when a source file is in the RAM clipboard
   rwRegMenuView       = 106, // RAM-only WAIT: 0 classic19, 1 legacy desktop25, 2 scrolling desktop16
   rwRegViewTopLo      = 107, // Desktop2 top item: write low stages, write high atomically commits/clamps
   rwRegViewTopHi      = 108, // Reads return the committed row-aligned top item
   rRegViewCountLo     = 109, // Visible directory total, excluding the synthetic parent
   rRegViewCountHi     = 110,
   rRegFirmwareTargetState = 111, //0 idle,1 captured/ready,2 changed,3 invalid; WAIT check before confirmation
   rRegStorageState    = 112, // RegStorageStateMasks; snapshot is published atomically by rCtlStorageRefreshWAIT
   rRegStorageSDTotalMiB0 = 113, // 32-bit little-endian whole MiB, bytes 0..3
   rRegStorageSDTotalMiB1 = 114,
   rRegStorageSDTotalMiB2 = 115,
   rRegStorageSDTotalMiB3 = 116,
   rRegStorageSDFreeMiB0 = 117, // 32-bit little-endian whole MiB, bytes 0..3
   rRegStorageSDFreeMiB1 = 118,
   rRegStorageSDFreeMiB2 = 119,
   rRegStorageSDFreeMiB3 = 120,
   rRegStorageSDId0   = 121, // 32-bit little-endian SD CID product serial number
   rRegStorageSDId1   = 122,
   rRegStorageSDId2   = 123,
   rRegStorageSDId3   = 124,
   rRegStorageUSBTotalMiB0 = 125, // 32-bit little-endian whole MiB, bytes 0..3
   rRegStorageUSBTotalMiB1 = 126,
   rRegStorageUSBTotalMiB2 = 127,
   rRegStorageUSBTotalMiB3 = 128,
   rRegStorageUSBFreeMiB0 = 129, // 32-bit little-endian whole MiB, bytes 0..3
   rRegStorageUSBFreeMiB1 = 130,
   rRegStorageUSBFreeMiB2 = 131,
   rRegStorageUSBFreeMiB3 = 132,
   rRegStorageUSBVendorLo = 133, // USB vendor ID, little-endian
   rRegStorageUSBVendorHi = 134,
   rRegStorageUSBProductLo = 135, // USB product ID, little-endian
   rRegStorageUSBProductHi = 136,
   rRegStorageInternalTotalKiB0 = 137, // usable firmware flash, 32-bit little-endian KiB
   rRegStorageInternalTotalKiB1 = 138,
   rRegStorageInternalTotalKiB2 = 139,
   rRegStorageInternalTotalKiB3 = 140,
   rRegStorageInternalFreeKiB0 = 141, // unused usable firmware flash, 32-bit little-endian KiB
   rRegStorageInternalFreeKiB1 = 142,
   rRegStorageInternalFreeKiB2 = 143,
   rRegStorageInternalFreeKiB3 = 144,
   rwRegDesktopAppID   = 145, // RegDesktopApps; selects the flash-backed desktop utility to stream
   IO1Size             = 146, //last entry, sets size
};

#define    IO2Scratch     0x7F    //;Used for Expansion Port Test

#define    rRegIOHSwapPoll  0xFE  // High IO1: poll for IO handler swap completion after rCtlRunningPRG/rCtlRunningIEC (see HandshakeSnoop)

enum RegIOHSwapStates     //rRegIOHSwapPoll values
{
   rihsBusy            = 0x00, // IO handler swap not yet complete, keep polling
   rihsReady           = 0xff, // IO handler swap complete, safe to proceed
};

enum RegIRQCommands       //rwRegIRQ_CMD, echoed to wRegIRQ_ACK
{
   ricmdNone           = 0, // no command, always 0 (init)
   ricmdAck1           = 1, // Ack1 response from C64 IRQ routine
   ricmdLaunch         = 2, // Launch app (set up before IRQ assert)
   ricmdSIDPause       = 3, // SID pause/play
   ricmdSIDInit        = 4, // re-init current SID (sub song # change)
   ricmdSetSIDSpeed    = 5, // Apply CIA timer reg values (rRegSIDCurSpeedHi/Lo)
   ricmdSIDVoiceMute   = 6, // Apply SID Voice Mute Settings
};

enum ColorRefOffsets       //Order matches TblEscC:
{
   EscBackgndColor     = 0, // Black   Screen Background
   EscBorderColor      = 1, // Purple  Screen Border
   EscTRBannerColor    = 2, // Purple  Top of screen banner color
   EscTimeColor        = 3, // Orange  Time Display & Waiting msg
   EscOptionColor      = 4, // Yellow  Input key option indication
   EscSourcesColor     = 5, // LtBlue  General text/descriptions
   EscNameColor        = 6, // LtGreen FIle names & other text
   NumColorRefs        = 7, // Number of color references

   //local use only, could re-factor for permanent change:
   EscMenuMiscColor    = EscNameColor,    // Was Green: Menu alt color
   EscTypeColor        = EscSourcesColor, // Was Blue : File types(only)
};

enum  RegSIDSpeedChanges  // wRegSIDSpeedChange
{
   rsscIncMajor        = 1, // inc major % units
   rsscDecMajor        = 2, // dec major % units
   rsscIncMinor        = 3, // inc minor % units
   rsscDecMinor        = 4, // dec minor % units
   rsscSetDefault      = 5, // Set Default Speed
   rsscToggleLogLin    = 6, // Toggle control type
};

enum RegSerialStringSelect // rwRegSerialString
{
   rsstItemName        = 0,  // Name of selected item
   rsstNextIOHndlrName = 1,  // IOHandler Name selected in rwRegNextIOHndlr
   rsstSerialStringBuf = 2,  // build SerialStringBuf prior to selecting
   rsstVersionNum      = 3,  // version string for main banner 
   rsstShortDirPath    = 4,  // printable current path
   rsstSIDInfo         = 5,  // Info on last SID loaded
   rsstMachineInfo     = 6,  // Info on current machine vid/TOD clk (set when SID loaded)
   rsstSIDSpeed        = 7,  // Current SID playback speed
   rsstSIDSpeedCtlType = 8,  // Current SID Speed Control Type (Log/Lin)
   rsstFileOpName      = 9,  // Full captured filename as raw ASCII, independent of browser selection
   rsstFileOpMessage   = 10, // File operation result/progress message (at most 39 chars)
   rsstDesktopLabel    = 11, // Raw ASCII, <=22 chars, preserves case/dots and final extension when shortened
   rsstItemNameRaw     = 12, // Full exact filename as raw ASCII; display only, lookup remains by raw index
   rsstFirmwareName    = 13, // Full raw ASCII name captured by rCtlFirmwarePrepareWAIT
};

enum RegFileOpStates
{
   rfosIdle            = 0,
   rfosBusy            = 1,
   rfosCopied          = 2,
   rfosPasted          = 3,
   rfosDeleted         = 4,
   rfosCancelled       = 5,
   rfosDeleteReady     = 6,
   rfosUnsupported     = 0x80,
   rfosInvalidPath     = 0x81,
   rfosNoClipboard     = 0x82,
   rfosSourceError     = 0x83,
   rfosExists          = 0x84,
   rfosMediaError      = 0x85,
   rfosReadError       = 0x86,
   rfosWriteError      = 0x87,
   rfosVerifyError     = 0x88,
   rfosDeleteError     = 0x89,
   rfosCleanupError    = 0x8a,
   rfosNoPendingDelete = 0x8b,
};

enum RegPowerUpDefaultMasks
{  //eepAdPwrUpDefaults, rwRegPwrUpDefaults
   rpudSIDPauseMask    = 0b00000001, // rwRegPwrUpDefaults bit 0, 1=SID music paused
   rpudNetTimeMask     = 0b00000010, // rwRegPwrUpDefaults bit 1, 1=synch RTC to net time
   rpudShowExtension   = 0b00000100, // rwRegPwrUpDefaults bit 2, 1=show file extensions
   rpudClock12_24hr    = 0b00001000, // rwRegPwrUpDefaults bit 3, 1=24 hour clock displayed
   rpudJoySpeedMask    = 0b11110000, // rwRegPwrUpDefaults bits 4-7=Joystick2 speed setting
};

enum RegPowerUpDefaultMasks2  //SerCtl bits match TblMsgHostSerCtl and TblAltButtons
{  //eepAdPwrUpDefaults2, rwRegPwrUpDefaults2

                                        // bit 0 unused, for future hosted serial devices(?)
   rpud2HostSerCtlMask    = 0b00000110, // mask of all host serial control devices
   rpud2HostSerCtlMaskInv = 0b11111001, // Inverted mask of all host serial control devices
   //match TblMsgHostSerCtl
   rpud2NFCEnabled        = 0b00000010, // bit 1, 1=NFC Enabled
   rpud2TRContEnabled     = 0b00000100, // bit 2, 1=TRCont Enabled
   
   rpud2AltBtnActionMask  = 0b00111000, // mask of all Alternate Button Action options
  rpud2AltBtnActionMaskInv= 0b11000111, // Inverted mask of all Alternate Button Action options
   //match TblMsgAltBtnAction
   rpud2AltBtnAutoLaunch  = 0b00000000, // bits 5:3, 000 = AutoLaunch (default = 0)
   rpud2AltBtnPause       = 0b00001000, // bits 5:3, 001 = Pause C64
   rpud2AltBtnTRMenu      = 0b00010000, // bits 5:3, 010 = TRMenu    
   rpud2AltBtnRebootTR    = 0b00011000, // bits 5:3, 011 = Reboot    
   rpud2AltBtnNone        = 0b00100000, // bits 5:3, 100 = None      
   NumAltButtons          =          5, // Update to indicate number of alt button options
   rpud2AltBtnUnused1     = 0b00101000, // bits 5:3, 101 = Unused1   
   rpud2AltBtnUnused2     = 0b00110000, // bits 5:3, 110 = Unused2   
   rpud2AltBtnUnused3     = 0b00111000, // bits 5:3, 111 = Unused3   
   
   rpud2TRAutoLaunch      = 0b01000000, // bit 6, 1=Auto-Launch Enabled
   rpud2TRTCPListen       = 0b10000000, // bit 7, 1=TCP Listen Enabled
};

enum RegPowerUpDefaultMasks3
{  //eepAdPwrUpDefaults3, rwRegPwrUpDefaults3
   rpud3ResetDetectDisable= 0b10000000, // bit 7, 1=External Reset Detect Disabled (0=enabled/default)
   rpud3TextMenu          = 0b00000001, // bit 0, 1=Original text menu (0=GUI/default)
   rpud3InputLayoutMask   = 0b00000110, // bits 2:1, persisted desktop control-port assignment
   rpud3InputMouse1Joy2   = 0b00000000, // default/back-compatible: 1351 mouse port 1, joystick port 2
   rpud3InputJoy1Mouse2   = 0b00000010, // joystick port 1, 1351 mouse port 2
   rpud3InputJoy1Joy2     = 0b00000100, // both ports are joysticks; either navigates the desktop
   rpud3InputInvalid      = 0b00000110, // reserved; C64 UI normalizes this to Mouse 1 / Joystick 2
   rpud3AppearanceDark    = 0b00001000, // bit 3, 0=light desktop, 1=dark desktop
   rpud3BackgroundMask    = 0b00110000, // bits 5:4, persisted desktop background selection
   rpud3BackgroundDots    = 0b00000000, // default/back-compatible dotted background
   rpud3BackgroundDithered= 0b00010000,
   rpud3BackgroundBlank   = 0b00100000,
   rpud3BackgroundInvalid = 0b00110000, // reserved; C64 UI normalizes this to dots
   // bit 6 unused
};

enum RegStorageStateMasks
{
   rssSnapshotValid    = 0b00000001, // all snapshot registers are complete and mutually consistent
   rssSDConnected      = 0b00000010, // physical card detected, whether or not it mounted
   rssSDInfoValid      = 0b00000100, // SD size/free/ID fields are valid
   rssSDError          = 0b00001000, // card detected but mount or geometry query failed
   rssUSBConnected     = 0b00010000, // USB mass-storage device detected, whether or not it mounted
   rssUSBInfoValid     = 0b00100000, // USB size/free/VID/PID fields are valid
   rssUSBError         = 0b01000000, // device detected but filesystem or geometry query failed
   rssInternalInfoValid= 0b10000000, // internal total/free firmware-flash fields are valid
};

enum RegMIDISettingsMasks
{  //eepAdMIDISettings, rwRegMIDISettings
   rMIDISetNoteOffOnEn           = 0b00000001, 
   rMIDISetAfterTouchPolyEn      = 0b00000010, 
   rMIDISetControlChangeEn       = 0b00000100, 
   rMIDISetProgramChangeEn       = 0b00001000, 
   rMIDISetAfterTouchEn          = 0b00010000, 
   rMIDISetPitchChangeEn         = 0b00100000, 
   rMIDISetSystemExclusiveEn     = 0b01000000, 
   rMIDISetTimeCodeQuarterFrameEn= 0b10000000, 
};

enum RegMIDISettingsMasks2
{  //eepAdMIDISettings2, rwRegMIDISettings2
   rMIDISet2SongPositionEn       = 0b00000001, 
   rMIDISet2SongSelectEn         = 0b00000010, 
   rMIDISet2TuneRequestEn        = 0b00000100, 
   rMIDISet2RealTimeSystemEn     = 0b00001000, 
   //bits 7:4 unused, initialized to 0
};

enum RegStatusTypes  //rwRegStatus, match StatusFunction order
{
   rsChangeMenu         = 0x00,
   rsStartItem          = 0x01,
   rsSetRTCfromNet      = 0x02,
   rsC64TODfromRTC      = 0x03,
   rsIOHWSelInit        = 0x04, //C64 code is executing transferred PRG, change IO1 handler
   rsWriteEEPROM        = 0x05,
   rsMakeBuildCPUInfoStr= 0x06,
   rsUpDirectory        = 0x07,
   rsSearchForLetter    = 0x08,
   rsLoadSIDforXfer     = 0x09,
   rsNextPicture        = 0x0a,
   rsLastPicture        = 0x0b,
   rsWriteNFCTagCheck   = 0x0c,
   rsWriteNFCTag        = 0x0d,
   rsNFCReEnable        = 0x0e,
   rsSetBackgroundSID   = 0x0f,
   rsSetAutoLaunch      = 0x10,
   rsClearAutoLaunch    = 0x11, //no longer used
   rsNextTextFile       = 0x12,
   rsLastTextFile       = 0x13,
   rsIOHWNextInit       = 0x14, //external IEC PRG: initialize the configured next IO handler
   rsMountDxxFile       = 0x15,
   rsHotKeySetLaunch    = 0x16,
   rsNetListenInit      = 0x17,
   rsSetKERNALBin       = 0x18,
   rsKERNALPreStart     = 0x19,
   rsSetREUFile         = 0x1a,
   rsMakeFilenameStr    = 0x1b,
   rsRTCAdjust          = 0x1c,
   rsForceEthInit       = 0x1d,
   rsExtPortCheck       = 0x1e,
   rsExpPortDMA         = 0x1f,
   rsDesktopFileOp     = 0x20,
   rsMenuView          = 0x21,
   rsFirmwareTarget    = 0x22,
   rsStorageSnapshot   = 0x23,
   rsNumStatusTypes     = 0x24,

   rsReady              = 0x5a, //FW->64 (Rd) update finished (done, abort, or otherwise)
   rsC64Message         = 0xa5, //FW->64 (Rd) message for the C64, set to continue when finished
   rsContinue           = 0xc3, //64->FW (Wr) Tells the FW to continue with update

};

enum RegMenuTypes //must match TblMsgMenuName order/qty, also used by UI/serial for DriveType
{
   rmtUSBDrive  = 0,
   rmtSD        = 1,
   rmtTeensy    = 2,
   
   rmtNumTypes  = 3
};

enum RegCtlCommands
{
   rCtlVanishROM            =  0,
   rCtlBasicReset           =  1, // No longer Used!
   rCtlStartSelItemWAIT     =  2,
   rCtlSetRTCfromNetWAIT    =  3, // Synchs the Teensy RTC with time acquired from Ethernet
   rCtlC64TODfromRTCWAIT    =  4, // Sets the IO1 TOD regs with the current RTC Time
   rCtlRunningPRG           =  5, // final signal before running prg, allows IO1 handler change
   rCtlMakeInfoStrWAIT      =  6, // MakeBuildCPUInfo
   rCtlUpDirectoryWAIT      =  7,
   rCtlLoadSIDWAIT          =  8, //load .sid file to RAM buffer and prep for x-fer
   rCtlNextPicture          =  9, 
   rCtlLastPicture          = 10, 
   rCtlRebootTeensyROM      = 11, 
   rCtlWriteNFCTagCheckWAIT = 12,
   rCtlWriteNFCTagWAIT      = 13,
   rCtlNFCReEnableWAIT      = 14,
   rCtlSetBackgroundSIDWAIT = 15,
   rCtlSetAutoLaunchWAIT    = 16,
   rCtlClearAutoLaunchWAIT  = 17,
   rCtlNextTextFile         = 18,
   rCtlLastTextFile         = 19,
   rCtlMountDxxFileWAIT     = 20,
   rCtlHotKeySetLaunch      = 21,
   rCtlNetListenInitWAIT    = 22,
   rCtlSetKERNALBinWAIT     = 23,
   rCtlKERNALPreStartWAIT   = 24,
   rCtlSetREUFileWAIT       = 25,
   rCtlReturnToMainMenu     = 26, 
   
   rCtlMakeStrWAIT_First    = 27, // FIRST of a linear series that uses MakeFilenameStr
      rCtlMakeKernalStrWAIT    = 27, 
      rCtlMakeREUStrWAIT       = 28, 
      rCtlMakeSIDStrWAIT       = 29, 
      rCtlMakeAutoLStrWAIT     = 30, 
      rCtlMakeHotKey1WAIT      = 31, 
      rCtlMakeHotKey2WAIT      = 32, 
      rCtlMakeHotKey3WAIT      = 33, 
      rCtlMakeHotKey4WAIT      = 34, 
      rCtlMakeHotKey5WAIT      = 35, 
      rCtlMakeEthMACWAIT       = 36, 
      rCtlMakeEthIPAcqTypeWAIT = 37, 
      rCtlMakeEthDHCPTOWAIT    = 38, 
      rCtlMakeEthDHCPRespTOWAIT= 39, 
      rCtlMakeEthStatDNSIPWAIT = 40, 
      rCtlMakeEthStatGatewWAIT = 41, 
      rCtlMakeEthStatSubMskWAIT= 42, 
      rCtlMakeEthStatIPWAIT    = 43, 
      rCtlMakeEthLocalIPWAIT   = 44,
      rCtlMakeEthLocalSubMskWAIT=45,  
      rCtlMakeEthLocalGatewWAIT= 46, 
   rCtlMakeStrWAIT_Last     = 46, // LAST of a linear series that uses MakeFilenameStr

   rCtlRTCAdjWAIT_First     = 47, // FIRST of a linear series that uses RTCAdjust
      rCtlRTCAdj_Hrs_Up_WAIT   = 47, 
      rCtlRTCAdj_Hrs_Dn_WAIT   = 48, 
      rCtlRTCAdj_Min_Up_WAIT   = 49, 
      rCtlRTCAdj_Min_Dn_WAIT   = 50, 
      rCtlRTCAdj_Sec_Up_WAIT   = 51, 
      rCtlRTCAdj_Sec_Dn_WAIT   = 52, 
   rCtlRTCAdjWAIT_Last      = 52, // LAST of a linear series that uses RTCAdjust
   rCtlForceEthInitWAIT     = 53,
   rCtlExtPortCheckWAIT     = 54,
   rCtlExpPortDMAWAIT       = 55,
   rCtlRunningIEC          = 56, // external IEC PRG: next IO handler, independent of Teensy menu selection
   rCtlFileCopyWAIT        = 57,
   rCtlFilePasteWAIT       = 58,
   rCtlFileDeletePrepareWAIT = 59,
   rCtlFileCancel          = 60,
   rCtlFileDeleteConfirmWAIT = 61,
   rCtlFirmwarePrepareWAIT = 62,
   rCtlFirmwareCheckWAIT   = 63,
   rCtlFirmwareCancel      = 64,
   rCtlStorageRefreshWAIT  = 65,
   rCtlDesktopAppLoad      = 66, // synchronously prepare the selected built-in desktop utility stream
   rCtlFirmwareDiscoverWAIT = 71, // Once per desktop entry: capture strictly newer SD-root firmware without changing the view
   
};

enum RegDesktopApps
{
   rdaSnake          = 0,
   rdaCalculator     = 1,
   rdaTextViewer     = 2,
   rdaTextFile       = 3, // existing text-viewer mode for the selected file
   rdaClock          = 4,
   rdaCount          = 5,
   rdaLaunchPending  = 0x80, // legacy menu asks DesktopShell to open the selected utility after startup
};
                                 
enum regItemTypes //synch with TblItemType
{
   rtNone        = 0,
   rtUnknown     = 1,
   rtDirectory   = 2,  //file extensions hideable higher than this
   rtD64         = 3,
   rtD71         = 4, 
   rtD81         = 5, 
   rtFilePrg     = 6,   //always first valid executable file type
   rtFileCrt     = 7, 
   rtFileHex     = 8, 
   rtFileP00     = 9, 
   rtFileSID     = 10,
   rtFileKla     = 11,
   rtFileArt     = 12, 
   rtFileTxt     = 13, 
   rtFilePETSCII = 14, 
   rtBin16k      = 15, 
   rtBin8kHi     = 16, 
   rtBin8kLo     = 17, 
   rtBinC128     = 18, 
   rtFileREU     = 19,
   rtFileDesktopApp = 20, // flash-backed $c000 utility; requires the native desktop runtime
   rtFileVM      = 21, // manifest-associated content; revalidate before reset

   //127 max, bit 7 used to indicate assigned IOH to TR
   //TblItemType mult by 4 further limits to 63 max!
};

//   !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!  End C64 matching  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


struct StructMenuItem
{
  unsigned char ItemType;       //1  regItemTypes 
  uint8_t IOHndlrAssoc;         //1  enumIOHandlers (Teensy Mem Menu only)
  char *Name;                   //4
  uint8_t *Code_Image;          //1
  uint32_t Size;                //4
};

enum enumIOHandlers //Synch order/qty with IOHandler[] (IOHandlers.h)
{
//manually selectable:
   IOH_None,   //always 0
#ifndef MinimumBuild
   // only supported in full build:
      IOH_Swiftlink,
      IOH_MIDI_Datel,      
      IOH_MIDI_Sequential, 
      IOH_MIDI_Passport,   
      IOH_MIDI_NamesoftIRQ,
   #ifdef Fab04_REU
      IOH_REU,
   #endif 
   #ifdef Fab04_KernalReplace
      IOH_KernalReplace,
   #endif  
      IOH_Debug, //last manually selectable, see LastSelectableIOH

   //*not* manually selectable, see LastSelectableIOH
      
      IOH_TeensyROM, 
   #ifdef Fab04_Freezers
      IOH_SuperSnapshotV5,
      IOH_RetroReplay,
      IOH_FinalCartridgeIII,
      IOH_ActionReplay,
   #endif
      IOH_ASID,
      IOH_TR_BASIC,
#endif  //full build only above here

   IOH_EpyxFastLoad,
   IOH_MagicDesk,
   IOH_Dinamic,
   IOH_Ocean1,
   IOH_FunPlay,
   IOH_SuperGames,
   IOH_C64GameSystem3,
   IOH_EasyFlash,
   IOH_ZaxxonSuper,
   IOH_GMod2,
   IOH_MagicDesk2,
   
   
   IOH_Num_Handlers       //always last
};

#define LastSelectableIOH  IOH_Debug     //127 max.  Used in IOH_TeensyROM.c for Special IO display/select
