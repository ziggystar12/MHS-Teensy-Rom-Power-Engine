#ifndef MHS_NES_INPUT_H
#define MHS_NES_INPUT_H
#include <cstdint>
namespace nes {
enum Button : uint8_t { A=1, B=2, Select=4, Start=8, Up=16, Down=32, Left=64, Right=128 };

// rows[r] is active-low CIA column input while matrix row r is selected.
// The physical scanner must isolate joystick lines before collecting the rows.
// That electrical scanner is NOT provided by this portable decoder.
inline uint8_t c64_buttons(uint8_t port2, const uint8_t rows[8]) {
    uint8_t b=0;
    if (!(port2&1)) b|=Up;
    if (!(port2&2)) b|=Down;
    if (!(port2&4)) b|=Left;
    if (!(port2&8)) b|=Right;
    if (!(port2&16)) b|=A;
    if (!(rows[7]&16)) b|=B;             // Space
    if (!(rows[0]&2)) b|=Start;          // Return/Enter
    if (!(rows[1]&128) || !(rows[6]&16)) b|=Select; // Either Shift
    if ((b&(Up|Down))==(Up|Down)) b &= uint8_t(~(Up|Down));
    if ((b&(Left|Right))==(Left|Right)) b &= uint8_t(~(Left|Right));
    return b;
}
struct Controller {
    uint8_t live=0, latched=0, position=0;
    bool strobe=false;
    void set(uint8_t value) { live=value; }
    void write(uint8_t value) {
        const bool next=value&1;
        if (next || strobe) { latched=live; position=0; }
        strobe=next;
    }
    uint8_t read() {
        if (strobe) return live&1;
        if (position>=8) return 1;
        return (latched>>position++)&1;
    }
};
// DOSVM Ctrl+Commodore+F7 display shortcut, adapted to NES held-matrix input.
// Call only for accepted snapshots. Releasing modifiers first cannot re-toggle;
// F7 itself must be released. Shift means F8, so does not activate this chord.
struct SharpControl {
    bool enabled=true,held=false;
    bool update(const uint8_t rows[8]) {
        const bool f7=!(rows[0]&8);
        const bool shift=!(rows[1]&128) || !(rows[6]&16);
        const bool chord=f7 && !(rows[7]&4) && !(rows[7]&32) && !shift;
        if(!f7) held=false;
        if(chord && !held) { enabled=!enabled; held=true; return true; }
        return false;
    }
};
}
#endif
