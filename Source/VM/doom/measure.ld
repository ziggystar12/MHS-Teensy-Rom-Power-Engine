/* Measurement ONLY: deliberately impossible RAM windows. Never package this ELF.
   The builder separately links with vm/abi/module.ld to enforce real ABI limits. */
MEMORY {
  CODE (rx) : ORIGIN = 0x00018000, LENGTH = 2M
  DATA (rw) : ORIGIN = 0x20014000, LENGTH = 2M
}
ENTRY(vm_entry)
SECTIONS {
  .text : { KEEP(*(.entry)) *(.text*) . = ALIGN(4); } > CODE
  .rodata : { *(.rodata*) . = ALIGN(4); } > CODE
  .data : { *(.data*) . = ALIGN(32); } > DATA
  .bss (NOLOAD) : { *(.bss*) *(COMMON) . = ALIGN(32); } > DATA
  /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) *(.comment) *(.eh_frame*) }
}
