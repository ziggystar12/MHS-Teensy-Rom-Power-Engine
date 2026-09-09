// Included in the full GUI backend. All captures/checks run from the main-loop
// WAIT dispatcher; the IO ISR only publishes an operation or returns one byte.
#include "../../../DesktopFirmwareTarget.h"
#include "../../../DesktopFirmwareVersion.h"
static DesktopFirmwareTarget DesktopFirmware;
static StructMenuItem DesktopFirmwareItem;
static bool DesktopFirmwareStartup = false, DesktopFirmwareScanned = false;
static bool DesktopFirmwareCRCValid = false;
static uint32_t DesktopFirmwareCRC = 0;
static uint32_t DesktopFirmwareSDGeneration = 0;
static volatile uint32_t DesktopFirmwareGeneration = 0;

#ifndef DESKTOP_FIRMWARE_TEST_HOOK
#define DESKTOP_FIRMWARE_TEST_HOOK(Point) ((void)0)
#endif
#define DesktopFirmwareHookAfterDispatchSnapshot 1
#define DesktopFirmwareHookDiscoverEntry 2
#define DesktopFirmwareHookExpectedCRC 3

static void DesktopFirmwareClearTarget() {
   DesktopFirmwareStartup = false;
   DesktopFirmwareScanned = false;
   DesktopFirmwareCRCValid = false;
   DesktopFirmware.cancel();
   IO1[rRegFirmwareTargetState] = DesktopFirmwareTarget::Idle;
}

static bool DesktopFirmwareGenerationCurrent(uint32_t generation) {
   __asm__ volatile("" ::: "memory");
   return generation == DesktopFirmwareGeneration;
}

void DesktopFirmwareCancel() {
   ++DesktopFirmwareGeneration;
   DesktopFirmwareClearTarget();
}

void DesktopFirmwareResetDiscovery() { DesktopFirmwareScanned = false; }

FLASHMEM static uint32_t DesktopFirmwareCRCByte(uint32_t value, uint8_t byte) {
   static const uint32_t table[16]={
      0x00000000u,0x1db71064u,0x3b6e20c8u,0x26d930acu,
      0x76dc4190u,0x6b6b51f4u,0x4db26158u,0x5005713cu,
      0xedb88320u,0xf00f9344u,0xd6d6a3e8u,0xcb61b38cu,
      0x9b64c2b0u,0x86d3d2d4u,0xa00ae278u,0xbdbdf21cu
   };
   value^=byte;
   value=(value>>4)^table[value&15];
   return (value>>4)^table[value&15];
}

// Read-only, bounded storage. This runs only after the user chooses Update;
// startup discovery itself now enumerates names and returns immediately.
FLASHMEM static bool DesktopFirmwareFingerprint(uint8_t device, const char* path,
                                                uint32_t expectedSize,
                                                uint32_t expectedGeneration,
                                                uint32_t& crc) {
   FS* sourceFS=device==rmtSD ? (FS*)&SD :
      (device==rmtUSBDrive ? (FS*)&firstPartition : NULL);
   if (!sourceFS || !expectedSize || !DesktopFirmwareGenerationCurrent(expectedGeneration)) return false;
   // SD.mediaPresent() is an active CMD13/status transaction on Teensy 4.1.
   // SdFat's FIFO reader can retain a multi-sector read between file.read()
   // calls, including a stream from the preceding directory operation. A
   // status failure makes mediaPresent() switch DAT3 to GPIO and destroys the
   // live transfer. Validate this file through FS reads, never a second SDIO
   // command stream. Short/error reads, size/EOF and cancellation still fail
   // closed; the flasher independently checks this CRC before committing.
   File file=sourceFS->open(path,FILE_READ);
   if (!file || file.isDirectory() || file.size()!=expectedSize) { file.close(); return false; }
   uint8_t buffer[1024];
   uint32_t remaining=expectedSize, value=UINT32_MAX;
   while (remaining) {
      const size_t count=remaining<sizeof buffer ? remaining : sizeof buffer;
      const int read=file.read(buffer,count);
      if (read<=0 || size_t(read)>count ||
          !DesktopFirmwareGenerationCurrent(expectedGeneration)) { file.close(); return false; }
      for (int i=0; i<read; ++i) value=DesktopFirmwareCRCByte(value,buffer[i]);
      remaining-=uint32_t(read);
   }
   const bool complete=file.size()==expectedSize && file.read(buffer,1)==0 &&
      DesktopFirmwareGenerationCurrent(expectedGeneration);
   file.close();
   if (!complete) return false;
   crc=~value;
   return true;
}

