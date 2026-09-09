// SPDX-License-Identifier: GPL-2.0-or-later
// Reject a doubled low-resolution source, exercise every converter mode and
// optionally capture the actual source and converted output for inspection.
#pragma once
#include "../video/mpe_video_live.cpp"
static unsigned nativeDetailedFrames;
static void verifyDoomVideo(const VmIndexedFrame &f,bool stable){
    static mpe_video::LiveConverter converter;
    static mpe_video::LiveFrame actual[4]{};
    unsigned different=0;
    for(unsigned y=0;y<168;y++)for(unsigned x=0;x<320;x+=2)
        different+=f.pixels[y*f.stride+x]!=f.pixels[y*f.stride+x+1];
    if(different>400)nativeDetailedFrames++;
    const mpe_video::IndexedSource source{f.pixels,f.palette,f.width,f.height,f.stride,f.colors,
        uint16_t(gbadoomvm::VideoGeometry|(stable?VM_INDEXED_STABLE_RASTER:0))};
    for(unsigned mode=0;mode<4;mode++){
        assert(converter.render(source,mode,actual[mode],&actual[mode]));
    }
    if(const char *stream=getenv("GBADOOM_VIDEO_STREAM")){
        FILE *file=fopen(stream,f.generation==1?"wb":"ab");assert(file);
        assert(fwrite(actual,1,sizeof actual,file)==sizeof actual);fclose(file);
    }
    if(const char *prefix=getenv("GBADOOM_CAPTURE"))if(f.generation==1||f.generation==70){
        char name[512];snprintf(name,sizeof name,"%s-%u.bin",prefix,f.generation);
        FILE *file=fopen(name,"wb");assert(file);
        assert(fwrite(f.pixels,1,f.pixel_bytes,file)==f.pixel_bytes);
        assert(fwrite(f.palette,1,768,file)==768);
        for(const auto &frame:actual){assert(fwrite(frame.cells,1,10000,file)==10000);}
        for(const auto &frame:actual){
            uint8_t metadata[32]{};memcpy(metadata,frame.split,25);memcpy(metadata+25,&frame.mask,4);
            metadata[29]=frame.mode;metadata[30]=frame.background;assert(fwrite(metadata,1,32,file)==32);
        }
        fclose(file);
    }
}
