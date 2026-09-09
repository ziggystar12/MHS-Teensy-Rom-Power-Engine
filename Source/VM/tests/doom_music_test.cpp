// Actual stream reader, mixer and module scheduler; fake video/file/clock only.
#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
#include <fstream>
#include "../doom/gba/doomvm.cpp"
extern "C" {
#include "../doom/gba/sound.c"
}
using gbadoomvm::SidStream;
static std::vector<uint8_t> disk;
static bool missing,badRead,busy;
static uint32_t clockNow,steps,closes,reads;
static bool expectedNtsc;
static uint32_t opens;
static uint32_t openMusic(const char *name,VmFileInfo *info){assert(!strcmp(name,expectedNtsc?"/VMS/DOOMVM/doom-e1m1-ntsc.s3m":"/VMS/DOOMVM/doom-e1m1-pal.s3m"));opens++;if(missing)return 0;*info={};info->bytes=disk.size();return 7;}
static int32_t readMusic(uint32_t h,uint32_t off,void *to,uint32_t n){assert(h==7);reads++;if(badRead||off>disk.size())return -1;if(n>7)n=7;if(n>disk.size()-off)n=disk.size()-off;memcpy(to,disk.data()+off,n);return n;}
static void closeMusic(uint32_t h){assert(h==7);closes++;}
namespace gbadoomvm {
bool prepare(const VmHost *){return true;}bool start(){GbaSoundReset();return true;}
bool step(uint32_t){steps++;GbaSoundTick();return true;}void close(){stopMusic();}
Metrics metrics(){return {};}
const uint8_t *pixels(){static uint8_t p[64000];return p;}
const uint8_t *palette(){static uint8_t p[768];return p;}
}
extern "C" void GbaHudMode(unsigned){}
static void word(unsigned p,uint32_t n){for(unsigned i=0;i<4;i++)disk[p+i]=n>>(8*i);}
static void headerCrc(){const auto c=SidStream::crc(disk.data(),30);disk[30]=c;disk[31]=c>>8;}
static void fixture(){
 disk.assign(32+6*28,0);memcpy(disk.data(),"M3SM",4);disk[4]=1;disk[6]=28;word(8,20000);word(12,6);word(16,2);headerCrc();
 for(unsigned n=0;n<6;n++){auto p=disk.data()+32+n*28;p[0]=7;for(unsigned b:{1u,8u,15u}){p[b]=n+10;p[b+1]=20;p[b+4]=0x41;p[b+6]=0xf0;}p[25]=15;const auto c=SidStream::crc(p,26);p[26]=c;p[27]=c>>8;}
}
int main(int argc,char **argv){
 VmHost h{};h.abi=VM_ABI;h.bytes=sizeof h;h.services=VM_HOST_SERVICES;h.open=openMusic;h.read=readMusic;h.close=closeMusic;
 h.micros_now=[](){return clockNow;};h.fail=[](uint8_t,uint32_t){assert(false);};
 alignas(8) static uint8_t workspace[65536],guest[VM_RAM2_GUEST_BYTES];h.workspace=workspace;h.workspace_bytes=sizeof workspace;h.guest_ram=guest;h.guest_ram_bytes=sizeof guest;
 h.video_configure=[](const VmIndexedVideoSetup *){return true;};h.video_indexed=[](VmIndexedFrame *f){f->resolved_mode=2;return busy?VmVideoResult::Busy:VmVideoResult::Transferred;};
 fixture();SidStream stream;stream.open(&h);assert(stream.handle&&stream.tick(0xffff0000));assert(stream.value[1]==10);
 assert(!stream.tick(0xffff0000+10000));assert(stream.tick(uint32_t(0xffff0000u+120000u))&&stream.index==2);
 assert(stream.tick(uint32_t(0xffff0000u+260000u))&&stream.index==5);stream.close();
 const auto good=disk;
 expectedNtsc=true;stream.open(&h,true);assert(!stream.handle); // Wrong-standard header fails closed.
 disk[5]=1;headerCrc();stream.open(&h,true);assert(stream.handle&&stream.tick(0));stream.close();expectedNtsc=false;
 for(unsigned pos:{0u,4u,5u,6u,7u,8u,12u,16u,20u,30u}){disk=good;disk[pos]^=0x80;if(pos==12||pos==16||pos==20)headerCrc();stream.open(&h);assert(!stream.handle);}
 disk=good;missing=true;stream.open(&h);assert(!stream.handle);missing=false;
 stream.open(&h);badRead=true;assert(stream.tick(0)&&!stream.handle);badRead=false;
 disk=good;disk[40]^=1;stream.open(&h);assert(stream.tick(0)&&!stream.handle);
 disk=good;stream.open(&h);assert(stream.tick(0));uint8_t pure[26],mixed[26];memcpy(pure,stream.value,26);GbaSoundReset();
 GbaSoundMusicPayload(mixed,pure);assert(!memcmp(mixed,pure,26));
 I_StartSound(sfx_pistol,0,120,128);GbaSoundMusicPayload(mixed,pure);
 assert(!memcmp(mixed+1,pure+1,14)&&mixed[19]==0x81&&(mixed[0]&4));
 GbaSoundMusicPayload(mixed,pure);assert(!(mixed[0]&4)); // Music voice-3 notes must not restart the borrowed effect.
 GbaSoundStop(0);GbaSoundMusicPayload(mixed,pure);assert(!memcmp(mixed+1,pure+1,25)&&(mixed[0]&4));stream.close();
 // Actual adapter continues music while video is Busy and freezes offered audio.
 fixture();clockNow=0;const auto module=vm_entry(&h);assert(module);VmPacket p{};
 const auto beforeOpen=opens;
 VmInput timing{0,2,0,0x91};module->input(&timing);module->pump();assert(opens==beforeOpen);
 timing.display=0;module->input(&timing);assert(opens==beforeOpen);module->pump();assert(opens==beforeOpen+1);
 timing.display=1;module->input(&timing);module->pump();assert(opens==beforeOpen+1&&gbadoomvm::musicStandard==0);
 clockNow=30000;module->pump();module->pump();assert(module->packet(&p)&&(p.flags&1));module->ack();
 busy=true;unsigned audio=0;
 for(unsigned i=0;i<100;i++){clockNow+=10000;module->pump();if(module->packet(&p)){
   assert(p.type==2&&p.length==26&&!(p.flags&1));audio++;const auto frozen=gbadoomvm::music.index;
   for(unsigned n=0;n<4;n++){module->pump();assert(!module->packet(&p));}assert(gbadoomvm::music.index==frozen);module->ack();
 }}
 assert(audio>=49&&audio<=51);busy=false;
 VmInput toggle{0,0x32,0,0x80};module->input(&toggle);assert(gbadoomvm::musicMuted);module->input(&toggle);assert(gbadoomvm::musicMuted);
 toggle.display=0;module->input(&toggle);toggle.display=0x32;module->input(&toggle);assert(!gbadoomvm::musicMuted);
 gbadoomvm::music.close();
 // NTSC metadata arriving during an outstanding frame cannot alter its audio.
 fixture();disk[5]=1;headerCrc();expectedNtsc=true;clockNow=0;assert(vm_entry(&h));
 clockNow=30000;module->pump();module->pump();assert(module->packet(&p));const auto beforeNtsc=opens;
 timing.display=1;module->input(&timing);module->pump();assert(opens==beforeNtsc);
 module->ack();module->pump();assert(opens==beforeNtsc+1&&gbadoomvm::music.handle);gbadoomvm::music.close();
 if(argc>1){std::ifstream f(argv[1],std::ios::binary);disk={std::istreambuf_iterator<char>(f),{}};assert(disk.size()>32);expectedNtsc=disk[5]==1;stream.open(&h,expectedNtsc);assert(stream.handle);
  for(unsigned n=0;n<stream.count+100;n++)assert(stream.tick(n*20000));stream.close();}
 printf("PASS PAL/NTSC auto-selection and header match, deferred one-shot open, SID bounds/CRC/short reads/clock wrap/loop, voice borrowing/restoration, M toggle, %u audio packets during Busy video; %s\n",audio,argc>1?"supplied music all frames checked":"synthetic music fixture");
}
