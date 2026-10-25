/**
 * The 2026 vote inside each state capital, by IBGE weighting area (groups of
 * neighbourhoods), next to the 2022 Census sample. Data from pipeline/capitals.py.
 */

import type { GeometryCollection, Topology } from "topojson-specification";

import { COLOUR, SCHOOLING, groupOf, weightedBreaks, type CensusVar } from "./census-vote";

export interface Area {
  /** IBGE weighting area code; its first 7 digits are the municipality. */
  id: string;
  /** Neighbourhoods in it, most populous first. */
  bairros: string[];
  population: number;
  /** Household income per person, reais of July 2022: the mean over the people, and the median
   * (half the people live on less). */
  income: number | null;
  incomeMedian?: number | null;
  /** Percent of adults 25+ at each level of schooling (adding up to 100). */
  eduBasic: number | null;
  eduFund: number | null;
  eduMid: number | null;
  degree: number | null;
  /** Percent of people 10+ in each religion (adding up to 100). */
  catholic: number | null;
  evangelical: number | null;
  noReligion: number | null;
  otherReligion: number | null;
  /** Valid votes cast in the area's polling places, and the shares of the PT and the rival. */
  valid: number;
  pt: number | null;
  rival: number | null;
  /** Percent of the area's sections whose report the TSE has published (null: no section). */
  coverage: number | null;
  /** The runoff's vote, once read (pipeline.capitals r2). */
  r2?: AreaVote;
  /** Percent of the people by colour or race (census universe, every person), and "negro":
   * preto and pardo together. */
  white?: number | null;
  black?: number | null;
  brown?: number | null;
  asian?: number | null;
  indigenous?: number | null;
  negro?: number | null;
  /** Percent of the people aged 60 or more (census universe). */
  elderly?: number | null;
  /** Percent of households with a couple where the couple is of the same sex. */
  sameSex?: number | null;
  /** Mean income over the median: near 1 where incomes are alike, high where a few pull the
   * mean up. Of the weighting area (a larger unit: its areas' ratios, weighted by people). */
  incomeRatio?: number | null;
  /** Mean years of study of adults 25+. */
  schoolYears?: number | null;
  /** Percent of people 10+ who are Espírita, and of Umbanda or Candomblé (in `otherReligion`
   * in the municipal census, apart here: inside the capitals the religion adds up with them). */
  spiritist?: number | null;
  afro?: number | null;
  /** Percent of the labour force (14+) out of work and looking. */
  unemployed?: number | null;
  /** Of workers who go to work: percent taking over an hour, and going on foot or by bike,
   * by motorcycle, by car (taxi and apps too), by public transport. */
  commuteLong?: number | null;
  commuteWalk?: number | null;
  commuteMoto?: number | null;
  commuteCar?: number | null;
  commuteTransit?: number | null;
  /** Percent of people living in a rented home, behind bare brick or improvised walls, without
   * internet at home; who ever lived in another municipality. */
  renting?: number | null;
  poorWalls?: number | null;
  noInternet?: number | null;
  migrant?: number | null;
  /** Census universe, by tract: percent of homes that are flats, with two bathrooms or more,
   * with the sewage in the public network; of people 15+ who cannot read and write. */
  flat?: number | null;
  bathrooms?: number | null;
  sewer?: number | null;
  illiterate?: number | null;
}

/** One round's vote in an area. */
export type AreaVote = Pick<Area, "valid" | "pt" | "rival" | "coverage">;

export type CapitalRound = "r1" | "r2";

/** Below this share of published reports, an area's vote is drawn faded and flagged. */
export const LOW_COVERAGE = 70;

/** A capital as the list has it; its areas come with `Capital`, downloaded when picked. */
export interface CapitalMeta {
  code: string;
  name: string;
  uf: string;
  /** Percent of the capital's valid votes whose polling place fell in an area. */
  placed: number;
  /** Sections with a report of their own, and how many of those the TSE has not published yet. */
  sections: number;
  missing: number;
  /** The runoff's reports: placed share, published and missing. */
  r2?: { placed: number; sections: number; missing: number };
  /** Gini of income between the weighting areas (as if all in an area had its mean): below the
   * city's true Gini, which the census does not publish by municipality. */
  giniAreas?: number | null;
}

/** How a capital is cut: the IBGE's weighting areas, its neighbourhoods, its regions (the IBGE's
 * subdistricts), or (São Paulo) its districts and subprefeituras. */
export type CapitalLevel = "areas" | "bairros" | "regions" | "districts" | "subprefeituras";
export const CAPITAL_LEVELS: CapitalLevel[] = ["areas", "bairros", "regions", "districts", "subprefeituras"];

export interface CapitalUnits {
  /** Each unit as an area; `bairros` holds its name. */
  areas: Area[];
  topology: Topology<{ areas: GeometryCollection }>;
  /** Neighbourhoods: percent of the city's people living in one the IBGE defines. */
  cover?: number;
  /** "osm": drawn from OpenStreetMap's points, borders approximate (São Paulo, which has no
   * official neighbourhoods). */
  source?: "osm";
}

