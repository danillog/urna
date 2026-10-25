/**
 * The numbers of "Epocas", from motion/scripts/epocas.py (motion/data/epocas.json): HDI in
 * 1990 and 2023 (UNDP), food insecurity (FAO, latest 3-year average), the "time twins" and
 * the pairs with the same HDI and a very different plate.
 */
import json from "../../data/epocas.json";

export interface Country {
  iso: string;
  name: string;
  then: number;
  now: number;
  food: number | null;
  foodYear: number | null;
}
export interface Twin {
  iso: string;
  name: string;
  then: number;
  now: number;
  gain: number;
  twin: string;
  twinName: string;
  twinNow: number;
}

interface Epocas {
  then: number;
  now: number;
  countries: Country[];
  twins: Twin[];
  picks: string[];
  pairs: { low: string; high: string; gap: number }[];
  correlation: number;
}

export const EPOCAS = json as unknown as Epocas;
export const byIso = new Map(EPOCAS.countries.map((c) => [c.iso, c]));

/** The teletext page: the Americas' biggest countries plus the two ends of the scale. */
const PAGE = ["USA", "CAN", "CHL", "ARG", "URY", "MEX", "BRA", "COL", "PER", "BOL", "HND", "HTI"];
export const PAGE_COUNTRIES = PAGE.map((iso) => byIso.get(iso)).filter((c): c is Country => Boolean(c));

export const TWINS = EPOCAS.picks.map((iso) => EPOCAS.twins.find((t) => t.iso === iso)!).filter(Boolean);
export const PAIRS = EPOCAS.pairs.slice(0, 4).map((p) => ({ low: byIso.get(p.low)!, high: byIso.get(p.high)!, gap: p.gap }));
export const WITH_FOOD = EPOCAS.countries.filter((c) => c.food !== null);
export const BRAZIL = byIso.get("BRA")!;

/** "0,641". */
export const hdi = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
/** "41,3%". */
export const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
/** Upper case without breaking accents, for the retro page. */
export const caps = (s: string) => s.toLocaleUpperCase("pt-BR");
