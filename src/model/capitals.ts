/**
 * The 2026 vote inside each state capital, by IBGE weighting area (groups of
 * neighbourhoods), next to the 2022 Census sample. Data from pipeline/capitals.py.
 */

import type { GeometryCollection, Topology } from "topojson-specification";

import { RELIGION, SCHOOLING, groupOf, weightedBreaks, type CensusVar } from "./census-vote";

export interface Area {
  /** IBGE weighting area code; its first 7 digits are the municipality. */
  id: string;
  /** Neighbourhoods in it, most populous first. */
  bairros: string[];
  population: number;
  /** Household income per person, reais of July 2022. */
  income: number | null;
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
}

/** Below this share of published reports, an area's vote is drawn faded and flagged. */
export const LOW_COVERAGE = 70;

export interface Capital {
  code: string;
  name: string;
  uf: string;
  /** Percent of the capital's valid votes whose polling place fell in an area. */
  placed: number;
  /** Sections with a report of their own, and how many of those the TSE has not published yet. */
  sections: number;
  missing: number;
  areas: Area[];
}

export interface CapitalsData {
  capitals: Capital[];
  topology: Topology<{ areas: GeometryCollection }>;
}

/** Variables the weighting areas have: no urban share (the capitals are all city), no illiteracy. */
export const AREA_VARS: CensusVar[] = ["income", ...RELIGION, ...SCHOOLING, "population"];

export function areaValue(a: Area, v: CensusVar): number | null {
  if (!AREA_VARS.includes(v)) return null;
  const x = a[v as keyof Area] as number | null | undefined;
  return x === null || x === undefined || (v !== "population" && a.population === 0) ? null : x;
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

/** The topology object holding one capital's areas. */
export function capitalObject(data: CapitalsData, code: string): GeometryCollection {
  const all = data.topology.objects.areas;
  return { ...all, geometries: all.geometries.filter((g) => String(g.id).startsWith(code)) };
}
