/**
 * The vote next to the census: data from pipeline/census_vote.py, and the few
 * summaries the tab draws (deciles, quadrants, the gap over time). No DOM.
 *
 * Every array follows the order of the map's topology. Places are municipalities,
 * not people: a municipality with more Evangelicals voting more for someone does
 * not show that its Evangelicals did (the ecological fallacy).
 */

/** Uint16 cell meaning "no data". */
export const NO_DATA = 0xffff;

/**
 * Each a share of a municipality's people (or its income, population): religion and
 * schooling are categories, read here as how much of the town falls in each one.
 */
export type CensusVar =
  | "income"
  | "catholic"
  | "evangelical"
  | "noReligion"
  | "otherReligion"
  | "eduBasic"
  | "eduFund"
  | "eduMid"
  | "degree"
  | "illiterate"
  | "population"
  | "urban";

/** Religion: four categories adding up to 100% of the people. */
export const RELIGION: CensusVar[] = ["catholic", "evangelical", "noReligion", "otherReligion"];
/** Schooling of adults 25+: four levels, lowest first, adding up to 100%. */
export const SCHOOLING: CensusVar[] = ["eduBasic", "eduFund", "eduMid", "degree"];
export const CENSUS_VARS: CensusVar[] = [
  "income",
  ...RELIGION,
  ...SCHOOLING,
  "illiterate",
  "population",
  "urban",
];

/** Shape of data/generated/census-vote.json. */
export interface EncodedCensusVote {
  censusYears: number[];
  /** Income is stored in reais of August 2010; times this gives reais of July 2022. */
  incomeTo2022: number;
  /** Census year → variable → base64 typed array (Uint16; population Uint32). */
  census: Record<string, Record<CensusVar, string>>;
  elections: {
    year: number;
    census: number;
    /** The PT's candidate and the strongest rival nationally, as shown. */
    pt: string;
    rival: string;
    rivalParty: string;
    /** Tenths of a percent of valid votes. */
    ptShare: string;
    rivalShare: string;
    valid: string;
  }[];
}

export interface Election {
  year: number;
  census: number;
  pt: string;
  rival: string;
  rivalParty: string;
  ptShare: Uint16Array;
  rivalShare: Uint16Array;
  valid: Uint32Array;
}

export interface CensusVote {
  censusYears: number[];
  incomeTo2022: number;
  census: Record<number, Record<CensusVar, Uint16Array | Uint32Array>>;
  elections: Election[];
}

function buffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function decodeCensusVote(e: EncodedCensusVote): CensusVote {
  const census: CensusVote["census"] = {};
  for (const [year, vars] of Object.entries(e.census)) {
    const decoded = {} as Record<CensusVar, Uint16Array | Uint32Array>;
    for (const v of CENSUS_VARS)
      decoded[v] = v === "population" ? new Uint32Array(buffer(vars[v])) : new Uint16Array(buffer(vars[v]));
    census[Number(year)] = decoded;
  }
  return {
    censusYears: e.censusYears,
    incomeTo2022: e.incomeTo2022,
    census,
    elections: e.elections.map((x) => ({
      ...x,
      ptShare: new Uint16Array(buffer(x.ptShare)),
      rivalShare: new Uint16Array(buffer(x.rivalShare)),
      valid: new Uint32Array(buffer(x.valid)),
    })),
  };
}

/**
 * A municipality's value, in display units: reais of July 2022 for income, people
 * for population, percent for the rest; null when the census has none.
 */
export function valueAt(data: CensusVote, year: number, v: CensusVar, i: number): number | null {
  const raw = data.census[year]?.[v][i];
  if (raw === undefined) return null;
  if (v === "population") return raw > 0 ? raw : null;
  if (raw === NO_DATA) return null;
  if (v === "income") return raw > 0 ? raw * data.incomeTo2022 : null;
  return raw / 10;
}

/** Whether a variable is drawn on a log scale (it spans orders of magnitude). */
export const isLog = (v: CensusVar) => v === "income" || v === "population";

