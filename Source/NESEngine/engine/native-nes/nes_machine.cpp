#define CHIPS_IMPL
#include "nes_machine.h"
#include <cstring>

namespace nes {
uint8_t Cartridge::cpu_read(uint16_t a) const {
    uint32_t offset=a&0x7fff;
    if (info.mapper==11) offset += uint32_t(bank&3)*32768u;
    return prg[offset & (info.prg_bytes-1)];
}
void Cartridge::cpu_write(uint16_t a,uint8_t value) {
    if (info.mapper!=11) return;
    // Explicit default discrete-logic policy. No automatic no-conflict fallback.
    const uint8_t masked=value & cpu_read(a);
    if (masked!=value) ++bus_conflicts;
    bank=masked;
    ++bank_writes;
}
uint8_t Cartridge::ppu_read(uint16_t a) const {
    if (!info.chr_bytes) return chr_ram[a&0x1fff];
    uint32_t offset=a&0x1fff;
    if (info.mapper==11) offset += uint32_t(bank>>4)*8192u;
    return chr[offset & (info.chr_bytes-1)];
}
void Cartridge::ppu_write(uint16_t a,uint8_t value) {
    if (!info.chr_bytes) chr_ram[a&0x1fff]=value;
}
uint16_t Ppu::nt_index(uint16_t a,bool vertical) const {
    const uint16_t off=(a-0x2000)&0x0fff;
    const uint16_t table=off>>10;
    return uint16_t((off&1023) | ((vertical?(table&1):(table>>1))<<10));
}
static uint8_t palette_index(uint16_t a) {
    uint8_t i=a&31;
    if ((i&0x13)==0x10) i &= 15;
    return i;
}
uint8_t Ppu::read(uint16_t a,const Cartridge& c) const {
    a &= 0x3fff;
    if (a<0x2000) return c.ppu_read(a);
    if (a<0x3f00) return nametable[nt_index(a,c.info.vertical)];
    return palette[palette_index(a)] & ((mask&1)?0x30:0x3f);
}
void Ppu::write(uint16_t a,uint8_t value,Cartridge& c) {
    a &= 0x3fff;
    if (a<0x2000) c.ppu_write(a,value);
    else if (a<0x3f00) nametable[nt_index(a,c.info.vertical)]=value;
    else palette[palette_index(a)]=value&0x3f;
}
uint8_t Ppu::cpu_read(uint8_t reg,const Cartridge& c) {
    uint8_t result=open_bus;
    switch(reg&7) {
    case 2:
        result=(status&0xe0)|(open_bus&0x1f);
        status &= 0x7f;
        write_second=false;
        break;
    case 4: result=oam[oam_addr]; break;
    case 7: {
        const uint16_t address=v&0x3fff;
        const uint8_t value=read(address,c);
        if (address>=0x3f00) {
            result=(open_bus&0xc0)|value;
            read_buffer=read(uint16_t(address-0x1000),c);
        } else { result=read_buffer; read_buffer=value; }
        if ((mask&0x18) && (line<240 || line==261)) { increment_x(); increment_y(); }
        else v=(v+((ctrl&4)?32:1))&0x7fff;
        break;
    }
    default: break;
    }
    open_bus=result;
    return result;
}
void Ppu::cpu_write(uint8_t reg,uint8_t value,Cartridge& c) {
    open_bus=value;
    reg &= 7;
    if (startup_dots && (reg==0 || reg==1 || reg==5 || reg==6)) return;
    switch(reg) {
    case 0: ctrl=value; t=uint16_t((t&0x73ff)|((value&3)<<10)); break;
    case 1: mask=value; break;
    case 3: oam_addr=value; break;
    case 4: oam[oam_addr++]=value; break;
    case 5:
        if (!write_second) { fine_x=value&7; t=uint16_t((t&0x7fe0)|(value>>3)); }
        else t=uint16_t((t&0x0c1f)|((value&7)<<12)|((value&0xf8)<<2));
        write_second=!write_second;
        break;
    case 6:
        if (!write_second) t=uint16_t((t&0x00ff)|((value&0x3f)<<8));
        else { t=uint16_t((t&0x7f00)|value); v=t; }
        write_second=!write_second;
        break;
    case 7:
        write(v,value,c);
        if ((mask&0x18) && (line<240 || line==261)) { increment_x(); increment_y(); }
        else v=(v+((ctrl&4)?32:1))&0x7fff;
        break;
    default: break;
    }
}
void Ppu::increment_x() {
    if ((v&31)==31) v=(v&~31)^0x0400;
    else ++v;
}
void Ppu::increment_y() {
    if ((v&0x7000)!=0x7000) { v+=0x1000; return; }
    v &= ~0x7000;
    uint16_t y=(v&0x03e0)>>5;
    if (y==29) { y=0; v ^= 0x0800; }
    else if (y==31) y=0;
    else ++y;
    v=uint16_t((v&~0x03e0)|(y<<5));
}
void Ppu::reload_shifters() {
    pattern_lo=(pattern_lo&0xff00)|next_lo;
    pattern_hi=(pattern_hi&0xff00)|next_hi;
    attribute_lo=(attribute_lo&0xff00)|((next_attr&1)?0xff:0);
    attribute_hi=(attribute_hi&0xff00)|((next_attr&2)?0xff:0);
}
void Ppu::select_sprites(uint16_t target,const Cartridge& c) {
    // R1: functional eight-sprite selection at dot 257, not the overflow bug or
    // per-dot secondary-OAM evaluation/fetch bus behavior. Keep this limitation explicit.
    sprite_count=0;
    if (target>=240) return;
    const int height=(ctrl&0x20)?16:8;
    for (uint8_t i=0;i<64;++i) {
        int row=int(target)-int(oam[i*4])-1;
        if (row<0 || row>=height) continue;
        if (sprite_count==8) { status|=0x20; break; }
        Sprite& s=sprites[sprite_count++];
        s.x=oam[i*4+3]; s.attr=oam[i*4+2]; s.index=i;
        const uint8_t tile=oam[i*4+1];
        if (s.attr&0x80) row=height-1-row;
        uint16_t address;
        if (height==16) address=uint16_t(((tile&1)<<12)+((tile&0xfe)*16)+(row&7)+(row>=8?16:0));
        else address=uint16_t(((ctrl&8)?0x1000:0)+tile*16+row);
        s.lo=read(address,c); s.hi=read(address+8,c);
    }
}
void Ppu::tick(Cartridge& c,const RasterSink& sink) {
    ++ticks;
    if (startup_dots) --startup_dots;
    const bool rendering=mask&0x18;
    if (line==261 && dot==1) status &= 0x1f;
    if (line==241 && dot==1) {
        status|=0x80;
        ++frames;
        if (sink.frame) sink.frame(sink.context,frames);
    }
    if (rendering && (line<240 || line==261)) {
        if ((dot>=2 && dot<=257) || (dot>=321 && dot<=337)) {
            pattern_lo<<=1; pattern_hi<<=1; attribute_lo<<=1; attribute_hi<<=1;
            switch((dot-1)&7) {
            case 0: reload_shifters(); next_tile=read(0x2000|(v&0x0fff),c); break;
            case 2: {
                const uint16_t a=uint16_t(0x23c0|(v&0x0c00)|((v>>4)&0x38)|((v>>2)&7));
                const uint8_t shift=uint8_t(((v>>4)&4)|(v&2));
                next_attr=(read(a,c)>>shift)&3;
                break;
            }
            case 4: next_lo=read(uint16_t(((ctrl&0x10)?0x1000:0)+next_tile*16+((v>>12)&7)),c); break;
            case 6: next_hi=read(uint16_t(((ctrl&0x10)?0x1000:0)+next_tile*16+((v>>12)&7)+8),c); break;
            case 7: increment_x(); break;
            default: break;
            }
        }
        if (dot==256) increment_y();
        if (dot==257) {
            reload_shifters();
            v=uint16_t((v&~0x041f)|(t&0x041f));
            select_sprites(line==261?0:uint16_t(line+1),c);
        }
        if (line==261 && dot>=280 && dot<=304) v=uint16_t((v&~0x7be0)|(t&0x7be0));
        if (dot==338 || dot==340) next_tile=read(0x2000|(v&0x0fff),c);
    }
    // With no destination image, only sprite-0 collision affects guest state.
    // Keep every fetch, shift, scroll, vblank/NMI and APU/CPU cycle above/below;
    // avoid composing 61,440 unused pixels and scanning other sprites per frame.
    if (line<240 && dot>=1 && dot<=256 && (sink.pixel ||
        (!(status&0x40) && (mask&0x18)==0x18 && sprite_count &&
         sprites[0].index==0 && dot>sprites[0].x && dot<=unsigned(sprites[0].x)+8))) {
        const uint16_t x=dot-1;
        uint8_t bg=0,bg_pal=0,sp=0,sp_pal=0;
        bool behind=false,sprite0=false;
        if ((mask&8) && (x>=8 || (mask&2))) {
            const uint16_t bit=uint16_t(0x8000>>fine_x);
            bg=uint8_t(unsigned(bool(pattern_lo&bit)) | (unsigned(bool(pattern_hi&bit))<<1));
            if(sink.pixel) bg_pal=uint8_t(unsigned(bool(attribute_lo&bit)) | (unsigned(bool(attribute_hi&bit))<<1));
        }
        if ((mask&16) && (x>=8 || (mask&4))) {
            const uint8_t count=sink.pixel?sprite_count:1;
            for (uint8_t i=0;i<count;++i) {
                const Sprite& s=sprites[i];
                const int offset=int(x)-s.x;
                if (offset<0 || offset>=8) continue;
                const uint8_t bit=uint8_t((s.attr&0x40)?offset:7-offset);
                const uint8_t value=((s.lo>>bit)&1)|(((s.hi>>bit)&1)<<1);
                if (!value) continue;
                sp=value; sp_pal=s.attr&3; behind=s.attr&0x20; sprite0=s.index==0;
                break;
            }
        }
        if (bg && sp && sprite0 && x<255 && !(status&0x40)) { status|=0x40; ++sprite0_hits; }
        if (sink.pixel) {
            uint16_t address=0x3f00;
            if (sp && (!bg || !behind)) address=uint16_t(0x3f10+sp_pal*4+sp);
            else if (bg) address=uint16_t(0x3f00+bg_pal*4+bg);
            if (!rendering && (v&0x3f00)==0x3f00) address=v;
            // R1 raster emits palette indices; emphasis is recorded in mask but not
            // yet color-corrected by the diagnostic host palette.
            sink.pixel(sink.context,x,line,read(address,c));
        }
    }
    const bool n=nmi();
    if (n && !previous_nmi) ++nmi_edges;
    previous_nmi=n;
    if (line==261 && dot==339 && odd && rendering) { dot=0; line=0; odd=!odd; return; }
    if (++dot==341) {
        dot=0;
        if (++line==262) { line=0; odd=!odd; }
    }
}
static constexpr uint8_t length_table[32]={10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,
    12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30};
uint16_t Apu::sweep_target(uint8_t ch) const {
    const auto base=ch*4;const uint8_t sweep=regs[base+1];
    const unsigned period=regs[base+2]|((regs[base+3]&7)<<8),delta=period>>(sweep&7);
    const int target=(sweep&8)?int(period)-int(delta)-(ch==0):int(period+delta);
    return uint16_t(target<0?0:target);
}
void Apu::quarter_frame() {
    for(uint8_t ch=0;ch<4;ch++){
        if(ch==2)continue;
        const uint8_t control=regs[ch*4],period=control&15;
        if(envelope_start[ch]){envelope_start[ch]=false;envelope_level[ch]=15;envelope_divider[ch]=period;}
        else if(envelope_divider[ch])--envelope_divider[ch];
        else {
            envelope_divider[ch]=period;
            if(envelope_level[ch])--envelope_level[ch];else if(control&32)envelope_level[ch]=15;
        }
    }
}
void Apu::half_frame() {
    for (uint8_t i=0;i<4;++i) {
        const uint8_t halt=(i==2)?0x80:0x20;
        if (length[i] && !(regs[i*4]&halt)) --length[i];
    }
    for(uint8_t ch=0;ch<2;ch++){
        const auto base=ch*4;const uint8_t sweep=regs[base+1];
        const unsigned period=regs[base+2]|((regs[base+3]&7)<<8),target=sweep_target(ch);
        if(!sweep_divider[ch]&&(sweep&128)&&(sweep&7)&&period>=8&&target<=0x7ff){
            // These timer latches are also used by subsequent low/high writes.
            // Preserve the length-load bits and do not retrigger the envelope.
            regs[base+2]=uint8_t(target);regs[base+3]=(regs[base+3]&0xf8)|(target>>8);
        }
        if(!sweep_divider[ch]||sweep_reload[ch]){sweep_divider[ch]=(sweep>>4)&7;sweep_reload[ch]=false;}
        else --sweep_divider[ch];
    }
}
void Apu::write(uint16_t a,uint8_t value,uint64_t cycle) {
    ++writes;
    regs[a-0x4000]=value;
    if (a<=0x400f && (a&3)==3) {
        const uint8_t ch=(a-0x4000)/4;
        if (enabled&(1<<ch)) length[ch]=length_table[value>>3];
        ++triggers[ch];
        if(ch!=2)envelope_start[ch]=true;
    } else if(a==0x4001||a==0x4005){
        sweep_reload[(a-0x4000)/4]=true;
    } else if (a==0x4015) {
        enabled=value&31;
        for (uint8_t i=0;i<4;++i) if (!(enabled&(1<<i))) length[i]=0;
        if (enabled&16) dmc_requested=true;
    } else if (a==0x4017) {
        five_step=value&0x80; inhibit=value&0x40;
        if (inhibit) irq=false;
        reset_delay=(cycle&1)?4:3;
    }
}
uint8_t Apu::status() {
    uint8_t value=irq?0x40:0;
    for (uint8_t i=0;i<4;++i) if (length[i]) value|=uint8_t(1<<i);
    irq=false;
    return value;
}
void Apu::tick() {
    if (reset_delay && !--reset_delay) { phase=0; if(five_step){quarter_frame();half_frame();} return; }
    ++phase;
    if (phase==7457 || phase==22371) quarter_frame();
    if (phase==14913 || phase==(five_step?37281u:29829u)){quarter_frame();half_frame();}
    if (!five_step && phase>=29828 && phase<=29830 && !inhibit) irq=true;
    if (phase==(five_step?37282u:29830u)) phase=0;
}
bool Machine::init(const Cartridge& input_cartridge,const RasterSink& input_sink) {
    // Allow a caller to relaunch using this machine's existing borrowed views.
    const Cartridge cartridge=input_cartridge;
    const RasterSink sink=input_sink;
#ifdef MHS_NES_EXTERNAL_RAM
    auto guest=ram;
    if(!guest){error=MachineError::InvalidCartridge;return false;}
#endif
    *this=Machine{};
#ifdef MHS_NES_EXTERNAL_RAM
    ram=guest;ppu.nametable=guest+2048;ppu.palette=guest+4096;ppu.oam=guest+4128;
    std::memset(guest,0,4384);
#endif
    if (!cartridge.prg || (cartridge.info.chr_bytes?!cartridge.chr:!cartridge.chr_ram) ||
        supported(cartridge.info)!=RomError::None) { error=MachineError::InvalidCartridge; return false; }
    cart=cartridge; cart.bank=0; cart.bank_writes=cart.bus_conflicts=0;
    raster=sink;
    std::memset(ppu.oam,0xff,256);
    if (cart.chr_ram) std::memset(cart.chr_ram,0,cart.info.chr_ram);
    m6502_desc_t desc{}; desc.bcd_disabled=true;
    pins=m6502_init(&cpu,&desc);
    return true;
}
uint8_t Machine::read(uint16_t a) {
    uint8_t value=open_bus;
    if (a<0x2000) value=ram[a&0x7ff];
    else if(a<0x4000) value=ppu.cpu_read(a&7,cart);
    else if(a==0x4015) value=(open_bus&0x20)|apu.status();
    else if(a==0x4016) { value=(open_bus&0xe0)|controller.read(); ++controller_reads; }
    // Unconnected NES port 2 reads zero on D0 (the hardware input is inverted).
    // Do not return an endless stream of pressed player-2 buttons.
    else if(a==0x4017) { value=open_bus&0xe0; ++controller2_reads; }
    else if(a>=0x8000) value=cart.cpu_read(a);
    open_bus=value;
    return value;
}
void Machine::write(uint16_t a,uint8_t value) {
    open_bus=value;
    if(a<0x2000) ram[a&0x7ff]=value;
    else if(a<0x4000) ppu.cpu_write(a&7,value,cart);
    else if(a==0x4014) { dma_page=value; dma_pending=true; }
    else if(a==0x4016) controller.write(value);
    else if(a<=0x4017) {
        apu.write(a,value,cycles);
        if (apu.dmc_requested) error=MachineError::DmcNotImplemented;
    } else if(a>=0x8000) cart.cpu_write(a,value);
}
static bool jam_opcode(uint8_t op) {
    return (op&15)==2 && op!=0xa2 && op!=0xc2 && op!=0xe2 && op!=0x82;
}
bool Machine::step() {
    if(error!=MachineError::None) return false;
    pins &= ~(M6502_NMI|M6502_IRQ|M6502_RDY);
    if(ppu.nmi()) pins|=M6502_NMI;
    if(apu.irq) pins|=M6502_IRQ;
    if(dma_active) {
        pins=m6502_tick(&cpu,pins|M6502_RDY);
        ++dma_cycles;
        if(dma_align) { dma_align=false; read(M6502_GET_ADDR(pins)); }
        else if(!dma_put) {
            const uint16_t a=uint16_t((dma_page<<8)|dma_index);
            dma_data=read(a); dma_put=true;
            if(trace) trace(trace_context,{cycles,a,dma_data,false,false,true});
        } else {
            ppu.oam[ppu.oam_addr++]=dma_data;
            if(trace) trace(trace_context,{cycles,0x2004,dma_data,true,false,true});
            dma_put=false;
            if(++dma_index==0) dma_active=false;
        }
    } else {
        pins=m6502_tick(&cpu,pins);
        const uint16_t a=M6502_GET_ADDR(pins);
        const bool is_read=pins&M6502_RW;
        uint8_t data=M6502_GET_DATA(pins);
        if(is_read) { data=read(a); M6502_SET_DATA(pins,data); }
        else write(a,data);
        if(pins&M6502_SYNC) {
            ++instructions;
            if(jam_opcode(data)) error=MachineError::CpuJammed;
        }
        if(trace) trace(trace_context,{cycles,a,data,!is_read,bool(pins&M6502_SYNC),false});
        if(dma_pending && is_read) {
            dma_pending=false; dma_active=true; dma_put=false; dma_index=0;
            dma_align=((cycles+1)&1)!=0;
            ++dma_cycles; ++dma_transfers;
        }
    }
    apu.tick();
    for(uint8_t i=0;i<3;++i) ppu.tick(cart,raster);
    ++cycles;
    return error==MachineError::None;
}
uint64_t Machine::run_cycles(uint64_t count) {
    const uint64_t begin=cycles;
    while(cycles-begin<count && step()) {}
    return cycles-begin;
}
const char* describe(MachineError e) {
    switch(e) {
    case MachineError::None:return "running";
    case MachineError::InvalidCartridge:return "invalid/unsupported cartridge";
    case MachineError::CpuJammed:return "CPU JAM instruction reached";
    case MachineError::DmcNotImplemented:return "DMC enabled: R1 stops rather than fake DMA/audio";
    }
    return "unknown machine error";
}
}
