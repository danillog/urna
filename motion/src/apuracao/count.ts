/**
 * The count as a timeline: for every municipality, when its votes came in. From the live
 * capture of pipeline.apuracao_ordem when there is one (copied here as ordem-<round>.json by
 * scripts/apuracao-ordem.sh), else a made-up order over the final results in
 * apuracao-cidades.json, flagged as a simulation.
 */
import cidadesJson from "../../../data/generated/apuracao-cidades.json";
import { partyColor } from "../../../src/model/apuracao";
import { COLOR } from "../common/theme";
import { COUNT, MAP, bytes } from "../common/municipios";
import ordemR1 from "./ordem-r1.json";
import ordemR2 from "./ordem-r2.json";

export type CountRound = "r1" | "r2";

interface Ordem {
  year: number;
  round: CountRound;
  start: string;
  /** "boletins de urna" when rebuilt after the fact by pipeline.apuracao_bu; absent when captured live. */
  source?: string;
  names: string[];
  parties: string[];
  places: (number[][] | null)[];
}

interface EncodedCity {
  names: string[];
  parties: string[];
  winner: string;
  winnerShare: string;
  second: string;
  secondShare: string;
  votes: string;
}

/** One municipality's snapshots, oldest first. */
interface Place {
  t: number[];
  /** Fraction of polling stations counted, 0..1. */
  c: number[];
  valid: number[];
  /** Votes per candidate (index into Count.names) at each snapshot. */
  votes: number[][];
}

export interface Count {
  round: CountRound;
  simulated: boolean;
  /** Rebuilt from the ballot-box reports (station by station) rather than captured live. */
  fromReports: boolean;
  /** The round the simulation borrowed its results from, when it is not the one asked. */
  borrowed: CountRound | null;
  names: string[];
  parties: string[];
  colors: string[];
  /** Candidates on the scoreboard, by final votes (two in a simulation: it only knows each
   * municipality's first and second). */
  top: number[];
  /** Minutes after midnight (Brasília) of minute 0. */
  clock0: number;
  /** First and last minutes worth showing. */
  from: number;
  to: number;
  places: (Place | null)[];
  /** Final valid votes per municipality, to weigh "urnas apuradas". */
  weight: Float64Array;
}

const NONE16 = 0xffff;
const cidades = cidadesJson as unknown as Record<string, EncodedCity>;
const ordens: Record<CountRound, Ordem | null> = {
  r1: ordemR1 as unknown as Ordem | null,
  r2: ordemR2 as unknown as Ordem | null,
};

const colorOf = (party: string) => COLOR[partyColor(party, MAP.lineages)];

function finish(c: Omit<Count, "top" | "weight">): Count {
  const totals = c.names.map(() => 0);
  const weight = new Float64Array(COUNT);
  c.places.forEach((p, i) => {
    if (!p) return;
    const last = p.votes.length - 1;
    p.votes[last]!.forEach((v, k) => (totals[k]! += v));
    weight[i] = p.valid[last]!;
  });
  const top = totals
    .map((v, k) => [v, k] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, c.simulated || (c.borrowed ?? c.round) === "r2" ? 2 : 3)
    .map(([, k]) => k);
  return { ...c, top, weight };
}

function fromCapture(o: Ordem): Count {
  // Brasília has had no daylight saving time since 2019: the ISO string's own hour is the one.
  const [hh, mm] = o.start.slice(11, 16).split(":").map(Number);
  let from = Infinity;
  let to = 0;
  const places = o.places.map((snaps): Place | null => {
    if (!snaps?.length) return null;
    from = Math.min(from, snaps[0]![0]!);
    to = Math.max(to, snaps.at(-1)![0]!);
    return {
      t: snaps.map((s) => s[0]!),
      c: snaps.map((s) => s[1]! / 1000),
      valid: snaps.map((s) => s[2]!),
      votes: snaps.map((s) => o.names.map((_, k) => s[3 + k] ?? 0)),
    };
  });
  return finish({
    round: o.round,
    simulated: false,
    fromReports: o.source === "boletins de urna",
    borrowed: null,
    names: o.names,
    parties: o.parties,
    colors: o.parties.map(colorOf),
    clock0: hh! * 60 + mm!,
    from: Math.max(0, from - 3),
    to,
    places,
  });
}

