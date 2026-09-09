#include <cassert>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <functional>
#include <fstream>
#include <iterator>
#include "../DriveDirectorySupport.h"
#define FLASHMEM
#include "../MinimalBoot/Common/Menu_Regs.h"
static uint8_t registers[IO1Size];
static volatile uint8_t* IO1=registers;
static StructMenuItem* MenuSource;
static uint16_t SelItemFullIdx, NumItemsFull;
static char DriveDirPath[256];
static unsigned messages=0;
static const char* UpDirString="/.. <Up Dir>";
#include "../MinimalBoot/Common/IO_Handlers/DesktopMenuView.c"
static void SendMsgPrintfln(const char*, ...) { ++messages; }

// Read-only Arduino FS seam. Production discovery/CRC/guard/launch code runs
// below; this fixture deliberately has no rename/remove/write API.
#define FILE_READ 0
#define INPUT_PULLDOWN 2
struct FS;
struct TestFile { std::string name, data; bool directory=false; };
struct File {
   FS* fs=nullptr;
   std::shared_ptr<TestFile> entry;
   bool root=false;
   size_t position=0;
   File()=default;
   File(FS* source,bool isRoot,std::shared_ptr<TestFile> node=nullptr):fs(source),entry(node),root(isRoot){}
   operator bool() const;
   bool isDirectory() const { return root || (entry && entry->directory); }
   uint64_t size() const { return entry ? entry->data.size() : 0; }
   const char* name() const {
      if(!entry)return "";
      const char* name=entry->name.c_str(),*slash=strrchr(name,'/');
      return slash?slash+1:name;
   }
   int read(uint8_t* out,size_t count);
   File openNextFile();
   void close();
};
struct FS {
   bool inserted=true,mounted=false,failInit=false,failRoot=false,probeConfigured=false;
   bool emulateSDIOStream=false,readStreamActive=false;
   unsigned mediaChecks=0,streamStatusFaults=0;
   unsigned rootOpens=0,fileOpens=0,initCalls=0,presenceProbes=0,probeSettleUs=0,totalDelayUs=0,nextCalls=0;
   size_t bytesRead=0,failReadAfter=SIZE_MAX;
   std::string failOpen;
   std::function<void()> duringRead,duringNext;
   std::map<std::string,std::shared_ptr<TestFile>> files;
   std::vector<std::string> order;
   static std::string folded(std::string text) {
      for(char& c:text)if(c>='A'&&c<='Z')c=char(c+'a'-'A');
      return text;
   }
   void add(const std::string& name,const std::string& data="firmware HEX fixture",bool directory=false) {
      const std::string key=folded("/"+name);
      if(!files.count(key))order.push_back(key);
      std::shared_ptr<TestFile> entry(new TestFile);
      entry->name=name;entry->data=data;entry->directory=directory;files[key]=entry;
   }
   bool available() const{return mounted&&inserted;}
   bool mediaPresent() {
      ++mediaChecks;
      // Teensy 4.1 SD.mediaPresent() issues an extra CMD13 during SdFat's
      // retained FIFO read. Simulate a transient status-command failure while
      // file reads work: SD then switches DAT3 to GPIO and poisons the stream.
      if(emulateSDIOStream&&readStreamActive) {
         ++streamStatusFaults;mounted=false;readStreamActive=false;
      }
      return available();
   }
   File open(const char* path,int=FILE_READ) {
      if(!available())return {};
      const std::string key=folded(path);
      if(key=="/"){++rootOpens;return failRoot ? File() : File(this,true);}
      ++fileOpens;
      if(key==folded(failOpen)||!files.count(key))return {};
      return File(this,false,files[key]);
   }
};
File::operator bool() const{return fs&&fs->available()&&(root||entry);}
void File::close(){if(fs)fs->readStreamActive=false;fs=nullptr;entry.reset();root=false;}
File File::openNextFile() {
   if(fs)++fs->nextCalls;
   if(fs&&fs->duringNext){auto callback=fs->duringNext;fs->duringNext=nullptr;callback();}
   if(!*this||!isDirectory())return {};
   const std::string prefix=root?"/":"/"+entry->name+"/";
   while(position<fs->order.size()) {
      const std::string key=fs->order[position++];
      if(fs->files.count(key)&&key.compare(0,prefix.size(),FS::folded(prefix))==0&&
         key.size()>prefix.size()&&key.find('/',prefix.size())==std::string::npos)
         return File(fs,false,fs->files[key]);
   }
   return {};
}
int File::read(uint8_t* out,size_t count) {
   if(!*this||!entry||entry->directory)return -1;
   if(fs->duringRead){auto callback=fs->duringRead;fs->duringRead=nullptr;callback();}
   if(!*this||fs->bytesRead>=fs->failReadAfter)return -1;
   size_t available=entry->data.size()-position;
   if(count>available)count=available;
   if(count>fs->failReadAfter-fs->bytesRead)count=fs->failReadAfter-fs->bytesRead;
   memcpy(out,entry->data.data()+position,count);position+=count;fs->bytesRead+=count;
   if(fs->emulateSDIOStream&&count)fs->readStreamActive=true;
   return int(count);
}
static FS firstPartition,SD;
static uint32_t TestSDGeneration=0;
static int TestSDState=0;
static uint32_t TestSDErrorGeneration=UINT32_MAX;
// Teensy SD 1.61 waits 5us after configuring DAT3 as INPUT_PULLDOWN.
// Card insertion, successful mounting and the settled pin voltage are separate
// states: reading immediately after pinMode must not pretend the card is ready.
static void pinMode(unsigned pin,unsigned mode){
   assert(pin==46&&mode==INPUT_PULLDOWN);++SD.presenceProbes;SD.probeConfigured=true;SD.probeSettleUs=0;
}
void delayMicroseconds(unsigned count){SD.probeSettleUs+=count;SD.totalDelayUs+=count;}
static bool digitalReadFast(unsigned pin){assert(pin==46);return SD.inserted&&SD.probeConfigured&&SD.probeSettleUs>=5;}
static void TestSDObserve(int state) {
   if(state!=TestSDState){TestSDState=state;if(++TestSDGeneration==0)++TestSDGeneration;}
}
uint32_t SDMediaGeneration(){return TestSDGeneration;}
void SDRequestExplicitRefresh(){if(++TestSDGeneration==0)++TestSDGeneration;}
bool SDFullInit(){
   if(SD.mediaPresent()){TestSDObserve(2);return true;}
   pinMode(46,INPUT_PULLDOWN);delayMicroseconds(5);
   if(!digitalReadFast(46)){SD.mounted=false;TestSDObserve(1);return false;}
   if(TestSDState==3&&TestSDErrorGeneration==TestSDGeneration)return false;
   ++SD.initCalls;SD.mounted=SD.inserted&&!SD.failInit;TestSDObserve(SD.mounted?2:3);
   if(!SD.mounted)TestSDErrorGeneration=TestSDGeneration;
   return SD.mediaPresent();
}
static unsigned TestFirmwareInterruptAt=0;
static void DesktopFirmwareTestHook(unsigned Point);
#define DESKTOP_FIRMWARE_TEST_HOOK(Point) DesktopFirmwareTestHook(Point)
#include "../MinimalBoot/Common/IO_Handlers/DesktopFirmwareTarget.c"
#undef DESKTOP_FIRMWARE_TEST_HOOK
static void DesktopFirmwareTestHook(unsigned Point) {
   if(TestFirmwareInterruptAt!=Point)return;
   TestFirmwareInterruptAt=0;
   IO1[wRegControl]=rCtlFirmwareCancel;
   DesktopFirmwareCancel();
}

