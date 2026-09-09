// SPDX-License-Identifier: MIT
// Private adventure F5 experiment; deliberately does not change DOS's kernel.
// FAILED PAL raster probe. Never include this in a runtime/release build.
#pragma once
#include "mpe_video_kernel.h"
namespace mpe_video {
// Two 21-line multicolor sprites in slots 5/6 retain the actor's full height.
// Five existing margin sprites retain the 296-pixel fitted viewport. The
// caller keeps screen/bitmap data and actor shapes in the $4000 VIC bank.
inline unsigned buildAdventureKernel(bool ntsc, uint8_t *buffer, unsigned capacity,
                                     unsigned base, int actorTop = -100) {
    if (!buffer || capacity < 4096) return 0;
    uint8_t *p = buffer;
    unsigned fixup[200]{}, helper[66]{}, waits[200]{};
    for (unsigned y = 0; y < 200; ++y) {
        unsigned row = y & 7, plane = y >= 198 ? 2 : row / 2;
        bool split = row && !(row & 1) && y < 198;
        bool actorDma = int(y) >= actorTop - 1 && int(y) < actorTop + 41;
        int delay = (ntsc ? 65 : 63) - 12 - (row == 0 ? 43 : split ? 40 : 0);
        if (y >= 1) delay -= !ntsc && y >= 43 && y < 85 && row == 0 ? 4 : 5;
        if (actorDma) delay -= 5;
        // Natural badlines retain YSCROLL=3 from the preceding odd line.
        // Avoid the redundant late D011 write while actor DMA is active.
        bool skipControl = actorDma && row == 0;
        if (skipControl) delay += 6;
        // A zero-page constant load accounts for an otherwise impossible
        // one-cycle remainder. $80..$83 are reserved in this opt-in client.
        if (delay == 1) { *p++=0xa5; *p++=0x80+plane; --delay; }
        else { *p++=0xa9; *p++=0x78-plane*0x10; }
        *p++=0x8d; *p++=0x18; *p++=0xd0;
        if (!skipControl) {
            *p++=0xa9; *p++=split ? uint8_t(0x38|((51+y)&7)) : 0x3b;
            *p++=0x8d; *p++=0x11; *p++=0xd0;
        }
        if (y==1) {
            *p++=0xa9; *p++=actorTop>=0?0x7f:0x1f;
            *p++=0x8d; *p++=0x15; *p++=0xd0;
            *p++=0xa9; *p++=0x1f; *p++=0x8d; *p++=0x17; *p++=0xd0;
            delay-=12;
        }
        if (y==187) { *p++=0xa9; *p++=15; *p++=0x8d; *p++=0x17; *p++=0xd0; delay-=6; }
        if (delay < 0 || delay == 1 || delay >= 66) return 0;
        if (delay == 12 || delay >= 14) {
            waits[y]=delay; helper[delay]=1; *p++=0x20; fixup[y]=unsigned(p-buffer); *p++=0; *p++=0;
        } else {
            if (delay&1) { *p++=0x24; *p++=0x03; delay-=3; }
            while (delay) { *p++=0xea; delay-=2; }
        }
    }
    *p++=0xa9; *p++=0; *p++=0x8d; *p++=0x15; *p++=0xd0;
    *p++=0x4c; *p++=0xe0; *p++=0x02;
    for (unsigned delay=12; delay<66; ++delay) if (helper[delay]) {
        helper[delay]=base+unsigned(p-buffer); unsigned cycles=delay-12;
        if (cycles&1) { *p++=0x24; *p++=0x03; cycles-=3; }
        while (cycles) { *p++=0xea; cycles-=2; }
        *p++=0x60;
    }
    for (unsigned y=0; y<200; ++y) if (waits[y]) {
        auto address=helper[waits[y]]; buffer[fixup[y]]=uint8_t(address); buffer[fixup[y]+1]=address>>8;
    }
    return unsigned(p-buffer) <= capacity ? unsigned(p-buffer) : 0;
}
}
