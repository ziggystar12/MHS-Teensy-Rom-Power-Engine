// Four multicolor ego layers share VIC bank $4000 with the bitmap and mouse.
// A complete invisible 256-byte pose is published only at a valid frame end.
export const MPE4_EGO_SPRITES = Object.freeze({
  packetType: 5, shapePayloadBytes: 130, sidPayloadBytes: 37,
  parts: 0x0320, bank: 0x0321, hasPose: 0x0322,
  buffers: Object.freeze([0x4500, 0x4600]), pointerTable: 0x5ff9
});

export function emitMpe4EgoSprites(e, stage) {
  const s=MPE4_EGO_SPRITES, descriptor=stage+8+26;
  const get=a=>e.abs(0xad,a,'read'), put=a=>e.abs(0x8d,a,'write');
  const set=(a,v)=>{e.emit(0xa9,v);put(a);};
  const jump=label=>e.abs(0x4c,label);
  e.label('game_ego_init');
  for(const address of [s.parts,s.bank,s.hasPose])set(address,0);
  e.label('game_ego_hide');get(0xd015);e.emit(0x29,0xe1);put(0xd015);e.emit(0x60);

  e.label('game_ego_receive');
  get(stage+6);e.emit(0xc9,s.shapePayloadBytes);e.jumpUnless(0xf0,'game_ego_bad');
  get(stage+8);e.emit(0xc9,1);e.jumpUnless(0xf0,'game_ego_bad');
  get(stage+9);e.emit(0xc9,2);e.jumpUnless(0x90,'game_ego_bad');
  e.emit(0xc9,0);e.branch(0xd0,'game_ego_second_part');
  get(s.parts);e.jumpUnless(0xf0,'game_ego_bad');
  e.emit(0xa9,0,0x85,0xf2);set(s.parts,1);jump('game_ego_copy_shape');
  e.label('game_ego_second_part');get(s.parts);e.emit(0xc9,1);e.jumpUnless(0xf0,'game_ego_bad');
  e.emit(0xa9,0x80,0x85,0xf2);set(s.parts,3);
  e.label('game_ego_copy_shape');
  get(s.bank);e.emit(0x49,1,0x18,0x69,0x45,0x85,0xf3,0xa0,0);
  e.label('game_ego_copy_byte');
  e.abs(0xb9,stage+10,'read');e.emit(0x91,0xf2,0xc8,0xc0,128);
  e.branch(0xd0,'game_ego_copy_byte');e.emit(0x38,0x60);

  // Validate every descriptor byte and both shape halves before any VIC write.
  e.label('game_ego_validate_sid');
  get(stage+6);e.emit(0xc9,26);e.branch(0xd0,'game_ego_extended_sid');
  get(s.parts);e.jumpUnless(0xf0,'game_ego_bad');e.emit(0x38,0x60);
  e.label('game_ego_extended_sid');e.emit(0xc9,s.sidPayloadBytes);e.jumpUnless(0xf0,'game_ego_bad');
  get(stage+5);e.emit(0x29,0x20);e.jumpUnless(0xd0,'game_ego_bad');
  get(descriptor);e.emit(0xc9,1);e.jumpUnless(0xf0,'game_ego_bad');
  get(descriptor+1);e.emit(0x29,0xe1);e.jumpUnless(0xf0,'game_ego_bad');
  get(descriptor+3);e.emit(0xc9,2);e.jumpUnless(0x90,'game_ego_bad');
  get(descriptor+1);e.emit(0x29,0x14);e.branch(0xf0,'game_ego_y_valid');
  get(descriptor+4);e.emit(0xc9,235);e.jumpUnless(0x90,'game_ego_bad');
  e.label('game_ego_y_valid');e.emit(0xa2,5);
  e.label('game_ego_validate_color');e.abs(0xbd,descriptor+5,'read');e.emit(0xc9,16);
  e.jumpUnless(0x90,'game_ego_bad');e.emit(0xca);e.branch(0x10,'game_ego_validate_color');
  get(s.parts);e.emit(0xc9,3);e.branch(0xf0,'game_ego_valid');
  e.emit(0xc9,0);e.jumpUnless(0xf0,'game_ego_bad');
  get(descriptor+1);e.branch(0xf0,'game_ego_valid');
  get(s.hasPose);e.jumpUnless(0xd0,'game_ego_bad');
  e.label('game_ego_valid');e.emit(0x38,0x60);
  e.label('game_ego_bad');e.emit(0x18,0x60);

  // Caller has validated the SID and reached the frame publication boundary.
  // Sprite zero and unused sprite slots retain their own enable/mode bits.
  e.label('game_ego_commit');
  get(stage+6);e.emit(0xc9,s.sidPayloadBytes);e.branch(0xf0,'game_ego_commit_extended');
  jump('game_ego_hide');
  e.label('game_ego_commit_extended');
  get(s.parts);e.branch(0xf0,'game_ego_same_shape');
  get(s.bank);e.emit(0x49,1);put(s.bank);e.emit(0x0a,0x0a,0x18,0x69,0x14);
  for(let index=0;index<4;index++){put(s.pointerTable+index);if(index<3)e.emit(0x18,0x69,1);}
  set(s.hasPose,1);set(s.parts,0);
  e.label('game_ego_same_shape');
  get(descriptor+2);for(const address of [0xd002,0xd004,0xd006,0xd008])put(address);
  get(0xd010);e.emit(0x29,0xe1);e.abs(0xae,descriptor+3,'read');e.branch(0xf0,'game_ego_x_msb');e.emit(0x09,0x1e);
  e.label('game_ego_x_msb');put(0xd010);
  get(descriptor+4);put(0xd003);put(0xd007);e.emit(0x18,0x69,21);put(0xd005);put(0xd009);
  get(descriptor+5);put(0xd025);get(descriptor+6);put(0xd026);
  for(let index=0;index<4;index++){get(descriptor+7+index);put(0xd028+index);}
  for(const address of [0xd017,0xd01b,0xd01d]){get(address);e.emit(0x29,0xe1);put(address);}
  get(0xd01c);e.emit(0x09,0x1e);put(0xd01c);
  get(0xd015);e.emit(0x29,0xe1);e.abs(0x0d,descriptor+1,'read');put(0xd015);e.emit(0x60);
}
