mod library;
use library::*;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

struct WatchState(Mutex<Option<RecommendedWatcher>>);
fn restart_watch(app: &tauri::AppHandle) -> Result<()> {
    let handle = app.clone();
    let last = AtomicU64::new(0);
    let mut watcher = notify::recommended_watcher(
        move |event: std::result::Result<notify::Event, notify::Error>| {
            if let Ok(event) = event {
                if !matches!(event.kind, notify::EventKind::Access(_)) {
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    if now.saturating_sub(last.load(Ordering::Relaxed)) > 500 {
                        last.store(now, Ordering::Relaxed);
                        let _ = handle.emit("library-changed", ());
                    }
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;
    for source in app.state::<Library>().sources()? {
        let path = PathBuf::from(source.path);
        if path.is_dir() {
            watcher
                .watch(&path, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
    }
    *app.state::<WatchState>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_sources(app: tauri::AppHandle) -> Result<Vec<Source>> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.sources()).await
}
#[tauri::command]
async fn list_photos(app: tauri::AppHandle, query: Query) -> Result<Page> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.list(query)).await
}
#[tauri::command]
async fn refresh_library(app: tauri::AppHandle) -> Result<Scan> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.scan()).await
}
#[tauri::command]
async fn add_source(app: tauri::AppHandle) -> Result<bool> {
    let lib = app.state::<Library>().inner().clone();
    let changed = blocking(move || {
        if let Some(path) = rfd::FileDialog::new()
            .set_title("选择照片文件夹")
            .pick_folder()
        {
            lib.add_source(&path)?;
            lib.scan()?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await?;
    if changed {
        restart_watch(&app)?
    }
    Ok(changed)
}
#[tauri::command]
async fn remove_source(app: tauri::AppHandle, id: String) -> Result<()> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.remove_source(&id)).await?;
    restart_watch(&app)
}
#[tauri::command]
async fn get_thumbnail(app: tauri::AppHandle, id: String) -> Result<String> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.thumbnail(&id)).await
}
#[tauri::command]
async fn get_preview(app: tauri::AppHandle, id: String) -> Result<String> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.preview(&id)).await
}
#[tauri::command]
async fn get_details(app: tauri::AppHandle, id: String) -> Result<Details> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.details(&id)).await
}
#[tauri::command]
async fn set_favorite(app: tauri::AppHandle, id: String, value: bool) -> Result<()> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.favorite(&id, value)).await
}
#[tauri::command]
async fn delete_photos(app: tauri::AppHandle, ids: Vec<String>) -> Result<usize> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || lib.delete(&ids)).await
}
#[tauri::command]
async fn show_in_folder(app: tauri::AppHandle, id: String) -> Result<()> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || {
        let path = lib.photo_path(&id)?;
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", path.display()))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}
#[derive(Serialize)]
struct ImportResult {
    count: usize,
    cancelled: bool,
}
#[tauri::command]
async fn import_files(app: tauri::AppHandle) -> Result<ImportResult> {
    let lib = app.state::<Library>().inner().clone();
    let result = blocking(move || {
        let Some(files) = rfd::FileDialog::new()
            .set_title("选择要导入的照片")
            .add_filter(
                "照片",
                &[
                    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "ico",
                ],
            )
            .pick_files()
        else {
            return Ok(ImportResult {
                count: 0,
                cancelled: true,
            });
        };
        let Some(target) = rfd::FileDialog::new()
            .set_title("选择导入目标文件夹")
            .pick_folder()
        else {
            return Ok(ImportResult {
                count: 0,
                cancelled: true,
            });
        };
        let target = target.canonicalize().map_err(|e| e.to_string())?;
        let mut count = 0;
        for source in files {
            if source.parent().and_then(|v| v.canonicalize().ok()).as_ref() == Some(&target) {
                continue;
            }
            let name = source.file_name().ok_or("文件名无效")?;
            let mut dest = target.join(name);
            let stem = source.file_stem().unwrap_or_default().to_string_lossy();
            let ext = source.extension().unwrap_or_default().to_string_lossy();
            let mut suffix = 1;
            while dest.exists() {
                dest = target.join(format!("{stem} ({suffix}).{ext}"));
                suffix += 1;
            }
            let mut input = fs::File::open(&source).map_err(|e| e.to_string())?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&dest)
                .map_err(|e| e.to_string())?;
            if let Err(e) = std::io::copy(&mut input, &mut output) {
                drop(output);
                let _ = fs::remove_file(&dest);
                return Err(format!("已导入 {count} 张，复制失败：{e}"));
            }
            count += 1;
        }
        lib.add_source(&target)?;
        lib.scan()?;
        Ok(ImportResult {
            count,
            cancelled: false,
        })
    })
    .await?;
    if !result.cancelled {
        restart_watch(&app)?
    }
    Ok(result)
}
#[tauri::command]
async fn export_edit(app: tauri::AppHandle, id: String, edit: Edit) -> Result<Option<String>> {
    let lib = app.state::<Library>().inner().clone();
    blocking(move || {
        let source = lib.photo_path(&id)?;
        let name = format!(
            "{}-edited.png",
            source.file_stem().unwrap_or_default().to_string_lossy()
        );
        let Some(dest) = rfd::FileDialog::new()
            .set_title("保存编辑后的副本")
            .set_file_name(&name)
            .add_filter("PNG", &["png"])
            .add_filter("JPEG", &["jpg", "jpeg"])
            .add_filter("WebP", &["webp"])
            .save_file()
        else {
            return Ok(None);
        };
        save_copy(&source, &dest, &edit)?;
        let _ = lib.scan();
        Ok(Some(dest.to_string_lossy().into_owned()))
    })
    .await
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let data = std::env::var_os("PHOTOS_TEST_DATA")
                .map(PathBuf::from)
                .unwrap_or(data);
            let cache = data.join("thumbnails");
            let lib = Library::open(&data, &cache).map_err(std::io::Error::other)?;
            #[cfg(debug_assertions)]
            if let Some(root) = std::env::var_os("PHOTOS_TEST_ROOT") {
                lib.add_source(&PathBuf::from(root))
                    .map_err(std::io::Error::other)?;
                lib.scan().map_err(std::io::Error::other)?;
            }
            app.manage(lib);
            app.manage(WatchState(Mutex::new(None)));
            restart_watch(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sources,
            list_photos,
            refresh_library,
            add_source,
            remove_source,
            get_thumbnail,
            get_preview,
            get_details,
            set_favorite,
            delete_photos,
            show_in_folder,
            import_files,
            export_edit
        ])
        .run(tauri::generate_context!())
        .expect("启动照片应用失败");
}
