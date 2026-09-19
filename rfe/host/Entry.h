// SPDX-License-Identifier: MIT
#pragma once
// An eventual TR/GUI adapter supplies decoded launch fields after ResetHandler.
// The development binding returns false; no provisional EEPROM byte is read.
bool mpeRfeReadLaunchRequest(MpeRfe::Request &request);
void mpeRfeReportLaunchFailure(MpeRfe::Result result);
void mpeRfeReturnToMenu();
MpeRfe::Result mpeRfeStart(const MpeRfe::Request &request);
void mpeRfeLoop();
