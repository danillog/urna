/**
 * The Americas tab's timeline and comparison: which years a layer covers, and the countries
 * picked on the map to compare, in bars and lines.
 */
import { FIRST_YEAR, lastYear, type AmericasData } from "./americas";
import { firstDataYear, lowerIsBetter, paintAt, type IndicatorData, type IndicatorKey } from "./indicators";

/** At most this many countries side by side: more and the bars stop being readable on a phone. */
export const MAX_COMPARED = 6;

/** First and last year a layer covers: politics from FIRST_YEAR, an indicator from its first
 * value (FAO's food insecurity starts in 2015), both up to the tab's last year. */
export function yearSpan(
  data: AmericasData,
  indicators: IndicatorData,
  layer: "politics" | IndicatorKey,
): [number, number] {
  const last = lastYear(data);
  if (layer === "politics") return [FIRST_YEAR, last];
  const first = firstDataYear(indicators, layer) ?? FIRST_YEAR;
  return [Math.min(Math.max(FIRST_YEAR, first), last), last];
}

/** The year inside the span nearest to the one asked. */
export function clampYear(year: number, [first, last]: [number, number]): number {
  return Math.min(last, Math.max(first, year));
}

/** The year in `years` (ascending) nearest to `target`; ties go to the earlier one. */
export function nearestYear(years: number[], target: number): number | null {
  let best: number | null = null;
  for (const y of years) if (best === null || Math.abs(y - target) < Math.abs(best - target)) best = y;
  return best;
}

/** ?comparar=BRA,USA → the known countries, once each, in order, at most MAX_COMPARED. */
export function parseCompared(data: AmericasData, raw: string | null): string[] {
  const out: string[] = [];
  for (const iso of (raw ?? "").split(",")) {
    const code = iso.trim().toUpperCase();
    if (data.countries[code] && !out.includes(code) && out.length < MAX_COMPARED) out.push(code);
  }
  return out;
}

/** Adds a country to the comparison, or takes it out if it is there. A full list stays as it is. */
export function toggleCompared(list: string[], iso: string): string[] {
  if (list.includes(iso)) return list.filter((c) => c !== iso);
  return list.length >= MAX_COMPARED ? list : [...list, iso];
}

/** Adds a country unless it is there already (or the list is full). */
export function addCompared(list: string[], iso: string): string[] {
  return list.includes(iso) ? list : toggleCompared(list, iso);
}

export interface ComparedReading {
  iso: string;
  value: number | null;
  /** The year the value is from, when older than the year shown. */
  year: number | null;
  fallback: boolean;
}

/** The compared countries' values for a year, the better end first (less poverty and food
 * insecurity, more of the rest); countries without a value last, in the order they were picked. */
export function comparedReadings(
  indicators: IndicatorData,
  layer: IndicatorKey,
  list: string[],
  year: number,
): ComparedReading[] {
  const rows = list.map((iso): ComparedReading => {
    const r = paintAt(indicators, layer, iso, year);
    return { iso, value: r?.value ?? null, year: r ? r.year : null, fallback: Boolean(r?.fallback) };
  });
  const sign = lowerIsBetter(layer) ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (a.r.value === null || b.r.value === null)
        return (a.r.value === null ? 1 : 0) - (b.r.value === null ? 1 : 0) || a.i - b.i;
      return sign * (a.r.value - b.r.value) || a.i - b.i;
    })
    .map(({ r }) => r);
}
