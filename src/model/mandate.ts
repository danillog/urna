/**
 * What the elected who sit in Congress now did in this term (since February 2023).
 * Data from pipeline/mandate.py: Câmara and Senado open data.
 */

export interface Allowance {
  total: number;
  /** Months with any reimbursement, and the average over them. */
  months: number;
  perMonth: number;
  categories: { name: string; value: number }[];
}

export interface MandateEntry {
  house: "camara" | "senado";
  id: string;
  /** Roll calls voted out of those held (Chamber: from `from`, their first vote). */
  votes: { cast: number; held: number; from?: string; justified?: number } | null;
  /** Contested roll calls where they voted as the government's leader asked. */
  government: { with: number; of: number } | null;
  /** Bills (PL, PLP, PEC) as first author; passed by their house; became law. */
  bills: { first: number; passed: number; law: number };
  allowance: Allowance | null;
  /** Committees they sit on now (role: Titular, Suplente, Presidente…), matters they were made
   * rapporteur of this term, and speeches since 2023 (null: the source failed). */
  activity?: { committees: { name: string; role: string }[]; rapporteur: number; speeches: number | null };
}

import type { IdeologyData } from "./ideology";

/** Every plenary roll call of the term on a PEC or a PLP, and each member's vote in it. */
export interface KeyVotes {
  rolls: { date: string; bill: string; summary: string; what: string; government: "S" | "N" | null }[];
  /** Member id → one letter per roll call: S yes, N no, O obstruction, A abstention, V secret, - absent. */
  votes: Record<string, string>;
}

export interface MandateData {
  keyVotes?: { chamber: KeyVotes; senate: KeyVotes };
  /** Positions by vote (pipeline/ideology.py), joined in when the page loads them together. */
  ideology?: IdeologyData;
  since: string;
  until: string | null;
  allowanceMedianByState: Record<string, number>;
  senateAllowanceMedian: number | null;
  uf: Record<string, string>;
  people: Record<string, MandateEntry>;
}

export const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

/** The median to set a person's monthly allowance against: their state's, or the Senate's. */
export function allowanceMedian(data: MandateData, personId: string): number | null {
  const e = data.people[personId];
  if (!e) return null;
  return e.house === "senado"
    ? data.senateAllowanceMedian
    : (data.allowanceMedianByState[data.uf[personId]!] ?? null);
}
