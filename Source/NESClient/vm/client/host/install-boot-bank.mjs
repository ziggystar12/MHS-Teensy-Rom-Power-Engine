import { encodeLoadingText } from './loading-text.mjs';
const BOOT_BANK_SIZE=0x4000,PAYLOAD_ROM_ADDRESS=0x80fd,PAYLOAD_ROM_OFFSET=0xfd,RESET_VECTOR_OFFSET=0x3ffc,RUNTIME_ENTRY=0x0810;
const EARLY_LOADING_TEXT_ADDRESS=0x8030,EARLY_LOADING_TEXT_SCREEN=0x05e8,EARLY_LOADING_BAR_LEFT=0x079f,EARLY_LOADING_BAR_RIGHT=0x07b8;
const word=v=>[v&255,(v>>>8)&255];
export function buildEasyFlashBootBank(prg, { loadingText } = {}) {
  if (prg.length < 3) {
    throw new Error("Runtime PRG is empty");
  }
  const loadAddress = prg[0] | (prg[1] << 8);
  const payload = prg.subarray(2);
  if (loadAddress !== 0x0801) {
    throw new Error(`Expected runtime PRG to load at $0801, got $${loadAddress.toString(16)}`);
  }
  if (PAYLOAD_ROM_OFFSET + payload.length > RESET_VECTOR_OFFSET) {
    throw new Error(`Runtime PRG payload (${payload.length} bytes) overlaps the boot-bank reset vectors`);
  }

  const bank = Buffer.alloc(BOOT_BANK_SIZE, 0xff);
  const coldStart = 0x8060;
  const trampolineAddress = 0x8050;
  bank.set(word(coldStart), 0x0000);
  bank.set(word(coldStart), 0x0002);
  bank.set([0xc3, 0xc2, 0xcd, 0x38, 0x30], 0x0004); // CBM80 in screen codes

  // EasyFlash/KFF2 powers up in Ultimax mode. Match its official launcher:
  // initialize the stack/VIC, copy the mode-switch trampoline to RAM, and
  // execute the $de02 write from RAM before entering the 16K-mode loader.
  const resetStub = [
    0x78,                         // sei
    0xa2, 0xff, 0x9a, 0xd8,       // ldx #$ff / txs / cld
    0xa9, 0x08, 0x8d, 0x16, 0xd0,// enable VIC RAM refresh
    0xa9, 0x00,                   // lda #0
    0x9d, 0x00, 0x01, 0xca,       // clear stack page
    0xd0, 0xfa,
    0xa2, 0x05,                   // copy six-byte trampoline
    0xbd, ...word(trampolineAddress),
    0x9d, 0x00, 0x01,
    0xca, 0x10, 0xf7,
    0xa9, 0x87,                   // LED on, GAME controlled, 16K mode
    0x4c, 0x00, 0x01              // jmp RAM trampoline
  ];
  const resetStubEnd = 0x8009 + resetStub.length;
  const caption = encodeLoadingText(loadingText);
  const earlyLoadingTextEnd = EARLY_LOADING_TEXT_ADDRESS + caption.length;
  if (resetStubEnd > EARLY_LOADING_TEXT_ADDRESS || earlyLoadingTextEnd > trampolineAddress) {
    throw new Error("Generated reset stub overlaps its early loading caption");
  }
  bank.set(resetStub, 0x0009);
  bank.set([
    0x8d, 0x02, 0xde,             // sta $de02
    0x4c, ...word(coldStart)       // jmp coldStart
  ], trampolineAddress - 0x8000);

  // The reset stub leaves a small ROML window before its RAM trampoline. Keep
  // the loader caption there so it can be displayed before the 16 KB runtime
  // and its resident rendering extensions are copied into RAM.
  bank.set(caption, EARLY_LOADING_TEXT_ADDRESS - 0x8000);

  const loader = [
    0x78,                         // sei
    0x20, 0x84, 0xff,             // jsr IOINIT
    0x20, 0x87, 0xff,             // jsr RAMTAS
    0x20, 0x8a, 0xff,             // jsr RESTOR
    0x20, 0x81, 0xff,             // jsr CINT
    // Publish the same bank-0 loading screen used by the resident UI before
    // the large runtime copy begins. The message is 25 columns at column 8;
    // the 26-column bar spans columns 7-32, so both are centered.
    0xad, 0x00, 0xdd,             // lda $dd00
    0x09, 0x03,                   // ora #$03 (VIC bank 0)
    0x8d, 0x00, 0xdd,             // sta $dd00
    0xa9, 0x16, 0x8d, 0x18, 0xd0,// lower/uppercase character set
    0xa9, 0x1b, 0x8d, 0x11, 0xd0,// text display on
    0xa9, 0x08, 0x8d, 0x16, 0xd0,
    0xa9, 0x00,
    0x8d, 0x15, 0xd0,             // sprites off
    0x8d, 0x20, 0xd0,             // black border
    0x8d, 0x21, 0xd0,             // black background
    0xa2, caption.length - 1,
    0xbd, ...word(EARLY_LOADING_TEXT_ADDRESS),
    0x9d, ...word(EARLY_LOADING_TEXT_SCREEN),
    0xa9, 0x01,
    0x9d, ...word(0xd800 + (EARLY_LOADING_TEXT_SCREEN - 0x0400)),
    0xca,
    0x10, 0xf2,                   // copy all 25 caption cells
    0xa9, 0x1b, 0x8d, ...word(EARLY_LOADING_BAR_LEFT),
    0xa9, 0x1d, 0x8d, ...word(EARLY_LOADING_BAR_RIGHT),
    0xa2, 0x1a,
    0xa9, 0x01,
    0xca,
    0x9d, ...word(0xd800 + (EARLY_LOADING_BAR_LEFT - 0x0400)),
    0xd0, 0xfa,                   // color bar; leave X=0 for progress width
    0xa9, ...word(PAYLOAD_ROM_ADDRESS).slice(0, 1), 0x85, 0xf7,
    0xa9, ...word(PAYLOAD_ROM_ADDRESS).slice(1), 0x85, 0xf8,
    0xa9, ...word(loadAddress).slice(0, 1), 0x85, 0xf9,
    0xa9, ...word(loadAddress).slice(1), 0x85, 0xfa,
    0xa9, ...word(payload.length).slice(0, 1), 0x85, 0xfb,
    0xa9, ...word(payload.length).slice(1), 0x85, 0xfc
  ];
  const copyAddress = coldStart + loader.length;
  loader.push(
    // Copy complete 256-byte pages with Y as the only inner-loop counter.
    // Keeping each pointer's low byte fixed lets indexed-indirect addressing
    // carry naturally across its unaligned page, while removing four pointer
    // updates and a 16-bit length test from every copied byte.
    0xa5, 0xfc,                   // lda complete page count
    0xf0, 0x1e,                   // beq remainder
    0xa0, 0x00,                   // ldy #0
    0xb1, 0xf7,                   // lda (source),y
    0x91, 0xf9,                   // sta (destination),y
    0xc8, 0xd0, 0xf9,             // iny / copy the rest of this page
    0xe6, 0xf8,                   // advance source high byte
    0xe6, 0xfa,                   // advance destination high byte
    0xc6, 0xfc,
    0xa5, 0xfc, 0x29, 0x07,       // one cell at each eight-page boundary
    0xd0, 0xe7,                   // continue with the next complete page
    0xa9, 0xa0,
    0x9d, ...word(EARLY_LOADING_BAR_LEFT + 1),
    0xe8,
    0x4c, ...word(copyAddress),    // repeat complete pages
    // Copy the final 0..255 bytes. The resident payload remains byte-exact;
    // only the bootstrap traversal changed.
    0xa0, 0x00,                   // remainder: ldy #0
    0xc4, 0xfb,                   // cpy remainder length
    0xf0, 0x07,                   // beq copy done
    0xb1, 0xf7,
    0x91, 0xf9,
    0xc8, 0xd0, 0xf5              // loop (a 255-byte tail cannot wrap Y)
  );
  loader.push(0x4c, ...word(RUNTIME_ENTRY)); // jmp runtime
  if ((coldStart - 0x8000) + loader.length > PAYLOAD_ROM_OFFSET) {
    throw new Error("Generated EasyFlash loader overlaps its runtime payload");
  }
  bank.set(loader, coldStart - 0x8000);
  payload.copy(bank, PAYLOAD_ROM_OFFSET);

  // In Ultimax mode the CPU reset vector is read from bank-0 ROMH at $fffc.
  bank.set(word(0x8009), 0x3ffc);
  bank.set(word(0x8009), 0x3ffe);
  return bank;
}


export const buildCartridgeBootBank=buildEasyFlashBootBank;
