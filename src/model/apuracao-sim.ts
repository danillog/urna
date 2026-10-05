/**
 * A made-up count, for trying the apuração tab before (or without) the TSE:
 * open the page with ?view=apuracao&simular=1. Each state counts at its own
 * pace and early results swing before settling, like a real election night.
 * Nothing here is a forecast.
 */

import type { RoundId } from "../types";
import {
  OFFICES,
  UFS,
  projectSeats,
  sumTallies,
  type ApOffice,
  type Apuracao,
  type Candidate,
  type PartyList,
  type Tally,
} from "./apuracao";

/** Seconds from 0% to 100% counted. */
export const SIM_SECONDS = 90;

/** Rough electorates, in thousands, so big states weigh what they should. */
const ELECTORATE: Record<string, number> = {
  SP: 34400, MG: 16300, RJ: 12800, BA: 11300, RS: 8600, PR: 8500, PE: 7000, CE: 6900, PA: 6200,
  SC: 5500, MA: 5000, GO: 4900, PB: 3000, ES: 2900, AM: 2700, PI: 2600, RN: 2500, MT: 2500,
  AL: 2300, DF: 2200, MS: 2000, SE: 1700, RO: 1200, TO: 1100, AC: 600, AP: 550, RR: 370,
}; // prettier-ignore

const NORTHEAST = new Set(["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"]);
const SOUTH_CENTRE = new Set(["PR", "SC", "RS", "MT", "MS", "GO", "DF", "RO", "RR", "AC"]);

type Seed = Pick<Candidate, "number" | "name" | "party">;
const R1: Seed[] = [
  { number: "13", name: "LULA", party: "PT" },
  { number: "22", name: "FLAVIO BOLSONARO", party: "PL" },
  { number: "70", name: "ESCRITOR AUGUSTO CURY", party: "AVANTE" },
  { number: "55", name: "RONALDO CAIADO", party: "PSD" },
  { number: "30", name: "ZEMA", party: "NOVO" },
  { number: "14", name: "RENAN SANTOS", party: "MISSÃO" },
];

/** Deterministic noise in [-1, 1] for a state and a salt. */
function noise(uf: string, salt: number): number {
  let h = salt * 31;
  for (const ch of uf) h = (h * 33 + ch.charCodeAt(0)) % 9973;
  return Math.sin(h);
}

/** Final shares (before noise) of each candidate in a state. */
function weights(uf: string, round: RoundId): number[] {
  const lulaLean = NORTHEAST.has(uf) ? 18 : SOUTH_CENTRE.has(uf) ? -10 : 0;
  if (round === "r2") return [50 + lulaLean / 1.5 + 3 * noise(uf, 1), 50 - lulaLean / 1.5 - 3 * noise(uf, 1)];
  const lula = 42 + lulaLean + 4 * noise(uf, 1);
  const flavio = 40 - lulaLean + 4 * noise(uf, 2);
  return [lula, flavio, 4 + noise(uf, 3), uf === "GO" ? 12 : 3, uf === "MG" ? 8 : 2.5, 1.5];
}

/** Parties the made-up state races are drawn from, so they get real party colors. */
const PARTIES = ["PL", "PT", "MDB", "PSD", "UNIÃO", "PP", "PSB", "REPUBLICANOS", "PSDB", "PDT"];

/** Chamber seats per state; state assemblies follow the constitution's rule from them. */
const FEDERAL_SEATS: Record<string, number> = {
  SP: 70, MG: 53, RJ: 46, BA: 39, RS: 31, PR: 30, PE: 25, CE: 22, MA: 18, GO: 17, PA: 17,
  SC: 16, PB: 12, ES: 10, PI: 10, AL: 9,
}; // prettier-ignore
const federalSeats = (uf: string) => FEDERAL_SEATS[uf] ?? 8;
const stateSeats = (uf: string) => {
  const f = federalSeats(uf);
  return f <= 12 ? 3 * f : 36 + f - 12;
};

/** Candidates and their final shares (before noise) in a state. */
function field(office: ApOffice, uf: string, round: RoundId): { seeds: Seed[]; weights: number[] } {
  if (office === "presidente") {
    const seeds = round === "r2" ? R1.slice(0, 2) : R1;
    return { seeds, weights: weights(uf, round) };
  }
  const offset = Math.abs(Math.round(noise(uf, 21) * 100)) % PARTIES.length;
  const n = round === "r2" ? 2 : office === "senador" ? 5 : 4;
  const seeds = Array.from({ length: n }, (_, i) => {
    const party = PARTIES[(offset + i) % PARTIES.length]!;
    return { number: String(10 + i), name: `CANDIDATO ${"ABCDE"[i]} ${party}`, party };
  });
  const base = round === "r2" ? [52, 48] : [36, 30, 16, 10, 8];
  return { seeds, weights: seeds.map((_, i) => base[i]! + 5 * noise(uf, 30 + i)) };
}

