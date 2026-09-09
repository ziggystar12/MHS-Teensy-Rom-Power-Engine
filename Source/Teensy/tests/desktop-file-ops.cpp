#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <map>
#include <string>
#include <vector>
#include "../MinimalBoot/Common/Menu_Regs.h"
#include "../DesktopFileOpsCore.h"

struct FakeStorage {
   struct Entry { std::vector<uint8_t> bytes; bool directory = false; uint32_t modified = 1; };
   std::map<std::string, Entry> files;
   bool present[2] = {true, true};
   bool failRead = false, shortRead = false, failWrite = false, failSync = false;
   bool failRemove = false, failRename = false, failCreate = false, corrupt = false;
   size_t biggestRead = 0;
   std::string reading, writing;
   size_t offset = 0;
   static std::string key(uint8_t device, const char* path) { return std::to_string(device) + ':' + path; }
   FakeStorage() {
      for (int device = 0; device != 2; ++device) {
         files[key(device, "/")].directory = true;
         files[key(device, "/out")].directory = true;
      }
   }
   void add(uint8_t device, const char* path, size_t size) {
      auto& entry = files[key(device, path)];
      entry.bytes.resize(size);
      for (size_t i = 0; i < size; ++i) entry.bytes[i] = (uint8_t)((i*37 + i/11) & 255);
   }
   bool ready(uint8_t device) { return device < 2 && present[device]; }
   bool exists(uint8_t device, const char* path) { return ready(device) && files.count(key(device, path)); }
   bool stat(uint8_t device, const char* path, DesktopFiles::Info& info) {
      if (!exists(device, path)) return false;
      auto& entry = files.at(key(device, path));
      info = {entry.bytes.size(), entry.modified, entry.directory}; return true;
   }
   bool openRead(uint8_t device, const char* path) {
      if (!exists(device, path)) return false;
      reading = key(device, path); offset = 0; return true;
   }
   bool createNew(uint8_t device, const char* path) {
      if (failCreate || !ready(device) || exists(device, path)) return false;
      writing = key(device, path); files[writing] = {}; return true;
   }
   int read(uint8_t* data, size_t count) {
      biggestRead = std::max(biggestRead, count);
      if (failRead || reading.empty()) return -1;
      auto& bytes = files.at(reading).bytes;
      size_t received = std::min(count, bytes.size() - offset);
      if (shortRead && received) --received;
      std::copy_n(bytes.data() + offset, received, data); offset += received;
      return (int)received;
   }
   size_t write(const uint8_t* data, size_t count) {
      auto& bytes = files.at(writing).bytes;
      size_t written = failWrite && count ? count-1 : count;
      bytes.insert(bytes.end(), data, data + written); return written;
   }
   void closeRead() { reading.clear(); }
   void closeWrite() { writing.clear(); }
   bool finishWrite(uint32_t expected) {
      bool ok = !failSync && files.at(writing).bytes.size() == expected;
      if (corrupt && !files.at(writing).bytes.empty()) files.at(writing).bytes[0] ^= 1;
      closeWrite(); return ok;
   }
   bool remove(uint8_t device, const char* path) {
      if (failRemove || !ready(device)) return false;
      return files.erase(key(device, path)) != 0;
   }
   bool renameNew(uint8_t device, const char* from, const char* to) {
      if (failRename || exists(device, to) || !exists(device, from)) return false;
      files[key(device, to)] = files.at(key(device, from));
      files.erase(key(device, from)); return true;
   }
   bool temporaryExists() const {
      for (const auto& file : files) if (file.first.find(".tr-copy-") != std::string::npos) return true;
      return false;
   }
};
using Engine = DesktopFiles::Engine<FakeStorage>;

static void run(Engine& engine) {
   unsigned count = 0;
   while (engine.state == rfosBusy && count++ < 1000) engine.step();
   assert(count < 1000);
   assert(strlen(engine.message) <= 39);
}

