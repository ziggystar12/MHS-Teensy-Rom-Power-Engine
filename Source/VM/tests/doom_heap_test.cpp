// SPDX-License-Identifier: GPL-2.0-or-later
#include "../doom/heap.h"
#include <assert.h>
#include <stdio.h>
int main(){
    alignas(8) uint8_t memory[1024];doomvm::Heap heap;
    assert(!heap.init(memory+1,1023));assert(heap.init(memory,sizeof memory));
    auto a=heap.allocate(80),b=heap.allocate(160),c=heap.allocate(40);assert(a&&b&&c);
    memset(b,0x59,160);auto bigger=heap.resize(b,240);assert(bigger);
    for(int i=0;i<160;i++)assert(static_cast<uint8_t *>(bigger)[i]==0x59);
    assert(!heap.resize(bigger,2048));assert(heap.size(bigger)==240);
    assert(heap.release(c)&&heap.release(a)&&heap.release(bigger));assert(heap.used==0);
    // Freed blocks, including the old realloc block, must rejoin a full arena.
    auto all=heap.allocate(1016);assert(all);assert(!heap.allocate(1));
    assert(!heap.release(static_cast<uint8_t *>(all)+8));assert(heap.release(all));assert(!heap.release(all));
    assert(!heap.allocate(SIZE_MAX));assert(heap.allocate(1016));
    puts("PASS: bounded allocation, reclaim/coalesce, realloc preservation, overflow and foreign-pointer guards");
}
