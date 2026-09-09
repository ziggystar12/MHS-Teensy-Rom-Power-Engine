// SPDX-License-Identifier: GPL-2.0-or-later
#include "doomdef.h"
#include "global_data.h"
#include "g_game.h"
#include "d_main.h"
#include "m_menu.h"
#include "w_wad.h"
#include "s_sound.h"
#include "core_api.h"
void D_DoomMainSetup(void);
void GbaDisplay(void);
void InitGlobals(void);
static uint32_t previousKeys;
void GbaCoreStart(void){
    Z_Init();InitGlobals();W_Init();D_DoomMainSetup();
    _g->advancedemo=false;_g->singletics=true;_g->highDetail=1;
    G_InitNew(sk_medium,1,1);previousKeys=0;
}
void GbaCoreStep(uint32_t keys){
    GbaSoundTick();
    const int mapping[10]={KEYD_UP,KEYD_DOWN,KEYD_LEFT,KEYD_RIGHT,KEYD_L,KEYD_R,KEYD_B,KEYD_A,KEYD_SELECT,KEYD_START};
    for(unsigned i=0;i<10;i++)if((keys^previousKeys)&(1u<<i)){
        event_t event={0};event.type=(keys&(1u<<i))?ev_keydown:ev_keyup;event.data1=mapping[i];D_PostEvent(&event);
    }
    previousKeys=keys;G_BuildTiccmd(&_g->netcmd);M_Ticker();G_Ticker();_g->gametic++;_g->maketic++;
    if(_g->gamestate==GS_LEVEL)S_UpdateSounds(_g->player.mo);
    GbaDisplay();GbaEndFrame();
}
unsigned GbaCoreTic(void){return _g?_g->gametic:0;}
int GbaCoreInLevel(void){return _g&&_g->gamestate==GS_LEVEL&&_g->gameepisode==1&&_g->gamemap>=1&&_g->gamemap<=9;}
void GbaCoreControlsReset(void){previousKeys=0;}
uint32_t GbaCoreInputMask(void){
    const int mapping[10]={KEYD_UP,KEYD_DOWN,KEYD_LEFT,KEYD_RIGHT,KEYD_L,KEYD_R,KEYD_B,KEYD_A,KEYD_SELECT,KEYD_START};
    uint32_t result=0;for(unsigned i=0;i<10;i++)if(_g->gamekeydown[mapping[i]])result|=1u<<i;return result;
}
