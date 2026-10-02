/** Shape of data/generated/americas-indicators.json (pipeline/americas/indicators.py). */

export type IndicatorKey = "hdi" | "income" | "prices" | "democracy";

export interface Indicator {
  source: string;
  url: string;
  lastYear: number;
  /** Beyond this many years, an old value is not shown for a later year. */
  maxAge?: number;
  /** Countries whose series covers urban areas only. */
  urbanOnly?: string[];
  /** ISO3 → one value per year from firstYear (null where the source has none). */
  values: Record<string, (number | null)[]>;
  /** Region code → yearly values, where a source gives them by state (Brazil's IDHM). */
  regions?: Record<string, (number | null)[]>;
  regionSource?: string;
}

export interface IndicatorData {
  firstYear: number;
  indicators: Record<IndicatorKey, Indicator>;
}

/**
 * Lower bounds of ten color steps, lowest first. Fine steps on purpose: with wide
 * bands, real changes (Brazil's democracy index from 0.69 to 0.80) stayed one color.
 */
export const STEPS: Record<IndicatorKey, number[]> = {
  hdi: [0, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
  income: [0, 150, 250, 350, 450, 600, 800, 1000, 1500, 2000],
  prices: [0, 30, 40, 50, 60, 70, 80, 90, 100, 120],
  democracy: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
};

/** UNDP's development tiers, for the tooltip. */
export function hdiTier(value: number): "low" | "medium" | "high" | "veryHigh" {
  return value >= 0.8 ? "veryHigh" : value >= 0.7 ? "high" : value >= 0.55 ? "medium" : "low";
}

export interface Reading {
  value: number;
  /** The year the value is from: the latest the source has up to the year asked. */
  year: number;
}

/** The value for a country, or for one of its regions when the indicator has them. */
export function valueAt(
  data: IndicatorData,
  key: IndicatorKey,
  iso: string,
  year: number,
  region?: string,
): Reading | null {
  const indicator = data.indicators[key];
  const series = (region && indicator.regions?.[region]) || indicator.values[iso];
  if (!series) return null;
  for (let y = Math.min(year, indicator.lastYear); y >= data.firstYear; y--) {
    const v = series[y - data.firstYear];
    if (v == null) continue;
    return indicator.maxAge !== undefined && year - y > indicator.maxAge ? null : { value: v, year: y };
  }
  return null;
}

export function step(key: IndicatorKey, value: number): number {
  let index = 0;
  STEPS[key].forEach((from, i) => {
    if (value >= from) index = i;
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
