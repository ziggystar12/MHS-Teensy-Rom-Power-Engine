// Included by IOH_TeensyROM.c (full firmware only).
#define DESKTOP_FILE_CODE FLASHMEM
#include "../../../DesktopFileOpsCore.h"

class DesktopFileStorage {
   File reader;
   FsFile writer;
   static FS* deviceFS(uint8_t device) { return device == rmtSD ? (FS*)&SD : (FS*)&firstPartition; }
public:
   bool ready(uint8_t device) {
      if (device == rmtSD) return SD.mediaPresent();
      return device == rmtUSBDrive && (bool)firstPartition;
   }
   bool exists(uint8_t device, const char* path) { return deviceFS(device)->exists(path); }
   bool stat(uint8_t device, const char* path, DesktopFiles::Info& info) {
      File file = deviceFS(device)->open(path, FILE_READ);
      if (!file) return false;
      info.size = file.size();
      info.directory = file.isDirectory();
      DateTimeFields modified;
      info.modified = file.getModifyTime(modified) ?
         ((uint32_t)(modified.year-80) << 25) | ((uint32_t)(modified.mon+1) << 21) |
         ((uint32_t)modified.mday << 16) | ((uint32_t)modified.hour << 11) |
         ((uint32_t)modified.min << 5) | (modified.sec/2) : 0;
      file.close();
      return true;
   }
   bool openRead(uint8_t device, const char* path) {
      reader = deviceFS(device)->open(path, FILE_READ);
      if (reader && !reader.isDirectory()) return true;
      reader.close();
      return false;
   }
   bool createNew(uint8_t device, const char* path) {
      // The common Arduino FS interface cannot request exclusive creation;
      // use the underlying SdFat volume shared by both SD and USB instead.
      const oflag_t flags = O_WRONLY | O_CREAT | O_EXCL;
      writer = device == rmtSD ? SD.sdfs.open(path, flags) : firstPartition.mscfs.open(path, flags);
      if (writer && !writer.isDirectory()) return true;
      writer.close();
      return false;
   }
   int read(uint8_t* data, size_t count) { return reader.read(data, count); }
   size_t write(const uint8_t* data, size_t count) { return writer.write(data, count); }
   void closeRead() { reader.close(); }
   void closeWrite() { writer.close(); }
   bool finishWrite(uint32_t expected) {
      const bool synced = writer.sync();
      const bool ok = synced && writer && writer.fileSize() == expected && !writer.getWriteError();
      writer.close();
      return ok;
   }
   bool remove(uint8_t device, const char* path) { return deviceFS(device)->remove(path); }
   bool renameNew(uint8_t device, const char* from, const char* to) {
      return !exists(device, to) && deviceFS(device)->rename(from, to);
   }
};

static DesktopFileStorage DesktopStorage;
DMAMEM static DesktopFiles::Engine<DesktopFileStorage> DesktopFileEngine(DesktopStorage);
static volatile bool DesktopFileCancelRequested = false;
static char DesktopFileMessage[40] = "";
static char DesktopFileName[DesktopFiles::NameCapacity] = "";

bool DesktopFileOperationLocked() { return DesktopFileEngine.locked(); }

FLASHMEM static void DesktopFilePublish() {
   strcpy(DesktopFileName, DesktopFileEngine.name);
   strncpy(DesktopFileMessage, DesktopFileEngine.message, sizeof(DesktopFileMessage)-1);
   DesktopFileMessage[sizeof(DesktopFileMessage)-1] = 0;
   IO1[rRegFileOpProgress] = DesktopFileEngine.progress;
   IO1[rRegFileClipboard] = DesktopFileEngine.clipboard ? 1 : 0;
   IO1[rRegFileOpState] = DesktopFileEngine.state; // publish result last
}

FLASHMEM static void DesktopFileRefresh() {
   const uint8_t oldPage = IO1[rwRegPageNumber];
   const uint16_t oldTop = MenuViewTop;
   const uint8_t oldCursor = IO1[rwRegCursorItemOnPg];
   FS* fs = IO1[rWRegCurrMenuWAIT] == rmtSD ? (FS*)&SD : (FS*)&firstPartition;
   LoadDirectory(fs);
   const uint8_t page = oldPage < 1 ? 1 : oldPage > IO1[rRegNumPages] ? IO1[rRegNumPages] : oldPage;
   IO1[rwRegCursorItemOnPg] = oldCursor;
   if (MenuViewActive == 2) MenuViewSetTop(oldTop);
   else MenuViewSetPage(page); // Clamp against visible files and map the raw selection.
}

FLASHMEM void DesktopFileCommand() {
   const uint8_t command = IO1[wRegControl];
   if (command == rCtlFileDeleteConfirmWAIT) {
      DesktopFileEngine.confirmDelete();
      if (DesktopFileEngine.state == rfosDeleted) DesktopFileRefresh();
   } else if (command == rCtlFilePasteWAIT) {
      DesktopFileEngine.paste(IO1[rWRegCurrMenuWAIT], DriveDirPath);
   } else if (command == rCtlFileCopyWAIT || command == rCtlFileDeletePrepareWAIT) {
      if (IO1[rWRegCurrMenuWAIT] != rmtSD && IO1[rWRegCurrMenuWAIT] != rmtUSBDrive)
         DesktopFileEngine.reject(rfosUnsupported, "Use an SD or USB folder");
      else if (!MenuSource || SelItemFullIdx >= NumItemsFull || MenuSource[SelItemFullIdx].ItemType == rtNone ||
               MenuSource[SelItemFullIdx].ItemType == rtDirectory)
         DesktopFileEngine.reject(rfosUnsupported, "Select a regular file");
      else if (command == rCtlFileCopyWAIT)
         DesktopFileEngine.copy(IO1[rWRegCurrMenuWAIT], DriveDirPath, MenuSource[SelItemFullIdx].Name);
      else DesktopFileEngine.prepareDelete(IO1[rWRegCurrMenuWAIT], DriveDirPath, MenuSource[SelItemFullIdx].Name);
   }
   DesktopFilePublish();
}

FLASHMEM void DesktopFilePoll() {
   if (DesktopFileCancelRequested) {
      DesktopFileCancelRequested = false;
      DesktopFileEngine.cancel();
   } else DesktopFileEngine.step();
   if (IO1[rRegFileOpState] == rfosBusy && DesktopFileEngine.state != rfosBusy) DesktopFileRefresh();
   DesktopFilePublish();
}

// The physical menu/reset button also closes handles and discards pending delete.
FLASHMEM void DesktopFileReset() {
   DesktopFileEngine.cancel();
   DesktopFileCancelRequested = false;
   DesktopFilePublish();
}
