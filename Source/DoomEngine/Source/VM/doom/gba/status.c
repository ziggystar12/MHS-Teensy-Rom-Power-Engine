// SPDX-License-Identifier: GPL-2.0-or-later
// Classic layout with readable text panels and a cached, mode-aware portrait.
// Raw face patches remain in the bounded render cache.
#include "doomdef.h"
#include "global_data.h"
#include "d_items.h"
#include "st_stuff.h"
#include "v_video.h"
#include "m_random.h"
#include "core_api.h"
#include "w_wad.h"
#include "r_main.h"
#include "status_face.inc"

static const byte glyphs[][5]={
 {62,81,73,69,62},{0,66,127,64,0},{98,81,73,73,70},{34,65,73,73,54},{24,20,18,127,16},
 {39,69,69,69,57},{60,74,73,73,48},{1,113,9,5,3},{54,73,73,73,54},{6,73,73,41,30},
 {126,17,17,17,126},{127,73,73,73,54},{62,65,65,65,34},{127,65,65,34,28},{127,73,73,73,65},
 {127,9,9,9,1},{62,65,73,73,122},{127,8,8,8,127},{0,65,127,65,0},{32,64,65,63,1},
 {127,8,20,34,65},{127,64,64,64,64},{127,2,12,2,127},{127,4,8,16,127},{62,65,65,65,62},
 {127,9,9,9,6},{62,65,81,33,94},{127,9,25,41,70},{38,73,73,73,50},{1,1,127,1,1},
 {63,64,64,64,63},{31,32,64,32,31},{63,64,56,64,63},{99,20,8,20,99},{3,4,120,4,3},{97,81,73,69,67},
 {8,8,8,8,8},{99,19,8,100,99}
};
enum { BAR_BYTES=320*32, FACE_WIDTH=35, FACE_BYTES=FACE_WIDTH*32 };
static byte *bar,*face,*faceView;
static GbaPatchInfo faceInfo;
static unsigned faceMode,facePalette;
static boolean faceDirty;
static int faceLumps[ST_NUMFACES],keyLumps[6],cachedFace;
static unsigned faceDecodes;
static unsigned mode,oldPalette,redraws;
static int saved[16];
static boolean valid;
void GbaHudMode(unsigned value){if(mode!=value){mode=value;valid=false;}}
unsigned GbaHudRedraws(void){return redraws;}
unsigned GbaHudFaceDecodes(void){return faceDecodes;}
static byte nearest(unsigned r,unsigned g,unsigned b){
    const byte *palette=GbaPaletteRgb();unsigned best=~0u,index=0;
    for(unsigned i=0;i<256;i++){
        int dr=(int)r-palette[i*3],dg=(int)g-palette[i*3+1],db=(int)b-palette[i*3+2];
        unsigned error=dr*dr+dg*dg+db*db;if(error<best){best=error;index=i;}
    }
    return index;
}
static void letter(int x,int y,char ch,int sx,int sy,byte color){
    unsigned n=ch>='0'&&ch<='9'?ch-'0':ch>='A'&&ch<='Z'?ch-'A'+10:ch=='-'?36:37;
    if(ch==' ')return;
    for(int col=0;col<5;col++)for(int row=0;row<7;row++)if(glyphs[n][col]&(1u<<row))
        for(int dy=0;dy<sy;dy++)for(int dx=0;dx<sx;dx++){
            int px=x+col*sx+dx,py=y+row*sy+dy;
            if(px>=0&&px<320&&py>=0&&py<32)bar[py*320+px]=color;
        }
}
static void number(int x,int y,int value,int sx,int sy,byte color){
    char text[3];if(value<0){memcpy(text,"---",3);}else{
        if(value>999)value=999;
        text[0]=value>=100?'0'+value/100:' ';
        text[1]=value>=10?'0'+value/10%10:' ';text[2]='0'+value%10;
    }
    for(unsigned i=0;i<3;i++)letter(x+i*6*sx,y,text[i],sx,sy,color);
}
// Three-column glyphs have six physical pixels in F1. Eight-line rows and
// flat two-color panels preserve every stroke through the C64 converter.
static const uint16_t compactGlyphs[]={0x7b6f,0x2c97,0x73e7,0x73cf,0x5bc9,0x79cf,0x79ef,0x7292,0x7bef,0x7bcf,0x2bed,0x6bae,0x3923,0x6b6e,0x79a7,0x79a4,0x396b,0x5bed,0x7497,0x126a,0x5bad,0x4927,0x5fed,0x5ffd,0x2b6a,0x6ba4,0x2b7b,0x6bad,0x388e,0x7492,0x5b6f,0x5b6a,0x5bfd,0x5aad,0x5a92,0x72a7};
static void compactLetter(int x,int y,char ch,int sy,byte color){
    if(mode!=0){letter(x,y,ch,1,1,color);return;}
    if(ch==' ')return;
    unsigned n=ch>='0'&&ch<='9'?ch-'0':ch-'A'+10,bits=compactGlyphs[n];
    for(int row=0;row<5;row++)for(int col=0;col<3;col++)if(bits&(1u<<(14-row*3-col)))
        for(int dy=0;dy<sy;dy++)for(int dx=0;dx<2;dx++)bar[(y+row*sy+dy)*320+x+col*2+dx]=color;
}
static void compactText(int x,int y,const char *text,byte color){
    for(;*text;text++,x+=8)compactLetter(x,y,*text,1,color);
}
static void compactNumber(int x,int y,int value,byte color){
    if(value<0)value=0;if(value>999)value=999;
    for(int col=2;col>=0;col--){compactLetter(x+col*8,y,'0'+value%10,1,color);value/=10;if(!value)break;}
}
static void panel(int left,int width,byte color){for(int y=0;y<32;y++)memset(bar+y*320+left,color,width);}
// Borrowed patches are consumed before fetching another resource. Validate
// post bounds as well as clipping the destination (including signed offsets).
static void patch(byte *dest,int width,int x,int y,int lump){
    const unsigned bytes=W_LumpLength(lump);
    const patch_t *p=GbaFrameLump(lump);
    if(bytes<8||p->width<0||p->width>320||8u+4u*p->width>bytes)GbaFatal("Invalid HUD patch");
    x-=p->leftoffset;y-=p->topoffset;
    for(int col=0;col<p->width;col++){
        unsigned off=p->columnofs[col];const int dx=x+col;
        for(;;){
            if(off>=bytes)GbaFatal("Invalid HUD column");
            const byte *post=(const byte *)p+off;if(post[0]==255)break;
            if(bytes-off<4||post[1]>bytes-off-4)GbaFatal("Invalid HUD post");
            if(dx>=0&&dx<width)for(unsigned i=0;i<post[1];i++){
                int dy=y+post[0]+i;if(dy>=0&&dy<32)dest[dy*width+dx]=post[3+i];
            }
            off+=post[1]+4;
        }
    }
}
static void cacheFace(void){
    int index=_g->st_faceindex;if(index<0||index>=ST_NUMFACES)index=0;
    if(index==cachedFace)return;
    memset(face,0,FACE_BYTES);GbaPatchHeader(faceLumps[index],&faceInfo);
    patch(face,FACE_WIDTH,0,0,faceLumps[index]);cachedFace=index;faceDecodes++;faceDirty=true;
}
// Crop the transparent margins, enlarge the actual portrait to 32x32, and
// simplify tones before the generic converter can discard a dark eye/mouth.
// The processed portrait is cached separately from the original patch pixels.
static void drawFace(byte black){
    const unsigned revision=GbaPaletteRevision();
    if(faceDirty||faceMode!=mode||facePalette!=revision){
        byte light[40*32]={0};const byte *pal=_g->pallete_lump;
        for(int y=0;y<32;y++)for(int x=0;x<32;x++){
            int sx=x*faceInfo.width/32-faceInfo.leftoffset,sy=y*faceInfo.height/32-faceInfo.topoffset;
            const unsigned index=face[sy*FACE_WIDTH+sx];
            light[y*40+x+4]=(77u*pal[index*3]+150u*pal[index*3+1]+29u*pal[index*3+2])>>8;
        }
        if(mode==0){
            const byte tones[]={black,nearest(139,84,41),nearest(184,105,98),nearest(255,255,255)};
            for(int y=0;y<32;y++)for(int x=0;x<40;x+=2){
                unsigned a=light[y*40+x],b=light[y*40+x+1],v=(a+b)/2;
                if((a<b?a:b)<55)v=a<b?a:b;
                const byte c=tones[v<60?0:v<110?1:v<175?2:3];
                faceView[y*40+x]=faceView[y*40+x+1]=c;
            }
        }else{
            // Two gray tones per physical 8x8 cell give Sharp/Auto/F5 a
            // deliberate portrait bitmap instead of frequency-selected skin colors.
            const byte tones[]={black,nearest(80,80,80),nearest(159,159,159),nearest(255,255,255)};
            for(int by=0;by<32;by+=8)for(int bx=0;bx<40;bx+=8){
                unsigned lo=255,hi=0;
                for(int y=0;y<8;y++)for(int x=0;x<8;x++){unsigned v=light[(by+y)*40+bx+x];if(v<lo)lo=v;if(v>hi)hi=v;}
                const unsigned threshold=(lo+hi)/2;
                byte dark=tones[lo<80?0:1],bright=tones[hi<100?1:hi<170?2:3];
                for(int y=0;y<8;y++)for(int x=0;x<8;x++)faceView[(by+y)*40+bx+x]=light[(by+y)*40+bx+x]>threshold?bright:dark;
            }
        }
        faceMode=mode;facePalette=revision;faceDirty=false;
    }
    for(int y=0;y<32;y++)memcpy(bar+y*320+136,faceView+y*40,40);
}
static void tint(void){
    int cnt=_g->player.damagecount,palette=0;
    if(_g->player.powers[pw_strength]){int berserk=12-(_g->player.powers[pw_strength]>>6);if(berserk>cnt)cnt=berserk;}
    if(cnt){palette=(cnt+7)>>3;if(palette>=NUMREDPALS)palette=NUMREDPALS-1;if(_g->menuactive)palette>>=1;palette+=STARTREDPALS;}
    else if(_g->player.bonuscount){palette=(_g->player.bonuscount+7)>>3;if(palette>=NUMBONUSPALS)palette=NUMBONUSPALS-1;palette+=STARTBONUSPALS;}
    else if(_g->player.powers[pw_ironfeet]>4*32||(_g->player.powers[pw_ironfeet]&8))palette=RADIATIONPAL;
    if(palette!=_g->st_palette)V_SetPalette(_g->st_palette=palette);
}
boolean ST_Responder(const event_t *event){(void)event;return false;}
void ST_Ticker(void){
    _g->st_randomnumber=M_Random();ST_updateFaceWidget();_g->st_oldhealth=_g->player.health;
}
void ST_Init(void){
    bar=Z_Malloc(BAR_BYTES+FACE_BYTES+40*32,PU_STATIC,NULL);face=bar+BAR_BYTES;faceView=face+FACE_BYTES;
    // I_FinishUpdate normally loads this after the first HUD draw. The portrait
    // needs the untinted base colors now; it reuses that same persistent lump.
    if(!_g->pallete_lump)_g->pallete_lump=W_CacheLumpName("PLAYPAL");
    unsigned index=0;
    for(unsigned pain=0;pain<ST_NUMPAINFACES;pain++){
        char name[9]="STFST00";name[5]+=(char)pain;
        for(unsigned turn=0;turn<3;turn++){name[6]='0'+turn;faceLumps[index++]=W_GetNumForName(name);}
        const char *patterns[]={"STFTR00","STFTL00","STFOUCH0","STFEVL0","STFKILL0"};
        for(unsigned i=0;i<5;i++){strcpy(name,patterns[i]);name[i<2?5:i==3?6:7]='0'+pain;faceLumps[index++]=W_GetNumForName(name);}
    }
    faceLumps[index++]=W_GetNumForName("STFGOD0");faceLumps[index]=W_GetNumForName("STFDEAD0");
    for(unsigned i=0;i<6;i++){char name[9]="STKEYS0";name[6]+=(char)i;keyLumps[i]=W_GetNumForName(name);}
    mode=redraws=faceDecodes=0;cachedFace=-1;valid=false;faceDirty=true;
}
void ST_Start(void){
    _g->st_palette=-1;_g->st_oldhealth=-1;_g->st_faceindex=_g->st_facecount=0;
    memcpy(_g->oldweaponsowned,_g->player.weaponowned,sizeof _g->oldweaponsowned);
    facePriority=0;faceAttackDelay=-1;valid=false;
}
void ST_Drawer(boolean enabled,boolean refresh){
    tint();if(!enabled)return;
    const player_t *p=&_g->player;unsigned ammo=weaponinfo[p->readyweapon].ammo;
    int state[16]={ammo<NUMAMMO?p->ammo[ammo]:-1,p->health>0?p->health:0,p->armorpoints,0,0,_g->st_faceindex,0,0};
    for(unsigned i=0;i<6;i++)if(p->cards[i])state[3]|=1<<i;
    for(unsigned i=0;i<NUMWEAPONS;i++)if(p->weaponowned[i])state[4]|=1<<i;
    for(unsigned i=0;i<NUMAMMO;i++){state[8+i]=p->ammo[i];state[12+i]=p->maxammo[i];}
    const unsigned revision=GbaPaletteRevision();
    if(!valid||refresh||revision!=oldPalette||memcmp(saved,state,sizeof saved)){
        const byte black=nearest(0,0,0),white=nearest(255,255,255),gray=nearest(159,159,159);
        const byte health=p->health<=25?nearest(255,80,80):nearest(148,224,137);
        const byte armor=nearest(103,182,189),gold=nearest(191,206,114);
        cacheFace();
        // Cell boundaries keep label/number colors out of neighboring fields.
        panel(0,48,black);panel(48,56,black);panel(104,32,black);panel(176,40,black);panel(216,8,black);panel(224,96,black);
        drawFace(black);
        number(8,4,state[0],2,2,gold);number(52,4,state[1],2,2,health);number(178,4,state[2],2,2,armor);
        letter(88,4,'%',2,2,health);
        const int labelY=mode==0?26:24;
        compactText(8,labelY,"AMMO",white);compactText(54,labelY,"HEALTH",white);compactText(176,labelY,"ARMOR",white);compactText(104,labelY,"ARMS",white);
        for(unsigned k=0;k<3;k++){
            int key=(state[3]&(1u<<(k+3)))?k+3:(state[3]&(1u<<k))?k:-1;
            if(key>=0)patch(bar,320,216,1+10*k,keyLumps[key]);
        }
        for(unsigned i=0;i<6;i++){
            const int x=104+(i%3)*12,y=2+(i/3)*12;boolean owned=(state[4]&(1u<<(i+1)))!=0;
            compactLetter(x,y,'2'+i,2,owned?white:gray);
            // Bright unowned digits survive two-color conversion; underlining
            // keeps ownership visible even when their gray merges into white.
            if(owned)memset(bar+(y+(mode==0?10:8))*320+x,white,6);
        }
        static const char *labels[]={"BULL","SHEL","ROKT","CELL"};
        for(unsigned row=0;row<4;row++){
            unsigned i=row<2?row:5-row;int y=1+8*row;
            compactText(224,y,labels[row],white);compactNumber(256,y,p->ammo[i],white);compactNumber(288,y,p->maxammo[i],white);
            for(int dy=0;dy<5;dy++){bar[(y+dy)*320+284-(dy/2)*2]=white;bar[(y+dy)*320+285-(dy/2)*2]=white;}
        }
        memcpy(saved,state,sizeof saved);oldPalette=revision;valid=true;redraws++;
    }
    memcpy(_g->screens[0].data+168*320,bar,BAR_BYTES);
}
