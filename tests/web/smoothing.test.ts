import { describe, expect, it } from "vitest";

import { bandwidth, pollWeights, smoothSeries } from "../../src/model/smoothing";
import type { Poll } from "../../src/types";

const poll = (p: string, d: number, value: number, n?: number): Poll => ({ p, d, n, v: { A: value } });
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

describe("bandwidth", () => {
  it("is wide for a full year and narrow for runoffs", () => {
    expect(bandwidth(200, true)).toBe(14);
    expect(bandwidth(25, true)).toBe(4);
    expect(bandwidth(25, false)).toBe(10);
  });
});

describe("pollWeights", () => {
  it("grows with the square root of the clamped sample size", () => {
    const [small, base, big, huge] = pollWeights([
      poll("A", 0, 1, 100),
      poll("B", 30, 1, 2000),
      poll("C", 60, 1, 5000),
      poll("D", 90, 1, 50000),
    ]);
    expect(small).toBeCloseTo(Math.sqrt(500 / 2000));
    expect(base).toBe(1);
    expect(big).toBeCloseTo(Math.sqrt(2.5));
    expect(huge).toBe(big);
  });

  it("splits the weight of a pollster that publishes several times a week", () => {
    const w = pollWeights([poll("T", 0, 1), poll("T", 3, 1), poll("T", 6, 1), poll("X", 3, 1)]);
    expect(w[3]).toBe(1);
    expect(w[1]).toBeCloseTo(1 / Math.sqrt(3));
  });
});

describe("smoothSeries", () => {
  it("returns null when no poll has the series", () => {
    expect(smoothSeries([{ p: "A", d: 0, v: {} }], "A", [0], 14)).toBeNull();
  });

  it("connects daily means when there are too few polls", () => {
    const trend = smoothSeries([poll("A", 5, 30), poll("B", 5, 40)], "A", range(0, 10), 14);
    expect(trend).toEqual([{ d: 5, y: 35, lo: 35, hi: 35 }]);
  });

  it("recovers a constant exactly, with a zero-width band", () => {
    const polls = range(0, 10).map((d) => poll(`P${d}`, d * 3, 42));
    const trend = smoothSeries(polls, "A", range(0, 28), 4)!;
    for (const pt of trend) {
      expect(pt.y).toBeCloseTo(42);
      expect(pt.hi - pt.lo).toBeCloseTo(0);
    }
  });

  it("follows a linear trend without lag (local linear, not a moving average)", () => {
    const polls = range(0, 20).map((d) => poll(`P${d}`, d * 5, 20 + d * 0.5));
    const trend = smoothSeries(polls, "A", range(0, 96), 14)!;
    for (const pt of trend) expect(pt.y).toBeCloseTo(20 + pt.d * 0.1, 6);
  });

  it("does not extrapolate past the polls", () => {
    const polls = range(0, 5).map((d) => poll(`P${d}`, 10 + d, 30));
    const days = smoothSeries(polls, "A", range(0, 40), 4)!.map((pt) => pt.d);
    expect(Math.min(...days)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...days)).toBeLessThanOrEqual(16);
  });
});
