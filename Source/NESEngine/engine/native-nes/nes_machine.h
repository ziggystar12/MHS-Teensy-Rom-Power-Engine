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
    uint8_t* prg_ram=nullptr;
    RomInfo info{};
    uint8_t bank=0;
    uint32_t bank_writes=0, bus_conflicts=0;
    uint8_t mmc1_shift=0x10,mmc1_control=0x0c,mmc1_chr0=0,mmc1_chr1=0,mmc1_prg=0;
    uint64_t mmc1_last_write=uint64_t(-1);
    uint8_t mmc3_select=0,mmc3_regs[8]{0,2,4,5,6,7,0,1};
    uint8_t mmc3_mirror=0,mmc3_ram_control=0x80,mmc3_irq_latch=0,mmc3_irq_counter=0;
    uint8_t mmc3_sprite_a12=0;
    bool mmc3_irq_reload=false,mmc3_irq_enabled=false,mmc3_irq_pending=false,mmc3_a12_high=false;
    uint64_t mmc3_low_since=0;
    uint32_t mmc3_irq_clocks=0;
    uint32_t prg_ram_writes=0;
    bool prg_ram_dirty=false;
    NES_CODE void reset_mapper();
    NES_CODE uint32_t prg_offset(uint16_t address) const;
    NES_CODE uint32_t chr_offset(uint16_t address) const;
    NES_CODE uint16_t nametable_index(uint16_t address) const;
    bool prg_ram_enabled() const { return prg_ram && ((info.mapper==1 && !(mmc1_prg&0x10)) || (info.mapper==4 && (mmc3_ram_control&0x80))); }
    bool prg_ram_writable() const {return prg_ram_enabled() && !(info.mapper==4 && (mmc3_ram_control&0x40));}
    NES_CODE void observe_ppu_address(uint16_t address,uint64_t ppu_cycle);
    // Shared modeled fetch bus for the scanline core/reference sprite pipeline.
    // Real CPU $2006/$2007 address changes also feed observe_ppu_address.
    NES_CODE void ppu_render_tick(uint16_t line,uint16_t dot,uint8_t ctrl,uint8_t mask,const uint8_t* oam,uint64_t ppu_cycle);
    NES_CODE uint8_t cpu_read(uint16_t address) const;
    // The default is for untimed inspection/tests; real CPU cores supply cycles.
    NES_CODE void cpu_write(uint16_t address,uint8_t value,uint64_t cycle=uint64_t(-1));
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
    NES_CODE uint8_t cpu_read(uint8_t reg,Cartridge& c);
    NES_CODE void cpu_write(uint8_t reg,uint8_t value,Cartridge& c);
    bool nmi() const { return (ctrl&0x80) && (status&0x80); }
    NES_CODE void tick(Cartridge& c,const RasterSink& sink);
    NES_CODE void increment_x();
    NES_CODE void increment_y();
    NES_CODE void reload_shifters();
    NES_CODE void select_sprites(uint16_t target,const Cartridge& c);
};

// Register/frame-counter state for the SID adapter, including pulse sweeps
// and pulse/noise envelopes. DMC reader/output state is emulated, but its DAC
// is not mixed into the register-driven SID adapter. Triangle linear counter
// and sampled NES audio mixing remain separate from this SID synthesis.
struct Apu {
    uint8_t regs[24]{},length[4]{},enabled=0;
    uint32_t phase=0,writes=0;
    uint32_t triggers[4]{};
    uint8_t envelope_level[4]{},envelope_divider[4]{},sweep_divider[2]{};
    bool envelope_start[4]{},sweep_reload[2]{};
    bool five_step=false,inhibit=false,irq=false;
    uint16_t dmc_address=0xc000,dmc_remaining=0,dmc_timer=427;
    uint8_t dmc_dac=0,dmc_shift=0,dmc_buffer=0,dmc_bits=8;
    bool dmc_irq=false,dmc_empty=true,dmc_silence=true;
    uint32_t dmc_fetches=0;
    uint8_t reset_delay=0;
    NES_CODE void write(uint16_t address,uint8_t value,uint64_t cpu_cycle);
    NES_CODE uint8_t status();
    NES_CODE void tick();
    NES_CODE void half_frame();
    NES_CODE void quarter_frame();
    NES_CODE uint16_t sweep_target(uint8_t channel) const;
    NES_CODE void dmc_restart();
    NES_CODE void dmc_output_tick();
    NES_CODE void dmc_accept(uint8_t value);
    bool dmc_needs_byte() const {return dmc_empty && dmc_remaining;}
    bool interrupt() const {return irq || dmc_irq;}
    uint8_t volume(uint8_t channel) const { return (regs[channel*4]&16)?regs[channel*4]&15:envelope_level[channel]; }
};
enum class MachineError : uint8_t { None, InvalidCartridge, CpuJammed };
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
    uint64_t pins=0,cycles=0,instructions=0,dma_cycles=0,dmc_dma_cycles=0;
    uint32_t dma_transfers=0,controller_reads=0,controller2_reads=0;
    uint8_t open_bus=0,dma_page=0,dma_data=0,dma_index=0,dmc_stall=0;
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
