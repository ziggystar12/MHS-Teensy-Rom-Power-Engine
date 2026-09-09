#include "nes_rom.h"
#include <cstring>

namespace nes {
static uint32_t ram_bytes(uint8_t shift) { return shift ? (64u << shift) : 0; }
RomError inspect(const uint8_t* h, size_t count, uint64_t file_bytes, RomInfo& o) {
    o = {};
    if (!h || count < 16 || file_bytes < 16) return RomError::ShortHeader;
    const uint8_t magic[]={ 'N','E','S',0x1a };
    if (std::memcmp(h,magic,4)) return RomError::BadMagic;
    o.nes2 = (h[7]&0x0c)==0x08;
    o.mapper = uint16_t((h[6]>>4) | (h[7]&0xf0));
    o.vertical=h[6]&1; o.battery=h[6]&2; o.trainer=h[6]&4; o.four_screen=h[6]&8;
    o.console=h[7]&3;
    if (o.nes2) {
        o.mapper |= uint16_t(h[8]&15)<<8;
        o.submapper=h[8]>>4;
        o.region=h[12]&3; o.expansion=h[15]&0x3f; o.misc_roms=h[14]&3;
        if ((h[9]&15)==15 || (h[9]>>4)==15) return RomError::UnsupportedSizeEncoding;
        o.prg_bytes=uint32_t(h[4] | ((h[9]&15)<<8))*16384u;
        o.chr_bytes=uint32_t(h[5] | ((h[9]>>4)<<8))*8192u;
        o.prg_ram=ram_bytes(h[10]&15); o.prg_nvram=ram_bytes(h[10]>>4);
        o.chr_ram=ram_bytes(h[11]&15); o.chr_nvram=ram_bytes(h[11]>>4);
    } else {
        // The known NI2.1 writer signature occupies reserved bytes only.
        // Accept that exact legacy signature without changing the ROM, mapper,
        // payload offsets, or any other header fields. Unknown junk stays invalid.
        const bool ni21=!std::memcmp(h+11,"NI2.1",5);
        if ((h[7]&0x0c)!=0 || (!ni21&&(h[12] || h[13] || h[14] || h[15]))) return RomError::ArchaicHeader;
        o.region=h[9]&1;
        // Legacy byte 10 timing flags: 0 NTSC, 2 PAL, 1/3 dual region.
        if (h[10]&3) o.region=((h[10]&3)==2)?1:2;
        o.prg_bytes=uint32_t(h[4])*16384u; o.chr_bytes=uint32_t(h[5])*8192u;
        o.chr_ram=o.chr_bytes?0:8192;
        // NROM's zero/one legacy PRG-RAM unit is ambiguous, not evidence of RAM.
        // A nonzero explicit declaration is retained for the support check.
        o.prg_ram=uint32_t(h[8])*8192u;
        // Legacy MMC1/MMC3 headers use zero for the usual one 8 KiB RAM bank.
        if((o.mapper==1 || o.mapper==4)&&!o.prg_ram)o.prg_ram=8192;
    }
    o.prg_offset=16+(o.trainer?512:0);
    o.chr_offset=o.prg_offset+o.prg_bytes;
    o.expected_bytes=uint64_t(o.chr_offset)+o.chr_bytes;
    if (file_bytes<o.expected_bytes) return RomError::Truncated;
    if (file_bytes>o.expected_bytes) return RomError::TrailingData;
    return RomError::None;
}
RomError supported(const RomInfo& o) {
    if (o.console) return RomError::UnsupportedConsole;
    if (o.region) return RomError::UnsupportedRegion;
    if (o.misc_roms || o.expansion>1) return RomError::UnsupportedExpansion;
    if (o.trainer) return RomError::Trainer;
    if (o.four_screen) return RomError::FourScreen;
    if (o.mapper!=0 && o.mapper!=1 && o.mapper!=2 && o.mapper!=3 && o.mapper!=4 && o.mapper!=7 && o.mapper!=11) return RomError::Mapper;
    const bool discrete=o.mapper==2 || o.mapper==3 || o.mapper==7;
    if (o.submapper && !(discrete && o.submapper<=2)) return RomError::Submapper;
    if (o.mapper==0) {
        if (o.prg_bytes!=16384 && o.prg_bytes!=32768) return RomError::PrgSize;
        if (o.chr_bytes!=8192 && !(o.chr_bytes==0 && o.chr_ram==8192)) return RomError::ChrSize;
    } else if(o.mapper==1 || o.mapper==4) {
        // Conventional MMC1/MMC3 boards; MMC6, mixed TQROM CHR, four-screen
        // boards and larger SUROM/SXROM wiring remain separate profiles.
        if(o.prg_bytes<(o.mapper==4?32768u:16384u) || o.prg_bytes>262144 || (o.prg_bytes&(o.prg_bytes-1)))return RomError::PrgSize;
        if(o.chr_bytes) {
            if(o.chr_bytes<8192 || o.chr_bytes>131072 || (o.chr_bytes&(o.chr_bytes-1)))return RomError::ChrSize;
            if(o.chr_ram||o.chr_nvram)return RomError::RamSize;
        } else if(o.chr_ram!=8192||o.chr_nvram)return RomError::ChrSize;
        if(o.prg_ram>8192 || o.prg_nvram>8192 || o.prg_ram+o.prg_nvram>8192)return RomError::RamSize;
        if(o.prg_ram+o.prg_nvram && o.prg_ram+o.prg_nvram!=8192)return RomError::RamSize;
        return RomError::None;
    } else if(o.mapper==2 || o.mapper==7) {
        if(o.prg_bytes<32768 || o.prg_bytes>262144 || (o.prg_bytes&(o.prg_bytes-1)))return RomError::PrgSize;
        if(o.chr_bytes || o.chr_ram!=8192 || o.chr_nvram)return RomError::ChrSize;
    } else if(o.mapper==3) {
        if(o.prg_bytes!=16384 && o.prg_bytes!=32768)return RomError::PrgSize;
        if(o.chr_bytes<8192 || o.chr_bytes>32768 || (o.chr_bytes&(o.chr_bytes-1)))return RomError::ChrSize;
    } else {
        if (o.prg_bytes!=32768 && o.prg_bytes!=65536 && o.prg_bytes!=131072) return RomError::PrgSize;
        if (o.chr_bytes<8192 || o.chr_bytes>131072 || (o.chr_bytes&(o.chr_bytes-1))) return RomError::ChrSize;
    }
    if (o.battery || o.prg_nvram || o.chr_nvram) return RomError::Battery;
    if (o.prg_ram || (o.chr_bytes && o.chr_ram)) return RomError::RamSize;
    return RomError::None;
}
const char* describe(RomError e) {
    switch(e) {
    case RomError::None:return "supported mapper profile (host prototype; not hardware-qualified)";
    case RomError::ShortHeader:return "file/header is shorter than 16 bytes";
    case RomError::BadMagic:return "missing iNES signature";
    case RomError::ArchaicHeader:return "archaic/polluted iNES header; no automatic repair";
    case RomError::UnsupportedSizeEncoding:return "NES 2.0 exponent size encoding not implemented";
    case RomError::Truncated:return "file shorter than declared ROM sections";
    case RomError::TrailingData:return "extra bytes after declared sections; original file left unchanged";
    case RomError::UnsupportedConsole:return "only standard NES console supported";
    case RomError::UnsupportedRegion:return "only explicitly NTSC timing supported";
    case RomError::UnsupportedExpansion:return "miscellaneous ROMs/expansion input unsupported";
    case RomError::Trainer:return "512-byte trainers unsupported";
    case RomError::FourScreen:return "four-screen nametables unsupported";
    case RomError::Mapper:return "mapper not implemented; supports 0, 1, 2, 3, 4, 7 and 11";
    case RomError::Submapper:return "submapper not implemented";
    case RomError::PrgSize:return "PRG size outside implemented board profile";
    case RomError::ChrSize:return "CHR size outside implemented board profile";
    case RomError::RamSize:return "this PRG/CHR RAM combination is not implemented";
    case RomError::Battery:return "battery/NVRAM outside implemented board profile";
    }
    return "unknown ROM error";
}
}
