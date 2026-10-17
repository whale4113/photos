# Viewer navigation and filmstrip evidence

Target: `D:/workspace/photos-recovery/snapshot/Lightbox.winmd`.
SHA-256: `1a42615125fceeaf34f1c8ba1532c60adbe5e865a9feca89f9b1beee31192aaf`.
MVID: `bc68af66-88c3-4c9b-8da5-ede2cc0f4886`.

REA `inspect_managed_members` selected `Lightbox.IFilmstrip`, `Lightbox.IFilmstripService`, `Lightbox.IMediaItemCollection`, `Lightbox.IMediaItemsState`: complete metadata coverage, 4 types and 50 methods. Evidence `ev_2383fac1cda4bd466608181d7242ce891244a4da11284927b70afb3f2e6996f3`; summary `ev_1fc929b40d63c7491e93a3bd0d76d611deb73f7a168e4cd777173d48d8d0bc48`.

Recovered declaration evidence:

- `recovered/Lightbox.winmd/Lightbox/IFilmstripService.cs`: `IsFilmstripVisible`, `FilmstripToggled`, `ToggleFilmstrip` establish a toggleable filmstrip.
- `IFilmstrip.cs`: `Collection`, `OneUpItem`, `IsCollectionFilmstripVisible`, `IsSelectedItemsFilmstripVisible` establish collection and active-photo state.
- `IMediaItemCollection.cs`: `VisibleRange`, `FilmStripVisibleRangeChangedEvent` establish explicit visible-range tracking.
- `IMediaItemsState.cs`: `OneUpHasNext`, `OneUpHasPrevious`, `OneUpGoNext`, `OneUpGoPrevious` establish synchronous navigation state/commands.
- `Telemetry/IAppTelemetryService.cs`: `LogFilmstripItemTapped(uint index)` establishes indexed thumbnail interaction.
- `BottomBarViewModel.cs`: `GetFilmstripButtonIcon/ToolTip/Label(bool isFilmstripVisible)` establishes a viewer toolbar control.

These are metadata declarations with external native implementations; no CIL bodies were returned. They do not prove the original caching, throttling, timing, thumbnail dimensions, automatic-scroll policy, or DOM-equivalent virtualization algorithm. We implement those as reconstruction decisions, not recovered source claims.

Reconstruction: a horizontal thumbnail track in the viewer, explicit show/hide control, current-photo border, click-to-navigate, active photo kept visible, and windowed thumbnail rendering with four-item overscan. Scroll near the loaded end requests another page. Vertical mouse-wheel input also scrolls the track. Navigation/decode optimization should maintain a synchronous target index and only present the latest completed request, using bounded preview caching and neighbor preloading.


Implemented navigation policy (engineering choices, not proven original timings): a synchronous target reference preserves burst clicks; a 60 ms settle interval skips full-preview work for transient targets; adjacent preview preloads start after 140 ms. Pending foreground and preload requests share one promise per id/version, foreground requests are prioritized, stale queued preloads are dropped, and at most two preview requests decode concurrently. Browser decoded-image caching has a 128 MiB estimated budget and 12-entry ceiling (a single oversized current image is retained). Rust stores generated previews under a file metadata-derived disk key so revisits avoid re-encoding. Detail/EXIF reads only occur with the info panel open. Manual slideshow navigation bypasses the long automatic transition.

Validation: `npm run test:navigation` uses mocked Tauri data/latency and 250 photos to check same-turn bursts, direction reversals, request deduplication, virtualized DOM size, show/hide, pagination and final boundaries. This establishes browser behavior under controlled replay, not latency measurements on real user images. `npm run test:slideshow:browser` checks all 17 effect modes. Rust preview-cache test checks reuse, invalidation and removal authorization. Original runtime/pixel equivalence remains unverified.
