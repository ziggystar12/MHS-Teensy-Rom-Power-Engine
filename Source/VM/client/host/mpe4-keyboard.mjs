// Native gameplay input over the existing bank-58 control page. The payload
// and ACK/commit registers are never used as keyboard storage.
import {emitMpe4Mouse,MPE4_MOUSE} from './mpe4-mouse.mjs';
export const MPE4_INPUT = Object.freeze({
  command: 3, active: 0x02c0, armed: 0x02c1, lastKey: 0x02c2,
  lastModifiers: 0x02c3, repeatTick: 0x02c4, repeatDelay: 0x02c5,
  lastJoy: 0x02c6, sequence: 0x02c7, pending: 0x02c8,
  key: 0x02c9, scan: 0x02ca, joy: 0x02cb, flags: 0x02cc,
  mask: 0x02cd, modifiers: 0x02ce, candidate: 0x02cf,
  currentJoy: 0x02d0, baseline: 0x02d1, bits: 0x02d2,
  matrix: 0x02e0, ack: 0xdffc,
  keyRegister: 0xdff8, scanRegister: 0xdff9, joyRegister: 0xdffa,
  flagsRegister: 0xdffd, sequenceRegister: 0xdffe, checksumRegister: 0xdfff
});
const rows = [
  [8,13,0x81,0x96,0x90,0x92,0x94,0x83],
  ['3','w','a','4','z','s','e',0],
  ['5','r','d','6','c','f','t','x'],
  ['7','y','g','8','b','h','u','v'],
  ['9','i','j','0','m','k','o','n'],
  ['+','p','l','-','.',':','@',','],
  ['\\','*',';',0x84,0,'=','^','/'],
  ['1','_',0,'2',' ',0,'q',27]
];
const shifted = [
  [8,13,0x80,0x97,0x91,0x93,0x95,0x82],
  ['#','W','A','$','Z','S','E',0],
  ['%','R','D','&','C','F','T','X'],
  ["'",'Y','G','(','B','H','U','V'],
  [')','I','J','0','M','K','O','N'],
  ['+','P','L','_','>','[','@','<'],
  ['\\','*',']',0x84,0,'=','^','?'],
  ['!','_',0,'"',' ',0,'Q',27]
];
export const MPE4_KEYS = Object.freeze(rows.flat().map(x => typeof x === 'string' ? x.charCodeAt(0) : x));
export const MPE4_SHIFT_KEYS = Object.freeze(shifted.flat().map(x => typeof x === 'string' ? x.charCodeAt(0) : x));
export const MPE4_SCANS = Object.freeze([
  14,28,77,65,59,61,63,80, 4,17,30,5,44,31,18,0,
  6,19,32,7,46,33,20,45, 8,21,34,9,48,35,22,47,
  10,23,36,11,50,37,24,49, 13,25,38,12,52,39,3,51,
  43,55,39,71,0,13,7,53, 2,12,0,3,57,0,16,1
]);
export function emitMpe4Keyboard(e, rasterTicks, { enable1351Mouse = true } = {}) {
  const s=MPE4_INPUT;
  const get=a=>e.abs(0xad,a,'read'), put=a=>e.abs(0x8d,a,'write');
  const set=(a,v)=>{e.emit(0xa9,v);put(a);};
  const jump=n=>e.abs(0x4c,n), call=n=>e.abs(0x20,n);
  e.label('game_input_init');
  for(const a of [s.armed,s.lastModifiers,s.lastJoy,s.sequence,s.pending]) set(a,0);
  set(s.lastKey,255); set(s.active,1); if(enable1351Mouse)call('game_mouse_init');e.emit(0x60);

  e.label('sample_game_input');
  get(s.pending); e.branch(0xf0,'game_input_scan');
  get(s.ack); e.abs(0xcd,s.sequence,'read'); e.branch(0xf0,'game_input_accepted');
  jump('game_input_send');
  e.label('game_input_accepted'); set(s.pending,0);
  e.label('game_input_scan');
  set(0xdc02,0); set(0xdc03,0); get(0xdc00); e.emit(0x49,255,0x29,31); put(s.currentJoy);
  get(0xdc01); put(s.baseline); set(0xdc02,255); set(s.mask,254);
  e.emit(0xa2,0);
  e.label('game_matrix_row'); get(s.mask); put(0xdc00); get(0xdc01); e.emit(0x49,255);
  e.abs(0x2d,s.baseline,'read'); e.abs(0x9d,s.matrix,'write');
  e.abs(0x0e,s.mask,'write'); e.abs(0xee,s.mask,'write');
  e.emit(0xe8,0xe0,8); e.branch(0xd0,'game_matrix_row');
  set(0xdc00,0x40);set(0xdc02,0xc0);if(enable1351Mouse)call('sample_game_mouse');
  set(s.modifiers,0);
  get(s.matrix+1); e.emit(0x29,128); e.branch(0xd0,'game_shift_on');
  get(s.matrix+6); e.emit(0x29,16); e.branch(0xf0,'game_shift_done');
  e.label('game_shift_on'); set(s.modifiers,1);
  e.label('game_shift_done'); get(s.matrix+7); e.emit(0x29,4); e.branch(0xf0,'game_control_done');
  get(s.modifiers); e.emit(0x09,2); put(s.modifiers);
  e.label('game_control_done'); get(s.matrix+7); e.emit(0x29,32); e.branch(0xf0,'game_alt_done');
  get(s.modifiers); e.emit(0x09,4); put(s.modifiers);
  e.label('game_alt_done');
  set(s.candidate,0); e.emit(0xa2,0);
  e.label('game_find_row'); e.abs(0xbd,s.matrix,'read'); e.abs(0x3d,'game_modifier_mask','read'); put(s.bits);
  e.emit(0xa0,8);
  e.label('game_find_bit'); e.abs(0x4e,s.bits,'write'); e.branch(0xb0,'game_key_found');
  e.abs(0xee,s.candidate,'write'); e.emit(0x88); e.branch(0xd0,'game_find_bit');
  e.emit(0xe8,0xe0,8); e.branch(0xd0,'game_find_row'); set(s.candidate,255);
  e.label('game_key_found');
  get(s.armed); e.branch(0xd0,'game_input_armed');
  get(s.candidate); e.emit(0xc9,255); e.branch(0xd0,'game_input_unarmed');
  get(s.currentJoy); e.branch(0xd0,'game_input_unarmed');
  if(enable1351Mouse){get(MPE4_MOUSE.buttons);e.branch(0xd0,'game_input_unarmed');}set(s.armed,1);
  e.label('game_input_unarmed');if(enable1351Mouse)set(MPE4_MOUSE.queued,0);e.emit(0x60);
  e.label('game_input_armed');
  set(s.flags,0); set(s.key,0); set(s.scan,0);
  get(s.currentJoy); put(s.joy); e.abs(0xcd,s.lastJoy,'read'); e.branch(0xf0,'game_joy_same');
  put(s.lastJoy); set(s.flags,2);
  e.label('game_joy_same');
  get(s.candidate); e.abs(0xcd,s.lastKey,'read'); e.branch(0xd0,'game_new_key');
  get(s.modifiers); e.abs(0xcd,s.lastModifiers,'read'); e.branch(0xd0,'game_new_key');
  get(s.candidate); e.emit(0xc9,255); e.jumpUnless(0xd0,'game_finish_event');
  // AGI directions toggle on separate presses. BIOS-style repeats must not
  // alternate walking/stopping while a cursor remains held. Text editing
  // retains repeat; control/Alt bindings and function keys remain edges.
  get(s.modifiers); e.emit(0x29,6); e.jumpUnless(0xf0,'game_finish_event');
  e.abs(0xae,s.candidate,'read'); e.abs(0xbd,'game_key_table','read');
  e.emit(0xc9,8); e.branch(0xf0,'game_repeatable_key');
  e.emit(0xc9,32); e.jumpUnless(0xb0,'game_finish_event');
  e.emit(0xc9,127); e.jumpUnless(0x90,'game_finish_event');
  e.label('game_repeatable_key');
  get(rasterTicks); e.emit(0x38); e.abs(0xed,s.repeatTick,'read'); e.abs(0xcd,s.repeatDelay,'read');
  e.jumpUnless(0xb0,'game_finish_event');
  set(s.repeatDelay,4); jump('game_repeat_key');
  e.label('game_new_key');
  get(s.candidate); put(s.lastKey); get(s.modifiers); put(s.lastModifiers);
  set(s.repeatDelay,20);
  get(s.candidate); e.emit(0xc9,255); e.jumpUnless(0xd0,'game_finish_event');
  e.label('game_repeat_key');
  get(rasterTicks); put(s.repeatTick); e.abs(0xae,s.candidate,'read');
  e.abs(0xbd,'game_scan_table','read'); put(s.scan);
  get(s.modifiers); e.emit(0x29,1); e.branch(0xf0,'game_unshifted');
  e.abs(0xbd,'game_shift_table','read'); put(s.key);
  e.emit(0xe0,2); e.branch(0xd0,'game_shift_not_right'); set(s.scan,75);
  e.label('game_shift_not_right'); e.emit(0xe0,7); e.branch(0xd0,'game_shift_not_down'); set(s.scan,72);
  e.label('game_shift_not_down'); e.emit(0xe0,3); e.branch(0x90,'game_key_modifiers');
  e.emit(0xe0,7); e.branch(0xb0,'game_key_modifiers'); e.abs(0xee,s.scan,'write');
  jump('game_key_modifiers');
  e.label('game_unshifted'); e.abs(0xbd,'game_key_table','read'); put(s.key);
  e.label('game_key_modifiers');
  get(s.modifiers); e.emit(0x29,2); e.branch(0xf0,'game_key_no_control');
  get(s.key); e.emit(0x09,32,0xc9,97); e.branch(0x90,'game_key_no_control'); e.emit(0xc9,123); e.branch(0xb0,'game_key_no_control');
  e.emit(0x29,31); put(s.key);
  e.label('game_key_no_control'); get(s.modifiers); e.emit(0x29,4); e.branch(0xf0,'game_key_no_alt'); set(s.key,0);
  e.label('game_key_no_alt'); get(s.flags); e.emit(0x09,1); put(s.flags);
  e.label('game_finish_event'); get(s.flags); e.branch(0xd0,'game_queue_event');
  if(enable1351Mouse){
  get(MPE4_MOUSE.queued);e.branch(0xd0,'game_mouse_event');e.emit(0x60);
  e.label('game_mouse_event');
  get(MPE4_MOUSE.queuedX);put(s.key);get(MPE4_MOUSE.queuedY);put(s.scan);set(s.flags,4);
  get(MPE4_MOUSE.queuedButtons);e.emit(0x29,16);e.branch(0xf0,'game_mouse_left_ready');set(s.flags,12);
  e.label('game_mouse_left_ready');get(MPE4_MOUSE.queuedButtons);e.emit(0x29,1);e.branch(0xf0,'game_mouse_right_ready');
  get(s.flags);e.emit(0x09,16);put(s.flags);
  e.label('game_mouse_right_ready');set(MPE4_MOUSE.queued,0);
  }else e.emit(0x60);
  e.label('game_queue_event'); e.abs(0xee,s.sequence,'write'); get(s.sequence); e.branch(0xd0,'game_sequence_ready'); e.abs(0xee,s.sequence,'write');
  e.label('game_sequence_ready'); set(s.pending,1);
  e.label('game_input_send');
  for(const [from,to] of [[s.key,s.keyRegister],[s.scan,s.scanRegister],[s.joy,s.joyRegister],[s.flags,s.flagsRegister],[s.sequence,s.sequenceRegister]]) {get(from);put(to);}
  e.emit(0xa9,0xa5);
  for(const address of [s.key,s.scan,s.joy,s.flags,s.sequence]) e.abs(0x4d,address,'read');
  put(s.checksumRegister); set(0xdff4,s.command); e.emit(0x60);
  e.label('game_modifier_mask'); e.emit(255,127,255,255,255,255,239,219);
  e.label('game_key_table'); e.emit(...MPE4_KEYS);
  e.label('game_shift_table'); e.emit(...MPE4_SHIFT_KEYS);
  e.label('game_scan_table'); e.emit(...MPE4_SCANS);
  if(enable1351Mouse)emitMpe4Mouse(e,rasterTicks,s.baseline,s.currentJoy);
}
