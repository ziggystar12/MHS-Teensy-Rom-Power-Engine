// Native NESVM session hosted by the bank-58 M3 packet service. The reusable
// CRT owns the C64 terminal; this firmware owns the SD ROM list, selected ROM,
// emulator, VIC presentation and SID approximation.
#pragma once

#ifndef NES_CODE
#define NES_CODE FLASHMEM
#endif
#define M6502_CODE NES_CODE
#define MHS_NES_FIXED_VIC_LUT 1
#include "nes_rom.cpp"
#include "nes_machine.cpp"
#include "nes_sid.cpp"
#include "nes_video.cpp"
#include <new>
#undef M6502_CODE

static constexpr uint8_t MPE6Protocol = 1;
static constexpr uint16_t MPE6DescriptorBytes = 128;
static constexpr uint16_t MPE6MaximumRoms = 128;
static constexpr uint8_t MPE6NameBytes = 96;
static constexpr uint8_t MPE6RowsPerPage = 17;
static constexpr uint32_t MPE6CpuHz = 1789773u;
static constexpr uint32_t MPE6CycleSlice = 3000u;
static constexpr uint32_t MPE6MaximumDebt = MPE6CpuHz / 20u;

struct MPE6RomEntry
{
   uint32_t bytes;
   char name[MPE6NameBytes];
};

struct MPE6Menu
{
   MPE6RomEntry roms[MPE6MaximumRoms];
   uint16_t count, selected, omitted;
   uint8_t lastHash[32];
   bool lastHashValid;
   char message[41];
};

enum class MPE6Mode : uint8_t { Menu, Game };

// ISR-visible controls remain in initialized RAM1. Large mutable storage is
// placement-constructed in the proven unused tail of the resident NESVM CRT.
static volatile bool MPE6Active, MPE6InputPending;
static volatile uint8_t MPE6InputButtons, MPE6InputDisplay, MPE6InputOverflow;
static MPE6Mode MPE6ModeState;
static MPE6Menu *MPE6MenuState;
static nes::Machine *MPE6Machine;
static nes::SquishRenderer *MPE6Renderer;
static nes::VicFrame *MPE6Frozen, *MPE6Presented;
static nes::SidAdapter *MPE6Sid;
static nes::SidPacket MPE6LatestSid;
static uint8_t *MPE6RomBytes;
static uint32_t MPE6RomCapacity, MPE6RomLength;
static uint8_t MPE6PreviousButtons, MPE6DisplayState;
static uint16_t MPE6TransferCursor, MPE6PendingCells;
static uint16_t MPE6PendingIndices[MPE3TitleCellsPerPacket];
static bool MPE6FrameReady, MPE6ForceReplace, MPE6FrameEndPending;
static bool MPE6MenuDirty, MPE6LastPacketAudio;
static uint32_t MPE6LastMicros, MPE6CycleDebt, MPE6CycleRemainder;
static uint32_t MPE6AudioRevision, MPE6PendingAudioRevision, MPE6LaunchToken;
static uint8_t *MPE6WorkspaceCursor, *MPE6WorkspaceLimit;

struct MPE6Sha256
{
   uint32_t state[8];
   uint64_t bytes;
   uint8_t block[64];
   uint8_t used;
};

static FLASHMEM uint32_t MPE6Ror(uint32_t value, uint8_t bits)
{ return (value >> bits) | (value << (32u - bits)); }