int main() {
   static_assert(rRegFileOpState == 63 && rRegFileOpProgress == 104 && rRegFileClipboard == 105, "protocol");
   static_assert(rCtlFileCopyWAIT == 57 && rCtlFileDeleteConfirmWAIT == 61 && rfosDeleteReady == 6, "protocol");
   unsigned scenarios = 0;
   // Cross-device copies in both directions, same-device copy, and empty files.
   for (uint8_t source = 0; source != 2; ++source) for (uint8_t destination = 0; destination != 2; ++destination)
   for (size_t size : {size_t(0), size_t(1), size_t(4096), size_t(20001)}) {
      FakeStorage fs; Engine engine(fs); fs.add(source, "/game.d64", size);
      engine.copy(source, "/", "game.d64"); assert(engine.state == rfosCopied && engine.clipboard);
      engine.paste(destination, "/out"); assert(engine.state == rfosBusy);
      assert(!fs.exists(destination, "/out/game.d64")); run(engine);
      assert(engine.state == rfosPasted && engine.progress == 100 && engine.clipboard);
      assert(fs.files.at(FakeStorage::key(source, "/game.d64")).bytes == fs.files.at(FakeStorage::key(destination, "/out/game.d64")).bytes);
      assert(fs.biggestRead <= 4096 && !fs.temporaryExists()); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/file.hex", 100);
      engine.copy(1, "/", "file.hex"); engine.paste(1, "/");
      assert(engine.state == rfosExists && fs.files.at("1:/file.hex").bytes.size() == 100 && !fs.temporaryExists());
      engine.paste(0, "/out"); run(engine); assert(engine.state == rfosPasted);
      engine.prepareDelete(0, "/out", "file.hex"); assert(engine.state == rfosDeleteReady);
      engine.confirmDelete(); assert(engine.state == rfosDeleted && !fs.exists(0, "/out/file.hex")); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/file.prg", 9000); fs.add(0, "/out/file.prg", 6);
      auto before = fs.files.at("0:/out/file.prg").bytes;
      engine.copy(1, "/", "file.prg"); engine.paste(0, "/out");
      assert(engine.state == rfosExists && fs.files.at("0:/out/file.prg").bytes == before && !fs.temporaryExists()); ++scenarios;
   }
   // Inject short reads, hard read failures, full disk/short writes, sync errors,
   // silent corruption, and rename failures into the exact production engine.
   for (unsigned fault = 0; fault != 6; ++fault) {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); engine.paste(0, "/out");
      if (fault == 0) fs.failRead = true;
      if (fault == 1) fs.shortRead = true;
      if (fault == 2) fs.failWrite = true;
      if (fault == 3) fs.failSync = true;
      if (fault == 4) fs.corrupt = true;
      if (fault == 5) fs.failRename = true;
      run(engine);
      assert(engine.state >= 0x80 && !fs.exists(0, "/out/source") && !fs.temporaryExists());
      assert(fs.exists(1, "/source") && fs.reading.empty() && fs.writing.empty()); ++scenarios;
   }
   // Cancel both during copying and during verification; clipboard remains reusable.
   for (bool verify : {false, true}) {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); engine.paste(0, "/out"); engine.step();
      if (verify) while (engine.progress < 50) engine.step();
      engine.cancel(); assert(engine.state == rfosCancelled && engine.clipboard && !fs.temporaryExists());
      assert(!fs.exists(0, "/out/source") && fs.reading.empty() && fs.writing.empty());
      engine.paste(0, "/out"); run(engine); assert(engine.state == rfosPasted); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); engine.paste(0, "/out"); engine.step(); fs.failRemove = true;
      engine.cancel(); assert(engine.state == rfosCleanupError && fs.temporaryExists() && !fs.exists(0, "/out/source")); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); engine.paste(0, "/out"); fs.present[1] = false; run(engine);
      assert(engine.state == rfosMediaError && !fs.temporaryExists()); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); engine.paste(0, "/out"); fs.present[0] = false; run(engine);
      assert(engine.state == rfosCleanupError && fs.temporaryExists() && fs.reading.empty() && fs.writing.empty()); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); fs.files.erase("1:/source"); engine.paste(0, "/out");
      assert(engine.state == rfosSourceError && !fs.temporaryExists()); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); engine.paste(0, "/out"); fs.files.at("1:/source").modified++; run(engine);
      assert(engine.state == rfosSourceError && !fs.temporaryExists()); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 9000);
      engine.copy(1, "/", "source"); engine.paste(0, "/out"); fs.add(0, "/out/source", 2); run(engine);
      assert(engine.state == rfosExists && !fs.temporaryExists() && fs.files.at("0:/out/source").bytes.size() == 2); ++scenarios;
   }
   // Delete is two-phase and never consults a changed selection. No directory
   // removal, no effect before confirmation, and cancel invalidates confirmation.
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/one", 50); fs.add(1, "/two", 50);
      engine.confirmDelete(); assert(engine.state == rfosNoPendingDelete);
      engine.copy(1, "/", "one"); engine.prepareDelete(1, "/", "one");
      assert(engine.locked() && fs.exists(1, "/one"));
      engine.prepareDelete(1, "/", "two"); assert(!strcmp(engine.name, "one"));
      engine.confirmDelete(); assert(!fs.exists(1, "/one") && fs.exists(1, "/two") && !engine.clipboard);
      engine.prepareDelete(1, "/", "two"); engine.cancel(); engine.confirmDelete();
      assert(engine.state == rfosNoPendingDelete && fs.exists(1, "/two")); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/one", 50);
      engine.prepareDelete(1, "/", "one"); fs.files.at("1:/one").modified++;
      engine.confirmDelete(); assert(engine.state == rfosSourceError && fs.exists(1, "/one"));
      engine.prepareDelete(1, "/", "one"); fs.failRemove = true;
      engine.confirmDelete(); assert(engine.state == rfosDeleteError && fs.exists(1, "/one")); ++scenarios;
   }
   {
      FakeStorage fs; Engine engine(fs); fs.add(1, "/source", 5);
      engine.paste(1, "/out"); assert(engine.state == rfosNoClipboard);
      engine.copy(2, "/", "source"); assert(engine.state == rfosUnsupported);
      engine.copy(1, "/disk.d64*", "source"); assert(engine.state == rfosInvalidPath);
      engine.copy(1, "/", "out"); assert(engine.state == rfosUnsupported);
      engine.copy(1, "/", "../source"); assert(engine.state == rfosInvalidPath);
      engine.copy(1, "/out/..", "source"); assert(engine.state == rfosInvalidPath);
      engine.copy(1, "/", "source"); engine.paste(2, "/"); assert(engine.state == rfosUnsupported);
      engine.paste(1, "/source"); assert(engine.state == rfosMediaError);
      std::string name(256, 'x'); engine.copy(1, "/", name.c_str()); assert(engine.state == rfosInvalidPath); ++scenarios;
      engine.copy(1, "/", "hidden\x01name"); assert(engine.state == rfosUnsupported);
      engine.prepareDelete(1, "/", "caf\xc3\xa9.prg"); assert(engine.state == rfosUnsupported);
   }
   {
      FakeStorage fs; Engine engine(fs); std::string name(255, 'x'); fs.add(1, ('/' + name).c_str(), 9);
      engine.copy(1, "/", name.c_str()); assert(engine.state == rfosCopied && strlen(engine.name) == 255);
      engine.paste(0, "/out"); run(engine); assert(engine.state == rfosPasted); ++scenarios;
   }
   std::cout << scenarios << " desktop file operation scenarios passed\n";
}
