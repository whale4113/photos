import { useEffect, useRef, useState } from "react";
import { Music2, Volume2, VolumeX } from "lucide-react";
import tracks from "./slideshow-tracks.json";
import "./slideshow-music.css";

const CDN = "https://cdn.hubblecontent.osi.office.net/";
const categories: Record<string, string> = {
  Chill: "舒缓",
  Beats: "节拍",
  Sentimental: "抒情",
  Fun: "欢快",
  Energetic: "活力",
  Epic: "史诗",
};
type Props = {
  playing: boolean;
  restartToken: number;
  onInteraction?: () => void;
  controlsVisible?: boolean;
};

export default function SlideshowMusic({
  playing,
  restartToken,
  onInteraction,
  controlsVisible = true,
}: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState(tracks[0].id);
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [phase, setPhase] = useState<"intro" | "main">("intro");
  const [localTracks, setLocalTracks] = useState<{ name: string; url: string }[]>([]);
  const [localIndex, setLocalIndex] = useState(0);
  const local = localTracks[localIndex];
  const [status, setStatus] = useState("");
  const track = tracks.find((item) => item.id === selected) ?? tracks[0];
  const source =
    local?.url ?? CDN + (phase === "intro" ? track.intro : track.path);

  useEffect(
    () => () => {
      localTracks.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [localTracks],
  );
  useEffect(() => {
    if (!controlsVisible) setOpen(false);
  }, [controlsVisible]);
  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      audio.current.muted = muted;
    }
  }, [volume, muted]);
  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    if (enabled && playing) {
      setStatus("正在加载音乐…");
      void player.play().catch((error: DOMException) => {
        if (error.name !== "AbortError")
          setStatus("音乐播放失败，请重试或选择本地音乐");
      });
    } else {
      player.pause();
      setStatus("");
    }
  }, [enabled, playing, source, restartToken]);
  useEffect(() => {
    setPhase("intro");
    if (audio.current) audio.current.currentTime = 0;
    setLocalIndex(0);
  }, [restartToken, selected, localTracks]);

  const retry = () => {
    const player = audio.current;
    if (!player) return;
    player.load();
    if (enabled && playing)
      void player.play().catch(() => setStatus("音乐播放失败，请选择本地音乐"));
  };
  return (
    <div
      className="slideshow-music"
      onPointerDown={(event) => {
        event.stopPropagation();
        onInteraction?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation();
      }}
    >
      <audio
        ref={audio}
        src={enabled ? source : undefined}
        preload="none"
        loop={!local && phase === "main"}
        onEnded={() => {
          if (local) setLocalIndex((index) => (index + 1) % localTracks.length);
          else setPhase("main");
          // A one-track local queue has no source change to trigger playback.
          if (localTracks.length === 1 && enabled && playing) {
            const player = audio.current;
            if (player) {
              player.currentTime = 0;
              void player.play().catch(() => setStatus("音乐播放失败，请重试或选择本地音乐"));
            }
          }
        }}
        onPlaying={() => setStatus("")}
        onError={() => {
          if (enabled) setStatus("音乐加载失败，请重试或选择本地音乐");
        }}
      />
      <button
        title="背景音乐"
        aria-label="背景音乐"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Music2 size={20} />
      </button>
      <button
        title={muted ? "取消静音" : "静音"}
        aria-label={muted ? "取消静音" : "静音"}
        onClick={() => setMuted(!muted)}
      >
        {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>
      {open && (
        <div className="slideshow-music-panel">
          <label className="slideshow-music-toggle">
            背景音乐
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
          </label>
          <div className="slideshow-music-volume">
            <span>音量</span>
            <input
              aria-label="音乐音量"
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(event) => {
                setVolume(Number(event.target.value) / 100);
                setMuted(false);
              }}
            />
            <span>{muted ? 0 : Math.round(volume * 100)}%</span>
          </div>
          <div className="slideshow-music-tracks">
            {Object.entries(categories).map(([category, label]) => (
              <fieldset key={category}>
                <legend>{label}</legend>
                {tracks
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <button
                      key={item.id}
                      className={
                        !local && selected === item.id ? "selected" : ""
                      }
                      aria-pressed={!local && selected === item.id}
                      onClick={() => {
                        setLocalTracks([]);
                        setLocalIndex(0);
                        setSelected(item.id);
                        setPhase("intro");
                        setEnabled(true);
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
              </fieldset>
            ))}
          </div>
          <button
            className="slideshow-music-local"
            onClick={() => upload.current?.click()}
          >
            选择本地音乐{local ? `：${local.name}（${localIndex + 1}/${localTracks.length}）` : "…"}
          </button>
          <input
            ref={upload}
            hidden
            type="file"
            multiple
            accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) {
                setLocalTracks(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
                setLocalIndex(0);
                setEnabled(true);
              }
              event.target.value = "";
            }}
          />
          {status && (
            <div className="slideshow-music-status" role="status">
              {status}
              {status.includes("失败") && <button onClick={retry}>重试</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
