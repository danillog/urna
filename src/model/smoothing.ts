import type { Poll } from "../types";

export interface TrendPoint {
  d: number;
  y: number;
  /** ±1 weighted standard deviation of the polls around the line. */
  lo: number;
  hi: number;
}

/** Below this many polls the line just connects the daily means. */
export const MIN_POLLS_FOR_AVERAGE = 3;

const MIN_SAMPLE = 500;
const MAX_SAMPLE = 5000;
const DEFAULT_SAMPLE = 2000;
/** Polls by the same pollster within this many days split one pollster's weight. */
const CROWDING_DAYS = 7;
/** A grid day needs this many polls carrying at least 5% of the peak weight. */
const MIN_SUPPORT = 3;
const SUPPORT_FRACTION = 0.05;
/** Never extrapolate further than this past the first or last poll. */
const EDGE_DAYS = 2;

/**
 * Kernel bandwidth in days: wide over a full election year, narrow over the
 * short presidential runoff campaign, in between for state runoffs.
 */
export function bandwidth(spanDays: number, presidential: boolean): number {
  if (spanDays > 120) return 14;
  return presidential ? 4 : 10;
}

/**
 * Weight of each poll: grows with the square root of the sample size (clamped),
 * and is divided by the square root of how many polls the same pollster
 * released within a week, so daily trackers do not dominate the average.
 */
export function pollWeights(polls: Poll[]): number[] {
  return polls.map((p) => {
    const sample = Math.min(MAX_SAMPLE, Math.max(MIN_SAMPLE, p.n ?? DEFAULT_SAMPLE));
    const crowd = polls.filter((q) => q.p === p.p && Math.abs(q.d - p.d) <= CROWDING_DAYS).length;
    return Math.sqrt(sample / DEFAULT_SAMPLE) / Math.sqrt(crowd);
  });
}

function dailyMeans(polls: Poll[], series: string): TrendPoint[] {
  const byDay = new Map<number, number[]>();
  for (const p of polls) {
    const values = byDay.get(p.d) ?? [];
    values.push(p.v[series]!);
    byDay.set(p.d, values);
  }
  return [...byDay]
    .sort((a, b) => a[0] - b[0])
    .map(([d, vs]) => {
      const y = vs.reduce((s, v) => s + v, 0) / vs.length;
      return { d, y, lo: y, hi: y };
    });
}

/**
 * Local linear regression with a Gaussian kernel, evaluated on every grid day.
 * Returns null when the series has no polls or no day has enough support.
 */
export function smoothSeries(
  allPolls: Poll[],
  series: string,
  grid: number[],
  bw: number,
): TrendPoint[] | null {
  const polls = allPolls.filter((p) => p.v[series] != null);
  if (!polls.length) return null;
  if (polls.length < MIN_POLLS_FOR_AVERAGE) return dailyMeans(polls, series);

  const values = polls.map((p) => p.v[series]!);
  const baseWeights = pollWeights(polls);
  const minDay = Math.min(...polls.map((p) => p.d));
  const maxDay = Math.max(...polls.map((p) => p.d));
  const out: TrendPoint[] = [];

  for (const g of grid) {
    if (g < minDay - EDGE_DAYS || g > maxDay + EDGE_DAYS) continue;
    const k = polls.map((p, i) => Math.exp(-0.5 * ((p.d - g) / bw) ** 2) * baseWeights[i]!);
    const total = k.reduce((s, v) => s + v, 0);
    const peak = Math.max(...k);
    const support = k.filter((v) => v > SUPPORT_FRACTION * peak).length;
    if (total < 1e-3 || support < MIN_SUPPORT) continue;

    const w = k.map((v) => v / total);
    const x = polls.map((p) => p.d - g);
    let xMean = 0;
    let yMean = 0;
    w.forEach((wi, i) => {
      xMean += wi * x[i]!;
      yMean += wi * values[i]!;
    });
    let sxx = 0;
    let sxy = 0;
    w.forEach((wi, i) => {
      const dx = x[i]! - xMean;
      sxx += wi * dx * dx;
      sxy += wi * dx * (values[i]! - yMean);
    });
    const slope = sxx > 1e-6 ? sxy / sxx : 0;
    const y = yMean - slope * xMean;
    let variance = 0;
    w.forEach((wi, i) => {
      variance += wi * (values[i]! - (y + slope * x[i]!)) ** 2;
    });
    const sd = Math.sqrt(variance);
    out.push({ d: g, y, lo: y - sd, hi: y + sd });
  }
  return out.length ? out : null;
}
