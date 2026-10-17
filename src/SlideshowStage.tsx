import { useEffect, useRef } from "react";
import {
  motions,
  weighted,
  selectTransition,
  type Motion,
  type Picture,
  type SlideshowStageProps,
} from "./slideshowEffects";
import "./SlideshowStage.css";

export default function SlideshowStage(props: SlideshowStageProps) {
  const root = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const seed = useRef(Math.random().toString(36));
  const cache = useRef(new Map<string, Picture>());
  const nextIndex = useRef(0);
  const current = useRef<{ picture: Picture; element: HTMLElement } | null>(
    null,
  );
  const active = useRef(new Set<Animation>());
  const motionAnimations = useRef(new Set<Animation>());
  const ready = useRef(props.onReady);
  ready.current = props.onReady;
  const startMotion = (picture: Picture, photo: Element) => {
    const frames: Record<Motion, Keyframe[]> = {
      none: [],
      zoomIn: [{ transform: "scale(1)" }, { transform: "scale(1.16)" }],
      zoomOut: [{ transform: "scale(1.16)" }, { transform: "scale(1)" }],
      panLeft: [
        { transform: "translateX(5.33%)" },
        { transform: "translateX(-5.33%)" },
      ],
      panRight: [
        { transform: "translateX(-5.33%)" },
        { transform: "translateX(5.33%)" },
      ],
    };
    if (picture.motion === "none") return;
    const animation = photo.animate(frames[picture.motion], {
      duration: 16000,
      fill: "both",
      easing: "linear",
    });
    active.current.add(animation);
    motionAnimations.current.add(animation);
    if (!live.current.playing) animation.pause();
  };

  useEffect(() => {
    active.current.forEach((animation) =>
      props.playing ? animation.play() : animation.pause(),
    );
  }, [props.playing]);
  useEffect(() => {
    if (!props.animations) {
      motionAnimations.current.forEach((animation) => {
        animation.cancel();
        active.current.delete(animation);
      });
      motionAnimations.current.clear();
    } else if (current.current) {
      const photo = current.current.element.querySelector(".slide-foreground");
      if (photo) startMotion(current.current.picture, photo);
    }
  }, [props.animations]);
  useEffect(() => {
    if (!props.transitions) {
      root.current
        ?.querySelectorAll<HTMLElement>(".slide-frame[data-outgoing]")
        .forEach((element) => element.remove());
      active.current.forEach((animation) => {
        if (!motionAnimations.current.has(animation)) {
          animation.finish();
          animation.cancel();
          active.current.delete(animation);
        }
      });
    }
  }, [props.transitions]);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || !root.current) return;
      const stage = root.current;
      let picture = cache.current.get(props.url);
      if (!picture) {
        const index = props.slideIndex ?? nextIndex.current++;
        picture = {
          url: props.url,
          name: props.name,
          width: image.naturalWidth,
          height: image.naturalHeight,
          index,
          motion: weighted(motions, `${seed.current}&an#${index}`),
        };
        cache.current.set(props.url, picture);
        if (cache.current.size > 32)
          cache.current.delete(cache.current.keys().next().value!);
      }
      const previous = current.current;
      if (previous?.picture.url === picture.url) {
        ready.current?.();
        return;
      }
      // Rapid manual navigation discards older transitions, retaining just the displayed slide.
      stage.querySelectorAll<HTMLElement>(".slide-frame").forEach((element) => {
        if (element !== previous?.element) element.remove();
      });
      active.current.forEach((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (target instanceof Element && !stage.contains(target)) {
          animation.cancel();
          active.current.delete(animation);
          motionAnimations.current.delete(animation);
        }
      });
      const animate = (
        element: Element,
        frames: Keyframe[],
        duration: number,
        delay = 0,
        isMotion = false,
        easing = "linear",
      ) => {
        const animation = element.animate(frames, {
          duration,
          delay,
          fill: "both",
          easing,
        });
        active.current.add(animation);
        if (isMotion) motionAnimations.current.add(animation);
        if (!live.current.playing) animation.pause();
        return animation;
      };
      const frame = document.createElement("div");
      frame.className = "slide-frame";
      frame.dataset.motion = live.current.animations ? picture.motion : "none";
      const scene = document.createElement("div");
      scene.className = "slide-scene";
      const background = document.createElement("img");
      background.className = "slide-background";
      background.src = picture.url;
      background.alt = "";
      const photo = document.createElement("img");
      photo.className = `slide-foreground ${picture.width > picture.height ? "landscape" : "portrait"}`;
      photo.src = picture.url;
      photo.alt = picture.name;
      photo.draggable = false;
      scene.append(background, photo);
      frame.append(scene);
      stage.append(frame);
      current.current = { picture, element: frame };
      const effective = {
        ...picture,
        motion: live.current.animations ? picture.motion : ("none" as Motion),
      };
      const transition =
        previous && live.current.transitions
          ? (live.current.transition ??
            selectTransition(
              {
                ...previous.picture,
                motion: live.current.animations
                  ? previous.picture.motion
                  : "none",
              },
              effective,
              seed.current,
              stage.clientWidth,
              stage.clientHeight,
            ))
          : "none";
      frame.dataset.transition = transition;
      if (live.current.animations) {
        // 1% zoom or 2/300 box pan each second, including neighboring overlap.
        startMotion(picture, photo);
      }
      if (!previous) {
        ready.current?.();
        return;
      }
      const outgoing = previous.element;
      outgoing.dataset.outgoing = "";
      const outScene = outgoing.querySelector(".slide-scene")!;
      let duration = 0;
      let cleanupAnimation: Animation | undefined;
      const fade = (
        element: Element,
        from: number,
        to: number,
        time: number,
        delay = 0,
      ) => animate(element, [{ opacity: from }, { opacity: to }], time, delay);
      const move = (
        element: Element,
        from: string,
        to: string,
        time: number,
        delay = 0,
      ) =>
        animate(
          element,
          [{ transform: from }, { transform: to }],
          time,
          delay,
          false,
          "cubic-bezier(.2,.55,.3,1)",
        );
      switch (transition) {
        case "none":
          break;
        case "crossFade":
          duration = 2000 / 3;
          cleanupAnimation = fade(frame, 0, 1, duration);
          break;
        case "fadeThroughBlack":
          duration = 2000 / 3;
          fade(outgoing, 1, 0, duration / 2);
          cleanupAnimation = fade(frame, 0, 1, duration / 2, duration / 2);
          break;
        case "zoomInThroughBlack":
        case "zoomOutThroughBlack":
          duration = 3000;
          fade(outgoing, 1, 0, 1000 / 3);
          fade(frame, 0, 1, 250, 1000 / 3);
          cleanupAnimation = move(
            scene,
            transition === "zoomInThroughBlack" ? "scale(.9)" : "scale(1.1)",
            "scale(1)",
            duration,
          );
          break;
        case "zoomInFade":
        case "zoomOutFade": {
          const into = transition === "zoomInFade";
          duration = 3000;
          fade(frame, 0, 1, 1100);
          move(outScene, "scale(1)", `scale(${into ? 1.45 : 0.8})`, 1100);
          cleanupAnimation = move(
            scene,
            `scale(${into ? 0.8 : 1.5})`,
            "scale(1)",
            duration,
          );
          break;
        }
        case "pushLeft":
        case "pushUp":
        case "pushRotate": {
          const up = transition === "pushUp",
            rotate = transition === "pushRotate";
          duration = rotate ? 2500 : up ? 3000 : 2700;
          move(
            outScene,
            "none",
            rotate
              ? "translateY(-105%) rotate(-33deg)"
              : up
                ? "translateY(-25%)"
                : "translateX(-50%)",
            duration,
          );
          move(
            scene,
            rotate
              ? "translateY(105%) rotate(29deg)"
              : up
                ? "translateY(35%)"
                : "translateX(40%)",
            "none",
            duration,
          );
          const masks = Array.from({ length: 31 }, (_, i) => {
            const edge = -35 + (i / 30) * 170;
            return {
              maskImage: `linear-gradient(${up || rotate ? "0deg" : "270deg"}, black ${edge}%, transparent ${edge + 35}%)`,
            };
          });
          cleanupAnimation = animate(frame, masks, duration);
          break;
        }
        case "lineSplitVerticalRightDown":
        case "lineSplitVerticalUpLeft": {
          duration = 2000 / 3;
          const reverse = transition === "lineSplitVerticalUpLeft";
          for (let half = 0; half < 2; half++) {
            const entering = scene.cloneNode(true) as HTMLElement,
              leaving = outScene.cloneNode(true) as HTMLElement;
            const clip = half ? "inset(0 0 0 50%)" : "inset(0 50% 0 0)";
            entering.style.clipPath = clip;
            leaving.style.clipPath = clip;
            frame.append(entering);
            outgoing.append(leaving);
            const shift = reverse
              ? half
                ? "translateX(-25%)"
                : "translateY(25%)"
              : half
                ? "translateY(-25%)"
                : "translateX(25%)";
            move(leaving, "none", shift, duration);
            move(entering, shift, "none", duration);
            fade(leaving, 1, 0, duration);
            cleanupAnimation = fade(entering, 0, 1, duration);
          }
          scene.style.visibility = "hidden";
          outScene.setAttribute("style", "visibility:hidden");
          cleanupAnimation!.finished
            .then(() => {
              scene.style.visibility = "";
              frame.querySelectorAll(".slide-scene").forEach((node) => {
                if (node !== scene) node.remove();
              });
            })
            .catch(() => {});
          break;
        }
        case "zoomRotate":
        case "rotate":
          duration = 925;
          move(
            outScene,
            "none",
            transition === "rotate"
              ? "rotate(-45deg)"
              : "rotate(45deg) scale(.5)",
            450,
          );
          fade(outgoing, 1, 0, 450);
          fade(frame, 0, 1, 475, 450);
          cleanupAnimation = move(
            scene,
            transition === "rotate"
              ? "rotate(-50deg)"
              : "rotate(45deg) scale(1.5)",
            "none",
            475,
            450,
          );
          break;
        case "elasticStretchLeft":
        case "elasticStretchDown":
        case "elasticSqueezeVertical": {
          const squeeze = transition === "elasticSqueezeVertical",
            axis = transition === "elasticStretchLeft" ? "X" : "Y";
          const out = squeeze ? 400 : 330;
          duration = out + 500;
          move(outScene, "none", `scale${axis}(${squeeze ? 0.85 : 1.1})`, out);
          fade(outgoing, 1, 0, out);
          fade(frame, 0, 1, 500, out);
          cleanupAnimation = move(
            scene,
            `scale${axis}(${squeeze ? 1.15 : 0.85})`,
            "none",
            500,
            out,
          );
          break;
        }
      }
      const cleanup = () => {
        outgoing.remove();
        active.current.forEach((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          if (target instanceof Element && !stage.contains(target)) {
            animation.cancel();
            active.current.delete(animation);
            motionAnimations.current.delete(animation);
          }
        });
      };
      if (cleanupAnimation)
        cleanupAnimation.finished.then(cleanup).catch(() => {});
      else cleanup();
      ready.current?.();
    };
    image.onerror = () => {
      if (!cancelled) ready.current?.();
    };
    image.src = props.url;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [props.url]);
  useEffect(
    () => () => {
      active.current.forEach((animation) => animation.cancel());
      active.current.clear();
    },
    [],
  );
  return (
    <div
      className="slideshow-stage recovered-slideshow-stage"
      ref={root}
      aria-label={props.name}
    />
  );
}
