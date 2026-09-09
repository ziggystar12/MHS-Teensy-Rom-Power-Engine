// SPDX-License-Identifier: MIT
// Shared opt-in MPE video receiver. No VM/game identity is inspected here.
export function emitVideoSelectors(e,matrix,value,held) {
  const get=a=>e.abs(0xad,a,'read'),put=a=>e.abs(0x8d,a,'write');
  get(matrix);e.emit(0x29,0x78);e.abs(0x2d,held,'read');put(held);
  get(matrix+7);e.emit(0x29,0x24,0xc9,0x24);e.branch(0xd0,'mpe_selector_done');
  get(matrix+1);e.emit(0x29,0x80);e.branch(0xd0,'mpe_selector_done');
  get(matrix+6);e.emit(0x29,0x10);e.branch(0xd0,'mpe_selector_done');
  get(held);e.branch(0xd0,'mpe_selector_done');
  for(const [mask,mode] of [[0x10,0],[0x20,1],[0x40,2],[0x08,3]]){
    get(matrix);e.emit(0x29,0x78,0xc9,mask);e.branch(0xd0,`mpe_not_selector_${mode}`);
    e.emit(0xa9,mode);put(value);e.emit(0xa9,mask);put(held);e.abs(0x4c,'mpe_selector_done');e.label(`mpe_not_selector_${mode}`);
  }
  e.label('mpe_selector_done');
}

