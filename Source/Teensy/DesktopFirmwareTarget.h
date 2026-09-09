#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>

// Confirmation identity only; this class does no file IO and does not flash.
// Copies are captured in the main loop and never truncated for confirmation.
class DesktopFirmwareTarget {
public:
   enum { Idle=0, Ready=1, Changed=2, Invalid=3 };
   bool armed = false, confirmed = false;
   uint8_t state = Idle, device = 0, type = 0;
   uintptr_t menu = 0;
   uint16_t index = 0;
   uint32_t size = 0;
   char folder[256] = "", name[101] = "";

   void cancel() { armed = confirmed = false; state = Idle; }
   bool prepare(uintptr_t newMenu, uint16_t newIndex, uint8_t newDevice,
                uint8_t newType, uint32_t newSize, const char* directory,
                const char* filename, bool supported) {
      armed = true; confirmed = false; state = Invalid; folder[0] = name[0] = 0;
      if (!supported || !newMenu || !directory || !filename || !filename[0] ||
          length(directory,sizeof folder) >= sizeof folder ||
          length(filename,sizeof name) >= sizeof name ||
          strchr(filename,'/') || strchr(filename,'\\')) return false;
      for (const unsigned char* p=(const unsigned char*)filename; *p; ++p)
         if (*p < 32 || *p > 126) return false;
      strcpy(folder,directory); strcpy(name,filename);
      menu=newMenu; index=newIndex; device=newDevice; type=newType; size=newSize;
      char path[358];
      if (!pathName(path,sizeof path)) return false;
      state=Ready; return true;
   }
   bool check(uintptr_t currentMenu, uint16_t currentIndex, uint8_t currentDevice,
              uint8_t currentType, uint32_t currentSize, const char* directory,
              const char* filename, bool supported) {
      if (!armed || state != Ready || !supported || !directory || !filename ||
          menu != currentMenu || index != currentIndex || device != currentDevice ||
          type != currentType || size != currentSize ||
          strcmp(folder,directory) || strcmp(name,filename)) {
         state=Changed; return false;
      }
      return true;
   }
   bool pathName(char* out, size_t capacity) const {
      const bool root = !folder[0] || !strcmp(folder,"/");
      const int result = root ? snprintf(out,capacity,"/%s",name) : snprintf(out,capacity,"%s/%s",folder,name);
      return result >= 0 && size_t(result) < capacity;
   }
private:
   static size_t length(const char* text, size_t capacity) {
      size_t count=0; while(count<capacity && text[count]) ++count; return count;
   }
};
