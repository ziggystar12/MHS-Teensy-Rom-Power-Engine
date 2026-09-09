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

#pragma once

#include <stdint.h>

enum DesktopStorageCondition : uint8_t
{
   dscAbsent = 0,
   dscReady,
   dscError,
};

struct DesktopStorageObservation
{
   DesktopStorageCondition condition;
   uint64_t totalBytes;
   uint64_t usedBytes;
   uint32_t identifier;
   uint16_t vendor;
   uint16_t product;
};

struct DesktopStorageSnapshot
{
   uint8_t state;
   uint32_t sdTotalMiB;
   uint32_t sdFreeMiB;
   uint32_t sdIdentifier;
   uint32_t usbTotalMiB;
   uint32_t usbFreeMiB;
   uint16_t usbVendor;
   uint16_t usbProduct;
   uint32_t internalTotalKiB;
   uint32_t internalFreeKiB;
};

static inline uint32_t DesktopStorageSaturatingUnits(uint64_t bytes, uint8_t shift)
{
   const uint64_t units = bytes >> shift;
   return units > UINT32_MAX ? UINT32_MAX : (uint32_t)units;
}

static inline bool DesktopStorageGeometryValid(const DesktopStorageObservation& medium)
{
   return medium.condition == dscReady && medium.totalBytes != 0 &&
      medium.usedBytes <= medium.totalBytes;
}

static inline void DesktopStorageCompose(DesktopStorageSnapshot& result,
   const DesktopStorageObservation& sd, const DesktopStorageObservation& usb,
   uint64_t internalTotalBytes, uint64_t internalUsedBytes)
{
   result = {};

   if (sd.condition != dscAbsent) result.state |= rssSDConnected;
   if (DesktopStorageGeometryValid(sd))
   {
      result.state |= rssSDInfoValid;
      result.sdTotalMiB = DesktopStorageSaturatingUnits(sd.totalBytes, 20);
      result.sdFreeMiB = DesktopStorageSaturatingUnits(sd.totalBytes - sd.usedBytes, 20);
      result.sdIdentifier = sd.identifier;
   }
   else if (sd.condition != dscAbsent) result.state |= rssSDError;

   if (usb.condition != dscAbsent) result.state |= rssUSBConnected;
   if (DesktopStorageGeometryValid(usb))
   {
      result.state |= rssUSBInfoValid;
      result.usbTotalMiB = DesktopStorageSaturatingUnits(usb.totalBytes, 20);
      result.usbFreeMiB = DesktopStorageSaturatingUnits(usb.totalBytes - usb.usedBytes, 20);
      result.usbVendor = usb.vendor;
      result.usbProduct = usb.product;
   }
   else if (usb.condition != dscAbsent) result.state |= rssUSBError;

   if (internalTotalBytes != 0 && internalUsedBytes <= internalTotalBytes)
   {
      result.state |= rssInternalInfoValid;
      result.internalTotalKiB = DesktopStorageSaturatingUnits(internalTotalBytes, 10);
      result.internalFreeKiB = DesktopStorageSaturatingUnits(internalTotalBytes - internalUsedBytes, 10);
   }

   // Publish this bit last in the firmware, after every fixed-width field.
   result.state |= rssSnapshotValid;
}
