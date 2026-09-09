// MPE port, 2026-09-04. Nofrendo CPU/PPU remain under GNU Library GPL v2.
// No host driver, allocation, filesystem access, or firmware globals in the core.
#include "machine.h"
#include <cstring>
#include <cstdlib>
#include <cstdio>

namespace mpe_nofrendo {
static nes::NofrendoMachine *active;
static void draw_line(const unsigned char*,int,int,int);
#include "vendor/noftypes.h"
#define MPE_NOFRENDO 1
#define log_printf(...) ((void)0)
#define nes_nmi() nes6502_nmi()
#define emu_DrawLinePal16 draw_line
#define NES_SCREEN_WIDTH 256
#include "vendor/nes6502.c"
#include "vendor/nes_ppu.c"
#undef MPE_NOFRENDO
#undef log_printf
#undef nes_nmi
#undef emu_DrawLinePal16

static uint8 bus_read(uint32 address) { return active->read(uint16_t(address)); }
static void bus_write(uint32 address,uint8 value) { active->write(uint16_t(address),value); }
static nes6502_memread reads[]={{0x800,0x7fff,bus_read},{0xffffffff,0xffffffff,nullptr}};
static nes6502_memwrite writes[]={{0x800,0xffff,bus_write},{0xffffffff,0xffffffff,nullptr}};
static void draw_line(const unsigned char* pixels,int,int,int y) {
    const auto sink=active->raster;
    if(!sink.pixel)return;
    const uint8_t mask=((ppu.ctrl1&1)?0x30:0x3f)|(active->spriteTags?SP_PIXEL:0);
    for(unsigned x=0;x<256;++x)sink.pixel(sink.context,x,y,pixels[x]&mask);
}
}

