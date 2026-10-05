/**
 * Live vote count: reading the TSE's results files and the summary the
 * apuração Worker serves. No DOM here, so worker/ bundles this same file.
 *
 * The TSE publishes one JSON per place and office at
 *   https://resultados.tse.jus.br/oficial/<ciclo>/<eleição>/dados/<uf>/<place>-c<cargo>-e<eleição>-u.json
 * where place is "br", a state ("sp") or a municipality ("sp71072"). Numbers come
 * as strings, percentages with a decimal comma.
 */

import type { ColorName, RoundId } from "../types";

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const; // prettier-ignore

/** Offices on the apuração tab, by the slug the Worker routes on. */
export const OFFICES = {
  presidente: { code: 1, election: "federal", runoff: true, proportional: false },
  governador: { code: 3, election: "state", runoff: true, proportional: false },
  senador: { code: 5, election: "state", runoff: false, proportional: false },
  "deputado-federal": { code: 6, election: "state", runoff: false, proportional: true },
  // The DF elects district deputies (code 8) instead.
  "deputado-estadual": { code: 7, election: "state", runoff: false, proportional: true },
} as const;
export type ApOffice = keyof typeof OFFICES;
export const isOffice = (s: string): s is ApOffice => s in OFFICES;

/** TSE office code; the DF has district deputies where states have state deputies. */
export const officeCode = (office: ApOffice, uf: string) =>
  office === "deputado-estadual" && uf.toUpperCase() === "DF" ? 8 : OFFICES[office].code;

export interface Candidate {
  /** Ballot number. */
  number: string;
  /** Ballot name as the TSE writes it, upper case. */
  name: string;
  party: string;
  votes: number;
  /** Percent of valid votes. */
  share: number;
  /** "Eleito", "2º turno", "Eleito por QP", "Suplente", "Não eleito", or "" while counting. */
  status: string;
  /** Proportional races: the party list (party or federation) it runs on. */
  list?: string;
  /** Proportional races: holds a seat in our projection of the count so far. */
  projected?: boolean;
}

/** Proportional races: a party, or a federation of parties, running one list. */
export interface PartyList {
  key: string;
  /** "PL", or a federation's parties: "PT/PC do B/PV". */
  name: string;
  /** Nominal plus party-label votes. */
  votes: number;
  share: number;
  /** Seats the TSE gives it; 0 for everyone until the TSE fills them in. */
  seats: number;
  /** Seats by our projection from the votes counted so far. */
  projected: number;
}

/** The count for one place. */
export interface Tally {
  /** Percent of polling stations counted. */
  counted: number;
  /** Last totalization, "dd/mm/aaaa hh:mm:ss" in Brasília time; null before the count starts. */
  totalizedAt: string | null;
  electorate: number;
  /** Percent of the electorate that voted, among stations counted. */
  turnout: number;
  valid: number;
  blank: number;
  /** Null votes, including those for annulled candidates. */
  nulls: number;
  /** Seats in dispute: 1 (president, governor), 2 (Senate in 2026), or a delegation. */
  seats: number;
  /** Most votes first. Proportional races only carry the top ones. */
  candidates: Candidate[];
  /** Proportional races: party lists, most votes first. Empty otherwise. */
  lists: PartyList[];
}

/**
 * What the Worker serves for one office and round. `br` drives the progress
 * bar: the national file for president, the states added up for governor and
 * Senate (with no candidates: they differ by state), and the one state asked
 * for in proportional races.
 */
export interface Apuracao {
  office: ApOffice;
  round: RoundId;
  /** When the Worker read the TSE files (ISO). */
  fetchedAt: string;
  br: Tally;
  uf: Partial<Record<string, Tally>>;
}

