// Shared native VM terminal with held-key input, video selectors and SID packets.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {emitVideoSelectors} from './mpe-video-client.mjs';

// Exceptional read recovery only: the fast, valid-packet path never calls it.
// The foreground (not merely the command ISR) reports $12 after the current
// guest slice has ended. Only ACK of the unchanged packet releases the hold.
export function emitDosPacketRecovery(e, statusRecovery = false) {
  e.label('dos_request_quiet');
  e.emit(0xa9, 4); e.abs(0x8d, 0xdff4, 'write');
  e.emit(0xa2, 0, 0xa0, 0);
  e.label('dos_quiet_wait');
  e.abs(0xad, 0xdff5, 'read');
  e.emit(0xc9, 0xe0);
  if (statusRecovery) {
    e.branch(0x90, 'dos_quiet_status_ok');
    // This legacy recovery routine is unused by the replay-enabled Doom
    // receiver, but keep its failure check consistent if called directly.
    e.abs(0x8d, 'trigger_status', 'write');
    e.emit(0x8a, 0x48, 0x98, 0x48); // Preserve the quiet-wait budget in X/Y.
    e.abs(0xad, 'trigger_status', 'read');e.abs(0x20, 'status_read_recover');
    e.abs(0x8d, 'trigger_status', 'write');
    e.emit(0x68, 0xa8, 0x68, 0xaa);
    e.abs(0xad, 'trigger_status', 'read');
    e.label('dos_quiet_status_ok');
  } else e.jumpUnless(0x90, 'error_firmware');
  e.emit(0x29, 0x10); e.branch(0xd0, 'dos_quiet_ready');
  e.emit(0xca); e.branch(0xd0, 'dos_quiet_wait');
  // A lost request write can be retried idempotently without resetting the
  // bounded wait or consuming the pending display packet.
  e.emit(0xa9, 4); e.abs(0x8d, 0xdff4, 'write');
  e.emit(0x88); e.branch(0xd0, 'dos_quiet_wait');
  e.abs(0x4c, 'error_unstable');
  e.label('dos_quiet_ready');
  // A $12 proves the foreground has quiesced, but a just-finished bus cycle
  // can still be visible at IO2 for a few CPU reads.  Pace the exceptional
  // reread by two real C64 frames. Read the live VIC raster because bootstrap
  // reaches here before the terminal enables its raster IRQ. Line $fa exists
  // on both NTSC and PAL and is also the terminal's later IRQ marker.
  e.emit(0xa2, 2);
  e.label('dos_quiet_frame');
  e.label('dos_quiet_leave_marker');
  e.abs(0xad, 0xd012, 'read'); e.emit(0xc9, 0xfa);
  e.branch(0xd0, 'dos_quiet_seek_marker');
  e.abs(0x20, 'tick_wait'); e.jumpUnless(0xb0, 'error_timeout');
  e.abs(0x4c, 'dos_quiet_leave_marker');
  e.label('dos_quiet_seek_marker');
  e.abs(0xad, 0xd012, 'read'); e.emit(0xc9, 0xfa);
  e.branch(0xf0, 'dos_quiet_marker');
  e.abs(0x20, 'tick_wait'); e.jumpUnless(0xb0, 'error_timeout');
  e.abs(0x4c, 'dos_quiet_seek_marker');
  e.label('dos_quiet_marker');
  e.emit(0xca); e.branch(0xd0, 'dos_quiet_frame');
  e.emit(0x60);
}

