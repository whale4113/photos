use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Rgba};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{BufReader, Cursor},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone)]
pub struct Library {
    pub db: Arc<Mutex<Connection>>,
    pub cache: PathBuf,
    pub scanning: Arc<AtomicBool>,
}
#[derive(Serialize, Clone)]
pub struct Source {
    pub id: String,
    pub path: String,
    pub name: String,
    pub count: i64,
}
#[derive(Serialize, Clone)]
pub struct Photo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub source_id: String,
    pub modified: i64,
    pub bytes: i64,
    pub favorite: bool,
}
#[derive(Serialize)]
pub struct Page {
    pub items: Vec<Photo>,
    pub total: i64,
}
#[derive(Deserialize, Default)]
pub struct Query {
    pub source: Option<String>,
    pub search: Option<String>,
    pub favorites: Option<bool>,
    pub sort: Option<String>,
    pub offset: Option<i64>,
}
#[derive(Serialize)]
pub struct Scan {
    pub count: usize,
    pub skipped: usize,
}
#[derive(Serialize)]
pub struct Details {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub metadata: Vec<(String, String)>,
}
#[derive(Clone, Copy, Deserialize, Serialize, Debug)]
pub struct Crop {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
#[derive(Clone, Deserialize, Serialize, Default, Debug)]
pub struct Edit {
    pub rotation: i32,
    pub flip: bool,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub filter: String,
    pub crop: Option<Crop>,
}
pub fn id_for(path: &Path) -> String {
    format!(
        "{:x}",
        Sha256::digest(path.to_string_lossy().to_lowercase().as_bytes())
    )
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "ico"
    )
}