/** "45,12" or "45" → 45.12; anything unreadable → 0. */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !v) return 0;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Reads one TSE results file (the "-u.json" format used since 2024). */
// `any`: raw TSE JSON, read field by field with defaults.
export function parseTse(json: any): Tally {
  const s = json.s ?? {};
  const e = json.e ?? {};
  const v = json.v ?? {};
  const valid = num(v.vv);
  const office = json.carg?.[0] ?? {};
  const seats = num(office.nv) || 1;
  const proportional = [6, 7, 8, 13].includes(num(office.cd));
  const candidates: Candidate[] = [];
  const lists: PartyList[] = [];
  for (const group of office.agr ?? []) {
    const key = String(group.n ?? "");
    let listVotes = 0;
    for (const party of group.par ?? []) {
      listVotes += num(party.tvtn) + num(party.tvtl);
      for (const c of party.cand ?? []) {
        const votes = num(c.vap);
        candidates.push({
          number: String(c.n ?? ""),
          name: String(c.nmu ?? c.nm ?? ""),
          party: String(party.sg ?? ""),
          votes,
          share: valid ? (votes / valid) * 100 : num(c.pvap),
          status: String(c.st ?? ""),
          ...(proportional ? { list: key } : {}),
        });
      }
    }
    if (proportional)
      lists.push({
        key,
        name: String(group.com || group.par?.[0]?.sg || group.nm || key),
        votes: listVotes,
        share: valid ? (listVotes / valid) * 100 : 0,
        seats: num(group.vag),
        projected: 0,
      });
  }
  candidates.sort((a, b) => b.votes - a.votes || Number(a.number) - Number(b.number));
  lists.sort((a, b) => b.votes - a.votes);
  if (proportional) projectSeats(lists, candidates, seats, valid);
  return {
    counted: num(s.pst),
    totalizedAt: json.dt && json.ht ? `${json.dt} ${json.ht}` : null,
    electorate: num(e.te),
    turnout: num(e.pc),
    valid,
    blank: num(v.vb),
    nulls: num(v.tvn) + num(v.van),
    seats,
    candidates,
    lists,
  };
}

/**
 * Who would hold the seats if the count stopped now (Código Eleitoral, arts.
 * 106–109, as amended in 2021 and read by the STF in 2024):
 *  1. Electoral quotient QE = valid votes / seats, rounded. Each list gets
 *     votes / QE seats, filled by its candidates with at least 10% of QE.
 *  2. Leftover seats, one at a time, to the highest votes / (seats + 1)
 *     among lists with 80% of QE, for a candidate with 20% of QE.
 *  3. Seats still left: highest average among all lists, any candidate.
 * Marks the lists' `projected` and the candidates' `projected`. Candidates
 * must be in vote order. A projection, not the TSE's result.
 */
export function projectSeats(
  lists: PartyList[],
  candidates: Candidate[],
  seats: number,
  valid: number,
): void {
  if (!valid) return;
  const qe = Math.round(valid / seats);
  const byList = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (!c.list) continue;
    if (!byList.has(c.list)) byList.set(c.list, []);
    byList.get(c.list)!.push(c);
  }
  const won = new Map(lists.map((l) => [l.key, 0]));
  const take = (list: PartyList, minVotes: number): boolean => {
    const next = (byList.get(list.key) ?? []).find((c) => !c.projected && c.votes >= minVotes && c.votes > 0);
    if (!next) return false;
    next.projected = true;
    won.set(list.key, won.get(list.key)! + 1);
    return true;
  };
  let left = seats;
  for (const list of lists) {
    const quota = Math.floor(list.votes / qe);
    for (let i = 0; i < quota && left > 0 && take(list, 0.1 * qe); i++) left--;
  }
  const average = (l: PartyList) => l.votes / (won.get(l.key)! + 1);
  const leftovers = (eligible: PartyList[], minVotes: number) => {
    const open = new Set(eligible);
    while (left > 0 && open.size) {
      const best = [...open].reduce((a, b) => (average(b) > average(a) ? b : a));
      if (take(best, minVotes)) left--;
      else open.delete(best); // no candidate left who qualifies
    }
  };
  leftovers(
    lists.filter((l) => l.votes >= 0.8 * qe),
    0.2 * qe,
  );
  leftovers(lists, 0);
  for (const l of lists) l.projected = won.get(l.key)!;
}

/** Seats per list: the TSE's once it publishes them, our projection until then. */
export const seatsOf = (t: Tally) => {
  const official = t.lists.some((l) => l.seats > 0);
  return { official, seats: (l: PartyList) => (official ? l.seats : l.projected) };
};

/** Whether a proportional candidate holds a seat: the TSE's word, or our projection. */
export const holdsSeat = (t: Tally, c: Candidate) =>
  seatsOf(t).official ? /^Eleito/.test(c.status) : Boolean(c.projected);

/** Keeps the top candidates of a big proportional race: everyone in a seat, and a few more. */
export function trimCandidates(t: Tally, extra = 10): Tally {
  const keep = t.candidates.filter((c, i) => i < t.seats + extra || holdsSeat(t, c));
  return { ...t, candidates: keep };
}