// Firmware V1.0.17's compact C64-derived font maps ASCII backslash through
// the pound-sign screen-code slot. Correct either half of that exact packed
// glyph in monochrome DOS text records. Attribute and pixel matching keep
// graphics packets untouched, and future firmware with a real slash bypasses
// this compatibility path naturally.
export function emitDosBackslashCompatibility(e, recordLow) {
  const oldGlyph = [0, 3, 2, 7, 2, 2, 7];
  const pathGlyph = [8, 8, 4, 4, 2, 2, 1, 1];
  e.label('dos_fix_path_separator');
  // The record pointer has already advanced past its two-byte cell index.
  // V1.0.17 publishes 80-column text as screen $10 and colour $01.
  e.emit(0xa0, 8, 0xb1, recordLow, 0xc9, 0x10);
  e.jumpUnless(0xf0, 'dos_path_done');
  e.emit(0xc8, 0xb1, recordLow, 0x29, 0x0f, 0xc9, 1);
  e.jumpUnless(0xf0, 'dos_path_done');
  for (let row = 0; row < oldGlyph.length; row++) {
    e.emit(0xa0, row, 0xb1, recordLow, 0x29, 0xf0, 0xc9, oldGlyph[row] << 4);
    e.jumpUnless(0xf0, 'dos_path_check_right');
  }
  for (let row = 0; row < pathGlyph.length; row++) {
    e.emit(0xa0, row, 0xb1, recordLow, 0x29, 0x0f, 0x09, pathGlyph[row] << 4,
      0x91, recordLow);
  }
  e.label('dos_path_check_right');
  for (let row = 0; row < oldGlyph.length; row++) {
    e.emit(0xa0, row, 0xb1, recordLow, 0x29, 0x0f, 0xc9, oldGlyph[row]);
    e.jumpUnless(0xf0, 'dos_path_done');
  }
  for (let row = 0; row < pathGlyph.length; row++) {
    e.emit(0xa0, row, 0xb1, recordLow, 0x29, 0xf0, 0x09, pathGlyph[row],
      0x91, recordLow);
  }
  e.label('dos_path_done'); e.emit(0x60);
}

