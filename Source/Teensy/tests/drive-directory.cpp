#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "../DriveDirectorySupport.h"

enum : uint8_t { rtUnknown = 1, rtDirectory = 2, rtFilePrg = 6, rtFileTxt = 12 };
static const char *UpDirString = "/.. <Up Dir>";

struct StructMenuItem
{
   uint8_t ItemType;
   const char *Name;
};

static size_t CompareCount = 0;

static int CompareItems(const void *Left, const void *Right)
{
   ++CompareCount;
   const StructMenuItem *LeftItem = static_cast<const StructMenuItem *>(Left);
   const StructMenuItem *RightItem = static_cast<const StructMenuItem *>(Right);
   return DriveDirCompareNames(LeftItem->Name, LeftItem->ItemType,
      RightItem->Name, RightItem->ItemType, rtDirectory, UpDirString);
}

struct Association
{
   char Extension[4];
   uint8_t ItemType;
};

struct FakeSD
{
   bool Inserted = false;
   bool Mounted = false;
   bool FailBegin = false;
   unsigned Probes = 0;
   unsigned Begins = 0;
   unsigned Enumerations = 0;
   uint32_t Generation = 0;
   uint32_t ErrorGeneration = UINT32_MAX;
   bool MountFailed = false;
   uint32_t NowMillis = 0;
   uint32_t ErrorMillis = 0;

   bool mediaPresent() const { return Mounted && Inserted; }
   bool probe()
   {
      ++Probes;
      if (!Inserted) Mounted = false;
      return Inserted;
   }
   bool begin()
   {
      ++Begins;
      Mounted = Inserted && !FailBegin;
      return Mounted;
   }
   void explicitRefresh() { ++Generation; }
};

static bool EnsureMounted(FakeSD &SD)
{
   const bool MediaMounted = SD.mediaPresent();
   const bool CardInserted = MediaMounted ? true : SD.probe();
   switch (DriveSDDecideMount(MediaMounted, CardInserted))
   {
      case DriveSDUseMounted: return true;
      case DriveSDNoCard:
         SD.MountFailed = false;
         return false;
      case DriveSDBeginMount:
         if (!DriveSDMountRetryAllowed(SD.MountFailed, SD.ErrorGeneration, SD.Generation,
             SD.NowMillis - SD.ErrorMillis))
            return false;
         if (SD.begin()) { SD.MountFailed = false; return true; }
         SD.MountFailed = true;
         SD.ErrorGeneration = SD.Generation;
         SD.ErrorMillis = SD.NowMillis;
         return false;
   }
   return false;
}

static bool LoadDirectory(FakeSD &SD)
{
   if (!EnsureMounted(SD)) return false;
   ++SD.Enumerations;
   return true;
}

