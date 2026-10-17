# 照片（photos-tauri）

一个**可编译、可运行**的本地照片图库 / 查看 / 编辑应用，是对本机
`Microsoft.Windows.Photos`（Windows 照片）做逆向分析后，重新实现其**本地功能面**的独立工程。

它不是微软原始源码，也不依赖微软的私有二进制；UI、数据目录、缩略图与编辑都在本地完成，照片文件与数据库不会上传到任何云端服务。

## 为什么是这套技术栈

原版 Windows 照片的架构（见 `../photos-recovery/README.md` 与本目录底部「与原版架构对照」）：

- 打包：MSIX/AppX，`Photos.exe`（`Windows.FullTrustApplication`，全信任桌面进程）
- UI：WinUI 3 + Windows App SDK（`Microsoft.WinUI.dll`、`Microsoft.Windows.*.Projection.dll`）
- 运行时：.NET 9（ReadyToRun），核心图库为 `Photos.App.Collection.dll` / `PhotosManager.dll`
- 互操作：C++/WinRT 与 CsWinRT 双投影（`Photos.*.CppWinRT.dll` / `Photos.*.CsWinRT.dll` + `.winmd`）
- 云：Microsoft Graph Beta、Kiota、OneDrive、MSAL/IdentityModel（OAuth/OpenID Connect）
- AI/ML：Windows AI（Machine Learning/Imaging/Text）、ONNX Runtime、DirectML、oneocr（OCR）、AI 生成编辑模型
- 数据库：SQLite（`sqlite3.dll` + `Photos.Database.dll`）

这套栈是微软内部构建链 + 云服务 + 大型 AI 模型支撑的，无法用反编译产物直接重编译打包。
因此本工程选取**小而完整、无云依赖、跨平台桌面**的组合重新实现同样的产品面：

| 层 | 技术 | 作用 |
|---|---|---|
| 桌面外壳 | **Tauri 2**（Rust + WebView2） | 原生窗口、菜单、系统对话框、IPC |
| 后端 | **Rust** | SQLite 目录、图片解码/编辑、EXIF、文件监听、回收站 |
| 前端 | **React 19 + TypeScript + Vite** | 图库网格、查看器、编辑器、设置界面 |
| 图标 | **lucide-react** | 矢量图标 |

## 功能

- **图库**：所有照片 / 收藏夹 / 文件夹三种视图；按名称搜索、按日期或名称排序；虚拟化网格（只渲染可见区域），缩略图懒加载并缓存。
- **文件夹来源**：添加 / 移除本机文件夹（支持 OneDrive 等已同步到本机的目录）；自动去重叠（父文件夹吸收子文件夹并保留收藏）；文件系统监听，增删改后自动刷新。
- **导入**：从任意位置选文件，复制到目标文件夹，重名自动加序号，不覆盖原文件。
- **查看器**：大图预览、缩放（25%–400%）、旋转视图、上一张/下一张、幻灯片播放、信息面板（尺寸、大小、格式、修改日期、路径与 EXIF：制造商/相机/拍摄时间/曝光/光圈/ISO/焦距/镜头）。
- **编辑**：裁剪（自由拖动 + 1:1/4:3/3:2/16:9 预设）、旋转 90°、水平翻转、亮度/对比度/饱和度、黑白/复古滤镜、撤销/重做、按住对比原图、导出副本（PNG/JPEG/WebP）。**原图始终保留**。
- **收藏**：单张或批量收藏/取消收藏。
- **删除**：移至 Windows 回收站（可恢复），单张或批量。
- **在文件夹中显示**：调用资源管理器定位文件。
- **设置**：深色/浅色/跟随系统主题，缩略图大小，照片填充方式；偏好本地持久化。

支持格式：JPEG、PNG、WebP、GIF、BMP、TIFF、ICO。

## 目录结构

```
photos-tauri/
├─ src/                  # React 前端
│  ├─ App.tsx            # 图库/查看器/设置主界面
│  ├─ Editor.tsx         # 编辑器
│  ├─ model.ts           # 类型与编辑预览算法（前端即时预览）
│  ├─ api.ts             # Tauri IPC 封装与缩略图并发队列
│  ├─ main.tsx           # 入口
│  └─ style.css          # 样式
├─ src-tauri/            # Rust 后端
│  ├─ src/library.rs     # SQLite 目录、扫描、缩略图、编辑、删除
│  ├─ src/lib.rs         # Tauri 命令与文件监听
│  ├─ src/main.rs        # 进程入口
│  ├─ Cargo.toml         # Rust 依赖
│  └─ tauri.conf.json    # 窗口/CSP/打包配置
├─ package.json          # 前端依赖与脚本
├─ dev.ps1               # 一键环境 + 运行入口（dev/check/test/build/debug）
└─ index.html
```

## 运行

需要 Node.js ≥ 20 与 Rust 工具链（本机已在 `../.tools` 下提供便携 cargo + MSVC）。Windows 下用 `dev.ps1` 自动装配环境：

```powershell
# 开发运行（自动装配 cargo/MSVC，启动 Vite + Tauri）
./dev.ps1 dev

# 后端编译检查
./dev.ps1 check

# 后端单元测试（4 项）
./dev.ps1 test

# 前端类型检查
npm test

# 打包（NSIS 安装包）
./dev.ps1 build
```

无 Tauri 桌面环境时，`npm run dev` 仅提供浏览器界面预览（数据功能需在桌面应用内使用）。

## 数据与隐私

- 目录数据库：`%APPDATA%\..\Local` 的应用数据目录（`local.photos.rebuilt`）下的 `library.sqlite3`。
- 缩略图缓存：同目录下 `thumbnails/`。
- 除用户显式添加的本地文件夹外，不访问任何其他路径；不联网、不上传。

## 测试

- 后端：`library.rs` 内含 4 个单元测试，覆盖目录持久化、重叠来源保留收藏、裁剪+旋转+Alpha 保留、导出不覆盖原图。`./dev.ps1 test` 运行，结果见本仓库 `cargo-test.log`。
- 前端：`npm test` 执行 TypeScript 严格类型检查；`npm run build` 执行完整生产构建。

## 与原版架构对照（逆向结论）

| 关注点 | 原版 Windows 照片 | 本工程 |
|---|---|---|
| 应用宿主 | MSIX 打包，`Photos.exe` 全信任进程 | Tauri 2 桌面进程 |
| UI 框架 | WinUI 3 + Windows App SDK + XAML | React 19 + 原生 WebView |
| 主运行时 | .NET 9（CIL + ReadyToRun） | Rust |
| 云与账号 | Microsoft Graph Beta、OneDrive、MSAL OAuth | 无（纯本地） |
| AI/ML | Windows AI、ONNX Runtime、DirectML、oneocr、AI 生成编辑 | 无（本地像素级编辑） |
| 数据库 | SQLite（Photos.Database） | SQLite（rusqlite bundled） |
| 图像处理 | Win2D / Windows Imaging / Windows.AI.Imaging | `image` crate + `kamadak-exif` |

原版的完整技术栈与逐 DLL 依赖清单见 `../photos-recovery/`（含 AppxManifest、23 个托管 DLL 恢复工程、26 个 WinMD 声明、41 个原生模块的 Ghidra 伪 C 与逐文件 SHA-256 快照）。
