#ifndef DRIVE_DIRECTORY_SUPPORT_H
#define DRIVE_DIRECTORY_SUPPORT_H

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// Keep filename storage in a handful of stable blocks. Directory entries keep
// raw pointers, so a growing/reallocating flat buffer would invalidate every
// pointer already published to the menu.
#ifndef DRIVE_DIR_NAME_BLOCK_BYTES
#define DRIVE_DIR_NAME_BLOCK_BYTES 4096u
#endif

struct DriveDirNameBlock
{
   DriveDirNameBlock *Next;
   size_t Used;
   size_t Capacity;
   char Data[1];
};

struct DriveDirNamePool
{
   DriveDirNameBlock *Head;
};

static inline void DriveDirNamePoolClear(DriveDirNamePool *Pool)
{
   DriveDirNameBlock *Block = Pool->Head;
   while (Block != NULL)
   {
      DriveDirNameBlock *Next = Block->Next;
      free(Block);
      Block = Next;
   }
   Pool->Head = NULL;
}

static inline char *DriveDirNamePoolAlloc(DriveDirNamePool *Pool, size_t Bytes)
{
   if (Bytes == 0) return NULL;

   DriveDirNameBlock *Block = Pool->Head;
   if (Block == NULL || Block->Capacity - Block->Used < Bytes)
   {
      const size_t Capacity = Bytes > DRIVE_DIR_NAME_BLOCK_BYTES ? Bytes : DRIVE_DIR_NAME_BLOCK_BYTES;
      const size_t HeaderBytes = offsetof(DriveDirNameBlock, Data);
      if (Capacity > SIZE_MAX - HeaderBytes) return NULL;
      Block = (DriveDirNameBlock *)malloc(HeaderBytes + Capacity);
      if (Block == NULL) return NULL;
      Block->Next = Pool->Head;
      Block->Used = 0;
      Block->Capacity = Capacity;
      Pool->Head = Block;
   }

   char *Result = Block->Data + Block->Used;
   Block->Used += Bytes;
   return Result;
}

static inline int DriveDirASCIIToLower(unsigned char Character)
{
   return Character >= 'A' && Character <= 'Z' ? Character + ('a' - 'A') : Character;
}

static inline int DriveDirCaseCompare(const char *Left, const char *Right)
{
   while (*Left != 0 && *Right != 0)
   {
      const int LeftFolded = DriveDirASCIIToLower((unsigned char)*Left);
      const int RightFolded = DriveDirASCIIToLower((unsigned char)*Right);
      if (LeftFolded != RightFolded) return LeftFolded - RightFolded;
      ++Left;
      ++Right;
   }
   return DriveDirASCIIToLower((unsigned char)*Left) - DriveDirASCIIToLower((unsigned char)*Right);
}

// Parent first, directories next, then files. A case-sensitive tie-break makes
// the result deterministic even if a case-sensitive source contains names that
// FAT would normally consider equivalent.
static inline int DriveDirCompareNames(const char *LeftName, uint8_t LeftType,
   const char *RightName, uint8_t RightType, uint8_t DirectoryType, const char *ParentName)
{
   const bool LeftParent = strcmp(LeftName, ParentName) == 0;
   const bool RightParent = strcmp(RightName, ParentName) == 0;
   if (LeftParent != RightParent) return LeftParent ? -1 : 1;

   const bool LeftDirectory = LeftType == DirectoryType;
   const bool RightDirectory = RightType == DirectoryType;
   if (LeftDirectory != RightDirectory) return LeftDirectory ? -1 : 1;

   const char *LeftSortName = LeftDirectory && LeftName[0] == '/' ? LeftName + 1 : LeftName;
   const char *RightSortName = RightDirectory && RightName[0] == '/' ? RightName + 1 : RightName;
   const int Folded = DriveDirCaseCompare(LeftSortName, RightSortName);
   return Folded != 0 ? Folded : strcmp(LeftSortName, RightSortName);
}

static inline const char *DriveDirExtension(const char *FileName)
{
   const size_t Length = strlen(FileName);
   if (Length < 4) return NULL;
   const char *Extension = strrchr(FileName, '.');
   // Preserve the established 1-3 character extension rule (2-4 with dot).
   if (Extension == NULL || Extension > FileName + Length - 2 || Extension < FileName + Length - 4)
      return NULL;
   return Extension + 1;
}

template <typename Association>
static inline uint8_t DriveDirItemTypeForExtension(const char *FileName,
   const Association *Associations, size_t AssociationCount, uint8_t UnknownType)
{
   const char *Extension = DriveDirExtension(FileName);
   if (Extension == NULL) return UnknownType;
   for (size_t Index = 0; Index < AssociationCount; ++Index)
      if (DriveDirCaseCompare(Extension, Associations[Index].Extension) == 0)
         return Associations[Index].ItemType;
   return UnknownType;
}

enum DriveSDMountDecision : uint8_t
{
   DriveSDUseMounted = 0,
   DriveSDNoCard,
   DriveSDBeginMount
};

static inline DriveSDMountDecision DriveSDDecideMount(bool MediaMounted, bool CardInserted)
{
   if (MediaMounted) return DriveSDUseMounted;
   return CardInserted ? DriveSDBeginMount : DriveSDNoCard;
}

// A card that is physically present but failed to mount can make SD.begin()
// block for seconds. Share that failure across all consumers in one media
// generation; an explicit refresh or a remove/reinsert edge advances the
// generation and permits one new attempt sequence.
static const uint32_t DriveSDMountRetryDelayMs = 1000u;
static inline bool DriveSDMountRetryAllowed(bool MountFailed, uint32_t FailureGeneration,
   uint32_t CurrentGeneration, uint32_t FailureAgeMs)
{
   return !MountFailed || FailureGeneration != CurrentGeneration ||
      FailureAgeMs >= DriveSDMountRetryDelayMs;
}

// Implemented by Teensy.ino. Firmware consumers such as startup discovery can
// use the generation to invalidate a completed scan when media changes or the
// user explicitly reopens the SD source.
uint32_t SDMediaGeneration();
void SDRequestExplicitRefresh();
bool SDFullInit();

#endif
