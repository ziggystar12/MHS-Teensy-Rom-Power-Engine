// Desktop file operations. This storage-independent engine is also compiled by
// the host fault-injection tests; it does not allocate, recurse, or use EEPROM.
#ifndef DESKTOP_FILE_OPS_CORE_H
#define DESKTOP_FILE_OPS_CORE_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#ifndef DESKTOP_FILE_CODE
#define DESKTOP_FILE_CODE
#endif

namespace DesktopFiles {
static const size_t PathCapacity = 512;
static const size_t NameCapacity = 256;
static const size_t ChunkSize = 4096;
struct Info { uint64_t size; uint32_t modified; bool directory; };

template<class Storage> class Engine {
public:
   explicit Engine(Storage& storage) : fs(storage) {}
   uint8_t state = rfosIdle, progress = 0;
   bool clipboard = false;
   char name[NameCapacity] = "";
   const char* message = "";
   bool locked() const { return state == rfosBusy || state == rfosDeleteReady; }

   // Called only when idle. Rejecting a new request must not strand an open copy.
   DESKTOP_FILE_CODE void reject(uint8_t result, const char* text) {
      if (!locked()) { name[0] = 0; finish(result, text); }
   }

   DESKTOP_FILE_CODE void copy(uint8_t device, const char* directory, const char* filename) {
      if (locked()) return;
      char path[PathCapacity];
      Info info;
      if (!selected(device, directory, filename, path, info)) return;
      strcpy(clipPath, path);
      strcpy(clipName, filename);
      clipDevice = device;
      clipboard = true;
      strcpy(name, filename);
      progress = 0;
      finish(rfosCopied, "File copied to clipboard");
   }

   DESKTOP_FILE_CODE void paste(uint8_t device, const char* directory) {
      if (locked()) return;
      progress = 0;
      name[0] = 0;
      if (!clipboard) { finish(rfosNoClipboard, "Clipboard is empty"); return; }
      strcpy(name, clipName);
      if (!validDirectory(device, directory)) return;
      Info info;
      if (!fs.stat(device, directory, info) || !info.directory) {
         finish(rfosMediaError, "Destination folder unavailable"); return;
      }
      if (!join(directory, clipName, destination)) {
         finish(rfosInvalidPath, "Path or filename is too long"); return;
      }
      if (fs.exists(device, destination)) {
         finish(rfosExists, "Destination already exists"); return;
      }
      if (!fs.ready(clipDevice) || !fs.stat(clipDevice, clipPath, sourceInfo) || sourceInfo.directory) {
         finish(rfosSourceError, "Source file unavailable"); return;
      }
      if (sourceInfo.size > UINT32_MAX) {
         finish(rfosSourceError, "File is too large"); return;
      }
      destDevice = device;
      if (!fs.openRead(clipDevice, clipPath)) {
         finish(rfosSourceError, "Cannot read source file"); return;
      }
      // Only a new private temporary file is written. A failed/cancelled copy
      // never exposes an incomplete file under the requested destination name.
      bool created = false;
      for (unsigned attempt = 0; attempt < 32; ++attempt) {
         char temporaryName[32];
         snprintf(temporaryName, sizeof(temporaryName), ".tr-copy-%08lx.tmp", (unsigned long)++sequence);
         if (!join(directory, temporaryName, temporary)) break;
         if (!fs.exists(device, temporary)) {
            created = fs.createNew(device, temporary);
            break;
         }
      }
      if (!created) {
         fs.closeRead();
         finish(rfosWriteError, "Cannot create destination file"); return;
      }
      ownsTemporary = true;
      offset = 0;
      sourceCRC = verifyCRC = 0xffffffffU;
      verifying = false;
      finish(rfosBusy, "Copying file...");
   }

   DESKTOP_FILE_CODE void prepareDelete(uint8_t device, const char* directory, const char* filename) {
      if (locked()) return;
      if (!selected(device, directory, filename, pendingPath, pendingInfo)) return;
      pendingDevice = device;
      strcpy(name, filename);
      progress = 0;
      finish(rfosDeleteReady, "Delete this file permanently?");
   }

   DESKTOP_FILE_CODE void confirmDelete() {
      if (state != rfosDeleteReady) {
         if (!locked()) finish(rfosNoPendingDelete, "No file selected for deletion");
         return;
      }
      // This is the prepared full path, never the browser's current selection.
      Info now;
      if (!fs.ready(pendingDevice) || !fs.stat(pendingDevice, pendingPath, now) || now.directory) {
         finish(rfosSourceError, "Selected file unavailable"); return;
      }
      if (now.size != pendingInfo.size || now.modified != pendingInfo.modified) {
         finish(rfosSourceError, "File changed; select it again"); return;
      }
      if (!fs.remove(pendingDevice, pendingPath)) {
         finish(rfosDeleteError, "Could not delete file"); return;
      }
      if (clipboard && clipDevice == pendingDevice && samePath(clipPath, pendingPath)) clipboard = false;
      progress = 100;
      finish(rfosDeleted, "File permanently deleted");
   }

   DESKTOP_FILE_CODE void cancel() {
      if (state == rfosBusy) { abort(rfosCancelled, "Copy cancelled"); return; }
      if (state == rfosDeleteReady) finish(rfosCancelled, "Delete cancelled");
   }

   DESKTOP_FILE_CODE void step() {
      if (state != rfosBusy) return;
      if (!fs.ready(clipDevice) || !fs.ready(destDevice)) {
         abort(rfosMediaError, "Storage device disconnected"); return;
      }
      const uint32_t size = (uint32_t)sourceInfo.size;
      if (offset < size) {
         const size_t count = size - offset < ChunkSize ? size - offset : ChunkSize;
         const int received = fs.read(buffer, count);
         if (received != (int)count) { abort(rfosReadError, "File read failed"); return; }
         if (verifying) verifyCRC = crc(verifyCRC, buffer, count);
         else {
            sourceCRC = crc(sourceCRC, buffer, count);
            if (fs.write(buffer, count) != count) { abort(rfosWriteError, "Write failed; disk may be full"); return; }
         }
         offset += count;
         progress = (verifying ? 50 : 0) + (uint8_t)((uint64_t)offset * 49 / (size ? size : 1));
         return; // one bounded data chunk per firmware poll
      }
      fs.closeRead();
      if (!verifying) {
         const bool flushed = fs.finishWrite(size);
         Info now;
         if (!flushed || !fs.stat(destDevice, temporary, now) || now.size != size) {
            abort(rfosWriteError, "Could not finish destination file"); return;
         }
         if (!fs.stat(clipDevice, clipPath, now) || now.size != sourceInfo.size || now.modified != sourceInfo.modified) {
            abort(rfosSourceError, "Source changed during copy"); return;
         }
         if (!fs.openRead(destDevice, temporary)) {
            abort(rfosReadError, "Cannot verify destination file"); return;
         }
         verifying = true;
         offset = 0;
         progress = 50;
         message = "Verifying copied file...";
         return;
      }
      if (sourceCRC != verifyCRC) { abort(rfosVerifyError, "Copied file verification failed"); return; }
      if (fs.exists(destDevice, destination)) { abort(rfosExists, "Destination already exists"); return; }
      if (!fs.renameNew(destDevice, temporary, destination)) {
         abort(rfosWriteError, "Could not finish destination file"); return;
      }
      ownsTemporary = false;
      progress = 100;
      finish(rfosPasted, "File pasted successfully");
   }

private:
   Storage& fs;
   uint8_t clipDevice = 0, destDevice = 0, pendingDevice = 0;
   char clipPath[PathCapacity] = "", clipName[NameCapacity] = "";
   char pendingPath[PathCapacity] = "", destination[PathCapacity] = "", temporary[PathCapacity] = "";
   Info sourceInfo = {}, pendingInfo = {};
   uint32_t offset = 0, sequence = 0, sourceCRC = 0, verifyCRC = 0;
   bool ownsTemporary = false, verifying = false;
   uint8_t buffer[ChunkSize];

   void finish(uint8_t result, const char* text) { message = text; state = result; }
   DESKTOP_FILE_CODE void abort(uint8_t result, const char* text) {
      fs.closeRead();
      fs.closeWrite();
      if (ownsTemporary && !fs.remove(destDevice, temporary)) {
         ownsTemporary = false;
         finish(rfosCleanupError, "Partial .tr-copy file needs deletion"); return;
      }
      ownsTemporary = false;
      finish(result, text);
   }
   DESKTOP_FILE_CODE bool validDirectory(uint8_t device, const char* directory) {
      if (device != rmtSD && device != rmtUSBDrive) {
         finish(rfosUnsupported, "Use an SD or USB folder"); return false;
      }
      if (!directory || directory[0] != '/' || strlen(directory) >= PathCapacity || strchr(directory, '*')) {
         finish(rfosInvalidPath, "Use a folder outside disk images"); return false;
      }
      // Reject path traversal and virtual path components, including trailing /..
      for (const char* part = directory; *part;) {
         if (*part == '/') { ++part; continue; }
         const char* end = strchr(part, '/');
         size_t count = end ? (size_t)(end - part) : strlen(part);
         if ((count == 1 && part[0] == '.') || (count == 2 && part[0] == '.' && part[1] == '.')) {
            finish(rfosInvalidPath, "Invalid folder path"); return false;
         }
         part += count;
      }
      if (!fs.ready(device)) { finish(rfosMediaError, "Storage device unavailable"); return false; }
      return true;
   }
   DESKTOP_FILE_CODE bool selected(uint8_t device, const char* directory, const char* filename, char* path, Info& info) {
      name[0] = 0;
      if (!validDirectory(device, directory)) return false;
      if (!filename || !filename[0] || strlen(filename) >= NameCapacity ||
          strchr(filename, '/') || strchr(filename, '\\') || strchr(filename, '*') ||
          !strcmp(filename, ".") || !strcmp(filename, "..") || !join(directory, filename, path)) {
         finish(rfosInvalidPath, "Select a regular file"); return false;
      }
      // The file-operation serial-string channel sends raw ASCII to the C64
      // filename font. Reject names it cannot display in full before confirming.
      for (const unsigned char* p = (const unsigned char*)filename; *p; ++p) {
         if (*p < 32 || *p > 126) {
            finish(rfosUnsupported, "Filename cannot be displayed safely"); return false;
         }
      }
      if (!fs.stat(device, path, info)) { finish(rfosSourceError, "Selected file unavailable"); return false; }
      if (info.directory) { finish(rfosUnsupported, "Folders are not supported"); return false; }
      return true;
   }
   static bool join(const char* directory, const char* filename, char* out) {
      const size_t length = strlen(directory);
      const int written = snprintf(out, PathCapacity, "%s%s%s", directory,
                                   length && directory[length-1] == '/' ? "" : "/", filename);
      return written > 0 && (size_t)written < PathCapacity;
   }
   static bool samePath(const char* a, const char* b) {
      while (*a && *b) {
         const char x = (*a >= 'A' && *a <= 'Z') ? *a + ('a'-'A') : *a;
         const char y = (*b >= 'A' && *b <= 'Z') ? *b + ('a'-'A') : *b;
         if (x != y) return false;
         ++a; ++b;
      }
      return *a == *b;
   }
   DESKTOP_FILE_CODE static uint32_t crc(uint32_t value, const uint8_t* data, size_t count) {
      while (count--) {
         value ^= *data++;
         for (unsigned bit = 0; bit < 8; ++bit) value = (value >> 1) ^ (0xedb88320U & (0U - (value & 1U)));
      }
      return value;
   }
};
}
#endif
