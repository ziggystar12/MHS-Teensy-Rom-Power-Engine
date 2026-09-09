import { emitMpe4Keyboard, MPE4_INPUT } from './mpe4-keyboard.mjs';
import { emitMpe4EgoSprites, MPE4_EGO_SPRITES } from './mpe4-ego-sprites.mjs';

export const MPE3_TITLE_PULL = Object.freeze({
  protocolVersion: 1,
  helperBank: 58,
  assetRaw: 0x004000,
  runtimeAddress: 0x0810,
  stageAddress: 0x1800,
  dataAddress: 0xdf00,
  dataBytes: 0xf0,
  controlAddress: 0xdff0,
  bankAddress: 0xde00,
  commandStart: 1,
  commandSkip: 2,
  statusError: 0xe0,
  packetCell: 1,
  packetSid: 2,
  packetEnd: 3,
  packetEgoSprites: MPE4_EGO_SPRITES.packetType,
  packetError: 0x0e,
  cellFlagBase: 0x01,
  cellFlagBaseComplete: 0x02,
  cellFlagHires: 0x04,
  cellFlagModeValid: 0x08,
  cellFlagReplace: 0x10,
  frameFlagParserSplit: 0x40,
  maximumPayloadBytes: 228,
  maximumCrcRereads: 3,
  cellRecordBytes: 12,
  sidPayloadBytes: 26,
  spriteSidPayloadBytes: MPE4_EGO_SPRITES.sidPayloadBytes
});

export const MPE3_TITLE_TERMINAL_STATE = Object.freeze({
  rasterTicks: 0x02a0,
  consumedTicks: 0x02a1,
  waitLow: 0x02a2,
  waitHigh: 0x02a3,
  waitBlocks: 0x02a4,
  startupStage: 0x02a5,
  error: 0x02a6,
  packetsLow: 0x02a7,
  packetsHigh: 0x02a8,
  baseReady: 0x02a9,
  retries: 0x02aa,
  inputArmed: 0x02ab,
  skipSent: 0x02ac,
  skipInput: 0x02ad,
  keyboardBaseline: 0x02ae,
  transitionHidden: 0x02af,
  controlSnapshot: 0x02b0,
  frameMode: 0x02d3,
  parserSplit: 0x02d4,
  parserPhase: 0x02d5,
  videoTiming: 0x02d6
});

export const MPE3_TITLE_DIAGNOSTIC = Object.freeze({
  screen: 0x0400,
  stage: 0x0400 + 2 * 40 + 6,
  error: 0x0400 + 2 * 40 + 17,
  packets: 0x0400 + 2 * 40 + 32,
  message: 0x0400 + 5 * 40,
  control: [0x0400 + 10 * 40, 0x0400 + 12 * 40],
  // Four complete 65536-poll blocks. CPU progress, never an unenabled IRQ,
  // bounds packet/torn-copy and raster waits. This is not a wall-clock timer.
  waitBlocks: 4,
  baseColor: 0x4000
});

const ERRORS = Object.freeze({
  io2: [1, "IO2 RAM READBACK FAILED"],
  timeout: [2, "NO PACKET - SERVICE OR LINK STALLED"],
  firmware: [3, "FIRMWARE ERROR - SEE CTRL FB"],
  length: [4, "INVALID PACKET LENGTH"],
  header: [5, "INVALID PACKET HEADER"],
  crc: [6, "PACKET CRC MISMATCH"],
  cells: [7, "INVALID CELL RECORD"],
  sid: [8, "INVALID SID RECORD"],
  order: [9, "SID OR END BEFORE BASE IMAGE"],
  clock: [10, "VIDEO INTERRUPT DID NOT ARRIVE"],
  type: [11, "UNKNOWN PACKET TYPE"],
  unstable: [12, "UNSTABLE PACKET COMMIT"]
});

const CONTROL = Object.freeze({
  magic0: 0xdff0,
  magic1: 0xdff1,
  magic2: 0xdff2,
  magic3: 0xdff3,
  command: 0xdff4,
  status: 0xdff5,
  ack: 0xdff6,
  commit: 0xdff7,
  raw0: 0xdff8,
  raw1: 0xdff9,
  raw2: 0xdffa,
  error: 0xdffb,
  videoTiming: 0xdffb
});

const ZP = Object.freeze({
  recordLow: 0xf0,
  recordHigh: 0xf1,
  destinationLow: 0xf2,
  destinationHigh: 0xf3,
  cellLow: 0xf4,
  cellHigh: 0xf5,
  crcLow: 0xf6,
  crcHigh: 0xf7,
  crcLength: 0xf8,
  remaining: 0xf9,
  commit: 0xfa
});

class Emitter6502 {
  constructor(start) {
    this.start = start;
    this.data = [];
    this.labels = new Map();
    this.absoluteFixups = [];
    this.byteFixups = [];
    this.relativeFixups = [];
    this.accesses = [];
    this.unique = 0;
  }

  address() { return this.start + this.data.length; }

  emit(...values) {
    for (const value of values) {
      if (!Number.isInteger(value) || value < 0 || value > 0xff) {
        throw new RangeError(`Invalid 6502 byte ${value}`);
      }
      this.data.push(value);
    }
  }

  label(name) {
    if (this.labels.has(name)) throw new Error(`Duplicate 6502 label ${name}`);
    this.labels.set(name, this.address());
  }

  abs(opcode, target, access = null) {
    const instructionAddress = this.address();
    this.emit(opcode);
    if (typeof target === "string") {
      this.absoluteFixups.push({ offset: this.data.length, target });
      this.emit(0, 0);
    } else {
      this.emit(target & 0xff, target >>> 8);
    }
    if (access) this.accesses.push(Object.freeze({ access, address: target, instructionAddress }));
  }

  branch(opcode, target) {
    this.emit(opcode, 0);
    this.relativeFixups.push({ offset: this.data.length - 1, next: this.address(), target });
  }

  immediateAddress(opcode, target, shift) {
    this.emit(opcode, 0);
    this.byteFixups.push({ offset: this.data.length - 1, target, shift });
  }

  jumpUnless(inverseOpcode, target) {
    const skip = `condition_ok_${this.unique++}`;
    this.branch(inverseOpcode, skip);
    this.abs(0x4c, target);
    this.label(skip);
  }

  finish() {
    for (const fixup of this.absoluteFixups) {
      const target = this.labels.get(fixup.target);
      if (target == null) throw new Error(`Unknown 6502 label ${fixup.target}`);
      this.data[fixup.offset] = target & 0xff;
      this.data[fixup.offset + 1] = target >>> 8;
    }
    for (const fixup of this.relativeFixups) {
      const target = this.labels.get(fixup.target);
      if (target == null) throw new Error(`Unknown 6502 label ${fixup.target}`);
      const delta = target - fixup.next;
      if (delta < -128 || delta > 127) {
        throw new Error(`6502 branch to ${fixup.target} is out of range (${delta})`);
      }
      this.data[fixup.offset] = delta & 0xff;
    }
    for (const fixup of this.byteFixups) {
      const target = this.labels.get(fixup.target);
      if (target == null) throw new Error(`Unknown 6502 label ${fixup.target}`);
      this.data[fixup.offset] = (target >>> fixup.shift) & 0xff;
    }
    return Object.freeze({
      bytes: Buffer.from(this.data),
      labels: Object.freeze(Object.fromEntries(this.labels)),
      accesses: Object.freeze(this.accesses)
    });
  }
}

function storeImmediate(e, address, value) {
  e.emit(0xa9, value);
  e.abs(0x8d, address, "write");
}

function setStage(e, value) {
  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.startupStage, value);
  storeImmediate(e, MPE3_TITLE_DIAGNOSTIC.stage + 1, 0x30 + value);
  storeImmediate(e, 0xd020, value);
}

function pointer(e, low, address) {
  storeImmediate(e, low, address & 0xff);
  storeImmediate(e, low + 1, address >>> 8);
}

function screenCodes(text) {
  return [...text.padEnd(40)].map((character) => character.charCodeAt(0) & 0x3f);
}

