#ifndef MHS_NES_VIDEO_H
#define MHS_NES_VIDEO_H
#include <cstdint>

#ifndef NES_CODE
#define NES_CODE
#endif
namespace nes {
struct Rgb { uint8_t r,g,b; };
// Deterministic diagnostic colors, not measured NES composite/SID-era CRT color.
NES_CODE Rgb diagnostic_nes_rgb(uint8_t index);
NES_CODE Rgb c64_rgb(uint8_t index);
struct VicFrame {
    uint8_t cells[1000][10]{}; // 8 bitmap bytes, screen byte, color byte
    uint8_t background=0;
    bool hires=true;
};
// Host reference converter. Full source framebuffer is not a firmware allocation.
// Sharp defaults to 320x200 hires, following DOSVM's two-color cell reduction.
// Color mode is 160x200 with fixed black global background and three local
// histogram representatives. Neither mode crops; neither uses temporal dither.
NES_CODE void convert_frame(const uint8_t source[256*240],VicFrame& destination,bool sharp=true);
// Target-oriented sink: just an eight-row reduced stripe, never a NES frame.
// Attach put()/finish() to the PPU RasterSink. A finished image must be consumed
// or copied before the next image overwrites it; transport ownership is separate.
struct SquishRenderer {
    VicFrame frame{};
    uint8_t stripe[8*320]{}, lut[64]{};
    uint16_t output_x=0,output_y=0;
    uint64_t frames=0;
    bool requested_sharp=true;
    explicit SquishRenderer(bool sharp=true) NES_CODE;
    void set_sharp(bool sharp) { requested_sharp=sharp; } // next complete image
    NES_CODE void pixel(uint16_t x,uint16_t y,uint8_t index);
    NES_CODE static void put(void* ctx,uint16_t x,uint16_t y,uint8_t index);
    NES_CODE static void finish(void* ctx,uint64_t frame_number);
};
NES_CODE uint8_t vic_pixel(const VicFrame& frame,uint16_t x,uint16_t y);
}
#endif
