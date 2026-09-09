// SPDX-License-Identifier: MIT
// Checked, alternating SRAM records. A failed write leaves the prior record intact.
#pragma once
#include "../abi/vm_abi.h"
#include <cstdio>
#include <cstring>
#if defined(__GNUC__)
#pragma GCC push_options
#pragma GCC optimize ("Os")
#endif

class NesSaveStore {
    struct Record { uint32_t magic,sequence,length,crc; uint8_t identity[32]; };
    const VmHost *host_=nullptr;
    uint8_t *ram_=nullptr,identity_[32]{};
    uint32_t size_=0,sequence_=0;
    int slot_=-1;
    bool ready_=false;
    char directory_[288]{},path_[320]{};
    static uint32_t update(uint32_t crc,const uint8_t *data,unsigned bytes){
        while(bytes--){crc^=*data++;for(unsigned bit=0;bit<8;bit++)crc=(crc>>1)^((0u-(crc&1))&0xedb88320u);}return crc;
    }
    void name(unsigned slot){
        char key[17];const char *hex="0123456789abcdef";
        for(unsigned n=0;n<8;n++){key[n*2]=hex[identity_[n]>>4];key[n*2+1]=hex[identity_[n]&15];}key[16]=0;
        snprintf(path_,sizeof path_,"%s/%s.s%u",directory_,key,slot);
    }
    bool inspect(unsigned slot,Record &record,bool &present,bool restore=false){
        name(slot);VmFileInfo info{};const uint32_t file=host_->open(path_,&info);present=file!=0;
        if(!file)return false;
        bool ok=!info.directory&&info.bytes==sizeof record+size_&&
            host_->read(file,0,&record,sizeof record)==int32_t(sizeof record)&&
            record.magic==0x3153454e&&record.length==size_&&!memcmp(record.identity,identity_,32);
        uint8_t buffer[512];uint32_t crc=~0u;
        for(unsigned offset=0;ok&&offset<size_;offset+=sizeof buffer){
            const unsigned count=size_-offset<sizeof buffer?size_-offset:sizeof buffer;
            ok=host_->read(file,sizeof record+offset,buffer,count)==int32_t(count);
            if(ok){crc=update(crc,buffer,count);if(restore)memcpy(ram_+offset,buffer,count);}
        }
        host_->close(file);return ok&&~crc==record.crc;
    }
public:
    bool load(const VmHost *host,uint8_t *ram,uint32_t bytes,const uint8_t identity[32]){
        host_=host;ram_=ram;size_=bytes;sequence_=0;slot_=-1;ready_=false;memcpy(identity_,identity,32);
        if(!bytes)return true;
        if(bytes!=8192||!ram||!host||!host->open_flags||!host->write||!host->file_op)return false;
        if(snprintf(directory_,sizeof directory_,"%s/SAVES",host->package_root)>=int(sizeof directory_))return false;
        bool any=false;
        for(unsigned slot=0;slot<2;slot++){
            Record r{};bool present=false;
            if(inspect(slot,r,present)&&(slot_<0||int32_t(r.sequence-sequence_)>0)){slot_=slot;sequence_=r.sequence;}
            any|=present;
        }
        if(any&&slot_<0)return false;
        if(slot_>=0){Record r{};bool present=false;if(!inspect(slot_,r,present,true))return false;}
        ready_=true;return true;
    }
    bool flush(bool dirty){
        if(!size_||!dirty)return true;
        if(!ready_)return false;
        VmFileInfo info{};const auto directory=host_->open(directory_,&info);
        if(directory){host_->close(directory);if(!info.directory)return false;}
        else{VmFsRequest op{VmFsOp::Mkdir,0,1,0,directory_,nullptr};if(host_->file_op(&op))return false;}
        const unsigned target=slot_==0?1:0;
        Record record{0x3153454e,sequence_+1,size_,~update(~0u,ram_,size_),{}};memcpy(record.identity,identity_,32);
        name(target);const auto file=host_->open_flags(path_,VM_OPEN_WRITE|VM_OPEN_CREATE|VM_OPEN_TRUNCATE,&info);
        if(!file)return false;
        const Record pending{};bool ok=host_->write(file,0,&pending,sizeof pending)==int32_t(sizeof pending);
        for(unsigned offset=0;ok&&offset<size_;offset+=512){
            const unsigned count=size_-offset<512?size_-offset:512;
            ok=host_->write(file,sizeof record+offset,ram_+offset,count)==int32_t(count);
        }
        VmFsRequest op{VmFsOp::Flush,file,0,0,nullptr,nullptr};
        if(ok)ok=host_->file_op(&op)==0;
        if(ok)ok=host_->write(file,0,&record,sizeof record)==int32_t(sizeof record);
        if(ok)ok=host_->file_op(&op)==0;
        op.operation=VmFsOp::Close;if(host_->file_op(&op))ok=false;
        Record checked{};bool present=false;
        if(!ok||!inspect(target,checked,present)||memcmp(&record,&checked,sizeof record))return false;
        slot_=target;sequence_=record.sequence;return true;
    }
};
#if defined(__GNUC__)
#pragma GCC pop_options
#endif