FLASHMEM static void DesktopFirmwareDiscover(uint32_t generation) {
   DESKTOP_FIRMWARE_TEST_HOOK(DesktopFirmwareHookDiscoverEntry);
   if (!DesktopFirmwareGenerationCurrent(generation)) return;
   if (DesktopFirmwareScanned && DesktopFirmwareSDGeneration==SDMediaGeneration()) return;
   DesktopFirmwareClearTarget();
   if (!DesktopFirmwareGenerationCurrent(generation)) return;
   // One shared helper owns the settled DAT3 probe, mount caching and media
   // generation. Empty sockets never enter the multi-second SD.begin path.
   if (!SDFullInit()) {
      if (!DesktopFirmwareGenerationCurrent(generation)) return;
      DesktopFirmwareScanned=true;
      DesktopFirmwareSDGeneration=SDMediaGeneration();
      return;
   }
   DesktopFirmwareVersions::Version best;
   if (!DesktopFirmwareVersions::installed(best)) return;
   File directory=SD.open("/",FILE_READ);
   if (!directory || !directory.isDirectory()) { directory.close(); return; }
   char candidate[sizeof DesktopFirmware.name]="";
   uint32_t candidateSize=0;
   while (File entry=directory.openNextFile()) {
      if (!DesktopFirmwareGenerationCurrent(generation) || !SD.mediaPresent()) {
         entry.close();
         directory.close();
         return;
      }
      DesktopFirmwareVersions::Version version;
      const char* name=entry.name();
       // Startup discovery is deliberately strictly newer-only. A test image
       // may keep the installed visible version, but users select that image
       // manually from SD; otherwise the installed root file would prompt on
       // every boot. Lower and equal versions remain manual-only.
       if (!entry.isDirectory() && name && strlen(name)<sizeof candidate &&
           DesktopFirmwareVersions::filename(name,version) && DesktopFirmwareVersions::compare(version,best)>0) {
         best=version;
         strcpy(candidate,name);
         const uint64_t size=entry.size();
         candidateSize=size<=UINT32_MAX ? uint32_t(size) : 0;
      }
      entry.close();
   }
   directory.close();
   if (!DesktopFirmwareGenerationCurrent(generation) || !SD.mediaPresent()) return;
   // Empty scans remain retryable when the user explicitly opens or refreshes
   // SD later. Ordinary desktop redraws never issue discovery commands.
   if (!candidate[0]) {
      DesktopFirmwareScanned=true;
      DesktopFirmwareSDGeneration=SDMediaGeneration();
      if (!DesktopFirmwareGenerationCurrent(generation)) DesktopFirmwareClearTarget();
      return;
   }
   DesktopFirmwareStartup=true;
   DesktopFirmwareCRCValid=false;
   if (DesktopFirmware.prepare((uintptr_t)&DesktopFirmwareItem,0,rmtSD,rtFileHex,
       candidateSize,"/",candidate,true))
      DesktopFirmwareItem={rtFileHex,0,DesktopFirmware.name,NULL,candidateSize};
   if (DesktopFirmware.state!=DesktopFirmwareTarget::Ready || !DesktopFirmwareGenerationCurrent(generation)) {
      DesktopFirmwareClearTarget();
      return;
   }
   DesktopFirmwareScanned=true; // Deduplicate until Cancel or media refresh.
   DesktopFirmwareSDGeneration=SDMediaGeneration();
   IO1[rRegFirmwareTargetState]=DesktopFirmware.state;
   if (!DesktopFirmwareGenerationCurrent(generation)) DesktopFirmwareClearTarget();
}

FLASHMEM static bool DesktopFirmwareCheck(uint32_t generation) {
   if (!DesktopFirmwareGenerationCurrent(generation)) return false;
   if (DesktopFirmwareStartup) {
      char path[sizeof DesktopFirmware.name+1];
      uint32_t crc=0;
      const bool ready=DesktopFirmware.armed && DesktopFirmware.state==DesktopFirmwareTarget::Ready &&
         DesktopFirmware.pathName(path,sizeof path) &&
         DesktopFirmwareFingerprint(rmtSD,path,DesktopFirmware.size,generation,crc);
      if (!DesktopFirmwareGenerationCurrent(generation)) return false;
      if (ready) { DesktopFirmwareCRC=crc; DesktopFirmwareCRCValid=true; }
      else { DesktopFirmwareCRCValid=false; DesktopFirmware.state=DesktopFirmwareTarget::Changed; }
      IO1[rRegFirmwareTargetState]=DesktopFirmware.state;
      if (!DesktopFirmwareGenerationCurrent(generation)) {
         DesktopFirmwareClearTarget();
         return false;
      }
      return ready;
   }
   const bool valid = MenuViewSelectionValid();
   const uint8_t source = IO1[rWRegCurrMenuWAIT];
   const StructMenuItem* item = valid ? &MenuSource[SelItemFullIdx] : NULL;
   bool ready = DesktopFirmware.check((uintptr_t)MenuSource,SelItemFullIdx,source,
      item ? item->ItemType : 0, item ? item->Size : 0, DriveDirPath,item ? item->Name : NULL,
      valid && (source==rmtSD || source==rmtUSBDrive) && item->ItemType==rtFileHex);
   DesktopFirmwareCRCValid=false;
   uint32_t crc=0;
   char path[sizeof DesktopFirmware.folder+sizeof DesktopFirmware.name+1];
   if (ready) ready=DesktopFirmware.pathName(path,sizeof path) &&
      DesktopFirmwareFingerprint(source,path,DesktopFirmware.size,generation,crc);
   if (ready) { DesktopFirmwareCRC=crc; DesktopFirmwareCRCValid=true; }
   else DesktopFirmware.state=DesktopFirmwareTarget::Changed;
   IO1[rRegFirmwareTargetState] = DesktopFirmware.state;
   if (!DesktopFirmwareGenerationCurrent(generation)) {
      DesktopFirmwareClearTarget();
      return false;
   }
   return ready;
}

