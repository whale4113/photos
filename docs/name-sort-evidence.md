# Name sorting

Reference binary: `D:/workspace/photos-recovery/snapshot/PhotosCore.dll`, SHA-256 `03f19eed6371fb9d42b8389a304e6368f8759217f9aac37785eb52542abc5454` (identity verified with REA open_binary).

Saved static decompilation: `D:/workspace/photos-recovery/native-analysis/decompiled/PhotosCore.dll/functions.pseudo.c`.

- `FUN_180071b10`, address `0x180071b10`, selects the name comparators when sort is 3. The recovered `Photos.Models.Sort` enum maps 3 to Name.
- `FUN_1800713d0` and `FUN_180071410`, addresses `0x1800713d0` and `0x180071410`, call `CompareStringW(0, 9, …, -1, …, -1)` and test results 1 and 3 respectively.
- Locale 0 is LOCALE_NEUTRAL; flags 9 combine NORM_IGNORECASE (1) and SORT_DIGITSASNUMBERS (8). Digit sequences are compared as numbers.

The reconstruction registers the same Windows API comparison as SQLite collation PHOTOS_NAME so ordering applies before LIMIT/OFFSET. Existing id ordering remains as a deterministic tie breaker; the original comparator reports equivalent names as equal, and its tie order has not been established.

Limitations: conclusions use saved static decompilation, not observation of the original running application. Fresh REA pseudocode was unavailable because no native analysis provider was configured. Non-Windows builds use a lowercase lexical fallback and do not reproduce Windows linguistic ordering.
