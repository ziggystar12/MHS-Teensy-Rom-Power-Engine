// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "../../abi/vm_abi.h"
#include <string.h>
namespace gbadoomvm {
// Optional, fixed-size, CRC-checked records. No tune code runs on the C64 or
// Teensy, and a late picture never slows the music's wall-clock timeline.
struct SidStream {
    const VmHost *host=nullptr;
    uint32_t handle=0,count=0,loop=0,index=0,last=0;
    bool clocked=false;
    uint8_t value[28]{};
    static uint16_t crc(const uint8_t *p,unsigned n){uint16_t c=65535;while(n--){c^=uint16_t(*p++)<<8;for(unsigned b=0;b<8;b++)c=(c<<1)^((c&0x8000)?0x1021:0);}return c;}
    static uint32_t u32(const uint8_t *p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
    void close(){if(handle)host->close(handle);handle=0;memset(value,0,sizeof value);}
    bool read(uint32_t offset,uint8_t *p,unsigned n){
        while(n){const auto got=host->read(handle,offset,p,n);if(got<=0||unsigned(got)>n)return false;offset+=got;p+=got;n-=got;}return true;
    }
    void open(const VmHost *h,bool ntsc=false){
        close();host=h;clocked=false;index=0;VmFileInfo info{};
        handle=h->open(ntsc?"/VMS/DOOMVM/doom-e1m1-ntsc.s3m":"/VMS/DOOMVM/doom-e1m1-pal.s3m",&info);if(!handle)return;
        uint8_t header[32];
        if(info.directory||!read(0,header,32)||memcmp(header,"M3SM",4)||header[4]!=1||header[5]!=unsigned(ntsc)||
           header[6]!=28||header[7]||u32(header+8)!=20000||crc(header,30)!=(header[30]|header[31]<<8)){close();return;}
        count=u32(header+12);loop=u32(header+16);
        if(!count||count>60000||loop>=count||info.bytes!=32+count*28){close();return;}
        for(unsigned i=20;i<30;i++)if(header[i]){close();return;}
    }
    bool tick(uint32_t now){
        if(!handle)return false;
        uint32_t steps=0;
        if(!clocked){clocked=true;last=now;}
        else{steps=uint32_t(now-last)/20000;if(!steps)return false;last+=steps*20000;
            const uint32_t next=index+steps;index=next<count?next:loop+(next-count)%(count-loop);}
        if(!read(32+index*28,value,28)||value[0]>7||crc(value,26)!=(value[26]|value[27]<<8)){close();return true;}
        if(steps>1)value[0]|=7; // Re-articulate the latest note after a late read.
        return true;
    }
};
}
