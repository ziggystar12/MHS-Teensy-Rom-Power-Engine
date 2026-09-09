// Build the GUI and generic VM host. Does not flash hardware.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertGuiFirmwareVersion} from './firmware-version.mjs';
const version=assertGuiFirmwareVersion();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,process.env.MPE_FIRMWARE_OUT??'build/fw');
const tool=path.resolve(process.env.MPE_TOOLCHAIN_ROOT??path.join(root,'build/toolchain'));
const read=p=>fs.readFileSync(p);
const write=(p,b)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const generatedNames=['TeensyROMC64.h','DesktopShell.prg.h','DesktopClock.prg.h','DesktopSnake.prg.h','DesktopCalculator.prg.h','DesktopTextViewer.prg.h','TRHelpScreens.prg.h','SettingsMenu.prg.h'];
function inputs(){
  const rows=[];
  const walk=dir=>{for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
    if(e.name==='build'||e.name==='__pycache__')continue;const p=path.join(dir,e.name);
    if(e.isDirectory())walk(p);else if(!generatedNames.includes(e.name))rows.push({path:p.replaceAll('\\','/'),sha256:hash(read(path.join(root,p)))});
  }};
  walk('Source');
  const files=['firmware-version.json','scripts/build-gui-firmware.mjs','scripts/firmware-version.mjs'];
  for(const p of files)rows.push({path:p,sha256:hash(read(path.join(root,p)))});
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
function run(exe,args,cwd=root,env={}){
  const r=spawnSync(exe,args,{cwd,env:{...process.env,...env},encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if(r.error||r.status)throw Error(`${path.basename(exe)} failed\n${r.error??''}\n${(r.stdout+r.stderr).slice(-14000)}`);
  return r.stdout+r.stderr;
}
fs.mkdirSync(out,{recursive:true});
const inputSnapshot=inputs();
{
  console.log('Preparing isolated toolchain and canonical GUI source');
  const dataRoot=path.join(out,'toolchain/Arduino15');
  const packages=path.join(dataRoot,'packages/teensy');fs.mkdirSync(packages,{recursive:true});
  const hardware=path.join(packages,'hardware/avr/1.61.0');
  if(!fs.existsSync(hardware))fs.cpSync(path.join(tool,'Arduino15/packages/teensy/hardware/avr/1.61.0'),hardware,{recursive:true});
  if(!fs.existsSync(path.join(packages,'tools')))fs.symlinkSync(path.join(tool,'Arduino15/packages/teensy/tools'),path.join(packages,'tools'),'junction');
  for(const name of fs.readdirSync(path.join(tool,'Arduino15')))if(fs.statSync(path.join(tool,'Arduino15',name)).isFile())fs.copyFileSync(path.join(tool,'Arduino15',name),path.join(dataRoot,name));
  const stage=path.join(out,'source');fs.cpSync(path.join(root,'Source'),path.join(stage,'Source'),{recursive:true,filter:p=>!path.relative(path.join(root,'Source'),p).split(path.sep).includes('build')});
  // Assemble current GUI inputs directly; there are no selected-* snapshots.
  const acme=path.join(tool,'acme-0.97-r20/acme0.97win/acme/acme.exe');
  const guiDir=path.join(stage,'Source/C64/MainMenuCRT');fs.mkdirSync(path.join(guiDir,'build'),{recursive:true});
  for(const [name,format] of [['MainMenu','plain'],['DesktopShellCode','plain'],['GeosApps','plain'],['GeosSettings','plain'],['DesktopSnake','cbm'],['DesktopCalculator','cbm'],['DesktopTextViewer','cbm'],['DesktopClock','cbm'],['DesktopShell','cbm'],['TeensyROMC64','plain']]){
    const args=['--format',format];if(name==='DesktopShellCode')args.push('--symbollist','build/DesktopSymbols');
    args.push('--outfile',`build/${name}.${format==='plain'?'bin':'prg'}`,`source/${name}.asm`);run(acme,args,guiDir);
  }
  const generated=[['TeensyROMC64.h',path.join(guiDir,'build/TeensyROMC64.bin')],...['DesktopShell','DesktopClock','DesktopSnake','DesktopCalculator','DesktopTextViewer'].map(n=>[n+'.prg.h',path.join(guiDir,'build',n+'.prg')])];
  for(const name of ['TRHelpScreens','SettingsMenu']){const dir=path.join(stage,'Source/C64',name);fs.mkdirSync(path.join(dir,'build'),{recursive:true});run(acme,['--format','cbm','--outfile',`build/${name}.prg`,`source/${name}.asm`],dir);generated.push([name+'.prg.h',path.join(dir,'build',name+'.prg')]);}
  for(const [name,file] of generated){const dest=path.join(stage,'Source/Teensy/TRMenuFiles/ROMs',name);const original=read(dest).toString();const bytes=read(file);let rows=[];for(let i=0;i<bytes.length;i+=12)rows.push('\t'+[...bytes.subarray(i,i+12)].map(b=>'0x'+b.toString(16).padStart(2,'0')).join(', ')+',');
    const header=original.replace(/(unsigned char\s+\w+\[\]\s*=\s*\{)[\s\S]*?(\};)/,'$1\n'+rows.join('\n')+'\n$2');
    write(dest,header);write(path.join(root,'Source/Teensy/TRMenuFiles/ROMs',name),header);
  }
  write(path.join(out,'gui-assets.json'),JSON.stringify(generated.map(([name,file])=>({name,bytes:read(file).length,sha256:hash(read(file))})),null,2));
  const env={ARDUINO_DIRECTORIES_DATA:dataRoot,ARDUINO_DIRECTORIES_USER:path.join(tool,'Arduino'),ARDUINO_DIRECTORIES_DOWNLOADS:path.join(tool,'staging'),SOURCE_DATE_EPOCH:'1788480000'};
  const core=path.join(hardware,'cores/teensy4'),linkers=path.join(root,'Source/Teensy/tools/BootLinkerFiles');
  // Teensy 1.61 hides its USB_DISABLED menu and leaves one yield reference
  // unguarded. Patch only this isolated core copy, in both build profiles.
  const yieldSource=read(path.join(tool,'Arduino15/packages/teensy/hardware/avr/1.61.0/cores/teensy4/yield.cpp')).toString();
  write(path.join(core,'yield.cpp'),yieldSource.replace('if (Serial.available()) serialEvent();','#ifndef USB_DISABLED\n\t\tif (Serial.available()) serialEvent();\n#endif'));
  const cli=path.join(tool,'arduino-cli.exe');
  const build=(min)=>{
    const suffix=min?'orig':'upper';
    fs.copyFileSync(path.join(linkers,'bootdata.c.'+suffix),path.join(core,'bootdata.c'));
    let ld=read(path.join(linkers,'imxrt1062_t41.ld.'+suffix)).toString();
    if(min){
      ld=ld.replace('LENGTH = 7936K','LENGTH = 384K');
      ld=ld.replace('_itcm_block_count = (SIZEOF(.text.itcm) + SIZEOF(.ARM.exidx) + 0x7FFF) >> 15;','_itcm_block_count = 6;');
      ld=ld.replace('_heap_start = ADDR(.bss.dma) + SIZEOF(.bss.dma);','_heap_start = ALIGN(_ebss, 32) + 32;');
      ld=ld.replace('_heap_end = ORIGIN(RAM) + LENGTH(RAM);','_heap_end = _heap_start + 16384;');
      ld=ld.replace('_teensy_model_identifier = 0x25;',`_teensy_model_identifier = 0x25;\n _vm_data_start = 0x20014000;\n _vm_data_end = 0x20044000;\n ASSERT(_etext <= 0x18000, "Host overlaps module ITCM")\n ASSERT(_heap_end <= _vm_data_start, "Host heap overlaps module RAM1")\n ASSERT(_estack - _vm_data_end >= 49152, "Host stack below 48 KiB")\n ASSERT(SIZEOF(.bss.dma) == 0, "Host DMA globals overlap VM RAM2")\n ASSERT(SIZEOF(.bss.extram) == 0, "Host unexpectedly requires PSRAM")`);
    }
    write(path.join(core,'imxrt1062_t41.ld'),ld);
    const sketch=path.join(stage,'Source/Teensy',min?'MinimalBoot':'');
    const buildDir=path.join(out,min?'minimal':'gui');fs.mkdirSync(buildDir,{recursive:true});
    const fqbn='teensy:avr:teensy41:usb=serialmidiaudio,speed=600,opt=o2std,keys=en-us';
    // Query resolved core defaults; inject the TR+ board feature without losing core definitions.
    const props=run(cli,['compile','--fqbn',fqbn,'--show-properties',sketch],root,env);
    const defs=props.match(/^build.flags.defs=(.*)$/m)?.[1].trim();if(!defs)throw Error('Missing board flags');
    const args=['compile','--fqbn',fqbn,'--build-path',buildDir,'--build-property','build.flags.defs='+defs+' -DFab04_Features'+(min?' -DMHS_VM_PROFILE_192_320 -DMPE_DOS_NUFLIX -DMPE_DOS_NUFLIX_DOUBLE -I'+stage.replaceAll('\\','/') :''), '--build-property','build.usbtype='+(min?'USB_DISABLED':'USB_MIDI_SERIAL'),sketch];
    console.log(min?'Building generic VM host':'Building GUI (no embedded engines)');
    const log=run(cli,args,root,env);write(path.join(out,min?'minimal-build.log':'gui-build.log'),log);console.log(log.split(/\r?\n/).filter(l=>/Memory Usage|RAM1:|RAM2:|FLASH:/.test(l)).join('\n'));
  };
  build(true);build(false);
  // Merge address-aware Intel HEX; reject overlap and preserve the Teensy loader reserve.
  const merged=new Map();
  for(const [dir,name,lo,hi] of [['minimal','MinimalBoot',0x60000000,0x60060000],['gui','Teensy',0x60060000,0x607c0000]]){
    let base=0,eof=false;
    for(const line of read(path.join(out,dir,name+'.ino.hex')).toString().trim().split(/\r?\n/)){
      if(eof||!/^:[0-9A-F]+$/i.test(line))throw Error('Invalid HEX');const b=Buffer.from(line.slice(1),'hex');if(b.length!==b[0]+5||(b.reduce((a,v)=>a+v,0)&255))throw Error('HEX checksum');
      if(b[3]===4)base=b.readUInt16BE(4)*65536;
      else if(b[3]===0){for(let i=0;i<b[0];i++){let a=base+b.readUInt16BE(1)+i;if(a<lo||a>=hi||merged.has(a))throw Error('HEX partition overlap/bounds');merged.set(a,b[i+4]);}}
      else if(b[3]===1)eof=true;else if(![3,5].includes(b[3]))throw Error('Unsupported HEX record');
    }if(!eof)throw Error('Missing HEX EOF');
  }
  const record=(addr,type,data)=>{const b=Buffer.alloc(data.length+5);b[0]=data.length;b.writeUInt16BE(addr,1);b[3]=type;data.copy(b,4);b[b.length-1]=(-b.reduce((a,v)=>a+v,0))&255;return ':'+b.toString('hex').toUpperCase();};
  const addresses=[...merged.keys()].sort((a,b)=>a-b);let high=-1,lines=[];
  for(let i=0;i<addresses.length;){const start=addresses[i];if(Math.floor(start/65536)!==high){high=Math.floor(start/65536);const h=Buffer.alloc(2);h.writeUInt16BE(high);lines.push(record(0,4,h));}let data=[];while(i<addresses.length&&addresses[i]===start+data.length&&Math.floor(addresses[i]/65536)===high&&data.length<16)data.push(merged.get(addresses[i++]));lines.push(record(start&65535,0,Buffer.from(data)));}
  lines.push(':00000001FF');write(path.join(out,'SD',version.filename),lines.join('\n')+'\n');
  for(const name of fs.readdirSync(path.join(out,'SD')))if(/^MPE_Firmware-V\d+\.\d+\.\d+\.hex$/.test(name)&&name!==version.filename)fs.unlinkSync(path.join(out,'SD',name));
  console.log('Firmware written to '+path.join(out,'SD'));
}
if(JSON.stringify(inputs())!==JSON.stringify(inputSnapshot))throw Error('Source changed during build; rebuild before using artifacts');
write(path.join(out,'build-inputs.json'),JSON.stringify({mode:'firmware',version:version.version,files:inputSnapshot},null,2));
