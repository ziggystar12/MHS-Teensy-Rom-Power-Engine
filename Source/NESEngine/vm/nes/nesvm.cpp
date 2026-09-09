// SPDX-License-Identifier: MIT
#include "../abi/vm_abi.h"
#include <cstring>
#include <cstdio>
#define FLASHMEM
#define PROGMEM
#define NES_CODE
#define MHS_NES_EXTERNAL_RAM 1
#include "font8x8.h"
static const VmHost *ModuleHost;
static char NesRomDirectory[256];
static bool ModulePacketPending;
static uint32_t micros() { return ModuleHost->micros_now(); }
static void MPE5Glyph(uint8_t ch,uint8_t out[8]) { memcpy(out,MPE5Font8x8[ch<128?ch:'?'],8); }

// Small SdFat-shaped adapter owned by NESVM, using only generic host calls.
enum { O_RDONLY=0 };
struct FsFile {
    uint32_t handle=0,cursor=0; VmFileInfo info{}; bool failed=false;
    operator bool() const { return handle!=0; }
    bool isDirectory() const { return info.directory; }
    uint32_t fileSize() const { return info.bytes; }
    bool close(){if(handle)ModuleHost->close(handle);handle=0;return !failed;}
    bool seekSet(uint32_t offset){if(offset>info.bytes)return false;cursor=offset;return true;}
    int32_t read(void *p,uint32_t n){auto got=ModuleHost->read(handle,cursor,p,n);if(got<0)failed=true;else cursor+=got;return got;}
    bool openNext(FsFile *dir,int){int32_t r=ModuleHost->next(dir->handle,&info);if(r<0)dir->failed=true;return r==1;}
    size_t getName(char *out,size_t n){size_t len=strlen(info.name);if(len>=n){if(n)out[0]=0;return n;}memcpy(out,info.name,len+1);return len;}
    bool getError() const{return failed;}
};
struct ModuleFiles {
    FsFile open(const char *path,int){FsFile f;f.handle=ModuleHost->open(path,&f.info);return f;}
};
static struct { ModuleFiles sdfs; } SD;
enum { MPE3TitlePacketHeaderBytes=8,MPE3TitleCellsPerPacket=19,MPE3TitleCellBytes=12,
       MPE3TitleCELL=1,MPE3TitleSID=2,MPE3TitleCellHires=4,MPE3TitleCellModeValid=8,MPE3TitleCellReplace=16 };
static uint8_t MPE3TitlePacket[240];
static struct { uint8_t PendingType; } MPE3Title;
static VmPacket ModulePacket;
static void MPE3TitlePublish(uint8_t type,uint8_t flags,uint8_t bytes){
    ModulePacket.type=type;ModulePacket.flags=flags;ModulePacket.length=bytes;
    memcpy(ModulePacket.payload,MPE3TitlePacket+8,bytes);
    MPE3Title.PendingType=type;ModulePacketPending=true;
}
#include "session.h"
static VmInput InputQueue[32];
static uint8_t InputHead,InputTail;
static void module_input(const VmInput *input){
    if(input->protocol!=0x81 || (input->display&~1))return;
    // Held gameplay state can advance while a display packet waits for ACK.
    if(MPE6ModeState==MPE6Mode::Game && (input->buttons&12)!=12){
        MPE6Machine->controller.set(input->buttons);MPE6Renderer->set_sharp(input->display&1);
    }
    const uint8_t next=(InputTail+1)&31;
    if(next==InputHead) { InputQueue[(InputTail-1)&31]=*input;return; }
    InputQueue[InputTail]=*input;InputTail=next;
}
static void module_pump(){
    if(!ModulePacketPending && !MPE6FrameReady && !MPE6InputPending && InputHead!=InputTail){
        const auto in=InputQueue[InputHead];InputHead=(InputHead+1)&31;
        MPE6InputButtons=in.buttons;MPE6InputDisplay=in.display;MPE6InputOverflow=in.overflow;MPE6InputPending=true;
    }
    if(MPE6ModeState==MPE6Mode::Game && MPE6Machine->error!=nes::MachineError::None && !ModulePacketPending&&!MPE6FrameReady){
        const auto error=MPE6Machine->error;MPE6ReturnToMenu();MPE6SetMessage(nes::describe(error));
    }
    MPE6Pump();
}
static bool module_packet(VmPacket *out){
    if(ModulePacketPending)return false;
    // VMHost has already called pump for this foreground slice. Packet
    // creation must stay cheap so a newly acknowledged display block is
    // followed by its successor immediately.
    MPE6NextPacket();
    if(!ModulePacketPending)return false;
    *out=ModulePacket;return true;
}
static void module_ack(){MPE6ResumeAfterACK();ModulePacketPending=false;}
static const VmModule Module={VM_ABI,sizeof(VmModule),module_input,module_pump,module_packet,module_ack};
extern "C" __attribute__((section(".entry"),used)) const VmModule *vm_entry(const VmHost *host){
    // This matched Fab0.4 module requires the indexed firmware video service.
    // The picker retains CELL packets; gameplay submits native indexed pixels.
    constexpr uint32_t required=VM_SERVICE_FILES|VM_SERVICE_CLOCK|VM_SERVICE_PACKETS|VM_SERVICE_GUEST_RAM|VM_SERVICE_VIDEO|VM_SERVICE_INDEXED_VIDEO;
    if(!host||host->abi!=VM_ABI||host->bytes<sizeof(VmHost)||(host->services&required)!=required||!host->video_configure||!host->video_indexed)return nullptr;
    ModuleHost=host;
    if(!host->guest_ram||host->guest_ram_bytes!=VM_RAM_BYTES)return nullptr;
    if(host->content_path[0]){
        if(strlen(host->content_path)>=sizeof NesRomDirectory)return nullptr;
        strcpy(NesRomDirectory,host->content_path);char *slash=strrchr(NesRomDirectory,'/');if(!slash)return nullptr;
        if(slash==NesRomDirectory)slash[1]=0;else *slash=0;
    } else if(snprintf(NesRomDirectory,sizeof NesRomDirectory,"%s/ROMS",host->package_root)>=(int)sizeof NesRomDirectory)return nullptr;
    return MPE6Start(0)?&Module:nullptr;
}
// newlib's printf formatting uses no I/O. Unexpected heap use fails closed.
#if defined(__arm__)
extern "C" void *_sbrk(ptrdiff_t){return reinterpret_cast<void *>(-1);}
extern "C" int _write(int,const void *,int){return -1;}
extern "C" int _read(int,void *,int){return -1;}
extern "C" int _close(int){return -1;}
extern "C" int _fstat(int,void *){return -1;}
extern "C" int _isatty(int){return 0;}
extern "C" int _lseek(int,int,int){return -1;}
extern "C" int _getpid(){return 1;}
extern "C" int _kill(int,int){return -1;}
extern "C" void _exit(int){for(;;){}}
#endif
