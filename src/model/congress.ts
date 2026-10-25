/**
 * Congress after each election: seats per party, placed left to right, and the
 * hemicycle they are drawn in. Data from pipeline/congress.py.
 */

/** Congress, and São Paulo's state assembly (Alesp) and city council (Câmara Municipal). */
export type House = "chamber" | "senate" | "alesp" | "cmsp";
/** The two houses of Congress: the only ones with roll-call measures, today's view, positions. */
export const isCongress = (h: House): h is "chamber" | "senate" => h === "chamber" || h === "senate";
export type IdeologyGroup = "left" | "centre-left" | "centre" | "centre-right" | "right";
export const GROUPS: IdeologyGroup[] = ["left", "centre-left", "centre", "centre-right", "right"];

export interface CongressParty {
  /** Acronym as written that year. */
  party: string;
  /** The same party through renames: "DEM" for PFL and DEM. */
  lineage: string;
  name: string;
  seats: number;
  /** Zucco & Power's scale, about −1 (left) to +1 (right); null when unplaced. */
  score: number | null;
  group: IdeologyGroup | null;
  /** "bls-2021" (survey wave), "bolognesi", "mean:DEM+PSL"; null when unplaced. */
  source: string | null;
  /** In the Centrão's core, per the source in CongressData.centrao (marked from its year on). */
  centrao: boolean;
  /** 2026: how many of its seats went to someone never elected before (pipeline.congress). */
  newcomers?: number;
}

export interface CongressElection {
  year: number;
  total: number;
  /** The TSE has not named the elected yet: seats are our projection. */
  provisional?: boolean;
  /** Left to right, unplaced parties last. */
  parties: CongressParty[];
}

export interface CongressData {
  cuts: Record<Exclude<IdeologyGroup, "right">, number>;
  /** Bolognesi et al. (0–10) → Zucco & Power: a + b·x. */
  bolognesiLine: [number, number];
  centrao: {
    since: number;
    source: { title: string; outlet: string; date: string; url: string };
  };
  houses: Record<House, CongressElection[]>;
  /** The legislature in office by the party each member has today (pipeline.congress --refresh-now). */
  now?: {
    date: string;
    chamber: CongressElection;
    senate: CongressElection;
    /** Members whose party today differs from the one elected for. */
    switches: PartySwitch[];
  };
}

export interface PartySwitch {
  name: string;
  house: House;
  uf: string;
  from: string;
  to: string;
  /** The party elected for ran no candidate in 2026: it folded or merged, not a switch. */
  extinct: boolean;
}

/** The year of the composition in office today: the latest election before today's year. */
export function inOfficeYear(data: CongressData, house: House): number | null {
  if (!data.now || !isCongress(house)) return null;
  const today = Number(data.now.date.slice(0, 4));
  const years = data.houses[house].map((e) => e.year).filter((y) => y < today);
  return years.length ? Math.max(...years) : null;
}

/** One seat in the hemicycle: centre in a 2 × 1 box (origin at the bottom middle), and its party. */
export interface Seat {
  x: number;
  y: number;
  party: number;
}

/** Inner radius of the hemicycle, as a share of the outer one. */
const INNER = 0.4;

/**
 * Seats on concentric half rings, the usual parliament diagram: the fewest rows
 * that hold every seat with the dots evenly spaced, seats per row in proportion
 * to its length, then all seats swept from left to right by angle so each party
 * fills a wedge. Returns the seats and the dot radius.
 */