function progress(uf: string, elapsed: number) {
  // Small states and the Northeast finish earlier; SP and MG take the longest.
  const speed = 1.6 - Math.log10(ELECTORATE[uf]!) / 4 + 0.15 * noise(uf, 7);
  const counted = Math.min(100, Math.max(0, ((elapsed / SIM_SECONDS) * 100 * speed - 2) * 1.1));
  const electorate = ELECTORATE[uf]! * 1000;
  const turnout = 79 + 3 * noise(uf, 4);
  const voters = Math.round((electorate * turnout * counted) / 10000);
  const blank = Math.round(voters * 0.02);
  const nulls = Math.round(voters * 0.035);
  return { counted, electorate, turnout, blank, nulls, valid: voters - blank - nulls };
}

function stateTally(office: ApOffice, uf: string, round: RoundId, elapsed: number): Tally {
  const p = progress(uf, elapsed);
  const { seeds, weights: w } = field(office, uf, round);
  // Early urns swing away from the final result, then converge.
  const swing = ((100 - p.counted) / 100) * 6 * noise(uf, Math.floor(elapsed / 6) + 11);
  const raw = w.map((x, i) => Math.max(0.2, x + (i === 0 ? swing : i === 1 ? -swing : 0)));
  const total = raw.reduce((a, b) => a + b, 0);
  const candidates = seeds.map((s, i) => {
    const votes = Math.round((p.valid * raw[i]!) / total);
    return { ...s, votes, share: p.valid ? (votes / p.valid) * 100 : 0, status: "" };
  });
  candidates.sort((a, b) => b.votes - a.votes);
  const seats = office === "senador" ? 2 : 1;
  return { ...p, totalizedAt: null, seats, candidates, lists: [] };
}

/** A made-up deputies' race: ten lists of eight candidates. */
function proportionalTally(office: ApOffice, uf: string, elapsed: number): Tally {
  const p = progress(uf, elapsed);
  const seats = office === "deputado-federal" ? federalSeats(uf) : stateSeats(uf);
  const shares = PARTIES.map((_, i) => Math.max(1, 22 / (1 + i * 0.45) + 3 * noise(uf, 40 + i)));
  const total = shares.reduce((a, b) => a + b, 0);
  const candidates: Candidate[] = [];
  const lists: PartyList[] = PARTIES.map((party, i) => {
    const votes = Math.round((p.valid * shares[i]!) / total);
    const key = String(i + 1);
    // Within a list, a few names pull most of the votes; 15% go to the party label.
    let nominal = votes * 0.85;
    for (let k = 0; k < 8; k++) {
      const v = Math.round(nominal * 0.35);
      nominal -= v;
      candidates.push({
        number: `${10 + i}${String(k + 1).padStart(3, "0")}`,
        name: `CANDIDATO ${k + 1} ${party}`,
        party,
        votes: v,
        share: p.valid ? (v / p.valid) * 100 : 0,
        status: "",
        list: key,
      });
    }
    return { key, name: party, votes, share: p.valid ? (votes / p.valid) * 100 : 0, seats: 0, projected: 0 };
  });
  candidates.sort((a, b) => b.votes - a.votes);
  projectSeats(lists, candidates, seats, p.valid);
  return { ...p, totalizedAt: null, seats, candidates, lists };
}

/** The simulated count `elapsed` seconds after it started. Proportional races need a state. */
export function simulate(
  office: ApOffice,
  round: RoundId,
  elapsed: number,
  state: string | null = null,
  now = new Date(),
): Apuracao {
  const proportional = OFFICES[office].proportional;
  const places = proportional ? [state ?? "SP"] : [...UFS];
  const uf = Object.fromEntries(
    places.map((u) => [
      u,
      proportional ? proportionalTally(office, u, elapsed) : stateTally(office, u, round, elapsed),
    ]),
  );
  const time = now.toLocaleTimeString("pt-BR", { hour12: false });
  const date = now.toLocaleDateString("pt-BR");
  let br = proportional ? uf[places[0]!]! : sumTallies(Object.values(uf));
  if (!proportional && office !== "presidente") br = { ...br, candidates: [] };
  for (const t of [br, ...Object.values(uf)]) if (t.valid) t.totalizedAt = `${date} ${time}`;
  return { office, round, fetchedAt: now.toISOString(), br, uf };
}
