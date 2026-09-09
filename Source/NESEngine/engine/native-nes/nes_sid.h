#ifndef MHS_NES_SID_H
#define MHS_NES_SID_H
#include "nes_machine.h"

namespace nes {
// NES-SID-V1 reuses the established MPE 26-byte body:
// byte 0 is a three-voice gate-retrigger mask and bytes 1..25 are $D400-$D418.
struct SidPacket { uint8_t bytes[26]{}; };

struct SidAdapter {
    static constexpr uint32_t nes_cpu_hz=1789773;
    static constexpr uint32_t sid_clock_hz=1022727; // NTSC C64 Tier 1
    uint32_t observed_triggers[4]{};
    uint8_t previous_registers[25]{};
    uint8_t previous_controls[3]{};
    uint8_t previous_voice3_owner=0;
    uint32_t packets=0,retriggers=0,noise_steals=0;
    NES_CODE bool render(const Apu& apu,SidPacket& packet);
    NES_CODE void silence(SidPacket& packet);
};
}
#endif