// Execute the unmodified production launch function. Only external hardware and
// unrelated file parsers are stubbed; a flash call records its source and path
// and returns, as a rejected/failed flash would on the physical device.
static unsigned flashes=0;
static unsigned flashCalls=0;
static FS* flashSource;
static char flashPath[358];
static bool flashCRCGuarded=false;
static uint32_t flashExpectedCRC=0;
static void DoFlashUpdate(FS* source,const char* path,uint32_t expectedCRC,bool verifyCRC) {
   ++flashCalls;
   flashCRCGuarded=verifyCRC;flashExpectedCRC=expectedCRC;
   if(verifyCRC) {
      File file=source->open(path,FILE_READ);uint8_t data[64];uint32_t value=UINT32_MAX;
      if(!file)return;
      for(;;) {const int count=file.read(data,sizeof data);if(count<0)return;if(!count)break;
         for(int index=0;index<count;++index)value=DesktopFirmwareCRCByte(value,data[index]);}
      if(~value!=expectedCRC)return;
   }
   ++flashes; flashSource=source; strcpy(flashPath,path);
}
static const size_t MaxNamePathLength=358;
static bool PathIsRoot(){return !strcmp(DriveDirPath,"/");}
static void UpDirectory(){} void LoadDirectory(FS*);
static void LoadDxxDirectory(FS*,uint8_t){}
static void SetNumItems(uint16_t count){NumItemsFull=count;MenuViewRebuild();MenuViewSetTop(0);}
static uint16_t NumDrvDirMenuItems=0;
static bool LoadDxxFile(StructMenuItem*,FS*){return false;}
static unsigned ordinaryLoads=0;
static bool LoadFile(FS*,const char*,StructMenuItem*){++ordinaryLoads;return false;}
static void MenuChange(){}
static uint8_t RAM_Image[16], *XferImage, *LOROM_Image, *HIROM_Image;
static uint32_t XferSize,StreamOffsetAddr;
static bool ParseCRTHeader(StructMenuItem*,uint8_t*,uint8_t*){return false;}
static void FreeCrtChips(){} static void Printf_dbg(const char*,...){}
static bool ParseChipHeader(uint8_t*,const char*){return false;}
static bool SetTypeFromCRT(StructMenuItem*,uint8_t,uint8_t){return false;}
static void ParseP00File(StructMenuItem*){} static void ParseSIDHeader(const char*){}
static bool ParseKLAHeader(){return false;} static bool ParseARTHeader(){return false;}
static uint8_t ToPETSCII(uint8_t c){return c;}
static void IOHandlerSelectInit(){}
static char LatestSIDLoaded[512];
static StructMenuItem TeensyROMMenu[1];
static struct {uint8_t ChipROM[1];size_t ROMSize;} CrtChips[1];
static unsigned NumCrtChips;
static const unsigned CRT_MAIN_HDR_LEN=64,CRT_CHIP_HDR_LEN=16,eepAdNextIOHndlr=0;
static struct {uint8_t read(unsigned){return 0;}} EEPROM;
static bool EmulateVicCycles,doReset;
// HandleExecution now offers VM packages before its ordinary file routes. The
// firmware-target harness exercises only .hex and legacy launch behavior.
namespace VmRegistry {
   static bool tryLaunch(uint8_t,const char*,const char*) { return false; }
   static void refresh(bool){}
}
#define SetGameAssert ((void)0)
#define SetGameDeassert ((void)0)
#define SetExROMAssert ((void)0)
#define SetExROMDeassert ((void)0)
#define NVIC_DISABLE_IRQ(...) ((void)0)
#include "handle-execution-under-test.h"

