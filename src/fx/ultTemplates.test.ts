import { describe, expect, it } from 'vitest';
import { ULT_TEMPLATES } from '../data/ultimates';
import { FrameParams, TEMPLATE_DRAW, drawAmbient, rgba } from './ultTemplates';

/** A canvas context stand-in that records every numeric argument so NaNs can be caught. */
function fakeContext() {
  const numbers: number[] = [];
  const target: Record<string, unknown> = {};
  const gradient = { addColorStop: (o: number) => numbers.push(o) };
  const ctx = new Proxy(target, {
    get(_, prop: string) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (...args: number[]) => {
          numbers.push(...args);
          return gradient;
        };
      }
      return (...args: unknown[]) => {
        for (const a of args) if (typeof a === 'number') numbers.push(a);
      };
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, numbers };
}

const params = (over: Partial<FrameParams> = {}): FrameParams => ({
  w: 1280,
  h: 800,
  t: 0.5,
  time: 2,
  color: '#ffd27a',
  glow: '#bb99ee',
  emblem: '漢',
  intensity: 1,
  dir: 1,
  font: 'serif',
  ...over,
});

describe('ultimate templates', () => {
  for (const name of ULT_TEMPLATES) {
    it(`${name} draws finite coordinates over its whole timeline`, () => {
      for (const dir of [1, -1] as const) {
        for (const intensity of [0.5, 1]) {
          for (let i = 0; i <= 20; i++) {
            const { ctx, numbers } = fakeContext();
            TEMPLATE_DRAW[name](ctx, params({ t: i / 20, time: i / 4, dir, intensity }));
            expect(numbers.every(Number.isFinite), `${name} t=${i / 20}`).toBe(true);
          }
        }
      }
    });
  }

  it('ambient hold effect draws finite coordinates', () => {
    const { ctx, numbers } = fakeContext();
    drawAmbient(ctx, { w: 800, h: 600, time: 12.3, color: '#ffd27a', intensity: 1 });
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });

  it('formats colours as rgba with clamped alpha', () => {
    expect(rgba('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.500)');
    expect(rgba('#ff8000', 3)).toBe('rgba(255, 128, 0, 1.000)');
    expect(rgba('#ff8000', -1)).toBe('rgba(255, 128, 0, 0.000)');
  });
});
