// SPDX-License-Identifier: MIT
// NES-only receiver: existing indexed F1/F3/F7 and the shared MHS Prism F5 service.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {emitDoubleVideo} from '../client/nuflix/double-video.mjs';
import {Emitter} from '../client/nuflix/emitter.mjs';
import {loadNesTerminal} from './nes_terminal.mjs';

export const nesNuflixState=a=>typeof a==='number'&&a>=0x02a0&&a<0x0340?a+0x0360:a;
export const nesNuflixHoles=[[0x0800,0x0f00],[0x8400,0x87f8],[0x8800,0x9000],[0xfa00,0xfff8],[0x06b0,0x07f8],[0x0f20,0x1000]];
const root=path.resolve(import.meta.dirname,'../..');
const scatterFile=path.join(root,'nes/client/nuflix/scatter-receiver.mjs');
let scatterSource=fs.readFileSync(scatterFile,'utf8');
assert.equal(scatterSource.split('export const scatterHoles=').length,2);
scatterSource=scatterSource.replace(/export const scatterHoles=\[\[.*?\]\];/,`export const scatterHoles=${JSON.stringify(nesNuflixHoles)};`);
export const {scatterReceiver:scatterNesReceiver}=await import('data:text/javascript;base64,'+Buffer.from(scatterSource).toString('base64'));

export function emitNesNuflixVideo(e,state,stage,template) {
  const get=a=>e.abs(0xad,a,'read'),put=a=>e.abs(0x8d,a,'write');
  const set=(a,v)=>{e.emit(0xa9,v);put(a);};
  const vector=label=>{e.immediateAddress(0xa9,label,0);put(0xfffe);e.immediateAddress(0xa9,label,8);put(0xffff);};
  const enabled=0x02e3;
  e.label('mpe_video_packet');get(stage+10);e.emit(0xc9,16);e.branch(0xd0,'nes_plain_packet');
  set('nes_crop_active',0);e.abs(0x4c,'nes_nuflix_packet');
  e.label('nes_plain_packet');get(stage+6);e.emit(0xc9,4);e.branch(0xf0,'nes_plain_length_ok');e.emit(0xc9,3);e.jumpUnless(0xf0,'error_type');
  e.label('nes_plain_length_ok');get(stage+9);e.emit(0xc9,4);e.jumpUnless(0x90,'error_type');e.emit(0xc9,2);e.jumpUnless(0xd0,'error_type');
  get(stage+10);e.branch(0xf0,'nes_plain_flags_ok');e.emit(0xc9,8);e.jumpUnless(0xf0,'error_type');get(stage+9);e.emit(0xc9,1);e.jumpUnless(0xf0,'error_type');
  e.label('nes_plain_flags_ok');get(stage+8);e.emit(0xc9,1);e.branch(0xd0,'mpe_video_resume');
  e.abs(0x20,'mpe_video_disable');get(state.baseReady);e.branch(0xf0,'nes_plain_pause');e.abs(0x20,'wait_fresh_border');
  e.label('nes_plain_pause');e.emit(0x78);set(0xd01a,0);set(0xd015,0);set(0xd011,0x2b);set('nes_crop_active',0);e.abs(0x4c,'ack_packet');
  e.label('mpe_video_resume');e.emit(0xc9,2);e.jumpUnless(0xf0,'error_type');e.emit(0x78);
  set(enabled,0);set(0x02e4,0);set(0x06a3,255);set(0xd015,0);set(0xd017,0);set(0xd01b,0);set(0xd01c,0);set(0xd01d,0);
  get(0xdd02);e.emit(0x09,3);put(0xdd02);get(0xdd00);e.emit(0x29,0xfc,0x09,2);put(0xdd00);set(0xd018,0x78);
  set(0xd020,0);set(0xd021,0);get(stage+6);e.emit(0xc9,4);e.branch(0xd0,'nes_plain_background');get(stage+11);e.emit(0x29,15);put(0xd021);
  e.label('nes_plain_background');set(state.baseReady,1);set(state.transitionHidden,0);set(state.parserSplit,0);set(state.parserPhase,0);set('color_destination_page',0xd8);
  set('nes_crop_active',0);get(stage+9);e.emit(0xc9,1);e.branch(0xd0,'nes_plain_crop_ready');set('nes_crop_active',1);
  e.label('nes_plain_crop_ready');get(stage+9);e.emit(0xc9,3);e.branch(0xf0,'nes_plain_sharp');e.emit(0xa9,0x18);e.branch(0xd0,'nes_plain_mode');
  e.label('nes_plain_sharp');e.emit(0xa9,8);e.label('nes_plain_mode');put(state.frameMode);put(0xd016);vector('raster_irq');set(0xd012,250);set(0xd019,1);set(0xd011,0x3b);set(0xd01a,1);e.emit(0x58);e.abs(0x4c,'ack_packet');
  e.label('mpe_video_disable');set('nes_crop_active',0);get(enabled);e.branch(0xf0,'nes_disable_done');e.abs(0x20,'nes_nuflix_disable');
  get(0xdd00);e.emit(0x29,0xfc,0x09,2);put(0xdd00);set(0xd018,0x78);
  e.label('nes_disable_done');e.emit(0x60);
  e.label('mpe_video_border_tick');get(enabled);e.branch(0xf0,'nes_border_done');e.abs(0x4c,'nes_nuflix_border_tick');e.label('nes_border_done');e.emit(0x60);
  e.label('nes_nuflix_frame_ready');e.emit(0x60);
  // Keep the established MHS Prism raster and double-buffer handshake intact.
  const aliases={mpe_video_packet:'nes_nuflix_packet',mpe_video_disable:'nes_nuflix_disable',mpe_video_border_tick:'nes_nuflix_border_tick',dos_fli_frame_ready:'nes_nuflix_frame_ready'};
  const rename=a=>aliases[a]??a;
  const proxy=new Proxy(e,{get(target,key){
    if(key==='label')return name=>target.label(rename(name));
    if(key==='abs')return(op,targetName,access)=>target.abs(op,typeof targetName==='string'?rename(targetName):targetName,access);
    if(key==='immediateAddress')return(op,targetName,shift)=>target.immediateAddress(op,rename(targetName),shift);
    const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;
  }});
  emitDoubleVideo(proxy,state,stage,template);
}