FLASHMEM void DesktopFirmwareCommand() {
   const uint32_t generation=DesktopFirmwareGeneration;
   const uint8_t command=IO1[wRegControl];
   DESKTOP_FIRMWARE_TEST_HOOK(DesktopFirmwareHookAfterDispatchSnapshot);
   if (command == rCtlFirmwareCancel || !DesktopFirmwareGenerationCurrent(generation)) return;
   if (command == rCtlFirmwareDiscoverWAIT) {
      DesktopFirmwareDiscover(generation);
      return;
   }
   if (command == rCtlFirmwareCheckWAIT) {
      DesktopFirmware.confirmed = DesktopFirmwareCheck(generation);
      return;
   }
   DesktopFirmwareStartup=false;
   DesktopFirmwareCRCValid=false;
   const bool valid = MenuViewSelectionValid();
   const uint8_t source = IO1[rWRegCurrMenuWAIT];
   const StructMenuItem* item = valid ? &MenuSource[SelItemFullIdx] : NULL;
    if (DesktopFirmware.prepare((uintptr_t)MenuSource,SelItemFullIdx,source,
       item ? item->ItemType : 0, item ? item->Size : 0,DriveDirPath,item ? item->Name : NULL,
       valid && (source==rmtSD || source==rmtUSBDrive) && item->ItemType==rtFileHex))
      DesktopFirmwareItem = *item;
   if (!DesktopFirmwareGenerationCurrent(generation)) DesktopFirmwareClearTarget();
   IO1[rRegFirmwareTargetState] = DesktopFirmware.state;
}

FLASHMEM bool DesktopFirmwareBegin(StructMenuItem& item, uint8_t& source) {
   const uint32_t generation=DesktopFirmwareGeneration;
   bool ready=DesktopFirmware.armed && DesktopFirmware.state==DesktopFirmwareTarget::Ready &&
      DesktopFirmware.confirmed && DesktopFirmwareCRCValid;
   if (ready && !DesktopFirmwareStartup) {
      const bool valid=MenuViewSelectionValid();
      const uint8_t currentSource=IO1[rWRegCurrMenuWAIT];
      const StructMenuItem* current=valid ? &MenuSource[SelItemFullIdx] : NULL;
      ready=DesktopFirmware.check((uintptr_t)MenuSource,SelItemFullIdx,currentSource,
         current ? current->ItemType : 0,current ? current->Size : 0,DriveDirPath,
         current ? current->Name : NULL,valid &&
         (currentSource==rmtSD || currentSource==rmtUSBDrive) && current->ItemType==rtFileHex);
   }
   // Consume only the affirmative. Keep this flow guarded until explicit cancel,
   // new preparation or reset, including when a failed flash returns to the menu.
   DesktopFirmware.confirmed = false;
   if (!DesktopFirmwareGenerationCurrent(generation)) return false;
   if (!ready) {
      DesktopFirmware.state = DesktopFirmwareTarget::Changed;
      IO1[rRegFirmwareTargetState] = DesktopFirmwareTarget::Changed;
      IO1[rRegStrAvailable] = 0;
      SendMsgPrintfln("Firmware selection changed. Choose the file again.");
      return false;
   }
   item = DesktopFirmwareItem;
   item.Name = DesktopFirmware.name;
   source = DesktopFirmware.device;
   return true;
}

FLASHMEM bool DesktopFirmwareExpectedCRC(uint32_t& crc) {
   // Keep the getter fail-closed if Cancel arrives after Begin accepted the
   // target but before HandleExecution retrieves the confirmed fingerprint.
   DESKTOP_FIRMWARE_TEST_HOOK(DesktopFirmwareHookExpectedCRC);
   if (!DesktopFirmware.armed || !DesktopFirmwareCRCValid) return false;
   crc=DesktopFirmwareCRC;
   return true;
}
