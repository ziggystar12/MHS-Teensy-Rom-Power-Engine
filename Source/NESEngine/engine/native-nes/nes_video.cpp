#include "nes_video.h"
#include <algorithm>
#include <cmath>
#include <cstring>
namespace nes {
static uint8_t component(double v) {
    if(v<0) return 0;
    if(v>1) return 255;
    return uint8_t(v*255+0.5);
}
Rgb diagnostic_nes_rgb(uint8_t index) {
    // Original flat-color model using the measured voltage facts in NESdev's
    // NTSC_video page. Decode the square wave's first harmonic, not neighboring
    // pixel artifacts. Fixed -15 degree display tint; no emphasis/CRT claim.
    static const double low[]={0.228,0.312,0.552,0.880};
    static const double high[]={0.616,0.840,1.100,1.100};
    constexpr double pi=3.14159265358979323846, range=1.100-0.312;
    index&=63;
    const uint8_t hue=index&15, level=index>>4;
    if(hue>=14) return {0,0,0};
    if(hue==0 || hue==13) {
        const uint8_t gray=component(((hue==0?high[level]:low[level])-0.312)/range);
        return {gray,gray,gray};
    }
    const double y=((high[level]+low[level])/2-0.312)/range;
    const double amplitude=(high[level]-low[level])*2/(pi*range);
    // Color 8 is the -U burst phase; six hue steps later gives +U (color 2).
    const double angle=(30.0*(int(hue)-2)-15.0)*pi/180.0;
    const double u=amplitude*std::cos(angle),v=amplitude*std::sin(angle);
    return {component(y+1.139883*v),component(y-0.394642*u-0.580622*v),component(y+2.032062*u)};
}
Rgb c64_rgb(uint8_t i) {
    // Same fixed palette as DOSVM's CgaVideo::renderSharp.
    static constexpr Rgb colors[16]={{0,0,0},{255,255,255},{136,57,50},{103,182,189},
        {139,63,150},{85,160,73},{64,49,141},{191,206,114},{139,84,41},{87,66,0},
        {184,105,98},{80,80,80},{120,120,120},{148,224,137},{120,105,196},{159,159,159}};
    return colors[i&15];
}
static uint32_t distance(Rgb a,Rgb b) {
    const int r=int(a.r)-b.r,g=int(a.g)-b.g,bl=int(a.b)-b.b;
    const int amin=std::min({a.r,a.g,a.b}),bmin=std::min({b.r,b.g,b.b});
    const int ca=int(std::max({a.r,a.g,a.b}))-amin;
    const int cb=int(std::max({b.r,b.g,b.b}))-bmin;
    // Preserve a clearly colored source instead of making a blue sky gray just
    // because the C64 palette has no equally pale blue. Deterministic, no dither.
    int hue_error=0;
    if(ca>48 && cb>=24) {
        const int nr=(int(a.r)-amin)*255/ca-(int(b.r)-bmin)*255/cb;
        const int ng=(int(a.g)-amin)*255/ca-(int(b.g)-bmin)*255/cb;
        const int nb=(int(a.b)-amin)*255/ca-(int(b.b)-bmin)*255/cb;
        hue_error=(nr*nr+ng*ng+nb*nb)/2;
    }
    return uint32_t(2*r*r+4*g*g+bl*bl+hue_error+((ca>48 && cb<24)?8*ca*ca:0));
}
static void make_lut(uint8_t lut[64]) {
#ifdef MHS_NES_FIXED_VIC_LUT
    static constexpr uint8_t fixed[64]={11,6,6,6,4,4,2,2,9,9,5,5,6,0,0,0,15,6,6,6,4,4,2,8,9,5,5,5,3,0,0,0,
        1,3,14,14,4,4,10,10,7,7,13,13,3,11,0,0,1,3,1,1,1,1,1,7,7,7,13,13,3,15,0,0};
    std::memcpy(lut,fixed,sizeof(fixed));
#else
    for(uint8_t n=0;n<64;++n) {
        uint32_t best=0xffffffffu;
        for(uint8_t c=0;c<16;++c) {
            const uint32_t d=distance(diagnostic_nes_rgb(n),c64_rgb(c));
            if(d<best) { best=d; lut[n]=c; }
        }
    }
#endif
}
NES_CODE static void encode_cell(const uint8_t pixels[32],uint8_t background,uint8_t cell[10]) {
    uint8_t hist[16]{},colors[4]={background,0,0,0};
    std::memset(cell,0,10);
    for(uint8_t i=0;i<32;++i) ++hist[pixels[i]];
    hist[background]=0;
    for(uint8_t slot=1;slot<4;++slot) {
        uint8_t best=0;
        for(uint8_t c=1;c<16;++c) if(hist[c]>hist[best]) best=c;
        colors[slot]=best; hist[best]=0;
    }
    cell[8]=uint8_t((colors[1]<<4)|colors[2]); cell[9]=colors[3];
    for(uint8_t y=0;y<8;++y) for(uint8_t x=0;x<4;++x) {
        uint8_t chosen=0; uint32_t best=0xffffffffu;
        for(uint8_t slot=0;slot<4;++slot) {
            const uint32_t d=distance(c64_rgb(pixels[y*4+x]),c64_rgb(colors[slot]));
            if(d<best) { best=d; chosen=slot; }
        }
        cell[y]|=uint8_t(chosen<<(6-x*2));
    }
}
NES_CODE static void encode_sharp(const uint8_t pixels[64],uint8_t cell[10]) {
    // Adapted from DOSVM CgaVideo::renderSharp: canonical mapped-color counts,
    // two most frequent representatives, nearest RGB for the rest, no dither.
    // NES can expose more than CGA's four source colors, so count all 16 here.
    uint8_t counts[16]{},foreground[16]{};
    for(uint8_t i=0;i<64;++i) ++counts[pixels[i]];
    uint8_t primary=0;
    for(uint8_t i=1;i<16;++i) if(counts[i]>counts[primary]) primary=i;
    uint8_t secondary=primary;
    for(uint8_t i=0;i<16;++i) if(i!=primary && counts[i] &&
        (secondary==primary || counts[i]>counts[secondary])) secondary=i;
    for(uint8_t i=0;i<16;++i) {
        if(i==primary || !counts[i]) continue;
        if(i==secondary) { foreground[i]=1; continue; }
        const Rgb a=c64_rgb(i),b=c64_rgb(primary),c=c64_rgb(secondary);
        const int br=int(a.r)-b.r,bg=int(a.g)-b.g,bb=int(a.b)-b.b;
        const int cr=int(a.r)-c.r,cg=int(a.g)-c.g,cb=int(a.b)-c.b;
        foreground[i]=(cr*cr+cg*cg+cb*cb)<(br*br+bg*bg+bb*bb);
    }
    std::memset(cell,0,10);
    for(uint8_t y=0;y<8;++y) for(uint8_t x=0;x<8;++x)
        cell[y]|=uint8_t(foreground[pixels[y*8+x]]<<(7-x));
    cell[8]=uint8_t((secondary<<4)|primary); cell[9]=secondary;
}
void convert_frame(const uint8_t* source,VicFrame& out,bool sharp) {
    out=VicFrame{};
    out.hires=sharp;
    uint8_t lut[64]; make_lut(lut);
    const uint16_t cell_width=sharp?8:4,width=cell_width*40;
    for(uint16_t cy=0;cy<25;++cy) for(uint16_t cx=0;cx<40;++cx) {
        uint8_t pixels[64];
        for(uint16_t y=0;y<8;++y) for(uint16_t x=0;x<cell_width;++x) {
            const uint16_t sx=uint16_t(((2*(cx*cell_width+x)+1)*256)/(width*2));
            const uint16_t sy=uint16_t(((2*(cy*8+y)+1)*240)/400);
            const uint8_t c=lut[source[sy*256+sx]&63];
            pixels[y*cell_width+x]=c;
        }
        if(sharp) encode_sharp(pixels,out.cells[cy*40+cx]);
        else encode_cell(pixels,out.background,out.cells[cy*40+cx]);
    }
}
SquishRenderer::SquishRenderer(bool sharp) : requested_sharp(sharp) { frame.hires=sharp; make_lut(lut); }
void SquishRenderer::pixel(uint16_t x,uint16_t y,uint8_t index) {
    if(x==0 && y==0) frame.hires=requested_sharp;
    const uint16_t cell_width=frame.hires?8:4,width=cell_width*40;
    if(output_y>=200 || y!=((2*output_y+1)*240)/400) return;
    // Enlargement can use one source pixel for two hires pixels.
    while(x==((2*output_x+1)*256)/(width*2)) {
        stripe[(output_y&7)*320+output_x]=lut[index&63];
        if(++output_x!=width) continue;
        output_x=0;
        if((output_y&7)==7) {
            for(uint16_t cx=0;cx<40;++cx) {
                uint8_t pixels[64];
                for(uint16_t row=0;row<8;++row) for(uint16_t col=0;col<cell_width;++col)
                    pixels[row*cell_width+col]=stripe[row*320+cx*cell_width+col];
                if(frame.hires) encode_sharp(pixels,frame.cells[(output_y/8)*40+cx]);
                else encode_cell(pixels,frame.background,frame.cells[(output_y/8)*40+cx]);
            }
        }
        ++output_y; return;
    }
}
void SquishRenderer::put(void* ctx,uint16_t x,uint16_t y,uint8_t index) {
    static_cast<SquishRenderer*>(ctx)->pixel(x,y,index);
}
void SquishRenderer::finish(void* ctx,uint64_t frame_number) {
    auto& renderer=*static_cast<SquishRenderer*>(ctx);
    renderer.frames=frame_number; renderer.output_x=renderer.output_y=0;
}
uint8_t vic_pixel(const VicFrame& f,uint16_t x,uint16_t y) {
    const uint16_t width=f.hires?320:160;
    if(x>=width || y>=200) return f.background;
    const uint8_t* c=f.cells[(y/8)*40+x/(f.hires?8:4)];
    if(f.hires) return (c[y%8]&(0x80>>(x%8)))?c[8]>>4:c[8]&15;
    const uint8_t code=(c[y%8]>>(6-(x%4)*2))&3;
    if(code==0) return f.background;
    if(code==1) return c[8]>>4;
    if(code==2) return c[8]&15;
    return c[9]&15;
}
}
