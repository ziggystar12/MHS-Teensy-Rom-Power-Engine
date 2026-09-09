// SPDX-License-Identifier: GPL-2.0-or-later
// Native byte-addressed 320x200 UI drawing. The GBA VRAM half-word rules do
// not apply to the Teensy's ordinary RAM framebuffer.
#include "doomdef.h"
#include "global_data.h"
#include "v_video.h"
#include "i_video.h"
#include "r_data.h"
#include "w_wad.h"
#include "core_api.h"
void V_DrawBackground(const char *name){
    const byte *flat=GbaFrameLump(_g->firstflat+R_FlatNumForName(name));
    for(unsigned y=0;y<SCREENHEIGHT;y++)for(unsigned x=0;x<SCREENWIDTH;x++)
        _g->screens[0].data[y*SCREENWIDTH+x]=flat[(y&63)*64+(x&63)];
}
void V_DrawPatch(int x,int y,int screen,const patch_t *patch){
    x-=patch->leftoffset;y-=patch->topoffset;
    for(int col=0;col<patch->width;col++){
        int dx=x+col;if(dx<0||dx>=SCREENWIDTH)continue;
        const column_t *post=(const column_t *)((const byte *)patch+patch->columnofs[col]);
        while(post->topdelta!=255){
            const byte *pixels=(const byte *)post+3;
            for(int i=0;i<post->length;i++){
                int dy=y+post->topdelta+i;
                if(dy>=0&&dy<SCREENHEIGHT)_g->screens[screen].data[dy*SCREENWIDTH+dx]=pixels[i];
            }
            post=(const column_t *)((const byte *)post+post->length+4);
        }
    }
}
void V_DrawPatchNoScale(int x,int y,const patch_t *patch){V_DrawPatch(x,y,0,patch);}
void V_DrawNumPatch(int x,int y,int screen,int lump,int cm,enum patch_translation_e flags){
    (void)cm;(void)flags;V_DrawPatch(x,y,screen,GbaFrameLump(lump));
}
void V_SetPalette(int pal){I_SetPalette(pal);}
void V_SetPalLump(int index){
    if(index<0)index=0;if(index>5)index=5;
    char name[9]="PLAYPAL0";name[7]=index?'0'+index:0;
    _g->pallete_lump=W_CacheLumpName(name);
}
void V_FillRect(int x,int y,int width,int height,byte color){
    int right=x+width,bottom=y+height;if(x<0)x=0;if(y<0)y=0;
    if(right>SCREENWIDTH)right=SCREENWIDTH;if(bottom>SCREENHEIGHT)bottom=SCREENHEIGHT;
    if(right>x)for(;y<bottom;y++)memset(_g->screens[0].data+y*SCREENWIDTH+x,color,right-x);
}
void V_DrawLine(fline_t *line,int color){
    int x=line->a.x,y=line->a.y,x1=line->b.x,y1=line->b.y;
    int dx=abs(x1-x),sx=x<x1?1:-1,dy=-abs(y1-y),sy=y<y1?1:-1,error=dx+dy;
    for(;;){
        if(x>=0&&x<SCREENWIDTH&&y>=0&&y<SCREENHEIGHT)_g->screens[0].data[y*SCREENWIDTH+x]=color;
        if(x==x1&&y==y1)break;
        int next=error*2;if(next>=dy){error+=dy;x+=sx;}if(next<=dx){error+=dx;y+=sy;}
    }
}
