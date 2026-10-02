/** Shape of data/generated/elections.json, produced by pipeline/build.py. */

import type { GeometryCollection, Topology } from "topojson-specification";

export type RoundId = "r1" | "r2";
export type Office = "president" | "governor" | "senate";
export type Method = "in_person" | "phone" | "online";
export type ColorName =
  | "blue"
  | "gold"
  | "red"
  | "teal"
  | "violet"
  | "gray"
  // Extra colors for the party map, where many parties need telling apart.
  | "green"
  | "sky"
  | "cyan"
  | "orange"
  | "pink"
  | "brown";

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
export interface EncodedMapRace {
  /** Candidates (president) or party acronyms as written that year (mayor). */
  labels: string[];
  /** Base64 little-endian typed arrays, one entry per municipality in topology order. */
  winner: string; // Uint8 index into labels, 255 = no result
  winnerShare: string; // Uint16, tenths of a percent of valid votes
  second: string;
  secondShare: string;
  votes: string; // Uint32 valid votes
  /** President: color per candidate. */
  colors?: Record<string, ColorName>;
  /** Mayor: lineage key per label ("others" when not in data/parties.yaml). */
  lineages?: string[];
  /** Mayor: elected mayor per municipality, newline-separated. */
  mayors?: string;
}

export interface MunicipalMap {
  municipalities: { names: string[]; uf: string[] };
  lineages: Record<string, { color: ColorName }>;
  topology: Topology<{ municipalities: GeometryCollection }>;
  /** Keyed "president-2022-r2" or "mayor-2020". */
  races: Record<string, EncodedMapRace>;
  /** Municipal HDI by census year: base64 Uint16 in thousandths, 0 = no data. */
  idhm?: Record<string, string>;
  /** Years in `idhm` that are our own estimate from census tables, not the Atlas's figure;
   * error2010 is the method's mean absolute error when run on 2010. */
  idhmEstimate?: { years: number[]; error2010: number };
}
