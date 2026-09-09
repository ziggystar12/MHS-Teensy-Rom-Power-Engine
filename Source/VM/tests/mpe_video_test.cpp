#include "mpe_video.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using mpe_video::FramePlan;
using mpe_video::RenderMode;
using mpe_video::StageResult;
using mpe_video::Video;

void check(bool value, const std::string &message) {
  if (!value) throw std::runtime_error(message);
}

std::array<uint8_t, Video::PaletteBytes> vicPalette() {
  std::array<uint8_t, Video::PaletteBytes> result{};
  std::copy_n(mpe_video::vicPaletteRgb(), 16u * 3u, result.begin());
  return result;
}

bool samePlan(const FramePlan &left, const FramePlan &right) {
  return left.mode == right.mode &&
         left.background == right.background &&
         left.enhancedMask == right.enhancedMask &&
         std::equal(std::begin(left.split), std::end(left.split),
                    std::begin(right.split));
}

struct Fixture {
  static constexpr size_t GuardBytes = 37;
  std::vector<uint8_t> workspace =
      std::vector<uint8_t>(Video::WorkspaceBytes + GuardBytes * 2u, 0xa5);
  Video video;

  Fixture() {
    check(video.start(workspace.data() + GuardBytes, Video::WorkspaceBytes),
          "video workspace rejected");
  }

  void guards() const {
    check(std::all_of(workspace.begin(), workspace.begin() + GuardBytes,
                      [](uint8_t byte) { return byte == 0xa5; }) &&
              std::all_of(workspace.end() - GuardBytes, workspace.end(),
                          [](uint8_t byte) { return byte == 0xa5; }),
          "video touched workspace guards");
  }
};

uint16_t recordCell(const uint8_t *record) {
  return uint16_t(record[0] | uint16_t(record[1]) << 8u);
}

void apply(const uint8_t *records, uint16_t count,
           std::vector<uint8_t> &cells) {
  for (uint16_t index = 0; index != count; ++index) {
    const uint8_t *record = records + size_t(index) * Video::RecordBytes;
    const uint16_t cell = recordCell(record);
    check(cell < Video::Cells, "video emitted an out-of-range cell");
    std::copy_n(record + 2, Video::CellBytes,
                cells.begin() + size_t(cell) * Video::CellBytes);
  }
}

uint16_t guardedChanges(Video &video, uint16_t maximum,
                        std::vector<uint8_t> &cells,
                        std::array<bool, Video::Cells> *seen = nullptr) {
  constexpr size_t GuardBytes = 29;
  std::vector<uint8_t> records(size_t(maximum) * Video::RecordBytes + GuardBytes,
                               0xa5);
  const uint16_t count = video.changes(records.data(), maximum);
  check(count <= maximum, "video exceeded the record maximum");
  check(count <= Video::MaximumRecordsPerBatch,
        "video exceeded the transport batch maximum");
  check(std::all_of(records.begin() + size_t(maximum) * Video::RecordBytes,
                    records.end(), [](uint8_t byte) { return byte == 0xa5; }),
        "video wrote beyond the record buffer");
  if (seen) {
    for (uint16_t index = 0; index != count; ++index) {
      const uint16_t cell =
          recordCell(records.data() + size_t(index) * Video::RecordBytes);
      check(cell < Video::Cells && !(*seen)[cell],
            "initial traversal repeated a cell");
      (*seen)[cell] = true;
    }
  }
  apply(records.data(), count, cells);
  if (count)
    check(video.awaitingAcknowledgement() && video.acknowledgeChanges() &&
              !video.awaitingAcknowledgement(),
          "video did not atomically acknowledge its offered batch");
  return count;
}

unsigned drain(Video &video, std::vector<uint8_t> &cells,
               std::array<bool, Video::Cells> *seen = nullptr) {
  static const uint16_t limits[] = {1, 19, 7, 3, 31};
  unsigned total = 0;
  unsigned batch = 0;
  while (video.busy()) {
    const uint16_t count =
        guardedChanges(video, limits[batch++ % std::size(limits)], cells, seen);
    check(count != 0, "dirty traversal stalled");
    total += count;
    check(total <= Video::Cells, "dirty traversal exceeded one frame");
  }
  return total;
}