function transformNesNuflix(source,template) {
  source=source.replaceAll('\r\n','\n');
  const replace=(before,after)=>{assert.equal(source.split(before).length,2,'NES MHS Prism hook changed: '+before);source=source.replace(before,after);};
  source=`import {emitNesNuflixVideo,nesNuflixState,scatterNesReceiver} from '${import.meta.url}';\n`+source;
  replace('runtimeAddress: 0x0810','runtimeAddress: 0x8000');
  replace('gameplay ? 0x2800 : MPE3_TITLE_PULL.stageAddress','gameplay ? 0x0400 : MPE3_TITLE_PULL.stageAddress');
  replace('Buffer.alloc(MPE3_TITLE_PULL.runtimeAddress - 0x0801, 0x00)','Buffer.alloc(15, 0x00)');
  replace('if (MPE3_TITLE_PULL.runtimeAddress + program.bytes.length > stageAddress) {','if (false) {');
  replace('storeImmediate(e, CONTROL.videoTiming, 0x82);','storeImmediate(e, CONTROL.videoTiming, 0x8e);');
  replace('storeImmediate(e, CONTROL.videoTiming, 0x83);','storeImmediate(e, CONTROL.videoTiming, 0x8f);');
  replace('  abs(opcode, target, access = null) {','  abs(opcode, target, access = null) {\n    target=nesNuflixState(target);');
  replace('    e.abs(0xad, 0x02a6, "read");','    e.emit(0xa5,0x54);');
  const zp=source.match(/const ZP = Object.freeze\(\{[\s\S]*?\}\);/)[0];replace(zp,zp.replace(/0xf([0-9a])/g,'0x5$1'));
  replace("emitVideoClient(e,state,stage,'nes_capture_input','nes_crop_active');",`emitNesNuflixVideo(e,state,stage,Buffer.from('${template.toString('base64')}','base64'));`);
  replace('emitNesController(e,state.rasterTicks);','emitNesController(e,state.rasterTicks,undefined,{moduleModes:true});');
  replace('  e.label("packet_begin_wait");','  e.label("packet_begin_wait");\n  if(gameplay)e.abs(0x20,"nes_service_input");');
  replace('    return Object.freeze({\n      bytes: Buffer.from(this.data),','    return scatterNesReceiver(this, {\n      bytes: Buffer.from(this.data),');
  replace('    labels: program.labels,','    chunks: program.chunks,\n    labels: program.labels,');
  const diagnostic=source.match(/export const MPE3_TITLE_DIAGNOSTIC = Object.freeze\(\{[\s\S]*?\}\);/)[0];replace(diagnostic,diagnostic.replaceAll('0x0400','0x8000'));
  replace('for (const page of [4, 5, 6, 7])','for (const page of [0x80, 0x81, 0x82, 0x83])');
  replace('  storeImmediate(e, 0xd018, 0x14);','  storeImmediate(e, 0xd018, 0x04);');
  replace('  e.emit(0x09, 3);\n  e.abs(0x8d, 0xdd00, "write");','  e.emit(0x29,0xfc,0x09,1);\n  e.abs(0x8d,0xdd00,"write");');
  // SID updates must not overwrite the MHS Prism picture's VIC/sprite policy.
  replace('    e.abs(0x20, "publish_display_policy");\n    e.abs(0x20, \'game_ego_commit\');',
    '    e.abs(0xad,0x02e3,"read");e.branch(0xd0,"nes_nuflix_policy_ready");\n    e.abs(0x20,"publish_display_policy");\n    e.abs(0x20,\'game_ego_commit\');\n    e.label("nes_nuflix_policy_ready");');
  return source;
}

