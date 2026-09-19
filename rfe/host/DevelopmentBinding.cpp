// SPDX-License-Identifier: MIT
#include <Arduino.h>
#include <stdint.h>
namespace MpeRfe { struct Request; enum class Result : uint8_t; }
// Kept as a separate object: linked firmware still contains and verifies the
// real runtime entry. This is an explicit unavailable binding, not a guessed
// EEPROM layout. Replace it only after the shared loader contract is published.
__attribute__((weak)) FLASHMEM bool mpeRfeReadLaunchRequest(MpeRfe::Request &) { return false; }
__attribute__((weak)) FLASHMEM void mpeRfeReportLaunchFailure(MpeRfe::Result) {}
