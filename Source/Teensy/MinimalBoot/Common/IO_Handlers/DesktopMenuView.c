// The backend keeps its original menu and raw indices. Only the C64 desktop's
// page numbering excludes the one synthetic parent supplied by each directory.
// Scan names in the main loop; IO handlers below use constant-time RAM math.
static uint16_t MenuViewParent = 0xffff;
static uint16_t MenuViewCount = 0;
// The requested register changes before MenuViewApply captures the old cursor.
// Keep the active page size with the active map until that rebuild completes.
static uint8_t MenuViewPageSize = MaxItemsPerPage;
static uint8_t MenuViewActive = 0;
static uint16_t MenuViewTop = 0;
static uint8_t MenuViewPendingTopLo = 0;
static const uint16_t MenuViewInvalid = 0xffff;

uint16_t MenuViewToRaw(uint16_t item) {
   if (item >= MenuViewCount) return MenuViewInvalid;
   return item >= MenuViewParent ? item + 1 : item;
}

uint16_t MenuViewFromRaw(uint16_t item) {
   if (item >= NumItemsFull || item == MenuViewParent) return MenuViewInvalid;
   return item > MenuViewParent ? item - 1 : item;
}

bool MenuViewSelectionValid() { return MenuSource && SelItemFullIdx < NumItemsFull; }

bool MenuViewSelect(uint8_t item) {
   const uint8_t page = IO1[rwRegPageNumber];
   SelItemFullIdx = page && page <= IO1[rRegNumPages] && item < IO1[rRegNumItemsOnPage]
      ? MenuViewToRaw(MenuViewTop + item) : MenuViewInvalid;
   return MenuViewSelectionValid();
}

bool MenuViewSelectCursor() { return MenuViewSelect(IO1[rwRegCursorItemOnPg]); }

void MenuViewSetTop(uint16_t top) {
   if (MenuViewActive == 2) {
      const uint16_t rows = (MenuViewCount + DesktopViewportColumns - 1) / DesktopViewportColumns;
      const uint16_t maxTop = rows > 4 ? (rows - 4) * DesktopViewportColumns : 0;
      top -= top % DesktopViewportColumns;
      if (top > maxTop) top = maxTop;
   }
   MenuViewTop = top;
   IO1[rwRegViewTopLo] = top;
   IO1[rwRegViewTopHi] = top >> 8;
   IO1[rwRegPageNumber] = top / MenuViewPageSize + 1;
   const uint16_t remaining = MenuViewCount > top ? MenuViewCount - top : 0;
   const uint8_t count = remaining > MenuViewPageSize ? MenuViewPageSize : remaining;
   IO1[rRegNumItemsOnPage] = count;
   if (IO1[rwRegCursorItemOnPg] >= count) IO1[rwRegCursorItemOnPg] = count ? count - 1 : 0;
   IO1[rwRegSelItemOnPage] = IO1[rwRegCursorItemOnPg];
   MenuViewSelectCursor();
}

void MenuViewSetPage(uint8_t page) {
   const uint8_t pages = IO1[rRegNumPages];
   if (page < 1) page = 1;
   if (page > pages) page = pages;
   MenuViewSetTop((page - 1) * MenuViewPageSize);
}

void MenuViewWriteTopLow(uint8_t value) { MenuViewPendingTopLo = value; }
void MenuViewWriteTopHigh(uint8_t value) {
   if (MenuViewActive == 2) MenuViewSetTop((uint16_t(value) << 8) | MenuViewPendingTopLo);
}

void MenuViewSetCursorRaw(uint16_t raw) {
   uint16_t item = MenuViewFromRaw(raw);
   if (item == MenuViewInvalid) item = 0;
   if (MenuViewActive == 2) {
      uint16_t top = MenuViewTop - MenuViewTop % DesktopViewportColumns;
      if (item < top) top = item - item % DesktopViewportColumns;
      else if (item >= top + DesktopViewportItems) top = item - item % DesktopViewportColumns - (DesktopViewportItems - DesktopViewportColumns);
      MenuViewSetTop(top);
      IO1[rwRegCursorItemOnPg] = item - MenuViewTop;
      IO1[rwRegSelItemOnPage] = IO1[rwRegCursorItemOnPg];
      MenuViewSelectCursor();
   } else {
      IO1[rwRegCursorItemOnPg] = item % MenuViewPageSize;
      MenuViewSetPage(item / MenuViewPageSize + 1);
   }
}

FLASHMEM void MenuViewRebuild() {
   MenuViewActive = IO1[rwRegMenuView];
   MenuViewPageSize = MenuViewActive == 2 ? DesktopViewportItems : MenuViewActive ? MaxDesktopItemsPerPage : MaxItemsPerPage;
   MenuViewParent = MenuViewInvalid;
   if (IO1[rwRegMenuView] && MenuSource) {
      for (uint16_t item = 0; item < NumItemsFull; ++item) {
         if (MenuSource[item].ItemType == rtDirectory && MenuSource[item].Name &&
             strcmp(MenuSource[item].Name, UpDirString) == 0) {
            MenuViewParent = item;
            break; // Directory/menu producers supply exactly one synthetic parent.
         }
      }
   }
   MenuViewCount = NumItemsFull - (MenuViewParent != MenuViewInvalid ? 1 : 0);
   IO1[rRegViewCountLo] = MenuViewCount;
   IO1[rRegViewCountHi] = MenuViewCount >> 8;
   IO1[rRegNumPages] = MenuViewCount ? (MenuViewCount - 1) / MenuViewPageSize + 1 : 1;
}

FLASHMEM void MenuViewApply() {
   // The old map still describes the cursor until the requested view is built.
   const uint8_t page = IO1[rwRegPageNumber];
   const uint16_t raw = page ? MenuViewToRaw(MenuViewTop + IO1[rwRegCursorItemOnPg]) : MenuViewInvalid;
   MenuViewRebuild();
   MenuViewSetCursorRaw(raw);
}

// This is presentation only. MenuSource[].Name remains the exact lookup name.
// Preserve the final extension where it fits, and make shortening explicit.
void MenuViewMakeLabel(char* out, const char* name) {
   if (!name) { out[0] = 0; return; }
   const size_t length = strlen(name);
   if (length <= DesktopLabelLength) { memcpy(out, name, length + 1); return; }
   const char* dot = strrchr(name, '.');
   const size_t tail = dot && dot != name && dot[1] ? strlen(dot) : 0;
   const size_t keepTail = tail && tail <= 10 ? tail : 0;
   const size_t prefix = DesktopLabelLength - 3 - keepTail;
   memcpy(out, name, prefix);
   memcpy(out + prefix, "...", 3);
   if (keepTail) memcpy(out + prefix + 3, dot, keepTail);
   out[DesktopLabelLength] = 0;
}
