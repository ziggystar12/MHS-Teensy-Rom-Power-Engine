// C64-side 1351 pointer. No frame-plane writes and no AGI execution occur here.
export const MPE4_MOUSE = Object.freeze({
  lastTick:0x0300, rawX:0x0301, rawY:0x0302, sampleX:0x0303, sampleY:0x0304,
  accumX:0x0305, accumY:0x0306, x:0x0307, y:0x0308, calibrated:0x0309,
  present:0x030a, confirmation:0x030b, live:0x030c, idle:0x030d, probe:0x030e,
  buttons:0x030f, lastButtons:0x0310, queued:0x0311,
  queuedX:0x0312, queuedY:0x0313, queuedButtons:0x0314, moved:0x0315,
  lastX:0x0316, lastY:0x0317, sprite:0x4400, spritePointer:0x5ff8
});

export function emitMpe4Mouse(e,rasterTicks,baseline,port2Grounds) {
  const s=MPE4_MOUSE;
  const get=a=>e.abs(0xad,a,'read'),put=a=>e.abs(0x8d,a,'write');
  const set=(a,v)=>{e.emit(0xa9,v);put(a);};
  const jump=n=>e.abs(0x4c,n),call=n=>e.abs(0x20,n);
  e.label('game_mouse_init');
  for(const a of [s.accumX,s.accumY,s.calibrated,s.present,s.confirmation,s.live,s.idle,
    s.buttons,s.lastButtons,s.queued])set(a,0);
  set(s.x,80);set(s.lastX,80);set(s.y,100);set(s.lastY,100);set(s.probe,7);
  get(rasterTicks);e.emit(0x38,0xe9,1);put(s.lastTick);
  e.emit(0xa2,63);
  e.label('game_mouse_copy_shape');e.abs(0xbd,'game_mouse_shape','read');e.abs(0x9d,s.sprite,'write');
  e.emit(0xca);e.branch(0x10,'game_mouse_copy_shape');
  set(s.spritePointer,0x10);set(0xd027,1);
  for(const a of [0xd015,0xd017,0xd01b,0xd01c,0xd01d]){get(a);e.emit(0x29,254);put(a);}
  set(0xdc03,0);set(0xdc02,0xc0);set(0xdc00,0x40);e.emit(0x60);

  e.label('sample_game_mouse');
  // Each grounded port2 pin also grounds a keyboard row. A held key in PB0
  // or PB4 is then electrically indistinguishable from a mouse button, even
  // after a real mouse has been detected. Retain the last reported buttons
  // until port2 is neutral; pointer movement can still be sampled normally.
  get(port2Grounds);e.branch(0xf0,'game_mouse_unambiguous_buttons');
  get(s.lastButtons);jump('game_mouse_buttons_ready');
  e.label('game_mouse_unambiguous_buttons');get(baseline);e.emit(0x49,255,0x29,17);
  e.label('game_mouse_buttons_ready');put(s.buttons);set(s.moved,0);
  // Poll buttons on every call, POT at most once per physical display frame.
  get(rasterTicks);e.abs(0xcd,s.lastTick,'read');e.jumpUnless(0xd0,'game_mouse_after_axes');put(s.lastTick);
  get(s.live);e.branch(0xd0,'game_mouse_sample');
  e.abs(0xee,s.probe,'write');get(s.probe);e.emit(0x29,7);put(s.probe);
  e.jumpUnless(0xf0,'game_mouse_after_axes');
  e.label('game_mouse_sample');
  // CIA PA6/7 select port 1 POT; PA0..4 remain port 2 digital inputs.
  set(0xdc02,0xc0);set(0xdc00,0x40);e.emit(0xa2,160);
  e.label('game_mouse_settle');e.emit(0xea,0xea,0xea,0xca);e.branch(0xd0,'game_mouse_settle');
  get(0xd419);e.emit(0x29,127);put(s.sampleX);
  get(0xd41a);e.emit(0x29,127,0x49,127);put(s.sampleY);
  get(s.calibrated);e.branch(0xd0,'game_mouse_axes');
  get(s.sampleX);put(s.rawX);get(s.sampleY);put(s.rawY);set(s.calibrated,1);jump('game_mouse_sample_done');
  e.label('game_mouse_axes');e.emit(0xa2,1);
  e.label('game_mouse_axis');
  e.abs(0xbd,s.sampleX,'read');e.emit(0x38);e.abs(0xfd,s.rawX,'read');e.emit(0x29,127);
  e.jumpUnless(0xd0,'game_mouse_axis_done');e.emit(0xc9,64);e.branch(0x90,'game_mouse_delta_positive');
  e.emit(0xc9,96);e.jumpUnless(0xb0,'game_mouse_axis_done');
  e.emit(0xc9,127);e.jumpUnless(0xd0,'game_mouse_axis_next');e.emit(0x09,128);jump('game_mouse_accumulate');
  e.label('game_mouse_delta_positive');e.emit(0xc9,32);e.jumpUnless(0x90,'game_mouse_axis_done');
  // Keep the prior sample for one-count movement. A second step in the same
  // direction then reaches two; alternating analog wobble still cancels.
  e.emit(0xc9,2);e.jumpUnless(0xb0,'game_mouse_axis_next');
  e.label('game_mouse_accumulate');e.emit(0x18);e.abs(0x7d,s.accumX,'read');
  e.branch(0x10,'game_mouse_positive_accum');
  e.emit(0x49,255,0x18,0x69,1,0x48,0x29,1);e.branch(0xf0,'game_mouse_negative_residual');
  e.emit(0xa9,255);
  e.label('game_mouse_negative_residual');e.abs(0x9d,s.accumX,'write');e.emit(0x68,0x4a,0xa8);
  e.branch(0xf0,'game_mouse_axis_done');call('game_mouse_mark_present');
  e.label('game_mouse_negative_step');e.abs(0xbd,s.x,'read');e.branch(0xf0,'game_mouse_bound');
  e.abs(0xde,s.x,'write');e.emit(0x88);e.branch(0xd0,'game_mouse_negative_step');jump('game_mouse_axis_done');
  e.label('game_mouse_positive_accum');e.emit(0x48,0x29,1);e.abs(0x9d,s.accumX,'write');e.emit(0x68,0x4a,0xa8);
  e.branch(0xf0,'game_mouse_axis_done');call('game_mouse_mark_present');
  e.label('game_mouse_positive_step');e.abs(0xbd,s.x,'read');e.abs(0xdd,'game_mouse_maximum','read');
  e.branch(0xb0,'game_mouse_bound');e.abs(0xfe,s.x,'write');e.emit(0x88);
  e.branch(0xd0,'game_mouse_positive_step');jump('game_mouse_axis_done');
  e.label('game_mouse_bound');e.emit(0xa9,0);e.abs(0x9d,s.accumX,'write');
  e.label('game_mouse_axis_done');e.abs(0xbd,s.sampleX,'read');e.abs(0x9d,s.rawX,'write');
  e.label('game_mouse_axis_next');
  e.emit(0xca);e.jumpUnless(0x30,'game_mouse_axis');
  e.label('game_mouse_sample_done');
  get(s.moved);e.branch(0xd0,'game_mouse_after_axes');get(s.live);e.branch(0xf0,'game_mouse_after_axes');
  e.abs(0xee,s.idle,'write');get(s.idle);e.emit(0xc9,90);e.branch(0x90,'game_mouse_after_axes');
  set(s.live,0);set(s.idle,0);set(s.probe,0);
  e.label('game_mouse_after_axes');
  call('game_mouse_publish_cursor');
  // One frozen mouse event waits behind an already accepted keyboard event.
  get(s.queued);e.branch(0xd0,'game_mouse_done');
  get(s.buttons);e.abs(0xcd,s.lastButtons,'read');e.branch(0xd0,'game_mouse_queue');
  get(s.x);e.abs(0xcd,s.lastX,'read');e.branch(0xd0,'game_mouse_queue');
  get(s.y);e.abs(0xcd,s.lastY,'read');e.branch(0xf0,'game_mouse_done');
  e.label('game_mouse_queue');
  for(const [a,b,c]of[[s.x,s.queuedX,s.lastX],[s.y,s.queuedY,s.lastY],[s.buttons,s.queuedButtons,s.lastButtons]]){get(a);put(b);put(c);}
  set(s.queued,1);
  e.label('game_mouse_done');e.emit(0x60);

  e.label('game_mouse_mark_present');set(s.moved,1);set(s.live,1);set(s.idle,0);set(s.probe,0);
  get(s.present);e.branch(0xd0,'game_mouse_mark_done');
  get(s.confirmation);e.branch(0xd0,'game_mouse_present');set(s.confirmation,1);e.emit(0x60);
  e.label('game_mouse_present');set(s.present,1);
  e.label('game_mouse_mark_done');e.emit(0x60);
  e.label('game_mouse_publish_cursor');
  get(s.x);e.emit(0x0a,0x18,0x69,24);put(0xd000);
  get(0xd010);e.emit(0x29,254);e.abs(0xae,s.x,'read');e.emit(0xe0,116);e.branch(0x90,'game_mouse_x_low');e.emit(0x09,1);
  e.label('game_mouse_x_low');put(0xd010);get(s.y);e.emit(0x18,0x69,50);put(0xd001);
  get(s.present);e.branch(0xf0,'game_mouse_hide');get(0xd015);e.emit(0x09,1);put(0xd015);e.emit(0x60);
  e.label('game_mouse_hide');get(0xd015);e.emit(0x29,254);put(0xd015);e.emit(0x60);
  e.label('game_mouse_maximum');e.emit(159,199);
  e.label('game_mouse_shape');
  const rows=[0x80,0xc0,0xe0,0xf0,0xf8,0xfc,0xfe,0xff,0xfc,0xcc,0x86,6,3,3];
  e.emit(...Array.from({length:64},(_,i)=>i%3===0&&i/3<rows.length?rows[i/3]:0));
}