// Exercise real directory enumeration, pooled names and sorting before the
// firmware guard. Hand-built menu records used to conceal missing file sizes.
static StructMenuItem* DriveDirMenu=nullptr;
static const unsigned MaxMenuItems=4000;
static struct {void println(const char*){}} Serial;
static uint32_t millis(){return 100;}
void AddDirEntry(const char*);
static uint8_t Assoc_Ext_ItemType(const char* name){
   const char* dot=strrchr(name,'.');
   return dot&&FS::folded(dot)==".hex"?rtFileHex:rtFilePrg;
}
#include "drive-directory-under-test.h"

// The command dispatcher is also production code; record the target passed to
// the already-tested transactional file engine without touching a filesystem.
static struct {
   unsigned state=0, deletes=0, copies=0;
   std::string target;
   void confirmDelete(){} void paste(uint8_t,const char*){}
   void reject(uint8_t,const char*){assert(false);}
   void copy(uint8_t,const char* directory,const char* name){++copies;target=std::string(directory)+"/"+name;}
   void prepareDelete(uint8_t,const char* directory,const char* name){++deletes;target=std::string(directory)+"/"+name;}
} DesktopFileEngine;
static void DesktopFilePublish(){} static void DesktopFileRefresh(){}
#include "file-command-under-test.h"

