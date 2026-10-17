import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  Heart,
  Image as ImageIcon,
  Images,
  Info,
  LayoutGrid,
  Layers,
  LoaderCircle,
  Maximize,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  call,
  desktop,
  peekPreview,
  preloadPreview,
  previewUrl,
  thumbnail,
} from "./api";
import { bytes, date, Details, Page, Photo, Prefs, Source } from "./model";
import Editor from "./Editor";
import SlideshowStage from "./SlideshowStage";
import SlideshowMusic from "./SlideshowMusic";

const displayPath = (path: string) =>
  path.startsWith(String.fromCharCode(92, 92, 63, 92)) ? path.slice(4) : path;

function Thumbnail({ photo, fit }: { photo: Photo; fit: string }) {
  const [url, setUrl] = useState(""),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl("");
    setFailed(false);
    thumbnail(photo.id, photo.modified)
      .then((s) => {
        if (alive) setUrl(s);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [photo.id, photo.modified]);
  return url ? (
    <img
      draggable={false}
      src={url}
      alt={photo.name}
      style={{ objectFit: fit as "cover" | "contain" }}
    />
  ) : (
    <div className="thumb-placeholder">
      <ImageIcon size={26} />
      {failed && <span>无法预览</span>}
    </div>
  );
}

function Grid({
  photos,
  total,
  selected,
  selectMode,
  size,
  fit,
  onSelect,
  onOpen,
  loadMore,
  loading,
}: {
  photos: Photo[];
  total: number;
  selected: Set<string>;
  selectMode: boolean;
  size: number;
  fit: string;
  onSelect: (p: Photo, shift: boolean) => void;
  onOpen: (p: Photo) => void;
  loadMore: () => void;
  loading: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    width: 900,
    height: 600,
    scroll: 0,
  });
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() =>
      setViewport((v) => ({
        ...v,
        width: el.clientWidth,
        height: el.clientHeight,
      })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor((viewport.width - 48) / (size + 12))),
    cell = (viewport.width - 48 - (columns - 1) * 12) / columns,
    row = cell + 46,
    rows = Math.ceil(photos.length / columns),
    startRow = Math.max(0, Math.floor(viewport.scroll / row) - 2),
    endRow = Math.min(
      rows,
      Math.ceil((viewport.scroll + viewport.height) / row) + 3,
    );
  useEffect(() => {
    if (!loading && photos.length < total && endRow >= rows - 2) loadMore();
  }, [endRow, rows, loading, total, photos.length, loadMore]);
  return (
    <div
      ref={ref}
      className="gallery-scroll"
      data-testid="gallery-scroll"
      onScroll={(e) =>
        setViewport((v) => ({ ...v, scroll: e.currentTarget.scrollTop }))
      }
    >
      <div className="virtual-grid" style={{ height: rows * row + 32 }}>
        {photos.slice(startRow * columns, endRow * columns).map((p, i) => {
          const index = startRow * columns + i;
          return (
            <article
              key={p.id}
              className={`photo-card ${selected.has(p.id) ? "selected" : ""}`}
              style={{
                position: "absolute",
                width: cell,
                height: row - 12,
                top: Math.floor(index / columns) * row + 8,
                left: 24 + (index % columns) * (cell + 12),
              }}
              onClick={(e) =>
                selectMode || e.ctrlKey || e.shiftKey
                  ? onSelect(p, e.shiftKey)
                  : onOpen(p)
              }
              onDoubleClick={() => onOpen(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(p);
                if (e.key === " ") {
                  e.preventDefault();
                  onSelect(p, e.shiftKey);
                }
              }}
              tabIndex={0}
              aria-label={p.name}
            >
              <div className="photo-square" style={{ height: cell }}>
                <Thumbnail photo={p} fit={fit} />
                <button
                  className={`check-photo ${selected.has(p.id) ? "checked" : ""}`}
                  aria-label={`选择 ${p.name}`}
                  aria-pressed={selected.has(p.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(p, e.shiftKey);
                  }}
                >
                  {selected.has(p.id) && <Check size={13} />}
                </button>
                {p.favorite && (
                  <Heart
                    className="favorite-badge"
                    size={16}
                    fill="currentColor"
                  />
                )}
              </div>
              <div className="photo-caption">
                <span className="ellipsis">{p.name}</span>
              </div>
            </article>
          );
        })}
      </div>
      {loading && (
        <div className="loading-row">
          <LoaderCircle className="spin" size={18} />
          正在加载照片…
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [sources, setSources] = useState<Source[]>([]),
    [photos, setPhotos] = useState<Photo[]>([]),
    [total, setTotal] = useState(0),
    [section, setSection] = useState("all"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [selectMode, setSelectMode] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [deleting, setDeleting] = useState<string[] | null>(null);
  const [view, setView] = useState<Photo | null>(null),
    [preview, setPreview] = useState(""),
    [previewError, setPreviewError] = useState(""),
    [info, setInfo] = useState(false),
    [details, setDetails] = useState<Details | null>(null),
    [editor, setEditor] = useState(false),
    [zoom, setZoom] = useState(1),
    [rotation, setRotation] = useState(0),
    [playing, setPlaying] = useState(false),
    [slideshow, setSlideshow] = useState(false),
    [chromeVisible, setChromeVisible] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      return {
        ...{
          theme: "dark",
          size: 190,
          fit: "cover",
          animations: true,
          transitions: true,
          loop: true,
        },
        ...JSON.parse(localStorage.getItem("photos-preferences") ?? "{}"),
      };
    } catch {
      return {
        theme: "dark",
        size: 190,
        fit: "cover",
        animations: true,
        transitions: true,
        loop: true,
      };
    }
  });
  const [restartToken, setRestartToken] = useState(0);
  const [slideReady, setSlideReady] = useState(0);
  const [readyPreview, setReadyPreview] = useState("");
  const markSlideReady = useCallback(() => {
    setReadyPreview(preview);
    setSlideReady((n) => n + 1);
  }, [preview]);
  const remainingSlideMs = useRef(4000);
  const slideshowStartId = useRef<string | null>(null);
  const generation = useRef(0),
    loadingRef = useRef(false),
    photosRef = useRef(photos),
    lastSelected = useRef<number | null>(null),
    moreRef = useRef<() => Promise<Photo[]>>(() => Promise.resolve([])),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  photosRef.current = photos;
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  const folder = sources.find((s) => s.id === section),
    title =
      section === "favorites"
        ? "收藏夹"
        : section === "folders"
          ? "文件夹"
          : section === "settings"
            ? "设置"
            : (folder?.name ?? "所有照片");
  const queryArgs = useCallback(
    (offset: number) => ({
      source: folder?.id ?? null,
      search: query,
      favorites: section === "favorites",
      sort,
      offset,
    }),
    [folder?.id, query, section, sort],
  );
  const reload = useCallback(async () => {
    const token = ++generation.current;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const [page, list] = await Promise.all([
        call<Page>("list_photos", { query: queryArgs(0) }),
        call<Source[]>("get_sources"),
      ]);
      if (token === generation.current) {
        setPhotos(page.items);
        setTotal(page.total);
        setSources(list);
      }
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [queryArgs]);
  const loadMore = useCallback(async () => {
    if (loadingRef.current || photosRef.current.length >= total) return [];
    const token = generation.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await call<Page>("list_photos", {
        query: queryArgs(photosRef.current.length),
      });
      if (token === generation.current) {
        setPhotos((p) => [...p, ...page.items]);
        return page.items;
      }
      return [];
    } catch (e) {
      notify(String(e));
      return [];
    } finally {
      if (token === generation.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [total, queryArgs, notify]);
  moreRef.current = loadMore;
  const refresh = useCallback(async () => {
    if (!desktop) return;
    setBusy("正在更新图库…");
    try {
      const result = await call<{ count: number; skipped: number }>(
        "refresh_library",
      );
      await reload();
      if (result.skipped) notify(`图库已更新，${result.skipped} 项暂时不可用`);
    } catch (e) {
      if (!String(e).includes("正在扫描")) notify(String(e));
    } finally {
      setBusy("");
    }
  }, [reload, notify]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (desktop) void reload();
  }, [reload]);
  useEffect(() => {
    if (!desktop) return;
    let timer: ReturnType<typeof setTimeout>;
    let stop: (() => void) | undefined;
    let disposed = false;
    listen("library-changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 900);
    }).then((f) => {
      if (disposed) f();
      else stop = f;
    });
    return () => {
      disposed = true;
      stop?.();
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem("photos-preferences", JSON.stringify(prefs));
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        prefs.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : prefs.theme;
      document.documentElement.dataset.theme = theme;
      if (desktop)
        getCurrentWindow()
          .setTheme(theme as "dark" | "light")
          .catch(() => {});
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [prefs]);
  useEffect(() => {
    setSelected(new Set());
    setSelectMode(false);
    lastSelected.current = null;
  }, [section, sort, query]);
  useEffect(() => {
    setPreviewError("");
    setDetails(null);
    setZoom(1);
    setRotation(0);
    if (!view) return;
    let alive = true;
    setPreview(peekPreview(view.id, view.modified) ?? "");
    previewUrl(view.id, view.modified)
      .then((url) => {
        if (alive) setPreview(url);
      })
      .catch((e) => {
        if (alive) setPreviewError(String(e));
      });
    call<Details>("get_details", { id: view.id })
      .then((d) => {
        if (alive) setDetails(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view?.id]);
  useEffect(() => {
    if (!view || !desktop) return;
    const index = photosRef.current.findIndex((p) => p.id === view.id);
    if (index < 0) return;
    for (const i of [index - 1, index + 1, index + 2]) {
      if (i >= 0 && i < photosRef.current.length) {
        const p = photosRef.current[i];
        preloadPreview(p.id, p.modified);
      }
    }
  }, [view?.id]);
  const navigate = useCallback(
    async (delta: number) => {
      if (!view) return;
      const index = photosRef.current.findIndex((p) => p.id === view.id);
      if (index < 0) return;
      if (index + delta >= photosRef.current.length) {
        const next = await moreRef.current();
        if (next[0]) setView(next[0]);
      } else if (index + delta >= 0) setView(photosRef.current[index + delta]);
    },
    [view],
  );
  const poke = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(function hide() {
      const toolbar = document.querySelector(".slideshow-toolbar");
      if (
        toolbar?.contains(document.activeElement) ||
        toolbar?.querySelector("details[open], .slideshow-music-panel")
      ) {
        hideTimer.current = setTimeout(hide, 2600);
      } else setChromeVisible(false);
    }, 2600);
  }, []);
  const exitSlideshow = useCallback(() => {
    setSlideshow(false);
    setPlaying(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  const restartSlideshow = useCallback(() => {
    const start =
      photosRef.current.find((p) => p.id === slideshowStartId.current) ??
      photosRef.current[0];
    if (start) setView(start);
    setRestartToken((n) => n + 1);
    setPlaying(true);
  }, []);
  const togglePref = useCallback(
    (k: "animations" | "transitions" | "loop") =>
      setPrefs((p) => ({ ...p, [k]: !p[k] })),
    [],
  );
  useEffect(() => {
    if (slideshow) poke();
  }, [slideshow, poke]);
  useEffect(() => {
    remainingSlideMs.current = 4000;
  }, [slideReady, restartToken]);
  useEffect(() => {
    if (
      !slideshow ||
      !playing ||
      !view ||
      editor ||
      !preview ||
      readyPreview !== preview ||
      !slideReady
    )
      return;
    const started = performance.now();
    const timer = setTimeout(() => {
      remainingSlideMs.current = 4000;
      const index = photosRef.current.findIndex((p) => p.id === view.id);
      if (
        index === photosRef.current.length - 1 &&
        photosRef.current.length >= total
      ) {
        if (prefs.loop && photosRef.current.length > 1)
          setView(photosRef.current[0]);
        else if (!prefs.loop) setPlaying(false);
        else setRestartToken((n) => n + 1);
      } else void navigate(1);
    }, remainingSlideMs.current);
    return () => {
      clearTimeout(timer);
      remainingSlideMs.current = Math.max(
        0,
        remainingSlideMs.current - (performance.now() - started),
      );
    };
  }, [
    slideshow,
    playing,
    view,
    editor,
    navigate,
    total,
    prefs.loop,
    preview,
    readyPreview,
    slideReady,
    restartToken,
  ]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editor) return;
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(
        (e.target as HTMLElement).tagName,
      );
      if (e.key === "Escape") {
        if (slideshow) {
          exitSlideshow();
        } else {
          setView(null);
          setPlaying(false);
          setSelected(new Set());
          setSelectMode(false);
        }
      }
      if (view && !typing) {
        if (e.key === "ArrowRight") void navigate(1);
        if (e.key === "ArrowLeft") void navigate(-1);
        if (
          e.key === " " &&
          !(e.target as HTMLElement).closest("button, summary")
        ) {
          e.preventDefault();
          if (slideshow) {
            setPlaying((p) => !p);
          } else {
            slideshowStartId.current = view?.id ?? null;
            setSlideshow(true);
            setPlaying(true);
          }
        }
        if (e.key.toLowerCase() === "e" && preview && !slideshow)
          setEditor(true);
      }
      if (!view && !typing && e.key === "Delete" && selected.size)
        setDeleting([...selected]);
      if (!view && !typing && (e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelectMode(true);
        setSelected(new Set(photos.map((p) => p.id)));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    view,
    editor,
    navigate,
    selected,
    photos,
    preview,
    slideshow,
    exitSlideshow,
  ]);
  async function action(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy("");
    }
  }
  async function addFolder() {
    await action("正在添加文件夹…", async () => {
      if (await call<boolean>("add_source")) {
        await reload();
        notify("照片文件夹已添加");
      }
    });
  }
  async function importFiles() {
    await action("正在导入…", async () => {
      const result = await call<{ count: number; cancelled: boolean }>(
        "import_files",
      );
      if (!result.cancelled) {
        await reload();
        notify(`已导入 ${result.count} 张照片`);
      }
    });
  }
  function select(photo: Photo, shift: boolean) {
    setSelectMode(true);
    const index = photos.findIndex((p) => p.id === photo.id);
    setSelected((old) => {
      const next = new Set(old);
      if (shift && lastSelected.current !== null) {
        photos
          .slice(
            Math.min(index, lastSelected.current),
            Math.max(index, lastSelected.current) + 1,
          )
          .forEach((p) => next.add(p.id));
      } else {
        next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id);
      }
      return next;
    });
    lastSelected.current = index;
  }
  async function favorite(photo: Photo) {
    try {
      await call("set_favorite", { id: photo.id, value: !photo.favorite });
      const updated = { ...photo, favorite: !photo.favorite };
      setPhotos((items) =>
        section === "favorites" && !updated.favorite
          ? items.filter((p) => p.id !== photo.id)
          : items.map((p) => (p.id === photo.id ? updated : p)),
      );
      if (section === "favorites" && !updated.favorite)
        setTotal((t) => Math.max(0, t - 1));
      if (view?.id === photo.id) setView(updated);
      notify(updated.favorite ? "已添加到收藏夹" : "已取消收藏");
    } catch (e) {
      notify(String(e));
    }
  }
  async function deleteConfirmed() {
    const ids = deleting ?? [];
    setDeleting(null);
    await action("正在移至回收站…", async () => {
      const count = await call<number>("delete_photos", { ids });
      if (view && ids.includes(view.id)) {
        setView(null);
        setPlaying(false);
      }
      await reload();
      notify(`已将 ${count} 张照片移至回收站`);
    });
  }
  const allCount = sources.reduce((sum, s) => sum + s.count, 0),
    index = view ? photos.findIndex((p) => p.id === view.id) : -1;
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <ImageIcon size={22} />
          </span>
          <strong>照片</strong>
        </div>
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="搜索照片"
            placeholder="搜索照片名称"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (section === "settings" || section === "folders")
                setSection("all");
            }}
          />
          {search && (
            <button aria-label="清除搜索" onClick={() => setSearch("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <button
          className="secondary import-button"
          disabled={!!busy || !desktop}
          onClick={importFiles}
        >
          <Upload size={17} />
          导入
        </button>
        <button
          className="icon-button"
          title="设置"
          aria-label="设置"
          onClick={() => setSection("settings")}
        >
          <Settings size={20} />
        </button>
      </header>
      <div className="app-body">
        {sidebar && (
          <aside className="sidebar">
            <button
              className={`nav-item ${section === "all" ? "active" : ""}`}
              onClick={() => setSection("all")}
            >
              <Images size={20} />
              <span>所有照片</span>
              <span className="nav-count">{allCount || ""}</span>
            </button>
            <button
              className={`nav-item ${section === "favorites" ? "active" : ""}`}
              onClick={() => setSection("favorites")}
            >
              <Heart size={20} />
              <span>收藏夹</span>
            </button>
            <button
              className={`nav-item ${section === "folders" ? "active" : ""}`}
              onClick={() => setSection("folders")}
            >
              <Folder size={20} />
              <span>文件夹</span>
            </button>
            <div className="nav-section">
              <span>你的文件夹</span>
              <button
                aria-label="添加文件夹"
                disabled={!!busy || !desktop}
                onClick={addFolder}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="source-nav">
              {sources.map((s) => (
                <button
                  key={s.id}
                  className={`nav-item folder-nav ${section === s.id ? "active" : ""}`}
                  title={displayPath(s.path)}
                  onClick={() => setSection(s.id)}
                >
                  <Folder size={18} />
                  <span className="ellipsis">{s.name}</span>
                  <span className="nav-count">{s.count}</span>
                </button>
              ))}
              {!sources.length && (
                <p className="sidebar-hint">
                  添加文件夹，让精彩瞬间
                  <br />
                  在这里相聚。
                </p>
              )}
            </div>
            <div className="sidebar-bottom">
              <div className="local-dot" />
              <span>照片保存在本机</span>
            </div>
          </aside>
        )}
        <main className="main">
          <div className="page-toolbar">
            <button
              className="icon-button"
              aria-label={sidebar ? "收起导航" : "展开导航"}
              onClick={() => setSidebar(!sidebar)}
            >
              {sidebar ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </button>
            <div className="page-title">
              <h1>{title}</h1>
              {section !== "settings" && section !== "folders" && (
                <span className="muted">
                  {query ? `“${query}” · ` : ""}
                  {total.toLocaleString()} 张照片
                </span>
              )}
            </div>
            <div className="toolbar-actions">
              {section !== "settings" && (
                <>
                  <button
                    className="icon-button"
                    title="刷新图库"
                    aria-label="刷新图库"
                    disabled={!!busy || !desktop}
                    onClick={refresh}
                  >
                    <RefreshCw size={18} className={busy ? "spin" : ""} />
                  </button>
                  <button
                    className="secondary"
                    disabled={!!busy || !desktop}
                    onClick={addFolder}
                  >
                    <Plus size={17} />
                    添加文件夹
                  </button>
                </>
              )}
              {section !== "settings" && section !== "folders" && (
                <>
                  <label className="sort-box">
                    <ArrowDownWideNarrow size={17} />
                    <select
                      aria-label="排序"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="newest">修改日期：从新到旧</option>
                      <option value="oldest">修改日期：从旧到新</option>
                      <option value="name">名称</option>
                    </select>
                  </label>
                  <button
                    className={`icon-button ${selectMode ? "active" : ""}`}
                    aria-label="选择照片"
                    title="选择照片"
                    onClick={() => {
                      setSelectMode(!selectMode);
                      setSelected(new Set());
                    }}
                  >
                    <Check size={19} />
                  </button>
                </>
              )}
            </div>
          </div>
          {!!selected.size && (
            <div className="selection-bar">
              <span>已选择 {selected.size} 张</span>
              <button
                onClick={() =>
                  void action("正在收藏…", async () => {
                    for (const id of selected)
                      await call("set_favorite", { id, value: true });
                    await reload();
                    notify("已添加到收藏夹");
                  })
                }
              >
                <Heart size={16} />
                收藏
              </button>
              <button onClick={() => setDeleting([...selected])}>
                <Trash2 size={16} />
                移至回收站
              </button>
              <button
                className="cancel-select"
                onClick={() => {
                  setSelected(new Set());
                  setSelectMode(false);
                }}
              >
                取消
              </button>
            </div>
          )}
          {section === "settings" ? (
            <div className="settings-page">
              <h2>个性化</h2>
              <section className="setting-card">
                <div>
                  <strong>应用主题</strong>
                  <p>选择让你看得更舒服的外观。</p>
                </div>
                <select
                  aria-label="应用主题"
                  value={prefs.theme}
                  onChange={(e) =>
                    setPrefs({ ...prefs, theme: e.target.value })
                  }
                >
                  <option value="dark">深色</option>
                  <option value="light">浅色</option>
                  <option value="system">跟随系统</option>
                </select>
              </section>
              <section className="setting-card">
                <div>
                  <strong>缩略图大小</strong>
                  <p>调整图库中的照片密度。</p>
                </div>
                <input
                  aria-label="缩略图大小"
                  type="range"
                  min="130"
                  max="300"
                  value={prefs.size}
                  onChange={(e) =>
                    setPrefs({ ...prefs, size: Number(e.target.value) })
                  }
                />
              </section>
              <section className="setting-card">
                <div>
                  <strong>照片填充方式</strong>
                  <p>填充方格，或显示完整照片。</p>
                </div>
                <select
                  aria-label="照片填充方式"
                  value={prefs.fit}
                  onChange={(e) => setPrefs({ ...prefs, fit: e.target.value })}
                >
                  <option value="cover">填充</option>
                  <option value="contain">完整显示</option>
                </select>
              </section>
              <h2>图库来源</h2>
              <p className="muted">
                添加本地文件夹，也可选择 OneDrive 等已同步到本机的文件夹。
              </p>
              {sources.map((s) => (
                <section className="setting-card" key={s.id}>
                  <Folder size={20} />
                  <div className="grow">
                    <strong>{s.name}</strong>
                    <p className="path">{displayPath(s.path)}</p>
                  </div>
                  <button
                    onClick={() =>
                      void action("正在移除来源…", async () => {
                        await call("remove_source", { id: s.id });
                        await reload();
                        notify("已移除图库来源，原始文件保留");
                      })
                    }
                  >
                    移除
                  </button>
                </section>
              ))}
              <button
                className="secondary"
                onClick={addFolder}
                disabled={!desktop || !!busy}
              >
                <Plus size={16} />
                添加文件夹
              </button>
              <section className="about-card">
                <span className="brand-icon large">
                  <ImageIcon size={32} />
                </span>
                <h2>照片</h2>
                <p>把每一个值得记住的瞬间，留在身边。</p>
                <span className="muted small">版本 0.1.0 · 本地照片图库</span>
              </section>
            </div>
          ) : section === "folders" ? (
            <div className="folders-page">
              <p className="muted">在熟悉的文件夹里，找到你的照片。</p>
              <div className="folder-grid">
                {sources.map((s) => (
                  <button
                    className="folder-card"
                    key={s.id}
                    onClick={() => setSection(s.id)}
                  >
                    <FolderOpen size={46} strokeWidth={1.3} />
                    <strong>{s.name}</strong>
                    <span>{s.count} 张照片</span>
                    <small className="ellipsis">{displayPath(s.path)}</small>
                  </button>
                ))}
                <button
                  className="folder-card add-folder-card"
                  onClick={addFolder}
                  disabled={!desktop || !!busy}
                >
                  <Plus size={32} />
                  <strong>添加文件夹</strong>
                  <span>把照片带到这里</span>
                </button>
              </div>
            </div>
          ) : error ? (
            <div className="empty">
              <ImageIcon size={42} />
              <h2>暂时无法打开图库</h2>
              <p>{error}</p>
              <button className="secondary" onClick={reload}>
                重试
              </button>
            </div>
          ) : !desktop ? (
            <div className="empty">
              <Images size={52} />
              <h2>在桌面上，遇见你的照片</h2>
              <p>这是界面预览。请启动桌面应用，添加本机照片文件夹。</p>
              <code>npm run tauri dev</code>
            </div>
          ) : !photos.length && !loading ? (
            <div className="empty">
              <div className="empty-art">
                <ImageIcon size={54} strokeWidth={1} />
                <span className="art-card" />
              </div>
              <h2>
                {section === "favorites"
                  ? "把喜欢的瞬间，收藏起来"
                  : query
                    ? "没有找到匹配的照片"
                    : sources.length
                      ? "这里还没有照片"
                      : "让美好的瞬间，在这里相聚"}
              </h2>
              <p>
                {section === "favorites"
                  ? "打开照片，点击爱心，下次就能在这里找到。"
                  : query
                    ? "试试其他文件名，或清除搜索条件。"
                    : sources.length
                      ? "此文件夹中暂未找到支持的照片。你也可以添加另一个文件夹。"
                      : "添加照片文件夹，浏览、收藏和编辑你的照片。"}
              </p>
              {section !== "favorites" && !query && (
                <button
                  className="primary"
                  onClick={addFolder}
                  disabled={!!busy}
                >
                  <Plus size={18} />
                  添加照片文件夹
                </button>
              )}
              <span className="muted small">
                {!query && section !== "favorites"
                  ? "支持 JPEG、PNG、WebP、GIF、BMP、TIFF 和 ICO"
                  : ""}
              </span>
            </div>
          ) : (
            <Grid
              key={`${section}:${query}:${sort}`}
              photos={photos}
              total={total}
              selected={selected}
              selectMode={selectMode}
              size={prefs.size}
              fit={prefs.fit}
              onSelect={select}
              onOpen={(p) => {
                setView(p);
                setPlaying(false);
              }}
              loadMore={() => void loadMore()}
              loading={loading}
            />
          )}
          <footer className="status-bar">
            <span>
              {busy ? (
                <>
                  <LoaderCircle size={12} className="spin" />
                  {busy}
                </>
              ) : loading ? (
                "正在加载…"
              ) : section === "settings" ? (
                "偏好设置自动保存"
              ) : (
                `${allCount.toLocaleString()} 张照片 · ${sources.length} 个文件夹`
              )}
            </span>
            <div>
              <ImageIcon size={13} />
              <input
                aria-label="图库缩略图大小"
                type="range"
                min="130"
                max="300"
                value={prefs.size}
                onChange={(e) =>
                  setPrefs({ ...prefs, size: Number(e.target.value) })
                }
              />
              <Images size={16} />
            </div>
          </footer>
        </main>
      </div>
      {view && (
        <div
          className="viewer modal-full"
          role="dialog"
          aria-label="照片查看器"
        >
          <header className="viewer-header">
            <button
              className="icon-button"
              aria-label="返回图库"
              onClick={() => {
                setView(null);
                setPlaying(false);
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <span className="viewer-name ellipsis">{view.name}</span>
            <div className="viewer-tools">
              <button
                className="secondary"
                disabled={!preview}
                onClick={() => {
                  setPlaying(false);
                  setEditor(true);
                }}
              >
                <Pencil size={16} />
                编辑照片
              </button>
              <span className="tool-separator" />
              <button
                className={`icon-button ${view.favorite ? "favorited" : ""}`}
                aria-label={view.favorite ? "取消收藏" : "收藏照片"}
                onClick={() => void favorite(view)}
              >
                <Heart
                  size={19}
                  fill={view.favorite ? "currentColor" : "none"}
                />
              </button>
              <button
                className="icon-button"
                aria-label="旋转视图"
                onClick={() => setRotation((r) => (r + 90) % 360)}
              >
                <RotateCw size={19} />
              </button>
              <button
                className={`icon-button ${info ? "active" : ""}`}
                aria-label="照片信息"
                onClick={() => setInfo(!info)}
              >
                <Info size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="在文件夹中显示"
                onClick={() =>
                  call("show_in_folder", { id: view.id }).catch((e) =>
                    notify(String(e)),
                  )
                }
              >
                <FolderOpen size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="删除照片"
                onClick={() => setDeleting([view.id])}
              >
                <Trash2 size={19} />
              </button>
            </div>
          </header>
          <div className="viewer-body">
            <div
              className="viewer-stage"
              onWheel={(e) => {
                if (e.ctrlKey) {
                  e.preventDefault();
                  setZoom((z) =>
                    Math.max(
                      0.25,
                      Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1)),
                    ),
                  );
                }
              }}
            >
              <button
                className="viewer-arrow prev"
                aria-label="上一张"
                disabled={index <= 0}
                onClick={() => void navigate(-1)}
              >
                <ChevronLeft size={27} />
              </button>
              {preview ? (
                <img
                  className="full-photo"
                  draggable={false}
                  src={preview}
                  alt={view.name}
                  style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                />
              ) : previewError ? (
                <div className="empty">
                  <ImageIcon size={40} />
                  <h2>无法预览这张照片</h2>
                  <p>{previewError}</p>
                </div>
              ) : (
                <LoaderCircle className="spin" size={30} />
              )}
              <button
                className="viewer-arrow next"
                aria-label="下一张"
                disabled={index < 0 || index >= total - 1}
                onClick={() => void navigate(1)}
              >
                <ChevronRight size={27} />
              </button>
            </div>
            {info && (
              <aside className="info-panel">
                <div className="info-title">
                  <h2>照片信息</h2>
                  <button
                    className="icon-button"
                    aria-label="关闭照片信息"
                    onClick={() => setInfo(false)}
                  >
                    <X size={17} />
                  </button>
                </div>
                <h3>{view.name}</h3>
                <dl>
                  <dt>尺寸</dt>
                  <dd>
                    {details
                      ? `${details.width.toLocaleString()} × ${details.height.toLocaleString()}`
                      : "正在读取…"}
                  </dd>
                  <dt>文件大小</dt>
                  <dd>{bytes(view.bytes)}</dd>
                  <dt>格式</dt>
                  <dd>{details?.format ?? "—"}</dd>
                  <dt>修改日期</dt>
                  <dd>{date(view.modified)}</dd>
                  <dt>位置</dt>
                  <dd className="path">{displayPath(view.path)}</dd>
                  {details?.metadata.map(([tag, value]) => (
                    <div key={tag}>
                      <dt>
                        {(
                          {
                            Make: "制造商",
                            Model: "相机",
                            DateTimeOriginal: "拍摄时间",
                            ExposureTime: "曝光时间",
                            FNumber: "光圈",
                            PhotographicSensitivity: "ISO",
                            FocalLength: "焦距",
                            LensModel: "镜头",
                          } as Record<string, string>
                        )[tag] ?? tag}
                      </dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </aside>
            )}
          </div>
          <footer className="viewer-footer">
            <span className="muted">
              {index >= 0 ? `${index + 1} / ${total}` : ""}
            </span>
            <div className="zoom-controls">
              <button
                className="icon-button"
                aria-label="缩小"
                onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              >
                <ZoomOut size={18} />
              </button>
              <button className="zoom-value" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="放大"
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              >
                <ZoomIn size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="适应窗口"
                onClick={() => {
                  setZoom(1);
                  setRotation(0);
                }}
              >
                <Maximize size={17} />
              </button>
            </div>
            <button
              className="secondary"
              onClick={() => {
                slideshowStartId.current = view?.id ?? null;
                setSlideshow(true);
                setPlaying(true);
              }}
            >
              <Play size={15} />
              幻灯片
            </button>
          </footer>
        </div>
      )}
      {slideshow && view && (
        <div
          className={`slideshow ${chromeVisible ? "" : "chrome-hidden"}`}
          role="dialog"
          aria-label="幻灯片播放"
          onPointerMove={poke}
          onFocusCapture={poke}
        >
          <SlideshowStage
            key={restartToken}
            url={preview}
            name={view.name}
            slideIndex={photos.findIndex((p) => p.id === view.id)}
            playing={playing}
            animations={prefs.animations}
            transitions={prefs.transitions}
            onReady={markSlideReady}
          />
          <div className="slideshow-chrome">
            <div className="slideshow-title">{view.name}</div>
            <button
              className="slideshow-arrow prev"
              aria-label="上一张"
              onClick={() => void navigate(-1)}
            >
              <ChevronLeft size={30} />
            </button>
            <button
              className="slideshow-arrow next"
              aria-label="下一张"
              onClick={() => void navigate(1)}
            >
              <ChevronRight size={30} />
            </button>
            <div
              className="slideshow-toolbar"
              onFocusCapture={poke}
              onPointerDown={poke}
            >
              <SlideshowMusic
                playing={playing}
                restartToken={restartToken}
                onInteraction={poke}
              />
              <button
                aria-label={playing ? "暂停" : "播放"}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
                {playing ? "暂停" : "播放"}
              </button>
              <button
                className={prefs.loop ? "on" : ""}
                aria-label="循环播放"
                onClick={() => togglePref("loop")}
              >
                <Repeat size={18} />
                循环
              </button>
              <button
                className={prefs.animations ? "on" : ""}
                aria-label="动效"
                onClick={() => togglePref("animations")}
              >
                <Sparkles size={18} />
                动效
              </button>
              <button
                className={prefs.transitions ? "on" : ""}
                aria-label="转场"
                onClick={() => togglePref("transitions")}
              >
                <Layers size={18} />
                转场
              </button>
              <button aria-label="重新播放" onClick={restartSlideshow}>
                <RotateCcw size={18} />
                重播
              </button>
              <button aria-label="退出幻灯片" onClick={exitSlideshow}>
                退出
              </button>
            </div>
          </div>
        </div>
      )}
      {editor && view && preview && (
        <Editor
          key={view.id}
          photo={view}
          url={preview}
          onClose={() => setEditor(false)}
          onSaved={() => void reload()}
          notify={notify}
        />
      )}
      {deleting && (
        <div className="dialog-shade">
          <div className="dialog" role="alertdialog" aria-label="删除确认">
            <div className="dialog-icon">
              <Trash2 size={24} />
            </div>
            <h2>将 {deleting.length} 张照片移至回收站？</h2>
            <p className="muted">
              照片将从图库中移除。需要时，可从 Windows 回收站恢复。
            </p>
            <footer>
              <button onClick={() => setDeleting(null)}>取消</button>
              <button className="danger" onClick={deleteConfirmed}>
                移至回收站
              </button>
            </footer>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Info size={17} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
