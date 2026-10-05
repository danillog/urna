/**
 * Congress after each election: seats per party, placed left to right, and the
 * hemicycle they are drawn in. Data from pipeline/congress.py.
 */

export type House = "chamber" | "senate";
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

/** What the legend can select: a left–right group, the unplaced parties, or the Centrão. */
export type FocusKey = IdeologyGroup | "none" | "centrao";
export const FOCUS_KEYS: FocusKey[] = [...GROUPS, "none", "centrao"];

/** Whether a party is among the selected ones: any selected group, or the Centrão when it is selected. */
export function inFocus(p: CongressParty, focus: readonly FocusKey[]): boolean {
  return focus.includes(p.group ?? "none") || (p.centrao && focus.includes("centrao"));
}

/** Seats the selected parties hold together (each party counted once). */
export function focusSeats(e: CongressElection, focus: readonly FocusKey[]): number {
  return e.parties.filter((p) => inFocus(p, focus)).reduce((sum, p) => sum + p.seats, 0);
}
