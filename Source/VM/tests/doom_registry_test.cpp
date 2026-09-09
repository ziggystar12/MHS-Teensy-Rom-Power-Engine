// SPDX-License-Identifier: MIT
// Reuse the real registry's filesystem harness, with a profile-1 package.
#define main legacy_registry_main
#include "registry_test.cpp"
#undef main
int main(int argc,char **argv){
    assert(argc==3);base=argv[2];assert(base.string().find("registry-sandbox")!=std::string::npos);
    fs::create_directories(base);fs::copy(fs::path(argv[1]),base,fs::copy_options::recursive|fs::copy_options::overwrite_existing);
    using namespace VmRegistry;Launch l{};assert(find("gbd",nullptr,l)==1);assert(preflight(l));
    assert(tryLaunch(rmtSD,"/","DOOMVM.crt"));assert(rebooted);Launch saved{};assert(consume(saved)&&!saved.content[0]);
    rebooted=false;assert(tryLaunch(rmtSD,"/VMS/DOOMVM","doom1.gbd"));assert(rebooted&&consume(saved));
    assert(!strcmp(saved.content,"/VMS/DOOMVM/doom1.gbd"));
    auto module=base/"VMS/DOOMVM/engine.mvm";
    std::fstream damage(module,std::ios::binary|std::ios::in|std::ios::out);
    damage.seekg(-1,std::ios::end);const int byte=damage.get();damage.seekp(-1,std::ios::end);damage.put(byte^1);damage.close();
    assert(!preflight(l));rebooted=false;
    assert(tryLaunch(rmtSD,"/","DOOMVM.crt"));assert(!rebooted&&!message.empty());
    puts("PASS: profile-1 registry launch by client/content and CRC rejection in final RAM2 constant byte");
}
