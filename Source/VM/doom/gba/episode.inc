// SPDX-License-Identifier: GPL-2.0-or-later
// Included by g_game.c so transitions use the core's normal player/level
// lifecycle. No intermission allocations; inventory carries to the next map.
void P_FreeLevelData(void);
static unsigned skippedMaps;
static boolean loadedAnyMap,announceSkip;
static char skipMessage[]="E1M0 SKIPPED - MEMORY LIMIT";
unsigned GbaCoreMap(void){return _g?(unsigned)_g->gamemap:0;}
unsigned GbaSkippedMaps(void){return skippedMaps;}
static unsigned nextEpisodeMap(unsigned map){return map==9?4:map==8?0:map+1;}
static void markSkippedMap(void){
    skippedMaps|=1u<<(_g->gamemap-1);
    skipMessage[3]='0'+_g->gamemap;
    announceSkip=true;
    G_PlayerFinishLevel(0);
}
static void GbaFinishEpisode(void){
    if(!loadedAnyMap)GbaFatal("No shareware map fits memory");
    S_Start();P_FreeLevelData();F_StartFinale();
}
static void G_DoLoadLevel(void){
    // Each failed attempt is cleaned by P_SetupLevel's normal PU_LEVEL free.
    // The mask also prevents revisiting a map that ran out of RAM in play.
    for(unsigned attempt=0;attempt<9;attempt++){
        if(!_g->gamemap){GbaFinishEpisode();return;}
        if(!(skippedMaps&(1u<<(_g->gamemap-1)))){
            if(GbaTryLoadLevel(GbaLoadLevelOnce)){
                loadedAnyMap=true;GbaCoreControlsReset();
                if(announceSkip){_g->player.message=skipMessage;announceSkip=false;}
                return;
            }
            markSkippedMap();
        }
        _g->gamemap=nextEpisodeMap(_g->gamemap);
    }
    GbaFatal("No shareware map fits memory");
}
void GbaCoreSkipMap(void){
    markSkippedMap();_g->secretexit=false;G_DoCompleted();
}
