import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {emitVideoSelectors} from '../../vm/client/host/mpe-video-client.mjs';

// One complete held-state transaction. The field positions reuse the proven
// bank-58 command-3 envelope, but the payload is explicitly NES-INPUT-V1:
// F8 buttons, F9 display bits, FA overflow count, FD protocol, FE sequence,
// FF XOR checksum; FC is the firmware acknowledgement.
export const NES_INPUT=Object.freeze({
  command:3,active:0x02c0,pending:0x02c8,ack:0xdffc,
  buttonsRegister:0xdff8,displayRegister:0xdff9,overflowRegister:0xdffa,
  protocolRegister:0xdffd,sequenceRegister:0xdffe,checksumRegister:0xdfff,
  protocol:0x83,sharp:3
});

// Generate the complete emitter with fixed low-RAM matrix addresses. Keeping
// the matrix outside emitted code also lets VICE inspect it directly.
export function emitNesController(e,rasterTicks,p=NES_INPUT) {
  const matrix=0x02d8;
  const get=a=>e.abs(0xad,a,'read'),put=a=>e.abs(0x8d,a,'write');
  const set=(a,v)=>{e.emit(0xa9,v);put(a);};
  const jump=n=>e.abs(0x4c,n);
  const add=bit=>{get('nes_candidate');e.emit(0x09,bit);put('nes_candidate');};
  e.label('game_input_init');set(p.active,0);set(p.pending,0);set('nes_sequence',0);
  set('nes_queue_head',0);set('nes_queue_tail',0);set('nes_overflows',0);set('nes_cursor_shift',0);set('nes_crop_active',0);set('nes_gs_b',0);
  set('nes_last_buttons',0xff);set('nes_last_display',0xff);set('nes_sharp',0);set('nes_sharp_held',0);set('nes_service_tick',0xff);
  set(0xdc00,0x80);set(0xdc02,0xc0);set(p.active,1);e.emit(0x60);
  // Forward IRQ-captured changes even when the host has no packet ready.
  // Keep IO2 transactions in the main loop and bound idle retries to one
  // per scanner tick rather than flooding the bus on each polling spin.
  e.label('nes_service_input');get(p.active);e.branch(0xf0,'nes_service_done');
  get(rasterTicks);e.abs(0xcd,'nes_service_tick','read');e.branch(0xf0,'nes_service_done');
  put('nes_service_tick');jump('sample_game_input');e.label('nes_service_done');e.emit(0x60);
  e.label('sample_game_input');get(p.pending);e.branch(0xf0,'nes_input_dequeue');
  get(p.ack);e.abs(0xcd,'nes_sequence','read');e.branch(0xf0,'nes_input_accepted');jump('nes_input_send');
  e.label('nes_input_accepted');set(p.pending,0);e.label('nes_input_dequeue');
  get('nes_queue_head');e.abs(0xcd,'nes_queue_tail','read');e.branch(0xd0,'nes_input_available');e.emit(0x60);
  e.label('nes_input_available');e.emit(0xaa);e.abs(0xbd,'nes_queue_buttons','read');put('nes_send_buttons');
  e.abs(0xbd,'nes_queue_display','read');put('nes_send_display');e.emit(0xe8,0x8a,0x29,31);put('nes_queue_head');
  e.abs(0xee,'nes_sequence','write');get('nes_sequence');e.branch(0xd0,'nes_sequence_ready');e.abs(0xee,'nes_sequence','write');
  e.label('nes_sequence_ready');set(p.pending,1);e.label('nes_input_send');
  get('nes_send_buttons');put(p.buttonsRegister);get('nes_send_display');put(p.displayRegister);
  get('nes_overflows');put(p.overflowRegister);set(p.protocolRegister,p.protocol);get('nes_sequence');put(p.sequenceRegister);
  e.emit(0xa9,0xa5);for(const a of ['nes_send_buttons','nes_send_display','nes_overflows'])e.abs(0x4d,a,'read');
  e.emit(0x49,p.protocol);e.abs(0x4d,'nes_sequence','read');put(p.checksumRegister);set(0xdff4,p.command);e.emit(0x60);

  e.label('nes_capture_input');get(p.active);e.branch(0xd0,'nes_capture_scan');e.emit(0x60);
  // Keep CIA PA7 high between scans so the SID has a complete frame to sense
  // port-2 POTX. A C64GS/Cheetah second button drives pin 9 high through its
  // resistor and therefore settles below $80; the normal digital fire remains A.
  e.label('nes_capture_scan');get(0xd419);e.emit(0xc9,0x80);e.branch(0xb0,'nes_gs_b_released');set('nes_gs_b',1);jump('nes_gs_b_ready');
  e.label('nes_gs_b_released');set('nes_gs_b',0);e.label('nes_gs_b_ready');
  set(0xdc02,0);set(0xdc03,0);get(0xdc00);e.emit(0x49,255,0x29,31);put('nes_joy');
  get(0xdc01);put('nes_baseline');set(0xdc02,255);set('nes_mask',254);e.emit(0xa2,0);
  e.label('nes_matrix_row');get('nes_mask');put(0xdc00);get(0xdc01);e.emit(0x49,255);
  e.abs(0x2d,'nes_baseline','read');e.abs(0x9d,matrix,'write');e.abs(0x0e,'nes_mask','write');e.abs(0xee,'nes_mask','write');
  e.emit(0xe8,0xe0,8);e.branch(0xd0,'nes_matrix_row');set(0xdc00,0x80);set(0xdc02,0xc0);set('nes_candidate',0);
  const bit=(value,label,flag)=>{get('nes_joy');e.emit(0x29,value);e.branch(0xf0,label);add(flag);e.label(label);};
  bit(16,'nes_no_a',1);bit(1,'nes_no_up',16);bit(2,'nes_no_down',32);bit(4,'nes_no_left',64);bit(8,'nes_no_right',128);
  get('nes_gs_b');e.branch(0xf0,'nes_no_gs_b');add(2);e.label('nes_no_gs_b');
  const key=(row,mask,label,flag)=>{get(matrix+row);e.emit(0x29,mask);e.branch(0xf0,label);add(flag);e.label(label);};
  key(7,16,'nes_no_b',2);key(0,2,'nes_no_start',8);
  // C64 cursors are Down/Right, with either Shift for Up/Left. A cursor
  // modifier is not also Select, even if the cursor is released first.
  get(matrix+1);e.emit(0x29,128);put('nes_shift');get(matrix+6);e.emit(0x29,16);
  e.abs(0x0d,'nes_shift','read');put('nes_shift');
  get(matrix);e.emit(0x29,128);e.branch(0xf0,'nes_no_cursor_vertical');
  get('nes_shift');e.branch(0xf0,'nes_cursor_down');add(16);jump('nes_no_cursor_vertical');
  e.label('nes_cursor_down');add(32);e.label('nes_no_cursor_vertical');
  get(matrix);e.emit(0x29,4);e.branch(0xf0,'nes_no_cursor_horizontal');
  get('nes_shift');e.branch(0xf0,'nes_cursor_right');add(64);jump('nes_no_cursor_horizontal');
  e.label('nes_cursor_right');add(128);e.label('nes_no_cursor_horizontal');
  get('nes_shift');e.branch(0xd0,'nes_shift_down');set('nes_cursor_shift',0);jump('nes_no_select');
  e.label('nes_shift_down');get(matrix);e.emit(0x29,132);e.branch(0xf0,'nes_shift_without_cursor');
  set('nes_cursor_shift',1);jump('nes_no_select');
  e.label('nes_shift_without_cursor');get('nes_cursor_shift');e.branch(0xd0,'nes_no_select');
  add(4);e.label('nes_no_select');
  get('nes_candidate');e.emit(0x29,0x30,0xc9,0x30);e.branch(0xd0,'nes_vertical_ready');get('nes_candidate');e.emit(0x29,0xcf);put('nes_candidate');
  e.label('nes_vertical_ready');get('nes_candidate');e.emit(0x29,0xc0,0xc9,0xc0);e.branch(0xd0,'nes_directions_ready');get('nes_candidate');e.emit(0x29,0x3f);put('nes_candidate');
  e.label('nes_directions_ready');

  emitVideoSelectors(e,matrix,'nes_sharp','nes_sharp_held');
  // The F3/Commodore rectangle ghosts Cursor Right. Consume it throughout
  // the selector hold, including modifier-first release, instead of moving.
  get('nes_sharp_held');e.emit(0x29,0x20);e.branch(0xf0,'nes_selector_not_f3');
  get('nes_candidate');e.emit(0x29,0x7f);put('nes_candidate');e.label('nes_selector_not_f3');

  // Camera held state travels separately from all eight guest buttons.
  // Enable it only after a new host has resumed the negotiated F3 crop.
  get('nes_sharp');put('nes_display_candidate');e.emit(0xc9,1);e.jumpUnless(0xf0,'nes_camera_ready');
  get('nes_crop_active');e.jumpUnless(0xd0,'nes_camera_ready');
  get(matrix+7);e.emit(0x29,0x24);e.jumpUnless(0xf0,'nes_camera_ready');
  for(const [row,mask,bit] of [[1,2,16],[1,32,32],[1,4,64],[2,4,128]]){
    get(matrix+row);e.emit(0x29,mask);e.branch(0xf0,`nes_no_camera_${bit}`);
    get('nes_display_candidate');e.emit(0x09,bit);put('nes_display_candidate');e.label(`nes_no_camera_${bit}`);
  }
  e.label('nes_camera_ready');
  get('nes_candidate');e.abs(0xcd,'nes_last_buttons','read');e.branch(0xd0,'nes_queue_changed');
  get('nes_display_candidate');e.abs(0xcd,'nes_last_display','read');e.branch(0xd0,'nes_queue_changed');e.emit(0x60);
  e.label('nes_queue_changed');get('nes_candidate');put('nes_last_buttons');get('nes_display_candidate');put('nes_last_display');
  get('nes_queue_tail');e.emit(0x18,0x69,1,0x29,31);put('nes_queue_next');e.abs(0xcd,'nes_queue_head','read');e.branch(0xd0,'nes_queue_room');
  e.abs(0xee,'nes_overflows','write');get('nes_queue_tail');e.emit(0x38,0xe9,1,0x29,31,0xaa);jump('nes_queue_store');
  e.label('nes_queue_room');e.abs(0xae,'nes_queue_tail','read');
  e.label('nes_queue_store');get('nes_candidate');e.abs(0x9d,'nes_queue_buttons','write');get('nes_display_candidate');e.abs(0x9d,'nes_queue_display','write');
  get('nes_queue_next');e.abs(0xcd,'nes_queue_head','read');e.branch(0xf0,'nes_queue_done');put('nes_queue_tail');
  e.label('nes_queue_done');e.emit(0x60);

  for(const label of ['nes_sequence','nes_send_buttons','nes_send_display','nes_overflows','nes_queue_head','nes_queue_tail','nes_queue_next',
    'nes_last_buttons','nes_last_display','nes_sharp','nes_sharp_held','nes_joy','nes_baseline','nes_mask','nes_candidate','nes_gs_b','nes_shift','nes_cursor_shift','nes_crop_active','nes_display_candidate','nes_service_tick']){e.label(label);e.emit(0);}
  e.label('nes_queue_buttons');e.emit(...Array(32).fill(0));e.label('nes_queue_display');e.emit(...Array(32).fill(0));
}

