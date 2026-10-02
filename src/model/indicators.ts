/** Shape of data/generated/americas-indicators.json (pipeline/americas/indicators.py). */

export type IndicatorKey = "hdi" | "gdp" | "democracy";

export interface Indicator {
  source: string;
  url: string;
  lastYear: number;
  /** ISO3 → one value per year from firstYear (null where the source has none). */
  values: Record<string, (number | null)[]>;
}

export interface IndicatorData {
  firstYear: number;
  indicators: Record<IndicatorKey, Indicator>;
}

export interface Band {
  /** Inclusive lower bound. */
  from: number;
  label: string;
}

/**
 * Color bands, lowest first. HDI uses UNDP's own development tiers; GDP fixed
 * PPP thresholds; democracy five equal steps of V-Dem's 0–1 index.
 */
export const BANDS: Record<IndicatorKey, Band[]> = {
  hdi: [
    { from: 0, label: "Baixo (< 0,550)" },
    { from: 0.55, label: "Médio (0,550–0,699)" },
    { from: 0.7, label: "Alto (0,700–0,799)" },
    { from: 0.8, label: "Muito alto (≥ 0,800)" },
  ],
  gdp: [
    { from: 0, label: "< US$ 5 mil" },
    { from: 5000, label: "US$ 5–10 mil" },
    { from: 10000, label: "US$ 10–20 mil" },
    { from: 20000, label: "US$ 20–40 mil" },
    { from: 40000, label: "≥ US$ 40 mil" },
  ],
  democracy: [
    { from: 0, label: "0–0,2" },
    { from: 0.2, label: "0,2–0,4" },
    { from: 0.4, label: "0,4–0,6" },
    { from: 0.6, label: "0,6–0,8" },
    { from: 0.8, label: "0,8–1" },
  ],
};

export interface Reading {
  value: number;
  /** The year the value is from: the latest the source has up to the year asked. */
  year: number;
}

export function valueAt(data: IndicatorData, key: IndicatorKey, iso: string, year: number): Reading | null {
  const series = data.indicators[key].values[iso];
  if (!series) return null;
  for (let y = Math.min(year, data.indicators[key].lastYear); y >= data.firstYear; y--) {
    const v = series[y - data.firstYear];
    if (v != null) return { value: v, year: y };
  }
  return null;
}

export function band(key: IndicatorKey, value: number): number {
  let index = 0;
  BANDS[key].forEach((b, i) => {
    if (value >= b.from) index = i;
  });
  return index;
}

/** Position among the countries with data that year, 1 = highest. */
export function rank(data: IndicatorData, key: IndicatorKey, iso: string, year: number): [number, number] {
  const readings = Object.keys(data.indicators[key].values)
    .map((c) => [c, valueAt(data, key, c, year)?.value] as const)
    .filter((r): r is readonly [string, number] => r[1] != null)
    .sort((a, b) => b[1] - a[1]);
  return [readings.findIndex(([c]) => c === iso) + 1, readings.length];
}
