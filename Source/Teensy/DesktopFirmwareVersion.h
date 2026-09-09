#pragma once
#include <stdint.h>

// Checked against firmware-version.json by the release/version tooling.
#define MPE_FIRMWARE_VERSION "1.2.6"

namespace DesktopFirmwareVersions {
struct Version { uint32_t part[3]; };

// Three numeric SemVer components only: no signs, empty components, leading
// zeroes, overflow, prerelease suffix, build metadata, or trailing characters.
static inline bool parse(const char*& text, Version& version) {
   if (!text) return false;
   for (unsigned component=0; component<3; ++component) {
      const char* first=text;
      uint32_t value=0;
      if (*text<'0' || *text>'9') return false;
      do {
         const uint32_t digit=uint32_t(*text++-'0');
         if (value>(UINT32_MAX-digit)/10) return false;
         value=value*10+digit;
      } while (*text>='0' && *text<='9');
      if (*first=='0' && text-first>1) return false;
      version.part[component]=value;
      if (component<2 && *text++!='.') return false;
   }
   return true;
}
static inline int compare(const Version& a, const Version& b) {
   for (unsigned i=0; i<3; ++i)
      if (a.part[i]!=b.part[i]) return a.part[i]<b.part[i] ? -1 : 1;
   return 0;
}
static inline bool literal(const char*& text, const char* expected) {
   for (; *expected; ++expected,++text) {
      char c=*text;
      if (c>='A' && c<='Z') c=char(c+'a'-'A');
      if (c!=*expected) return false;
   }
   return true;
}
static inline bool filename(const char* text, Version& version) {
   return text && literal(text,"mpe_firmware-v") && parse(text,version) &&
      literal(text,".hex") && !*text;
}
static inline bool installed(Version& version) {
   const char* text=MPE_FIRMWARE_VERSION;
   return parse(text,version) && !*text;
}
}
