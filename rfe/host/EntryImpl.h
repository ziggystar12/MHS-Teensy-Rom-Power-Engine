// SPDX-License-Identifier: MIT
#pragma once
// Included after the staged hardware initializer in the vendor sketch.
FLASHMEM void mpeRfeReturnToMenu() {
    EEPROM.write(eepAdMinBootInd, MinBootInd_FromMin);
    delay(10);
    REBOOT;
}
FLASHMEM MpeRfe::Result mpeRfeStart(const MpeRfe::Request &request) {
    static bool attempted=false;
    if(attempted)return MpeRfe::Result::NotRequested;
    // Replayed requests or malformed paths never initialize the C64 bus or SD.
    const auto valid=MpeRfe::validateRequest(request);
    if(valid!=MpeRfe::Result::Ready)return valid;
    attempted=true;
    mpeRfeInitializeHardware();
    if(ReadButton==0)return MpeRfe::Result::NotRequested;
    const auto result=MpeRfe::start(request);
    if(result==MpeRfe::Result::Started)BtnPressed=false;
    return result;
}
void setup() {
    MpeRfe::Request request{};
    if(!mpeRfeReadLaunchRequest(request)) {
        mpeRfeReportLaunchFailure(MpeRfe::Result::NotRequested);
        mpeRfeReturnToMenu();
        return;
    }
    const auto result=mpeRfeStart(request);
    if(result!=MpeRfe::Result::Started) {
        mpeRfeReportLaunchFailure(result);
        mpeRfeReturnToMenu();
    }
}
