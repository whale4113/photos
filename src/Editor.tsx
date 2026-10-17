import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Crop as CropIcon,
  FlipHorizontal,
  LoaderCircle,
  Redo2,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { call } from "./api";
import { Crop, drawEdit, Edit, original, Photo } from "./model";

export default function Editor({
  photo,
  url,
  onClose,
  onSaved,
  notify,
}: {
  photo: Photo;
  url: string;
  onClose: () => void;
  onSaved: () => void;
  notify: (s: string) => void;
}) {
  const [edit, setEdit] = useState<Edit>({ ...original });
  const [history, setHistory] = useState<Edit[]>([]),
    [future, setFuture] = useState<Edit[]>([]);
  const [tab, setTab] = useState("adjust"),
    [saving, setSaving] = useState(false),
    [confirm, setConfirm] = useState(false),
    [compare, setCompare] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    image = useRef<HTMLImageElement | null>(null),
    start = useRef<{ x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(false),
    [dragCrop, setDragCrop] = useState<Crop | null>(null);
  const change = (value: Edit) => {
    setHistory((h) => [...h.slice(-39), edit]);
    setFuture([]);
    setEdit(value);
  };
  function undo() {
    if (!history.length) return;
    setFuture((f) => [edit, ...f]);
    setEdit(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setHistory((h) => [...h, edit]);
    setEdit(future[0]);
    setFuture((f) => f.slice(1));
  }
  const dirty = JSON.stringify(edit) !== JSON.stringify(original);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const scale = Math.min(
        1,
        1800 / Math.max(img.naturalWidth, img.naturalHeight),
      );
      if (scale === 1) {
        image.current = img;
        setLoaded(true);
      } else {
        const temp = document.createElement("canvas");
        temp.width = Math.round(img.naturalWidth * scale);
        temp.height = Math.round(img.naturalHeight * scale);
        temp.getContext("2d")!.drawImage(img, 0, 0, temp.width, temp.height);
        const reduced = new Image();
        reduced.onload = () => {
          if (alive) {
            image.current = reduced;
            setLoaded(true);
          }
        };
        reduced.src = temp.toDataURL("image/png");
      }
    };
    img.src = url;
    return () => {
      alive = false;
      image.current = null;
    };
  }, [url]);
  useEffect(() => {
    if (image.current && canvas.current)
      drawEdit(
        canvas.current,
        image.current,
        compare ? original : edit,
        tab === "crop" && !compare,
      );
  }, [edit, tab, loaded, compare]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        dirty ? setConfirm(true) : onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  async function save() {
    setSaving(true);
    try {
      const path = await call<string | null>("export_edit", {
        id: photo.id,
        edit,
      });
      if (path) {
        notify("已保存编辑后的副本");
        onSaved();
        onClose();
      }
    } catch (e) {
      notify(String(e));
    } finally {
      setSaving(false);
    }
  }
  function point(e: React.PointerEvent) {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }
  function preset(ratio: number) {
    if (!image.current) return;
    const aspect = image.current.naturalWidth / image.current.naturalHeight;
    const w = aspect > ratio ? ratio / aspect : 1,
      h = aspect > ratio ? 1 : aspect / ratio;
    change({
      ...edit,
      crop: { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h },
    });
  }
  const shownCrop = dragCrop ??
    edit.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return (
    <div className="editor modal-full" role="dialog" aria-label="编辑照片">
      <header className="editor-header">
        <button
          className="icon-button"
          aria-label="退出编辑"
          onClick={() => (dirty ? setConfirm(true) : onClose())}
        >
          <ArrowLeft size={20} />
        </button>
        <span className="ellipsis">编辑 · {photo.name}</span>
        <div className="editor-tabs">
          <button
            className={tab === "crop" ? "active" : ""}
            onClick={() => setTab("crop")}
          >
            <CropIcon size={18} />
            裁剪
          </button>
          <button
            className={tab === "adjust" ? "active" : ""}
            onClick={() => setTab("adjust")}
          >
            <SlidersHorizontal size={18} />
            调整
          </button>
          <button
            className={tab === "filters" ? "active" : ""}
            onClick={() => setTab("filters")}
          >
            <Sparkles size={18} />
            滤镜
          </button>
        </div>
        <button className="primary" disabled={saving || !loaded} onClick={save}>
          {saving ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}
          保存副本
        </button>
      </header>
      <div className="editor-body">
        <div className="edit-stage">
          <div
            className="canvas-wrap"
            onPointerDown={(e) => {
              if (tab !== "crop") return;
              start.current = point(e);
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragCrop(null);
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              const p = point(e),
                s = start.current;
              setDragCrop({
                x: Math.min(p.x, s.x),
                y: Math.min(p.y, s.y),
                width: Math.abs(p.x - s.x),
                height: Math.abs(p.y - s.y),
              });
            }}
            onPointerUp={() => {
              if (dragCrop && dragCrop.width > 0.01 && dragCrop.height > 0.01)
                change({ ...edit, crop: dragCrop });
              start.current = null;
              setDragCrop(null);
            }}
          >
            <canvas
              ref={canvas}
              className={tab === "crop" ? "crop-canvas" : ""}
            />
            {tab === "crop" && loaded && !compare && (
              <div
                className="crop-overlay"
                style={{
                  left: `${shownCrop.x * 100}%`,
                  top: `${shownCrop.y * 100}%`,
                  width: `${shownCrop.width * 100}%`,
                  height: `${shownCrop.height * 100}%`,
                }}
              >
                <i />
                <i />
                <i />
                <i />
                <span className="grid-line v1" />
                <span className="grid-line v2" />
                <span className="grid-line h1" />
                <span className="grid-line h2" />
              </div>
            )}
          </div>
        </div>
        <aside className="edit-panel">
          {tab === "adjust" && (
            <>
              <h2>让照片恰到好处</h2>
              <p className="muted">调整光线和色彩。</p>
              {(
                [
                  ["brightness", "亮度"],
                  ["contrast", "对比度"],
                  ["saturation", "饱和度"],
                ] as const
              ).map(([key, label]) => (
                <label className="slider-field" key={key}>
                  <span>
                    {label}
                    <output>{edit[key]}</output>
                  </span>
                  <input
                    aria-label={label}
                    type="range"
                    min="-100"
                    max="100"
                    value={edit[key]}
                    onChange={(e) =>
                      change({ ...edit, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              <button
                className="text-button"
                onClick={() =>
                  change({ ...edit, brightness: 0, contrast: 0, saturation: 0 })
                }
              >
                重置调整
              </button>
            </>
          )}
          {tab === "crop" && (
            <>
              <h2>重新构图</h2>
              <p className="muted">在照片上拖动，选择保留的区域。</p>
              <div className="ratio-options">
                <button onClick={() => change({ ...edit, crop: null })}>
                  原始
                </button>
                <button onClick={() => preset(1)}>1:1</button>
                <button onClick={() => preset(4 / 3)}>4:3</button>
                <button onClick={() => preset(3 / 2)}>3:2</button>
                <button onClick={() => preset(16 / 9)}>16:9</button>
              </div>
              <div className="transform-tools">
                <button
                  onClick={() =>
                    change({ ...edit, rotation: (edit.rotation + 90) % 360 })
                  }
                >
                  <RotateCw size={18} />
                  旋转 90°
                </button>
                <button
                  className={edit.flip ? "active" : ""}
                  onClick={() => change({ ...edit, flip: !edit.flip })}
                >
                  <FlipHorizontal size={18} />
                  水平翻转
                </button>
              </div>
              <p className="muted small">
                旋转和翻转将在调整预览及保存的副本中显示。
              </p>
            </>
          )}
          {tab === "filters" && (
            <>
              <h2>一种新的感觉</h2>
              <div className="filter-list">
                {[
                  ["original", "原始"],
                  ["mono", "黑白"],
                  ["sepia", "复古"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={edit.filter === key ? "selected" : ""}
                    onClick={() => change({ ...edit, filter: key })}
                  >
                    <img
                      src={url}
                      alt=""
                      style={{
                        filter:
                          key === "mono"
                            ? "grayscale(1)"
                            : key === "sepia"
                              ? "sepia(1)"
                              : "none",
                      }}
                    />
                    {label}
                    {edit.filter === key && <Check size={16} />}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="preserve-note">
            <Check size={15} />
            原图保留，编辑另存为副本
          </div>
        </aside>
      </div>
      <footer className="editor-footer">
        <div>
          <button
            className="icon-button"
            disabled={!history.length}
            onClick={undo}
            aria-label="撤销"
          >
            <Undo2 size={19} />
          </button>
          <button
            className="icon-button"
            disabled={!future.length}
            onClick={redo}
            aria-label="重做"
          >
            <Redo2 size={19} />
          </button>
          <button
            className="text-button"
            onClick={() => change({ ...original })}
          >
            全部重置
          </button>
        </div>
        <button
          className="secondary"
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          onBlur={() => setCompare(false)}
        >
          按住查看原图
        </button>
        <span className="muted small">Ctrl + Z 撤销</span>
      </footer>
      {confirm && (
        <div className="dialog-shade">
          <div className="dialog">
            <h2>放弃未保存的编辑？</h2>
            <p className="muted">原始照片不会受到影响。</p>
            <footer>
              <button onClick={() => setConfirm(false)}>继续编辑</button>
              <button className="danger" onClick={onClose}>
                放弃编辑
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
