export interface Source {
  id: string;
  path: string;
  name: string;
  count: number;
}
export interface Photo {
  id: string;
  name: string;
  path: string;
  source_id: string;
  modified: number;
  bytes: number;
  favorite: boolean;
}
export interface Page {
  items: Photo[];
  total: number;
}
export interface Details {
  width: number;
  height: number;
  format: string;
  metadata: [string, string][];
}
export interface Prefs {
  theme: string;
  size: number;
  fit: string;
  animations: boolean;
  transitions: boolean;
  loop: boolean;
}
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Edit {
  rotation: number;
  flip: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  filter: string;
  crop: Crop | null;
}
export const original: Edit = {
  rotation: 0,
  flip: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  filter: "original",
  crop: null,
};
export const date = (value: number) =>
  new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
export const bytes = (value: number) =>
  value >= 1048576
    ? `${(value / 1048576).toFixed(1)} MB`
    : `${Math.round(value / 1024)} KB`;
export function constrainCrop(
  x: number,
  y: number,
  width: number,
  height: number,
): Crop {
  const left = Math.max(0, Math.min(x, 1)),
    top = Math.max(0, Math.min(y, 1));
  return {
    x: left,
    y: top,
    width: Math.min(Math.max(width, 0.001), 1 - left),
    height: Math.min(Math.max(height, 0.001), 1 - top),
  };
}
export function drawEdit(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  edit: Edit,
  cropping = false,
) {
  const crop = cropping ? null : edit.crop;
  const x = Math.floor((crop?.x ?? 0) * img.naturalWidth),
    y = Math.floor((crop?.y ?? 0) * img.naturalHeight);
  const width = Math.max(
      1,
      Math.min(
        img.naturalWidth - x,
        Math.round((crop?.width ?? 1) * img.naturalWidth),
      ),
    ),
    height = Math.max(
      1,
      Math.min(
        img.naturalHeight - y,
        Math.round((crop?.height ?? 1) * img.naturalHeight),
      ),
    );
  const rotation = cropping ? 0 : ((edit.rotation % 360) + 360) % 360;
  canvas.width = rotation % 180 ? height : width;
  canvas.height = rotation % 180 ? width : height;
  const ctx = canvas.getContext("2d")!;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  if (!cropping && edit.flip) ctx.scale(-1, 1);
  ctx.drawImage(
    img,
    x,
    y,
    width,
    height,
    -width / 2,
    -height / 2,
    width,
    height,
  );
  ctx.restore();
  if (cropping) return;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data,
    c = 1 + edit.contrast / 100,
    s = 1 + edit.saturation / 100,
    b = edit.brightness * 2.55;
  for (let i = 0; i < d.length; i += 4) {
    let r = (d[i] - 128) * c + 128 + b,
      g = (d[i + 1] - 128) * c + 128 + b,
      blue = (d[i + 2] - 128) * c + 128 + b;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * blue;
    r = gray + (r - gray) * s;
    g = gray + (g - gray) * s;
    blue = gray + (blue - gray) * s;
    if (edit.filter === "mono") {
      r = g = blue = 0.2126 * r + 0.7152 * g + 0.0722 * blue;
    } else if (edit.filter === "sepia") {
      [r, g, blue] = [
        0.393 * r + 0.769 * g + 0.189 * blue,
        0.349 * r + 0.686 * g + 0.168 * blue,
        0.272 * r + 0.534 * g + 0.131 * blue,
      ];
    }
    d[i] = Math.round(r);
    d[i + 1] = Math.round(g);
    d[i + 2] = Math.round(blue);
  }
  ctx.putImageData(pixels, 0, 0);
}