export async function loadNesTerminal(agiRoot, options = {}) {
  const filename=path.join(agiRoot,'host/mpe3-title-terminal.mjs');
  let source=fs.readFileSync(filename,'utf8');
  function replaceOnce(before,after){
    const index=source.indexOf(before);
    if(index<0||source.indexOf(before,index+before.length)>=0)throw new Error('Shared terminal changed: review NES overlay');
    source=source.slice(0,index)+after+source.slice(index+before.length);
  }
  replaceOnce("import { emitMpe4Keyboard, MPE4_INPUT } from './mpe4-keyboard.mjs';",
    `import { MPE4_INPUT } from '${pathToFileURL(path.join(agiRoot,'host/mpe4-keyboard.mjs')).href}';\n`+
    `import { emitVideoClient } from '${pathToFileURL(path.join(agiRoot,'host/mpe-video-client.mjs')).href}';\n`+
    `import { emitNesController } from '${import.meta.url}';`);
  const keyboardCall=source.includes('if (gameplay) emitMpe4Keyboard(e, state.rasterTicks, { enable1351Mouse, mouseRelative });')
    ? 'if (gameplay) emitMpe4Keyboard(e, state.rasterTicks, { enable1351Mouse, mouseRelative });'
    : 'if (gameplay) emitMpe4Keyboard(e, state.rasterTicks, { enable1351Mouse });';
  replaceOnce(keyboardCall,
    "if (gameplay) { emitNesController(e,state.rasterTicks); emitVideoClient(e,state,stage,'nes_capture_input','nes_crop_active'); }");
  replaceOnce('  e.label("packet_idle");','  e.label("packet_idle");\n  if(gameplay)e.abs(0x20,"nes_service_input");');
  replaceOnce('  e.label("dispatch_cells");','  e.label("dispatch_cells");\n  e.abs(0x20,"mpe_video_disable");');
  replaceOnce('  e.emit(0xc9, MPE3_TITLE_PULL.packetCell);','  e.emit(0xc9,5);e.jumpUnless(0xd0,"mpe_video_packet");\n  e.emit(0xc9, MPE3_TITLE_PULL.packetCell);');
  replaceOnce('  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.rasterTicks, 0x00);',
    '  for(let a=0x02e3;a<=0x02ea;a++)storeImmediate(e,a,0);\n  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.rasterTicks, 0x00);');
  replaceOnce('storeImmediate(e, CONTROL.videoTiming, 0x80);','storeImmediate(e, CONTROL.videoTiming, 0x82);');
  replaceOnce('storeImmediate(e, CONTROL.videoTiming, 0x81);','storeImmediate(e, CONTROL.videoTiming, 0x83);');
  replaceOnce('  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.rasterTicks, "write");',
    '  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.rasterTicks, "write");\n'+
    '  if (gameplay) { e.emit(0x8a,0x48,0x98,0x48); e.abs(0x20,"mpe_video_border_tick"); e.abs(0x20,"nes_capture_input"); e.emit(0x68,0xa8,0x68,0xaa); }');
  if(options.transformSource)source=options.transformSource(source);
  source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${pathToFileURL(path.resolve(path.dirname(filename),relative)).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
