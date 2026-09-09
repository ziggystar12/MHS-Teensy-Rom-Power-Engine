#include "nes_sid.h"
#include <cstring>

namespace nes {
namespace {
constexpr uint16_t pulse_width[4]={0x0200,0x0400,0x0800,0x0c00};
constexpr uint16_t noise_period[16]={4,8,16,32,64,96,128,160,202,254,380,508,762,1016,2034,4068};

uint16_t sid_word(uint64_t numerator,uint64_t denominator) {
    if (!denominator) return 0;
    uint64_t value=(numerator+(denominator/2))/denominator;
    if (value>0xffff) value=0xffff;
    return uint16_t(value);
}
void frequency(uint8_t* sid,uint16_t value) { sid[0]=uint8_t(value); sid[1]=uint8_t(value>>8); }
uint8_t level(const Apu& a,uint8_t channel) {
    return a.volume(channel);
}
bool tonal_active(const Apu& a,uint8_t channel,uint16_t timer,uint8_t volume) {
    return (a.enabled&(1<<channel)) && a.length[channel] && timer>=8 && a.sweep_target(channel)<=0x7ff && volume;
}
}

bool SidAdapter::render(const Apu& a,SidPacket& packet) {
    std::memset(packet.bytes,0,sizeof(packet.bytes));
    uint8_t* sid=packet.bytes+1;
    uint8_t retrigger=0;
    for(uint8_t channel=0;channel<2;++channel) {
        const uint8_t base=channel*4,voice=channel*7;
        const uint16_t timer=uint16_t(a.regs[base+2]|((a.regs[base+3]&7)<<8));
        const uint8_t volume=level(a,channel);
        const bool active=tonal_active(a,channel,timer,volume);
        frequency(sid+voice,sid_word(uint64_t(nes_cpu_hz)<<24,uint64_t(16)*(timer+1)*sid_clock_hz));
        const uint16_t width=pulse_width[a.regs[base]>>6];
        sid[voice+2]=uint8_t(width);sid[voice+3]=uint8_t(width>>8);
        sid[voice+4]=uint8_t(0x40|(active?1:0));
        sid[voice+5]=0x00;sid[voice+6]=uint8_t(volume<<4);
        // A SID in decay/sustain cannot climb to a higher sustain level:
        // without a fresh attack it can decay all the way to zero instead.
        // Keep falling envelopes and pitch sweeps continuous; restart only
        // a new note, a previously closed gate, or a volume increase.
        if(active && (a.triggers[channel]!=observed_triggers[channel] || !(previous_controls[channel]&1) ||
            volume>(previous_registers[voice+6]>>4)))
            retrigger|=uint8_t(1<<channel);
        observed_triggers[channel]=a.triggers[channel];
    }

    const uint16_t triangle_timer=uint16_t(a.regs[10]|((a.regs[11]&7)<<8));
    const bool triangle=(a.enabled&4) && a.length[2] && triangle_timer>=2;
    const uint8_t noise_volume=level(a,3);
    const bool noise=(a.enabled&8) && a.length[3] && noise_volume;
    const uint8_t owner=noise?2:(triangle?1:0); // percussion deterministically steals voice 3
    uint8_t* voice3=sid+14;
    if(owner==2) {
        const uint16_t period=noise_period[a.regs[14]&15];
        frequency(voice3,sid_word(uint64_t(nes_cpu_hz)<<24,uint64_t(2)*period*sid_clock_hz));
        voice3[4]=0x81;voice3[5]=0;voice3[6]=uint8_t(noise_volume<<4);
        if(previous_voice3_owner && previous_voice3_owner!=2) ++noise_steals;
        if(a.triggers[3]!=observed_triggers[3] || previous_voice3_owner!=2 || !(previous_controls[2]&1) ||
            noise_volume>(previous_registers[20]>>4)) retrigger|=4;
    } else if(owner==1) {
        frequency(voice3,sid_word(uint64_t(nes_cpu_hz)<<24,uint64_t(32)*(triangle_timer+1)*sid_clock_hz));
        voice3[4]=0x11;voice3[5]=0;voice3[6]=0xf0;
        if(a.triggers[2]!=observed_triggers[2] || previous_voice3_owner!=1 || !(previous_controls[2]&1)) retrigger|=4;
    } else voice3[4]=0x10;
    observed_triggers[2]=a.triggers[2];observed_triggers[3]=a.triggers[3];
    sid[24]=0x0f;
    packet.bytes[0]=retrigger;
    const bool changed=retrigger || std::memcmp(previous_registers,sid,sizeof(previous_registers));
    std::memcpy(previous_registers,sid,sizeof(previous_registers));
    previous_controls[0]=sid[4];previous_controls[1]=sid[11];previous_controls[2]=sid[18];
    previous_voice3_owner=owner;
    if(changed) ++packets;
    if(retrigger) ++retriggers;
    return changed;
}
void SidAdapter::silence(SidPacket& packet) {
    std::memset(packet.bytes,0,sizeof(packet.bytes));
    std::memset(previous_registers,0,sizeof(previous_registers));
    std::memset(previous_controls,0,sizeof(previous_controls));
    previous_voice3_owner=0;
}
}