/** Share of valid votes (percent) of the PT's candidate or the rival; null where there was no vote. */
export function voteAt(e: Election, side: "pt" | "rival", i: number): number | null {
  const raw = (side === "pt" ? e.ptShare : e.rivalShare)[i]!;
  return raw === NO_DATA ? null : raw / 10;
}

/** The places that count: those in the region with a value and a vote. */
export function placesWith(
  data: CensusVote,
  e: Election,
  v: CensusVar,
  inRegion: (i: number) => boolean,
): number[] {
  const out: number[] = [];
  const n = e.valid.length;
  for (let i = 0; i < n; i++)
    if (inRegion(i) && e.valid[i]! > 0 && e.ptShare[i] !== NO_DATA && valueAt(data, e.census, v, i) !== null)
      out.push(i);
  return out;
}

/**
 * Cut points splitting places into `k` groups of roughly equal population, by a
 * variable: so "the poorest fifth" holds a fifth of the people, not of the towns.
 */
export function populationBreaks(
  data: CensusVote,
  year: number,
  v: CensusVar,
  places: number[],
  k: number,
): number[] {
  return weightedBreaks(
    places.map((i) => ({ x: valueAt(data, year, v, i)!, w: valueAt(data, year, "population", i) ?? 0 })),
    k,
  );
}

/** Cut points splitting weighted values into `k` groups of roughly equal total weight. */
export function weightedBreaks(rows: { x: number; w: number }[], k: number): number[] {
  const sorted = [...rows].sort((a, b) => a.x - b.x);
  const total = sorted.reduce((s, r) => s + r.w, 0);
  const breaks: number[] = [];
  let acc = 0;
  let next = 1;
  for (const r of sorted) {
    acc += r.w;
    while (next < k && acc >= (total * next) / k) {
      breaks.push(r.x);
      next++;
    }
  }
  return breaks;
}

/** Which of the groups set by `breaks` a value falls in (0 = lowest). */
export function groupOf(x: number, breaks: number[]): number {
  let g = 0;
  while (g < breaks.length && x > breaks[g]!) g++;
  return g;
}

/** Vote share (percent of valid votes) of a side across some places, every vote counting once. */
export function pooledShare(e: Election, side: "pt" | "rival", places: number[]): number | null {
  let votes = 0;
  let valid = 0;
  for (const i of places) {
    const s = voteAt(e, side, i);
    if (s === null) continue;
    votes += (s / 100) * e.valid[i]!;
    valid += e.valid[i]!;
  }
  return valid ? (votes / valid) * 100 : null;
}

export interface Quadrant {
  /** 0 = below the median, 1 = above, for the first and the second variable. */
  high: [boolean, boolean];
  places: number;
  population: number;
  pt: number | null;
  rival: number | null;
}

/** Four groups by two variables, each split at its population median: the questions "poor and Evangelical?" etc. */
export function quadrants(
  data: CensusVote,
  e: Election,
  a: CensusVar,
  b: CensusVar,
  inRegion: (i: number) => boolean,
): { cuts: [number, number]; groups: Quadrant[] } {
  const places = placesWith(data, e, a, inRegion).filter((i) => valueAt(data, e.census, b, i) !== null);
  const [ma] = populationBreaks(data, e.census, a, places, 2);
  const [mb] = populationBreaks(data, e.census, b, places, 2);
  const out: Quadrant[] = [];
  if (ma === undefined || mb === undefined) return { cuts: [NaN, NaN], groups: [] };
  for (const ha of [false, true])
    for (const hb of [false, true]) {
      const here = places.filter(
        (i) => valueAt(data, e.census, a, i)! > ma! === ha && valueAt(data, e.census, b, i)! > mb! === hb,
      );
      out.push({
        high: [ha, hb],
        places: here.length,
        population: here.reduce((s, i) => s + (valueAt(data, e.census, "population", i) ?? 0), 0),
        pt: pooledShare(e, "pt", here),
        rival: pooledShare(e, "rival", here),
      });
    }
  return { cuts: [ma, mb], groups: out };
}

export interface CompositionGroup {
  /** The side's vote share in these towns: from (exclusive) to (inclusive); null is open-ended. */
  from: number | null;
  to: number | null;
  places: number;
  population: number;
  /** Shares adding up to 100, every person counting once; null without census data. */
  religion: Record<string, number> | null;
  schooling: Record<string, number> | null;
}