function advanceRecord(e, amount) {
  const noCarry = `record_no_carry_${e.unique++}`;
  e.emit(0x18, 0xa5, ZP.recordLow, 0x69, amount, 0x85, ZP.recordLow);
  e.branch(0x90, noCarry);
  e.emit(0xe6, ZP.recordHigh);
  e.label(noCarry);
}

function copyCrcByte(e, stage) {
  e.abs(0xb9, MPE3_TITLE_PULL.dataAddress, "read");
  e.abs(0x99, stage, "write");
  e.emit(0x45, ZP.crcHigh, 0xaa, 0xa5, ZP.crcLow);
  e.abs(0x5d, "crc_table_high", "read");
  e.emit(0x85, ZP.crcHigh);
  e.abs(0xbd, "crc_table_low", "read");
  e.emit(0x85, ZP.crcLow, 0xc8);
}

function crcTable() {
  return Array.from({ length: 256 }, (_, byte) => {
    let value = byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      value = ((value << 1) ^ ((value & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
    return value;
  });
}

export const MPE3_TITLE_GENERIC_DIAGNOSTIC_TITLE = "MHS POWER ENGINE - NATIVE LAUNCH DIAG";
export const MPE3_TITLE_GENERIC_DIAGNOSTIC_FOOTER = "SPACE / RETURN / JOYSTICK FIRE: SKIP";

function normalizeDiagnosticText(value, label) {
  if (typeof value !== "string" || !/^[\x20-\x5f]{1,40}$/.test(value)) {
    throw new RangeError(`MPE3 diagnostic ${label} must contain 1 to 40 printable C64 uppercase characters`);
  }
  return value;
}

function emitPacketReplay(e, stage) {
  const get=a=>e.abs(0xad,a,'read'),put=a=>e.abs(0x8d,a,'write');
  e.label('packet_replay_request');get('packet_replay_budget');
  e.branch(0xd0,'packet_replay_attempt');e.emit(0x18,0x60);
  e.label('packet_replay_attempt');e.abs(0xce,'packet_replay_budget','write');
  e.emit(0xa9,1);put('packet_replay_active');e.emit(0xa9,0);put(0x02f0);
  e.abs(0x20,'reset_wait');e.emit(0xa9,6);put(0xdff4);e.emit(0xa2,0);
  e.label('packet_replay_wait');get(0x02f0);e.emit(0xc9,0xa5);e.branch(0xf0,'packet_replay_ready');
  e.emit(0xca);e.branch(0xd0,'packet_replay_wait_tick');
  // Idempotently resend a lost request; completion is read from local RAM,
  // not the IO2 bus which triggered recovery. The ready byte is DMAed last.
  e.emit(0xa9,6);put(0xdff4);
  e.label('packet_replay_wait_tick');e.abs(0x20,'tick_wait');e.jumpUnless(0xb0,'error_unstable');
  e.abs(0x4c,'packet_replay_wait');
  e.label('packet_replay_ready');e.emit(0x38,0x60);
  e.label('packet_crc_staged');get(stage+6);e.emit(0xc9,229);e.jumpUnless(0x90,'packet_length_mismatch');
  e.emit(0x18,0x69,8,0x85,ZP.crcLength,0xa9,0xff,0x85,ZP.crcLow,0x85,ZP.crcHigh,0xa0,0);
  e.label('packet_crc_staged_byte');e.abs(0xb9,stage,'read');
  e.emit(0x45,ZP.crcHigh,0xaa,0xa5,ZP.crcLow);e.abs(0x5d,'crc_table_high','read');
  e.emit(0x85,ZP.crcHigh);e.abs(0xbd,'crc_table_low','read');e.emit(0x85,ZP.crcLow,0xc8,0xc4,ZP.crcLength);
  e.branch(0xd0,'packet_crc_staged_byte');e.abs(0x4c,'packet_crc_validate');
  e.label('packet_replay_active');e.emit(0);e.label('packet_replay_budget');e.emit(0);
}

// Only called after a suspect status read. The normal packet/CRC path is
// unchanged; no ACK, display reset or packet publication happens here.
function emitStatusRecovery(e) {
  const get = a => e.abs(0xad, a, 'read');
  const put = a => e.abs(0x8d, a, 'write');
  e.label('status_read_recover');
  put('status_last_bad');
  storeImmediate(e, 'status_error_streak', 0);
  e.emit(0xa2, 32); // Independent, bounded budget; never reset packet deadlines.
  e.label('status_retry');
  // Space samples in CPU cycles, including before the raster IRQ is enabled.
  e.emit(0xa0, 8);
  e.label('status_settle');e.emit(0x88);e.branch(0xd0, 'status_settle');
  get(CONTROL.status);put('trigger_status');
  e.emit(0xc9, 0);e.branch(0xf0, 'status_recovered');
  e.emit(0xc9, 2);e.branch(0xf0, 'status_recovered');
  e.emit(0xc9, 0x12);e.branch(0xf0, 'status_recovered');
  // The host publishes exactly E0, with FB written first. E1..FF are not
  // firmware failures. Confirm three E0/nonzero-FB pairs with the same code.
  e.emit(0xc9, 0xe0);e.branch(0xd0, 'status_unconfirmed');
  get(CONTROL.error);e.branch(0xf0, 'status_unconfirmed');
  // 80..83 are the startup video timing markers, not Doom failure codes.
  // A burst of false E0s with unchanged FB must not become a fake failure.
  // If this ambiguous state persists it still stops at the bounded deadline.
  e.emit(0xc9, 0x80);e.branch(0x90, 'status_error_candidate');
  e.emit(0xc9, 0x84);e.branch(0x90, 'status_unconfirmed');
  e.label('status_error_candidate');
  e.abs(0xcd, 'status_error_code', 'read');e.branch(0xd0, 'status_new_error');
  e.abs(0xee, 'status_error_streak', 'write');
  get('status_error_streak');e.emit(0xc9, 3);e.branch(0x90, 'status_retry_next');
  storeImmediate(e, 'status_error_confirmed', 1);
  e.abs(0x4c, 'error_firmware');
  e.label('status_new_error');put('status_error_code');
  storeImmediate(e, 'status_error_streak', 1);
  e.abs(0x4c, 'status_retry_next');
  e.label('status_unconfirmed');storeImmediate(e, 'status_error_streak', 0);
  e.label('status_retry_next');e.emit(0xca);e.branch(0xd0, 'status_retry');
  e.abs(0x4c, 'error_status');
  e.label('status_recovered');
  e.emit(0x48); // Return the valid status to callers (including quiet wait).
  get('status_recoveries_high');e.emit(0xc9, 0xff);e.branch(0xd0, 'status_count');
  get('status_recoveries_low');e.emit(0xc9, 0xff);e.branch(0xf0, 'status_return');
  e.label('status_count');e.abs(0xee, 'status_recoveries_low', 'write');
  e.branch(0xd0, 'status_return');e.abs(0xee, 'status_recoveries_high', 'write');
  e.label('status_return');e.emit(0x68, 0x60);
  for (const name of ['status_error_streak', 'status_error_code', 'status_error_confirmed',
    'status_recoveries_low', 'status_recoveries_high', 'status_last_bad']) {
    e.label(name);e.emit(0);
  }
}

function buildProgram({ assetRaw, gameplay, enable1351Mouse, publishVideoTiming, packetReplay, statusRecovery, stageAddress, diagnosticTitle, diagnosticFooter }) {
  const e = new Emitter6502(MPE3_TITLE_PULL.runtimeAddress);
  const stage = stageAddress;
  const state = MPE3_TITLE_TERMINAL_STATE;
  const diag = MPE3_TITLE_DIAGNOSTIC;
  const errors = statusRecovery ? {...ERRORS, status: [13, 'STATUS READ DID NOT RECOVER']} : ERRORS;

  e.label("entry");
  e.emit(0x78, 0xd8); // SEI / CLD
  // Save the KERNAL video-standard byte before this terminal reuses $02a6
  // for its own error state. Zero is NTSC and nonzero is PAL.
  if (publishVideoTiming) {
    e.abs(0xad, 0x02a6, "read");
    e.abs(0x8d, state.videoTiming, "write");
  }
  // Establish the 6510 port directions explicitly, even after a non-KERNAL
  // launcher. Keep I/O decoded while banking out BASIC/KERNAL.
  storeImmediate(e, 0x0000, 0x2f);
  storeImmediate(e, 0x0001, 0x35);
  storeImmediate(e, 0xdc0d, 0x7f);
  storeImmediate(e, 0xdd0d, 0x7f);
  e.abs(0xad, 0xdc0d, "read");
  e.abs(0xad, 0xdd0d, "read");
  storeImmediate(e, 0xd01a, 0x00);
  storeImmediate(e, 0xd019, 0x0f);
  storeImmediate(e, 0xd015, 0x00);
  storeImmediate(e, 0x0001, 0x35); // local RAM IRQ vectors, I/O visible
  for (const [address, label, shift] of [
    [0xfffe, "raster_irq", 0], [0xffff, "raster_irq", 8],
    [0xfffa, "quiet_nmi", 0], [0xfffb, "quiet_nmi", 8]
  ]) {
    e.immediateAddress(0xa9, label, shift);
    e.abs(0x8d, address, "write");
  }
  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.rasterTicks, 0x00);
  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.consumedTicks, 0x00);
  if (statusRecovery) for (const name of ['status_error_streak', 'status_error_code',
    'status_error_confirmed', 'status_recoveries_low', 'status_recoveries_high', 'status_last_bad']) {
    storeImmediate(e, name, 0);
  }
  for (const address of [MPE3_TITLE_TERMINAL_STATE.error,
    MPE3_TITLE_TERMINAL_STATE.packetsLow, MPE3_TITLE_TERMINAL_STATE.packetsHigh,
    MPE3_TITLE_TERMINAL_STATE.baseReady, state.inputArmed, state.skipSent,
    state.skipInput, state.transitionHidden]) storeImmediate(e, address, 0);
  if (gameplay) {
    storeImmediate(e, state.frameMode, 0x18);
    storeImmediate(e, state.parserSplit, 0);
    storeImmediate(e, state.parserPhase, 0);
  }
  e.emit(0xa9, 0, 0xa2, 7);
  e.label("clear_packet_header");
  e.abs(0x9d, stage, "write");
  e.emit(0xca);
  e.branch(0x10, "clear_packet_header");
  storeImmediate(e, 0xd012, 0xfa);
  e.abs(0x20, "clear_sid");
  if (gameplay) e.abs(0x20, 'game_ego_init');
  e.abs(0x20, "clear_video");
  e.abs(0x20, "diagnostic_screen");
  setStage(e, 1);

  // Bank 58 is ordinary EasyFlash IO2 RAM. The start command is written last,
  // after the complete identity and 24-bit raw asset root are stable.
  storeImmediate(e, MPE3_TITLE_PULL.bankAddress, MPE3_TITLE_PULL.helperBank);
  setStage(e, 2);
  // Probe ordinary IO2 RAM before arming the service. Two complementary
  // values catch absent/constant bus reads without activating legacy MPE2.
  for (const value of [0xa5, 0x5a]) {
    storeImmediate(e, 0xdfff, value);
    e.abs(0xad, 0xdfff, "read");
    e.emit(0xc9, value);
    e.jumpUnless(0xf0, "error_io2");
  }
  storeImmediate(e, 0xdfff, 0);
  storeImmediate(e, CONTROL.command, 0x00);
  storeImmediate(e, CONTROL.status, 0x00);
  storeImmediate(e, CONTROL.error, 0x00);
  storeImmediate(e, CONTROL.ack, 0x00);
  storeImmediate(e, CONTROL.commit, 0x00);
  for (const [offset, byte] of [...Buffer.from("M3TP", "ascii")].entries()) {
    storeImmediate(e, CONTROL.magic0 + offset, byte);
  }
  storeImmediate(e, CONTROL.raw0, assetRaw & 0xff);
  storeImmediate(e, CONTROL.raw1, (assetRaw >>> 8) & 0xff);
  storeImmediate(e, CONTROL.raw2, (assetRaw >>> 16) & 0xff);
  // A valid marker makes old clients fail safely to packet video. KERNAL
  // $02a6 is zero on NTSC and nonzero on PAL; DMA write timing differs.
  if (publishVideoTiming) {
    storeImmediate(e, CONTROL.videoTiming, 0x80);
    e.abs(0xad, state.videoTiming, "read");
    e.branch(0xd0, "video_timing_ready");
    storeImmediate(e, CONTROL.videoTiming, 0x81);
    e.label("video_timing_ready");
  }
  setStage(e, 3);
  storeImmediate(e, CONTROL.command, MPE3_TITLE_PULL.commandStart);

  if (gameplay) storeImmediate(e, MPE4_INPUT.active, 0);
  e.label("packet_begin_wait");
  e.abs(0x20, "sample_skip_input");
  e.abs(0x20, "reset_wait");
  e.label("packet_wait");
  e.abs(0xad, CONTROL.status, "read");
  e.abs(0x8d, "trigger_status", "write"); // exact sampled status, before any later IO2 reads
  e.emit(0xc9, MPE3_TITLE_PULL.statusError);
  if (statusRecovery) {
    e.branch(0x90, 'packet_status_ok');
    e.abs(0x20, 'status_read_recover');
    e.label('packet_status_ok');
  } else e.jumpUnless(0x90, "error_firmware");
  e.abs(0xad, CONTROL.commit, "read");
  e.branch(0xf0, "packet_idle");
  e.abs(0xcd, CONTROL.ack, "read");
  e.branch(0xd0, "packet_available");
  e.label("packet_idle");
  e.abs(0x20, "tick_wait");
  e.jumpUnless(0xb0, "error_timeout");
  e.abs(0x4c, "packet_wait");
  e.label("packet_torn");
  if (packetReplay) {e.abs(0x20,'packet_replay_request');e.jumpUnless(0xb0,'error_unstable');e.abs(0x4c,'packet_copy_retry');}
  e.abs(0xce, state.retries, "write");
  e.jumpUnless(0xd0, "error_unstable");
  e.abs(0x4c, "packet_wait");
  e.label("packet_crc_mismatch");
  if (packetReplay) {e.abs(0x20,'packet_replay_request');e.jumpUnless(0xb0,'error_crc');e.abs(0x4c,'packet_copy_retry');}
  // A transient IO2 read must not publish or ACK a corrupt staged copy.
  // Only reread the same pending commit, at most three more times. Changed
  // commits keep the existing independently bounded torn-copy handling.
  e.abs(0xad, CONTROL.commit, "read");
  e.emit(0xc5, ZP.commit);
  e.jumpUnless(0xf0, "packet_torn");
  e.emit(0xa5, ZP.remaining);
  e.jumpUnless(0xd0, "error_crc");
  e.emit(0xc6, ZP.remaining);
  e.abs(0x4c, "packet_copy_retry");
  e.label("packet_length_mismatch");
  if (packetReplay) {e.abs(0x20,'packet_replay_request');e.jumpUnless(0xb0,'error_length');e.abs(0x4c,'packet_copy_retry');}
  // A corrupted length cannot authorize a payload read outside the mailbox.
  // Reread the bounded header with the same budget as a CRC failure.
  e.abs(0xad, CONTROL.commit, "read");
  e.emit(0xc5, ZP.commit);
  e.jumpUnless(0xf0, "packet_torn");
  e.emit(0xa5, ZP.remaining);
  e.jumpUnless(0xd0, "error_length");
  e.emit(0xc6, ZP.remaining);
  e.abs(0x4c, "packet_copy_retry");
  e.label("packet_available");
  e.emit(0x85, ZP.commit);
  if (packetReplay) {
    storeImmediate(e,'packet_replay_active',0);storeImmediate(e,'packet_replay_budget',3);
  }
  // This scratch byte becomes the CELL byte count only after CRC validation.
  e.emit(0xa9, MPE3_TITLE_PULL.maximumCrcRereads, 0x85, ZP.remaining);

  // Read only the bounded packet, calculating table-based CRC while copying.
  // A SID tick is 36 bytes, not an unconditional 240-byte page traversal.
  e.label("packet_copy_retry");
  if (packetReplay) {e.abs(0xad,'packet_replay_active','read');e.jumpUnless(0xf0,'packet_crc_staged');}
  e.emit(0xa9, 0xff, 0x85, ZP.crcLow, 0x85, ZP.crcHigh, 0xa0, 0x00);
  e.label("packet_copy_header");
  copyCrcByte(e, stage);
  e.emit(0xc0, 0x08);
  e.branch(0xd0, "packet_copy_header");
  e.abs(0xad, stage + 6, "read");
  e.emit(0xc9, MPE3_TITLE_PULL.maximumPayloadBytes + 1);
  e.jumpUnless(0x90, "packet_length_mismatch");
  e.emit(0x18, 0x69, 0x08, 0x85, ZP.crcLength, 0xc4, ZP.crcLength);
  e.branch(0xf0, "packet_copy_crc");
  e.label("packet_copy_payload");
  copyCrcByte(e, stage);
  e.emit(0xc4, ZP.crcLength);
  e.branch(0xd0, "packet_copy_payload");
  e.label("packet_copy_crc");
  e.abs(0xb9, MPE3_TITLE_PULL.dataAddress, "read");
  e.abs(0x99, stage, "write");
  e.emit(0xc8);
  e.abs(0xb9, MPE3_TITLE_PULL.dataAddress, "read");
  e.abs(0x99, stage, "write");
  e.abs(0xad, CONTROL.commit, "read");
  e.emit(0xc5, ZP.commit);
  e.jumpUnless(0xf0, "packet_torn");
  // Header bytes cross the same IO2 bus as the payload. Check the complete
  // copy's CRC before interpreting its magic, version or sequence so a single
  // transient header read gets the same bounded recovery as a payload read.
  e.label('packet_crc_validate');
  e.emit(0xa4, ZP.crcLength);
  e.abs(0xb9, stage, "read");
  e.emit(0xc5, ZP.crcLow);
  e.jumpUnless(0xf0, "packet_crc_mismatch");
  e.emit(0xc8);
  e.abs(0xb9, stage, "read");
  e.emit(0xc5, ZP.crcHigh);
  e.jumpUnless(0xf0, "packet_crc_mismatch");
  if (packetReplay) {
    // Host holds this packet until ACK. Trust only the CRC-validated RAM
    // sequence after a replay, not a second possibly corrupt IO2 commit read.
    e.abs(0xad,'packet_replay_active','read');e.branch(0xf0,'packet_check_bus_commit');
    e.abs(0xad,stage+4,'read');e.jumpUnless(0xd0,'error_header');e.emit(0x85,ZP.commit);
    e.abs(0x4c,'packet_validate_identity');e.label('packet_check_bus_commit');
  }
  e.abs(0xad, CONTROL.commit, "read");
  e.emit(0xc5, ZP.commit);
  e.jumpUnless(0xf0, "packet_torn");
  e.abs(0xad, stage + 4, "read");
  e.emit(0xc5, ZP.commit);
  e.jumpUnless(0xf0, "packet_torn");
  e.label('packet_validate_identity');
  e.abs(0xad, stage + 0, "read");
  e.emit(0xc9, 0x4d);
  e.jumpUnless(0xf0, "error_header");
  e.abs(0xad, stage + 1, "read");
  e.emit(0xc9, 0x33);
  e.jumpUnless(0xf0, "error_header");
  e.abs(0xad, stage + 2, "read");
  e.emit(0xc9, MPE3_TITLE_PULL.protocolVersion);
  e.jumpUnless(0xf0, "error_header");

  e.abs(0xad, stage + 3, "read");
  e.emit(0xc9, MPE3_TITLE_PULL.packetCell);
  e.branch(0xf0, "dispatch_cells");
  e.emit(0xc9, MPE3_TITLE_PULL.packetSid);
  e.jumpUnless(0xd0, "dispatch_sid");
  e.emit(0xc9, MPE3_TITLE_PULL.packetEnd);
  e.jumpUnless(0xd0, "dispatch_end");
  if (gameplay) {
    e.emit(0xc9, MPE3_TITLE_PULL.packetEgoSprites);
    e.jumpUnless(0xd0, 'dispatch_ego_sprites');
  }
  e.abs(0x4c, "error_type");

  if (gameplay) {
    e.label('dispatch_ego_sprites');
    e.abs(0xad, state.baseReady, 'read');e.jumpUnless(0xd0, 'error_order');
    e.abs(0x20, 'game_ego_receive');e.jumpUnless(0xb0, 'error_sid');
    e.abs(0x4c, 'ack_packet');
  }

  e.label("dispatch_cells");
  e.abs(0xad, MPE3_TITLE_TERMINAL_STATE.baseReady, "read");
  e.branch(0xd0, "cells_ready");
  setStage(e, 4);
  e.label("cells_ready");
  e.abs(0x20, "validate_cells");
  e.jumpUnless(0xb0, "error_cells");
  e.abs(0x20, "prepare_cell_display");
  e.abs(0x20, "apply_cells");
  e.jumpUnless(0xb0, "error_cells");
  e.abs(0xad, MPE3_TITLE_TERMINAL_STATE.baseReady, "read");
  e.jumpUnless(0xf0, "ack_packet");
  e.abs(0xad, stage + 5, "read");
  e.emit(0x29, 0x02);
  e.jumpUnless(0xd0, "ack_packet");
  setStage(e, 5);
  // Base color stays in private RAM until now, keeping the diagnostic text
  // legible throughout bootstrap. Patch only the immediate color-page add;
  // steady-state cells use the original straight-line color publication.
  e.emit(0xa2, 0);
  e.label("publish_base_color");
  for (let page = 0; page < 4; page++) {
    e.abs(0xbd, MPE3_TITLE_DIAGNOSTIC.baseColor + page * 256, "read");
    e.abs(0x9d, 0xd800 + page * 256, "write");
  }
  e.emit(0xe8);
  e.branch(0xd0, "publish_base_color");
  storeImmediate(e, MPE3_TITLE_TERMINAL_STATE.baseReady, 1);
  e.emit(0xa9, 0xd8);
  e.abs(0x8d, "color_destination_page", "write");
  e.abs(0xad, 0xdd00, "read");
  e.emit(0x29, 0xfc, 0x09, 0x02);
  e.abs(0x8d, 0xdd00, "write");
  storeImmediate(e, 0xd018, 0x78);
  if (gameplay) e.abs(0x20, "publish_display_policy");
  else {
    e.abs(0x20, "packet_display_mode");
    e.abs(0x8d, 0xd016, "write");
  }
  storeImmediate(e, 0xd011, 0x3b);
  storeImmediate(e, 0xd020, 0x00);
  storeImmediate(e, 0xd019, 0x01);
  storeImmediate(e, 0xd01a, 0x01);
  e.emit(0x58); // CLI: the IRQ only counts real video frames
  e.abs(0x4c, "ack_packet");

  e.label("dispatch_sid");
  e.abs(0xad, MPE3_TITLE_TERMINAL_STATE.baseReady, "read");
  e.jumpUnless(0xd0, "error_order");
  if (gameplay) {
    // Only a validated gameplay frame activates the full keyboard. A held
    // intro skip must be released before it can become a game input event.
    e.abs(0x20, 'game_ego_validate_sid');
    e.jumpUnless(0xb0, "error_sid");
    e.abs(0xad, stage + 5, "read");
    e.emit(0x29, 0x20);
    e.branch(0xf0, "game_input_activation_done");
    e.abs(0xad, MPE4_INPUT.active, "read");
    e.branch(0xd0, "game_input_activation_done");
    e.abs(0x20, "game_input_init");
    storeImmediate(e, state.skipSent, 0);
    storeImmediate(e, state.skipInput, 0);
    e.label("game_input_activation_done");
  }
  // Validate the complete frame-end publication before making a replacement
  // visible. Incremental animation keeps its original direct cell path.
  e.abs(0x20, "apply_sid");
  e.jumpUnless(0xb0, "error_sid");
  if (gameplay) {
    e.abs(0xad, stage + 6, 'read');e.emit(0xc9, MPE3_TITLE_PULL.spriteSidPayloadBytes);
    e.branch(0xd0, 'legacy_frame_publication');
    // Replace the existing post-ACK frame wait, never add a second one.
    e.abs(0x20, 'wait_fresh_border');e.abs(0x4c, 'publish_frame_mode');
    e.label('legacy_frame_publication');
  }
  e.abs(0xad, state.transitionHidden, "read");
  e.branch(0xf0, "publish_frame_mode");
  e.abs(0x20, "wait_fresh_border");
  e.label("publish_frame_mode");
  if (gameplay) {
    e.abs(0x20, "publish_display_policy");
    e.abs(0x20, 'game_ego_commit');
  }
  else {
    e.abs(0x20, "packet_display_mode");
    e.abs(0x8d, 0xd016, "write");
  }
  e.abs(0xad, state.transitionHidden, "read");
  e.branch(0xf0, "frame_visible");
  storeImmediate(e, state.transitionHidden, 0);
  storeImmediate(e, 0xd011, 0x3b);
  e.label("frame_visible");
  e.abs(0x20, "ack_current");
  if (gameplay) {
    e.abs(0xad, stage + 6, 'read');e.emit(0xc9, MPE3_TITLE_PULL.spriteSidPayloadBytes);
    e.jumpUnless(0xd0, 'packet_begin_wait');
  }
  e.abs(0x20, "wait_frame");
  e.abs(0x4c, "packet_begin_wait");

  e.label("dispatch_end");
  e.abs(0xad, MPE3_TITLE_TERMINAL_STATE.baseReady, "read");
  e.jumpUnless(0xd0, "error_order");
  e.abs(0xad, state.transitionHidden, "read");
  e.jumpUnless(0xf0, "error_order");
  e.abs(0x20, "ack_current");
  e.label("finished");
  e.abs(0x4c, "finished");

  e.label("ack_packet");
  e.abs(0x20, "ack_current");
  e.abs(0x4c, "packet_begin_wait");

  e.label("ack_current");
  e.emit(0xa5, ZP.commit);
  e.abs(0x8d, CONTROL.ack, "write");
  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.packetsLow, "write");
  e.branch(0xd0, "ack_counted");
  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.packetsHigh, "write");
  e.label("ack_counted");
  e.emit(0x60);

  e.label("validate_cells");
  e.abs(0xad, stage + 6, "read");
  e.emit(0x85, ZP.remaining);
  e.branch(0xf0, "validate_cells_ok");
  e.emit(0xa9, (stage + 8) & 0xff, 0x85, ZP.recordLow,
    0xa9, (stage + 8) >>> 8, 0x85, ZP.recordHigh);
  e.label("validate_cell_loop");
  e.emit(0xa5, ZP.remaining, 0xc9, MPE3_TITLE_PULL.cellRecordBytes);
  e.branch(0x90, "validate_cells_bad");
  e.emit(0x38, 0xe9, MPE3_TITLE_PULL.cellRecordBytes, 0x85, ZP.remaining,
    0xa0, 0x01, 0xb1, ZP.recordLow, 0xc9, 0x03);
  e.branch(0x90, "validate_cell_index_ok");
  e.branch(0xd0, "validate_cells_bad");
  e.emit(0xa0, 0x00, 0xb1, ZP.recordLow, 0xc9, 0xe8);
  e.branch(0xb0, "validate_cells_bad");
  e.label("validate_cell_index_ok");
  advanceRecord(e, MPE3_TITLE_PULL.cellRecordBytes);
  e.emit(0xa5, ZP.remaining);
  e.branch(0xd0, "validate_cell_loop");
  e.label("validate_cells_ok");
  e.emit(0x38, 0x60);
  e.label("validate_cells_bad");
  e.emit(0x18, 0x60);

  // CELL mode metadata arrives before any pixels. A complete replacement or
  // mode change hides the old display, then waits for the next bottom-border
  // IRQ before modifying its planes. Clearing DEN alone in an active scanline
  // is insufficient: the VIC can retain its display state until the border.
  // Legacy CELL packets without bit 3 preserve their established behavior.
  e.label("prepare_cell_display");
  e.abs(0xad, state.baseReady, "read");
  e.branch(0xf0, "cell_display_ready");
  e.abs(0xad, state.transitionHidden, "read");
  e.branch(0xd0, "cell_display_ready");
  e.abs(0xad, stage + 5, "read");
  e.emit(0x29, MPE3_TITLE_PULL.cellFlagModeValid);
  e.branch(0xf0, "cell_display_ready");
  e.abs(0xad, stage + 5, "read");
  e.emit(0x29, MPE3_TITLE_PULL.cellFlagReplace);
  e.branch(0xd0, "hide_replacement");
  e.abs(0x20, "packet_display_mode");
  e.abs(0x4d, gameplay ? state.frameMode : 0xd016, "read");
  e.emit(0x29, 0x10); // Ignore VIC unused read bits; compare MCM only.
  if (gameplay) {
    e.branch(0xd0, "hide_replacement");
    e.abs(0x20, "packet_parser_split");
    e.abs(0xcd, state.parserSplit, "read");
  }
  e.branch(0xf0, "cell_display_ready");
  e.label("hide_replacement");
  storeImmediate(e, state.transitionHidden, 1);
  if (gameplay) e.abs(0x20, "game_ego_hide");
  storeImmediate(e, 0xd011, 0x2b);
  e.abs(0x20, "wait_fresh_border");
  e.label("cell_display_ready");
  e.emit(0x60);

  e.label("packet_display_mode");
  e.abs(0xad, stage + 5, "read");
  e.emit(0x29, MPE3_TITLE_PULL.cellFlagHires);
  e.branch(0xf0, "packet_multicolor");
  e.emit(0xa9, 0x08, 0x60);
  e.label("packet_multicolor");
  e.emit(0xa9, 0x18, 0x60);

  if (gameplay) {
    e.label("packet_parser_split");
    e.abs(0xad, stage + 5, "read");
    e.emit(0x29, MPE3_TITLE_PULL.cellFlagHires);
    e.branch(0xf0, "packet_parser_graphics");
    e.emit(0xa9, 0, 0x60); // Full-screen hires always takes precedence.
    e.label("packet_parser_graphics");
    e.abs(0xad, stage + 5, "read");
    e.emit(0x29, MPE3_TITLE_PULL.frameFlagParserSplit, 0x60);

    e.label("publish_display_policy");
    e.emit(0x08, 0x78); // PHP/SEI: IRQ must see a complete frame policy.
    e.abs(0x20, "packet_display_mode");
    e.abs(0x8d, state.frameMode, "write");
    e.abs(0x20, "packet_parser_split");
    e.abs(0xcd, state.parserSplit, "read");
    e.branch(0xf0, "display_policy_unchanged");
    e.abs(0x8d, state.parserSplit, "write");
    e.emit(0xc9, 0);
    e.branch(0xf0, "display_policy_unsplit");
    e.emit(0xa9, 0xeb); // Separator row23, before row24's raster243 badline.
    e.branch(0xd0, "display_policy_schedule");
    e.label("display_policy_unsplit");
    e.emit(0xa9, 0xfa);
    e.label("display_policy_schedule");
    e.abs(0x8d, 0xd012, "write");
    storeImmediate(e, state.parserPhase, 0);
    e.label("display_policy_unchanged");
    // A normal SID may arrive inside the strip. Retain hires until the end
    // IRQ restores the top mode; ordinary updates must never restart the IRQ.
    e.abs(0xad, state.parserPhase, "read");
    e.emit(0xc9, 2); // phase1 waits for end but skipped a late bottom switch.
    e.branch(0xd0, "display_policy_top");
    e.emit(0xa9, 0x08);
    e.branch(0xd0, "display_policy_apply");
    e.label("display_policy_top");
    e.abs(0xad, state.frameMode, "read");
    e.label("display_policy_apply");
    e.abs(0x8d, 0xd016, "write");
    e.emit(0x28, 0x60); // PLP/RTS
  }

  e.label("apply_cells");
  e.abs(0xad, stage + 6, "read");
  e.emit(0x85, ZP.remaining);
  e.jumpUnless(0xd0, "apply_cells_ok");
  e.emit(0xa9, (stage + 8) & 0xff, 0x85, ZP.recordLow,
    0xa9, (stage + 8) >>> 8, 0x85, ZP.recordHigh);
  e.label("cell_loop");
  e.emit(0xa5, ZP.remaining, 0xc9, MPE3_TITLE_PULL.cellRecordBytes);
  e.jumpUnless(0xb0, "apply_cells_bad");
  e.emit(0x38, 0xe9, MPE3_TITLE_PULL.cellRecordBytes, 0x85, ZP.remaining,
    0xa0, 0x00, 0xb1, ZP.recordLow, 0x85, ZP.cellLow,
    0xc8, 0xb1, ZP.recordLow, 0x85, ZP.cellHigh);
  e.emit(0xa5, ZP.cellHigh, 0xc9, 0x03);
  e.branch(0x90, "cell_index_ok");
  e.jumpUnless(0xf0, "apply_cells_bad");
  e.emit(0xa5, ZP.cellLow, 0xc9, 0xe8);
  e.jumpUnless(0x90, "apply_cells_bad");
  e.label("cell_index_ok");
  // Bitmap destination = $6000 + cell*8.
  e.emit(0xa5, ZP.cellLow, 0x85, ZP.destinationLow,
    0xa5, ZP.cellHigh, 0x85, ZP.destinationHigh,
    0x06, ZP.destinationLow, 0x26, ZP.destinationHigh,
    0x06, ZP.destinationLow, 0x26, ZP.destinationHigh,
    0x06, ZP.destinationLow, 0x26, ZP.destinationHigh,
    0xa5, ZP.destinationHigh, 0x18, 0x69, 0x60, 0x85, ZP.destinationHigh);
  advanceRecord(e, 2);
  e.emit(0xa0, 0x00);
  e.label("bitmap_cell_copy");
  // Two four-byte passes retain Y=8 while removing six compare/branches:
  // 115 rather than 145 cycles per cell, with unchanged CRC table alignment.
  for (let byte = 0; byte < 4; byte++) {
    e.emit(0xb1, ZP.recordLow, 0x91, ZP.destinationLow, 0xc8);
  }
  e.emit(0xc0, 0x08);
  e.branch(0xd0, "bitmap_cell_copy");
  advanceRecord(e, 8);
  // Screen byte = $5c00 + cell.
  e.emit(0xa5, ZP.cellLow, 0x18, 0x69, 0x00, 0x85, ZP.destinationLow,
    0xa5, ZP.cellHigh, 0x69, 0x5c, 0x85, ZP.destinationHigh,
    0xa0, 0x00, 0xb1, ZP.recordLow, 0x91, ZP.destinationLow);
  advanceRecord(e, 1);
  // Color byte = $d800 + cell.
  e.emit(0xa5, ZP.cellLow, 0x18, 0x69, 0x00, 0x85, ZP.destinationLow,
    0xa5, ZP.cellHigh, 0x69);
  e.label("color_destination_page");
  e.emit(diag.baseColor >>> 8, 0x85, ZP.destinationHigh,
    0xa0, 0x00, 0xb1, ZP.recordLow, 0x29, 0x0f, 0x91, ZP.destinationLow);
  advanceRecord(e, 1);
  e.emit(0xa5, ZP.remaining);
  e.jumpUnless(0xf0, "cell_loop");
  e.label("apply_cells_ok");
  e.emit(0x38, 0x60); // SEC / RTS
  e.label("apply_cells_bad");
  e.emit(0x18, 0x60); // CLC / RTS

  e.label("apply_sid");
  e.abs(0xad, stage + 6, "read");
  e.emit(0xc9, MPE3_TITLE_PULL.sidPayloadBytes);
  if (gameplay) {
    e.branch(0xf0, 'apply_sid_length_ok');
    e.emit(0xc9, MPE3_TITLE_PULL.spriteSidPayloadBytes);
  }
  e.branch(0xd0, "apply_sid_bad");
  if (gameplay) e.label('apply_sid_length_ok');
  e.abs(0xad, state.skipSent, "read");
  e.branch(0xf0, "apply_sid_score");
  e.abs(0x20, "clear_sid");
  e.emit(0x38, 0x60);
  e.label("apply_sid_score");
  e.abs(0xad, stage + 8, "read");
  e.emit(0x29, 0x01);
  e.branch(0xf0, "sid_voice_two");
  storeImmediate(e, 0xd404, 0x00);
  e.label("sid_voice_two");
  e.abs(0xad, stage + 8, "read");
  e.emit(0x29, 0x02);
  e.branch(0xf0, "sid_voice_three");
  storeImmediate(e, 0xd40b, 0x00);
  e.label("sid_voice_three");
  e.abs(0xad, stage + 8, "read");
  e.emit(0x29, 0x04);
  e.branch(0xf0, "sid_copy");
  storeImmediate(e, 0xd412, 0x00);
  e.label("sid_copy");
  e.emit(0xa2, 0x18);
  e.label("sid_copy_loop");
  e.abs(0xbd, stage + 9, "read");
  e.abs(0x9d, 0xd400, "write");
  e.emit(0xca);
  e.branch(0x10, "sid_copy_loop");
  e.emit(0x38, 0x60);
  e.label("apply_sid_bad");
  e.emit(0x18, 0x60);

  e.label("wait_fresh_border");
  e.abs(0xad, state.rasterTicks, "read");
  e.abs(0x8d, state.consumedTicks, "write");
  e.abs(0x20, "wait_frame");
  // The existing IRQ is at raster 250, the final active 25-row scanline.
  // Leave that line before either writing hidden planes or revealing them.
  e.label("wait_border_line");
  e.abs(0xad, 0xd012, "read");
  e.emit(0xc9, 0xfa);
  e.branch(0xd0, "border_line_passed");
  e.abs(0x20, "tick_wait");
  e.jumpUnless(0xb0, "error_clock");
  e.abs(0x4c, "wait_border_line");
  e.label("border_line_passed");
  e.emit(0x60);
  e.label("wait_frame");
  e.abs(0x20, "reset_wait");
  e.label("wait_frame_poll");
  e.abs(0xad, MPE3_TITLE_TERMINAL_STATE.rasterTicks, "read");
  e.abs(0xcd, MPE3_TITLE_TERMINAL_STATE.consumedTicks, "read");
  e.branch(0xd0, "frame_arrived");
  e.abs(0x20, "tick_wait");
  e.jumpUnless(0xb0, "error_clock");
  e.abs(0x4c, "wait_frame_poll");
  e.label("frame_arrived");
  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.consumedTicks, "write");
  e.emit(0x60);

  if (packetReplay) emitPacketReplay(e, stage);
  if (statusRecovery) emitStatusRecovery(e);
  e.label("reset_wait");
  storeImmediate(e, state.waitLow, 0);
  storeImmediate(e, state.waitHigh, 0);
  storeImmediate(e, state.waitBlocks, diag.waitBlocks);
  storeImmediate(e, state.retries, 16);
  e.emit(0x60);
  e.label("tick_wait");
  e.abs(0xce, state.waitLow, "write");
  e.branch(0xd0, "wait_remaining");
  e.abs(0xce, state.waitHigh, "write");
  e.branch(0xd0, "wait_remaining");
  e.abs(0xce, state.waitBlocks, "write");
  e.branch(0xd0, "wait_remaining");
  e.emit(0x18, 0x60);
  e.label("wait_remaining");
  e.emit(0x38, 0x60);

  e.label("raster_irq");
  e.emit(0x48); // preserve A; X/Y and all transfer pointers stay untouched
  storeImmediate(e, 0xd019, 0x01);
  if (gameplay) {
    e.abs(0xad, state.parserSplit, "read");
    e.branch(0xf0, "raster_frame_tick");
    e.abs(0xad, state.parserPhase, "read");
    e.branch(0xd0, "raster_parser_end");
    storeImmediate(e, state.parserPhase, 1);
    storeImmediate(e, 0xd012, 0xfb);
    // Match the old C64 parser's bounded raster window. A late IRQ skips the
    // strip for this frame instead of changing picture pixels or missing the
    // once-per-frame tick at251. D018/bank/sprite pointers never change.
    e.abs(0xad, 0xd011, "read");
    e.branch(0x30, "raster_irq_done");
    e.abs(0xad, 0xd012, "read");
    e.emit(0x38, 0xe9, 0xeb, 0xc9, 5);
    e.branch(0xb0, "raster_irq_done");
    storeImmediate(e, 0xd016, 0x08);
    e.abs(0xee, state.parserPhase, "write");
    e.abs(0x4c, "raster_irq_done");
    e.label("raster_parser_end");
    e.abs(0xad, state.frameMode, "read");
    e.abs(0x8d, 0xd016, "write");
    storeImmediate(e, state.parserPhase, 0);
    storeImmediate(e, 0xd012, 0xeb);
    e.label("raster_frame_tick");
  }
  e.abs(0xee, MPE3_TITLE_TERMINAL_STATE.rasterTicks, "write");
  if (gameplay) e.label("raster_irq_done");
  e.emit(0x68, 0x40); // PLA / RTI
  e.label("quiet_nmi");
  e.emit(0x40);

  e.label("clear_sid");
  e.emit(0xa9, 0x00, 0xa2, 0x18);
  e.label("clear_sid_loop");
  e.abs(0x9d, 0xd400, "write");
  e.emit(0xca);
  e.branch(0x10, "clear_sid_loop");
  e.emit(0x60);

  // A small native CIA scan proves input without banking KERNAL back in.
  // Require release after cartridge launch so the menu's held Return/fire
  // cannot immediately skip. Port-1 electrical lows are masked before key
  // tests; only Return, Space or port-2 fire are accepted.
  e.label("sample_skip_input");
  if (gameplay) {
    e.abs(0xad, MPE4_INPUT.active, "read");
    e.branch(0xf0, "game_input_not_active");
    e.abs(0x4c, "sample_game_input");
    e.label("game_input_not_active");
  }
  e.abs(0xad, state.skipSent, "read");
  e.branch(0xf0, "scan_skip_inputs");
  e.emit(0x60);
  e.label("scan_skip_inputs");
  storeImmediate(e, 0xdc02, 0);
  storeImmediate(e, 0xdc03, 0);
  e.abs(0xad, 0xdc00, "read");
  e.emit(0x29, 0x10);
  e.branch(0xf0, "skip_fire");
  e.abs(0xad, 0xdc01, "read");
  e.abs(0x8d, state.keyboardBaseline, "write");
  storeImmediate(e, 0xdc02, 0xff);
  storeImmediate(e, 0xdc00, 0xfe); // keyboard row 0, Return at PB1
  e.abs(0xad, 0xdc01, "read");
  e.emit(0x29, 2);
  e.branch(0xd0, "scan_space");
  e.abs(0xad, state.keyboardBaseline, "read");
  e.emit(0x29, 2);
  e.branch(0xd0, "skip_return");
  e.label("scan_space");
  storeImmediate(e, 0xdc00, 0x7f); // keyboard row 7, Space at PB4
  e.abs(0xad, 0xdc01, "read");
  e.emit(0x29, 0x10);
  e.branch(0xd0, "skip_released");
  e.abs(0xad, state.keyboardBaseline, "read");
  e.emit(0x29, 0x10);
  e.branch(0xf0, "skip_released");
  e.emit(0xa2, 2);
  e.branch(0xd0, "skip_scan_done");
  e.label("skip_return");
  e.emit(0xa2, 1);
  e.branch(0xd0, "skip_scan_done");
  e.label("skip_fire");
  e.emit(0xa2, 3);
  e.branch(0xd0, "skip_scan_done");
  e.label("skip_released");
  e.emit(0xa2, 0);
  e.label("skip_scan_done");
  storeImmediate(e, 0xdc00, 0xff);
  storeImmediate(e, 0xdc02, 0); // leave both CIA matrix ports as inputs
  e.emit(0x8a);
  e.branch(0xf0, "arm_skip_input");
  e.abs(0xad, state.inputArmed, "read");
  e.branch(0xf0, "skip_input_done");
  e.abs(0x8e, state.skipInput, "write");
  storeImmediate(e, state.skipSent, 1);
  storeImmediate(e, CONTROL.command, MPE3_TITLE_PULL.commandSkip);
  e.abs(0x20, "clear_sid");
  e.label("skip_input_done");
  e.emit(0x60);
  e.label("arm_skip_input");
  storeImmediate(e, state.inputArmed, 1);
  e.emit(0x60);

  e.label("clear_video");
  e.emit(0xa9, 0x00, 0xa2, 0x00);
  e.label("clear_video_loop");
  for (const page of [0x5c, 0x5d, 0x5e, 0x5f]) e.abs(0x9d, page << 8, "write");
  for (const page of [0x40, 0x41, 0x42, 0x43]) e.abs(0x9d, page << 8, "write");
  for (let page = 0x60; page <= 0x7f; page++) e.abs(0x9d, page << 8, "write");
  for (const page of [0xd8, 0xd9, 0xda, 0xdb]) e.abs(0x9d, page << 8, "write");
  e.emit(0xe8);
  e.jumpUnless(0xf0, "clear_video_loop");
  e.emit(0x60);

  for (const [name, [code]] of Object.entries(errors)) {
    e.label(`error_${name}`);
    storeImmediate(e, state.error, code);
    e.abs(0x4c, "terminal_error");
  }
  e.label("terminal_error");
  e.emit(0x78); // No failure path depends on CLI, a VIC IRQ or KERNAL services.
  storeImmediate(e, 0xd01a, 0);
  storeImmediate(e, 0xd015, 0); // Stop VIC sprite DMA before changing VIC banks.
  e.abs(0x20, "clear_sid");
  e.emit(0xa2, 15);
  e.label("snapshot_control");
  e.abs(0xbd, CONTROL.magic0, "read");
  e.abs(0x9d, state.controlSnapshot, "write");
  e.emit(0xca);
  e.branch(0x10, "snapshot_control");
  e.abs(0xad, state.error, "read");
  e.emit(0xc9, 3);
  e.branch(0xd0, "snapshot_status_done");
  e.abs(0xad, "trigger_status", "read");
  e.abs(0x8d, state.controlSnapshot + 5, "write");
  e.label("snapshot_status_done");
  if (statusRecovery) {
    e.abs(0xad, 'status_error_confirmed', 'read');
    e.branch(0xf0, 'snapshot_error_done');
    e.abs(0xad, 'status_error_code', 'read');
    e.abs(0x8d, state.controlSnapshot + 11, 'write');
    e.label('snapshot_error_done');
    // Ask a still-running host to stop producing video. Do this only after
    // capturing the command that led to the fault. A genuine host fault is
    // already stopped; this request is harmless in that case.
    storeImmediate(e, CONTROL.command, 4);
  }
  e.abs(0x20, "diagnostic_screen");
  e.abs(0x20, "diagnostic_details");
  storeImmediate(e, 0xd020, 0x02);
  e.label("terminal_error_hold");
  if (statusRecovery) {
    // A final in-flight host upload may touch colour RAM after the diagnostic
    // is drawn. Keep its letters readable without clearing/restarting video.
    e.emit(0xa9, 1, 0xa2, 0);
    e.label('terminal_error_colours');
    for (const page of [0xd8, 0xd9, 0xda, 0xdb]) e.abs(0x9d, page << 8, 'write');
    e.emit(0xe8);e.branch(0xd0, 'terminal_error_colours');
  }
  e.abs(0x4c, "terminal_error_hold");
  e.label("trigger_status");e.emit(0);

  // Text mode in VIC bank 0 is independent of the title planes in bank 1.
  // This routine runs only at startup/failure, never during title playback.
  e.label("diagnostic_screen");
  e.abs(0xad, 0xdd02, "read");
  e.emit(0x09, 3);
  e.abs(0x8d, 0xdd02, "write");
  e.abs(0xad, 0xdd00, "read");
  e.emit(0x09, 3);
  e.abs(0x8d, 0xdd00, "write");
  storeImmediate(e, 0xd018, 0x14); // screen $0400, uppercase character ROM
  storeImmediate(e, 0xd016, 0x08);
  storeImmediate(e, 0xd011, 0x1b);
  storeImmediate(e, 0xd021, 0);
  e.emit(0xa2, 0);
  e.label("diagnostic_clear");
  e.emit(0xa9, 0x20);
  for (const page of [4, 5, 6, 7]) e.abs(0x9d, page << 8, "write");
  e.emit(0xa9, 1);
  for (const page of [0xd8, 0xd9, 0xda, 0xdb]) e.abs(0x9d, page << 8, "write");
  e.emit(0xe8);
  e.branch(0xd0, "diagnostic_clear");
  const lines = new Map([
    [0, diagnosticTitle],
    [2, "STAGE 00   ERROR 00   PACKETS   0000"],
    [3, "01 RAM 02 IO2 03 WAIT 04 BASE 05 TITLE"],
    [5, "WAITING FOR NATIVE SESSION"],
    [7, "CPU01 00 DDR00 00 BANKREQ 3A"],
    [9, "CTRL F0-F7: ID CMD STATUS ACK COMMIT"],
    [11, "CTRL F8-FF: ASSET LO/MID/HI FW ERROR"],
    [14, "LAST PACKET TYPE 00 SEQUENCE 00"],
    [16, "KEEP THIS SCREEN IF STARTUP FAILS"],
    [18, diagnosticFooter]
  ]);
  if (statusRecovery) lines.set(17, 'STATUS RECOVERIES 0000 LAST 00');
  for (const [row] of lines) {
    e.emit(0xa2, 39);
    e.label(`diagnostic_line_${row}`);
    e.abs(0xbd, `diagnostic_text_${row}`, "read");
    e.abs(0x9d, diag.screen + row * 40, "write");
    e.emit(0xca);
    e.branch(0x10, `diagnostic_line_${row}`);
  }
  e.emit(0x60);

  e.label("diagnostic_details");
  for (const [address, target] of [
    [state.startupStage, diag.stage], [state.error, diag.error],
    [state.packetsHigh, diag.packets], [state.packetsLow, diag.packets + 2],
    [1, diag.screen + 7 * 40 + 6], [0, diag.screen + 7 * 40 + 15],
    [stage + 3, diag.screen + 14 * 40 + 17],
    [stage + 4, diag.screen + 14 * 40 + 29]
  ]) {
    pointer(e, ZP.destinationLow, target);
    e.abs(0xad, address, "read");
    e.abs(0x20, "diagnostic_hex");
  }
  for (let row = 0; row < 2; row++) {
    pointer(e, ZP.destinationLow, diag.control[row]);
    storeImmediate(e, ZP.remaining, 0);
    e.label(`diagnostic_control_${row}`);
    e.emit(0xa6, ZP.remaining);
    e.abs(0xbd, state.controlSnapshot + row * 8, "read");
    e.abs(0x20, "diagnostic_hex");
    e.emit(0x18, 0xa5, ZP.destinationLow, 0x69, 3, 0x85, ZP.destinationLow,
      0xe6, ZP.remaining, 0xa5, ZP.remaining, 0xc9, 8);
    e.branch(0xd0, `diagnostic_control_${row}`);
  }
  if (statusRecovery) for (const [name, column] of [
    ['status_recoveries_high', 17], ['status_recoveries_low', 19], ['status_last_bad', 27]
  ]) {
    pointer(e, ZP.destinationLow, diag.screen + 17 * 40 + column);
    e.abs(0xad, name, 'read');e.abs(0x20, 'diagnostic_hex');
  }
  // Select the readable error line by code; only failure rendering uses it.
  e.abs(0xae, state.error, "read");
  e.abs(0xbd, "error_text_low", "read");
  e.emit(0x85, ZP.recordLow);
  e.abs(0xbd, "error_text_high", "read");
  e.emit(0x85, ZP.recordHigh, 0xa0, 39);
  e.label("diagnostic_error_text");
  e.emit(0xb1, ZP.recordLow);
  e.abs(0x99, diag.message, "write");
  e.emit(0x88);
  e.branch(0x10, "diagnostic_error_text");
  e.emit(0x60);

  e.label("diagnostic_hex");
  e.emit(0x48, 0x4a, 0x4a, 0x4a, 0x4a, 0xaa);
  e.abs(0xbd, "hex_digits", "read");
  e.emit(0xa0, 0, 0x91, ZP.destinationLow, 0x68, 0x29, 15, 0xaa);
  e.abs(0xbd, "hex_digits", "read");
  e.emit(0xc8, 0x91, ZP.destinationLow, 0x60);
  e.label("diagnostic_end");

  for (const [row, text] of lines) {
    e.label(`diagnostic_text_${row}`);
    e.emit(...screenCodes(text));
  }
  for (const [name, [, text]] of Object.entries(errors)) {
    e.label(`error_text_${name}`);
    e.emit(...screenCodes(text));
  }
  for (const [part, shift] of [["low", 0], ["high", 8]]) {
    e.label(`error_text_${part}`);
    // Entry zero is unused but remains a valid string pointer.
    for (const name of ["io2", ...Object.keys(errors)]) {
      e.byteFixups.push({ offset: e.data.length, target: `error_text_${name}`, shift });
      e.emit(0);
    }
  }
  e.label("hex_digits");
  e.emit(...[..."0123456789ABCDEF"].map((c) => c.charCodeAt(0) & 0x3f));

  if (gameplay) emitMpe4Keyboard(e, state.rasterTicks, { enable1351Mouse });

  // Page alignment keeps indexed CRC table reads at a fixed four cycles.
  while ((e.address() & 0xff) !== 0) e.emit(0xea);
  const table = crcTable();
  e.label("crc_table_high");
  e.emit(...table.map((value) => value >>> 8));
  e.label("crc_table_low");
  e.emit(...table.map((value) => value & 0xff));

  if (gameplay) emitMpe4EgoSprites(e, stage);
  return e.finish();
}

