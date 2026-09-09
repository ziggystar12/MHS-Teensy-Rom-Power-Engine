// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <stddef.h>
#include <stdint.h>
enum {GBA_FRAME_WIDTH=320,GBA_FRAME_HEIGHT=200,GBA_FRAME_BYTES=GBA_FRAME_WIDTH*GBA_FRAME_HEIGHT};
// Keep the 16.16 product until the final division. Pre-rounding 1/focal to
// 16.16 loses another texel or more across distant floor spans.
static inline int32_t GbaPlaneStep(int32_t distance,int32_t direction){
    return (int32_t)(((int64_t)distance*direction)>>16)/(GBA_FRAME_WIDTH/2);
}
#ifdef __cplusplus
extern "C" {
#endif
void GbaCoreStart(void);
void GbaCoreStep(uint32_t keys);
void GbaHudMode(unsigned mode);
unsigned GbaHudRedraws(void);
unsigned GbaHudFaceDecodes(void);
const uint8_t *GbaPaletteRgb(void);
unsigned GbaPaletteRevision(void);
unsigned GbaCoreTic(void);
int GbaCoreInLevel(void);
unsigned GbaCoreMap(void);
unsigned GbaSkippedMaps(void);
void GbaCoreSkipMap(void);
void GbaCoreControlsReset(void);
int GbaTryLoadLevel(void (*load)(void));
void GbaMapLumps(unsigned first,unsigned last);
#ifdef MPE_DOOM_TEST
void GbaTestMemoryFaultAfter(unsigned allocations);
void GbaTestCacheOverride(unsigned bytes);
unsigned GbaTestCacheBytes(void);
#endif
uint32_t GbaCoreInputMask(void);
void GbaSoundReset(void);
void GbaSoundTick(void);
void GbaSoundStop(int channel);
void GbaSoundPayload(uint8_t payload[26]);
void GbaSoundMusicPayload(uint8_t payload[26],const uint8_t music[26]);
void *GbaZone(unsigned *bytes);
unsigned GbaRenderCacheBytes(void);
void *GbaSupportAlloc(size_t bytes);
void GbaZoneAllocated(unsigned bytes);
void GbaZoneReleased(unsigned bytes);
void GbaZoneFailure(unsigned bytes);
uint32_t GbaFileSize(void);
void GbaRead(uint32_t offset,void *buffer,uint32_t bytes);
void GbaResourceLoaded(unsigned lump,unsigned bytes);
const void *GbaFrameLump(int lump);
void GbaEndFrame(void);
typedef struct {int16_t width,height,leftoffset,topoffset;} GbaPatchInfo;
void GbaPatchHeader(int lump,GbaPatchInfo *header);
int GbaPatchWidth(int lump);
int GbaClockTics(void);
void GbaFatal(const char *message) __attribute__((noreturn));
void I_Error(const char *format,...) __attribute__((noreturn));
char *strupr(char *s);
#ifdef __cplusplus
}
#endif
