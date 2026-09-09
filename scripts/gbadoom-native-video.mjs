// SPDX-License-Identifier: GPL-2.0-or-later
// Adapt the pinned GBA renderer to one byte per native 320x200 pixel.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export function adaptNativeVideo({out,change,edit}){
    const hot='source/r_hotpath.iwram.c';
    for(const [name,value] of [['MAX_SCREENWIDTH',320],['SCREENWIDTH',320],['MAX_SCREENHEIGHT',200],['SCREENHEIGHT',200]])
        edit('include/doomdef.h',s=>s.replace(new RegExp('(#define '+name+' +)\\d+'),`$1${value}`));
    change('include/doomdef.h','//In shorts.','//In bytes.');
    change('include/gba_functions.h','#define ScreenYToOffset(x) ((x << 7) - (x << 3))','#define ScreenYToOffset(x) ((x) * SCREENPITCH)');
    change('include/v_video.h','unsigned short *data;','byte *data;');
    change('include/r_draw.h','unsigned short *byte_topleft;','byte *byte_topleft;');
    change('include/r_main.h','extern short *floorclip, *ceilingclip;','extern short floorclip[],ceilingclip[];');
    edit('include/i_system_e32.h',s=>s.replaceAll('unsigned short* I_Get','unsigned char* I_Get').replace('const unsigned short* srcBuffer','const unsigned char* srcBuffer'));
    change('source/i_video.c','unsigned short* backbuffer','unsigned char* backbuffer');
    change('include/st_stuff.h','(160 - ST_HEIGHT)','(SCREENHEIGHT - ST_HEIGHT)');
    change('source/am_map.c','(SCREENWIDTH*2)','SCREENWIDTH');
    edit('source/hu_lib.c',s=>s.replaceAll('> 240','> SCREENWIDTH').replaceAll('>= 240','>= SCREENWIDTH'));
    // These GBA spare-VRAM overlays have fixed 120-column offsets. Replace
    // them with sized arrays; immutable lookup tables can be read in place.
    edit(hot,s=>{
        const begin=s.indexOf('#ifndef GBA\nstatic byte vram1_spare'),end=s.indexOf('//*****************************************\n//Globals.',begin);
        assert.ok(begin>0&&end>begin);
        return s.slice(0,begin)+`static unsigned int columnCacheEntries[128];
short floorclip[SCREENWIDTH],ceilingclip[SCREENWIDTH];
short screenheightarray[SCREENWIDTH],negonearray[SCREENWIDTH];
static vissprite_t *spritePointers[MAXVISSPRITES];
vissprite_t **vissprite_ptrs=spritePointers;
byte *columnCache; // Allocated once in the bounded guest zone.

`+s.slice(end);
    });
    change('include/tables.h','extern short* screenheightarray;','extern short screenheightarray[];');
    change('include/tables.h','extern short* negonearray;','extern short negonearray[];');
    edit(hot,s=>s.replaceAll('unsigned short* dest','byte* dest').replaceAll('typedef unsigned short pixel;','typedef byte pixel;').replaceAll('*d = (color | (color << 8));','*d = color;'));
    // Every sprite column now corresponds to one pixel; the GBA half-word
    // update routine and its alternating high/low byte pass no longer apply.
    edit(hot,s=>{
        const begin=s.indexOf('static void R_DrawColumnHiRes('),end=s.indexOf('#define FUZZOFF',begin);
        assert.ok(begin>0&&end>begin);return s.slice(0,begin)+s.slice(end);
    });
    change(hot,`        hires = highDetail;

        if(hires)
            colfunc = R_DrawColumnHiRes;`,'        hires = false;');
    change(hot,'vis->iscale = tz >> 7;','vis->iscale = FixedDiv(tz, projectiony);');
    // The upstream literal is 1/60 for a 120-column viewport. Keeping it at
    // 320 columns makes floor spans advance 2.67x too far across each row.
    change('source/r_plane.c','const fixed_t iprojection = 1092;',
        'const fixed_t iprojection = FRACUNIT / (SCREENWIDTH / 2);');
    change(hot,'    dsvars->step = ((FixedMul(distance,basexscale) << 10) & 0xffff0000) | ((FixedMul(distance,baseyscale) >> 6) & 0x0000ffff);',
        `    const fixed_t xstep=GbaPlaneStep(distance,viewsin),ystep=GbaPlaneStep(distance,viewcos);
    dsvars->step = (((unsigned)xstep << 10) & 0xffff0000) | (((unsigned)ystep >> 6) & 0x0000ffff);`);
    change(hot,'static byte spanstart[MAX_SCREENHEIGHT];','static unsigned short spanstart[MAX_SCREENHEIGHT];');
    // Font rendering shares the clipped native patch routine.
    edit(hot,s=>{
        const begin=s.indexOf('void V_DrawPatchNoScale('),end=s.indexOf('//\n// P_DivlineSide',begin);
        assert.ok(begin>0&&end>begin);return s.slice(0,begin)+s.slice(end);
    });
    // status.c replaces the GBA HUD and its permanently pinned graphics.
    edit('source/r_draw.c',s=>{
        const begin=s.indexOf('    //Copy lookup tables'),end=s.indexOf('\n}',begin);
        assert.ok(begin>0&&end>begin);
        return s.slice(0,begin)+`    extern byte *columnCache;
    if(!columnCache)columnCache=Z_Calloc(1,128*128,PU_STATIC,NULL);
    for(int i=0;i<SCREENWIDTH;i++){negonearray[i]=-1;screenheightarray[i]=SCREENHEIGHT-ST_HEIGHT;}
`+s.slice(end);
    });
    // Rebuild projection tables with Doom's fixed-point mapping algorithm.
    // These are build-time calculations, with no floating-point runtime cost.
    const tablesFile=path.join(out,'source/tables.c');let tables=fs.readFileSync(tablesFile,'utf8');
    const numbers=name=>{const m=tables.match(new RegExp('const \\w+ '+name+'\\[\\d+\\]\\s*=\\s*\\{([^}]+)\\}'));assert.ok(m,name);return m[1].match(/-?\d+/g).map(Number);};
    const tangent=numbers('finetangent'),sine=numbers('finesine');
    const w=320,h=200,viewHeight=h-32,F=65536;
    const focal=Math.trunc((w/2*F)*F/tangent[3072]);
    const angleX=tangent.map(t=>t>2*F?-1:t< -2*F?w+1:Math.max(-1,Math.min(w+1,Math.floor((w/2*F-Math.floor(t*focal/F)+F-1)/F))));
    const xAngle=Array.from({length:w+1},(_,x)=>{let i=0;while(angleX[i]>x)i++;assert.ok(i<4096);return ((i*524288)-1073741824)>>>0;});
    const yslope=Array.from({length:h},(_,y)=>y<viewHeight?Math.trunc((h*4/5)*F*F/Math.abs((y-viewHeight/2)*F+F/2)):0);
    const distance=xAngle.slice(0,w).map(a=>Math.trunc(F*F/Math.abs(sine[((a>>>19)+2048)%8192])));
    for(const [name,type,values] of [['viewangletox','int',angleX.map(x=>Math.max(0,Math.min(w,x)))],['xtoviewangle','angle_t',xAngle],['yslope','fixed_t',yslope],['distscale','fixed_t',distance]]){
        const pattern=new RegExp('const '+type+' '+name+'\\[\\d+\\]\\s*=\\s*\\{[^}]+\\};');assert.ok(pattern.test(tables),name);
        const rows=[];for(let i=0;i<values.length;i+=12)rows.push('    '+values.slice(i,i+12).join(','));
        tables=tables.replace(pattern,`const ${type} ${name}[${values.length}] = {\n${rows.join(',\n')}\n};`);
        edit('include/tables.h',s=>s.replace(new RegExp('('+name+')\\[\\d+\\]'),`$1[${values.length}]`));
    }
    fs.writeFileSync(tablesFile,tables);
    change(hot,'static const angle_t clipangle = 537395200;',`static const angle_t clipangle = ${xAngle[0]};`);
}
