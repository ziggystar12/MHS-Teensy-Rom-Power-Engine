#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <initializer_list>
#include <limits>

#include "../MinimalBoot/Common/Menu_Regs.h"
#include "../DesktopStorageCore.h"

#define FLASHMEM
#define DESKTOP_STORAGE_INTERNAL_USED_BYTES (6ULL * 1024ULL * 1024ULL)

struct cid_t { uint32_t psn; };
struct SdCard
{
   bool readable = true;
   uint32_t serial = 0;
   bool readCID(cid_t *cid) { if (!readable) return false; cid->psn = serial; return true; }
};
struct TestSdfs
{
   SdCard cardValue;
   SdCard *card() { return &cardValue; }
};
struct TestSD
{
   TestSdfs sdfs;
   uint64_t total = 0, used = 0;
   uint64_t totalSize() const { return total; }
   uint64_t usedSize() const { return used; }
} SD;
struct TestUSBPartition
{
   bool mounted = false;
   uint64_t total = 0, used = 0;
   uint16_t vendor = 0, product = 0;
   explicit operator bool() const { return mounted; }
   uint64_t totalSize() const { return total; }
   uint64_t usedSize() const { return used; }
   uint16_t idVendor() const { return vendor; }
   uint16_t idProduct() const { return product; }
} firstPartition;
struct TestUSBDrive
{
   bool inserted = false;
   bool available() const { return inserted; }
} myDrive;

static bool testSDMounted = false, testSDInserted = false;
bool SDFullInit() { return testSDMounted; }
bool DesktopStorageSDCardInsertedFast() { return testSDInserted; }
unsigned long _flashimagelen = 0;
extern const uint32_t BootData[3] = {0x60060000, 0, 0};
static uint8_t storageRegisters[IO1Size] = {};
static volatile uint8_t *IO1 = storageRegisters;

// Compile and exercise the production probe and fixed-register publisher with
// deterministic media adapters rather than copying that integration logic.
#include "../MinimalBoot/Common/IO_Handlers/DesktopStorage.c"

static uint32_t readU32(uint8_t first)
{
   return (uint32_t)IO1[first] | ((uint32_t)IO1[first + 1] << 8) |
      ((uint32_t)IO1[first + 2] << 16) | ((uint32_t)IO1[first + 3] << 24);
}

static DesktopStorageObservation medium(DesktopStorageCondition condition,
   uint64_t total = 0, uint64_t used = 0, uint32_t identifier = 0,
   uint16_t vendor = 0, uint16_t product = 0)
{
   return {condition, total, used, identifier, vendor, product};
}