export interface Capital extends CapitalMeta {
  areas: Area[];
  /** The capital's areas, with only the part of the mesh they use. */
  topology: Topology<{ areas: GeometryCollection }>;
  /** The IBGE's neighbourhoods (19 capitals) and subdistricts (15); São Paulo's districts and subprefeituras. */
  units?: Partial<Record<Exclude<CapitalLevel, "areas">, CapitalUnits>>;
}

/** The levels a capital can be shown at. */
export function levelsOf(c: Capital): CapitalLevel[] {
  return CAPITAL_LEVELS.filter((l) => l === "areas" || c.units?.[l]);
}

/** Whether a level's units are São Paulo's approximate neighbourhoods (OpenStreetMap). */
export function isApprox(c: Capital, level: CapitalLevel): boolean {
  return level !== "areas" && c.units?.[level]?.source === "osm";
}

/** A capital cut at a level, as a capital of its own (falls back to the areas). */
export function atLevel(c: Capital, level: CapitalLevel): Capital {
  const u = level === "areas" ? undefined : c.units?.[level];
  return u ? { ...c, areas: u.areas, topology: u.topology } : c;
}

export interface CapitalsData {
  capitals: CapitalMeta[];
  /** The same figures for the whole country (a dash where the census has none). */
  brazil?: Partial<Record<CensusVar, number | null>>;
}

/** Religion inside the capitals: six categories adding up to 100% of people 10+. */
export const CAPITAL_RELIGION: CensusVar[] = [
  "catholic",
  "evangelical",
  "spiritist",
  "afro",
  "noReligion",
  "otherReligion",
];
/** How workers get to work (a share of those who go to work, adding up to nearly 100%). */
export const COMMUTE: CensusVar[] = ["commuteTransit", "commuteCar", "commuteMoto", "commuteWalk"];
/** The home: the kind, what it has, how it is held. */
export const HOME: CensusVar[] = ["flat", "bathrooms", "renting", "sewer", "poorWalls", "noInternet"];

/** Variables the units have: no urban share (the capitals are all city). Colour or race, age,
 * couples, the home's kind, bathrooms and sewage, and literacy come from the census universe,
 * tract by tract; the rest from the sample, published by weighting area only (`fromSample`). */
export const AREA_VARS: CensusVar[] = [
  "income",
  "incomeMedian",
  "incomeRatio",
  ...CAPITAL_RELIGION,
  ...SCHOOLING,
  "schoolYears",
  "illiterate",
  ...COLOUR,
  "negro",
  "elderly",
  "sameSex",
  "migrant",
  "unemployed",
  ...COMMUTE,
  "commuteLong",
  ...HOME,
  "population",
];

/** Addresses of the variables only the capitals have (beside those of the municipal census). */
export const CAPITAL_SLUGS = {
  incomeRatio: "media-mediana",
  schoolYears: "anos-de-estudo",
  spiritist: "espiritas",
  afro: "umbanda-candomble",
  unemployed: "desemprego",
  commuteLong: "mais-de-1h",
  commuteWalk: "a-pe",
  commuteMoto: "moto",
  commuteCar: "carro",
  commuteTransit: "transporte-publico",
  renting: "aluguel",
  poorWalls: "sem-reboco",
  noInternet: "sem-internet",
  migrant: "de-fora",
  flat: "apartamentos",
  bathrooms: "banheiros",
  sewer: "esgoto",
} satisfies Partial<Record<CensusVar, string>>;

/** Read tract by tract: a neighbourhood's own figure. The others are its weighting areas'. */
const UNIVERSE: CensusVar[] = [
  ...COLOUR,
  "negro",
  "elderly",
  "sameSex",
  "flat",
  "bathrooms",
  "sewer",
  "illiterate",
  "population",
];
export const fromSample = (v: CensusVar) => AREA_VARS.includes(v) && !UNIVERSE.includes(v);

export function areaValue(a: Area, v: CensusVar): number | null {
  if (!AREA_VARS.includes(v)) return null;
  const x = a[v as keyof Area] as number | null | undefined;
  return x === null || x === undefined || (v !== "population" && a.population === 0) ? null : x;
}

/** A band of a unit's tenths of the population along a variable, from and to (inclusive). */
export interface Band {
  v: CensusVar;
  from: number;
  to: number;
}

/** The units inside a band; the rest stay out, as do those without a value. */
export function inBand(areas: Area[], band: Band | null): (a: Area) => boolean {
  if (!band) return () => true;
  const decile = areaDeciles(areas, band.v);
  return (a) => {
    const d = decile(a);
    return d !== null && d >= band.from && d <= band.to;
  };
}

export function areaVote(a: Area, side: "pt" | "rival"): number | null {
  return a.valid ? a[side] : null;
}

/** Tenth of the capital's population each area falls in, along a variable; null without data. */
export function areaDeciles(areas: Area[], v: CensusVar): (a: Area) => number | null {
  const rows = areas.flatMap((a) => {
    const x = areaValue(a, v);
    return x === null ? [] : [{ x, w: a.population }];
  });
  const breaks = weightedBreaks(rows, 10);
  return (a) => {
    const x = areaValue(a, v);
    return x === null ? null : groupOf(x, breaks);
  };
}