// DOS uses held PC keys, unlike AGI's press-to-toggle directions. Keep the
// six-register envelope, with flags bit 7 identifying a complete held-state
// snapshot. Bits 0..2 are Shift/Ctrl/Alt and bit 3 requests typematic repeat.
// The firmware owns PC make/break events; no cursor is encoded as ANSI Escape.
export function emitVmKeyboard(e, p, keys, shifted, scans, rasterTicks, videoSelectors = false, musicTiming = null) {
  // IRQ capture owns these scratch bytes; foreground transport owns p.key,
  // p.scan, p.joy and p.flags until the matching ACK. Never share their payload.
  // $02e0-$02ed belong to the enhanced receiver's IRQ trampoline/state.
  const s = {...p, matrix: 0x02d8, key: 'dos_capture_key', scan: 'dos_capture_scan',
    joy: 'dos_capture_joy', flags: 'dos_capture_flags'};
  const get = a => e.abs(0xad, a, 'read'), put = a => e.abs(0x8d, a, 'write');
  const set = (a, v) => { e.emit(0xa9, v); put(a); };
  const jump = n => e.abs(0x4c, n);
  e.label('game_input_init');
  set(s.active, 0);
  for (const a of [s.armed, s.lastKey, s.lastModifiers, s.lastJoy, s.sequence, s.pending,
    'dos_queue_head', 'dos_queue_tail']) set(a, 0);
  if (videoSelectors) { set('dos_video_choice', 255); set('dos_video_held', 0); }
  if (musicTiming !== null) {
    // First immutable, ACK/retry-protected input is the saved C64 standard.
    // Firmware already forwards $91 to the VM; no host ABI change is needed.
    set('dos_queue_keys', 0); set('dos_queue_joy', 0); set('dos_queue_flags', 0x91);
    get(musicTiming); e.branch(0xf0, 'dos_music_ntsc');
    e.emit(0xa9, 0); jump('dos_music_standard_ready');
    e.label('dos_music_ntsc'); e.emit(0xa9, 1);
    e.label('dos_music_standard_ready'); put('dos_queue_scans'); set('dos_queue_tail', 1);
  }
  set(s.active, 1); e.emit(0x60);

  e.label('sample_game_input');
  get(s.pending); e.branch(0xf0, 'dos_input_dequeue');
  get(s.ack); e.abs(0xcd, s.sequence, 'read'); e.branch(0xf0, 'dos_input_accepted');
  jump('game_input_send');
  e.label('dos_input_accepted'); set(s.pending, 0);
  e.label('dos_input_dequeue');
  get('dos_queue_head'); e.abs(0xcd, 'dos_queue_tail', 'read'); e.branch(0xd0, 'dos_input_available');
  e.emit(0x60);
  e.label('dos_input_available'); e.emit(0xaa);
  for (const [from, to] of [['dos_queue_keys', p.key], ['dos_queue_scans', p.scan],
    ['dos_queue_joy', p.joy], ['dos_queue_flags', p.flags]]) { e.abs(0xbd, from, 'read'); put(to); }
  e.emit(0xe8, 0x8a, 0x29, 31); put('dos_queue_head');
  e.abs(0xee, s.sequence, 'write'); get(s.sequence); e.branch(0xd0, 'dos_sequence_ready'); e.abs(0xee, s.sequence, 'write');
  e.label('dos_sequence_ready'); set(s.pending, 1);
  e.label('game_input_send');
  for (const [from, to] of [[p.key, p.keyRegister], [p.scan, p.scanRegister], [p.joy, p.joyRegister],
      [p.flags, p.flagsRegister], [p.sequence, p.sequenceRegister]]) { get(from); put(to); }
  e.emit(0xa9, 0xa5);
  for (const a of [p.key, p.scan, p.joy, p.flags, p.sequence]) e.abs(0x4d, a, 'read');
  put(p.checksumRegister); set(0xdff4, p.command); e.emit(0x60);

  // Called once per raster frame, even while the foreground waits for input
  // ACK or is copying display packets. A 31-state FIFO preserves short taps
  // and their releases. Only its tail publishes a completely stored entry.
  e.label('dos_capture_input'); get(s.active); e.branch(0xd0, 'dos_input_scan'); e.emit(0x60);
  e.label('dos_input_scan');
  // Read port 2 with both CIA ports floating, then mask any grounded keyboard
  // columns while scanning. A joystick direction must not invent a key.
  set(0xdc02, 0); set(0xdc03, 0); get(0xdc00); e.emit(0x49, 255, 0x29, 31); put(s.currentJoy);
  get(0xdc01); put(s.baseline); set(0xdc02, 255); set(s.mask, 254); e.emit(0xa2, 0);
  e.label('dos_matrix_row'); get(s.mask); put(0xdc00); get(0xdc01); e.emit(0x49, 255);
  e.abs(0x2d, s.baseline, 'read'); e.abs(0x9d, s.matrix, 'write');
  e.abs(0x0e, s.mask, 'write'); e.abs(0xee, s.mask, 'write');
  e.emit(0xe8, 0xe0, 8); e.branch(0xd0, 'dos_matrix_row');
  set(0xdc00, 0x40); set(0xdc02, 0xc0);
  set(s.modifiers, 0);
  get(s.matrix + 1); e.emit(0x29, 128); e.branch(0xd0, 'dos_shift_on');
  get(s.matrix + 6); e.emit(0x29, 16); e.branch(0xf0, 'dos_shift_done');
  e.label('dos_shift_on'); set(s.modifiers, 1);
  e.label('dos_shift_done'); get(s.matrix + 7); e.emit(0x29, 4); e.branch(0xf0, 'dos_control_done');
  get(s.modifiers); e.emit(0x09, 2); put(s.modifiers);
  e.label('dos_control_done'); get(s.matrix + 7); e.emit(0x29, 32); e.branch(0xf0, 'dos_alt_done');
  get(s.modifiers); e.emit(0x09, 4); put(s.modifiers);
  e.label('dos_alt_done'); set(s.candidate, 0); e.emit(0xa2, 0);
  e.label('dos_find_row'); e.abs(0xbd, s.matrix, 'read'); e.abs(0x3d, 'dos_modifier_mask', 'read'); put(s.bits);
  e.branch(0xd0, 'dos_find_nonempty_row');
  get(s.candidate); e.emit(0x18, 0x69, 8); put(s.candidate); jump('dos_find_next_row');
  e.label('dos_find_nonempty_row');
  e.emit(0xa0, 8);
  e.label('dos_find_bit'); e.abs(0x4e, s.bits, 'write'); e.branch(0xb0, 'dos_key_found');
  e.abs(0xee, s.candidate, 'write'); e.emit(0x88); e.branch(0xd0, 'dos_find_bit');
  e.label('dos_find_next_row'); e.emit(0xe8, 0xe0, 8); e.branch(0xd0, 'dos_find_row'); set(s.candidate, 255);
  e.label('dos_key_found'); get(s.armed); e.branch(0xd0, 'dos_input_armed');
  get(s.candidate); e.emit(0xc9, 255); e.branch(0xd0, 'dos_input_unarmed');
  get(s.currentJoy); e.branch(0xd0, 'dos_input_unarmed'); set(s.armed, 1);
  e.label('dos_input_unarmed'); e.emit(0x60);
  e.label('dos_input_armed');
  if (videoSelectors) {
    // Doom uses the shared host's separate selector envelope, not PC F-key
    // input. Inspect the matrix so the F3 chord's ghost cursor cannot win.
    emitVideoSelectors(e, s.matrix, 'dos_video_choice', 'dos_video_held');
    get('dos_video_choice'); e.emit(0xc9, 255); e.branch(0xd0, 'dos_video_enqueue');
    get('dos_video_held'); e.branch(0xf0, 'dos_video_normal_input'); e.emit(0x60);
    e.label('dos_video_enqueue'); get('dos_video_choice'); put(s.scan);
    set(s.key, 0); set(s.joy, 0); set(s.flags, 0x90); jump('dos_queue_state');
    e.label('dos_video_normal_input');
  }
  set(s.key, 0); set(s.scan, 0); get(s.currentJoy); put(s.joy);
  get(s.candidate); e.emit(0xc9, 255); e.jumpUnless(0xd0, 'dos_mapping_done');
  e.emit(0xaa); e.abs(0xbd, 'dos_scan_table', 'read'); put(s.scan);
  get(s.modifiers); e.emit(0x29, 1); e.branch(0xf0, 'dos_unshifted');
  e.abs(0xbd, 'dos_shift_table', 'read'); put(s.key);
  e.emit(0xe0, 2); e.branch(0xd0, 'dos_shift_not_right'); set(s.scan, 75); jump('dos_cursor_shift');
  e.label('dos_shift_not_right'); e.emit(0xe0, 7); e.branch(0xd0, 'dos_shift_not_down'); set(s.scan, 72);
  e.label('dos_cursor_shift');
  // C64 Shift selects the missing Up/Left keys; it is not PC Shift+keypad.
  get(s.modifiers); e.emit(0x29, 0xfe); put(s.modifiers); jump('dos_key_modifiers');
  e.label('dos_shift_not_down'); e.emit(0xe0, 3); e.branch(0x90, 'dos_key_modifiers');
  e.emit(0xe0, 7); e.branch(0xb0, 'dos_key_modifiers'); e.abs(0xee, s.scan, 'write');
  jump('dos_cursor_shift'); // Shift selects C64 F2/F4/F6/F8, too.
  e.label('dos_unshifted'); e.abs(0xbd, 'dos_key_table', 'read'); put(s.key);
  e.label('dos_key_modifiers');
  get(s.key); e.emit(0xc9, 128); e.branch(0x90, 'dos_key_ascii'); set(s.key, 0);
  e.label('dos_key_ascii'); get(s.modifiers); e.emit(0x29, 2); e.branch(0xf0, 'dos_no_control');
  get(s.key); e.emit(0x09, 32, 0xc9, 97); e.branch(0x90, 'dos_no_control');
  e.emit(0xc9, 123); e.branch(0xb0, 'dos_no_control'); e.emit(0x29, 31); put(s.key);
  e.label('dos_no_control'); get(s.modifiers); e.emit(0x29, 4); e.branch(0xf0, 'dos_mapping_done'); set(s.key, 0);
  e.label('dos_mapping_done');
  // INST/DEL normally remains PC Backspace. With Ctrl+Commodore it becomes
  // the PC/XT keypad Delete scan used by the BIOS warm-reboot chord. Once the
  // chord starts, keep Delete held until INST/DEL itself is released so a
  // modifier release cannot leak a stray Backspace into the rebooted prompt.
  get(s.scan); e.emit(0xc9, 14); e.branch(0xd0, 'dos_reboot_key_done');
  get(s.modifiers); e.emit(0x29, 6, 0xc9, 6); e.branch(0xf0, 'dos_reboot_key');
  get(s.lastKey); e.emit(0xc9, 83); e.branch(0xd0, 'dos_reboot_key_done');
  e.label('dos_reboot_key'); set(s.scan, 83); set(s.key, 0);
  e.label('dos_reboot_key_done'); get(s.modifiers); e.emit(0x09, 0x80); put(s.flags);
  get(s.scan); e.abs(0xcd, s.lastKey, 'read'); e.branch(0xd0, 'dos_new_state');
  get(s.modifiers); e.abs(0xcd, s.lastModifiers, 'read'); e.branch(0xd0, 'dos_new_state');
  get(s.joy); e.abs(0xcd, s.lastJoy, 'read'); e.branch(0xd0, 'dos_new_state');
  // Only printable keys and Backspace repeat. Held cursor and joystick state
  // already remains down in the guest, so it never needs repeated make edges.
  // Do not fill a delayed link with repeat events ahead of physical releases.
  get(s.pending); e.branch(0xd0, 'dos_input_return');
  get('dos_queue_head'); e.abs(0xcd, 'dos_queue_tail', 'read'); e.branch(0xd0, 'dos_input_return');
  get(s.modifiers); e.emit(0x29, 6); e.branch(0xd0, 'dos_input_return');
  get(s.key); e.emit(0xc9, 8); e.branch(0xf0, 'dos_repeatable');
  e.emit(0xc9, 32); e.branch(0x90, 'dos_input_return'); e.emit(0xc9, 127); e.branch(0xb0, 'dos_input_return');
  e.label('dos_repeatable'); get(rasterTicks); e.emit(0x38); e.abs(0xed, s.repeatTick, 'read');
  e.abs(0xcd, s.repeatDelay, 'read'); e.branch(0x90, 'dos_input_return');
  set(s.repeatDelay, 4); get(s.flags); e.emit(0x09, 8); put(s.flags); jump('dos_queue_state');
  e.label('dos_input_return'); e.emit(0x60);
  e.label('dos_new_state');
  set(s.repeatDelay, 20);
  e.label('dos_queue_state');
  get('dos_queue_tail'); e.emit(0xaa, 0x18, 0x69, 1, 0x29, 31);
  e.abs(0xcd, 'dos_queue_head', 'read'); e.branch(0xf0, 'dos_input_return'); put('dos_queue_next');
  for (const [from, to] of [[s.key, 'dos_queue_keys'], [s.scan, 'dos_queue_scans'],
    [s.joy, 'dos_queue_joy'], [s.flags, 'dos_queue_flags']]) { get(from); e.abs(0x9d, to, 'write'); }
  get(s.scan); put(s.lastKey); get(s.modifiers); put(s.lastModifiers); get(s.joy); put(s.lastJoy);
  if (videoSelectors) {
    // Clear only after successful enqueue: a full FIFO must retain a tapped
    // choice. Its immutable foreground payload retains the normal ACK retry.
    get(s.flags); e.emit(0xc9, 0x90); e.branch(0xd0, 'dos_video_queued');
    set('dos_video_choice', 255); set(s.lastKey, 255); e.label('dos_video_queued');
  }
  get(rasterTicks); put(s.repeatTick); get('dos_queue_next'); put('dos_queue_tail'); e.emit(0x60);
  for (const label of ['dos_capture_key', 'dos_capture_scan', 'dos_capture_joy', 'dos_capture_flags',
    'dos_queue_head', 'dos_queue_tail', 'dos_queue_next']) { e.label(label); e.emit(0); }
  if (videoSelectors) { e.label('dos_video_choice'); e.emit(255); e.label('dos_video_held'); e.emit(0); }
  for (const label of ['dos_queue_keys', 'dos_queue_scans', 'dos_queue_joy', 'dos_queue_flags']) {
    e.label(label); e.emit(...Array(32).fill(0));
  }
  e.label('dos_modifier_mask'); e.emit(255, 127, 255, 255, 255, 255, 239, 219);
  e.label('dos_key_table'); e.emit(...keys);
  e.label('dos_shift_table'); e.emit(...shifted);
  e.label('dos_scan_table'); e.emit(...scans);
}

