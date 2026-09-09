// Replay actual Doom converter frames through the firmware's slice uploader.
// Counts bytes/border grants; deliberately does not estimate hardware FPS.
#define NOMINMAX
#include <windows.h>
#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
#include "../abi/vm_abi.h"
#define FLASHMEM
#define FeatVMVideoDMA
#define Fab04_FullDMACapable
enum {DMA_S_DisableReady,DMA_S_Active};
static unsigned DMA_State,nS_DMASetup,nS_MaxAdj;
static uint32_t ARM_DWT_CYCCNT;
static constexpr uint32_t F_CPU_ACTUAL=600000000;
static constexpr unsigned Def_nS_DMASetupNTSC=1,Def_nS_DMASetupPAL=2,Def_nS_MaxAdjNTSC=3,Def_nS_MaxAdjPAL=4;
static uint8_t c64[65536];
static bool PerformDMA(bool,uint16_t address,uint8_t *data,uint16_t bytes,bool){
    assert(unsigned(address)+bytes<=65536);DMA_State=DMA_S_Active;memcpy(c64+address,data,bytes);return true;
}
static bool AGIContinueDMA(bool r,uint16_t a,uint8_t *d,uint16_t n,bool f){return PerformDMA(r,a,d,n,f);}
static bool CloseDMA(){DMA_State=DMA_S_DisableReady;return true;}
static void AGIDMAEmergencyRelease(){DMA_State=DMA_S_DisableReady;}
namespace VmRuntime {static uint8_t videoTiming=0x80;}
#include "../../Teensy/MinimalBoot/VMIndexedVideo.h"
using namespace VmRuntime;
int main(int argc,char **argv){
    assert(argc==2);FILE *input=fopen(argv[1],"rb");assert(input);
    fseek(input,0,SEEK_END);long bytes=ftell(input);rewind(input);
    assert(bytes>0&&bytes%(sizeof(mpe_video::LiveFrame)*4)==0);
    std::vector<mpe_video::LiveFrame> frames(bytes/sizeof(mpe_video::LiveFrame));
    assert(fread(frames.data(),1,bytes,input)==unsigned(bytes));fclose(input);
    auto arena=VirtualAlloc((void *)0x20010000,0x40000,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);assert(arena==(void *)0x20010000);
    for(unsigned timing:{0x82u,0x83u}){
        videoTiming=timing;VmIndexedVideoSetup setup{sizeof setup,(void *)VM_DATA_BASE,mpe_video::DeltaWorkspaceBytes,0,15,0};
        assert(configureIndexedVideo(&setup));uint64_t totalBytes=0;unsigned grants=0,kernels=0,maxGrants=0;
        for(unsigned f=0;f<frames.size()/4;f++){
            auto &v=indexedVideo;*v.frame=frames[f*4+2];v.targetBank=1-v.activeBank;
            const auto old=v.bankValid[v.targetBank]?v.bank[v.targetBank]:nullptr;
            v.kernelNeeded=v.frame->mask&&(!old||old->mask!=v.frame->mask||memcmp(old->split,v.frame->split,25));
            kernels+=v.kernelNeeded;
            v.kernelBytes=mpe_video::buildKernel(*v.frame,timing&1,v.kernel,mpe_video::KernelCapacity,v.targetBank?0xc000:0x3000);
            assert(v.kernelBytes);v.streamOffset=v.uploadedBytes=0;v.phase=6;videoBorderWaiting=true;
            unsigned n=0;while(v.phase==6){assert(++n<32);indexedVideoBorder();assert(transferIndexedVideoSlice());}
            assert(v.phase==7);indexedVideoAck();assert(v.activeBank==v.targetBank);
            grants+=n;if(n>maxGrants)maxGrants=n;totalBytes+=v.uploadedBytes;
        }
        printf("{\"mode\":\"F5\",\"timing\":\"%s\",\"frames\":%u,\"bytes\":%llu,\"borderGrants\":%u,\"maxGrants\":%u,\"kernelUploads\":%u}\n",
            timing&1?"NTSC":"PAL",unsigned(frames.size()/4),(unsigned long long)totalBytes,grants,maxGrants,kernels);
    }
}
