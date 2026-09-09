// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace doomvm {
// Offset-based headers have identical overhead on the 32-bit target and host.
// Only this supplied RAM1 arena is used. Adjacent free blocks are coalesced.
class Heap {
    struct Block { uint32_t span, requested; };
    uint8_t *memory_ = nullptr;
    uint32_t bytes_ = 0;
public:
    uint32_t used = 0, highWater = 0, failedBytes = 0;
    bool init(void *memory, size_t bytes) {
        if (!memory || (uintptr_t(memory)&7) || bytes<16 || bytes>UINT32_MAX) return false;
        memory_=static_cast<uint8_t *>(memory);bytes_=uint32_t(bytes)&~7u;
        used=highWater=failedBytes=0;*reinterpret_cast<Block *>(memory_)={bytes_,0};return true;
    }
    void *allocate(size_t bytes) {
        if (!bytes) return nullptr;
        if (bytes>UINT32_MAX-15) {failedBytes=UINT32_MAX;return nullptr;}
        uint32_t need=(uint32_t(bytes)+15)&~7u;
        for (uint32_t offset=0;offset<bytes_;) {
            auto b=reinterpret_cast<Block *>(memory_+offset);
            if (!b->requested && b->span>=need) {
                if (b->span-need>=16) {
                    *reinterpret_cast<Block *>(memory_+offset+need)={b->span-need,0};b->span=need;
                }
                b->requested=uint32_t(bytes);used+=b->span;if(used>highWater)highWater=used;
                return b+1;
            }
            offset+=b->span;
        }
        failedBytes=uint32_t(bytes);return nullptr;
    }
    uint32_t size(const void *p) const {
        for(uint32_t offset=0;offset<bytes_;) {
            auto b=reinterpret_cast<const Block *>(memory_+offset);
            if(b+1==p)return b->requested;
            offset+=b->span;
        }return 0;
    }
    bool release(void *p) {
        if(!p)return true;
        Block *previous=nullptr;
        for(uint32_t offset=0;offset<bytes_;) {
            auto b=reinterpret_cast<Block *>(memory_+offset);
            if(b+1==p) {
                if(!b->requested)return false;
                used-=b->span;b->requested=0;
                if(offset+b->span<bytes_) {
                    auto next=reinterpret_cast<Block *>(memory_+offset+b->span);
                    if(!next->requested)b->span+=next->span;
                }
                if(previous&&!previous->requested)previous->span+=b->span;
                return true;
            }
            previous=b;offset+=b->span;
        }return false;
    }
    void *resize(void *p,size_t bytes) {
        if(!p)return allocate(bytes);
        auto old=size(p);if(!old)return nullptr;
        if(!bytes){release(p);return nullptr;}
        // Allocation failure preserves the original allocation and its bytes.
        auto next=allocate(bytes);if(!next)return nullptr;
        memcpy(next,p,old<bytes?old:bytes);release(p);return next;
    }
};
}
