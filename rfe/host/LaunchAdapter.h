// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Mean Hamster Software
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Include after the shared boot-indicator definitions and VmRegistry. This
// adapter receives a decoded request; it does not define an EEPROM slot-byte
// encoding, consume a loader flag, initialize the C64 bus, or reset hardware.
namespace MpeRfe {
enum class Source : uint8_t { PhysicalSd, Unsupported };
enum class Kind : uint8_t { None, Package, Cartridge };
enum class Result : uint8_t {
    Ready, Started, NotRequested, WrongBootState, UnsupportedSource,
    InvalidPath, UnsupportedFile, SdUnavailable, MissingFile, InvalidClient,
    MissingPackage, AmbiguousPackage, InvalidPackage, CartridgeRejected,
    StartFailed, NotPrepared
};
enum class Probe : uint8_t { Missing, File, Launcher, Cartridge, InvalidClient };

struct Request {
    uint8_t bootIndicator{};
    bool extensionSelected{}; // Supplied by an external, agreed loader contract.
    Source source{Source::Unsupported};
    char path[256]{}; // Full physical SD path, not a display label or @ marker.
};
struct PreparedLaunch {
    Kind kind{Kind::None};
    char selectedPath[256]{};
    VmRegistry::Launch package{};
};

static FLASHMEM bool equalExtension(const char *a,const char *b){
    while(*a&&*b){
        const char x=*a>='A'&&*a<='Z'?char(*a+('a'-'A')):*a;
        if(x!=*b)return false;
        ++a;++b;
    }
    return !*a&&!*b;
}
static FLASHMEM bool validPath(const char (&path)[256]){
    const char *end=static_cast<const char *>(memchr(path,0,sizeof path));
    if(!end||end==path||path[0]!='/'||end[-1]=='/'||
       strstr(path,"..")||strchr(path,'\\')||strchr(path,'*'))return false;
    for(const char *p=path;p<end;++p)if(static_cast<unsigned char>(*p)<32)return false;
    return true;
}

static FLASHMEM Result validateRequest(const Request &request){
    if(!request.extensionSelected)return Result::NotRequested;
    // MinimalBoot has already consumed ExecuteExt. Requiring ExecuteExt here
    // would reject every legitimate handoff and could replay stale requests.
    if(request.bootIndicator!=MinBootInd_FromMin)return Result::WrongBootState;
    if(request.source!=Source::PhysicalSd)return Result::UnsupportedSource;
    if(!validPath(request.path))return Result::InvalidPath;
    const char *name=strrchr(request.path,'/')+1;
    const char *dot=strrchr(name,'.');
    if(!dot||dot==name||!dot[1])return Result::UnsupportedFile;
    const char *ext=dot+1;
    const bool cart=equalExtension(ext,"mpe"),crt=equalExtension(ext,"crt");
    const bool console=equalExtension(ext,"nes")||equalExtension(ext,"gb")||
        equalExtension(ext,"gbc")||equalExtension(ext,"gc")||equalExtension(ext,"gg");
    return cart||crt||console?Result::Ready:Result::UnsupportedFile;
}

// Backend performs only bounded SD reads during preparation. VmRegistry's
// existing discovery/preflight owns package identity, aliasing and integrity.
template<class Backend>
FLASHMEM Result prepare(const Request &request,Backend &backend,PreparedLaunch &out){
    out=PreparedLaunch{};
    const Result validation=validateRequest(request);
    if(validation!=Result::Ready)return validation;
    const char *ext=strrchr(request.path,'.')+1;
    const bool cart=equalExtension(ext,"mpe"),crt=equalExtension(ext,"crt");
    if(!backend.beginSd())return Result::SdUnavailable;
    char clientId[24]{};
    const Probe probe=backend.inspect(request.path,cart||crt,clientId);
    if(probe==Probe::Missing)return Result::MissingFile;
    if(cart||probe==Probe::Cartridge){
        if(probe!=Probe::Cartridge)return Result::CartridgeRejected;
        memcpy(out.selectedPath,request.path,sizeof out.selectedPath);
        out.kind=Kind::Cartridge;
        return Result::Ready; // VMHostBootCart performs full MGC1 validation.
    }
    if(probe==Probe::InvalidClient)return Result::InvalidClient;
    if(crt&&probe!=Probe::Launcher)return Result::UnsupportedFile;
    VmRegistry::Launch launch{};
    const int found=backend.find(ext,crt?clientId:nullptr,launch);
    if(!found)return Result::MissingPackage;
    if(found<0)return Result::AmbiguousPackage;
    if(!crt)memcpy(launch.content,request.path,sizeof launch.content);
    if(!backend.preflight(launch))return Result::InvalidPackage;
    // Retain the existing Launch layout and CRC for the prepared-host API,
    // but never create /VMS/launch.vml merely to cross an in-process boundary.
    launch.magic=0x314c4d56u;
    launch.crc=vm_crc32(&launch,offsetof(VmRegistry::Launch,crc));
    memcpy(out.selectedPath,request.path,sizeof out.selectedPath);
    out.package=launch;
    out.kind=Kind::Package;
    return Result::Ready;
}

template<class Backend>
FLASHMEM Result dispatch(PreparedLaunch &prepared,Backend &backend){
    const Kind kind=prepared.kind;
    prepared.kind=Kind::None; // A prepared launch can be dispatched only once.
    if(kind==Kind::Cartridge)
        return backend.bootCart(prepared.selectedPath)>0?Result::Started:Result::CartridgeRejected;
    if(kind!=Kind::Package)return Result::NotPrepared;
    if(prepared.package.magic!=0x314c4d56u||
       prepared.package.crc!=vm_crc32(&prepared.package,offsetof(VmRegistry::Launch,crc))||
       !backend.preflight(prepared.package))return Result::InvalidPackage;
    return backend.bootPackage(prepared.package)?Result::Started:Result::StartFailed;
}
}
