// SPDX-License-Identifier: GPL-2.0-or-later
// 32-bit host diagnostic. Never executes the Cortex-M7 image.
#include "../doom/gba/platform.h"
#include "../doom/gba/core_api.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gbadoom_video_probe.h"
extern "C" {
#include "doomdef.h"
#include "g_game.h"
unsigned GbaSurveyViews(void);
void GbaSurveyPosition(unsigned view);
unsigned GbaCheckFloorProjection(void);
unsigned GbaCheckHud(void);
unsigned GbaCheckHudReadability(void);
}
extern "C" const VmModule *vm_entry(const VmHost *);
static FILE *file;
static FILE *musicFile;
static uint32_t clockUs,failCode,frames,changed,lastHash,pendingHash,pendingGeneration;
static uint32_t readCalls,failReadAt=UINT32_MAX;
static uint32_t audioFrames,audioHash=2166136261u;
static uint32_t traceHash=2166136261u;
static const char *contentFile;
static bool stableRaster,stableHost;static unsigned setupCalls;
static void audio(const uint8_t *p){
    if(p[25]){if(!audioFrames){printf("AUDIO_SAMPLE ");for(unsigned i=0;i<26;i++)printf("%02x",p[i]);puts("");}audioFrames++;}
    for(unsigned i=0;i<26;i++)audioHash=(audioHash^p[i])*16777619u;
}
static uint32_t hash(const uint8_t *p,unsigned n){uint32_t h=2166136261u;while(n--)h=(h^*p++)*16777619u;return h;}
static uint32_t now(){clockUs+=1000;return clockUs;}
static uint32_t openFile(const char *path,VmFileInfo *info){
    if(!strcmp(path,"/VMS/DOOMVM/doom-e1m1-pal.s3m")||!strcmp(path,"/VMS/DOOMVM/doom-e1m1-ntsc.s3m")){
        const char *music=getenv("GBADOOM_MUSIC");if(!music)return 0;assert(!musicFile);musicFile=fopen(music,"rb");assert(musicFile);
        fseek(musicFile,0,SEEK_END);*info={};info->bytes=ftell(musicFile);rewind(musicFile);return 2;
    }
    assert(!file);if(!strcmp(path,"/VMS/DOOMVM/doom1.gbd"))path=contentFile;file=fopen(path,"rb");if(!file)return 0;
    fseek(file,0,SEEK_END);long n=ftell(file);rewind(file);assert(n>=0);*info={};info->bytes=n;return 1;
}
static int32_t readFile(uint32_t h,uint32_t offset,void *p,uint32_t n){
    if(h==2){assert(musicFile);if(fseek(musicFile,offset,SEEK_SET))return -1;return fread(p,1,n,musicFile);}
    assert(h==1&&file);if(fseek(file,offset,SEEK_SET))return -1;
    if(++readCalls==failReadAt)return -1;
    // Deliberately short successful reads exercise the retry path.
    if(n>997)n=997;auto got=fread(p,1,n,file);return ferror(file)?-1:int32_t(got);
}
static void closeFile(uint32_t h){if(h==2){assert(musicFile);fclose(musicFile);musicFile=nullptr;return;}assert(h==1&&file);fclose(file);file=nullptr;}
static void fail(uint8_t code,uint32_t){failCode=code;}
static bool setup(const VmIndexedVideoSetup *s){
    setupCalls++;
    assert(s&&s->workspace_bytes==gbadoomvm::VideoWorkspaceBytes);
    if(s->reserved&VM_INDEXED_STABLE_RASTER){
        if(!stableHost&&!getenv("GBADOOM_STABLE_F5"))return false;
        stableRaster=true;
    }
    assert((s->reserved&~VM_INDEXED_STABLE_RASTER)==(VM_INDEXED_SEPARATE_SELECTORS|gbadoomvm::VideoGeometry));return true;
}
static VmVideoResult video(VmIndexedFrame *f){
    assert(f->width==GBA_FRAME_WIDTH&&f->height==GBA_FRAME_HEIGHT&&f->stride==GBA_FRAME_WIDTH&&f->pixel_bytes==GBA_FRAME_BYTES&&f->palette_bytes==768);
    uint32_t h=hash(f->pixels,f->pixel_bytes)^hash(f->palette,f->palette_bytes);
    if(!pendingGeneration){pendingGeneration=f->generation;pendingHash=h;return VmVideoResult::Busy;}
    assert(pendingGeneration==f->generation&&pendingHash==h);
    verifyDoomVideo(*f,stableRaster);
    if(const char *mode=getenv("GBADOOM_DISPLAY_MODE"))f->resolved_mode=atoi(mode);
    pendingGeneration=0;if(frames&&lastHash!=h)changed++;lastHash=h;traceHash=(traceHash^h)*16777619u;frames++;return VmVideoResult::Transferred;
}
extern "C" void GbaCheckHudDisplay(unsigned mode){
    mpe_video::LiveConverter converter;mpe_video::LiveFrame frames[4]{};
    const auto pixels=gbadoomvm::pixels(),palette=gbadoomvm::palette();
    const mpe_video::IndexedSource source{pixels,palette,320,200,320,256,64};
    for(unsigned i=0;i<4;i++)assert(converter.render(source,i,frames[i]));
    const unsigned panels[][2]={{0,136},{176,40},{224,96}};
    for(const auto &panel:panels)for(unsigned y=168;y<200;y++)for(unsigned x=panel[0];x<panel[0]+panel[1];x++){
        const auto &cell=frames[mode].cells[(y/8)*40+x/8];unsigned color;
        if(!mode){const uint8_t colors[]={0,uint8_t(cell[8]>>4),uint8_t(cell[8]&15),cell[9]};color=colors[(cell[y&7]>>(6-2*((x&7)/2)))&3];}
        else color=(cell[y&7]&(128>>(x&7)))?cell[8]>>4:cell[8]&15;
        const unsigned index=pixels[y*320+x];const bool ink=palette[index*3]+palette[index*3+1]+palette[index*3+2]>30;
        if((color!=0)!=ink)fprintf(stderr,"HUD stroke mode=%u x=%u y=%u index=%u rgb=%u,%u,%u color=%u cell=%02x,%02x\n",mode,x,y,index,palette[index*3],palette[index*3+1],palette[index*3+2],color,cell[8],cell[9]);
        assert((color!=0)==ink);
    }
    if(const char *prefix=getenv("GBADOOM_HUD_CAPTURE")){
        char name[512];snprintf(name,sizeof name,"%s-%u.bin",prefix,mode);FILE *f=fopen(name,"wb");assert(f);
        assert(fwrite(pixels,1,64000,f)==64000);assert(fwrite(palette,1,768,f)==768);
        for(const auto &frame:frames)assert(fwrite(frame.cells,1,10000,f)==10000);
        for(const auto &frame:frames){uint8_t meta[32]{};memcpy(meta,frame.split,25);memcpy(meta+25,&frame.mask,4);meta[29]=frame.mode;meta[30]=frame.background;assert(fwrite(meta,1,32,f)==32);}fclose(f);
    }
}
int main(int argc,char **argv){
    assert(sizeof(void *)==4);if(argc!=5)return 2;
    const uint32_t workspace=strtoul(argv[2],nullptr,10),zone=strtoul(argv[3],nullptr,10);
    bool direct=!strncmp(argv[4],"diagnostic",10);
    bool cycle=!strcmp(argv[4],"diagnostic-cycle");
    bool survey=!strcmp(argv[4],"diagnostic-survey");
    bool ui=!strcmp(argv[4],"diagnostic-ui");
    contentFile=argv[1];
    stableHost=!strcmp(argv[4],"module-stable");
    if(!strcmp(argv[4],"diagnostic-io"))failReadAt=17;
    auto support=static_cast<uint8_t *>(calloc(1,workspace+64));auto guest=static_cast<uint8_t *>(calloc(1,zone+64));assert(support&&guest);
    memset(support+workspace,0xa5,64);memset(guest+zone,0x5a,64);
    VmHost h{};h.abi=VM_ABI;h.bytes=sizeof h;h.services=VM_HOST_SERVICES;
    h.workspace=support;h.workspace_bytes=workspace;h.guest_ram=guest;h.guest_ram_bytes=zone;h.content_path=argv[1];h.package_root="/VMS/DOOMVM";
    if(!strcmp(argv[4],"module-default"))h.content_path="";
    h.open=openFile;h.read=readFile;h.close=closeFile;h.micros_now=now;h.fail=fail;h.video_configure=setup;h.video_indexed=video;
    bool started=false;unsigned tics=0;
    if(direct){
        assert(gbadoomvm::prepare(&h));started=gbadoomvm::start();
        if(started&&survey)started=gbadoomvm::step(0);
        const unsigned limit=survey?GbaSurveyViews():(cycle?2100u:140u);
        if(started)for(;tics<limit;tics++){
            if(survey){
                GbaSurveyPosition(tics);
            }
            if(cycle&&tics==700)G_ExitLevel();
            if(cycle&&tics==1400)G_SecretExitLevel();
            if(cycle&&tics==1800)G_InitNew(sk_medium,4,9);
            uint32_t keys=(tics>=10&&tics<110?1u:0u)|(tics>=40&&tics<110?8u:0u)|(tics>=65&&tics<110?64u:0u);
            if(survey)keys=0;
            if(ui)keys=(tics==10||tics==50)?256:(tics==60||tics==80)?512:0;
            if(!gbadoomvm::step(keys))break;
            uint8_t sound[26];GbaSoundPayload(sound);audio(sound);
            assert(GbaCoreInLevel());
            if(tics>=10&&!ui)assert(GbaCoreInputMask()==keys);
            auto next=hash(gbadoomvm::pixels(),GBA_FRAME_BYTES)^hash(gbadoomvm::palette(),768);
            if(getenv("GBADOOM_TRACE"))printf("FRAME %u %u\n",tics,next);
            if(tics&&next!=lastHash)changed++;lastHash=next;traceHash=(traceHash^next)*16777619u;
        }
    }else{
        auto module=vm_entry(&h);started=module!=nullptr;
        if(module)if(const char *map=getenv("GBADOOM_START_MAP"))G_DeferedInitNew(sk_medium,1,atoi(map));
        if(module&&getenv("GBADOOM_MUSIC")){
            VmInput standard{0,uint8_t(getenv("GBADOOM_NTSC")?1:0),0,0x91};module->input(&standard);
        }
        if(module)for(unsigned i=0;i<18000&&frames<140&&!failCode;i++){
            VmInput in{};in.protocol=frames>=10&&frames<110?0x82:0x80;in.display=frames>=10&&frames<110?0x11:0;
            module->input(&in);module->pump();VmPacket p{};
            if(module->packet(&p)){
                if(frames>11&&frames<110)assert(GbaCoreInputMask()==65);
                if(frames>110)assert(GbaCoreInputMask()==0);
                assert(p.type==2&&p.length==26&&((p.flags&1)||getenv("GBADOOM_MUSIC")));auto before=GbaCoreTic();
                uint8_t sound[26];GbaSoundPayload(sound);if(!getenv("GBADOOM_MUSIC"))assert(!memcmp(p.payload,sound,26));audio(p.payload);
                const auto frozen=p;
                for(unsigned retry=0;retry<5;retry++)module->pump();
                assert(GbaCoreTic()==before&&!module->packet(&p));
                GbaSoundPayload(sound);if(!getenv("GBADOOM_MUSIC"))assert(!memcmp(frozen.payload,sound,26));module->ack();
            }
        }
        tics=GbaCoreTic();
    }
    if(started){printf("HUD_CHECKS %u\n",GbaCheckHud());printf("HUD_READABILITY %u\n",GbaCheckHudReadability());}
    gbadoomvm::close();assert(!file&&!musicFile);auto m=gbadoomvm::metrics();
    printf("MAP %u\n",GbaCoreMap());
    if(started)printf("FLOOR_PROJECTION %u\n",GbaCheckFloorProjection());
    for(unsigned i=0;i<64;i++){assert(support[workspace+i]==0xa5);assert(guest[zone+i]==0x5a);}
    char error[400];unsigned pos=0;for(auto p=gbadoomvm::error();*p&&pos<390;p++){
        if(*p=='"'||*p=='\\')error[pos++]='\\';if(uint8_t(*p)>=32)error[pos++]=*p;
    }error[pos]=0;
    printf("{\"started\":%s,\"tics\":%u,\"frames\":%u,\"changedFrames\":%u,\"frameHash\":%u,\"e1m1\":%s,\"workspaceBytes\":%u,\"zoneBytes\":%u,\"zoneUsed\":%u,\"zoneHighWater\":%u,\"zoneRequest\":%u,\"supportUsed\":%u,\"reads\":%u,\"readBytes\":%u,\"resourceBytes\":%u,\"resourceCount\":%u,\"lastLump\":%u,\"faultCode\":%u,\"error\":\"%s\",\"guardsIntact\":true,\"handlesClosed\":true}\n",
        started?"true":"false",tics,frames,changed,lastHash,GbaCoreInLevel()?"true":"false",workspace,zone,m.zoneUsed,m.zoneHighWater,m.zoneRequest,m.supportUsed,m.reads,m.readBytes,m.resourceBytes,m.resourceCount,m.lastLump,failCode,error);
    if(started){if(!survey&&!ui)assert(audioFrames>5);printf("AUDIO %u %u\n",audioFrames,audioHash);}
    printf("CACHE %u\n",GbaRenderCacheBytes());
    printf("TRACE %u\n",traceHash);
    if(frames){assert(nativeDetailedFrames>100);printf("NATIVE %u %u %u\n",GBA_FRAME_WIDTH,GBA_FRAME_HEIGHT,nativeDetailedFrames);}
    if(frames)printf("VIDEO_SETUP %u %u\n",setupCalls,stableRaster?1:0);
    free(support);free(guest);return 0;
}
