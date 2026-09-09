// SPDX-License-Identifier: GPL-2.0-or-later
#include "../doom/gba/core_api.h"
extern "C" {
#include "i_sound.h"
}
#include <cassert>
#include <cstring>
#include <cstdio>
int main(){
    uint8_t p[26],copy[26];GbaSoundReset();GbaSoundPayload(p);
    for(auto b:p)assert(!b);
    assert(I_StartSound(sfx_pistol,-1,120,128)==-1);
    assert(I_StartSound(sfx_pistol,3,120,128)==-1);
    assert(I_StartSound(NUMSFX,0,120,128)==-1);
    I_StartSound(sfx_pistol,0,120,128);I_StartSound(sfx_doropn,1,80,128);I_StartSound(sfx_itemup,2,40,128);
    GbaSoundPayload(p);assert(p[0]==7&&p[5]==0x81&&p[12]==0x41&&p[19]==0x11&&p[25]==15);
    assert((p[7]>>4)>(p[14]>>4)&&(p[14]>>4)>(p[21]>>4));
    GbaSoundPayload(copy);assert(!memcmp(p,copy,26));
    const unsigned gun=p[1]+256*p[2],pickup=p[15]+256*p[16];
    GbaSoundTick();GbaSoundPayload(p);assert(p[0]==0&&p[1]+256*p[2]<gun&&p[15]+256*p[16]>pickup);
    I_StartSound(sfx_pistol,0,120,128);GbaSoundPayload(p);assert(p[0]==1);
    GbaSoundStop(1);GbaSoundPayload(p);assert(!p[12]&&p[5]);
    for(unsigned i=0;i<40;i++)GbaSoundTick();GbaSoundPayload(p);for(auto b:p)assert(!b);
    I_StartSound(sfx_doropn,0,0,128);GbaSoundPayload(p);for(auto b:p)assert(!b);
    for(int id=1;id<NUMSFX;id++){
        I_StartSound(id,0,127,128);GbaSoundPayload(p);assert(p[5]&1);
        for(unsigned i=0;i<40;i++)GbaSoundTick();GbaSoundPayload(p);for(auto b:p)assert(!b);
    }
    puts("PASS: SID shot/door/pickup voices, volume, slides, immutable payloads, retrigger, stop, silence and bounded lifetime for every SFX ID");
}