uint8_t hiresColor(const std::vector<uint8_t> &cells, uint16_t x, uint16_t y,
                   const FramePlan &plan) {
  const uint8_t band = uint8_t(y / 8u);
  const uint8_t *cell =
      cells.data() + size_t(band * Video::CellsPerBand + x / 8u) *
                         Video::CellBytes;
  const uint8_t bit = uint8_t((cell[y & 7u] >> (7u - (x & 7u))) & 1u);
  const uint8_t attribute =
      plan.bandEnhanced(band) && (y & 7u) >= plan.split[band] ? cell[9]
                                                               : cell[8];
  return bit ? uint8_t(attribute >> 4u) : uint8_t(attribute & 15u);
}

uint8_t colorPixel(const std::vector<uint8_t> &cells, uint16_t logicalX,
                    uint16_t y, const FramePlan &plan) {
  const uint16_t cellIndex =
      uint16_t((y / 8u) * Video::CellsPerBand + logicalX / 4u);
  const uint8_t *cell =
      cells.data() + size_t(cellIndex) * Video::CellBytes;
  const uint8_t code =
      uint8_t((cell[y & 7u] >> (6u - (logicalX & 3u) * 2u)) & 3u);
  if (!code) return plan.background;
  if (code == 1u) return uint8_t(cell[8] >> 4u);
  if (code == 2u) return uint8_t(cell[8] & 15u);
  return uint8_t(cell[9] & 15u);
}