/**
 * The towns grouped by the vote one side got, and for each group how its people split
 * by religion and by schooling, every person counting once (a big city weighs more).
 * Categories shown as categories: the whole distribution, not one share of it.
 */
export function composition(
  data: CensusVote,
  e: Election,
  side: "pt" | "rival",
  inRegion: (i: number) => boolean,
  cuts: number[] = [30, 45, 55, 70],
): CompositionGroup[] {
  const groups: number[][] = Array.from({ length: cuts.length + 1 }, () => []);
  for (let i = 0; i < e.valid.length; i++) {
    const v = voteAt(e, side, i);
    if (!inRegion(i) || v === null || !e.valid[i]) continue;
    groups[groupOf(v, cuts)]!.push(i);
  }
  const mix = (places: number[], vars: CensusVar[]) => {
    const sums: Record<string, number> = Object.fromEntries(vars.map((v) => [v, 0]));
    let weight = 0;
    for (const i of places) {
      const values = vars.map((v) => valueAt(data, e.census, v, i));
      const w = valueAt(data, e.census, "population", i) ?? 0;
      if (!w || values.some((x) => x === null)) continue;
      vars.forEach((v, k) => (sums[v]! += values[k]! * w));
      weight += w;
    }
    if (!weight) return null;
    for (const v of vars) sums[v]! /= weight;
    return sums;
  };
  return groups.map((places, k) => ({
    from: k ? cuts[k - 1]! : null,
    to: k < cuts.length ? cuts[k]! : null,
    places: places.length,
    population: places.reduce((s, i) => s + (valueAt(data, e.census, "population", i) ?? 0), 0),
    religion: mix(places, RELIGION),
    schooling: mix(places, SCHOOLING),
  }));
}

/**
 * How much a variable splits the vote in one election: the PT's share in the fifth of
 * the population living in the places highest on it, minus in the fifth lowest.
 * Positive: the more of it, the more PT. Null when the census lacks the variable.
 */
export function gap(
  data: CensusVote,
  e: Election,
  v: CensusVar,
  inRegion: (i: number) => boolean,
): number | null {
  const places = placesWith(data, e, v, inRegion);
  if (places.length < 10) return null;
  const breaks = populationBreaks(data, e.census, v, places, 5);
  const low = places.filter((i) => groupOf(valueAt(data, e.census, v, i)!, breaks) === 0);
  const high = places.filter((i) => groupOf(valueAt(data, e.census, v, i)!, breaks) === 4);
  const a = pooledShare(e, "pt", high);
  const b = pooledShare(e, "pt", low);
  return a === null || b === null ? null : a - b;
}

/** The vote by tenth of the population along a variable: the line drawn over the scatter. */
export function byDecile(
  data: CensusVote,
  e: Election,
  v: CensusVar,
  side: "pt" | "rival",
  inRegion: (i: number) => boolean,
): { x: number; share: number }[] {
  const places = placesWith(data, e, v, inRegion);
  const breaks = populationBreaks(data, e.census, v, places, 10);
  const groups: number[][] = Array.from({ length: 10 }, () => []);
  for (const i of places) groups[groupOf(valueAt(data, e.census, v, i)!, breaks)]!.push(i);
  return groups
    .filter((g) => g.length)
    .map((g) => {
      // The group's middle place, by population, stands for its x.
      const xs = g.map((i) => valueAt(data, e.census, v, i)!).sort((p, q) => p - q);
      return { x: xs[Math.floor(xs.length / 2)]!, share: pooledShare(e, side, g)! };
    });
}

/** IBGE regions by state, for the region filter. */
export const REGION_OF: Record<string, "N" | "NE" | "CO" | "SE" | "S"> = {
  AC: "N", AM: "N", AP: "N", PA: "N", RO: "N", RR: "N", TO: "N",
  AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE",
  DF: "CO", GO: "CO", MS: "CO", MT: "CO",
  ES: "SE", MG: "SE", RJ: "SE", SP: "SE",
  PR: "S", RS: "S", SC: "S",
}; // prettier-ignore
