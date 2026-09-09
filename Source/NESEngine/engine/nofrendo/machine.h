// MPE Nofrendo adapter. One active core per independent VM module.
#pragma once
#include "../native-nes/nes_machine.h"

namespace nes {
struct NofrendoMachine {
    Cartridge cart{};
    Apu apu{};
    Controller controller{};
    RasterSink raster{};
    bool spriteTags=false; // Opt-in bit 6 metadata; ordinary sinks stay 0..63.
    struct { uint64_t frames=0; } ppu;
#ifdef MHS_NES_EXTERNAL_RAM
    uint8_t *ram=nullptr;
#else
    uint8_t ram[2048]{};
#endif
    uint64_t cycles=0, dma_cycles=0;
    uint32_t dma_transfers=0, controller_reads=0, controller2_reads=0;
    uint32_t apu_cycles=0;
    uint16_t scanline=261, line_cycles=0, line_elapsed=0;
    uint8_t dot_remainder=0, credit=0, open_bus=0, palette_ram[32]{};
    bool pending_nmi=false, vblank_nmi_delivered=false;
    MachineError error=MachineError::None;
    bool init(const Cartridge& cartridge,const RasterSink& sink={});
    uint64_t run_cycles(uint64_t count);
    uint8_t read(uint16_t address);
    void write(uint16_t address,uint8_t value);
    void map_cartridge();
    void sync_apu();
};
}
