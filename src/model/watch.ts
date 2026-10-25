/**
 * "De olho": who spends the most of their office allowance and who shows up, in four houses
 * (pipeline/watch.py). Rankings and comparisons, no DOM.
 */

export type WatchHouse = "camara" | "senado" | "alesp" | "cmsp";
export const WATCH_HOUSES: WatchHouse[] = ["camara", "senado", "alesp", "cmsp"];

export interface WatchMember {
  name: string;
  party: string;
  uf: string | null;
  url: string;
  /** Per month in office; `capPct` only where the ceiling differs by state and is known. */
  spend: { total: number; months: number; perMonth: number; capPct?: number } | null;
  presence: { attended: number; held: number; pct: number; of: string } | null;
  /** Code in the house (Câmara, Senado), and the Eleitos 2026 profile of whoever was elected. */
  id?: string;
  profile?: string;
  /** Câmara: roll calls voted in, apart from session presence. */
  rollCalls?: { voted: number; held: number } | null;
}

export interface WatchData {
  date: string;
  minMonths: number;
  houses: Partial<Record<WatchHouse, { since: string; members: WatchMember[] }>>;
}

export type Board = "spendMost" | "spendLeast" | "presentLeast" | "presentMost";
export const BOARDS: Board[] = ["spendMost", "spendLeast", "presentLeast", "presentMost"];

/** Sort key per board: spending as a share of the state's ceiling where known, else the value. */
function value(m: WatchMember, board: Board): number | null {
  if (board === "spendMost" || board === "spendLeast")
    return m.spend ? (m.spend.capPct ?? m.spend.perMonth) : null;
  return m.presence ? m.presence.pct : null;
}

/** The top `n` of a board; ties broken by name, so the order never depends on the file's. */
export function top(members: WatchMember[], board: Board, n = 10): WatchMember[] {
  const desc = board === "spendMost" || board === "presentMost";
  return members
    .filter((m) => value(m, board) !== null)
    .sort(
      (a, b) =>
        (desc ? value(b, board)! - value(a, board)! : value(a, board)! - value(b, board)!) ||
        a.name.localeCompare(b.name, "pt-BR"),
    )
    .slice(0, n);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The house's medians, to read one member against. */
export function houseMedians(members: WatchMember[]): {
  perMonth: number | null;
  capPct: number | null;
  presence: number | null;
} {
  return {
    perMonth: median(members.flatMap((m) => (m.spend ? [m.spend.perMonth] : []))),
    capPct: median(members.flatMap((m) => (m.spend?.capPct !== undefined ? [m.spend.capPct] : []))),
    presence: median(members.flatMap((m) => (m.presence ? [m.presence.pct] : []))),
  };
}

/** A member's key in the address: house and name, accents and case aside. */
export const memberKey = (m: WatchMember) =>
  m.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

/** Search by name, accents and case aside. */
export function search(members: WatchMember[], q: string): WatchMember[] {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return members
    .filter((m) => words.every((w) => fold(`${m.name} ${m.party} ${m.uf ?? ""}`).includes(w)))
    .slice(0, 8);
}
