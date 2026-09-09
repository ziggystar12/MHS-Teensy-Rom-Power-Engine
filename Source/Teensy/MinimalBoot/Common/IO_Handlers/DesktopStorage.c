// MIT License
//
// Copyright (c) 2026 Travis Smith
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
// of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Included by IOH_TeensyROM.c. Media access happens only from the foreground
// status dispatcher; the IO interrupt merely queues rCtlStorageRefreshWAIT.

#include "../../../DesktopStorageCore.h"

extern bool DesktopStorageSDCardInsertedFast();
extern unsigned long _flashimagelen;
extern const uint32_t BootData[3];

// The updater reserve begins at this address. BootData[0] is the active image
// origin: $60060000 for the upper dual-boot image and $60000000 for a direct
// build. Deriving the capacity from both values avoids counting the lower
// dual-boot partition as free space.
static const uint64_t DesktopInternalFlashEnd = 0x607c0000ULL;
#ifndef DESKTOP_STORAGE_INTERNAL_USED_BYTES
#define DESKTOP_STORAGE_INTERNAL_USED_BYTES ((uint32_t)(uintptr_t)&_flashimagelen)
#endif

FLASHMEM static DesktopStorageObservation DesktopStorageObserveSD()
{
   DesktopStorageObservation result = {};
   const bool mounted = SDFullInit();
   const bool inserted = mounted || DesktopStorageSDCardInsertedFast();
   result.condition = mounted ? dscReady : (inserted ? dscError : dscAbsent);
   if (!mounted) return result;

   result.totalBytes = SD.totalSize();
   result.usedBytes = SD.usedSize();
   SdCard *card = SD.sdfs.card();
   cid_t cid = {};
   if (card != NULL && card->readCID(&cid)) result.identifier = cid.psn;
   return result;
}

FLASHMEM static DesktopStorageObservation DesktopStorageObserveUSB()
{
   DesktopStorageObservation result = {};
   const bool mounted = (bool)firstPartition;
   const bool inserted = mounted || myDrive.available();
   result.condition = mounted ? dscReady : (inserted ? dscError : dscAbsent);
   if (!mounted) return result;

   result.totalBytes = firstPartition.totalSize();
   result.usedBytes = firstPartition.usedSize();
   result.vendor = firstPartition.idVendor();
   result.product = firstPartition.idProduct();
   return result;
}

static inline void DesktopStoragePublishU32(uint8_t firstRegister, uint32_t value)
{
   IO1[firstRegister + 0] = value;
   IO1[firstRegister + 1] = value >> 8;
   IO1[firstRegister + 2] = value >> 16;
   IO1[firstRegister + 3] = value >> 24;
}

FLASHMEM void DesktopStorageRefresh()
{
   IO1[rRegStorageState] = 0;
   const DesktopStorageObservation sd = DesktopStorageObserveSD();
   const DesktopStorageObservation usb = DesktopStorageObserveUSB();
   const uint64_t internalOrigin = BootData[0];
   const uint64_t internalTotal = internalOrigin < DesktopInternalFlashEnd
      ? DesktopInternalFlashEnd - internalOrigin : 0;
   const uint64_t imageBytes = DESKTOP_STORAGE_INTERNAL_USED_BYTES;
   DesktopStorageSnapshot snapshot;
   DesktopStorageCompose(snapshot, sd, usb, internalTotal, imageBytes);

   // State remains zero while fields are being replaced. The C64 waits for
   // rwRegStatus==rsReady, but publishing rssSnapshotValid last also makes an
   // accidental asynchronous reader fail closed instead of seeing torn data.
   DesktopStoragePublishU32(rRegStorageSDTotalMiB0, snapshot.sdTotalMiB);
   DesktopStoragePublishU32(rRegStorageSDFreeMiB0, snapshot.sdFreeMiB);
   DesktopStoragePublishU32(rRegStorageSDId0, snapshot.sdIdentifier);
   DesktopStoragePublishU32(rRegStorageUSBTotalMiB0, snapshot.usbTotalMiB);
   DesktopStoragePublishU32(rRegStorageUSBFreeMiB0, snapshot.usbFreeMiB);
   IO1[rRegStorageUSBVendorLo] = snapshot.usbVendor;
   IO1[rRegStorageUSBVendorHi] = snapshot.usbVendor >> 8;
   IO1[rRegStorageUSBProductLo] = snapshot.usbProduct;
   IO1[rRegStorageUSBProductHi] = snapshot.usbProduct >> 8;
   DesktopStoragePublishU32(rRegStorageInternalTotalKiB0, snapshot.internalTotalKiB);
   DesktopStoragePublishU32(rRegStorageInternalFreeKiB0, snapshot.internalFreeKiB);
   IO1[rRegStorageState] = snapshot.state;
}
