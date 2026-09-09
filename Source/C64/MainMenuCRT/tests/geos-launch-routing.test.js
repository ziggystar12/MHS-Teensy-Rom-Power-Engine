'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {desktopMachine} = require('./desktop-machine');
const root = path.resolve(__dirname, '../../..');
const teensy = path.join(root, 'Teensy');

// Execute the production page map and PROGMEM directory branch. Actual menu
// tables supply every raw index/name; ROM payloads alone are harmless sentinels.
function backendFixture(temporary) {
    const items = fs.readFileSync(path.join(teensy, 'MainMenuItems.h'), 'utf8');
    const tables = ['dirUtilities', 'dirTeensyROMSpecific', 'TeensyROMMenu'].map(name => {
        const value = items.match(new RegExp(`StructMenuItem ${name}\\[\\] =\\s*\\{[\\s\\S]*?\\n\\};`));
        assert.ok(value, name); return value[0];
    });
    const joined = tables.join('\n');
    const identifiers = [...new Set([...joined.matchAll(/\(uint8_t\*\)(\w+)/g)].map(m => m[1]))]
        .filter(name => !['dirUtilities', 'dirTeensyROMSpecific'].includes(name));
    const handlers = [...new Set([...joined.matchAll(/\bIOH_\w+/g)].map(m => m[0]))];
    const execution = fs.readFileSync(path.join(teensy, 'DriveDirLoad.ino'), 'utf8');
    const begin = execution.indexOf('if (MenuSelCpy.ItemType == rtDirectory)', execution.indexOf('case rmtTeensy:'));
    const end = execution.indexOf('SendMsgPrintfln(MenuSelCpy.Name)', begin);
    assert.ok(begin >= 0 && end > begin);
    const include = name => JSON.stringify(path.join(teensy, name).replaceAll('\\', '/'));
    const source = `#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#define FLASHMEM
#include ${include('MinimalBoot/Common/Menu_Regs.h')}
static uint8_t registers[IO1Size], *IO1=registers;
static StructMenuItem* MenuSource;
static uint16_t SelItemFullIdx,NumItemsFull;
static char DriveDirPath[256]="/";
static const char* UpDirString="/.. <Up Dir>";
#include ${include('MinimalBoot/Common/IO_Handlers/DesktopMenuView.c')}
${handlers.map(name => `#define ${name} 0`).join('\n')}
${identifiers.map(name => `static uint8_t ${name}[1]={0};`).join('\n')}
${joined}
static void SetNumItems(uint16_t count){NumItemsFull=count;MenuViewRebuild();IO1[rwRegCursorItemOnPg]=0;MenuViewSetPage(1);}
static void MenuChange(){MenuSource=TeensyROMMenu;strcpy(DriveDirPath,"/");SetNumItems(sizeof TeensyROMMenu/sizeof *TeensyROMMenu);}
static const char* target="";
static void Start(){
 if(!MenuViewSelectionValid())return;
 StructMenuItem MenuSelCpy=MenuSource[SelItemFullIdx];
 ${execution.slice(begin,end)}
 target=MenuSelCpy.Name;IO1[rRegStrAvailable]=1;
}
int main(int argc,char**argv){
 IO1[rWRegCurrMenuWAIT]=rmtTeensy;MenuChange();
 for(int i=1;i<argc;++i){const char command=argv[i][0];const unsigned value=std::strtoul(argv[i]+1,nullptr,10);
  switch(command){
   case 'v':IO1[rwRegMenuView]=value;MenuViewApply();break;
   case 's':IO1[rWRegCurrMenuWAIT]=value;MenuChange();break;
   case 'c':IO1[rwRegCursorItemOnPg]=value;break;
   case 'i':IO1[rwRegSelItemOnPage]=value;MenuViewSelect(value);break;
   case 'p':MenuViewSetPage(value);break;
   case 'x':Start();break;
  }
 }
 IO1[rRegItemTypePlusIOH]=MenuViewSelectionValid()?MenuSource[SelItemFullIdx].ItemType:rtNone;
 std::printf("{\\"registers\\":[");for(unsigned i=0;i<IO1Size;++i)std::printf("%s%u",i?",":"",IO1[i]);
 std::printf("],\\"raw\\":%u,\\"target\\":\\"%s\\",\\"path\\":\\"%s\\"}\\n",SelItemFullIdx,target,DriveDirPath);
}
`;
    const compiler = [process.env.CXX, 'g++', 'clang++', 'C:/msys64/mingw64/bin/g++.exe'].filter(Boolean)
        .find(value => spawnSync(value, ['--version'], {encoding:'utf8'}).status === 0);
    assert.ok(compiler, 'host C++ compiler is required');
    const cpp = path.join(temporary, 'backend.cpp'), exe = path.join(temporary, 'backend.exe');
    fs.writeFileSync(cpp, source);
    const env = {...process.env, PATH:path.dirname(compiler)+path.delimiter+process.env.PATH};
    const built = spawnSync(compiler, ['-std=c++11', cpp, '-o', exe], {encoding:'utf8', env});
    assert.equal(built.status, 0, built.stdout+built.stderr);
    const cache = new Map();
    return commands => {
        const key = commands.join(',');
        if (!cache.has(key)) {
            const run = spawnSync(exe, commands, {encoding:'utf8', env});
            assert.equal(run.status, 0, run.stdout+run.stderr);
            cache.set(key, JSON.parse(run.stdout));
        }
        return cache.get(key);
    };
}

test('direct C64 launches preserve raw PROGMEM identities through real view-map changes', async t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-launch-routing-'));
    try {
        const backend = backendFixture(temporary);
        await desktopMachine(t, async ({s, fresh, stub}) => {
            for (const mode of [0,1]) for (const surface of [s.GeosSurfaceHome,s.GeosSurfaceBrowser,s.GeosSurfaceIEC]) {
                for (const route of [
                    {label:'F1 Help', key:s.ChrF1, name:'TeensyROM Help Pages'},
                    {label:'F2 BASIC', key:s.ChrF2, name:'Exit to BASIC'},
                    {label:'Settings page', direct:'TagTRSettings', name:'TeensyROM Settings Menu'},
                    {label:'PROGMEM desktop', dir:9, item:3, name:'TeensyROM Desktop Shell'},
                    ...(mode ? [{label:'Control page',direct:'GeosShellLaunchControlPage',controlSelection:2,name:'TeensyROM Settings Menu'}] :
                        [{label:'F8 Settings',key:s.ChrF8,name:'TeensyROM Settings Menu'}]),
                ]) {
                    const cpu=fresh(), commands=[`v${mode?2:0}`], waits=[];
                    let pending=[], state, transferred=false;
                    const reflect=()=>{
                        state=backend(commands);
                        for(const register of ['rwRegMenuView','rWRegCurrMenuWAIT','rwRegPageNumber','rRegNumPages',
                            'rRegNumItemsOnPage','rwRegCursorItemOnPg','rwRegSelItemOnPage','rRegItemTypePlusIOH','rRegStrAvailable'])
                            cpu.m[s.IO1Port+s[register]]=state.registers[s[register]];
                    };
                    reflect();
                    cpu.m[s.GeosViewMode]=mode;cpu.m[s.GeosSurfaceMode]=surface;
                    cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3]=0x80|(mode?0:1);
                    cpu.onWrite=(address,value)=>{
                        const register=address-s.IO1Port;
                        if(register===s.rwRegPwrUpDefaults3)assert.fail('direct launch must not persist a temporary view');
                        if(register===s.rwRegMenuView)pending.push(`v${value}`);
                        if(register===s.rWRegCurrMenuWAIT)pending.push(`s${value}`);
                        if(register===s.rwRegCursorItemOnPg){commands.push(`c${value}`);reflect();}
                        if(register===s.rwRegSelItemOnPage){commands.push(`i${value}`);reflect();}
                        if(register===s.wRegControl && value===s.rCtlStartSelItemWAIT)pending.push('x');
                    };
                    const wait=()=>{waits.push(...pending);commands.push(...pending);pending=[];reflect();};
                    for(const name of ['WaitForTRWaitMsg','WaitForTRDots'])stub(cpu,name,wait);
                    for(const name of ['Mouse1351Hide','InverseRow','IRQDisable','PrintBanner','AnyKeyErrMsgWait'])stub(cpu,name);
                    stub(cpu,'ListMenuItemsClassic',c=>{c.m[s.GeosBitmapActive]=0;});
                    stub(cpu,'GeosDrawDesktop');
                    stub(cpu,'GeosIECActivate',()=>assert.fail('a direct launch cannot activate the old IEC file'));
                    cpu.hooks.set(s.XferCopyRun,()=>{transferred=true;throw 'TRANSFER';});
                    if (route.controlSelection !== undefined) cpu.m[s.GeosControlSelection]=route.controlSelection;
                    if(route.key){cpu.a=route.key;cpu.pc=s.ReadKeyboardReady;}
                    else if(route.direct)cpu.pc=s[route.direct];
                    else{cpu.x=route.dir;cpu.a=route.item;cpu.pc=s.DirectRunFromTeensyMenu;}
                    try {
                        for(let steps=0;steps<10000&&!transferred;++steps){cpu.hooks.get(cpu.pc)?.(cpu);cpu.step();}
                    } catch(error) {if(error!=='TRANSFER')throw error;}
                    assert.ok(transferred,`${route.label}/${mode}/${surface} reaches PRG transfer`);
                    assert.equal(state.target,route.name,`${route.label}/${mode}/${surface}`);
                    assert.equal(state.raw,route.item??(route.direct||route.key===s.ChrF8?1:2));
                    assert.equal(cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3],0x80|(mode?0:1));
                    assert.ok(waits.includes('x'),'actual directory launch waits for the backend');
                    assert.equal(cpu.m[s.IO1Port+s.rwRegMenuView],0,'fixed locations use raw indices');
                }
            }
        }, {apps:false,menuDir:process.env.MPE_ROUTING_MENU_DIR});
    } finally {
        assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));
        fs.rmSync(temporary,{recursive:true,force:true});
    }
});

test('saved Text preference and both V keys preserve other flags and choose the real text renderer', async t => {
    await desktopMachine(t, async ({s,fresh,stub}) => {
        for(let flags=0;flags<256;flags++) {
            const cpu=fresh();cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3]=flags;
            cpu.call(s.GeosShellInit);
            assert.equal(cpu.m[s.GeosViewMode],1-(flags&1));
            assert.equal(cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3],flags,'startup never writes EEPROM');
        }
        for(const mode of [0,1]) for(const key of [0x56,0xd6]) for(const upper of [0,0x80,0xfe]) {
            const cpu=fresh(), flags=upper|(mode?0:1), stores=[];
            let guiDraws=0,waits=0,textDraws=0;
            cpu.m[s.GeosViewMode]=mode;
            cpu.m[s.GeosSurfaceMode]=s.GeosSurfaceIEC;
            cpu.m[s.IO1Port+s.rwRegMenuView]=mode?2:0;
            cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3]=flags;
            cpu.m[0xd011]=0x3b;
            stub(cpu,'WaitForTRWaitMsg',()=>waits++);
            stub(cpu,'GeosDrawDesktop',()=>guiDraws++);
            stub(cpu,'ListMenuItemsClassic',c=>{
                textDraws++;c.m[s.GeosBitmapLayoutPass]=0;c.pc=s.TextScreenMemColor;
            });
            stub(cpu,'GeosIECActivate',()=>assert.fail('V never activates a stale IEC selection'));
            cpu.onWrite=(address,value)=>{
                if(address===s.IO1Port+s.rwRegPwrUpDefaults3)stores.push(value);
                if(address===s.IO1Port+s.wRegSearchLetterWAIT)assert.fail('V must not become filename search');
            };
            cpu.a=key;cpu.pc=s.ReadKeyboardReady;
            for(let steps=0;cpu.pc!==s.HighlightCurrent;steps++){
                assert.ok(steps<5000);cpu.hooks.get(cpu.pc)?.(cpu);cpu.step();
            }
            assert.equal(cpu.m[s.GeosViewMode],1-mode);
            assert.equal(cpu.m[s.GeosSurfaceMode],s.GeosSurfaceBrowser);
            assert.equal(cpu.m[s.GeosOverlayMode],s.GeosOverlayNone);
            assert.deepEqual(stores,[flags^1]);
            assert.equal(waits,2,'preference write and changed viewport each finish before redraw');
            assert.equal(guiDraws,1-mode);assert.equal(textDraws,mode);
            if(mode){assert.equal(cpu.m[0xd011]&0x20,0);assert.equal(cpu.m[0xd018],0x17);assert.equal(cpu.m[s.GeosBitmapActive],0);}
        }
        for(const value of [0,1]) {
            const cpu=fresh();let writes=0,waits=0;
            cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3]=0xa0|(value?0:1);
            cpu.onWrite=address=>{if(address===s.IO1Port+s.rwRegPwrUpDefaults3)writes++;};
            stub(cpu,'WaitForTRWaitMsg',()=>waits++);stub(cpu,'GeosShellRedraw');
            cpu.a=value;cpu.call(s.GeosSetViewMode);
            assert.equal(writes,0,'selecting the already saved mode avoids EEPROM writes');assert.equal(waits,0);
        }
    },{apps:false});
});

test('compact startup remains original text when saved and V explicitly launches the expanded GUI', async t => {
    await desktopMachine(t, async ({acme,menuDir,fresh}) => {
        const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tr-compact-route-'));
        try {
            const output=path.join(temporary,'compact.bin'), symbols=path.join(temporary,'symbols');
            const built=spawnSync(acme,['--format','plain','--symbollist',symbols,'--outfile',output,'source/MainMenu.asm'],
                {cwd:menuDir,encoding:'utf8',windowsHide:true});
            assert.equal(built.status,0,built.stdout+built.stderr);
            const program=fs.readFileSync(output);
            const s=Object.fromEntries([...fs.readFileSync(symbols,'utf8').matchAll(/^\s*(\w+)\s*=\s*\$([0-9a-f]+)/gmi)]
                .map(m=>[m[1],parseInt(m[2],16)]));
            const machine=()=>{const cpu=fresh();cpu.m.fill(0);program.copy(cpu.m,s.MainCodeRAMStart);return cpu;};
            const run=(cpu,stops)=>{for(let steps=0;!stops.includes(cpu.pc);steps++){assert.ok(steps<500);cpu.hooks.get(cpu.pc)?.(cpu);cpu.step();}};
            for(let flags=0;flags<256;flags++) {
                const cpu=machine();cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3]=flags;
                cpu.pc=s.ChooseStartupMenu;run(cpu,[s.CompactTextMenuReady,s.DirectRunFromTeensyMenu]);
                assert.equal(cpu.pc,flags&1?s.CompactTextMenuReady:s.DirectRunFromTeensyMenu);
                if(flags&1)assert.equal(cpu.m[s.GeosViewMode],0);
                else{assert.equal(cpu.x,9);assert.equal(cpu.a,3);}
                assert.equal(cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3],flags);
            }
            for(const key of [0x56,0xd6])for(const flags of [1,0x81,0xff]){
                const cpu=machine();let waits=0;
                cpu.m[s.WaitForTRWaitMsg]=0x60;cpu.hooks.set(s.WaitForTRWaitMsg,()=>waits++);
                cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3]=flags;cpu.a=key;cpu.pc=s.ReadKeyboardReady;
                run(cpu,[s.DirectRunFromTeensyMenu]);
                assert.equal(cpu.x,9);assert.equal(cpu.a,3);assert.equal(waits,1);
                assert.equal(cpu.m[s.IO1Port+s.rwRegPwrUpDefaults3],flags&0xfe);
            }
            t.diagnostic(`compact MainMenu.bin ${program.length} bytes; bootstrap remains under its existing 8192-byte gate`);
        } finally{assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));fs.rmSync(temporary,{recursive:true,force:true});}
    },{apps:false});
});
