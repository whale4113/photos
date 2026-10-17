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
const previewCache = new Map<string, string>();
const previewPending = new Set<string>();
export function peekPreview(id: string, modified: number): string | undefined {
  return previewCache.get(`${id}:${modified}`);
}
export function previewUrl(id: string, modified: number): Promise<string> {
  const key = `${id}:${modified}`;
  const cached = previewCache.get(key);
  if (cached) return Promise.resolve(cached);
  return call<string>("get_preview", { id }).then((data) => {
    previewCache.set(key, data);
    if (previewCache.size > 12)
      previewCache.delete(previewCache.keys().next().value!);
    return data;
  });
}
export function preloadPreview(id: string, modified: number): void {
  const key = `${id}:${modified}`;
  if (previewCache.has(key) || previewPending.has(key)) return;
  previewPending.add(key);
  call<string>("get_preview", { id })
    .then((data) => {
      previewCache.set(key, data);
      if (previewCache.size > 12)
        previewCache.delete(previewCache.keys().next().value!);
    })
    .catch(() => {})
    .finally(() => previewPending.delete(key));
}
