#ifndef MHS_NES_MACHINE_H
#define MHS_NES_MACHINE_H
#include "nes_rom.h"
#include "nes_input.h"
#include "vendor/chips/m6502.h"

namespace nes {
// Borrowed, preloaded storage. No allocation or filesystem inside the machine.
struct Cartridge {
    const uint8_t* prg=nullptr;
    const uint8_t* chr=nullptr;
    uint8_t* chr_ram=nullptr;
    RomInfo info{};
    uint8_t bank=0;
    uint32_t bank_writes=0, bus_conflicts=0;
    NES_CODE uint8_t cpu_read(uint16_t address) const;
    NES_CODE void cpu_write(uint16_t address,uint8_t value);
    NES_CODE uint8_t ppu_read(uint16_t address) const;
    NES_CODE void ppu_write(uint16_t address,uint8_t value);
};
struct RasterSink {
    void* context=nullptr;
    void (*pixel)(void*,uint16_t,uint16_t,uint8_t)=nullptr;
    void (*frame)(void*,uint64_t)=nullptr;
};
struct Ppu {
#ifdef MHS_NES_EXTERNAL_RAM
    uint8_t *nametable=nullptr,*palette=nullptr,*oam=nullptr;
#else
    uint8_t nametable[2048]{}, palette[32]{}, oam[256]{};
#endif
    uint8_t ctrl=0,mask=0,status=0,oam_addr=0,open_bus=0,read_buffer=0,fine_x=0;
    uint16_t v=0,t=0;
    bool write_second=false,odd=false;
    uint16_t line=261,dot=0;
    uint64_t ticks=0,frames=0;
    uint32_t startup_dots=29658u*3u, sprite0_hits=0,nmi_edges=0;
    uint16_t pattern_lo=0,pattern_hi=0,attribute_lo=0,attribute_hi=0;
    uint8_t next_tile=0,next_attr=0,next_lo=0,next_hi=0;
    struct Sprite { uint8_t x=0,attr=0,lo=0,hi=0,index=0; } sprites[8];
    uint8_t sprite_count=0;
    bool previous_nmi=false;
    NES_CODE uint16_t nt_index(uint16_t address,bool vertical) const;
    NES_CODE uint8_t read(uint16_t address,const Cartridge& c) const;
    NES_CODE void write(uint16_t address,uint8_t value,Cartridge& c);
    NES_CODE uint8_t cpu_read(uint8_t reg,const Cartridge& c);
    NES_CODE void cpu_write(uint8_t reg,uint8_t value,Cartridge& c);
    bool nmi() const { return (ctrl&0x80) && (status&0x80); }
    NES_CODE void tick(Cartridge& c,const RasterSink& sink);
    NES_CODE void increment_x();
    NES_CODE void increment_y();
    NES_CODE void reload_shifters();
    NES_CODE void select_sprites(uint16_t target,const Cartridge& c);
};

// Register/frame-counter state for the SID adapter, including pulse sweeps
// and pulse/noise envelopes. Triangle linear counter and DMC remain deferred;
// this is register-driven SID synthesis, not a sampled NES mixer.
struct Apu {
    uint8_t regs[24]{},length[4]{},enabled=0;
    uint32_t phase=0,writes=0;
    uint32_t triggers[4]{};
    uint8_t envelope_level[4]{},envelope_divider[4]{},sweep_divider[2]{};
    bool envelope_start[4]{},sweep_reload[2]{};
    bool five_step=false,inhibit=false,irq=false,dmc_requested=false;
    uint8_t reset_delay=0;
    NES_CODE void write(uint16_t address,uint8_t value,uint64_t cpu_cycle);
    NES_CODE uint8_t status();
    NES_CODE void tick();
    NES_CODE void half_frame();
    NES_CODE void quarter_frame();
    NES_CODE uint16_t sweep_target(uint8_t channel) const;
    uint8_t volume(uint8_t channel) const { return (regs[channel*4]&16)?regs[channel*4]&15:envelope_level[channel]; }
};
enum class MachineError : uint8_t { None, InvalidCartridge, CpuJammed, DmcNotImplemented };
struct BusEvent { uint64_t cycle; uint16_t address; uint8_t data; bool write,sync,dma; };
struct Machine {
    Cartridge cart{};
    Ppu ppu{};
    Apu apu{};
    Controller controller{};
    m6502_t cpu{};
#ifdef MHS_NES_EXTERNAL_RAM
    uint8_t *ram=nullptr;
#else
    uint8_t ram[2048]{};
#endif
    uint64_t pins=0,cycles=0,instructions=0,dma_cycles=0;
    uint32_t dma_transfers=0,controller_reads=0,controller2_reads=0;
    uint8_t open_bus=0,dma_page=0,dma_data=0,dma_index=0;
    bool dma_pending=false,dma_active=false,dma_put=false,dma_align=false;
    MachineError error=MachineError::None;
    RasterSink raster{};
    void* trace_context=nullptr;
    void (*trace)(void*,const BusEvent&)=nullptr;
    NES_CODE bool init(const Cartridge& cartridge,const RasterSink& sink={});
    NES_CODE uint8_t read(uint16_t address);
    NES_CODE void write(uint16_t address,uint8_t value);
    NES_CODE bool step();
    NES_CODE uint64_t run_cycles(uint64_t count);
};
NES_CODE const char* describe(MachineError error);
}
#endif