int main()
{
   unsigned scenarios = 0;
   static_assert(rRegStorageState == 112 && rRegStorageInternalFreeKiB3 == 144 &&
      rwRegDesktopAppID == 145 && IO1Size == 146,
      "storage snapshot occupies a stable, bounded IO1 register block");
   static_assert(rRegStorageInternalFreeKiB3 - rRegStorageState == 32,
      "storage protocol remains 33 bytes including state");
   static_assert((rpud3InputLayoutMask & (rpud3AppearanceDark | rpud3BackgroundMask)) == 0,
      "appearance and input preferences must remain independent");
   static_assert((rpud3TextMenu & (rpud3AppearanceDark | rpud3BackgroundMask)) == 0,
      "appearance must not change classic/desktop preference");
   static_assert((rpud3ResetDetectDisable & (rpud3AppearanceDark | rpud3BackgroundMask)) == 0,
      "appearance must not change reset detection");
   static_assert(rpud3BackgroundDots == 0 && rpud3AppearanceDark == 8,
      "existing EEPROM value zero remains light with dots");

   for (uint8_t input : {rpud3InputMouse1Joy2, rpud3InputJoy1Mouse2, rpud3InputJoy1Joy2})
   {
      for (uint8_t theme : {uint8_t(0), uint8_t(rpud3AppearanceDark)})
      {
         for (uint8_t background : {rpud3BackgroundDots, rpud3BackgroundDithered,
            rpud3BackgroundBlank})
         {
            const uint8_t original = rpud3TextMenu | rpud3ResetDetectDisable | input;
            const uint8_t selected = (original & ~(rpud3AppearanceDark | rpud3BackgroundMask)) |
               theme | background;
            assert((selected & rpud3InputLayoutMask) == input);
            assert((selected & rpud3TextMenu) != 0);
            assert((selected & rpud3ResetDetectDisable) != 0);
            assert((selected & rpud3AppearanceDark) == theme);
            assert((selected & rpud3BackgroundMask) == background);
            ++scenarios;
         }
      }
   }

   DesktopStorageSnapshot snapshot;
   DesktopStorageCompose(snapshot, medium(dscAbsent), medium(dscAbsent),
      8ULL * 1024 * 1024, 6ULL * 1024 * 1024);
   assert(snapshot.state == (rssSnapshotValid | rssInternalInfoValid));
   assert(snapshot.sdTotalMiB == 0 && snapshot.usbTotalMiB == 0);
   assert(snapshot.internalTotalKiB == 8192 && snapshot.internalFreeKiB == 2048);
   ++scenarios;

   DesktopStorageCompose(snapshot,
      medium(dscReady, 64ULL << 30, 19ULL << 30, 0x1234abcd),
      medium(dscError), 0x7c0000, 0x620000);
   assert(snapshot.state == (rssSnapshotValid | rssSDConnected | rssSDInfoValid |
      rssUSBConnected | rssUSBError | rssInternalInfoValid));
   assert(snapshot.sdTotalMiB == 65536 && snapshot.sdFreeMiB == 46080);
   assert(snapshot.sdIdentifier == 0x1234abcd);
   assert(snapshot.usbTotalMiB == 0 && snapshot.usbVendor == 0);
   assert(snapshot.internalTotalKiB == 7936 && snapshot.internalFreeKiB == 1664);
   ++scenarios;

   DesktopStorageCompose(snapshot,
      medium(dscError),
      medium(dscReady, 32ULL << 30, 10ULL << 30, 0, 0x0781, 0x558a),
      1024, 2048);
   assert(snapshot.state == (rssSnapshotValid | rssSDConnected | rssSDError |
      rssUSBConnected | rssUSBInfoValid));
   assert(snapshot.usbTotalMiB == 32768 && snapshot.usbFreeMiB == 22528);
   assert(snapshot.usbVendor == 0x0781 && snapshot.usbProduct == 0x558a);
   assert(snapshot.internalTotalKiB == 0 && snapshot.internalFreeKiB == 0);
   ++scenarios;

   DesktopStorageCompose(snapshot,
      medium(dscReady, 1000, 1001), medium(dscReady, 0, 0), 4096, 4096);
   assert(snapshot.state == (rssSnapshotValid | rssSDConnected | rssSDError |
      rssUSBConnected | rssUSBError | rssInternalInfoValid));
   assert(snapshot.sdFreeMiB == 0 && snapshot.usbFreeMiB == 0);
   assert(snapshot.internalTotalKiB == 4 && snapshot.internalFreeKiB == 0);
   ++scenarios;

   assert(DesktopStorageSaturatingUnits(std::numeric_limits<uint64_t>::max(), 20) ==
      std::numeric_limits<uint32_t>::max());
   assert(DesktopStorageSaturatingUnits((5ULL << 20) + 999, 20) == 5);
   ++scenarios;

   testSDMounted = testSDInserted = true;
   SD.total = 16ULL << 30;
   SD.used = 6ULL << 30;
   SD.sdfs.cardValue.serial = 0x89abcdef;
   firstPartition.mounted = true;
   firstPartition.total = 8ULL << 30;
   firstPartition.used = 3ULL << 30;
   firstPartition.vendor = 0x1234;
   firstPartition.product = 0x5678;
   myDrive.inserted = true;
   DesktopStorageRefresh();
   assert(IO1[rRegStorageState] == (rssSnapshotValid | rssSDConnected | rssSDInfoValid |
      rssUSBConnected | rssUSBInfoValid | rssInternalInfoValid));
   assert(readU32(rRegStorageSDTotalMiB0) == 16384);
   assert(readU32(rRegStorageSDFreeMiB0) == 10240);
   assert(readU32(rRegStorageSDId0) == 0x89abcdef);
   assert(readU32(rRegStorageUSBTotalMiB0) == 8192);
   assert(readU32(rRegStorageUSBFreeMiB0) == 5120);
   assert(IO1[rRegStorageUSBVendorLo] == 0x34 && IO1[rRegStorageUSBVendorHi] == 0x12);
   assert(IO1[rRegStorageUSBProductLo] == 0x78 && IO1[rRegStorageUSBProductHi] == 0x56);
   assert(readU32(rRegStorageInternalTotalKiB0) == 7552);
   assert(readU32(rRegStorageInternalFreeKiB0) == 1408);
   ++scenarios;

   testSDMounted = false;
   testSDInserted = true; // physically present, failed mount
   firstPartition.mounted = false;
   myDrive.inserted = false;
   DesktopStorageRefresh();
   assert(IO1[rRegStorageState] == (rssSnapshotValid | rssSDConnected | rssSDError |
      rssInternalInfoValid));
   assert(readU32(rRegStorageSDTotalMiB0) == 0 && readU32(rRegStorageUSBTotalMiB0) == 0);
   ++scenarios;

   std::printf("%u appearance and storage protocol scenarios passed\n", scenarios);
}
