# 幻灯片音乐证据

目标：`../photos-recovery/snapshot/Slideshow.dll`，SHA-256 `B7D1E1ED35C216F972ECF783ABF6742BA715AD2AF5D6D218DD1E2608E0B297AA`。

2026-10-17 静态 UTF-16 字符串扫描观察到 `IsMusicOn`、`IsMuted`、`VolumeLevel`、`SlideshowToggleMute`、`SlideshowMusicTrackPreviewed`、`SlideshowMusicTrackSelected`，以及六组四首曲目的 `MusicOption{Chill,Beats,Sentimental,Fun,Energetic,Epic}_{1..4}` 标识。曲目缓存路径为 `ms-appdata:///local/Slideshow/Music/Audio/`，另有 ETags 缓存目录。

DLL 包含公开曲目目录 URL `https://hubblecontent.osi.office.net/contentsvc/api/pivots/72b42841-c22c-44fd-9ac3-964371503269?app=29` 和 CDN 根 `https://cdn.hubblecontent.osi.office.net/`。当日读取目录返回 Count=24，包含各曲目的 Description、PivotNames、IntroPath、Path。保存到 src/slideshow-tracks.json 的仅是这些元数据，没有复制音频。首曲 Main URL 的 HEAD 返回 200。

实现对应六分类、24 首、音乐开关、音量与静音、随幻灯片暂停/恢复和重新开始，以及 intro 播完转 main 循环。intro→main 是基于 API 字段和 DLL 的 track transition 错误字符串作出的实现推断；没有运行原版验证交叉淡化时长或曲目预听策略。网络失败保留明确错误与重试，提供本地音频替代。音频仅在开启音乐后加载。
