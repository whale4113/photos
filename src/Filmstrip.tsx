import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { thumbnail } from "./api";
import type { Photo } from "./model";
import "./Filmstrip.css";

const STEP = 82;
const OVERSCAN = 4;
const FilmstripThumbnail = memo(function FilmstripThumbnail({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    setUrl("");
    thumbnail(photo.id, photo.modified).then(value => {
      if (alive) setUrl(value);
    }).catch(() => {});
    return () => { alive = false; };
  }, [photo.id, photo.modified]);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="filmstrip-placeholder">▧</span>;
});

export interface FilmstripProps {
  photos: Photo[];
  currentId: string;
  onSelect: (photo: Photo) => void;
  total: number;
  loadMore?: () => void;
  loading?: boolean;
}

export default function Filmstrip({ photos, currentId, onSelect, total, loadMore, loading = false }: FilmstripProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ left: 0, width: 800 });
  const requestedLength = useRef(-1);
  const selectedIndex = photos.findIndex(photo => photo.id === currentId);
  const start = Math.max(0, Math.floor(range.left / STEP) - OVERSCAN);
  const end = Math.min(photos.length, Math.ceil((range.left + range.width) / STEP) + OVERSCAN);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setRange({ left: element.scrollLeft, width: element.clientWidth }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || selectedIndex < 0) return;
    const left = selectedIndex * STEP;
    if (left < element.scrollLeft || left + STEP > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = Math.max(0, left - (element.clientWidth - STEP) / 2);
      setRange({ left: element.scrollLeft, width: element.clientWidth });
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!loading && loadMore && photos.length < total && end >= photos.length - 2 && requestedLength.current !== photos.length) {
      requestedLength.current = photos.length;
      loadMore();
    }
  }, [end, photos.length, total, loadMore, loading]);

  return <div className="filmstrip" aria-label="照片轨道">
    <div className="filmstrip-scroll" ref={viewport}
      onScroll={event => setRange({ left: event.currentTarget.scrollLeft, width: event.currentTarget.clientWidth })}
      onWheel={event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
      }}>
      <div className="filmstrip-track" style={{ width: Math.max(photos.length * STEP, range.width) }}>
        {photos.slice(start, end).map((photo, offset) => <button type="button" key={photo.id}
          className={`filmstrip-item${photo.id === currentId ? " active" : ""}`}
          style={{ left: (start + offset) * STEP }} title={photo.name}
          aria-label={`第 ${start + offset + 1} 张：${photo.name}`} aria-current={photo.id === currentId ? "true" : undefined}
          onClick={() => onSelect(photo)}>
          <FilmstripThumbnail photo={photo} />
        </button>)}
      </div>
    </div>
    <span className="filmstrip-count" aria-live="polite">{loading ? "加载中…" : `${selectedIndex >= 0 ? selectedIndex + 1 : "–"} / ${total}`}</span>
  </div>;
}
