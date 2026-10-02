import type { Dataset, Method, Office, Race, RoundId } from "./types";

export type MethodFilter = Method | "unknown";

export interface AppState {
  office: Office;
  /** Presidential election year; state races are always the latest year. */
  year: string;
  round: RoundId;
  uf: string;
  excludedPollsters: Set<string>;
  excludedMethods: Set<MethodFilter>;
  /** Pollster whose polls stand out on the chart. */
  highlight: string | null;
}

const OFFICES: Office[] = ["president", "governor", "senate"];
const ROUNDS: RoundId[] = ["r1", "r2"];
const DEFAULT_UF = "SP";

export function latestYear(data: Dataset): string {
  return Object.keys(data.presidential).sort().at(-1)!;
}

export function defaultState(data: Dataset): AppState {
  return {
    office: "president",
    year: latestYear(data),
    round: "r1",
    uf: DEFAULT_UF,
    excludedPollsters: new Set(),
    excludedMethods: new Set(),
    highlight: null,
  };
}

export function raceFor(
  data: Dataset,
  s: Pick<AppState, "office" | "year" | "round" | "uf">,
): Race | undefined {
  if (s.office === "president") return data.presidential[s.year]?.rounds[s.round];
  return data.states[s.uf]?.[s.office][s.round];
}

export function hasRound(data: Dataset, s: AppState, round: RoundId): boolean {
  return raceFor(data, { ...s, round }) !== undefined;
}

/** Pulls an inconsistent combination (say, a Senate runoff) back to a valid one. */
export function normalize(data: Dataset, s: AppState): AppState {
  const next = { ...s };
  if (!data.presidential[next.year]) next.year = latestYear(data);
  if (!data.states[next.uf]) next.uf = DEFAULT_UF;
  if (next.office !== "president") next.year = latestYear(data);
  if (!raceFor(data, next)) next.round = "r1";
  return next;
}

export function methodOf(data: Dataset, pollster: string): MethodFilter {
  return data.methods[pollster] ?? "unknown";
}

/** Reads a shareable state from the query string, ignoring anything invalid. */
export function fromSearch(data: Dataset, search: string): AppState {
  const params = new URLSearchParams(search);
  const s = defaultState(data);
  const office = params.get("office") as Office | null;
  if (office && OFFICES.includes(office)) s.office = office;
  const year = params.get("year");
  if (year && data.presidential[year]) s.year = year;
  const round = params.get("round") as RoundId | null;
  if (round && ROUNDS.includes(round)) s.round = round;
  const uf = params.get("uf")?.toUpperCase();
  if (uf && data.states[uf]) s.uf = uf;
  const excluded = params.get("exclude");
  if (excluded) s.excludedPollsters = new Set(excluded.split(",").filter(Boolean));
  return normalize(data, s);
}

/** Inverse of fromSearch; default values are left out to keep links short. */
export function toSearch(data: Dataset, s: AppState): string {
  const params = new URLSearchParams();
  if (s.office !== "president") params.set("office", s.office);
  if (s.office === "president" && s.year !== latestYear(data)) params.set("year", s.year);
  if (s.office !== "president") params.set("uf", s.uf);
  if (s.round !== "r1") params.set("round", s.round);
  if (s.excludedPollsters.size) params.set("exclude", [...s.excludedPollsters].sort().join(","));
  const query = params.toString().replace(/%2C/g, ",");
  return query ? `?${query}` : "";
}

/** Changing the race resets filters that only made sense for the previous one. */
export function withRace(data: Dataset, s: AppState, patch: Partial<AppState>): AppState {
  return normalize(data, {
    ...s,
    ...patch,
    excludedPollsters: new Set(),
    excludedMethods: new Set(),
    highlight: null,
  });
}