export async function buildNesNuflixClient(options={}) {
  const template=fs.readFileSync(path.join(root,'nes/client/nuflix/nufli-template.bin'));
  const module=await loadNesTerminal(path.join(root,'vm/client'),{transformSource:source=>transformNesNuflix(source,template)});
  const program=module.buildMpe3TitleTerminal({gameplay:true,enable1351Mouse:false,diagnosticTitle:'NESVM - STANDARD / PAN / PRISM',diagnosticFooter:'FIRE:A POTX:B SPC:B RET:START SH:SEL',...options});
  assert.equal(program.labels.nuflix_irq_dispatch,0x0f00);
  const installer=new Emitter(0x0200);installer.emit(0x78,0xa9,0x35,0x85,1);let packed=0xa000;
  for(const [index,chunk] of program.chunks.entries()) {
    for(const [address,value] of [[0x50,packed&255],[0x51,packed>>8],[0x52,chunk.address&255],[0x53,chunk.address>>8]])installer.set(address,value);
    if(chunk.bytes.length>=256){installer.emit(0xa2,Math.floor(chunk.bytes.length/256),0xa0,0);installer.label('page'+index);installer.emit(0xb1,0x50,0x91,0x52,0xc8);installer.branch(0xd0,'page'+index);installer.emit(0xe6,0x51,0xe6,0x53,0xca);installer.branch(0xd0,'page'+index);}
    if(chunk.bytes.length&255){installer.emit(0xa0,0);installer.label('tail'+index);installer.emit(0xb1,0x50,0x91,0x52,0xc8,0xc0,chunk.bytes.length&255);installer.branch(0xd0,'tail'+index);}
    packed+=Math.ceil(chunk.bytes.length/256)*256;
  }
  installer.abs(0x4c,program.labels.entry);const install=installer.finish();assert.ok(install.length<=0x280);
  const bootstrap=new Emitter(0x0810);bootstrap.emit(0x78,0xad,0xa6,0x02,0x85,0x54,0xa9,0x2f,0x85,0,0xa9,0x35,0x85,1);
  for(const [address,value] of [[0x50,0],[0x51,0x0c],[0x52,0],[0x53,0xa0]])bootstrap.set(address,value);
  bootstrap.emit(0xa2,(packed-0xa000)/256,0xa0,0);bootstrap.label('copy');bootstrap.emit(0xb1,0x50,0x91,0x52,0xc8);bootstrap.branch(0xd0,'copy');bootstrap.emit(0xe6,0x51,0xe6,0x53,0xca);bootstrap.branch(0xd0,'copy');
  for(let offset=0;offset<install.length;offset+=256){bootstrap.emit(0xa0,0);bootstrap.label('installer'+offset);bootstrap.abs(0xb9,0x0900+offset);bootstrap.abs(0x99,0x0200+offset);bootstrap.emit(0xc8);bootstrap.branch(0xd0,'installer'+offset);}
  bootstrap.abs(0x4c,0x0200);assert.ok(bootstrap.bytes.length<0xf0);
  const body=Buffer.alloc(0x3ff+packed-0xa000);body.set(bootstrap.finish(),15);body.set(install,0xff);
  let offset=0x3ff;for(const chunk of program.chunks){body.set(chunk.bytes,offset);offset+=Math.ceil(chunk.bytes.length/256)*256;}
  return {...program,prg:Buffer.concat([Buffer.from([1,8]),body]),runtime:Buffer.concat(program.chunks.map(c=>c.bytes)),bootEntry:0x0810,installerBytes:install.length,nuflix:true};
}
