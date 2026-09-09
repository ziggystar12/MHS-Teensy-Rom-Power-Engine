/* RAM-only profile 1: same host/stack/FlexRAM layout; RAM2 upper 96K is RO. */
MEMORY {
  CODE (rx) : ORIGIN = 0x00018000, LENGTH = 96K
  DATA (rw) : ORIGIN = 0x20014000, LENGTH = 192K
  TABLES (r) : ORIGIN = 0x20268000, LENGTH = 96K
}
ENTRY(vm_entry)
SECTIONS {
  .text : { KEEP(*(.entry)) KEEP(*(.module_api)) *(.text*) . = ALIGN(4); } > CODE
  .data : {
    *(.rodata.finesine) *(.rodata.finetangent) *(.rodata.gfx_stbar)
    *(.data*) . = ALIGN(32);
  } > DATA
  .bss (NOLOAD) : { *(.bss*) *(COMMON) . = ALIGN(32); } > DATA
  .rodata2 : { *(.rodata*) . = ALIGN(32); } > TABLES
  /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) *(.comment) *(.eh_frame*) }
  ASSERT(SIZEOF(.text) <= 96K, "VM executable exceeds RAM1 code window")
  ASSERT(SIZEOF(.data)+SIZEOF(.bss)+64K <= 192K, "VM lacks 64K support workspace")
  ASSERT(SIZEOF(.rodata2) <= 96K, "VM constants exceed reserved RAM2 window")
}
