// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "../../abi/vm_abi.h"
#include "../../video/mpe_video_live.h"
namespace gbadoomvm {
constexpr uint32_t VideoWorkspaceBytes=mpe_video::DeltaWorkspaceBytes;
// Native C64-sized source: F7 needs neither pixel duplication nor scaling.
constexpr uint16_t VideoGeometry=0;
struct Metrics {
    uint32_t zoneUsed,zoneHighWater,zoneRequest,supportUsed;
    uint32_t reads,readBytes,resourceBytes,resourceCount,lastLump;
};
bool prepare(const VmHost *host);
bool start();
bool step(uint32_t keys);
void close();
void stopMusic();
const char *error();
Metrics metrics();
const uint8_t *pixels();
const uint8_t *palette();
}
