export type Motion = "none" | "zoomIn" | "zoomOut" | "panLeft" | "panRight";
export type Transition =
  | "none"
  | "fadeThroughBlack"
  | "crossFade"
  | "zoomInThroughBlack"
  | "zoomOutThroughBlack"
  | "zoomInFade"
  | "zoomOutFade"
  | "pushLeft"
  | "pushUp"
  | "pushRotate"
  | "lineSplitVerticalRightDown"
  | "lineSplitVerticalUpLeft"
  | "zoomRotate"
  | "rotate"
  | "elasticStretchLeft"
  | "elasticStretchDown"
  | "elasticSqueezeVertical";
export type Picture = {
  url: string;
  name: string;
  width: number;
  height: number;
  motion: Motion;
  index: number;
};
type Box = "none" | "letterbox" | "pillarbox";
export type SlideshowStageProps = {
  url: string;
  name: string;
  playing: boolean;
  animations: boolean;
  transitions: boolean;
  onReady?: () => void;
  transition?: Transition;
  slideIndex?: number;
  slideKey?: string;
};

// Recovered cE / yE selection: stable for a slideshow session and slide index.
export function slideshowRandom(value: string): number {
  const primes = [643453, 397427, 744431, 203531, 850679];
  const words = [3124850170 ^ value.length, 1570530349, 3367363075];
  for (let i = 0; i < value.length; i++)
    words[i % 3] =
      ((words[i % 3] + (~words[(i + 2) % 3] >>> 5) + value.charCodeAt(i)) *
        primes[i % 5]) >>>
      0;
  let sum = words.reduce((a, b) => a + b, 0);
  sum = (708803 * (sum + (sum >>> 14))) >>> 0;
  return ((916127 * (sum + (sum >>> 11))) >>> 0) / 4294967296;
}
export function weighted<T extends string>(
  options: readonly (readonly [T, number])[],
  seed: string,
): T {
  let cursor =
    slideshowRandom(seed) *
    options.reduce((sum, [, weight]) => sum + weight, 0);
  return (
    options.find(([, weight]) => (cursor -= weight) <= 0)?.[0] ??
    options[options.length - 1][0]
  );
}
export const motions: readonly (readonly [Motion, number])[] = [
  ["zoomIn", 0.33],
  ["zoomOut", 0.33],
  ["panLeft", 0.17],
  ["panRight", 0.17],
];
const choices: readonly (readonly [Transition, number])[] = [
  ["none", 0.2],
  ["fadeThroughBlack", 0.06],
  ["crossFade", 0.25],
  ["zoomInThroughBlack", 0.16],
  ["zoomOutThroughBlack", 0.16],
  ["zoomInFade", 0.12],
  ["zoomOutFade", 0.12],
  ["pushLeft", 0.12],
  ["pushUp", 0.25],
  ["pushRotate", 0.12],
  ["lineSplitVerticalRightDown", 0.03],
  ["lineSplitVerticalUpLeft", 0.03],
];
function box(p: Picture, width: number, height: number): Box {
  const ratio = p.width / p.height,
    viewport = width / height;
  return ratio > 1
    ? ratio > viewport + 0.00001
      ? "letterbox"
      : "none"
    : ratio < viewport - 0.00001
      ? "pillarbox"
      : "none";
}
function pushAllowed(index: number, seed: string) {
  const key = `${seed}@pushTransitionSpacing`,
    scale = 4;
  const position = (n: number) => n + slideshowRandom(`${key}@${n}`);
  const value = (index + slideshowRandom(`${key}_position`) * scale) / scale;
  const cell = Math.floor(value);
  return (
    ((value - position(value < position(cell) ? cell - 1 : cell)) * scale) %
      2 >=
    1
  );
}
export function selectTransition(
  previous: Picture,
  next: Picture,
  seed: string,
  width: number,
  height: number,
): Transition {
  const before = box(previous, width, height),
    after = box(next, width, height);
  const zoomInFamily =
    slideshowRandom(`${seed}@zoomTransitionFilter#-1`) <= 0.5;
  return weighted(
    choices.filter(([type]) => {
      if (
        type.startsWith("zoomIn") &&
        (!zoomInFamily ||
          previous.motion === "zoomOut" ||
          next.motion === "zoomOut")
      )
        return false;
      if (
        type.startsWith("zoomOut") &&
        (zoomInFamily ||
          previous.motion === "zoomIn" ||
          next.motion === "zoomIn")
      )
        return false;
      if (
        type.startsWith("zoom") &&
        after === "pillarbox" &&
        next.motion.startsWith("pan")
      )
        return false;
      if (
        type === "crossFade" &&
        before === "pillarbox" &&
        after === "pillarbox"
      )
        return false;
      if (
        ["pushLeft", "pushUp", "pushRotate"].includes(type) &&
        !pushAllowed(next.index, seed)
      )
        return false;
      if (
        ["pushLeft", "pushRotate"].includes(type) &&
        [previous.motion, next.motion].includes("panRight")
      )
        return false;
      if (
        [
          "pushLeft",
          "pushUp",
          "lineSplitVerticalRightDown",
          "lineSplitVerticalUpLeft",
        ].includes(type) &&
        (before !== "none" || after !== "none")
      )
        return false;
      if (
        type === "pushRotate" &&
        (previous.width < previous.height || next.width < next.height)
      )
        return false;
      return true;
    }),
    `${seed}&tr#${next.index}`,
  );
}