impl Library {
    pub fn open(data: &Path, cache: &Path) -> Result<Self> {
        fs::create_dir_all(data).map_err(err)?;
        fs::create_dir_all(cache).map_err(err)?;
        let db = Connection::open(data.join("library.sqlite3")).map_err(err)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,name TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,name TEXT NOT NULL,source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,modified INTEGER NOT NULL,bytes INTEGER NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,seen INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS photo_source ON photos(source_id); CREATE INDEX IF NOT EXISTS photo_date ON photos(modified DESC);").map_err(err)?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            cache: cache.to_owned(),
            scanning: Arc::new(AtomicBool::new(false)),
        })
    }
    pub fn sources(&self) -> Result<Vec<Source>> {
        let db = self.db.lock().map_err(err)?;
        let mut stmt=db.prepare("SELECT s.id,s.path,s.name,count(p.id) FROM sources s LEFT JOIN photos p ON p.source_id=s.id GROUP BY s.id ORDER BY s.name").map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Source {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    name: r.get(2)?,
                    count: r.get(3)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }
    pub fn add_source(&self, path: &Path) -> Result<()> {
        let path = path.canonicalize().map_err(err)?;
        if !path.is_dir() {
            return Err("请选择文件夹".into());
        }
        let sources = self.sources()?;
        if sources.iter().any(|s| path.starts_with(Path::new(&s.path))) {
            return Ok(());
        }
        // A parent folder replaces overlapping child sources without losing favorites.
        let mut db = self.db.lock().map_err(err)?;
        let tx = db.transaction().map_err(err)?;
        let id = id_for(&path);
        let name = path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy();
        tx.execute(
            "INSERT OR IGNORE INTO sources(id,path,name) VALUES(?1,?2,?3)",
            params![id, path.to_string_lossy(), name],
        )
        .map_err(err)?;
        for s in sources
            .iter()
            .filter(|s| Path::new(&s.path).starts_with(&path))
        {
            tx.execute(
                "UPDATE photos SET source_id=?1 WHERE source_id=?2",
                params![id, s.id],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM sources WHERE id=?1", params![s.id])
                .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn remove_source(&self, id: &str) -> Result<()> {
        self.db
            .lock()
            .map_err(err)?
            .execute("DELETE FROM sources WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }
    pub fn scan(&self) -> Result<Scan> {
        if self.scanning.swap(true, Ordering::SeqCst) {
            return Err("图库正在扫描，请稍候".into());
        }
        struct Reset(Arc<AtomicBool>);
        impl Drop for Reset {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst)
            }
        }
        let _reset = Reset(self.scanning.clone());
        let sources = self.sources()?;
        let mut count = 0;
        let mut skipped = 0;
        for source in sources {
            let root = Path::new(&source.path);
            // An unplugged drive retains its catalog until it is available again.
            if !root.is_dir() {
                skipped += 1;
                continue;
            }
            let mut entries = Vec::new();
            let mut walk_failed = false;
            for item in WalkDir::new(root).follow_links(false) {
                let item = match item {
                    Ok(v) => v,
                    Err(_) => {
                        skipped += 1;
                        walk_failed = true;
                        continue;
                    }
                };
                if !item.file_type().is_file() || !supported(item.path()) {
                    continue;
                }
                if entries.len() >= 200_000 {
                    return Err("单个文件夹超过 200,000 张，请拆分图库来源".into());
                }
                let meta = match item.metadata() {
                    Ok(v) => v,
                    Err(_) => {
                        skipped += 1;
                        walk_failed = true;
                        continue;
                    }
                };
                let canonical = match item.path().canonicalize() {
                    Ok(v) if v.starts_with(root) => v,
                    _ => {
                        skipped += 1;
                        continue;
                    }
                };
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
                    .map(|v| v.as_millis() as i64)
                    .unwrap_or(0);
                entries.push((
                    id_for(&canonical),
                    canonical.to_string_lossy().into_owned(),
                    item.file_name().to_string_lossy().into_owned(),
                    modified,
                    meta.len() as i64,
                ));
            }
            let mut db = self.db.lock().map_err(err)?;
            let tx = db.transaction().map_err(err)?;
            tx.execute("UPDATE photos SET seen=0 WHERE source_id=?1", [&source.id])
                .map_err(err)?;
            {
                let mut insert=tx.prepare("INSERT INTO photos(id,path,name,source_id,modified,bytes,seen) VALUES(?1,?2,?3,?4,?5,?6,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,source_id=excluded.source_id,modified=excluded.modified,bytes=excluded.bytes,seen=1").map_err(err)?;
                for (id, path, name, modified, bytes) in &entries {
                    insert
                        .execute(params![id, path, name, source.id, modified, bytes])
                        .map_err(err)?;
                }
            }
            if !walk_failed {
                tx.execute(
                    "DELETE FROM photos WHERE source_id=?1 AND seen=0",
                    [&source.id],
                )
                .map_err(err)?;
            }
            tx.commit().map_err(err)?;
            count += entries.len();
        }
        Ok(Scan { count, skipped })
    }
    pub fn list(&self, query: Query) -> Result<Page> {
        let db = self.db.lock().map_err(err)?;
        let source = query.source.unwrap_or_default();
        let search = query.search.unwrap_or_default().to_lowercase();
        let fav = query.favorites.unwrap_or(false);
        let filter="WHERE (?1='' OR source_id=?1) AND (?2='' OR instr(lower(name),?2)>0) AND (?3=0 OR favorite=1)";
        let total = db
            .query_row(
                &format!("SELECT count(*) FROM photos {filter}"),
                params![source, search, fav],
                |r| r.get(0),
            )
            .map_err(err)?;
        let order = match query.sort.as_deref() {
            Some("oldest") => "modified ASC,id ASC",
            Some("name") => "name COLLATE NOCASE ASC,id ASC",
            _ => "modified DESC,id ASC",
        };
        let sql=format!("SELECT id,name,path,source_id,modified,bytes,favorite FROM photos {filter} ORDER BY {order} LIMIT 200 OFFSET ?4");
        let mut stmt = db.prepare(&sql).map_err(err)?;
        let rows = stmt
            .query_map(
                params![source, search, fav, query.offset.unwrap_or(0).max(0)],
                |r| {
                    Ok(Photo {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        path: r.get(2)?,
                        source_id: r.get(3)?,
                        modified: r.get(4)?,
                        bytes: r.get(5)?,
                        favorite: r.get(6)?,
                    })
                },
            )
            .map_err(err)?;
        Ok(Page {
            items: rows
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?,
            total,
        })
    }
    pub fn photo_path(&self, id: &str) -> Result<PathBuf> {
        let path: String = self
            .db
            .lock()
            .map_err(err)?
            .query_row("SELECT path FROM photos WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| "照片已不在图库中".to_string())?;
        let path = PathBuf::from(path)
            .canonicalize()
            .map_err(|_| "文件不可用，可能已移动或磁盘未连接".to_string())?;
        let db = self.db.lock().map_err(err)?;
        let mut stmt = db.prepare("SELECT path FROM sources").map_err(err)?;
        let roots = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        if !roots.iter().any(|root| path.starts_with(root)) {
            return Err("照片不在已授权的图库文件夹内".into());
        }
        Ok(path)
    }
    pub fn favorite(&self, id: &str, value: bool) -> Result<()> {
        self.db
            .lock()
            .map_err(err)?
            .execute(
                "UPDATE photos SET favorite=?1 WHERE id=?2",
                params![value, id],
            )
            .map_err(err)?;
        Ok(())
    }
    pub fn thumbnail(&self, id: &str) -> Result<String> {
        let path = self.photo_path(id)?;
        let meta = fs::metadata(&path).map_err(err)?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
            .map(|v| v.as_nanos())
            .unwrap_or(0);
        let key = format!(
            "{:x}",
            Sha256::digest(format!("{id}-{modified}-{}", meta.len()).as_bytes())
        );
        let cache = self.cache.join(format!("{key}.jpg"));
        let bytes = if cache.exists() {
            fs::read(&cache).map_err(err)?
        } else {
            let img = load_image(&path)?.thumbnail(440, 440).to_rgb8();
            let mut buf = Cursor::new(Vec::new());
            DynamicImage::ImageRgb8(img)
                .write_to(&mut buf, ImageFormat::Jpeg)
                .map_err(err)?;
            let bytes = buf.into_inner();
            let mut tmp = tempfile::NamedTempFile::new_in(&self.cache).map_err(err)?;
            std::io::Write::write_all(&mut tmp, &bytes).map_err(err)?;
            let _ = tmp.persist(&cache);
            bytes
        };
        Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
    }
    pub fn preview(&self, id: &str) -> Result<String> {
        let img = load_image(&self.photo_path(id)?)?;
        let img = if img.width() > 4096 || img.height() > 4096 {
            img.resize(4096, 4096, image::imageops::FilterType::Triangle)
        } else {
            img
        };
        let rgb = img.to_rgb8();
        let mut buf = Cursor::new(Vec::new());
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90)
            .encode_image(&rgb)
            .map_err(err)?;
        Ok(format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(buf.into_inner())
        ))
    }
    pub fn details(&self, id: &str) -> Result<Details> {
        let path = self.photo_path(id)?;
        let (width, height) = image::image_dimensions(&path).map_err(err)?;
        let mut metadata = Vec::new();
        if let Ok(file) = fs::File::open(&path) {
            if let Ok(exif) = exif::Reader::new().read_from_container(&mut BufReader::new(file)) {
                for f in exif.fields() {
                    if matches!(
                        f.tag,
                        exif::Tag::Make
                            | exif::Tag::Model
                            | exif::Tag::DateTimeOriginal
                            | exif::Tag::ExposureTime
                            | exif::Tag::FNumber
                            | exif::Tag::PhotographicSensitivity
                            | exif::Tag::FocalLength
                            | exif::Tag::LensModel
                    ) {
                        metadata.push((
                            f.tag.to_string(),
                            f.display_value().with_unit(&exif).to_string(),
                        ))
                    }
                }
            }
        }
        Ok(Details {
            width,
            height,
            format: path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_uppercase(),
            metadata,
        })
    }
    pub fn delete(&self, ids: &[String]) -> Result<usize> {
        if ids.len() > 1000 {
            return Err("一次最多移动 1,000 张照片到回收站".into());
        }
        let mut count = 0;
        let mut seen = HashSet::new();
        for id in ids {
            if !seen.insert(id) {
                continue;
            }
            let path = self.photo_path(id)?;
            trash::delete(&path).map_err(|e| {
                format!("已处理 {count} 张，{} 移至回收站失败：{e}", path.display())
            })?;
            self.db
                .lock()
                .map_err(err)?
                .execute("DELETE FROM photos WHERE id=?1", [id])
                .map_err(err)?;
            count += 1;
        }
        Ok(count)
    }
}

pub fn load_image(path: &Path) -> Result<DynamicImage> {
    let reader = ImageReader::open(path)
        .map_err(err)?
        .with_guessed_format()
        .map_err(err)?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("此图片无法解码：{e}"))?;
    let orientation = decoder.orientation().map_err(err)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(err)?;
    image.apply_orientation(orientation);
    Ok(image)
}
pub fn save_copy(source: &Path, dest: &Path, edit: &Edit) -> Result<()> {
    if dest.canonicalize().ok().as_deref() == Some(source) {
        return Err("请选择新的文件名，原图将保留".into());
    }
    let format = ImageFormat::from_path(dest).map_err(|_| "请选择 PNG、JPEG 或 WebP 扩展名")?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err("导出仅支持 PNG、JPEG、WebP".into());
    }
    let mut image = apply_edit(load_image(source)?, edit)?;
    if format == ImageFormat::Jpeg {
        image = DynamicImage::ImageRgb8(image.to_rgb8())
    }
    let mut file =
        tempfile::NamedTempFile::new_in(dest.parent().ok_or("保存目录无效")?).map_err(err)?;
    image.write_to(&mut file, format).map_err(err)?;
    file.persist(dest).map_err(err)?;
    Ok(())
}
pub fn apply_edit(mut img: DynamicImage, edit: &Edit) -> Result<DynamicImage> {
    if !edit.brightness.is_finite() || !edit.contrast.is_finite() || !edit.saturation.is_finite() {
        return Err("调整参数无效".into());
    }
    if let Some(c) = edit.crop {
        if ![c.x, c.y, c.width, c.height].iter().all(|v| v.is_finite())
            || c.x < 0.
            || c.y < 0.
            || c.width <= 0.
            || c.height <= 0.
            || c.x + c.width > 1.00001
            || c.y + c.height > 1.00001
        {
            return Err("裁剪范围无效".into());
        }
        let x = (c.x * img.width() as f32).floor() as u32;
        let y = (c.y * img.height() as f32).floor() as u32;
        let w = ((c.width * img.width() as f32).round() as u32)
            .max(1)
            .min(img.width() - x.min(img.width() - 1));
        let h = ((c.height * img.height() as f32).round() as u32)
            .max(1)
            .min(img.height() - y.min(img.height() - 1));
        img = img.crop_imm(x.min(img.width() - 1), y.min(img.height() - 1), w, h);
    }
    img = match edit.rotation.rem_euclid(360) {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        0 => img,
        _ => return Err("旋转角度必须为90度的倍数".into()),
    };
    if edit.flip {
        img = img.fliph()
    }
    let brightness = edit.brightness.clamp(-100., 100.) * 2.55;
    let contrast = 1. + edit.contrast.clamp(-100., 100.) / 100.;
    let saturation = 1. + edit.saturation.clamp(-100., 100.) / 100.;
    let mut rgba = img.to_rgba8();
    for p in rgba.pixels_mut() {
        let mut r = (p[0] as f32 - 128.) * contrast + 128. + brightness;
        let mut g = (p[1] as f32 - 128.) * contrast + 128. + brightness;
        let mut b = (p[2] as f32 - 128.) * contrast + 128. + brightness;
        let gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = gray + (r - gray) * saturation;
        g = gray + (g - gray) * saturation;
        b = gray + (b - gray) * saturation;
        if edit.filter == "mono" {
            let v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = v;
            g = v;
            b = v
        } else if edit.filter == "sepia" {
            let (nr, ng, nb) = (
                0.393 * r + 0.769 * g + 0.189 * b,
                0.349 * r + 0.686 * g + 0.168 * b,
                0.272 * r + 0.534 * g + 0.131 * b,
            );
            r = nr;
            g = ng;
            b = nb
        }
        *p = Rgba([
            r.round().clamp(0., 255.) as u8,
            g.round().clamp(0., 255.) as u8,
            b.round().clamp(0., 255.) as u8,
            p[3],
        ]);
    }
    Ok(DynamicImage::ImageRgba8(rgba))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_persists_favorites_and_removes_missing_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("photos");
        fs::create_dir(&root).unwrap();
        let file = root.join("a.png");
        DynamicImage::new_rgb8(20, 10).save(&file).unwrap();
        let db = temp.path().join("db");
        let cache = temp.path().join("cache");
        let lib = Library::open(&db, &cache).unwrap();
        lib.add_source(&root).unwrap();
        lib.scan().unwrap();
        let p = lib.list(Query::default()).unwrap().items.remove(0);
        lib.favorite(&p.id, true).unwrap();
        drop(lib);
        let lib = Library::open(&db, &cache).unwrap();
        assert_eq!(
            lib.list(Query {
                favorites: Some(true),
                ..Default::default()
            })
            .unwrap()
            .total,
            1
        );
        fs::remove_file(file).unwrap();
        lib.scan().unwrap();
        assert_eq!(lib.list(Query::default()).unwrap().total, 0);
    }
    #[test]
    fn edits_crop_then_rotate_and_preserve_alpha() {
        let mut img = DynamicImage::new_rgba8(20, 10).to_rgba8();
        for p in img.pixels_mut() {
            *p = Rgba([100, 50, 25, 180])
        }
        let edited = apply_edit(
            DynamicImage::ImageRgba8(img),
            &Edit {
                rotation: 90,
                crop: Some(Crop {
                    x: 0.,
                    y: 0.,
                    width: 0.5,
                    height: 1.,
                }),
                brightness: 20.,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!((edited.width(), edited.height()), (10, 10));
        assert_eq!(edited.to_rgba8().get_pixel(0, 0)[3], 180);
        assert!(apply_edit(
            edited,
            &Edit {
                crop: Some(Crop {
                    x: 1.,
                    y: 0.,
                    width: 0.5,
                    height: 1.
                }),
                ..Default::default()
            }
        )
        .is_err());
    }
    #[test]
    fn overlapping_sources_keep_favorites() {
        let t = tempfile::tempdir().unwrap();
        let parent = t.path().join("pics");
        let child = parent.join("child");
        fs::create_dir_all(&child).unwrap();
        DynamicImage::new_rgb8(1, 1)
            .save(child.join("p.png"))
            .unwrap();
        let lib = Library::open(&t.path().join("db"), &t.path().join("cache")).unwrap();
        lib.add_source(&child).unwrap();
        lib.scan().unwrap();
        let id = lib.list(Query::default()).unwrap().items[0].id.clone();
        lib.favorite(&id, true).unwrap();
        lib.add_source(&parent).unwrap();
        lib.scan().unwrap();
        assert_eq!(lib.sources().unwrap().len(), 1);
        assert_eq!(
            lib.list(Query {
                favorites: Some(true),
                ..Default::default()
            })
            .unwrap()
            .total,
            1
        );
    }
    #[test]
    fn export_is_a_real_file_and_never_overwrites_original() {
        let t = tempfile::tempdir().unwrap();
        let source = t.path().join("original.png");
        DynamicImage::new_rgb8(40, 20).save(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let dest = t.path().join("copy.png");
        save_copy(
            &source.canonicalize().unwrap(),
            &dest,
            &Edit {
                rotation: 90,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(image::image_dimensions(&dest).unwrap(), (20, 40));
        assert_eq!(fs::read(&source).unwrap(), original);
        assert!(save_copy(&source.canonicalize().unwrap(), &source, &Edit::default()).is_err());
    }
}
