// SPDX-License-Identifier: GPL-2.0-or-later
// Reset-only native backend. All resources are read through generic VmHost.
#include "platform.h"
#include "core_api.h"
#include "../heap.h"
#include <setjmp.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>
namespace gbadoomvm {
static const VmHost *host;
static uint32_t handle,fileBytes,fileBase,supportOffset;
static doomvm::Heap supportHeap;
static Metrics stats;
static jmp_buf recovery;
static jmp_buf mapRecovery;
static bool loadingMap,memoryFailure;
#ifdef MPE_DOOM_TEST
static unsigned testCacheBytes;
#endif
static char lastError[192];
alignas(8) static struct {uint32_t before[8];uint8_t pixels[GBA_FRAME_BYTES];uint32_t after[8];} framebuffer;
static uint8_t colors[768];
bool prepare(const VmHost *h){
    host=h;stats={};handle=fileBytes=fileBase=0;supportOffset=VideoWorkspaceBytes;lastError[0]=0;
    memset(framebuffer.pixels,0,sizeof framebuffer.pixels);memset(colors,0,sizeof colors);
    for(unsigned i=0;i<8;i++)framebuffer.before[i]=framebuffer.after[i]=0xa55ac33c;
    return h&&h->workspace&&h->workspace_bytes>=supportOffset+16&&h->guest_ram&&h->guest_ram_bytes>=4096&&
        supportHeap.init(h->workspace+supportOffset,h->workspace_bytes-supportOffset);
}
void close(){stopMusic();if(handle){host->close(handle);handle=0;}}
bool start(){
    if(setjmp(recovery)){close();return false;}
    const char *content=host->content_path;
    if(!content||!content[0])content="/VMS/DOOMVM/doom1.gbd";
    VmFileInfo info{};handle=host->open(content,&info);
    if(!handle||info.directory)GbaFatal("Cannot open converted GBADoom WAD");
    fileBytes=info.bytes;
    uint32_t header[4];GbaRead(0,header,sizeof header);
    if(memcmp(header,"GBDWAD1",8)||header[2]!=fileBytes-sizeof header)GbaFatal("Expected converted GBDWAD1 content");
    fileBase=sizeof header;fileBytes=header[2];
    // Validate the generated payload without retaining the whole WAD in RAM.
    uint8_t block[512];uint32_t crc=~0u;
    for(uint32_t offset=0;offset<fileBytes;){
        auto n=fileBytes-offset;if(n>sizeof block)n=sizeof block;GbaRead(offset,block,n);offset+=n;
        for(unsigned i=0;i<n;i++){crc^=block[i];for(unsigned b=0;b<8;b++)crc=(crc>>1)^((crc&1)?0xedb88320u:0);}
    }
    if((crc^~0u)!=header[3])GbaFatal("Converted WAD checksum mismatch");
    GbaCoreStart();return true;
}
bool step(uint32_t keys){
    memoryFailure=false;
    if(setjmp(recovery)){
        loadingMap=false;
        if(!memoryFailure||!GbaCoreInLevel()){close();return false;}
        memoryFailure=false;lastError[0]=0;GbaCoreSkipMap();
    }
    GbaCoreStep(keys);
    for(unsigned i=0;i<8;i++)if(framebuffer.before[i]!=0xa55ac33c||framebuffer.after[i]!=0xa55ac33c)GbaFatal("Framebuffer bounds exceeded");
    return true;
}
const char *error(){return lastError;}
Metrics metrics(){stats.supportUsed=supportOffset+supportHeap.highWater;return stats;}
const uint8_t *pixels(){return framebuffer.pixels;}
const uint8_t *palette(){return colors;}
}
using namespace gbadoomvm;
static unsigned paletteRevision;
extern "C" {
const uint8_t *GbaPaletteRgb(){return colors;}
unsigned GbaPaletteRevision(){return paletteRevision;}
void GbaFatal(const char *message){loadingMap=false;memoryFailure=false;snprintf(lastError,sizeof lastError,"%s",message);longjmp(recovery,1);}
void I_Error(const char *format,...){
    va_list args;va_start(args,format);vsnprintf(lastError,sizeof lastError,format,args);va_end(args);
    if(loadingMap&&memoryFailure){loadingMap=false;longjmp(mapRecovery,1);}
    loadingMap=false;longjmp(recovery,1);
}
int GbaTryLoadLevel(void (*load)(void)){
    memoryFailure=false;
    if(setjmp(mapRecovery)){memoryFailure=false;lastError[0]=0;return 0;}
    loadingMap=true;load();loadingMap=false;return 1;
}
void *GbaZone(unsigned *bytes){*bytes=host->guest_ram_bytes;memset(host->guest_ram,0,*bytes);return host->guest_ram;}
unsigned GbaRenderCacheBytes(){
#ifdef MPE_DOOM_TEST
    if(testCacheBytes)return testCacheBytes;
#endif
    // Tight maps trade some texture reuse for 32/48 KiB of level storage.
    // Keep the original cache for the other maps and the oversized test arena.
    unsigned map=GbaCoreMap();
    if(host->guest_ram_bytes==425984&&(map==4||map==5))return (map==4?96:80)*1024;
    // The compact HUD frees room for a larger render cache in the same arena.
    // The oversized host control may use a larger cache, never beyond 512 KiB.
    const unsigned reserved=288*1024,bytes=host->guest_ram_bytes;
    return bytes>reserved?(bytes-reserved>512*1024?512*1024:bytes-reserved):0;
}
void *GbaSupportAlloc(size_t n){
    auto p=supportHeap.allocate(n);if(n&&!p)GbaFatal("RAM1 support exhausted");
    if(p)memset(p,0,n);return p;
}
#ifdef MPE_DOOM_TEST
static unsigned failAllocation;
void GbaTestMemoryFaultAfter(unsigned n){failAllocation=n;}
void GbaTestCacheOverride(unsigned n){testCacheBytes=n;}
#endif
void GbaZoneAllocated(unsigned n){
    stats.zoneUsed+=n;if(stats.zoneUsed>stats.zoneHighWater)stats.zoneHighWater=stats.zoneUsed;
#ifdef MPE_DOOM_TEST
    if(failAllocation&&!--failAllocation){GbaZoneFailure(n);I_Error("Injected memory exhaustion");}
#endif
}
void GbaZoneReleased(unsigned n){if(n>stats.zoneUsed)GbaFatal("Zone accounting underflow");stats.zoneUsed-=n;}
void GbaZoneFailure(unsigned n){stats.zoneRequest=n;memoryFailure=true;}
uint32_t GbaFileSize(){return fileBytes;}
void GbaRead(uint32_t offset,void *buffer,uint32_t bytes){
    if(offset>fileBytes||bytes>fileBytes-offset)GbaFatal("WAD read outside file");
    auto p=static_cast<uint8_t *>(buffer);offset+=fileBase;
    while(bytes){auto n=host->read(handle,offset,p,bytes);stats.reads++;
        if(n<=0||uint32_t(n)>bytes)GbaFatal("WAD short read or I/O error");
        stats.readBytes+=n;offset+=n;p+=n;bytes-=n;}
}
void GbaResourceLoaded(unsigned lump,unsigned bytes){stats.resourceCount++;stats.resourceBytes+=bytes;stats.lastLump=lump;}
int GbaClockTics(){return int(host->micros_now()/28571u);}
char *strupr(char *s){for(auto p=s;*p;p++)if(*p>='a'&&*p<='z')*p-=32;return s;}
void I_InitScreen_e32(){}
void I_CreateBackBuffer_e32(){}
unsigned char *I_GetBackBuffer(){return framebuffer.pixels;}
unsigned char *I_GetFrontBuffer(){return framebuffer.pixels;}
void I_SetPallete_e32(const unsigned char *p){memcpy(colors,p,sizeof colors);paletteRevision++;}
void I_FinishUpdate_e32(const void *,const void *,unsigned,unsigned){}
void I_ProcessKeyEvents(){}
void I_Quit_e32(){GbaFatal("Game requested quit");}
int I_GetTime_e32(){return GbaClockTics();}
}
#if defined(__arm__)
extern "C" {
struct _reent;
void *__wrap_malloc(size_t n){return GbaSupportAlloc(n);}
void *__wrap_calloc(size_t n,size_t b){if(n&&b>SIZE_MAX/n)GbaFatal("calloc overflow");return GbaSupportAlloc(n*b);}
void *__wrap_realloc(void *p,size_t n){auto q=supportHeap.resize(p,n);if(n&&!q)GbaFatal("RAM1 realloc exhausted");return q;}
void __wrap_free(void *p){if(!supportHeap.release(p))GbaFatal("Invalid support free");}
void *__wrap__malloc_r(_reent *,size_t n){return __wrap_malloc(n);}
void *__wrap__calloc_r(_reent *,size_t n,size_t b){return __wrap_calloc(n,b);}
void *__wrap__realloc_r(_reent *,void *p,size_t n){return __wrap_realloc(p,n);}
void __wrap__free_r(_reent *,void *p){__wrap_free(p);}
}
extern "C" void *_sbrk(ptrdiff_t){return reinterpret_cast<void *>(-1);}
extern "C" int _write(int,const void *,int){return -1;}
extern "C" int _read(int,void *,int){return -1;}
extern "C" int _close(int){return -1;}
extern "C" int _fstat(int,void *){return -1;}
extern "C" int _isatty(int){return 0;}
extern "C" int _lseek(int,int,int){return -1;}
extern "C" int _getpid(){return 1;}
extern "C" int _kill(int,int){return -1;}
extern "C" void _exit(int){GbaFatal("Unexpected process exit");}
#endif