export function hemicycle(seatsPerParty: number[]): { seats: Seat[]; radius: number } {
  const total = seatsPerParty.reduce((a, b) => a + b, 0);
  if (!total) return { seats: [], radius: 0 };
  let rows = 1;
  let radii: number[] = [1];
  let spacing = 1;
  for (; rows < 40; rows++) {
    spacing = (1 - INNER) / Math.max(1, rows - 1 + 0.5);
    radii = Array.from({ length: rows }, (_, i) => (rows === 1 ? 1 : INNER + (i * (1 - INNER)) / (rows - 1)));
    const capacity = radii.reduce((sum, r) => sum + Math.floor((Math.PI * r) / spacing) + 1, 0);
    if (capacity >= total) break;
  }
  // Seats per row in proportion to its length, largest remainders first.
  const length = radii.reduce((a, r) => a + r, 0);
  const exact = radii.map((r) => (total * r) / length);
  const perRow = exact.map(Math.floor);
  let left = total - perRow.reduce((a, b) => a + b, 0);
  exact
    .map((e, i) => [e - Math.floor(e), i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0) {
        perRow[i]!++;
        left--;
      }
    });
  const spots: { angle: number; r: number }[] = [];
  radii.forEach((r, i) => {
    const n = perRow[i]!;
    for (let j = 0; j < n; j++) spots.push({ angle: n === 1 ? Math.PI / 2 : Math.PI * (1 - j / (n - 1)), r });
  });
  // Left to right; on the same ray, inner rows first.
  spots.sort((a, b) => b.angle - a.angle || a.r - b.r);
  const owner: number[] = [];
  seatsPerParty.forEach((n, p) => {
    for (let k = 0; k < n; k++) owner.push(p);
  });
  return {
    seats: spots.map((s, i) => ({
      x: Math.cos(s.angle) * s.r,
      y: Math.sin(s.angle) * s.r,
      party: owner[i]!,
    })),
    radius: spacing * 0.42,
  };
}

/** Seats per ideological group, and the unplaced ones. */
export function seatsByGroup(e: CongressElection): Record<IdeologyGroup | "none", number> {
  const out = { left: 0, "centre-left": 0, centre: 0, "centre-right": 0, right: 0, none: 0 };
  for (const p of e.parties) out[p.group ?? "none"] += p.seats;
  return out;
}

/** A party line in every election of a house: its entry there, or null when it had no seats. */
export function history(elections: CongressElection[], lineage: string): (CongressParty | null)[] {
  return elections.map((e) => e.parties.find((p) => p.lineage === lineage) ?? null);
}

/**
 * What the legend can select: a left–right group, the unplaced parties, the Centrão (a
 * cited list), or the government's base as measured by votes (src/model/governismo.ts).
 */
export type FocusKey = IdeologyGroup | "none" | "centrao" | "base" | "centraoMeasured" | "newcomers";
export const FOCUS_KEYS: FocusKey[] = [...GROUPS, "none", "centrao", "base", "centraoMeasured", "newcomers"];

/** Party lines picked by measure, not by list: the government's base, the Centrão. */
export interface Measured {
  base?: ReadonlySet<string>;
  centrao?: ReadonlySet<string>;
}

/** Whether a party is among the selected ones; `base` holds the party lines of the measured base. */
export function inFocus(p: CongressParty, focus: readonly FocusKey[], measured: Measured = {}): boolean {
  return (
    focus.includes(p.group ?? "none") ||
    (p.centrao && focus.includes("centrao")) ||
    (focus.includes("base") && Boolean(measured.base?.has(p.lineage))) ||
    (focus.includes("centraoMeasured") && Boolean(measured.centrao?.has(p.lineage)))
  );
}

/** How many of a party's seats are selected: all of them when the party is, else its
 * newcomers when those are (seats, not parties: a party is never all new). */
export function selectedSeats(p: CongressParty, focus: readonly FocusKey[], measured: Measured = {}): number {
  if (inFocus(p, focus, measured)) return p.seats;
  return focus.includes("newcomers") ? (p.newcomers ?? 0) : 0;
}

/** Seats selected together (each seat counted once). */
export function focusSeats(e: CongressElection, focus: readonly FocusKey[], measured: Measured = {}): number {
  return e.parties.reduce((sum, p) => sum + selectedSeats(p, focus, measured), 0);
}