/**
 * Adds tallies up: the Worker's test mode has no national file, only places.
 * Shares are recomputed; `counted` is weighted by electorate.
 */
export function sumTallies(tallies: Tally[]): Tally {
  const byKey = new Map<string, Candidate>();
  let electorate = 0;
  let countedWeight = 0;
  let voters = 0;
  let valid = 0;
  let blank = 0;
  let nulls = 0;
  let totalizedAt: string | null = null;
  for (const t of tallies) {
    electorate += t.electorate;
    countedWeight += t.counted * t.electorate;
    voters += (t.turnout / 100) * t.electorate * (t.counted / 100);
    valid += t.valid;
    blank += t.blank;
    nulls += t.nulls;
    if (t.totalizedAt && (!totalizedAt || sortableTime(t.totalizedAt) > sortableTime(totalizedAt)))
      totalizedAt = t.totalizedAt;
    for (const c of t.candidates) {
      const key = `${c.party}/${c.name}`;
      const prev = byKey.get(key);
      byKey.set(key, prev ? { ...prev, votes: prev.votes + c.votes } : { ...c });
    }
  }
  const countedElectorate = countedWeight / 100;
  const candidates = [...byKey.values()]
    .map((c) => ({ ...c, share: valid ? (c.votes / valid) * 100 : 0 }))
    .sort((a, b) => b.votes - a.votes);
  return {
    counted: electorate ? countedWeight / electorate : 0,
    totalizedAt,
    electorate,
    turnout: countedElectorate ? (voters / countedElectorate) * 100 : 0,
    valid,
    blank,
    nulls,
    seats: Math.max(1, ...tallies.map((t) => t.seats)),
    candidates,
    lists: [],
  };
}

/** "04/10/2026 18:32:10" → "2026-10-04 18:32:10", which sorts as text. */
function sortableTime(br: string): string {
  const [date = "", time = ""] = br.split(" ");
  return `${date.split("/").reverse().join("-")} ${time}`;
}

/** Whether any vote has been counted yet. */
export const started = (t: Tally) => t.counted > 0 || t.valid > 0;

/** Leader and the gap to the runner-up in points; null before the first votes. */
export function lead(t: Tally): { leader: Candidate; margin: number } | null {
  const [first, second] = t.candidates;
  if (!first || !first.votes) return null;
  return { leader: first, margin: first.share - (second?.share ?? 0) };
}

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();

/** Colors handed out to candidates the polls do not track, in ballot-number order. */
const SPARE: ColorName[] = ["teal", "orange", "violet", "green", "sky", "pink", "brown", "cyan"];

/**
 * A color per party. Candidates the poll charts already have (say "Flávio" →
 * blue) keep that color, matched by a word of the ballot name; the other
 * parties get spare colors in ballot-number order, so they never change
 * between updates. Keyed by party rather than ballot number: in a presidential
 * race each party has one candidate, and in the 2024 test data the same number
 * (the party's) runs in every capital.
 */
export function candidateColors(
  candidates: Candidate[],
  known: Record<string, ColorName>,
): Record<string, ColorName> {
  const out: Record<string, ColorName> = {};
  const taken = new Set<ColorName>();
  const knownEntries = Object.entries(known).map(([series, color]) => [strip(series), color] as const);
  for (const c of candidates) {
    const words = strip(c.name).split(/\s+/);
    const match = knownEntries.find(([series]) => words.includes(series));
    if (match && !(c.party in out)) {
      out[c.party] = match[1];
      taken.add(match[1]);
    }
  }
  const spare = SPARE.filter((c) => !taken.has(c));
  let next = 0;
  [...candidates]
    .sort((a, b) => Number(a.number) - Number(b.number))
    .forEach((c) => {
      if (!(c.party in out)) out[c.party] = spare[next++] ?? "gray";
    });
  return out;
}

/**
 * A party's color on the mayor map (data/parties.yaml), for offices that vary
 * by state; a federation ("PT/PC do B/PV") takes its first listed party's.
 */
export function partyColor(party: string, lineages: Record<string, { color: ColorName }>): ColorName {
  for (const p of party.split("/")) {
    const color = lineages[p.trim().toUpperCase()]?.color;
    if (color) return color;
  }
  return "gray";
}

const LOWER = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);

/** "ESCRITOR AUGUSTO CURY" → "Escritor Augusto Cury"; "PC DO B" keeps its acronyms out of it. */
export function displayName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && LOWER.has(w.toUpperCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
