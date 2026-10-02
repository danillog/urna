/** Shape of data/generated/elections.json, produced by pipeline/build.py. */

import type { GeometryCollection, Topology } from "topojson-specification";

export type RoundId = "r1" | "r2";
export type Office = "president" | "governor" | "senate";
export type Method = "in_person" | "phone" | "online";
export type ColorName = "blue" | "gold" | "red" | "teal" | "violet" | "gray";

/** Series keys that are not candidates. */
export const OTHERS = "others";
export const UNDECIDED = "undecided";

export interface Poll {
  /** Pollster. */
  p: string;
  /** Last day of fieldwork, as days since January 1st of the election year. */
  d: number;
  /** Sample size, when published. */
  n?: number;
  /** Values by series, in percent of total votes. */
  v: Record<string, number>;
}

export interface AccuracyRow {
  p: string;
  d: number;
  meanError: number;
  marginError: number;
  shares: Record<string, number>;
}

/** One chart: a single office, place and round. */
export interface Race {
  date: string;
  electionDay: number;
  series: string[];
  colors: Record<string, ColorName>;
  parties: Record<string, string>;
  dashed: string[];
  polls: Poll[];
  result: Record<string, number> | null;
  winner: string | null;
  accuracy: AccuracyRow[];
  validVotesOnly: boolean;
  notes: string[];
  /** State races only: candidates folded into "others". */
  folded?: string[];
}

export interface TimelineEvent {
  day: number;
  label: string;
  /** Vertical slot for the label, so close events do not overlap. */
  row: number;
  /** Keep the label even when it sits close to the right edge. */
  pinned: boolean;
}

export interface PresidentialElection {
  year: number;
  context: string;
  events: TimelineEvent[];
  rounds: Partial<Record<RoundId, Race>>;
}

export interface StateEntry {
  uf: string;
  name: string;
  note: string;
  governor: Partial<Record<RoundId, Race>>;
  senate: Partial<Record<RoundId, Race>>;
}

export interface Dataset {
  methods: Record<string, Method>;
  presidential: Record<string, PresidentialElection>;
  states: Record<string, StateEntry>;
}

/** Shape of data/generated/map.json, produced by pipeline/municipal_map.py. */
export interface MunicipalRace {
  /** Candidates referenced by the index arrays below. */
  candidates: string[];
  colors: Record<string, ColorName>;
  /** Per municipality, in topology order. -1 when there is no data. */
  winner: number[];
  /** Shares in tenths of a percent of valid votes. */
  winnerShare: number[];
  second: number[];
  secondShare: number[];
  votes: number[];
}

export interface MunicipalMap {
  municipalities: { names: string[]; uf: string[] };
  topology: Topology<{ municipalities: GeometryCollection }>;
  /** Keyed "2022-r2". */
  races: Record<string, MunicipalRace>;
}