void verifyBoundsAndImmutableInitialFrame() {
  std::vector<uint8_t> rejected(Video::WorkspaceBytes + 64u, 0xa5);
  Video unbound;
  check(!unbound.start(nullptr, Video::WorkspaceBytes),
        "null workspace was accepted");
  check(!unbound.start(rejected.data() + 32u, Video::WorkspaceBytes - 1u),
        "undersized workspace was accepted");
  check(std::all_of(rejected.begin(), rejected.end(),
                    [](uint8_t byte) { return byte == 0xa5; }),
        "rejected workspace was modified");

  constexpr size_t AlignmentGuard = 32;
  std::vector<uint8_t> unalignedStorage(
      Video::WorkspaceBytes + AlignmentGuard * 2u + alignof(uint32_t), 0xa5);
  size_t offset = AlignmentGuard;
  while ((reinterpret_cast<uintptr_t>(unalignedStorage.data() + offset) &
          (alignof(uint32_t) - 1u)) == 0)
    ++offset;
  Video unaligned;
  check(unaligned.start(unalignedStorage.data() + offset, Video::WorkspaceBytes),
        "unaligned workspace was rejected");
  std::vector<uint8_t> frame(Video::SourceBytes, 0);
  auto palette = vicPalette();
  check(unaligned.stageFrame(frame.data(), frame.size(), palette.data(),
                             palette.size(), RenderMode::Sharp) ==
            StageResult::Accepted,
        "unaligned workspace could not stage a frame");
  check(std::all_of(unalignedStorage.begin(),
                    unalignedStorage.begin() + offset,
                    [](uint8_t byte) { return byte == 0xa5; }) &&
            std::all_of(unalignedStorage.begin() + offset +
                            Video::WorkspaceBytes,
                        unalignedStorage.end(),
                        [](uint8_t byte) { return byte == 0xa5; }),
        "video touched unaligned workspace guards");

  Fixture detached;
  check(detached.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                  palette.size(), RenderMode::Sharp) ==
            StageResult::Accepted,
        "detach fixture initial stage failed");
  const std::vector<uint8_t> releasedWorkspace = detached.workspace;
  check(!detached.video.start(nullptr, Video::WorkspaceBytes) &&
            !detached.video.busy() && !detached.video.initialComplete() &&
            detached.video.acceptedFrames() == 0 &&
            detached.video.droppedFrames() == 0,
        "failed rebind retained publication state");
  detached.video.reset();
  check(detached.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                  palette.size(), RenderMode::Sharp) ==
            StageResult::InvalidArgument,
        "failed rebind retained its old workspace");
  check(detached.workspace == releasedWorkspace,
        "detached video touched its released workspace");
  detached.guards();

  Fixture fixture;
  check(fixture.video.stageFrame(nullptr, frame.size(), palette.data(),
                                 palette.size(), RenderMode::Color) ==
                StageResult::InvalidArgument &&
            fixture.video.stageFrame(frame.data(), frame.size() - 1u,
                                     palette.data(), palette.size(),
                                     RenderMode::Color) ==
                StageResult::InvalidArgument &&
            fixture.video.stageFrame(frame.data(), frame.size(), nullptr,
                                     palette.size(), RenderMode::Color) ==
                StageResult::InvalidArgument &&
            fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                     palette.size() - 1u,
                                     RenderMode::Color) ==
                StageResult::InvalidArgument &&
            fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                     palette.size(), RenderMode::Native) ==
                StageResult::InvalidArgument &&
            fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                     palette.size(),
                                     static_cast<RenderMode>(0xff)) ==
                StageResult::InvalidArgument &&
            fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                     palette.size(), RenderMode::Color,
                                     Video::VicColors) ==
                StageResult::InvalidArgument,
        "invalid source, palette, mode or background bounds were accepted");
  check(fixture.video.acceptedFrames() == 0 &&
            fixture.video.droppedFrames() == 0 && !fixture.video.busy(),
        "invalid stage changed publication state");

  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Color) ==
            StageResult::Accepted,
        "initial Color frame was rejected");
  check(fixture.video.pendingCells() == Video::Cells &&
            fixture.video.framePlan().mode == RenderMode::Color &&
            fixture.video.framePlan().enhancedMask == 0,
        "initial Color target or plan is incomplete");
  const uint16_t pending = fixture.video.pendingCells();
  uint8_t ignored[Video::RecordBytes]{};
  check(fixture.video.changes(nullptr, 19) == 0 &&
            fixture.video.changes(ignored, 0) == 0 &&
            !fixture.video.acknowledgeChanges() &&
            fixture.video.pendingCells() == pending,
         "invalid record request consumed a staged target");

  // Staging owns the complete converted target and no longer depends on either
  // caller buffer.
  std::fill(frame.begin(), frame.end(), 1);
  std::fill(palette.begin(), palette.end(), 0xff);
  std::vector<uint8_t> cells(Video::FrameBytes, 0xcc);
  std::array<bool, Video::Cells> seen{};
  check(drain(fixture.video, cells, &seen) == Video::Cells &&
            std::all_of(seen.begin(), seen.end(),
                        [](bool value) { return value; }),
        "initial frame did not visit all cells exactly once");
  for (uint16_t cell = 0; cell != Video::Cells; ++cell) {
    const uint8_t *payload =
        cells.data() + size_t(cell) * Video::CellBytes;
    check(std::all_of(payload, payload + 8,
                      [](uint8_t byte) { return byte == 0; }) &&
              payload[8] == 0x12 && payload[9] == 3,
          "staged Color target changed with reused source storage");
  }
  check(fixture.video.initialComplete() &&
            fixture.video.acceptedFrames() == 1 &&
            samePlan(fixture.video.framePlan(), fixture.video.publishedPlan()),
        "initial publication state is wrong");
  fixture.guards();
  std::cout << "Bounds PASS: guarded workspace/records, invalid modes, "
               "immutable initial staging.\n";
}