/** The vote by tenth of the capital's population along a variable, every vote counting once. */
export function areaLine(areas: Area[], v: CensusVar, side: "pt" | "rival"): { x: number; y: number }[] {
  const decile = areaDeciles(areas, v);
  const groups: Area[][] = Array.from({ length: 10 }, () => []);
  for (const a of areas) {
    const d = decile(a);
    if (d !== null && areaVote(a, side) !== null) groups[d]!.push(a);
  }
  return groups
    .filter((g) => g.length)
    .map((g) => {
      const xs = g.map((a) => areaValue(a, v)!).sort((p, q) => p - q);
      const valid = g.reduce((s, a) => s + a.valid, 0);
      const votes = g.reduce((s, a) => s + (areaVote(a, side)! / 100) * a.valid, 0);
      return { x: xs[Math.floor(xs.length / 2)]!, y: (votes / valid) * 100 };
    });
}

/** The capital as seen in one round: the runoff's votes in place of the 1st round's. */
export function capitalInRound(c: Capital, round: CapitalRound): Capital {
  if (round === "r1" || !c.r2) return c;
  const swap = (areas: Area[]) =>
    areas.map((a) => ({ ...a, ...(a.r2 ?? { valid: 0, pt: null, rival: null, coverage: null }) }));
  return {
    ...c,
    ...c.r2,
    areas: swap(c.areas),
    units:
      c.units &&
      Object.fromEntries(
        Object.entries(c.units).map(([level, u]) => [level, u && { ...u, areas: swap(u.areas) }]),
      ),
  };
}

/** The topology object holding one capital's areas. */
export function capitalObject(capital: Capital): GeometryCollection {
  return capital.topology.objects.areas;
}

/** The level a capital opens at to see who lives where: the most familiar names it has. */
export function namedLevel(c: Capital): CapitalLevel {
  const levels = levelsOf(c);
  return (["districts", "bairros", "regions"] as const).find((l) => levels.includes(l)) ?? "areas";
}

/** A unit's short name: the neighbourhood, or the most populous one of an IBGE area; an area
 * without any (three capitals have no names at all) gets `unnamed`. */
export function unitName(a: Area, unnamed = a.id): string {
  return a.bairros[0] ?? unnamed;
}

/** Each unit's short name; where several share it (São Paulo's weighting areas are named by
 * their district), `part(name, k, n)` tells them apart ("Moema, área 1 de 3"). `unnamed(k)`
 * names the k-th of those without any. */
export function unitNames(
  areas: Area[],
  unnamed: (k: number) => string,
  part: (name: string, k: number, n: number) => string,
): Map<string, string> {
  const base = areas.map((a, k) => unitName(a, unnamed(k + 1)));
  const total = new Map<string, number>();
  for (const n of base) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    areas.map((a, k) => {
      const n = base[k]!;
      if (total.get(n)! < 2) return [a.id, n];
      seen.set(n, (seen.get(n) ?? 0) + 1);
      return [a.id, part(n, seen.get(n)!, total.get(n)!)];
    }),
  );
}

export interface Ranked {
  area: Area;
  value: number;
  /** 1 = most; equal values share the better rank. */
  rank: number;
}

/** Units with a value, most first. */
export function ranking(areas: Area[], v: CensusVar): Ranked[] {
  const rows = areas.flatMap((area) => {
    const value = areaValue(area, v);
    return value === null ? [] : [{ area, value, rank: 0 }];
  });
  rows.sort((p, q) => q.value - p.value || unitName(p.area).localeCompare(unitName(q.area)));
  rows.forEach((r, k) => (r.rank = k && r.value === rows[k - 1]!.value ? rows[k - 1]!.rank : k + 1));
  return rows;
}

/** The whole city's figure, each unit weighted by its people (population: the total). Medians
 * do not add up so: the city's median income is not the mean of its areas' medians, so none;
 * nor is its mean-to-median ratio the mean of its areas' ratios. */
export function cityValue(areas: Area[], v: CensusVar): number | null {
  if (v === "incomeMedian" || v === "incomeRatio") return null;
  let sum = 0;
  let people = 0;
  for (const a of areas) {
    const x = areaValue(a, v);
    if (x === null) continue;
    sum += v === "population" ? x : x * a.population;
    people += a.population;
  }
  if (!people) return null;
  return v === "population" ? sum : sum / people;
}

/** A capital's place among the capitals by inequality between its areas (1 = most unequal). */
export function giniRank(
  capitals: CapitalMeta[],
  code: string,
): { gini: number; rank: number; of: number } | null {
  const known = capitals.filter((c) => typeof c.giniAreas === "number");
  const me = known.find((c) => c.code === code);
  if (!me) return null;
  const gini = me.giniAreas!;
  return { gini, rank: 1 + known.filter((c) => c.giniAreas! > gini).length, of: known.length };
}