export async function loadVmTerminal(agiRoot, {videoSelectors = false, musicPackets = false} = {}) {
  const filename = path.join(agiRoot, 'host/mpe3-title-terminal.mjs');
  let source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  function replaceOnce(before, after) {
    const index = source.indexOf(before);
    if (index < 0 || source.indexOf(before, index + before.length) >= 0)
      throw new Error('Shared terminal changed: review the DOS background extension');
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  if (musicPackets) replaceOnce('  e.abs(0x20, "apply_sid");\n  e.jumpUnless(0xb0, "error_sid");',
    '  e.abs(0x20, "apply_sid");\n  e.jumpUnless(0xb0, "error_sid");\n' +
    '  e.abs(0xad, stage + 5, "read");e.emit(0x29,1);e.jumpUnless(0xd0,"ack_packet");');
  replaceOnce("import { emitMpe4Keyboard, MPE4_INPUT } from './mpe4-keyboard.mjs';",
    "import { MPE4_INPUT, MPE4_KEYS, MPE4_SHIFT_KEYS, MPE4_SCANS } from './mpe4-keyboard.mjs';\n" +
    `import { emitVideoClient } from '${pathToFileURL(path.join(agiRoot,'host/mpe-video-client.mjs')).href}';\n` +
    `import { emitVmKeyboard, emitDosPacketRecovery, emitDosBackslashCompatibility } from '${import.meta.url}';`);
  for (const label of ['packet_torn', 'packet_crc_mismatch', 'packet_length_mismatch']) {
    const original = `  e.label("${label}");`;
    replaceOnce(original, original + '\n  if (!packetReplay) e.abs(0x20, "dos_request_quiet");');
  }
  replaceOnce('  e.label("reset_wait");',
    '  emitDosPacketRecovery(e, statusRecovery);\n' +
    '  emitDosBackslashCompatibility(e, ZP.recordLow);\n  e.label("reset_wait");');
  replaceOnce('  e.label("bitmap_cell_copy");',
    '  e.abs(0x20, "dos_fix_path_separator");\n' +
    '  e.emit(0xa0, 0x00);\n  e.label("bitmap_cell_copy");');
  replaceOnce('if (gameplay) emitMpe4Keyboard(e, state.rasterTicks, { enable1351Mouse });',
    `if (gameplay) { emitVmKeyboard(e, MPE4_INPUT, MPE4_KEYS, MPE4_SHIFT_KEYS, MPE4_SCANS, state.rasterTicks, ${Boolean(videoSelectors)}, ${musicPackets ? 'state.videoTiming' : 'null'}); emitVideoClient(e,state,stage,"dos_capture_input"); }`);
  replaceOnce('  e.label("dispatch_cells");','  e.label("dispatch_cells");\n  e.abs(0x20,"mpe_video_disable");');
  replaceOnce('  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.rasterTicks, 0x00);',
    '  for(let a=0x02e3;a<=0x02e9;a++)storeImmediate(e,a,0);\n  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.rasterTicks, 0x00);');
  replaceOnce('  e.emit(0xc9, MPE3_TITLE_PULL.packetCell);','  e.emit(0xc9,5);e.jumpUnless(0xd0,"mpe_video_packet");\n  e.emit(0xc9, MPE3_TITLE_PULL.packetCell);');
  replaceOnce('storeImmediate(e, CONTROL.videoTiming, 0x80);','storeImmediate(e, CONTROL.videoTiming, 0x82);');
  replaceOnce('storeImmediate(e, CONTROL.videoTiming, 0x81);','storeImmediate(e, CONTROL.videoTiming, 0x83);');
  replaceOnce('  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.rasterTicks, "write");',
    '  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.rasterTicks, "write");\n' +
    '  if (gameplay) {\n' +
    '    e.emit(0x8a, 0x48, 0x98, 0x48); // TXA/PHA/TYA/PHA\n' +
    '    e.abs(0x20, "mpe_video_border_tick");\n' +
    '    e.abs(0x20, "dos_capture_input");\n' +
    '    e.emit(0x68, 0xa8, 0x68, 0xaa); // PLA/TAY/PLA/TAX\n' +
    '  }');
  // A DOS frame carries the existing SID bytes plus its global VIC colour.
  // The CRC and normal packet validation protect the extra byte as usual.
  replaceOnce("    e.abs(0x20, 'game_ego_validate_sid');",
    '    e.abs(0xad, stage + 6, "read");\n' +
    '    e.emit(0xc9, 27);\n' +
    "    e.branch(0xf0, 'dos_sid_video_valid');\n" +
    "    e.abs(0x20, 'game_ego_validate_sid');\n" +
    "    e.label('dos_sid_video_valid');");
  replaceOnce("    e.emit(0xc9, MPE3_TITLE_PULL.spriteSidPayloadBytes);",
    "    e.emit(0xc9, 27);\n" +
    "    e.branch(0xf0, 'apply_sid_length_ok');\n" +
    "    e.emit(0xc9, MPE3_TITLE_PULL.spriteSidPayloadBytes);");
  replaceOnce('  e.label("sid_copy");',
    '  e.label("sid_copy");\n' +
    '  e.abs(0xad, stage + 6, "read");\n' +
    '  e.emit(0xc9, 27);\n' +
    '  e.branch(0xd0, "dos_background_black");\n' +
    '  e.abs(0xad, stage + 34, "read");\n' +
    '  e.emit(0x29, 15);\n' +
    '  e.abs(0x4c, "dos_background_store");\n' +
    '  e.label("dos_background_black");\n' +
    '  e.emit(0xa9, 0);\n' +
    '  e.label("dos_background_store");\n' +
    '  e.abs(0x8d, 0xd021, "write");');
  // data: modules require absolute imports. Dependencies are the original
  // shared keyboard/sprite generators, including their own relative imports.
  source = source.replace(/from '(\.\/[^']+)'/g,
    (_, relative) => `from '${pathToFileURL(path.resolve(path.dirname(filename), relative)).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
