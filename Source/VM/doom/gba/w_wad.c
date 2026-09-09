// SPDX-License-Identifier: GPL-2.0-or-later
// Persistent engine pointers stay in the zone. Render assets use a separate
// circular cache reserved inside that same zone, so growing level objects
// cannot fragment the space needed for a large texture. A render borrow lasts
// until the next render borrow; deferred sprites retain IDs and small headers.
#include "doomdef.h"
#include "w_wad.h"
#include "core_api.h"
static filelump_t *directory;
static void **cached;
static unsigned char *lifetime;
static unsigned count;
static unsigned char *renderCache;
static unsigned renderBytes,renderCursor;
#ifdef MPE_DOOM_TEST
unsigned GbaTestCacheBytes(void){return renderBytes;}
#endif
static unsigned mapFirst=~0u,mapLast;
void GbaMapLumps(unsigned first,unsigned last){
    mapFirst=first;mapLast=last;
    unsigned bytes=GbaRenderCacheBytes();
    if(renderBytes!=bytes||!renderCache){
        // Called after level cleanup, before any new geometry or drawing.
        // Discard every circular-cache borrow before returning its storage.
        for(unsigned i=0;i<count;i++)if(lifetime[i]==2)cached[i]=NULL;
        Z_Free(renderCache);renderBytes=bytes;renderCursor=0;
        renderCache=Z_Malloc(bytes,PU_STATIC,(void **)&renderCache);
    }
}
static struct {unsigned key;GbaPatchInfo header;} headers[64];
void ExtractFileBase(const char *path,char *dest){
    const char *base=path;for(const char *p=path;*p;p++)if(*p=='/'||*p=='\\'||*p==':')base=p+1;
    memset(dest,0,8);for(unsigned i=0;i<8&&base[i]&&base[i]!='.';i++)dest[i]=toupper((unsigned char)base[i]);
}
void W_Init(void){
    if(directory)return;
    wadinfo_t header;
    GbaRead(0,&header,sizeof header);
    unsigned bytes=GbaFileSize();
    if(memcmp(header.identification,"IWAD",4)||header.numlumps<=0||header.numlumps>4096||
       header.infotableofs<12||(unsigned)header.infotableofs>bytes||
       (unsigned)header.numlumps>(bytes-header.infotableofs)/sizeof(filelump_t))
        GbaFatal("Invalid converted IWAD directory");
    count=header.numlumps;
    renderBytes=GbaRenderCacheBytes();
    if(!renderBytes)GbaFatal("Zone too small for render cache");
    renderCache=Z_Malloc(renderBytes,PU_STATIC,(void **)&renderCache);
    directory=GbaSupportAlloc(count*sizeof *directory);
    cached=GbaSupportAlloc(count*sizeof *cached);
    lifetime=GbaSupportAlloc(count);
    GbaRead(header.infotableofs,directory,count*sizeof *directory);
    for(unsigned i=0;i<count;i++){
        const filelump_t *l=&directory[i];
        if(l->filepos<0||l->size<0||(unsigned)l->filepos>bytes||(unsigned)l->size>bytes-l->filepos)
            GbaFatal("Invalid converted IWAD lump extent");
    }
}
int W_CheckNumForName(const char *name){
    char key[8]={0};for(unsigned i=0;i<8&&name[i];i++)key[i]=toupper((unsigned char)name[i]);
    for(int i=(int)count-1;i>=0;i--)if(!memcmp(directory[i].name,key,8))return i;
    return -1;
}
int W_GetNumForName(const char *name){int i=W_CheckNumForName(name);if(i<0)I_Error("Missing lump %.8s",name);return i;}
static const filelump_t *entry(int n){if(n<0||(unsigned)n>=count)GbaFatal("Invalid WAD lump number");return &directory[n];}
const char *W_GetNameForNum(int n){return entry(n)->name;}
int W_LumpLength(int n){return entry(n)->size;}
const void *W_CacheLumpNum(int n){
    const filelump_t *l=entry(n);
    if(!cached[n]||lifetime[n]!=1){
        // Geometry belongs to the current level. Z_FreeTags also clears its
        // cache pointer, including after a partially completed map load.
        cached[n]=Z_Malloc(l->size?l->size:4,(unsigned)n>=mapFirst&&(unsigned)n<=mapLast?PU_LEVEL:PU_STATIC,&cached[n]);
        GbaRead(l->filepos,cached[n],l->size);GbaResourceLoaded(n,l->size);
    }
    lifetime[n]=1;
    return cached[n];
}
const void *GbaFrameLump(int n){
    const filelump_t *l=entry(n);if(cached[n])return cached[n];
    const unsigned size=l->size?((unsigned)l->size+3)&~3u:4;
    if(size>renderBytes)GbaFatal("Render resource exceeds cache");
    if(size>renderBytes-renderCursor)renderCursor=0;
    unsigned char *p=renderCache+renderCursor;
    for(unsigned i=0;i<count;i++)if(cached[i]&&lifetime[i]==2){
        const unsigned char *old=cached[i];
        unsigned bytes=directory[i].size?directory[i].size:4;
        if(old<p+size&&p<old+bytes)cached[i]=NULL;
    }
    GbaRead(l->filepos,p,l->size);GbaResourceLoaded(n,l->size);
    renderCursor+=size;cached[n]=p;lifetime[n]=2;return p;
}
void GbaEndFrame(void){} // No deferred render pointers survive a frame.
void GbaPatchHeader(int n,GbaPatchInfo *header){
    const filelump_t *l=entry(n);unsigned slot=(unsigned)n%64;
    if(l->size<sizeof *header)GbaFatal("Short patch header");
    if(headers[slot].key!=(unsigned)n+1){
        if(cached[n])memcpy(&headers[slot].header,cached[n],sizeof *header);
        else GbaRead(l->filepos,&headers[slot].header,sizeof *header);
        headers[slot].key=(unsigned)n+1;
    }
    *header=headers[slot].header;
}
int GbaPatchWidth(int n){GbaPatchInfo h;GbaPatchHeader(n,&h);return h.width;}