int main(int argc,char** argv) {
   char first[]="MPE_Firmware-V1.0.4.hex", second[]="Other_Firmware.hex";
   StructMenuItem items[2]={{rtFileHex,0,first,nullptr,1234},{rtFileHex,0,second,nullptr,3456}};
   auto reset=[&]() {
      SD=FS();firstPartition=FS();SD.mounted=firstPartition.mounted=true;
      SD.add("firmware/"+std::string(first),std::string(1234,'S'));
      SD.add("firmware/"+std::string(second),std::string(3456,'T'));
      firstPartition.add("firmware/"+std::string(first),std::string(1234,'U'));
      firstPartition.add("firmware/"+std::string(second),std::string(3456,'V'));
      DesktopFirmwareCancel(); MenuSource=items;NumItemsFull=2;SelItemFullIdx=0;
      IO1[rWRegCurrMenuWAIT]=rmtSD;strcpy(DriveDirPath,"/firmware");
      items[0].ItemType=rtFileHex;items[0].Size=1234;items[0].Name=first;
   };
   auto prepare=[&]() { IO1[wRegControl]=rCtlFirmwarePrepareWAIT;DesktopFirmwareCommand(); };
   auto confirm=[&]() { IO1[wRegControl]=rCtlFirmwareCheckWAIT;DesktopFirmwareCommand(); };
   unsigned checks=0;
   for(unsigned fault=0;fault<9;++fault) {
      reset();prepare();assert(IO1[rRegFirmwareTargetState]==1);
      assert(!strcmp(DesktopFirmware.name,first));
      char path[358];assert(DesktopFirmware.pathName(path,sizeof path));
      assert(!strcmp(path,"/firmware/MPE_Firmware-V1.0.4.hex"));
      confirm();assert(DesktopFirmware.confirmed);
      uint32_t expectedCRC=0;
      assert(DesktopFirmwareCRCValid&&DesktopFirmwareExpectedCRC(expectedCRC)&&expectedCRC==DesktopFirmwareCRC);
      switch(fault) {
         case 1:SelItemFullIdx=1;break;
         case 2:IO1[rWRegCurrMenuWAIT]=rmtUSBDrive;break;
         case 3:strcpy(DriveDirPath,"/other");break;
         case 4:items[0].Name=second;break;
         case 5:items[0].ItemType=rtFilePrg;break;
         case 6:items[0].Size=1235;break;
         case 7:MenuSource=items+1;NumItemsFull=1;break;
         case 8:MenuSource=nullptr;NumItemsFull=0;break;
      }
      StructMenuItem selected{};uint8_t source=0xff;
      const auto previousMessages=messages;
      assert(DesktopFirmwareBegin(selected,source)==(fault==0));
      assert(DesktopFirmware.armed && !DesktopFirmware.confirmed);
      if(!fault) {
         assert(source==rmtSD && selected.ItemType==rtFileHex && selected.Size==1234);
         assert(selected.Name==DesktopFirmware.name && !strcmp(selected.Name,first));
         // The launch record/path remain the captured values after validation.
         SelItemFullIdx=1;strcpy(DriveDirPath,"/changed-after-check");
         assert(!strcmp(selected.Name,first));
         assert(DesktopFirmware.pathName(path,sizeof path));
         assert(!strcmp(path,"/firmware/MPE_Firmware-V1.0.4.hex"));
         assert(messages==previousMessages);
      } else assert(messages==previousMessages+1 && IO1[rRegFirmwareTargetState]==2);
      assert(!DesktopFirmwareBegin(selected,source));
      assert(DesktopFirmware.armed && !DesktopFirmware.confirmed);
      ++checks;
   }
   reset();prepare();
   StructMenuItem selected{};uint8_t source=0xff;
   assert(!DesktopFirmwareBegin(selected,source)); // A remote start before affirmative cannot flash.
   assert(!DesktopFirmwareBegin(selected,source) && DesktopFirmware.armed);
   ++checks;
   reset();prepare();SelItemFullIdx=1;confirm();assert(IO1[rRegFirmwareTargetState]==2);
   assert(!DesktopFirmwareBegin(selected,source));++checks;
   reset();prepare();confirm();DesktopFirmwareCancel();
   assert(!DesktopFirmware.armed && !DesktopFirmware.confirmed && IO1[rRegFirmwareTargetState]==0);++checks;
   reset();prepare();confirm();prepare();assert(!DesktopFirmware.confirmed);++checks;
   for(const auto& invalid: {std::string(101,'x'),std::string("bad/name.hex"),std::string("bad\\name.hex"),std::string("bad\1name.hex")}) {
      reset();items[0].Name=const_cast<char*>(invalid.c_str());prepare();
      assert(IO1[rRegFirmwareTargetState]==3 && !DesktopFirmware.confirmed);++checks;
   }
   reset();items[0].ItemType=rtFilePrg;prepare();assert(IO1[rRegFirmwareTargetState]==3);++checks;
   reset();IO1[rWRegCurrMenuWAIT]=rmtTeensy;prepare();assert(IO1[rRegFirmwareTargetState]==3);++checks;
   reset();strcpy(DriveDirPath,"/");prepare();char root[358];
   assert(DesktopFirmware.pathName(root,sizeof root) && !strcmp(root,"/MPE_Firmware-V1.0.4.hex"));
   char tiny[5];assert(!DesktopFirmware.pathName(tiny,sizeof tiny));++checks;

   // The GUI's explicit file path deliberately has no version gate. This is
   // how a distinct test image with the installed visible version is reflashed.
   const std::string manualSame=std::string("MPE_Firmware-V")+MPE_FIRMWARE_VERSION+".hex";
   reset();SD.add("firmware/"+manualSame,std::string(1234,'Q'));
   items[0].Name=const_cast<char*>(manualSame.c_str());prepare();confirm();
   unsigned manualSameBefore=flashes;HandleExecution();
   assert(flashes==manualSameBefore+1&&flashCRCGuarded&&
      !strcmp(flashPath,("/firmware/"+manualSame).c_str()));++checks;

   // No prepare means the classic recovery-menu HEX path remains reachable.
   reset();unsigned before=flashes,callsBefore=flashCalls;HandleExecution();
   assert(flashes==before+1 && flashCalls==callsBefore+1 && !flashCRCGuarded && flashSource==&SD);
   assert(!strcmp(flashPath,"/firmware/MPE_Firmware-V1.0.4.hex"));++checks;
   // Prepare alone must block every start, even if a remote selects another file.
   reset();prepare();before=flashes;HandleExecution();SelItemFullIdx=1;HandleExecution();
   assert(flashes==before && DesktopFirmware.armed && !DesktopFirmware.confirmed);++checks;
   // A changed selection after affirmative must never reach the flasher, on any attempt.
   reset();prepare();confirm();SelItemFullIdx=1;before=flashes;
   HandleExecution();HandleExecution();assert(flashes==before && DesktopFirmware.armed);++checks;
   // The approved source/name reach the actual flasher, then a returned flash
   // consumes its approval and subsequent starts remain guarded.
   reset();IO1[rWRegCurrMenuWAIT]=rmtUSBDrive;prepare();confirm();before=flashes;
   HandleExecution();assert(flashes==before+1 && flashSource==&firstPartition);
   assert(flashCRCGuarded&&flashExpectedCRC==DesktopFirmwareCRC);
   assert(!strcmp(flashPath,"/firmware/MPE_Firmware-V1.0.4.hex"));
   HandleExecution();SelItemFullIdx=1;HandleExecution();assert(flashes==before+1);++checks;
   // Explicit close ends the capture; the next independent classic launch works.
   DesktopFirmwareCancel();HandleExecution();
   assert(flashes==before+2 && !strcmp(flashPath,"/firmware/Other_Firmware.hex"));++checks;
   // New preparation/affirmative authorizes exactly one fresh captured attempt.
   reset();prepare();HandleExecution();prepare();confirm();before=flashes;
   HandleExecution();HandleExecution();assert(flashes==before+1);++checks;
   // A same-name, same-size replacement after manual confirmation is rejected
   // by the CRC passed into the real parser rather than trusted by metadata.
   reset();prepare();confirm();
   SD.files[FS::folded("/firmware/"+std::string(first))]->data[100]^=1;
   before=flashes;HandleExecution();
   assert(flashes==before&&flashCRCGuarded&&!DesktopFirmware.confirmed);++checks;
   // Cancel exactly after Begin accepts the captured target and before the
   // caller retrieves its CRC. The guarded GUI path must abort without ever
   // invoking DoFlashUpdate, rather than falling through with verifyCRC=false.
   reset();prepare();confirm();before=flashes;callsBefore=flashCalls;
   TestFirmwareInterruptAt=DesktopFirmwareHookExpectedCRC;HandleExecution();
   assert(flashes==before&&flashCalls==callsBefore&&!DesktopFirmware.armed&&
      !DesktopFirmwareCRCValid&&!DesktopFirmware.confirmed);++checks;
   // Invalid raw selection still cannot launch via the unguarded classic path.
   reset();SelItemFullIdx=2;before=flashes;HandleExecution();assert(flashes==before);++checks;

   // A scroll remaps the highlighted local slot, raw-name capture, launch and
   // file commands together, including a filtered parent before that target.
   reset();std::vector<std::string> names;names.reserve(34);
   std::vector<StructMenuItem> menu;menu.reserve(34);
   for(unsigned i=0;i<34;++i) {
      names.push_back(i==2 ? UpDirString : "Firmware-"+std::to_string(i)+".hex");
      menu.push_back({uint8_t(i==2 ? rtDirectory : rtFileHex),0,&names.back()[0],nullptr,100+i});
      if(i!=2)SD.add("firmware/"+names.back(),std::string(100+i,'W'));
   }
   MenuSource=menu.data();NumItemsFull=menu.size();IO1[rwRegMenuView]=2;
   MenuViewRebuild();IO1[rwRegCursorItemOnPg]=3;MenuViewSetTop(0);
   assert(SelItemFullIdx==4);MenuViewWriteTopLow(4);MenuViewWriteTopHigh(0);
   assert(SelItemFullIdx==8 && IO1[rwRegCursorItemOnPg]==3);
   prepare();assert(!strcmp(DesktopFirmware.name,"Firmware-8.hex"));
   confirm();before=flashes;HandleExecution();
   assert(flashes==before+1 && !strcmp(flashPath,"/firmware/Firmware-8.hex"));++checks;
   IO1[wRegControl]=rCtlFileDeletePrepareWAIT;DesktopFileCommand();
   assert(DesktopFileEngine.deletes==1 && DesktopFileEngine.target=="/firmware/Firmware-8.hex");++checks;
   MenuViewSetTop(8);assert(SelItemFullIdx==12);
   IO1[wRegControl]=rCtlFileCopyWAIT;DesktopFileCommand();
   assert(DesktopFileEngine.copies==1 && DesktopFileEngine.target=="/firmware/Firmware-12.hex");++checks;
   std::printf("%u firmware target checks passed\n",checks);

   unsigned discoveryChecks=0;
   using DesktopFirmwareVersions::Version;
   Version installed;
   assert(DesktopFirmwareVersions::installed(installed));
   // The production release may advance any SemVer component; discovery only
   // requires that we can form the adjacent numeric patch candidate below.
   assert(installed.part[2]<UINT32_MAX);
   const std::string prefix="MPE_Firmware-V";
   // The public updater increments the patch component. Keep the real adjacent
   // release transition here so a major-version-only test cannot mask it.
   const std::string newerVersion=std::to_string(installed.part[0])+"."+
      std::to_string(installed.part[1])+"."+std::to_string(installed.part[2]+1);
   const std::string newer=prefix+newerVersion+".hex";
   for(const char* good: {"MPE_Firmware-V0.0.0.hex","MPE_Firmware-V1.0.11.hex",
       "mpe_firmware-v1.2.3.HEX","MPE_FIRMWARE-V12.34.56.hEx","MPE_Firmware-V4294967295.0.0.hex"}) {
      Version parsed;assert(DesktopFirmwareVersions::filename(good,parsed));++discoveryChecks;
   }
   for(const char* bad: {"","MPE_Firmware-V.hex","MPE_Firmware-V1.hex","MPE_Firmware-V1.2.hex",
       "MPE_Firmware-V1.2.3.4.hex","MPE_Firmware-V1..3.hex","MPE_Firmware-V1.2..hex",
       "MPE_Firmware-V-1.2.3.hex","MPE_Firmware-V+1.2.3.hex","MPE_Firmware-V01.2.3.hex",
       "MPE_Firmware-V1.02.3.hex","MPE_Firmware-V1.2.03.hex","MPE_Firmware-V1.2.3.hex.bak",
       "MPE_Firmware-V1.2.3-restore.hex","MPE_Firmware-V1.2.3_RESTORE.hex",
       "MPE_Firmware-V1.2.3+meta.hex","MPE_Firmware-V1.2.3-beta.hex","MPE_Firmware-V1.2.3.hex ",
       " MPE_Firmware-V1.2.3.hex","MPE_Firmware-V1.2.3.bin","Other_Firmware-V1.2.3.hex",
       "/MPE_Firmware-V1.2.3.hex","sub/MPE_Firmware-V1.2.3.hex","MPE_Firmware-V4294967296.0.0.hex",
       "MPE_Firmware-V1.4294967296.0.hex","MPE_Firmware-V1.0.4294967296.hex"}) {
      Version parsed;assert(!DesktopFirmwareVersions::filename(bad,parsed));++discoveryChecks;
   }
   for(const auto& values: std::vector<std::pair<std::string,std::string>>{
       {"1.0.12","1.0.11"},{"1.10.0","1.9.99"},{"10.0.0","9.99.99"},{"2.0.0","1.99.99"}}) {
      Version a,b;const char* ap=values.first.c_str();const char* bp=values.second.c_str();
      assert(DesktopFirmwareVersions::parse(ap,a)&&!*ap&&DesktopFirmwareVersions::parse(bp,b)&&!*bp);
      assert(DesktopFirmwareVersions::compare(a,b)>0&&DesktopFirmwareVersions::compare(b,a)<0&&
         DesktopFirmwareVersions::compare(a,a)==0);++discoveryChecks;
   }
   auto boot=[&]() {
      reset();DesktopFirmwareResetDiscovery();SD=FS();
      TestSDGeneration=0;TestSDState=0;TestSDErrorGeneration=UINT32_MAX;TestFirmwareInterruptAt=0;
      IO1[rWRegCurrMenuWAIT]=rmtUSBDrive;IO1[rwRegMenuView]=2;
      IO1[rwRegViewTopLo]=32;IO1[rwRegViewTopHi]=1;IO1[rwRegCursorItemOnPg]=5;
      strcpy(DriveDirPath,"/Games/Keep.This.View");
   };
   auto discover=[&]() {IO1[wRegControl]=rCtlFirmwareDiscoverWAIT;DesktopFirmwareCommand();};
   auto viewIntact=[&]() {
      assert(MenuSource==items&&SelItemFullIdx==0&&NumItemsFull==2);
      assert(IO1[rWRegCurrMenuWAIT]==rmtUSBDrive&&IO1[rwRegMenuView]==2&&
         IO1[rwRegViewTopLo]==32&&IO1[rwRegViewTopHi]==1&&IO1[rwRegCursorItemOnPg]==5);
      assert(!strcmp(DriveDirPath,"/Games/Keep.This.View"));
   };
   // A cancel received after the ISR queued Discover but before foreground
   // dispatch replaces the stale command, so it cannot reopen or rearm SD.
   boot();SD.add(newer);IO1[wRegControl]=rCtlFirmwareDiscoverWAIT;
   IO1[wRegControl]=rCtlFirmwareCancel;DesktopFirmwareCancel();DesktopFirmwareCommand();
   assert(IO1[rRegFirmwareTargetState]==0&&!DesktopFirmware.armed&&SD.rootOpens==0&&SD.initCalls==0);
   ++discoveryChecks;
   for(unsigned Point:{unsigned(DesktopFirmwareHookAfterDispatchSnapshot),unsigned(DesktopFirmwareHookDiscoverEntry)}) {
      boot();SD.add(newer);IO1[wRegControl]=rCtlFirmwareDiscoverWAIT;TestFirmwareInterruptAt=Point;
      DesktopFirmwareCommand();
      assert(IO1[rRegFirmwareTargetState]==0&&!DesktopFirmware.armed&&SD.rootOpens==0&&SD.initCalls==0);
      ++discoveryChecks;
   }
   boot();SD.add(newer);before=flashes;discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==1&&"inserted cold SD must settle DAT3, initialize and offer newer firmware");
   assert(!strcmp(DesktopFirmware.name,newer.c_str())&&
      "installed version must offer its adjacent patch from the SD root");
   assert(SD.initCalls==1&&SD.rootOpens==1&&SD.presenceProbes==1&&SD.totalDelayUs==5&&flashes==before);
   discover();assert(SD.initCalls==1&&SD.rootOpens==1&&SD.totalDelayUs==5);++discoveryChecks;
   boot();SD.inserted=false;before=flashes;discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==0&&!DesktopFirmware.armed&&DesktopFirmwareScanned&&SD.initCalls==0&&SD.rootOpens==0&&flashes==before);
   discover();assert(SD.presenceProbes==1&&SD.totalDelayUs==5&&SD.initCalls==0);++discoveryChecks;
   // A later explicit SD reopen advances the media generation and retries.
   SD.inserted=true;SD.add(newer);SDRequestExplicitRefresh();discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==1&&SD.initCalls==1&&SD.rootOpens==1&&flashes==before);++discoveryChecks;
   boot();SD.mounted=false;SD.failInit=true;discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==0&&DesktopFirmwareScanned&&SD.initCalls==1&&SD.rootOpens==0);++discoveryChecks;
   // Other consumers in this generation reuse the mount failure instead of
   // paying the same multi-second begin sequence again.
   assert(!SDFullInit()&&SD.initCalls==1);
   SD.failInit=false;SD.add(newer);before=flashes;SDRequestExplicitRefresh();discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==1&&SD.initCalls==2&&SD.rootOpens==1&&flashes==before);++discoveryChecks;
   boot();discover();discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==0&&DesktopFirmwareScanned&&SD.rootOpens==1&&SD.fileOpens==0);
   SDRequestExplicitRefresh();discover();assert(SD.rootOpens==2);++discoveryChecks;
   boot();SD.failRoot=true;discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==0&&!DesktopFirmwareScanned);++discoveryChecks;
   SD.failRoot=false;SD.add(newer);before=flashes;discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==1&&SD.initCalls==1&&SD.rootOpens==2&&flashes==before);++discoveryChecks;
   boot();SD.mounted=true;SD.add(newer);discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==1&&SD.initCalls==0&&SD.presenceProbes==0&&SD.totalDelayUs==0);++discoveryChecks;
   for(unsigned cancel=0;cancel<2;++cancel) {
      boot();SD.add(newer);before=flashes;
      SD.duringNext=[&](){if(cancel)DesktopFirmwareCancel();else SD.inserted=false;};
      discover();viewIntact();
      assert(IO1[rRegFirmwareTargetState]==0&&!DesktopFirmware.armed&&!DesktopFirmwareScanned&&flashes==before);
      assert(SD.nextCalls==1);
      SD.inserted=true;discover();viewIntact();
      assert(IO1[rRegFirmwareTargetState]==1&&SD.rootOpens==2&&flashes==before);++discoveryChecks;
   }
   // Root discovery must never offer the installed version. Same-number test
   // reflashes remain available through the ordinary manual .hex selection.
   boot();const std::string same=prefix+MPE_FIRMWARE_VERSION+".hex";SD.add(same);SD.add(prefix+"0.0.1.hex");
   SD.add("subfolder");SD.add("subfolder/"+newer);SD.add(newer,"",true);
   SD.add(prefix+newerVersion+"_restore.hex");discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==0&&!DesktopFirmware.armed&&SD.fileOpens==0);++discoveryChecks;

   // Numeric maximum, never the first or lexicographic maximum. Startup scans
   // names only; the complete CRC is deferred until the user confirms.
   boot();const std::string major=std::to_string(installed.part[0]+1);
   for(const char* suffix:{".0.9.hex",".0.10.hex",".9.999.hex",".10.0.hex"}) SD.add(prefix+major+suffix);
   const std::string highest=prefix+major+".10.0.hex";
   SD.add(prefix+MPE_FIRMWARE_VERSION+".hex");before=flashes;discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==1&&!strcmp(DesktopFirmware.name,highest.c_str()));
   assert(DesktopFirmware.armed&&!DesktopFirmware.confirmed&&flashes==before&&SD.fileOpens==0);
   assert(SD.bytesRead==0);
   const size_t discoveredFiles=SD.files.size(),readBytes=SD.bytesRead;
   DesktopFirmwareCancel();viewIntact();discover();
   assert(IO1[rRegFirmwareTargetState]==1&&DesktopFirmware.armed&&SD.rootOpens==2&&SD.bytesRead==readBytes);
   assert(SD.files.size()==discoveredFiles);++discoveryChecks;
   DesktopFirmwareResetDiscovery();DesktopFirmwareCancel();discover();viewIntact();
   assert(IO1[rRegFirmwareTargetState]==1&&SD.rootOpens==3&&!strcmp(DesktopFirmware.name,highest.c_str()));++discoveryChecks;

   boot();std::string mixed="mpe_FIRMWARE-v"+newerVersion+".HEX";SD.add(mixed);discover();
   assert(!strcmp(DesktopFirmware.name,mixed.c_str()));confirm();before=flashes;HandleExecution();
   assert(flashes==before+1&&flashSource==&SD&&!strcmp(flashPath,("/"+mixed).c_str()));++discoveryChecks;

   for(unsigned fault=0;fault<4;++fault) {
      boot();SD.add(newer,std::string(700,'X'));
      if(fault==0)SD.failOpen="/"+newer;
      if(fault==1)SD.failReadAfter=260;
      if(fault==2)SD.files[FS::folded("/"+newer)]->data.clear();
      before=flashes;discover();viewIntact();
      assert(IO1[rRegFirmwareTargetState]==1&&DesktopFirmware.armed&&!DesktopFirmware.confirmed&&flashes==before);
      if(fault==3)SD.duringRead=[](){DesktopFirmwareCancel();};
      confirm();
      assert(IO1[rRegFirmwareTargetState]!=1&&!DesktopFirmware.confirmed&&!DesktopFirmwareCRCValid&&flashes==before);
      // A failed confirmation must not poison ordinary file launches.
      items[0].ItemType=rtFilePrg;const unsigned loadsBefore=ordinaryLoads;
      DesktopFirmwareCancel();
      HandleExecution();assert(ordinaryLoads==loadsBefore+1&&flashes==before&&!DesktopFirmware.armed);
      ++discoveryChecks;
      if(fault==1||fault==3) {
         // Failed reads and cancellation during CRC stay retryable.
         SD.failReadAfter=SIZE_MAX;
         discover();viewIntact();
         assert(IO1[rRegFirmwareTargetState]==1&&DesktopFirmwareScanned&&SD.rootOpens==2&&flashes==before);
         DesktopFirmwareCancel();discover();
         assert(IO1[rRegFirmwareTargetState]==1&&DesktopFirmware.armed&&SD.rootOpens==3);
         ++discoveryChecks;
      }
   }

   boot();SD.add(newer);discover();before=flashes;
   HandleExecution();HandleExecution();assert(flashes==before&&DesktopFirmware.armed&&!DesktopFirmware.confirmed);++discoveryChecks;

   // Startup performs no payload read. Confirmation fingerprints once and the
   // actual parser reads once, eliminating the former four-pass preflight.
   boot();SD.add(newer,std::string(700,'X'));discover();
   assert(SD.bytesRead==0&&SD.fileOpens==0);confirm();
   assert(DesktopFirmware.confirmed&&DesktopFirmwareCRCValid&&SD.bytesRead==700&&SD.fileOpens==1);
   before=flashes;HandleExecution();
   assert(flashes==before+1&&flashCRCGuarded&&flashExpectedCRC==DesktopFirmwareCRC&&
      SD.bytesRead==1400&&SD.fileOpens==2);++discoveryChecks;

   // Exercise confirmation and the actual launch. Changes made after the
   // affirmative are rejected by the parser's CRC guard. Before affirmative,
   // a same-size valid file is the file the user chose and becomes the baseline.
   for(unsigned atStart=0;atStart<2;++atStart) for(unsigned fault=0;fault<7;++fault) {
      boot();SD.add(newer,std::string(700,'X'));discover();
      assert(IO1[rRegFirmwareTargetState]==1);
      if(atStart)confirm();
      const std::string key=FS::folded("/"+newer);
      switch(fault) {
         case 0:SD.files.erase(key);break;
         case 1:SD.files[key]->data.push_back('Y');break;
         case 2:SD.files[key]->data[321]='Y';break;
         case 3:SD.inserted=false;break;
         case 4:SD.files[key]->directory=true;break;
         case 5:SD.failOpen="/"+newer;break;
         case 6:SD.failReadAfter=SD.bytesRead+260;break;
      }
      before=flashes;
      if(!atStart){
         confirm();
         if(fault==2) assert(IO1[rRegFirmwareTargetState]==1&&DesktopFirmware.confirmed);
         else assert(IO1[rRegFirmwareTargetState]==2&&!DesktopFirmware.confirmed);
      }
      HandleExecution();HandleExecution();viewIntact();
      assert(flashes==before+(!atStart&&fault==2?1:0)&&DesktopFirmware.armed&&
         !DesktopFirmware.confirmed&&IO1[rRegFirmwareTargetState]==2);
      ++discoveryChecks;
   }
   boot();SD.add(newer);discover();confirm();
   // Startup capture has its own immutable source/path; no normal selection
   // is required and remote browser changes cannot retarget the update.
   MenuSource=nullptr;NumItemsFull=0;strcpy(DriveDirPath,"/Changed/After/Confirm");
   before=flashes;HandleExecution();
   assert(flashes==before+1&&flashSource==&SD&&!strcmp(flashPath,("/"+newer).c_str()));
   HandleExecution();assert(flashes==before+1&&DesktopFirmware.armed&&!DesktopFirmware.confirmed);++discoveryChecks;
   boot();SD.add(newer);discover();confirm();prepare();
   assert(!DesktopFirmwareStartup&&!DesktopFirmware.confirmed&&DesktopFirmware.device==rmtUSBDrive);
   assert(!strcmp(DesktopFirmware.name,first));++discoveryChecks;
   std::printf("%u firmware discovery checks passed\n",discoveryChecks);

   unsigned browserChecks=0;
   for(uint8_t device:{uint8_t(rmtSD),uint8_t(rmtUSBDrive)}) for(bool nested:{false,true}) {
      reset();IO1[rWRegCurrMenuWAIT]=device;IO1[rwRegMenuView]=2;
      FS& storage=device==rmtSD?SD:firstPartition;
      const std::string directory=nested?"/firmware":"/";
      const std::string relative=(nested?"firmware/":"")+manualSame;
      if(nested)storage.add("firmware","",true);
      const std::string key=FS::folded("/"+relative);
      const auto selectBrowserFirmware=[&]() {
         strcpy(DriveDirPath,directory.c_str());LoadDirectory(&storage);
         uint16_t raw=0;
         while(raw<NumItemsFull&&strcmp(MenuSource[raw].Name,manualSame.c_str()))++raw;
         assert(raw<NumItemsFull);
         MenuViewSetCursorRaw(raw);
         // GUI SelectItem writes the current local cursor into this selector.
         assert(MenuViewSelect(IO1[rwRegCursorItemOnPg]));
         assert(SelItemFullIdx==raw&&MenuSource[raw].ItemType==rtFileHex);
         assert(MenuSource[raw].Size==storage.files[key]->data.size());
      };
      // The same file can be reinstalled repeatedly. A rebuilt file with the
      // same visible version is a new explicitly confirmed attempt, too.
      uint32_t previousCRC=0;
      for(unsigned attempt=0;attempt<3;++attempt) {
         storage.add(relative,std::string(1234,attempt==2?'R':'Q'));
         selectBrowserFirmware();prepare();assert(IO1[rRegFirmwareTargetState]==1);
         confirm();assert(DesktopFirmware.confirmed&&DesktopFirmwareCRCValid);
         if(attempt==1)assert(DesktopFirmwareCRC==previousCRC);
         if(attempt==2)assert(DesktopFirmwareCRC!=previousCRC);
         previousCRC=DesktopFirmwareCRC;
         before=flashes;HandleExecution();
         assert(flashes==before+1&&flashSource==&storage&&flashCRCGuarded&&
            !strcmp(flashPath,("/"+relative).c_str()));
         HandleExecution();assert(flashes==before+1); // affirmative is one-shot
         DesktopFirmwareCancel();++browserChecks;
      }
      // Metadata changes between selection and affirmative remain rejected.
      selectBrowserFirmware();prepare();storage.files[key]->data.push_back('!');
      confirm();assert(!DesktopFirmware.confirmed&&IO1[rRegFirmwareTargetState]==2);
      before=flashes;HandleExecution();assert(flashes==before);
      DesktopFirmwareCancel();++browserChecks;
      // Same-name, same-size replacement after affirmative still fails CRC.
      selectBrowserFirmware();prepare();confirm();storage.files[key]->data[15]^=1;
      before=flashes;HandleExecution();assert(flashes==before&&flashCRCGuarded);
      DesktopFirmwareCancel();++browserChecks;
      // Empty HEX files populate an exact zero length but cannot be flashed.
      storage.add(relative,"");selectBrowserFirmware();prepare();confirm();
      assert(!DesktopFirmware.confirmed&&IO1[rRegFirmwareTargetState]==2);
      before=flashes;HandleExecution();assert(flashes==before);
      DesktopFirmwareCancel();FreeDriveDirMenu();++browserChecks;
   }
   std::printf("%u browser firmware reinstall checks passed\n",browserChecks);

   unsigned streamChecks=0;
   // Both startup and manual confirmation must fingerprint multi-megabyte
   // files with a retained SDIO read stream, even if a previous file operation
   // left the stream active before confirmation begins.
   for(int fileIndex=0;fileIndex<argc;++fileIndex) {
      std::string data;
      if(fileIndex==0) data=std::string(6*1024*1024+123,'H');
      else {
         std::ifstream input(argv[fileIndex],std::ios::binary);
         assert(input&&"firmware fixture must be readable");
         data.assign(std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>());
         assert(data.size()>1024*1024&&data[0]==':'&&"exercise a real complete HEX, not a tiny placeholder");
      }
      uint32_t independentCRC=UINT32_MAX;
      for(unsigned char byte:data) {
         independentCRC^=byte;
         for(unsigned bit=0;bit<8;++bit)
            independentCRC=(independentCRC>>1)^((independentCRC&1)?0xedb88320u:0);
      }
      independentCRC=~independentCRC;
      for(unsigned startup=0;startup<2;++startup)for(unsigned retained=0;retained<2;++retained) {
         if(startup) {boot();SD.add(newer,data);discover();}
         else {reset();items[0].Size=data.size();SD.add("firmware/"+std::string(first),data);prepare();}
         SD.emulateSDIOStream=true;SD.readStreamActive=retained!=0;
         const unsigned mediaBefore=SD.mediaChecks;
         before=flashes;confirm();
         assert(DesktopFirmware.confirmed&&DesktopFirmwareCRCValid&&DesktopFirmwareCRC==independentCRC);
         assert(SD.streamStatusFaults==0&&SD.mediaChecks==mediaBefore&&
            "fingerprint must not issue out-of-band status during SDIO streaming");
         SD.emulateSDIOStream=false;HandleExecution();
         assert(flashes==before+1&&flashCRCGuarded&&flashExpectedCRC==independentCRC);
         ++streamChecks;
      }
   }
   // An actual loss of media during a read still aborts without flashing.
   boot();SD.add(newer,std::string(4096,'R'));discover();
   SD.emulateSDIOStream=true;SD.duringRead=[](){SD.inserted=false;};
   before=flashes;confirm();HandleExecution();
   assert(!DesktopFirmware.confirmed&&!DesktopFirmwareCRCValid&&flashes==before);++streamChecks;
   // A read error on the final EOF check is not a clean end-of-file.
   boot();SD.add(newer,std::string(4096,'E'));discover();SD.failReadAfter=4096;
   before=flashes;confirm();HandleExecution();
   assert(!DesktopFirmware.confirmed&&!DesktopFirmwareCRCValid&&flashes==before);++streamChecks;
   std::printf("%u firmware SDIO stream checks passed\n",streamChecks);
}