export function buildMpe3TitleTerminal({
  assetRaw = MPE3_TITLE_PULL.assetRaw,
  gameplay = false,
  enable1351Mouse = gameplay,
  publishVideoTiming = true,
  packetReplay = false,
  statusRecovery = false,
  diagnosticTitle = MPE3_TITLE_GENERIC_DIAGNOSTIC_TITLE,
  diagnosticFooter = MPE3_TITLE_GENERIC_DIAGNOSTIC_FOOTER
} = {}) {
  if (!Number.isInteger(assetRaw) || assetRaw < 0 || assetRaw > 0xffffff) {
    throw new RangeError("MPE3 title assetRaw must be a 24-bit cartridge offset");
  }
  diagnosticTitle = normalizeDiagnosticText(diagnosticTitle, "title");
  diagnosticFooter = normalizeDiagnosticText(diagnosticFooter, "footer");
  const stageAddress = gameplay ? 0x2800 : MPE3_TITLE_PULL.stageAddress;
  if (packetReplay && (!gameplay || !publishVideoTiming)) throw new Error('Packet replay requires the timed ABI2 gameplay client');
  if (statusRecovery && !packetReplay) throw new Error('Status recovery requires the ABI2 packet-replay client');
  const program = buildProgram({ assetRaw, gameplay, enable1351Mouse, publishVideoTiming, packetReplay, statusRecovery, stageAddress, diagnosticTitle, diagnosticFooter });
  if (MPE3_TITLE_PULL.runtimeAddress + program.bytes.length > stageAddress) {
    throw new RangeError("MPE3 presenter overlaps its packet stage");
  }
  const prefix = Buffer.alloc(MPE3_TITLE_PULL.runtimeAddress - 0x0801, 0x00);
  const prg = Buffer.concat([Buffer.from([0x01, 0x08]), prefix, program.bytes]);
  return Object.freeze({
    prg,
    labels: program.labels,
    accesses: program.accesses,
    assetRaw,
    gameplay,
    enable1351Mouse: Boolean(gameplay && enable1351Mouse),
    publishVideoTiming: Boolean(publishVideoTiming),
    statusRecovery: Boolean(statusRecovery),
    diagnosticTitle,
    diagnosticFooter,
    stageAddress,
    codeBytes: program.bytes.length,
    codeEnd: MPE3_TITLE_PULL.runtimeAddress + program.bytes.length
  });
}