void verifyColorSquish() {
  Fixture fixture;
  std::vector<uint8_t> frame(Video::SourceBytes, 0);
  auto palette = vicPalette();
  std::vector<uint8_t> cells(Video::FrameBytes, 0);
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Color) ==
            StageResult::Accepted &&
            drain(fixture.video, cells) == Video::Cells,
        "Color squish fixture initialization failed");

  // Every pair is black/white. Its rounded RGB midpoint is 128 gray, nearest
  // to VIC medium gray (12), proving both source columns contribute.
  for (uint16_t y = 0; y != 8; ++y) {
    for (uint16_t logicalX = 4; logicalX != 8; ++logicalX) {
      const size_t source =
          size_t(y) * Video::SourceWidth + logicalX * 2u;
      frame[source] = 0;
      frame[source + 1u] = 1;
    }
  }
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Color) ==
                StageResult::Accepted &&
            fixture.video.pendingCells() == 1 &&
            guardedChanges(fixture.video, 19, cells) == 1,
        "Color paired-pixel change was not isolated");
  for (uint16_t y = 0; y != 8; ++y)
    for (uint16_t x = 4; x != 8; ++x)
      check(colorPixel(cells, x, y, fixture.video.publishedPlan()) == 12,
            "Color mode discarded one source pixel");

  // Background is firmware policy, not a hardcoded black/NES-era assumption.
  std::fill(frame.begin(), frame.end(), 6);
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Color, 6) ==
                StageResult::Accepted &&
            fixture.video.pendingCells() == Video::Cells &&
            fixture.video.framePlan().background == 6 &&
            drain(fixture.video, cells) == Video::Cells &&
            colorPixel(cells, 0, 0, fixture.video.publishedPlan()) == 6,
        "Color mode did not publish its firmware-selected background");
  fixture.guards();
  std::cout << "Color PASS: deterministic four-color cells, selectable "
               "background and 320-to-160 paired-pixel reduction.\n";
}

void setCellPattern(std::vector<uint8_t> &frame, uint16_t cell,
                    uint8_t low, uint8_t high) {
  const uint16_t x0 = uint16_t((cell % Video::CellsPerBand) * 8u);
  const uint16_t y0 = uint16_t((cell / Video::CellsPerBand) * 8u);
  for (uint8_t y = 0; y != 8; ++y)
    for (uint8_t x = 0; x != 8; ++x)
      frame[size_t(y0 + y) * Video::SourceWidth + x0 + x] =
          (x & 1u) ? high : low;
}

void verifySharpDirtyAndBackpressure() {
  Fixture fixture;
  std::vector<uint8_t> frame(Video::SourceBytes, 0);
  auto palette = vicPalette();
  std::vector<uint8_t> cells(Video::FrameBytes, 0);
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Sharp) ==
                StageResult::Accepted &&
            drain(fixture.video, cells) == Video::Cells,
        "Sharp dirty fixture initialization failed");
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Sharp) ==
                StageResult::Accepted &&
            !fixture.video.busy(),
        "identical Sharp frame produced dirty cells");

  setCellPattern(frame, 0, 2, 3);
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Sharp) ==
                StageResult::Accepted &&
            fixture.video.pendingCells() == 1,
        "one changed Sharp cell was not isolated");
  const FramePlan frozen = fixture.video.framePlan();
  std::vector<uint8_t> newer = frame;
  setCellPattern(newer, 0, 1, 1);
  check(fixture.video.stageFrame(newer.data(), newer.size(), palette.data(),
                                 palette.size(), RenderMode::Auto8) ==
                StageResult::DroppedBusy &&
            fixture.video.droppedFrames() == 1 &&
            fixture.video.pendingCells() == 1 &&
            samePlan(fixture.video.framePlan(), frozen),
        "busy target or its plan was not frozen atomically");

  std::array<uint8_t, Video::RecordBytes> offered{};
  std::array<uint8_t, Video::RecordBytes> retried{};
  check(fixture.video.changes(offered.data(), 1) == 1 &&
            fixture.video.awaitingAcknowledgement() &&
            fixture.video.pendingCells() == 1 && fixture.video.busy() &&
            fixture.video.changes(retried.data(), 1) == 0,
        "offered Sharp record was committed or replaced before ACK");
  check(fixture.video.stageFrame(newer.data(), newer.size(), palette.data(),
                                 palette.size(), RenderMode::Auto8) ==
                StageResult::DroppedBusy &&
            fixture.video.droppedFrames() == 2,
        "frame was accepted while a cell batch awaited ACK");
  fixture.video.rejectChanges();
  check(!fixture.video.awaitingAcknowledgement() &&
            fixture.video.pendingCells() == 1 &&
            fixture.video.changes(retried.data(), 1) == 1 &&
            offered == retried,
        "rejected Sharp record was not offered identically for retry");
  apply(retried.data(), 1, cells);
  check(fixture.video.acknowledgeChanges() && !fixture.video.busy() &&
            !fixture.video.awaitingAcknowledgement(),
        "retried Sharp record did not commit on ACK");
  const uint8_t *first = cells.data();
  check(std::all_of(first, first + 8,
                    [](uint8_t byte) { return byte == 0x55; }) &&
            first[8] == 0x32 && first[9] == 0x32,
        "dropped frame replaced or corrupted the Sharp target");

  check(fixture.video.stageFrame(newer.data(), newer.size(), palette.data(),
                                 palette.size(), RenderMode::Sharp) ==
                StageResult::Accepted &&
            fixture.video.pendingCells() == 1 &&
            guardedChanges(fixture.video, 1, cells) == 1,
        "newest Sharp frame was not accepted after drain");
  check(std::all_of(cells.begin(), cells.begin() + 8,
                    [](uint8_t byte) { return byte == 0xff; }) &&
            cells[8] == 0x10 && cells[9] == 0x10,
        "uniform-white Sharp cell is not lexicographically deterministic");
  check(fixture.video.stageFrame(newer.data(), newer.size(), palette.data(),
                                 palette.size(), RenderMode::Sharp) ==
                StageResult::Accepted &&
            !fixture.video.busy() && fixture.video.acceptedFrames() == 5 &&
            fixture.video.droppedFrames() == 2,
        "Sharp dirty/drop accounting is wrong");
  fixture.guards();
  std::cout << "Sharp PASS: exact two-color cells, ACK/retry dirty update, "
               "atomic busy drop and frozen plan.\n";
}

