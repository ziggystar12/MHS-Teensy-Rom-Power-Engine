#ifndef MHS_NES_ROM_H
#define MHS_NES_ROM_H
#include <cstddef>
#include <cstdint>

#ifndef NES_CODE
#define NES_CODE
#endif

namespace nes {
enum class RomError : uint8_t {
    None, ShortHeader, BadMagic, ArchaicHeader, UnsupportedSizeEncoding,
    Truncated, TrailingData, UnsupportedConsole, UnsupportedRegion,
    UnsupportedExpansion, Trainer, FourScreen, Mapper, Submapper,
    PrgSize, ChrSize, RamSize, Battery
};
struct RomInfo {
    uint32_t prg_bytes=0, chr_bytes=0, prg_ram=0, chr_ram=0;
    uint32_t prg_nvram=0, chr_nvram=0;
    uint32_t prg_offset=16, chr_offset=0;
    uint64_t expected_bytes=0;
    uint16_t mapper=0;
    uint8_t submapper=0, region=0, console=0, expansion=0, misc_roms=0;
    bool nes2=false, vertical=false, battery=false, trainer=false, four_screen=false;
};
// Inspect only the supplied 16-byte header; never dereference payload here.
NES_CODE RomError inspect(const uint8_t* header, size_t header_bytes, uint64_t file_bytes, RomInfo& out);
// R1: NROM-128/256 or mapper 11, no battery/PRG RAM. Host fit is not firmware fit.
NES_CODE RomError supported(const RomInfo& info);
NES_CODE const char* describe(RomError error);
}
#endif
