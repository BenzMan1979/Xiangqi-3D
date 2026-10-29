export type Easing = (t: number) => number;

export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic: Easing = (t) => t * t * t;
export const easeOutBack: Easing = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
export const linear: Easing = (t) => t;

/**
 * Game time. Everything animated (tweens, particles) advances by real time × `scale`,
 * so slow motion at the moment of impact slows the whole scene together.
 */
export const clock = {
  /** Debug multiplier, e.g. ?slow=8 for frame-by-frame inspection. */
  base: 1,
  slowmo: 1,
  get scale() {
    return this.slowmo / this.base;
  },
};

/** Runs `update` every frame with eased progress 0..1 over `duration` game seconds. */
export function tween(duration: number, update: (t: number) => void, ease: Easing = easeInOutCubic) {
  return new Promise<void>((resolve) => {
    let elapsed = 0;
    let last = performance.now();
    const step = (now: number) => {
      elapsed += ((now - last) / 1000) * clock.scale;
      last = now;
      const raw = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
      update(ease(raw));
      if (raw < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Waits `seconds` of game time. */
export const wait = (seconds: number) => tween(seconds, () => {}, linear);

/** Brief slow motion: drops to `scale`, holds for `hold` real seconds, then eases back. */
export async function hitStop(scale = 0.15, hold = 0.12) {
  clock.slowmo = scale;
  await new Promise((r) => setTimeout(r, hold * 1000 * clock.base));
  const start = performance.now();
  const recover = 0.25 * 1000 * clock.base;
  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / recover);
      clock.slowmo = lerp(scale, 1, t);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
