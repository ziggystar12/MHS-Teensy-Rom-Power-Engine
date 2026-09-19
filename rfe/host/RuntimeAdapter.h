// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Mean Hamster Software
#pragma once
// Include after VMHost.h, including its staged VMHostBootPrepared(Launch)
// entry point. MPE_RFE_HOST_PREFLIGHT exposes only the existing read-only
// VmRegistry preflight to the dedicated MinimumBuild host.
#include "LaunchAdapter.h"

namespace MpeRfe {
struct SdBackend {
    FLASHMEM bool beginSd(){return SD.sdfs.begin(SdioConfig(FIFO_SDIO));}
    FLASHMEM Probe inspect(const char *path,bool descriptor,char (&id)[24]){
        FsFile file=SD.sdfs.open(path,O_RDONLY);
        if(!file||file.isDirectory()){file.close();return Probe::Missing;}
        if(!descriptor){file.close();return Probe::File;}
        uint8_t bytes[128]{};
        const int count=file.seekSet(0x4070)?file.read(bytes,sizeof bytes):-1;
        file.close();
        // Recognized corrupt/new MGC versions still reach the container
        // validator; they must never fall into ordinary CRT execution.
        if(count>=3&&!memcmp(bytes,"MGC",3))return Probe::Cartridge;
        if(count<4||memcmp(bytes,"VMH1",4))return Probe::File;
        if(count!=sizeof bytes||bytes[4]!=VM_ABI||!memchr(bytes+16,0,sizeof id)||
           vm_crc32(bytes,124)!=VmClientOverlay::little32(bytes+124))return Probe::InvalidClient;
        memcpy(id,bytes+16,sizeof id);
        return VmRegistry::component(id)?Probe::Launcher:Probe::InvalidClient;
    }
    FLASHMEM int find(const char *extension,const char *clientId,VmRegistry::Launch &launch){
        return VmRegistry::find(extension,clientId,launch);
    }
    FLASHMEM bool preflight(const VmRegistry::Launch &launch){return VmRegistry::preflight(launch);}
    FLASHMEM bool bootPackage(const VmRegistry::Launch &launch){return VMHostBootPrepared(launch);}
    FLASHMEM int bootCart(const char *path){return VMHostBootCart(path);}
};

static FLASHMEM Result start(const Request &request){
    SdBackend backend;
    PreparedLaunch prepared{};
    const Result result=prepare(request,backend,prepared);
    return result==Result::Ready?dispatch(prepared,backend):result;
}
}
