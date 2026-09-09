// SPDX-License-Identifier: GPL-2.0-or-later
// Host-only renderer stress path: eight views from every loaded map subsector.
// Compile as C like the engine: its boolean fields differ from C++ bool.
#include <stdint.h>
#include "doomdef.h"
#include "global_data.h"
#include "p_maputl.h"
#include "r_main.h"
#include <assert.h>
#include <math.h>
#include "tables.h"
#include "r_plane.h"
#include "core_api.h"
#include "st_stuff.h"
#include "v_video.h"
#include "i_video.h"
#include "w_wad.h"
#include "p_tick.h"
static void exhaustZone(thinker_t *unused){(void)unused;Z_Malloc(8*1024*1024,PU_LEVEL,NULL);}
void GbaTestExhaustInPlay(void){
    thinker_t *t=Z_Calloc(1,sizeof *t,PU_LEVEL,NULL);
    t->function=exhaustZone;P_AddThinker(t);
}
void GbaTestCheckHeap(void){Z_CheckHeap();}
void GbaTestCombatReady(void){
    _g->player.health=_g->player.mo->health=100;
    _g->player.powers[pw_invulnerability]=100;
    for(unsigned i=0;i<NUMAMMO;i++)_g->player.ammo[i]=_g->player.maxammo[i];
}
unsigned GbaTestGameState(void){return _g?_g->gamestate:0;}
void GbaTestInventory(int check){
    if(check){assert(_g->player.health==77&&_g->player.armorpoints==63);
        assert(_g->player.weaponowned[wp_shotgun]&&_g->player.ammo[am_shell]==29);}
    else{_g->player.health=77;_g->player.mo->health=77;_g->player.armorpoints=63;
        _g->player.weaponowned[wp_shotgun]=true;_g->player.ammo[am_shell]=29;}
}
// An independent pinhole-camera check catches the old GBA 1/60 constant:
// a 320-column view has a focal length of 160, not 60. Check the full span,
// including diagonal views and both signs, against world-space ray slopes.
unsigned GbaCheckFloorProjection(void){
    unsigned checks=0;
    for(unsigned angle=0;angle<8192;angle+=257)for(unsigned depth=32;depth<=512;depth*=2){
        const double theta=(angle+0.5)*6.283185307179586/8192.0;
        const double actualX=(double)GbaPlaneStep(depth*FRACUNIT,finesine[angle])/FRACUNIT;
        const double actualY=(double)GbaPlaneStep(depth*FRACUNIT,finecosine[angle])/FRACUNIT;
        const double expectedX=depth*sin(theta)/160.0,expectedY=depth*cos(theta)/160.0;
        // Less than 1/20 texel of slope error across the entire row.
        assert(fabs(actualX-expectedX)*320<0.05);
        assert(fabs(actualY-expectedY)*320<0.05);checks+=2;
    }
    return checks;
}
static uint32_t regionHash(unsigned x,unsigned y,unsigned width,unsigned height){
    uint32_t h=0;for(unsigned row=y;row<y+height;row++)for(unsigned col=x;col<x+width;col++)h=h*33+_g->screens[0].data[row*320+col];return h;
}
static void faceReset(void){
    _g->player.health=100;_g->player.damagecount=_g->player.bonuscount=0;
    memset(_g->player.powers,0,sizeof _g->player.powers);_g->player.cheats=0;
    _g->player.attackdown=false;_g->player.attacker=NULL;ST_Start();
}
unsigned GbaCheckHud(void){
    player_t saved=_g->player;unsigned checks=0;
    const uint32_t world=regionHash(0,0,320,168);
    faceReset();_g->player.armorpoints=50;_g->player.readyweapon=wp_pistol;
    GbaHudMode(0);ST_Ticker();ST_Drawer(true,true);
    unsigned redraw=GbaHudRedraws(),decodes=GbaHudFaceDecodes();
    const uint32_t portrait=regionHash(136,168,40,32),oldDigits=regionHash(50,170,50,18);
    // Only the large numeric insets must have F1's paired horizontal pixels.
    const unsigned left[]={4,50,176},width[]={40,50,40};
    for(unsigned k=0;k<3;k++)for(unsigned y=170;y<188;y++)for(unsigned x=left[k];x<left[k]+width[k];x+=2)
        assert(_g->screens[0].data[y*320+x]==_g->screens[0].data[y*320+x+1]);checks++;
    for(unsigned i=0;i<8;i++)ST_Drawer(true,false);
    assert(GbaHudRedraws()==redraw&&GbaHudFaceDecodes()==decodes);checks++;
    _g->player.health=9;_g->player.armorpoints=200;_g->player.cards[0]=_g->player.cards[4]=true;
    ST_Drawer(true,false);assert(GbaHudRedraws()==++redraw&&GbaHudFaceDecodes()==decodes);
    assert(regionHash(136,168,40,32)==portrait&&regionHash(50,170,50,18)!=oldDigits);checks++;
    _g->player.readyweapon=wp_fist;ST_Drawer(true,false);assert(GbaHudRedraws()==++redraw);checks++;
    GbaHudMode(3);ST_Drawer(true,false);assert(GbaHudRedraws()==++redraw&&GbaHudFaceDecodes()==decodes);checks++;
    // Every original expression must decode, stay inside its portrait panel,
    // and keep a recognizable range of distinct processed expressions.
    _g->st_faceindex=ST_DEADFACE;ST_Drawer(true,false);
    uint32_t faces[ST_NUMFACES];unsigned distinct=0;
    for(unsigned index=0;index<ST_NUMFACES;index++){
        _g->st_faceindex=index;unsigned before=GbaHudFaceDecodes();
        uint32_t left=regionHash(0,168,136,32),right=regionHash(176,168,144,32);
        ST_Drawer(true,false);assert(GbaHudFaceDecodes()==before+1);
        assert(left==regionHash(0,168,136,32)&&right==regionHash(176,168,144,32));
        uint32_t actual=regionHash(136,168,40,32);unsigned i=0;
        for(;i<distinct;i++)if(faces[i]==actual)break;if(i==distinct)faces[distinct++]=actual;
        ST_Drawer(true,false);assert(GbaHudFaceDecodes()==before+1);checks++;
    }
    assert(distinct>=24);
    faceReset();ST_Ticker();assert(_g->st_faceindex<3);unsigned looks=1u<<_g->st_faceindex;
    for(unsigned i=0;i<512;i++){ST_Ticker();assert(_g->st_faceindex<3);looks|=1u<<_g->st_faceindex;}
    assert(looks==7);checks++;
    faceReset();_g->player.health=0;ST_Ticker();assert(_g->st_faceindex==ST_DEADFACE);checks++;
    faceReset();_g->player.powers[pw_invulnerability]=10;ST_Ticker();assert(_g->st_faceindex==ST_GODFACE);checks++;
    faceReset();_g->player.health=60;_g->st_oldhealth=100;_g->player.damagecount=30;
    ST_Ticker();assert(_g->st_faceindex==8+ST_OUCHOFFSET);checks++;
    faceReset();_g->player.weaponowned[wp_shotgun]=!_g->player.weaponowned[wp_shotgun];_g->player.bonuscount=6;
    ST_Ticker();assert(_g->st_faceindex==ST_EVILGRINOFFSET);checks++;
    faceReset();_g->player.attackdown=true;
    for(unsigned i=0;i<=ST_RAMPAGEDELAY;i++)ST_Ticker();assert(_g->st_faceindex==ST_RAMPAGEOFFSET);checks++;
    mobj_t attacker=*_g->player.mo;const angle_t oldAngle=_g->player.mo->angle;_g->player.mo->angle=0;
    for(unsigned side=0;side<2;side++){
        faceReset();attacker.y=_g->player.mo->y+(side?100:-100)*FRACUNIT;
        _g->player.attacker=&attacker;_g->player.damagecount=1;ST_Ticker();
        assert(_g->st_faceindex==ST_TURNOFFSET+(side?1:0));checks++;
    }
    _g->player.mo->angle=oldAngle;
    assert(world==regionHash(0,0,320,168));checks++;
    _g->player=saved;ST_Start();return checks;
}
unsigned GbaSurveyViews(void){assert(_g->numsubsectors>0);return _g->numsubsectors*8;}
void GbaSurveyPosition(unsigned view){
    const subsector_t *sub=&_g->subsectors[view/8];int64_t x=0,y=0;
    assert(sub->numlines);
    for(unsigned i=0;i<sub->numlines;i++){const seg_t *seg=&_g->segs[sub->firstline+i];x+=seg->v1.x;y+=seg->v1.y;}
    mobj_t *mo=_g->player.mo;P_UnsetThingPosition(mo);mo->x=x/sub->numlines;mo->y=y/sub->numlines;
    mo->momx=mo->momy=mo->momz=0;mo->angle=(view%8)*ANG45;P_SetThingPosition(mo);
    mo->z=mo->floorz=mo->subsector->sector->floorheight;mo->ceilingz=mo->subsector->sector->ceilingheight;
    _g->player.viewheight=41*FRACUNIT;_g->player.deltaviewheight=0;_g->player.health=mo->health=100;
    _g->player.powers[pw_invulnerability]=100;
}

// C++ side decodes the actual C64 cells and checks that every text stroke
// survives F1/F7 conversion. Use representative three-digit ammo totals.
extern void GbaCheckHudDisplay(unsigned mode);
unsigned GbaCheckHudReadability(void){
    player_t saved=_g->player;faceReset();V_SetPalette(0);I_FinishUpdate();_g->player.armorpoints=150;_g->player.readyweapon=wp_pistol;
    const int ammo[]={123,45,234,12};for(unsigned i=0;i<4;i++)_g->player.ammo[i]=ammo[i];
    for(unsigned i=0;i<NUMWEAPONS;i++)_g->player.weaponowned[i]=(i&1)!=0;
    ST_Ticker();GbaHudMode(0);ST_Drawer(true,true);GbaCheckHudDisplay(0);
    GbaHudMode(3);ST_Drawer(true,true);GbaCheckHudDisplay(3);
    _g->player=saved;ST_Start();return 2;
}
