/** Shape of data/generated/americas-indicators.json (pipeline/americas/indicators.py). */

export type IndicatorKey = "hdi" | "income" | "poverty" | "food" | "democracy";

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
  /** Poverty: every survey of the countries the main series leaves blank some years (any
   * kind, consumption included), oldest first; shown, marked, up to fallbackMaxAge years old. */
  fallback?: Record<string, FallbackSurvey[]>;
  fallbackMaxAge?: number;
  /** Poverty: why a country stays blank in the map's last year. */
  missingWhy?: Record<string, string>;
  /** Poverty: the US states' official rate (Census Bureau), by the US line: tooltip only. */
  officialByRegion?: Record<string, (number | null)[]>;
  officialSource?: string;
  officialUrl?: string;
  /** Food: countries FAO gives only as below its floor ("<2.5"), shown at the floor. */
  belowFloor?: string[];
  /** Food: the US states (USDA, households food insecure, 3-year averages): tooltip only. */
  usStates?: StateSeries<string>;
  /** Food: USDA's national share of households food insecure, by year ("2001": 10.7). */
  usNational?: Record<string, number>;
  /** Food: Brazil's states (IBGE, EBIA, households in moderate or severe insecurity): tooltip only. */
  brStates?: StateSeries<number>;
  /** Food: Brazil's own EBIA series, by year ("2004": 16.8; "2018" is the POF 2017–2018). */
  brNational?: Record<string, number>;
}

/** A national source's values by state, on its own scale: one value per period, oldest first. */
export interface StateSeries<P extends string | number> {
  source: string;
  url: string;
  /** "2012–2014" (3-year averages) or 2023 (survey years). */
  periods?: P[];
  years?: P[];
  values: Record<string, (number | null)[]>;
}

export type Welfare = "income" | "consumption";

export interface FallbackSurvey {
  year: number;
  value: number;
  welfare: Welfare;
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
  poverty: [0, 5, 10, 15, 20, 25, 30, 40, 50, 60],
  food: [0, 5, 10, 15, 20, 25, 30, 40, 50, 60],
  democracy: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
};

/** Indicators where less is better: their colors run the other way, and the ranking too. */
const LOWER_IS_BETTER: ReadonlySet<IndicatorKey> = new Set(["poverty", "food"]);

export const lowerIsBetter = (key: IndicatorKey): boolean => LOWER_IS_BETTER.has(key);

/** The color step (.q0–.q9) of a value's step: light is always the better end. */
export function colorStep(key: IndicatorKey, index: number): number {
  return LOWER_IS_BETTER.has(key) ? STEPS[key].length - 1 - index : index;
}

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

/** What the map paints: the main value, else a fallback survey (marked with its kind). Rankings
 * and legend counts keep to valueAt, so a fallback never competes with the main series. */
export function paintAt(
  data: IndicatorData,
  key: IndicatorKey,
  iso: string,
  year: number,
  region?: string,
): (Reading & { fallback?: Welfare }) | null {
  const main = valueAt(data, key, iso, year, region);
  if (main) return main;
  const indicator = data.indicators[key];
  const surveys = indicator.fallback?.[iso];
  if (!surveys) return null;
  const found = surveys.filter((s) => s.year <= year).at(-1);
  if (!found || year - found.year > (indicator.fallbackMaxAge ?? 0)) return null;
  return { value: found.value, year: found.year, fallback: found.welfare };
}

/** A US state's official poverty rate (another line than the map's): the latest up to `year`. */
export function officialAt(
  data: IndicatorData,
  key: IndicatorKey,
  region: string,
  year: number,
): Reading | null {
  const series = data.indicators[key].officialByRegion?.[region];
  if (!series) return null;
  for (let y = Math.min(year, data.firstYear + series.length - 1); y >= data.firstYear; y--) {
    const v = series[y - data.firstYear];
    if (v != null) return { value: v, year: y };
  }
  return null;
}

/** A state's values on its country's own scale (food: USDA for the US, IBGE for Brazil), labelled
 * by period, oldest first; empty when the indicator has none for that state. */
export function stateSeries(
  data: IndicatorData,
  key: IndicatorKey,
  region: string,
): { period: string; value: number }[] {
  const indicator = data.indicators[key];
  const series = region.startsWith("US-")
    ? indicator.usStates
    : region.startsWith("BR-")
      ? indicator.brStates
      : null;
  const values = series?.values[region];
  if (!series || !values) return [];
  const labels = (series.periods ?? series.years ?? []).map(String);
  return values.flatMap((v, i) => (v == null ? [] : [{ period: labels[i]!, value: v }]));
}

/** The first year an indicator has any value (FAO's food insecurity starts in 2015). */
export function firstDataYear(data: IndicatorData, key: IndicatorKey): number | null {
  let first: number | null = null;
  for (const series of Object.values(data.indicators[key].values)) {
    const i = series.findIndex((v) => v != null);
    if (i >= 0 && (first === null || data.firstYear + i < first)) first = data.firstYear + i;
  }
  return first;
}

export function step(key: IndicatorKey, value: number): number {
  let index = 0;
  STEPS[key].forEach((from, i) => {
    if (value >= from) index = i;
  });
  return index;
}

/** Position among the countries with data that year, 1 = the best (highest, or lowest poverty). */
export function rank(data: IndicatorData, key: IndicatorKey, iso: string, year: number): [number, number] {
  const readings = Object.keys(data.indicators[key].values)
    .map((c) => [c, valueAt(data, key, c, year)?.value] as const)
    .filter((r): r is readonly [string, number] => r[1] != null)
    .sort((a, b) => (LOWER_IS_BETTER.has(key) ? a[1] - b[1] : b[1] - a[1]));
  return [readings.findIndex(([c]) => c === iso) + 1, readings.length];
}
