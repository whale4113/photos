# 幻灯片音乐证据

目标：`../photos-recovery/snapshot/Slideshow.dll`，SHA-256 `B7D1E1ED35C216F972ECF783ABF6742BA715AD2AF5D6D218DD1E2608E0B297AA`。

2026-10-17 静态 UTF-16 字符串扫描观察到 `IsMusicOn`、`IsMuted`、`VolumeLevel`、`SlideshowToggleMute`、`SlideshowMusicTrackPreviewed`、`SlideshowMusicTrackSelected`，以及六组四首曲目的 `MusicOption{Chill,Beats,Sentimental,Fun,Energetic,Epic}_{1..4}` 标识。曲目缓存路径为 `ms-appdata:///local/Slideshow/Music/Audio/`，另有 ETags 缓存目录。

DLL 包含公开曲目目录 URL `https://hubblecontent.osi.office.net/contentsvc/api/pivots/72b42841-c22c-44fd-9ac3-964371503269?app=29` 和 CDN 根 `https://cdn.hubblecontent.osi.office.net/`。当日读取目录返回 Count=24，包含各曲目的 Description、PivotNames、IntroPath、Path。保存到 src/slideshow-tracks.json 的仅是这些元数据，没有复制音频。首曲 Main URL 的 HEAD 返回 200。

实现对应六分类、24 首、音乐开关、音量与静音、随幻灯片暂停/恢复和重新开始，以及 intro 播完转 main 循环。intro→main 是基于 API 字段和 DLL 的 track transition 错误字符串作出的实现推断；没有运行原版验证交叉淡化时长或曲目预听策略。网络失败保留明确错误与重试，提供本地音频替代。音频仅在开启音乐后加载。

本地音乐支持多选，按文件选择器返回的列表顺序依次播放，末曲结束后回到首曲；重新播放从首曲开始，暂停恢复保持当前曲目。替换队列、切回内置音乐及退出幻灯片时释放本地 object URL。此队列行为是用户要求的扩展，不是已验证的原版行为。

按钮显隐修复：鼠标点击残留的普通焦点不再阻止隐藏，键盘 `:focus-visible`、工具栏悬停及展开的音乐面板保留操作界面；鼠标移出幻灯片区域时隐藏并关闭音乐面板，移动或重新进入时恢复。保留现有 2600ms 无操作延时。原包 `SlideshowControl.xbf` / `SlideshowPlaybackToolbar.xbf` 字符串可确认独立工具栏、选项菜单及 `PlaybackToolbar_Visible` 状态，但不足以证明原版隐藏计时与完整事件逻辑，未进行原版运行时对照。

`npm run test:slideshow:controls` 在浏览器中验证鼠标点击后隐藏、离开/恢复、键盘焦点、展开面板、本地队列顺序与循环、重播及 URL 释放；音频结束使用事件模拟，未验证系统音频输出。
