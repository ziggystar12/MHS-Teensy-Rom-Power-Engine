// SPDX-License-Identifier: GPL-2.0-or-later
// Real 32-bit core and bounded host adapter; no physical Teensy timing claims.
#include "../doom/gba/platform.h"
#include "../doom/gba/core_api.h"
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
extern "C" {
#include "doomdef.h"
#include "g_game.h"
unsigned GbaSurveyViews(void);
void GbaSurveyPosition(unsigned);
unsigned GbaTestGameState(void);
void GbaTestInventory(int check);
void GbaTestExhaustInPlay(void);
void GbaTestCheckHeap(void);
void GbaTestCombatReady(void);
}
static FILE *file;
static unsigned reads,failRead,clockUs;
static uint32_t openFile(const char *name,VmFileInfo *info){
    assert(!file);file=fopen(name,"rb");if(!file)return 0;
    fseek(file,0,SEEK_END);*info={};info->bytes=ftell(file);rewind(file);return 1;
}
static int32_t readFile(uint32_t h,uint32_t off,void *p,uint32_t n){
    assert(h==1&&file);if(++reads==failRead)return -1;
    if(fseek(file,off,SEEK_SET))return -1;if(n>997)n=997;return fread(p,1,n,file);
}
static void closeFile(uint32_t h){assert(h==1&&file);fclose(file);file=nullptr;}
static uint32_t now(){return clockUs+=28571;}
static uint32_t hash(uint32_t h,const uint8_t *p,unsigned n){while(n--)h=(h^*p++)*16777619u;return h;}
int main(int argc,char **argv){
    assert(sizeof(void*)==4&&argc==7);
    const unsigned workspace=atoi(argv[2]),zone=atoi(argv[3]),requested=atoi(argv[5]),fault=atoi(argv[6]);
    const char *mode=argv[4];
    auto support=(uint8_t*)calloc(1,workspace+64),guest=(uint8_t*)calloc(1,zone+64);assert(support&&guest);
    memset(support+workspace,0xa5,64);memset(guest+zone,0x5a,64);
    VmHost h{};h.workspace=support;h.workspace_bytes=workspace;h.guest_ram=guest;h.guest_ram_bytes=zone;
    h.content_path=argv[1];h.open=openFile;h.read=readFile;h.close=closeFile;h.micros_now=now;
    if(!strcmp(mode,"survey")&&fault)GbaTestCacheOverride(fault);
    assert(gbadoomvm::prepare(&h));bool okay=gbadoomvm::start();
    unsigned views=0,totalViews=0,transitions=0;uint32_t picture=2166136261u;
    if(okay&&strcmp(mode,"start")){
        if(!strcmp(mode,"fault-load"))GbaTestMemoryFaultAfter(fault);
        if(!strcmp(mode,"io-load"))failRead=reads+1;
        G_DeferedInitNew(sk_medium,1,requested);okay=gbadoomvm::step(0);
    }
    const auto initial=gbadoomvm::metrics();
    if(okay&&!strcmp(mode,"survey")&&GbaCoreMap()==requested&&GbaCoreInLevel()){
        totalViews=GbaSurveyViews();
        for(;views<totalViews;views++){
            GbaSurveyPosition(views);okay=gbadoomvm::step(0);if(!okay)break;
            if(GbaCoreMap()!=requested||!GbaCoreInLevel())break;
            picture=hash(picture,gbadoomvm::pixels(),GBA_FRAME_BYTES);
            picture=hash(picture,gbadoomvm::palette(),768);
            GbaTestCheckHeap();
        }
    }
    if(okay&&!strcmp(mode,"fault-play")){
        // Force a real zone allocation while stepping an already loaded map.
        GbaTestExhaustInPlay();okay=gbadoomvm::step(0);
        assert(okay&&(GbaSkippedMaps()&(1u<<(requested-1)))&&GbaCoreMap()!=requested);
    }
    if(okay&&!strcmp(mode,"route")){
        for(unsigned i=0;i<10;i++)assert(gbadoomvm::step(0));
        assert(GbaCoreMap()==1);assert(gbadoomvm::step(1)&&GbaCoreInputMask()==1);
        GbaTestInventory(0);G_ExitLevel();okay=gbadoomvm::step(1);
        assert(okay&&GbaCoreMap()==2);GbaTestInventory(1);transitions++;
        // A held control must be posted again after the load clears key state.
        assert(gbadoomvm::step(1)&&GbaCoreInputMask()==1);
        G_DeferedInitNew(sk_medium,1,3);assert(gbadoomvm::step(0)&&GbaCoreMap()==3);
        G_SecretExitLevel();assert(gbadoomvm::step(0)&&GbaCoreMap()==9);transitions++;
        G_ExitLevel();assert(gbadoomvm::step(0)&&GbaCoreMap()==4);transitions++;
        for(unsigned m=4;m<8;m++){assert(GbaCoreMap()==m);G_ExitLevel();assert(gbadoomvm::step(0));transitions++;}
        G_ExitLevel();assert(gbadoomvm::step(0)&&GbaTestGameState()==GS_FINALE);transitions++;
        for(unsigned i=0;i<2200;i++)assert(gbadoomvm::step(0));
        G_DeferedInitNew(sk_medium,1,1);assert(gbadoomvm::step(0)&&GbaCoreMap()==1&&GbaCoreInLevel());
    }
    if(okay&&!strcmp(mode,"cycles")){
        for(unsigned pass=0;pass<4;pass++)for(unsigned m=1;m<=9;m++){
            G_DeferedInitNew(sk_medium,1,m);assert(gbadoomvm::step(0));
            assert(GbaTestCacheBytes()==(GbaCoreMap()==4?98304:GbaCoreMap()==5?81920:131072));
            for(unsigned t=0;t<20;t++)assert(gbadoomvm::step(0));GbaTestCheckHeap();transitions++;
        }
    }
    if(okay&&!strcmp(mode,"bounded-route")){
        for(unsigned i=0;i<10;i++)assert(gbadoomvm::step(0));
        GbaTestInventory(0);
        const unsigned route[]={4,5,8};
        for(unsigned map:route){
            G_ExitLevel();assert(gbadoomvm::step(0));
            assert(GbaCoreMap()==map&&GbaCoreInLevel());GbaTestInventory(1);GbaTestCheckHeap();transitions++;
            assert(GbaTestCacheBytes()==(map==4?98304:map==5?81920:131072));
        }
        G_ExitLevel();assert(gbadoomvm::step(0));transitions++;
        assert(GbaTestGameState()==GS_FINALE);
        for(unsigned i=0;i<2200;i++)assert(gbadoomvm::step(0));
    }
    if(okay&&!strcmp(mode,"combat")){
        assert(GbaCoreMap()==requested);totalViews=GbaSurveyViews();
        // Shoot, turn, move, use and open/close map/menu from varied locations.
        for(unsigned t=0;t<3500;t++){
            if(t%35==0)GbaSurveyPosition(((t/35)*71)%totalViews);
            GbaTestCombatReady();
            unsigned keys=64|(t%140<70?1:2)|(t%70<35?4:8)|(t%35==10?128:0);
            if(t>=100&&t<=140)keys=(t==100||t==140)?512:0; // menu
            if(t==200||t==240)keys=256; // automap
            assert(gbadoomvm::step(keys)&&GbaCoreMap()==requested&&GbaCoreInLevel());
            GbaTestCheckHeap();views++;
        }
    }
    const auto metrics=gbadoomvm::metrics();const unsigned map=GbaCoreMap(),state=GbaTestGameState(),skipped=GbaSkippedMaps();
    gbadoomvm::close();assert(!file);
    for(unsigned i=0;i<64;i++){assert(support[workspace+i]==0xa5);assert(guest[zone+i]==0x5a);}
    if(!strcmp(mode,"io-load"))assert(!okay&&!skipped&&strstr(gbadoomvm::error(),"I/O"));
    if(!strcmp(mode,"fault-load"))assert(okay&&(skipped&(1u<<(requested-1)))&&map!=requested);
    printf("{\"okay\":%s,\"requested\":%u,\"map\":%u,\"state\":%u,\"skipped\":%u,\"views\":%u,\"totalViews\":%u,\"picture\":%u,\"transitions\":%u,\"zoneHighWater\":%u,\"zoneUsed\":%u,\"supportUsed\":%u,\"renderCache\":%u,\"renderReads\":%u,\"renderReadBytes\":%u,\"cleanError\":%s,\"guardsIntact\":true}\n",
        okay?"true":"false",requested,map,state,skipped,views,totalViews,picture,transitions,metrics.zoneHighWater,metrics.zoneUsed,metrics.supportUsed,GbaTestCacheBytes(),metrics.reads-initial.reads,metrics.readBytes-initial.readBytes,gbadoomvm::error()[0]?"false":"true");
    if(gbadoomvm::error()[0])printf("ERROR %s\n",gbadoomvm::error());
    free(support);free(guest);
}