namespace nes {
namespace nf=mpe_nofrendo;
void NofrendoMachine::map_cartridge() {
    for(unsigned page=8;page<16;++page) {
        uint32_t offset=(page-8)*4096;
        if(cart.info.mapper==11)offset+=uint32_t(cart.bank&3)*32768;
        nf::cpu.mem_page[page]=const_cast<uint8_t*>(cart.prg)+(offset&(cart.info.prg_bytes-1));
    }
    uint32_t offset=cart.info.mapper==11?uint32_t(cart.bank>>4)*8192:0;
    if(cart.info.chr_bytes)offset&=cart.info.chr_bytes-1;
    auto chr=cart.info.chr_bytes?const_cast<uint8_t*>(cart.chr)+offset:cart.chr_ram;
    for(unsigned page=0;page<8;++page)nf::ppu.page[page]=chr+page*1024;
}
bool NofrendoMachine::init(const Cartridge& cartridge,const RasterSink& sink) {
#ifdef MHS_NES_EXTERNAL_RAM
    uint8_t *storage=ram;
#endif
    *this=NofrendoMachine{};
#ifdef MHS_NES_EXTERNAL_RAM
    ram=storage;
    if(!ram){error=MachineError::InvalidCartridge;return false;}
#endif
    cart=cartridge;raster=sink;
    if(!cart.prg || supported(cart.info)!=RomError::None ||
       (cart.info.chr_bytes?!cart.chr:!cart.chr_ram)) {
        error=MachineError::InvalidCartridge;return false;
    }
    nf::active=this;
    memset(ram,0,2048);
    if(cart.chr_ram)memset(cart.chr_ram,0,cart.info.chr_ram);
    nf::cpu={};nf::cpu.mem_page[0]=ram;nf::cpu.read_handler=nf::reads;nf::cpu.write_handler=nf::writes;
    nf::nes6502_setcontext(&nf::cpu);
    nf::ppu={};memset(nf::ppu.oam,0xff,sizeof nf::ppu.oam);
    nf::ppu.drawsprites=true;nf::ppu.vram_present=cart.info.chr_bytes==0;
    for(unsigned page=8;page<12;++page) {
        const unsigned table=cart.info.vertical?((page-8)&1):((page-8)>>1);
        nf::ppu.page[page]=nf::ppu.nametab+table*1024;
        nf::ppu.page[page+4]=nf::ppu.page[page];
    }
    map_cartridge();
    for(unsigned i=0;i<32;i+=4)nf::ppu.palette[i]=0x80;
    nf::ppu_write(0x2000,0);nf::ppu_write(0x2001,0);
    nf::nes6502_reset();nf::cpu.s_reg=0xfd;
    return true;
}
void NofrendoMachine::sync_apu() {
    const uint32_t now=nf::nes6502_getcycles(false);
    uint32_t ticks=now-apu_cycles;
    while(ticks--)apu.tick();
    apu_cycles=now;
    nf::cpu.int_pending=apu.irq?1:0;
}
static uint8_t pal_address(uint16_t a) {
    uint8_t i=a&31;return (i&0x13)==0x10?i&15:i;
}
uint8_t NofrendoMachine::read(uint16_t address) {
    uint8_t result=open_bus;
    if(address<0x2000)result=ram[address&0x7ff];
    else if(address<0x4000) {
        if((address&7)==7) {
            const uint16_t a=nf::ppu.vaddr&0x3fff;
            if(a>=0x3f00) {
                result=(nf::ppu.latch&0xc0)|(palette_ram[pal_address(a)]&((nf::ppu.ctrl1&1)?0x30:0x3f));
                nf::ppu.vdata_latch=nf::ppu.page[(a-0x1000)>>10][a&1023];
            } else {result=nf::ppu.vdata_latch;nf::ppu.vdata_latch=nf::ppu.page[a>>10][a&1023];}
            nf::ppu.latch=result;nf::ppu.vaddr=(nf::ppu.vaddr+nf::ppu.vaddr_inc)&0x3fff;
        } else result=nf::ppu_read(address);
    } else if(address==0x4015) {sync_apu();result=(open_bus&0x20)|apu.status();nf::cpu.int_pending=0;}
    else if(address==0x4016){result=(open_bus&0xe0)|controller.read();++controller_reads;}
    else if(address==0x4017){result=open_bus&0xe0;++controller2_reads;}
    else if(address>=0x8000)result=cart.cpu_read(address);
    open_bus=result;return result;
}
void NofrendoMachine::write(uint16_t address,uint8_t value) {
    open_bus=value;
    if(address<0x2000)ram[address&0x7ff]=value;
    else if(address<0x4000) {
        const bool nmi_before=(nf::ppu.ctrl0&0x80)&&(nf::ppu.stat&0x80);
        if((address&7)==7) {
            const uint16_t a=nf::ppu.vaddr&0x3fff;
            if(a>=0x3f00) {
                palette_ram[pal_address(a)]=value&63;
                if((a&3)!=0)nf::ppu.palette[a&31]=value&63;
                else if((a&15)==0)for(unsigned i=0;i<32;i+=4)nf::ppu.palette[i]=(value&63)|0x80;
            } else if(a>=0x2000 || !cart.info.chr_bytes)nf::ppu.page[a>>10][a&1023]=value;
            nf::ppu.latch=value;nf::ppu.vaddr=(nf::ppu.vaddr+nf::ppu.vaddr_inc)&0x3fff;
        } else nf::ppu_write(address,value);
        if(!nmi_before&&(nf::ppu.ctrl0&0x80)&&(nf::ppu.stat&0x80)) {
            pending_nmi=true;nf::nes6502_release(); // deliver after instruction registers are saved
        }
    } else if(address==0x4014) {
        for(unsigned i=0;i<256;++i)nf::ppu.oam[nf::ppu.oam_addr++]=read(uint16_t(value*256+i));
        const unsigned burn=513+(nf::nes6502_getcycles(false)&1);
        nf::nes6502_burn(burn);nf::nes6502_release();dma_cycles+=burn;++dma_transfers;
    } else if(address==0x4016)controller.write(value);
    else if(address<=0x4017) {
        sync_apu();apu.write(address,value,nf::nes6502_getcycles(false));
        nf::cpu.int_pending=apu.irq?1:0;
        if(apu.dmc_requested){error=MachineError::DmcNotImplemented;nf::nes6502_release();}
    } else if(address>=0x8000){cart.cpu_write(address,value);map_cartridge();}
}
uint64_t NofrendoMachine::run_cycles(uint64_t count) {
    const uint64_t begin=cycles;
    while(cycles-begin<count && error==MachineError::None) {
        if(!line_cycles) {
            dot_remainder+=2;line_cycles=113+(dot_remainder>=3);
            if(dot_remainder>=3)dot_remainder-=3;
            line_elapsed=0;
            // Render even non-presented frames: sprite-zero timing must not
            // change with MPE transport backpressure or selected video mode.
            nf::ppu_scanline(nullptr,scanline,true);
            if(scanline==241){vblank_nmi_delivered=false;++ppu.frames;if(raster.frame)raster.frame(raster.context,ppu.frames);}
        }
        unsigned request=unsigned((count-(cycles-begin))>114?114:count-(cycles-begin));
        unsigned boundary=(scanline==241&&line_elapsed<7)?7:line_cycles;
        if(request>boundary-line_elapsed)request=boundary-line_elapsed;
        unsigned done=0;
        if(credit){done=credit<request?credit:request;credit-=done;}
        else {
            const int actual=nf::nes6502_execute(request);
            if(actual<=0){error=MachineError::CpuJammed;break;}
            sync_apu();
            done=unsigned(actual)>request?request:unsigned(actual);
            credit=unsigned(actual)-done;
            if(pending_nmi){pending_nmi=false;vblank_nmi_delivered=true;nf::nes6502_nmi();}
            if(nf::cpu.jammed)error=MachineError::CpuJammed;
        }
        cycles+=done;line_elapsed+=done;
        if(scanline==241&&line_elapsed==7) {
            // Only deliver an edge if the game has not already read $2002.
            if(!vblank_nmi_delivered&&(nf::ppu.ctrl0&0x80)&&(nf::ppu.stat&0x80)){
                nf::nes6502_nmi();vblank_nmi_delivered=true;
            }
        }
        if(line_elapsed==line_cycles){nf::ppu_endscanline(scanline);scanline=(scanline+1)%262;line_cycles=0;}
    }
    return cycles-begin; // never over-credit scheduler debt, including tiny requests
}
}
