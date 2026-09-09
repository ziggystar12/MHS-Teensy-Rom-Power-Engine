#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#define FLASHMEM
enum { rwRegPageNumber = 14, rRegNumPages = 15, rRegNumItemsOnPage = 13,
       rwRegCursorItemOnPg = 12, rwRegSelItemOnPage = 11, rwRegMenuView = 106,
       rwRegViewTopLo = 107, rwRegViewTopHi = 108, rRegViewCountLo = 109, rRegViewCountHi = 110,
       rtDirectory = 2, rtFilePrg = 6 };
static const uint16_t MaxItemsPerPage = 19;
static const uint16_t MaxDesktopItemsPerPage = 25;
static const uint16_t DesktopViewportItems = 16, DesktopViewportColumns = 4, DesktopLabelLength = 22;
static const char* UpDirString = "/.. <Up Dir>";
struct StructMenuItem { uint8_t ItemType; const char* Name; };
static uint8_t registers[111];
static volatile uint8_t* IO1 = registers;
static StructMenuItem* MenuSource;
static uint16_t NumItemsFull, SelItemFullIdx;

// Compile the production map and register integration, not a second algorithm.
#include "../MinimalBoot/Common/IO_Handlers/DesktopMenuView.c"

int main() {
   unsigned scenarios = 0;
   for (unsigned files : {0u, 1u, 18u, 19u, 20u, 24u, 25u, 26u, 37u, 38u, 39u, 49u, 50u, 51u, 3999u}) {
      for (unsigned parent : {0u, files / 2, files}) {
         std::vector<std::string> names;
         names.reserve(files + 1);
         for (unsigned i = 0; i <= files; ++i) names.push_back("FILE" + std::to_string(i) + ".PRG");
         names[parent] = UpDirString;
         std::vector<StructMenuItem> menu;
         for (unsigned i = 0; i <= files; ++i)
            menu.push_back({static_cast<uint8_t>(i == parent ? rtDirectory : rtFilePrg), names[i].c_str()});
         MenuSource = menu.data();
         NumItemsFull = static_cast<uint16_t>(menu.size());
         for (unsigned desktop : {0u, 1u}) {
            IO1[rwRegMenuView] = desktop;
            MenuViewRebuild();
            const unsigned visible = files + (desktop ? 0 : 1);
            const unsigned pageSize = desktop ? 25 : 19;
            assert(MenuViewPageSize == pageSize);
            assert(MenuViewCount == visible);
            assert(IO1[rRegNumPages] == (visible ? (visible - 1) / pageSize + 1 : 1));
            for (unsigned i = 0; i < visible; ++i) {
               MenuViewSetPage(i / pageSize + 1);
               assert(MenuViewSelect(i % pageSize));
               const unsigned raw = desktop && i >= parent ? i + 1 : i;
               assert(SelItemFullIdx == raw);
               assert(MenuViewFromRaw(raw) == i);
               // Metadata, launch and file operations all consume this raw item.
               assert(MenuSource[SelItemFullIdx].Name == names[raw].c_str());
               if (desktop) assert(std::strcmp(MenuSource[SelItemFullIdx].Name, UpDirString) != 0);
               MenuViewSetCursorRaw(raw);
               assert(IO1[rwRegPageNumber] == i / pageSize + 1);
               assert(IO1[rwRegCursorItemOnPg] == i % pageSize);
               assert(SelItemFullIdx == raw);
            }
            MenuViewSetPage(255);
            const unsigned lastCount = visible ? (visible - 1) % pageSize + 1 : 0;
            assert(IO1[rRegNumItemsOnPage] == lastCount);
            assert(!MenuViewSelect(static_cast<uint8_t>(lastCount)));
            assert(SelItemFullIdx >= NumItemsFull);
            assert(!MenuViewSelectionValid());
            MenuViewSetPage(0);
            assert(IO1[rwRegPageNumber] == 1);
            if (!visible) {
               assert(!MenuViewSelectCursor());
               assert(IO1[rRegNumItemsOnPage] == 0);
               assert(SelItemFullIdx == MenuViewInvalid);
            }
            ++scenarios;
         }
         if (files) {
            // View writes happen in the ISR before MenuViewApply. Exercise
            // both directions from later pages, where using the requested
            // view's page size too early would silently select another file.
            for (unsigned raw : {0u, 18u, 19u, 24u, 25u, 26u, 37u, 38u, 49u, 50u, files}) {
               if (raw > files || raw == parent) continue;
               IO1[rwRegMenuView] = 0;
               MenuViewRebuild();
               MenuViewSetCursorRaw(raw);
               IO1[rwRegMenuView] = 1;
               assert(MenuViewPageSize == 19);
               assert(MenuViewSelectCursor() && SelItemFullIdx == raw);
               MenuViewApply();
               const unsigned visible = raw > parent ? raw - 1 : raw;
               assert(MenuViewPageSize == 25 && SelItemFullIdx == raw);
               assert(IO1[rwRegPageNumber] == visible / 25 + 1);
               assert(IO1[rwRegCursorItemOnPg] == visible % 25);
               IO1[rwRegMenuView] = 0;
               assert(MenuViewPageSize == 25);
               assert(MenuViewSelectCursor() && SelItemFullIdx == raw);
               MenuViewApply();
               assert(MenuViewPageSize == 19 && SelItemFullIdx == raw);
               assert(IO1[rwRegPageNumber] == raw / 19 + 1);
               assert(IO1[rwRegCursorItemOnPg] == raw % 19);
               ++scenarios;
            }
            // Classic parent selection switches safely to the first real file.
            IO1[rwRegMenuView] = 0;
            MenuViewRebuild();
            MenuViewSetCursorRaw(parent);
            IO1[rwRegMenuView] = 1;
            MenuViewApply();
            assert(SelItemFullIdx != parent);
            assert(MenuViewSelectionValid());
         }
      }
   }
   // A matching filename is not navigation; near matches are not navigation.
   StructMenuItem ordinary[] = {{rtFilePrg, UpDirString}, {rtDirectory, "/..GAMES"}, {rtDirectory, "/Games"}};
   MenuSource = ordinary;
   NumItemsFull = 3;
   IO1[rwRegMenuView] = 1;
   MenuViewRebuild();
   assert(MenuViewCount == 3 && MenuViewParent == MenuViewInvalid);
   for (unsigned i = 0; i < 3; ++i) assert(MenuViewToRaw(i) == i);
   ++scenarios;

   // Root folders have no synthetic parent. Keep the full 4,000-file limit,
   // the 25th tile, and remote/search raw cursor destinations addressable.
   std::vector<StructMenuItem> rootMenu(4000, {rtFilePrg, "ROOT.PRG"});
   MenuSource = rootMenu.data();
   NumItemsFull = 4000;
   IO1[rwRegMenuView] = 1;
   MenuViewRebuild();
   assert(MenuViewCount == 4000 && IO1[rRegNumPages] == 160);
   MenuViewSetPage(1);
   assert(MenuViewSelect(24) && SelItemFullIdx == 24); // Click / launch tile 25.
   assert(!MenuViewSelect(25));
   MenuViewSetPage(2);
   assert(MenuViewSelect(0) && SelItemFullIdx == 25); // File 26 starts page 2.
   for (unsigned raw : {24u, 25u, 26u, 3998u, 3999u}) {
      MenuViewSetCursorRaw(raw); // Same helper used by remote launch and search.
      assert(SelItemFullIdx == raw);
      assert(IO1[rwRegPageNumber] == raw / 25 + 1);
      assert(IO1[rwRegCursorItemOnPg] == raw % 25);
   }
   IO1[rwRegMenuView] = 0;
   MenuViewApply();
   assert(SelItemFullIdx == 3999 && IO1[rRegNumPages] == 211);
   assert(IO1[rwRegPageNumber] == 211 && IO1[rwRegCursorItemOnPg] == 9);
   ++scenarios;

   // Refresh after deletion crosses 26 -> 25 -> 0 files. Reuse the adapter's
   // save-page/cursor, rebuild, restore, clamp sequence without a second map.
   IO1[rwRegMenuView] = 1;
   for (unsigned parent : {0u, 26u}) {
      std::vector<StructMenuItem> menu(27, {rtFilePrg, "FILE.PRG"});
      menu[parent] = {rtDirectory, UpDirString};
      MenuSource = menu.data();
      NumItemsFull = 27;
      MenuViewRebuild();
      MenuViewSetPage(2);
      assert(MenuViewSelect(0));
      IO1[rwRegCursorItemOnPg] = 0;
      const uint8_t oldPage = IO1[rwRegPageNumber];
      const uint8_t oldCursor = IO1[rwRegCursorItemOnPg];
      menu.erase(menu.begin() + (parent == 0 ? 26 : 25));
      MenuSource = menu.data();
      NumItemsFull = 26;
      MenuViewRebuild();
      IO1[rwRegCursorItemOnPg] = oldCursor;
      MenuViewSetPage(oldPage);
      assert(IO1[rRegNumPages] == 1 && IO1[rRegNumItemsOnPage] == 25);
      assert(IO1[rwRegPageNumber] == 1 && MenuViewSelectionValid());
      assert(SelItemFullIdx == (parent == 0 ? 1 : 0));
      menu.assign(1, {rtDirectory, UpDirString});
      MenuSource = menu.data();
      NumItemsFull = 1;
      MenuViewRebuild();
      IO1[rwRegCursorItemOnPg] = 24;
      MenuViewSetPage(2);
      assert(IO1[rRegNumPages] == 1 && IO1[rRegNumItemsOnPage] == 0);
      assert(IO1[rwRegCursorItemOnPg] == 0 && !MenuViewSelectionValid());
      ++scenarios;
   }
   // Row scrolling never changes the underlying lookup name or raw index.
   // At the bottom, retain up to four complete rows rather than a short page.
   for (unsigned count : {0u,1u,3u,4u,15u,16u,17u,20u,21u,255u,256u,3999u,4000u}) {
      std::vector<StructMenuItem> menu(count, {rtFilePrg, "Text.txt"});
      MenuSource = menu.data(); NumItemsFull = count;
      IO1[rwRegMenuView] = 2; MenuViewRebuild(); MenuViewSetTop(0);
      assert(MenuViewPageSize == 16);
      assert(unsigned(IO1[rRegViewCountLo] | (IO1[rRegViewCountHi] << 8)) == count);
      const unsigned maxTop = count > 16 ? ((count + 3) / 4 - 4) * 4 : 0;
      for (unsigned top = 0; top <= count + 4; ++top) {
         const auto prior = MenuViewTop;
         const auto priorSelection = SelItemFullIdx;
         MenuViewWriteTopLow(top & 255);
         assert(MenuViewTop == prior && SelItemFullIdx == priorSelection); // staged low cannot tear selection
         MenuViewWriteTopHigh(top >> 8);
         const unsigned expected = (top / 4) * 4 > maxTop ? maxTop : (top / 4) * 4;
         assert(MenuViewTop == expected);
         assert(IO1[rRegNumItemsOnPage] == (count - expected > 16 ? 16 : count - expected));
         for (unsigned local = 0; local < IO1[rRegNumItemsOnPage]; ++local) {
            assert(MenuViewSelect(local) && SelItemFullIdx == expected + local);
            assert(!strcmp(MenuSource[SelItemFullIdx].Name, "Text.txt"));
         }
         assert(!MenuViewSelect(IO1[rRegNumItemsOnPage]));
      }
      for (unsigned raw = 0; raw < count; ++raw) {
         MenuViewSetCursorRaw(raw);
         assert(SelItemFullIdx == raw && IO1[rwRegCursorItemOnPg] < 16);
         IO1[rwRegMenuView] = 0; MenuViewApply();
         assert(SelItemFullIdx == raw);
         IO1[rwRegMenuView] = 2; MenuViewApply();
         assert(SelItemFullIdx == raw);
      }
      MenuViewSetTop(65535); assert(MenuViewTop == maxTop);
      ++scenarios;
   }
   for (const char* name : {"Text.txt", "TEXT.TXT", "MiXeD_Name-v2.PrG", ".hidden", "A.B.C", "Very long name with spaces.PRG", "123456789012345678901234567890"}) {
      char out[24]; memset(out, 0x7b, sizeof out);
      const std::string original(name);
      MenuViewMakeLabel(out, name);
      assert(out[23] == 0x7b && strlen(out) <= 22 && original == name);
      if (original.size() <= 22) assert(original == out);
      else assert(strstr(out, "..."));
      if (original.size() > 22 && original.find_last_of('.') != std::string::npos)
         assert(std::string(out).substr(strlen(out)-4) == ".PRG");
      ++scenarios;
   }
   std::puts((std::to_string(scenarios) + " desktop menu view scenarios passed").c_str());
}
