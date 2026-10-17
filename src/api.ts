import { invoke } from "@tauri-apps/api/core";
export const desktop = Boolean(
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
);
export async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!desktop)
    throw new Error("请在桌面应用中使用此功能。运行 npm run tauri dev 启动。");
  return invoke<T>(command, args);
}
const cache = new Map<string, string>();
let active = 0;
const queue: (() => void)[] = [];
function next() {
  while (active < 4 && queue.length) {
    active++;
    queue.shift()!();
  }
}
export function thumbnail(id: string, modified: number): Promise<string> {
  const key = `${id}:${modified}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    queue.push(() => {
      call<string>("get_thumbnail", { id })
        .then((data) => {
          cache.set(key, data);
          if (cache.size > 2000) cache.delete(cache.keys().next().value!);
          resolve(data);
        })
        .catch(reject)
        .finally(() => {
          active--;
          next();
        });
    });
    next();
  });
}
const previewCache = new Map<string, { url: string; image: HTMLImageElement; bytes: number }>();
const previewPending = new Map<string, Promise<string>>();
const previewJobs: { key: string; preload: boolean; run: () => void; cancel: () => void }[] = [];
let previewActive = 0;
let previewBytes = 0;
function nextPreview() {
  while (previewActive < 2 && previewJobs.length) {
    previewActive++;
    previewJobs.shift()!.run();
  }
}
export function peekPreview(id: string, modified: number): string | undefined {
  const key = `${id}:${modified}`;
  const cached = previewCache.get(key);
  if (cached) {
    previewCache.delete(key);
    previewCache.set(key, cached);
  }
  return cached?.url;
}
export function previewUrl(id: string, modified: number, preload = false): Promise<string> {
  const key = `${id}:${modified}`;
  const cached = peekPreview(id, modified);
  if (cached) return Promise.resolve(cached);
  const pending = previewPending.get(key);
  if (pending) {
    if (!preload) {
      const index = previewJobs.findIndex((job) => job.key === key);
      if (index >= 0) {
        const [job] = previewJobs.splice(index, 1);
        job.preload = false;
        previewJobs.unshift(job);
      }
    }
    return pending;
  }
  let run!: () => void;
  let cancel!: () => void;
  const promise = new Promise<string>((resolve, reject) => {
    cancel = () => { previewPending.delete(key); reject(new Error("预加载已跳过")); };
    run = () => {
      call<string>("get_preview", { id }).then(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const bytes = url.length * 2 + image.naturalWidth * image.naturalHeight * 4;
        previewCache.set(key, { url, image, bytes });
        previewBytes += bytes;
        while (previewCache.size > 1 && (previewCache.size > 12 || previewBytes > 128 * 1024 * 1024)) {
          const oldest = previewCache.keys().next().value!;
          previewBytes -= previewCache.get(oldest)!.bytes;
          previewCache.delete(oldest);
        }
        resolve(url);
      }).catch(reject).finally(() => {
        previewPending.delete(key);
        previewActive--;
        nextPreview();
      });
    };
  });
  previewPending.set(key, promise);
  const job = { key, preload, run, cancel };
  if (preload) previewJobs.push(job);
  else previewJobs.unshift(job);
  nextPreview();
  return promise;
}
export function clearPreviewPreloads(): void {
  for (let i = previewJobs.length - 1; i >= 0; i--) {
    if (previewJobs[i].preload) previewJobs.splice(i, 1)[0].cancel();
  }
}
export function preloadPreview(id: string, modified: number): void {
  void previewUrl(id, modified, true).catch(() => {});
}
