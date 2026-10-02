/** Shape of data/generated/americas.json, produced by pipeline/americas/build.py. */

export type Family = "left" | "centre-left" | "centre-right" | "right";
export type System = "presidential" | "general" | "parliamentary" | "non-competitive";

export interface AmericasElection {
  date: string;
  article: string;
  winner?: string;
  party?: string;
  family?: Family;
  /** Where the family comes from: survey score, Wikipedia position or a reasoned call. */
  familySource?: string;
  status?: "annulled" | "disputed";
  /** Results by state/province, when a source has them: code → [winner, share, runner-up, share]
   * (indexes into regionCandidates, shares in tenths of a percent). */
  regions?: Record<string, [number, number, number, number]>;
  regionCandidates?: { name: string; family: Family | null }[];
  /** "TSE", or "en:Article" / "es:Artículo" for Wikipedia. */
  regionSource?: string;
}

export interface Country {
  name: string;
  system: System;
  elections: AmericasElection[];
}

export interface AmericasData {
  families: Family[];
  countries: Record<string, Country>;
  territories: Record<string, string>;
}

export const FIRST_YEAR = 2000;

/** What a country shows in a given year: its latest election held by the end of that year. */
export function electionAt(country: Country, year: number): AmericasElection | null {
  const end = `${year}-12-31`;
  let found: AmericasElection | null = null;
  for (const e of country.elections) if (e.date <= end) found = e;
  return found;
}

/** Color group of a country in a year; null when there is nothing to color. */
export function familyAt(country: Country, year: number): Family | null {
  const e = electionAt(country, year);
  return e && e.status !== "annulled" ? (e.family ?? null) : null;
}

export function lastYear(data: AmericasData): number {
  const dates = Object.values(data.countries).flatMap((c) => c.elections.map((e) => e.date));
  return Number(dates.sort().at(-1)!.slice(0, 4));
}

/** Countries per family in a year, in family order. */
export function countByFamily(data: AmericasData, year: number): Map<Family, number> {
  const counts = new Map<Family, number>(data.families.map((f) => [f, 0]));
  for (const c of Object.values(data.countries)) {
    const f = familyAt(c, year);
    if (f) counts.set(f, counts.get(f)! + 1);
  }
  return counts;
}

/** Family shown for one region: its local winner when there are results by region,
 * otherwise the country's national result. */
export function regionFamily(country: Country, year: number, code: string): Family | null {
  const e = electionAt(country, year);
  if (!e || e.status === "annulled") return null;
  const row = e.regions?.[code];
  if (row) return e.regionCandidates?.[row[0]]?.family ?? null;
  return e.family ?? null;
}