int main()
{
   unsigned Scenarios = 0;

   const Association Associations[] = {{"prg", rtFilePrg}, {"txt", rtFileTxt}};
   for (const char *Name : {"Game.PRG", "GAME.prg", "Mixed.PrG"})
   {
      const std::string Original(Name);
      assert(DriveDirItemTypeForExtension(Name, Associations, 2, rtUnknown) == rtFilePrg);
      assert(Original == Name);
      ++Scenarios;
   }
   assert(DriveDirItemTypeForExtension("Read.Me.TXT", Associations, 2, rtUnknown) == rtFileTxt);
   assert(DriveDirItemTypeForExtension("NoExtension", Associations, 2, rtUnknown) == rtUnknown);
   assert(DriveDirItemTypeForExtension("Too.LongExtension", Associations, 2, rtUnknown) == rtUnknown);
   Scenarios += 3;

   // Exercise the production ordering policy at the full firmware limit. Start
   // from a deliberately scrambled sequence with a parent in the middle.
   std::vector<std::string> Names;
   std::vector<uint8_t> Types;
   Names.reserve(4000);
   Types.reserve(4000);
   for (unsigned Index = 0; Index < 4000; ++Index)
   {
      if (Index == 1973)
      {
         Names.emplace_back(UpDirString);
         Types.push_back(rtDirectory);
      }
      else if (Index % 11 == 0)
      {
         Names.emplace_back("/Folder" + std::to_string(3999 - Index));
         Types.push_back(rtDirectory);
      }
      else
      {
         const char *Extension = Index & 1 ? ".PRG" : ".txt";
         Names.emplace_back("File" + std::to_string((Index * 1777u) % 4001u) + Extension);
         Types.push_back(Index & 1 ? rtFilePrg : rtFileTxt);
      }
   }
   std::vector<StructMenuItem> Items;
   Items.reserve(Names.size());
   for (size_t Index = 0; Index < Names.size(); ++Index)
      Items.push_back({Types[Index], Names[Index].c_str()});
   const std::vector<std::string> OriginalNames = Names;
   qsort(Items.data(), Items.size(), sizeof Items[0], CompareItems);
   assert(CompareCount < 100000); // O(n log n), far below the old ~8M comparisons
   assert(!strcmp(Items[0].Name, UpDirString));
   bool SawFile = false;
   for (size_t Index = 1; Index < Items.size(); ++Index)
   {
      assert(CompareItems(&Items[Index - 1], &Items[Index]) <= 0);
      if (Items[Index].ItemType != rtDirectory) SawFile = true;
      else assert(!SawFile);
   }
   assert(Names == OriginalNames);
   ++Scenarios;

   DriveDirNamePool Pool = {NULL};
   std::vector<char *> StoredNames;
   StoredNames.reserve(4000);
   size_t ExpectedBytes = 0;
   for (unsigned Index = 0; Index < 4000; ++Index)
   {
      const std::string Name = "MixedCase-" + std::to_string(Index) + ".PrG";
      char *Stored = DriveDirNamePoolAlloc(&Pool, Name.size() + 1);
      assert(Stored != NULL);
      memcpy(Stored, Name.c_str(), Name.size() + 1);
      StoredNames.push_back(Stored);
      ExpectedBytes += Name.size() + 1;
   }
   size_t Blocks = 0, StoredBytes = 0;
   for (DriveDirNameBlock *Block = Pool.Head; Block != NULL; Block = Block->Next)
   {
      ++Blocks;
      StoredBytes += Block->Used;
   }
   assert(Blocks < 32); // thousands of names, a few stable allocations
   assert(StoredBytes == ExpectedBytes);
   for (unsigned Index : {0u, 1u, 2047u, 3999u})
   {
      const std::string Expected = "MixedCase-" + std::to_string(Index) + ".PrG";
      assert(Expected == StoredNames[Index]);
   }
   DriveDirNamePoolClear(&Pool);
   assert(Pool.Head == NULL);
   ++Scenarios;

   // Disk-image entries use the same pool as ordinary directories. Repeated
   // image -> normal directory -> image transitions release every block.
   for (unsigned Cycle = 0; Cycle < 3; ++Cycle)
   {
      for (unsigned Entry = 0; Entry < 144; ++Entry)
         assert(DriveDirNamePoolAlloc(&Pool, 20) != NULL);
      assert(Pool.Head != NULL);
      DriveDirNamePoolClear(&Pool);
      assert(Pool.Head == NULL);
   }
   ++Scenarios;

   FakeSD SD;
   // An empty socket is probed but never enters the multi-second begin path.
   for (unsigned Retry = 0; Retry < 20; ++Retry) assert(!LoadDirectory(SD));
   assert(SD.Probes == 20 && SD.Begins == 0 && SD.Enumerations == 0);
   ++Scenarios;

   // Insertion mounts once. Reopening and explicit directory refresh enumerate
   // again while reusing the active mount.
   SD.Inserted = true;
   assert(LoadDirectory(SD));
   assert(SD.Begins == 1 && SD.Enumerations == 1);
   for (unsigned Refresh = 0; Refresh < 10; ++Refresh) assert(LoadDirectory(SD));
   assert(SD.Begins == 1 && SD.Probes == 21 && SD.Enumerations == 11);
   ++Scenarios;

   // Removal invalidates the active mount without begin. Reinsertion remounts.
   SD.Inserted = false;
   assert(!LoadDirectory(SD));
   assert(!SD.Mounted && SD.Begins == 1);
   SD.Inserted = true;
   assert(LoadDirectory(SD));
   assert(SD.Mounted && SD.Begins == 2 && SD.Enumerations == 12);
   ++Scenarios;

   // One bad-card failure is shared by every consumer in the same generation.
   // An explicit refresh permits exactly one new mount attempt sequence.
   FakeSD BadSD;
   BadSD.Inserted = true;
   BadSD.FailBegin = true;
   assert(!LoadDirectory(BadSD));
   assert(!LoadDirectory(BadSD));
   assert(BadSD.Begins == 1 && BadSD.Enumerations == 0);
   BadSD.explicitRefresh();
   assert(!LoadDirectory(BadSD));
   assert(!LoadDirectory(BadSD));
   assert(BadSD.Begins == 2 && BadSD.Enumerations == 0);
   BadSD.NowMillis += DriveSDMountRetryDelayMs;
   assert(!LoadDirectory(BadSD));
   assert(BadSD.Begins == 3 && BadSD.Enumerations == 0);
   ++Scenarios;

   std::printf("%u drive directory and SD mount scenarios passed; %zu comparisons for 4,000 entries\n",
      Scenarios, CompareCount);
   return 0;
}
