/** Shape of data/generated/elections.json, produced by pipeline/build.py. */

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