static FLASHMEM void MPE6ShaTransform(MPE6Sha256 &s, const uint8_t block[64])
{
   static const uint32_t k[64] PROGMEM = {
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
   uint32_t w[64];
   for (uint8_t i=0;i<16;i++) w[i] = (uint32_t(block[i*4])<<24) |
      (uint32_t(block[i*4+1])<<16) | (uint32_t(block[i*4+2])<<8) | block[i*4+3];
   for (uint8_t i=16;i<64;i++)
   {
      const uint32_t a=w[i-15], b=w[i-2];
      w[i]=(MPE6Ror(b,17)^MPE6Ror(b,19)^(b>>10))+w[i-7]+
         (MPE6Ror(a,7)^MPE6Ror(a,18)^(a>>3))+w[i-16];
   }
   uint32_t a=s.state[0],b=s.state[1],c=s.state[2],d=s.state[3];
   uint32_t e=s.state[4],f=s.state[5],g=s.state[6],h=s.state[7];
   for (uint8_t i=0;i<64;i++)
   {
      const uint32_t t1=h+(MPE6Ror(e,6)^MPE6Ror(e,11)^MPE6Ror(e,25))+
         ((e&f)^((~e)&g))+k[i]+w[i];
      const uint32_t t2=(MPE6Ror(a,2)^MPE6Ror(a,13)^MPE6Ror(a,22))+
         ((a&b)^(a&c)^(b&c));
      h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
   }
   const uint32_t v[8]={a,b,c,d,e,f,g,h};
   for (uint8_t i=0;i<8;i++) s.state[i]+=v[i];
}

static FLASHMEM void MPE6ShaInit(MPE6Sha256 &s)
{
   const uint32_t initial[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
   memcpy(s.state,initial,sizeof(initial));s.bytes=0;s.used=0;
}

static FLASHMEM void MPE6ShaUpdate(MPE6Sha256 &s,const uint8_t *data,uint32_t n)
{
   s.bytes+=n;
   while(n){const uint32_t room=64u-s.used;const uint8_t take=(uint8_t)(room<n?room:n);
      memcpy(s.block+s.used,data,take);s.used+=take;data+=take;n-=take;
      if(s.used==64){MPE6ShaTransform(s,s.block);s.used=0;}}
}

static FLASHMEM void MPE6ShaFinal(MPE6Sha256 &s,uint8_t out[32])
{
   const uint64_t bits=s.bytes*8u;s.block[s.used++]=0x80;
   if(s.used>56){while(s.used<64)s.block[s.used++]=0;MPE6ShaTransform(s,s.block);s.used=0;}
   while(s.used<56)s.block[s.used++]=0;
   for(int8_t i=7;i>=0;i--)s.block[s.used++]=(uint8_t)(bits>>(i*8));
   MPE6ShaTransform(s,s.block);
   for(uint8_t i=0;i<8;i++){out[i*4]=(uint8_t)(s.state[i]>>24);out[i*4+1]=(uint8_t)(s.state[i]>>16);out[i*4+2]=(uint8_t)(s.state[i]>>8);out[i*4+3]=(uint8_t)s.state[i];}
}

static FLASHMEM void *MPE6Take(uint32_t bytes,uint32_t alignment)
{
   uintptr_t cursor=(uintptr_t)MPE6WorkspaceCursor;
   cursor=(cursor+alignment-1u)&~(uintptr_t)(alignment-1u);
   if(cursor>(uintptr_t)MPE6WorkspaceLimit || bytes>(uintptr_t)MPE6WorkspaceLimit-cursor)return nullptr;
   MPE6WorkspaceCursor=(uint8_t *)(cursor+bytes);return (void *)cursor;
}

static FLASHMEM int MPE6CompareName(const char *a,const char *b)
{
   while(*a&&*b){const uint8_t ca=(*a>='A'&&*a<='Z')?*a+32:*a;
      const uint8_t cb=(*b>='A'&&*b<='Z')?*b+32:*b;if(ca!=cb)return ca<cb?-1:1;++a;++b;}
   return *a?1:*b?-1:0;
}

static FLASHMEM bool MPE6NesName(const char *name)
{
   const size_t n=strlen(name);if(n<5)return false;const char *e=name+n-4;
   return e[0]=='.'&&(e[1]=='n'||e[1]=='N')&&(e[2]=='e'||e[2]=='E')&&(e[3]=='s'||e[3]=='S');
}

static FLASHMEM void MPE6SetMessage(const char *text)
{
   if(!MPE6MenuState)return;strncpy(MPE6MenuState->message,text,sizeof(MPE6MenuState->message)-1);
   MPE6MenuState->message[sizeof(MPE6MenuState->message)-1]=0;
}

static FLASHMEM bool MPE6Enumerate()
{
   MPE6MenuState->count=MPE6MenuState->selected=MPE6MenuState->omitted=0;
   FsFile directory=SD.sdfs.open("/NESVM/ROMS",O_RDONLY);
   if(!directory||!directory.isDirectory()){MPE6SetMessage("/NESVM/ROMS NOT FOUND");directory.close();return false;}
   while(true)
   {
      FsFile entry;if(!entry.openNext(&directory,O_RDONLY))break;
      char name[MPE6NameBytes]{};const size_t n=entry.getName(name,sizeof(name));
      const bool valid=n&&n<sizeof(name)-1&&!entry.isDirectory()&&entry.fileSize()<=UINT32_MAX&&MPE6NesName(name);
      if(valid&&MPE6MenuState->count<MPE6MaximumRoms)
      {
         MPE6RomEntry &target=MPE6MenuState->roms[MPE6MenuState->count++];
         target.bytes=(uint32_t)entry.fileSize();strcpy(target.name,name);
      }
      else if(valid||(n>=sizeof(name)-1&&!entry.isDirectory()))++MPE6MenuState->omitted;
      entry.close();
   }
   const bool okay=!directory.getError();directory.close();
   if(!okay){MPE6SetMessage("ROM DIRECTORY READ FAILED");return false;}
   for(uint16_t i=1;i<MPE6MenuState->count;i++)for(uint16_t j=i;j&&MPE6CompareName(MPE6MenuState->roms[j].name,MPE6MenuState->roms[j-1].name)<0;j--)
   {const MPE6RomEntry t=MPE6MenuState->roms[j];MPE6MenuState->roms[j]=MPE6MenuState->roms[j-1];MPE6MenuState->roms[j-1]=t;}
   if(!MPE6MenuState->count)MPE6SetMessage("NO .NES FILES FOUND");
   else if(MPE6MenuState->omitted)MPE6SetMessage("SOME NAMES OMITTED (LIMIT 128/95 CHARS)");
   else MPE6SetMessage("FIRE OR RETURN RUNS THE HIGHLIGHTED ROM");
   return true;
}

static FLASHMEM void MPE6Cell(uint16_t cell,uint8_t character,bool inverse)
{
   uint8_t *out=MPE6Frozen->cells[cell];MPE5Glyph(character,out);
   if(inverse)for(uint8_t i=0;i<8;i++)out[i]^=0xff;
   out[8]=0x10;out[9]=1;
}

static FLASHMEM void MPE6Text(uint8_t row,uint8_t column,const char *text,bool inverse=false,uint8_t limit=40)
{
   for(uint8_t x=0;text[x]&&x<limit&&column+x<40;x++)MPE6Cell((uint16_t)row*40u+column+x,(uint8_t)text[x],inverse);
}

static FLASHMEM void MPE6BuildMenu()
{
   *MPE6Frozen=nes::VicFrame{};MPE6Frozen->hires=true;
   for(uint16_t cell=0;cell<1000;cell++)MPE6Cell(cell,' ',false);
   MPE6Text(0,8,"MHS NESVM - SELECT A ROM");MPE6Text(2,1,"/NESVM/ROMS");
   char status[41];const uint16_t count=MPE6MenuState->count;
   snprintf(status,sizeof(status),"ROM %u OF %u",count?MPE6MenuState->selected+1u:0u,count);MPE6Text(2,25,status);
   const uint16_t page=(MPE6MenuState->selected/MPE6RowsPerPage)*MPE6RowsPerPage;
   for(uint8_t row=0;row<MPE6RowsPerPage&&page+row<count;row++)
   {
      const bool selected=page+row==MPE6MenuState->selected;char line[39]{};
      const char *name=MPE6MenuState->roms[page+row].name;const size_t n=strlen(name);
      if(n<=36)snprintf(line,sizeof(line),"%c %-36s",selected?'>':' ',name);
      else{memcpy(line,"  ",2);memcpy(line+2,name,33);memcpy(line+35,"...",3);line[0]=selected?'>':' ';}
      MPE6Text(4+row,1,line,selected,38);
   }
   MPE6Text(22,0,MPE6MenuState->message,false,40);
   if(MPE6MenuState->lastHashValid)
   {
      static const char hex[]="0123456789ABCDEF";char h[24]="LAST SHA256 ";
      for(uint8_t i=0;i<6;i++){h[12+i*2]=hex[MPE6MenuState->lastHash[i]>>4];h[13+i*2]=hex[MPE6MenuState->lastHash[i]&15];}
      MPE6Text(23,0,h);
   }
   MPE6Text(24,1,"P2 UP/DOWN  FIRE OR RETURN TO RUN");
   MPE6TransferCursor=0;MPE6PendingCells=0;MPE6FrameReady=true;MPE6ForceReplace=true;MPE6FrameEndPending=false;MPE6MenuDirty=false;
}

static FLASHMEM bool MPE6HashFile(const char *path,uint32_t expected,uint8_t digest[32])
{
   FsFile file=SD.sdfs.open(path,O_RDONLY);if(!file||file.isDirectory()||file.fileSize()!=expected){file.close();return false;}
   MPE6Sha256 sha;MPE6ShaInit(sha);uint8_t buffer[512];uint32_t remaining=expected;
   while(remaining){const uint16_t n=remaining>sizeof(buffer)?sizeof(buffer):(uint16_t)remaining;
      if(file.read(buffer,n)!=n){file.close();return false;}MPE6ShaUpdate(sha,buffer,n);remaining-=n;}
   const bool okay=file.close();if(!okay)return false;MPE6ShaFinal(sha,digest);return true;
}

struct MPE6RasterContext { nes::SquishRenderer *renderer; };
static MPE6RasterContext MPE6Raster;
static void MPE6Pixel(void *context,uint16_t x,uint16_t y,uint8_t color)
{ static_cast<MPE6RasterContext *>(context)->renderer->pixel(x,y,color); }
static void MPE6Frame(void *context,uint64_t frame)
{
   MPE6RasterContext *r=static_cast<MPE6RasterContext *>(context);
   if(!MPE6FrameReady&&MPE6ModeState==MPE6Mode::Game)
   { memcpy(MPE6Frozen,&r->renderer->frame,sizeof(*MPE6Frozen));MPE6FrameReady=true;MPE6TransferCursor=0; }
   nes::SquishRenderer::finish(r->renderer,frame);
   nes::SidPacket packet;if(MPE6Sid->render(MPE6Machine->apu,packet))
   { MPE6LatestSid=packet;++MPE6AudioRevision;if(!MPE6AudioRevision)++MPE6AudioRevision; }
}

static FLASHMEM const char *MPE6RomMessage(nes::RomError error)
{
   switch(error){case nes::RomError::Mapper:return "UNSUPPORTED MAPPER";case nes::RomError::PrgSize:return "UNSUPPORTED PRG SIZE";
   case nes::RomError::ChrSize:return "UNSUPPORTED CHR SIZE";case nes::RomError::UnsupportedRegion:return "ONLY NTSC ROMS ARE SUPPORTED";
   case nes::RomError::Battery:return "BATTERY SAVES ARE NOT READY";case nes::RomError::None:return "";default:return "INVALID OR UNSUPPORTED NES FILE";}
}

static FLASHMEM bool MPE6LoadSelected()
{
   if(!MPE6MenuState->count)return false;const MPE6RomEntry &entry=MPE6MenuState->roms[MPE6MenuState->selected];
   char path[sizeof("/NESVM/ROMS/")+MPE6NameBytes];snprintf(path,sizeof(path),"/NESVM/ROMS/%s",entry.name);
   FsFile file=SD.sdfs.open(path,O_RDONLY);if(!file||file.isDirectory()||file.fileSize()!=entry.bytes){file.close();MPE6SetMessage("ROM CHANGED SINCE LISTING");return false;}
   uint8_t header[16];if(file.read(header,sizeof(header))!=sizeof(header)){file.close();MPE6SetMessage("ROM HEADER READ FAILED");return false;}
   nes::RomInfo info;nes::RomError error=nes::inspect(header,sizeof(header),entry.bytes,info);if(error==nes::RomError::None)error=nes::supported(info);
   if(error!=nes::RomError::None){file.close();MPE6SetMessage(MPE6RomMessage(error));return false;}
   const uint32_t extra=info.chr_bytes?0:info.chr_ram;if(entry.bytes>MPE6RomCapacity||extra>MPE6RomCapacity-entry.bytes){file.close();MPE6SetMessage("ROM DOES NOT FIT NESVM MEMORY");return false;}
   if(!file.seekSet(0)){file.close();MPE6SetMessage("ROM SEEK FAILED");return false;}uint32_t cursor=0;
   while(cursor<entry.bytes){const uint16_t n=entry.bytes-cursor>4096u?4096u:(uint16_t)(entry.bytes-cursor);
      if(file.read(MPE6RomBytes+cursor,n)!=n){file.close();MPE6SetMessage("ROM DATA READ FAILED");return false;}cursor+=n;}
   if(!file.close()){MPE6SetMessage("ROM CLOSE FAILED");return false;}
   uint8_t digest[32];if(!MPE6HashFile(path,entry.bytes,digest)){MPE6SetMessage("ROM REVALIDATION FAILED");return false;}
   MPE6Sha256 loaded;MPE6ShaInit(loaded);MPE6ShaUpdate(loaded,MPE6RomBytes,entry.bytes);uint8_t loadedDigest[32];MPE6ShaFinal(loaded,loadedDigest);
   if(memcmp(digest,loadedDigest,sizeof(digest))){MPE6SetMessage("ROM CHANGED DURING LOAD");return false;}
   memcpy(MPE6MenuState->lastHash,digest,sizeof(digest));MPE6MenuState->lastHashValid=true;
   nes::Cartridge cartridge;cartridge.info=info;cartridge.prg=MPE6RomBytes+info.prg_offset;
   cartridge.chr=info.chr_bytes?MPE6RomBytes+info.chr_offset:nullptr;cartridge.chr_ram=info.chr_bytes?nullptr:MPE6RomBytes+entry.bytes;
   *MPE6Renderer=nes::SquishRenderer(MPE6DisplayState&1);*MPE6Sid=nes::SidAdapter{};MPE6LatestSid={};MPE6Raster.renderer=MPE6Renderer;
   if(!MPE6Machine->init(cartridge,{&MPE6Raster,MPE6Pixel,MPE6Frame})){MPE6SetMessage("NES MACHINE START FAILED");return false;}
   *MPE6Presented=nes::VicFrame{};MPE6ModeState=MPE6Mode::Game;MPE6RomLength=entry.bytes;
   MPE6PreviousButtons=0;MPE6FrameReady=false;MPE6ForceReplace=true;MPE6FrameEndPending=false;MPE6TransferCursor=0;
   MPE6CycleDebt=MPE6CycleRemainder=0;MPE6LastMicros=micros();MPE6AudioRevision=MPE6PendingAudioRevision=0;++MPE6LaunchToken;if(!MPE6LaunchToken)++MPE6LaunchToken;
   MPE6SetMessage("START+SELECT RETURNS TO ROM LIST");return true;
}

static FLASHMEM void MPE6ReturnToMenu()
{
   MPE6ModeState=MPE6Mode::Menu;MPE6Machine->controller.set(0);MPE6Sid->silence(MPE6LatestSid);++MPE6AudioRevision;
   MPE6SetMessage("RETURNED - FIRE OR RETURN RUNS ROM");MPE6MenuDirty=true;MPE6FrameReady=false;MPE6ForceReplace=true;MPE6PreviousButtons=0;
}

static FLASHMEM bool MPE6AcceptInput()
{
   if(!MPE6InputPending)return true;const uint8_t buttons=MPE6InputButtons,pressed=buttons&~MPE6PreviousButtons;MPE6DisplayState=MPE6InputDisplay&1;
   if(MPE6ModeState==MPE6Mode::Menu)
   {
      if(MPE6MenuState->count&&(pressed&nes::Up)){MPE6MenuState->selected=MPE6MenuState->selected?MPE6MenuState->selected-1:MPE6MenuState->count-1;MPE6MenuDirty=true;}
      if(MPE6MenuState->count&&(pressed&nes::Down)){if(++MPE6MenuState->selected==MPE6MenuState->count)MPE6MenuState->selected=0;MPE6MenuDirty=true;}
      if(MPE6MenuState->count&&(pressed&(nes::A|nes::Start))&&!MPE6LoadSelected())MPE6MenuDirty=true;
   }
   else
   {
      if((buttons&(nes::Start|nes::Select))==(nes::Start|nes::Select)&&
         (pressed&(nes::Start|nes::Select)))MPE6ReturnToMenu();
      else{MPE6Machine->controller.set(buttons);MPE6Renderer->set_sharp(MPE6DisplayState&1);}
   }
   MPE6PreviousButtons=buttons;MPE6InputPending=false;return true;
}

static FLASHMEM void MPE6Pump()
{
   MPE6AcceptInput();if(!MPE6Active||MPE6ModeState!=MPE6Mode::Game||MPE6Machine->error!=nes::MachineError::None)return;
   const uint32_t now=micros(),elapsed=now-MPE6LastMicros;MPE6LastMicros=now;
   const uint64_t scaled=(uint64_t)elapsed*MPE6CpuHz+MPE6CycleRemainder;MPE6CycleDebt+=(uint32_t)(scaled/1000000u);MPE6CycleRemainder=(uint32_t)(scaled%1000000u);
   if(MPE6CycleDebt>MPE6MaximumDebt)MPE6CycleDebt=MPE6MaximumDebt;const uint32_t run=MPE6CycleDebt>MPE6CycleSlice?MPE6CycleSlice:MPE6CycleDebt;
   MPE6Machine->run_cycles(run);MPE6CycleDebt-=run;
   if(MPE6Machine->error!=nes::MachineError::None){MPE6ReturnToMenu();MPE6SetMessage(nes::describe(MPE6Machine->error));MPE6MenuDirty=true;}
}

static FLASHMEM void MPE6Reset()
{
   MPE6Active=MPE6InputPending=false;MPE6ModeState=MPE6Mode::Menu;MPE6MenuState=nullptr;MPE6Machine=nullptr;MPE6Renderer=nullptr;
   MPE6Frozen=MPE6Presented=nullptr;MPE6Sid=nullptr;MPE6RomBytes=nullptr;MPE6RomCapacity=MPE6RomLength=0;MPE6PreviousButtons=0;MPE6DisplayState=1;
   MPE6TransferCursor=MPE6PendingCells=0;MPE6FrameReady=MPE6ForceReplace=MPE6FrameEndPending=MPE6MenuDirty=MPE6LastPacketAudio=false;
   MPE6LastMicros=MPE6CycleDebt=MPE6CycleRemainder=MPE6AudioRevision=MPE6PendingAudioRevision=0;MPE6WorkspaceCursor=MPE6WorkspaceLimit=nullptr;MPE6LatestSid={};
}

static FLASHMEM bool MPE6Start(uint32_t root)
{
   uint8_t descriptor[MPE6DescriptorBytes];MPE6Reset();
   if(!MPE4Read(nullptr,root,descriptor,sizeof(descriptor))||memcmp(descriptor,"N6D1",4)||descriptor[4]!=MPE6Protocol||descriptor[5]!=sizeof(descriptor)||
      (descriptor[6]&3)!=3||strcmp((char *)descriptor+16,"/NESVM/ROMS")||strcmp((char *)descriptor+48,"/NESVM/SAVES")||
      strcmp((char *)descriptor+80,"NES-INPUT-V1")||strcmp((char *)descriptor+112,"NES-SID-V1")||MHSNativeRead32(descriptor+124)!=MHSNativeCRC32(descriptor,124))return false;
   uint8_t *workspace;uint32_t bytes;if(!MPE5BorrowCartridgeTail(&workspace,&bytes))return false;MPE6WorkspaceCursor=workspace;MPE6WorkspaceLimit=workspace+bytes;
   void *menuStorage=MPE6Take(sizeof(MPE6Menu),alignof(MPE6Menu));
   void *machineStorage=MPE6Take(sizeof(nes::Machine),alignof(nes::Machine));
   void *rendererStorage=MPE6Take(sizeof(nes::SquishRenderer),alignof(nes::SquishRenderer));
   void *frozenStorage=MPE6Take(sizeof(nes::VicFrame),alignof(nes::VicFrame));
   void *presentedStorage=MPE6Take(sizeof(nes::VicFrame),alignof(nes::VicFrame));
   void *sidStorage=MPE6Take(sizeof(nes::SidAdapter),alignof(nes::SidAdapter));
   if(!menuStorage||!machineStorage||!rendererStorage||!frozenStorage||!presentedStorage||!sidStorage)return false;
   MPE6MenuState=new(menuStorage) MPE6Menu{};
   MPE6Machine=new(machineStorage) nes::Machine{};
   MPE6Renderer=new(rendererStorage) nes::SquishRenderer(true);
   MPE6Frozen=new(frozenStorage) nes::VicFrame{};
   MPE6Presented=new(presentedStorage) nes::VicFrame{};
   MPE6Sid=new(sidStorage) nes::SidAdapter{};
   MPE6WorkspaceCursor=(uint8_t *)(((uintptr_t)MPE6WorkspaceCursor+31u)&~(uintptr_t)31u);if(MPE6WorkspaceCursor>=MPE6WorkspaceLimit)return false;
   MPE6RomBytes=MPE6WorkspaceCursor;MPE6RomCapacity=(uint32_t)(MPE6WorkspaceLimit-MPE6RomBytes);MPE6Enumerate();MPE6BuildMenu();
   MPE3Title.Loaded=true;MPE3Title.Phase=MPE3TitleFinished;MPE3TitleMailbox[0xfc]=MPE3TitleMailbox[0xfd]=MPE3TitleMailbox[0xfe]=MPE3TitleMailbox[0xff]=0;
   MPE3TitleMemoryBarrier();MPE6Active=true;return true;
}

// ISR-only: validate and latch one complete NES-INPUT-V1 held snapshot.
static inline void MPE6LatchInput()
{
   const uint8_t sequence=MPE3TitleMailbox[0xfe],protocol=MPE3TitleMailbox[0xfd];if(!sequence||protocol!=0x81||sequence==MPE3TitleMailbox[0xfc]||MPE6InputPending)return;
   const uint8_t buttons=MPE3TitleMailbox[0xf8],display=MPE3TitleMailbox[0xf9],overflow=MPE3TitleMailbox[0xfa];
   if((display&~1u)||(uint8_t)(0xa5^buttons^display^overflow^protocol^sequence)!=MPE3TitleMailbox[0xff])return;
   MPE6InputButtons=buttons;MPE6InputDisplay=display;MPE6InputOverflow=overflow;MPE3TitleMemoryBarrier();MPE6InputPending=true;MPE3TitleMailbox[0xfc]=sequence;
}

static FLASHMEM void MPE6PublishSid(bool frameEnd)
{
   memcpy(MPE3TitlePacket+MPE3TitlePacketHeaderBytes,MPE6LatestSid.bytes,sizeof(MPE6LatestSid.bytes));
   MPE6PendingAudioRevision=MPE6AudioRevision;MPE6FrameEndPending=frameEnd;MPE6LastPacketAudio=true;
   MPE3TitlePublish(MPE3TitleSID,0x21u|((MPE6ModeState==MPE6Mode::Menu||MPE6Frozen->hires)?MPE3TitleCellHires:0),sizeof(MPE6LatestSid.bytes));
}

static FLASHMEM void MPE6NextPacket()
{
   MPE6Pump();if(!MPE6Active)return;if(MPE6ModeState==MPE6Mode::Menu&&MPE6MenuDirty)MPE6BuildMenu();
   if(MPE6ModeState==MPE6Mode::Game&&!MPE6ForceReplace&&!MPE6FrameEndPending&&!MPE6LastPacketAudio&&MPE6AudioRevision!=MPE6PendingAudioRevision)
   {MPE6PublishSid(false);return;}
   if(MPE6FrameReady)
   {
      uint8_t count=0;const bool replacement=MPE6ForceReplace;while(MPE6TransferCursor<1000u&&count<MPE3TitleCellsPerPacket)
      {
         const uint16_t cell=MPE6TransferCursor++;if(!replacement&&!memcmp(MPE6Frozen->cells[cell],MPE6Presented->cells[cell],10))continue;
         uint8_t *record=MPE3TitlePacket+MPE3TitlePacketHeaderBytes+count*MPE3TitleCellBytes;record[0]=(uint8_t)cell;record[1]=(uint8_t)(cell>>8);memcpy(record+2,MPE6Frozen->cells[cell],10);MPE6PendingIndices[count++]=cell;
      }
      if(count)
      {
         MPE6PendingCells=count;uint8_t flags=MPE3TitleCellModeValid|(MPE6Frozen->hires?MPE3TitleCellHires:0);
         if(replacement){flags|=1;if(MPE6TransferCursor==1000u)flags|=2;if(MPE6TransferCursor<=MPE3TitleCellsPerPacket)flags|=MPE3TitleCellReplace;}
         MPE6LastPacketAudio=false;MPE3TitlePublish(MPE3TitleCELL,flags,count*MPE3TitleCellBytes);return;
      }
      MPE6PublishSid(true);return;
   }
   MPE6PublishSid(false); // idle heartbeat keeps input flowing and bounded
}

static FLASHMEM void MPE6ResumeAfterACK()
{
   if(MPE3Title.PendingType==MPE3TitleCELL)
   {
      for(uint16_t i=0;i<MPE6PendingCells;i++){const uint16_t cell=MPE6PendingIndices[i];memcpy(MPE6Presented->cells[cell],MPE6Frozen->cells[cell],10);}MPE6PendingCells=0;
   }
   else if(MPE3Title.PendingType==MPE3TitleSID)
   {
      if(MPE6PendingAudioRevision==MPE6AudioRevision)MPE6PendingAudioRevision=MPE6AudioRevision;
      if(MPE6FrameEndPending){MPE6Presented->hires=MPE6Frozen->hires;MPE6FrameReady=false;MPE6ForceReplace=false;MPE6TransferCursor=0;MPE6FrameEndPending=false;}
   }
}

static FLASHMEM void MPE6PumpPending(){MPE6Pump();}