/** Deterministic noise in [0, 1). */
function hash(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * A plausible night: polls close at 17h; each state starts and runs at its own pace,
 * small towns finish first and big cities come in over a while. Nothing here is real.
 */
function simulated(round: CountRound): Count {
  const key = cidades[`presidente-${round}`] ? round : "r1";
  const e = cidades[`presidente-${key}`]!;
  const winner = new Uint16Array(bytes(e.winner).buffer);
  const wShare = new Uint16Array(bytes(e.winnerShare).buffer);
  const second = new Uint16Array(bytes(e.second).buffer);
  const sShare = new Uint16Array(bytes(e.secondShare).buffer);
  const valid = new Uint32Array(bytes(e.votes).buffer);
  const uf = MAP.municipalities.uf;
  const names = MAP.municipalities.names;

  // Rank of each municipality by size inside its state, 0 (smallest) to 1.
  const byState = new Map<string, number[]>();
  for (let i = 0; i < COUNT; i++) byState.set(uf[i]!, [...(byState.get(uf[i]!) ?? []), i]);
  const rank = new Float64Array(COUNT);
  for (const list of byState.values()) {
    list.sort((a, b) => valid[a]! - valid[b]!);
    list.forEach((i, r) => (rank[i] = list.length > 1 ? r / (list.length - 1) : 0.5));
  }

  const places = Array.from({ length: COUNT }, (_, i): Place | null => {
    if (winner[i] === NONE16 || !valid[i]) return null;
    const s = uf[i]!;
    const offset = 4 + hash(s, 1) * 18;
    const span = 70 + hash(s, 2) * 110;
    const begin = offset + span * (0.15 * hash(names[i]!, 3) + 0.65 * rank[i]! * hash(names[i]!, 4) ** 0.5);
    const length = 3 + Math.log10(valid[i]!) * 6 * (0.5 + hash(names[i]!, 5));
    const votes = (c: number) => {
      const row = e.names.map(() => 0);
      row[winner[i]!] = Math.round((wShare[i]! / 1000) * valid[i]! * c);
      if (second[i] !== NONE16) row[second[i]!] = Math.round((sShare[i]! / 1000) * valid[i]! * c);
      return row;
    };
    // Snapshots as a capture would see them: a pass every few minutes.
    const steps = Math.max(1, Math.round(length / 6));
    const t: number[] = [];
    const c: number[] = [];
    for (let k = 1; k <= steps; k++) {
      t.push(begin + (length * k) / steps);
      c.push(k / steps);
    }
    return { t, c, valid: c.map((x) => Math.round(valid[i]! * x)), votes: c.map(votes) };
  });
  let to = 0;
  for (const p of places) if (p) to = Math.max(to, p.t.at(-1)!);
  return finish({
    round,
    simulated: true,
    fromReports: false,
    borrowed: key === round ? null : key,
    names: e.names,
    parties: e.parties,
    colors: e.parties.map(colorOf),
    clock0: 17 * 60,
    from: 0,
    to,
    places,
  });
}

const cache = new Map<CountRound, Count>();
export function count(round: CountRound): Count {
  let c = cache.get(round);
  if (!c) {
    const o = ordens[round];
    c = o ? fromCapture(o) : simulated(round);
    cache.set(round, c);
  }
  return c;
}

/** Index of the last snapshot at or before minute t, or -1. */
export function at(p: Place, t: number): number {
  let k = -1;
  for (let j = 0; j < p.t.length && p.t[j]! <= t; j++) k = j;
  return k;
}

export interface Tally {
  valid: number;
  votes: number[];
  /** Polling stations counted, weighted by each municipality's size, 0..1. */
  counted: number;
}

export function tally(c: Count, t: number): Tally {
  const votes = c.names.map(() => 0);
  let valid = 0;
  let counted = 0;
  let total = 0;
  c.places.forEach((p, i) => {
    if (!p) return;
    total += c.weight[i]!;
    const k = at(p, t);
    if (k < 0) return;
    valid += p.valid[k]!;
    counted += p.c[k]! * c.weight[i]!;
    p.votes[k]!.forEach((v, j) => (votes[j]! += v));
  });
  return { valid, votes, counted: total ? counted / total : 0 };
}

/**
 * Minute shown at each frame of the count: half by the clock, half by the share counted,
 * so the busy first hour gets its time and the long tail does not drag.
 */
export function pacing(c: Count, frames: number): Float64Array {
  const grid: number[] = [];
  for (let t = c.from; t <= c.to + 0.5; t += 0.5) grid.push(t);
  const share = grid.map((t) => tally(c, t).counted);
  const span = c.to - c.from || 1;
  const u = grid.map((t, k) => 0.55 * share[k]! + 0.45 * ((t - c.from) / span));
  const out = new Float64Array(frames);
  let k = 0;
  for (let f = 0; f < frames; f++) {
    const target = (f / (frames - 1)) * u.at(-1)!;
    while (k < grid.length - 2 && u[k + 1]! < target) k++;
    const lo = u[k]!;
    const hi = u[k + 1] ?? lo;
    const w = hi > lo ? (target - lo) / (hi - lo) : 0;
    out[f] = grid[k]! + (grid[Math.min(k + 1, grid.length - 1)]! - grid[k]!) * Math.min(1, Math.max(0, w));
  }
  return out;
}