export function emitVideoClient(e,state,stage,captureInput='nes_capture_input'){
  const get=a=>e.abs(0xad,a,'read'),put=a=>e.abs(0x8d,a,'write');
  const set=(a,v)=>{e.emit(0xa9,v);put(a);};
  const vector=label=>{e.immediateAddress(0xa9,label,0);put(0xfffe);e.immediateAddress(0xa9,label,8);put(0xffff);};
  const enabled=0x02e3;
  const streaming=0x02e4,nextBank=0x02e5,nextMode=0x02e6,nextEnabled=0x02e7,activeBank=0x02e8,flipPending=0x02e9;
  const kernelJump=0x02eb;
  e.label('mpe_video_packet');get(stage+6);e.emit(0xc9,4);e.branch(0xf0,'mpe_video_length_ok');e.emit(0xc9,3);e.jumpUnless(0xf0,'error_type');e.label('mpe_video_length_ok');
  get(stage+8);e.emit(0xc9,3);e.jumpUnless(0xd0,'mpe_video_stream');e.emit(0xc9,4);e.jumpUnless(0xd0,'mpe_video_flip');
  get(stage+8);e.emit(0xc9,1);e.branch(0xd0,'mpe_video_resume');
  // Pause is ACKed only after the timed kernel has left the visible area.
  get(state.baseReady);e.branch(0xf0,'mpe_pause_hidden');e.abs(0x20,'wait_fresh_border');
  e.label('mpe_pause_hidden');e.emit(0x78);set(0xd01a,0);set(0xd011,0x2b);
  e.abs(0x4c,'ack_packet');
  e.label('mpe_video_resume');e.emit(0xc9,2);e.jumpUnless(0xf0,'error_type');
  set(streaming,0);set(flipPending,0);set(activeBank,0);set(kernelJump,0x4c);set(kernelJump+1,0);set(kernelJump+2,0x30);
  get(stage+9);e.emit(0xc9,4);e.jumpUnless(0x90,'error_type');
  get(stage+10);e.emit(0xc9,2);e.jumpUnless(0x90,'error_type');put(enabled);
  e.emit(0x78);set(0xd015,0);get(0xdd02);e.emit(0x09,3);put(0xdd02);get(0xdd00);e.emit(0x29,0xfc,0x09,2);put(0xdd00);
  set(0xd018,0x78);set(0xd020,0);set(0xd021,0);set(state.baseReady,1);set(state.transitionHidden,0);set(state.parserSplit,0);set(state.parserPhase,0);
  get(stage+6);e.emit(0xc9,4);e.branch(0xd0,'mpe_background_ready');get(stage+11);e.emit(0x29,15);put(0xd021);e.label('mpe_background_ready');
  set('color_destination_page',0xd8);get(stage+9);e.branch(0xf0,'mpe_resume_color');e.emit(0xa9,8);e.branch(0xd0,'mpe_resume_mode');
  e.label('mpe_resume_color');e.emit(0xa9,0x18);e.label('mpe_resume_mode');put(state.frameMode);put(0xd016);
  set(0x02e0,0x4c);e.immediateAddress(0xa9,'mpe_video_irq_finish',0);put(0x02e1);e.immediateAddress(0xa9,'mpe_video_irq_finish',8);put(0x02e2);
  // IRQ timing variant is selected once, outside the stabilized routine.
  get(state.videoTiming);e.branch(0xf0,'mpe_video_ntsc');
  e.immediateAddress(0xa9,'mpe_video_stable_pal',0);put('mpe_video_irq_target_low');e.immediateAddress(0xa9,'mpe_video_stable_pal',8);put('mpe_video_irq_target_high');e.abs(0x4c,'mpe_video_variant_ready');
  e.label('mpe_video_ntsc');e.immediateAddress(0xa9,'mpe_video_stable_ntsc',0);put('mpe_video_irq_target_low');e.immediateAddress(0xa9,'mpe_video_stable_ntsc',8);put('mpe_video_irq_target_high');
  e.label('mpe_video_variant_ready');get(enabled);e.branch(0xf0,'mpe_resume_plain');vector('mpe_video_irq');set(0xd012,48);e.abs(0x4c,'mpe_resume_enable');
  e.label('mpe_resume_plain');vector('raster_irq');set(0xd012,250);
  e.label('mpe_resume_enable');set(0xd019,1);set(0xd011,0x3b);set(0xd01a,1);e.emit(0x58);e.abs(0x4c,'ack_packet');

  e.label('mpe_video_disable');get(enabled);e.abs(0x0d,activeBank,'read');e.abs(0x0d,streaming,'read');e.branch(0xf0,'mpe_video_disabled');e.abs(0x20,'wait_fresh_border');e.emit(0x08,0x78);
  set(streaming,0);set(flipPending,0);set(activeBank,0);get(0xdd00);e.emit(0x29,0xfc,0x09,2);put(0xdd00);
  set(enabled,0);vector('raster_irq');set(0xd012,250);set(0xd011,0x3b);set(0xd018,0x78);set(0xd019,1);e.emit(0x28);
  e.label('mpe_video_disabled');e.emit(0x60);

  // A streaming upload changes no visible VIC state. It arms border grants
  // while the current bank and its independently resident kernel keep running.
  e.label('mpe_video_stream');get(stage+9);e.emit(0xc9,1);e.jumpUnless(0xb0,'error_type');e.emit(0xc9,3);e.jumpUnless(0x90,'error_type');put(nextMode);
  get(stage+10);e.emit(0xc9,4);e.jumpUnless(0x90,'error_type');e.emit(0x48,0x29,1);put(nextEnabled);e.emit(0x68,0x4a);put(nextBank);
  e.abs(0xcd,activeBank,'read');e.jumpUnless(0xd0,'error_type');set(streaming,1);e.abs(0x4c,'ack_packet');
  e.label('mpe_video_flip');get(streaming);e.jumpUnless(0xd0,'error_type');get(stage+9);e.abs(0xcd,nextMode,'read');e.jumpUnless(0xf0,'error_type');
  get(nextBank);e.emit(0x0a);e.abs(0x0d,nextEnabled,'read');e.abs(0xcd,stage+10,'read');e.jumpUnless(0xf0,'error_type');
  set(flipPending,1);e.abs(0x20,'reset_wait');e.label('mpe_flip_wait');get(flipPending);e.branch(0xf0,'mpe_flip_ack');
  e.abs(0x20,'tick_wait');e.jumpUnless(0xb0,'error_clock');e.abs(0x4c,'mpe_flip_wait');e.label('mpe_flip_ack');e.abs(0x4c,'ack_packet');

  // Both ordinary and enhanced IRQs call here after the final visible line.
  // A delayed IRQ misses the slot rather than granting DMA in active display.
  e.label('mpe_video_border_tick');get(0xd011);e.jumpUnless(0x10,'mpe_border_done');
  e.label('mpe_border_line');get(0xd012);e.emit(0xc9,250);e.branch(0xf0,'mpe_border_line');e.emit(0xc9,251);e.jumpUnless(0xb0,'mpe_border_done');e.emit(0xc9,253);e.jumpUnless(0x90,'mpe_border_done');
  get(flipPending);e.jumpUnless(0xd0,'mpe_border_grant');set(streaming,0);get(nextBank);put(activeBank);
  get(0xdd00);e.emit(0x29,0xfc);put('mpe_bank_bits');get(activeBank);e.branch(0xf0,'mpe_flip_bank_zero');
  get('mpe_bank_bits');e.emit(0x09,1);put(0xdd00);set(kernelJump+2,0xc0);set(0xd018,0x38);e.abs(0x4c,'mpe_flip_bank_ready');
  e.label('mpe_flip_bank_zero');get('mpe_bank_bits');e.emit(0x09,2);put(0xdd00);set(kernelJump+2,0x30);set(0xd018,0x78);
  e.label('mpe_flip_bank_ready');set(0xd011,0x3b);set(state.frameMode,8);set(0xd016,8);
  get(nextEnabled);put(enabled);e.branch(0xf0,'mpe_flip_plain');vector('mpe_video_irq');set(0xd012,48);e.abs(0x4c,'mpe_flip_done');
  e.label('mpe_flip_plain');vector('raster_irq');set(0xd012,250);
  e.label('mpe_flip_done');set(flipPending,0);
  e.label('mpe_border_grant');get(streaming);e.branch(0xf0,'mpe_border_done');set(0xdff4,5);
  e.label('mpe_border_done');e.emit(0x60);e.label('mpe_bank_bits');e.emit(0);

  e.label('mpe_video_irq');e.emit(0x48,0x8a,0x48,0x98,0x48);
  e.emit(0xa9);e.label('mpe_video_irq_target_low');e.emit(0);put(0xfffe);
  e.emit(0xa9);e.label('mpe_video_irq_target_high');e.emit(0);put(0xffff);
  set(0xd012,49);set(0xd019,1);e.emit(0xba,0x58);
  for(let i=0;i<40;i++)e.emit(0xea);
  e.label('mpe_video_irq_guard');e.abs(0x4c,'mpe_video_irq_guard');
  // Nested IRQ discards only its own hardware stack frame via saved X.
  for(const ntsc of [false,true]){
    const name=ntsc?'ntsc':'pal';while((e.address()&255)>160)e.emit(0xea);
    e.label('mpe_video_stable_'+name);e.emit(0x9a,0xa2,8);
    e.label('mpe_video_delay_'+name);e.emit(0xca);e.branch(0xd0,'mpe_video_delay_'+name);e.emit(0x24,0x03);
    if(ntsc)e.emit(0xea);
    get(0xd012);e.abs(0xcd,0xd012,'read');e.branch(0xf0,'mpe_video_sync_'+name);e.label('mpe_video_sync_'+name);
    // The extra indirect jump is three cycles, removed from the delay.
    for(let i=0;i<(ntsc?29:28);i++)e.emit(0xea);e.abs(0x4c,kernelJump);
  }
  e.label('mpe_video_irq_finish');set(0xd011,0x3b);set(0xd018,0x78);set(0xd019,1);vector('mpe_video_irq');set(0xd012,48);
  e.abs(0xee,state.rasterTicks,'write');e.abs(0x20,'mpe_video_border_tick');e.abs(0x20,captureInput);e.emit(0x68,0xa8,0x68,0xaa,0x68,0x40);
}