void makeSplitTieFrame(std::vector<uint8_t> &frame) {
  for (uint8_t band = 0; band != Video::Bands; ++band) {
    const uint16_t y0 = uint16_t(band) * 8u;
    for (uint8_t row = 0; row != 8; ++row) {
      for (uint16_t x = 0; x != Video::SourceWidth; ++x) {
        uint8_t color = 2;
        if (row < 2u) color = (x & 1u) ? 3 : 2;
        if (row >= 6u) color = (x & 1u) ? 7 : 2;
        frame[size_t(y0 + row) * Video::SourceWidth + x] = color;
      }
    }
  }
}

void verifyEnhancedPlans() {
  Fixture fixture;
  std::vector<uint8_t> frame(Video::SourceBytes, 0);
  makeSplitTieFrame(frame);
  auto palette = vicPalette();
  std::vector<uint8_t> cells(Video::FrameBytes, 0);

  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Auto8) ==
            StageResult::Accepted,
        "Auto8 frame was rejected");
  const FramePlan autoPlan = fixture.video.framePlan();
  check(autoPlan.mode == RenderMode::Auto8 && autoPlan.enhancedMask == 0xffu,
        "Auto8 did not choose the lower eight equal-gain bands");
  for (uint8_t band = 0; band != Video::Bands; ++band)
    check(autoPlan.split[band] == (band < 8u ? 2u : 0u),
          "Auto8 split tie was not stable or an unselected split leaked");

  // Neither an unacknowledged first batch, a busied mode switch nor subsequent
  // reuse of source memory may publish or alter the accepted Auto8 target.
  std::array<uint8_t,
             Video::MaximumRecordsPerBatch * Video::RecordBytes> firstBatch{};
  check(fixture.video.changes(firstBatch.data(),
                              Video::MaximumRecordsPerBatch) ==
                Video::MaximumRecordsPerBatch &&
            fixture.video.awaitingAcknowledgement() &&
            !fixture.video.initialComplete() &&
            fixture.video.publishedPlan().mode == RenderMode::Color,
        "Auto8 plan published before its first cell batch was acknowledged");
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Enhanced25) ==
                StageResult::DroppedBusy &&
            samePlan(fixture.video.framePlan(), autoPlan),
        "busy Enhanced25 request changed the Auto8 plan");
  fixture.video.rejectChanges();
  check(!fixture.video.awaitingAcknowledgement() &&
            fixture.video.pendingCells() == Video::Cells,
        "rejected Auto8 batch consumed cells or remained in flight");
  std::fill(frame.begin(), frame.end(), 1);
  std::fill(palette.begin(), palette.end(), 0xff);
  check(drain(fixture.video, cells) == Video::Cells &&
            samePlan(fixture.video.publishedPlan(), autoPlan),
        "Auto8 target or plan did not publish completely");

  const uint8_t *selected = cells.data();
  check(selected[8] == 0x32 && selected[9] == 0x72 &&
            selected[0] == 0x55 && selected[1] == 0x55 &&
            std::all_of(selected + 2, selected + 6,
                        [](uint8_t byte) { return byte == 0; }) &&
            selected[6] == 0x55 && selected[7] == 0x55,
        "Auto8 did not store both pair attributes in its ten-byte cell");
  check(hiresColor(cells, 0, 0, autoPlan) == 2 &&
            hiresColor(cells, 1, 0, autoPlan) == 3 &&
            hiresColor(cells, 0, 7, autoPlan) == 2 &&
            hiresColor(cells, 1, 7, autoPlan) == 7,
        "Auto8 frame plan does not decode the selected cell");
  const uint8_t *unselected =
      cells.data() + size_t(8u * Video::CellsPerBand) * Video::CellBytes;
  check(unselected[8] == unselected[9],
        "unselected Auto8 band did not mirror its Sharp attribute");

  frame.assign(Video::SourceBytes, 0);
  makeSplitTieFrame(frame);
  palette = vicPalette();
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Enhanced25) ==
                StageResult::Accepted &&
            fixture.video.pendingCells() == Video::Cells,
        "Enhanced25 mode change was not a complete replacement");
  const FramePlan enhancedPlan = fixture.video.framePlan();
  check(enhancedPlan.mode == RenderMode::Enhanced25 &&
            enhancedPlan.enhancedMask == Video::AllBandsMask,
        "Enhanced25 did not select every beneficial band");
  for (uint8_t band = 0; band != Video::Bands; ++band)
    check(enhancedPlan.split[band] == 2,
          "Enhanced25 split tie did not choose the lowest scanline");
  check(drain(fixture.video, cells) == Video::Cells &&
            samePlan(fixture.video.publishedPlan(), enhancedPlan),
        "Enhanced25 plan was not frozen through publication");
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Enhanced25) ==
                StageResult::Accepted &&
            !fixture.video.busy(),
        "identical Enhanced25 frame produced dirty records");

  std::fill(frame.begin(), frame.end(), 0);
  check(fixture.video.stageFrame(frame.data(), frame.size(), palette.data(),
                                 palette.size(), RenderMode::Auto8) ==
                StageResult::Accepted &&
            fixture.video.pendingCells() == Video::Cells &&
            fixture.video.framePlan().enhancedMask == 0,
        "non-beneficial Auto8 frame retained stale enhanced bands");
  for (uint8_t split : fixture.video.framePlan().split)
    check(split == 0, "non-beneficial Auto8 frame retained a stale split");
  fixture.guards();
  std::cout << "Enhanced PASS: stable split ties, Auto8 top-eight mask, "
               "Enhanced25 all-beneficial mask and full mode replacement.\n";
}

}  // namespace

int main() {
  try {
    verifyBoundsAndImmutableInitialFrame();
    verifyColorSquish();
    verifySharpDirtyAndBackpressure();
    verifyEnhancedPlans();
    std::cout << "MPE video PASS: unwired indexed8 Color/Sharp/Auto8/"
                 "Enhanced25 foundation (workspace "
              << Video::WorkspaceBytes << " bytes).\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "MPE video FAILED: " << error.what() << '\n';
    return 1;
  }
}
