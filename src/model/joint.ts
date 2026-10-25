/**
 * Everything in at once: a weighted linear fit of a candidate's share in each municipality
 * on income, religion, schooling and region together. Shown next to each variable alone,
 * it says how much of a pattern is that variable and how much comes with the others (the
 * Northeast is poorer and less Evangelical, for one).
 *
 * Still about places, not people (the ecological fallacy), and an association, not a cause.
 */

import { REGION_OF, valueAt, voteAt, type CensusVote, type Election } from "./census-vote";

export type JointTerm = "income" | "evangelical" | "noReligion" | "degree";
export const JOINT_TERMS: JointTerm[] = ["income", "evangelical", "noReligion", "degree"];
/** Regions against the Southeast. */
export const JOINT_REGIONS = ["N", "NE", "CO", "S"] as const;

/** Each term's unit: a doubling of income, 10 points of a share. */
const scaled = (term: JointTerm, x: number) => (term === "income" ? Math.log2(x) : x / 10);

export interface JointFit {
  /** Change in the candidate's share, in points, per unit: alone and with the rest held. */
  terms: { term: JointTerm; alone: number; joint: number }[];
  /** Points against the Southeast, with the rest held. */
  regions: { region: (typeof JOINT_REGIONS)[number]; joint: number }[];
  /** Share of the variation (weighted) the joint fit accounts for. */
  r2: number;
  places: number;
}

/** Solves A·x = b (A square, symmetric positive definite in practice) by Gaussian elimination. */
export function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    if (Math.abs(m[pivot]![c]!) < 1e-12) return null;
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Weighted least squares: coefficients (intercept first) and the weighted R². */
export function wls(rows: { x: number[]; y: number; w: number }[]): { beta: number[]; r2: number } | null {
  if (!rows.length) return null;
  const k = rows[0]!.x.length + 1;
  const xtx = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (const { x, y, w } of rows) {
    const v = [1, ...x];
    for (let i = 0; i < k; i++) {
      xty[i]! += w * v[i]! * y;
      for (let j = 0; j < k; j++) xtx[i]![j]! += w * v[i]! * v[j]!;
    }
  }
  const beta = solve(xtx, xty);
  if (!beta) return null;
  const wsum = rows.reduce((s, r) => s + r.w, 0);
  const mean = rows.reduce((s, r) => s + r.w * r.y, 0) / wsum;
  let ssr = 0;
  let sst = 0;
  for (const { x, y, w } of rows) {
    const fit = beta[0]! + x.reduce((s, xi, i) => s + beta[i + 1]! * xi, 0);
    ssr += w * (y - fit) ** 2;
    sst += w * (y - mean) ** 2;
  }
  return { beta, r2: sst ? 1 - ssr / sst : 0 };
}

/** The joint fit for one election, over every municipality with all the data. */
export function jointFit(
  data: CensusVote,
  e: Election,
  side: "pt" | "rival",
  ufOf: (i: number) => string,
): JointFit | null {
  const rows: { x: number[]; y: number; w: number; terms: number[] }[] = [];
  for (let i = 0; i < e.valid.length; i++) {
    const y = voteAt(e, side, i);
    const w = e.valid[i]!;
    if (y === null || !w) continue;
    const values = JOINT_TERMS.map((term) => valueAt(data, e.census, term, i));
    // Every term known, and an income above zero (it enters as a logarithm).
    if (values.some((v) => v === null) || values[0]! <= 0) continue;
    const terms = JOINT_TERMS.map((term, k) => scaled(term, values[k]!));
    const region = REGION_OF[ufOf(i)];
    if (!region) continue;
    const dummies = JOINT_REGIONS.map((r) => (r === region ? 1 : 0));
    rows.push({ x: [...terms, ...dummies], y, w, terms });
  }
  const joint = wls(rows);
  if (!joint) return null;
  const alone = JOINT_TERMS.map((_, k) => wls(rows.map((r) => ({ x: [r.terms[k]!], y: r.y, w: r.w }))));
  return {
    terms: JOINT_TERMS.map((term, k) => ({
      term,
      alone: alone[k]?.beta[1] ?? NaN,
      joint: joint.beta[k + 1]!,
    })),
    regions: JOINT_REGIONS.map((region, k) => ({ region, joint: joint.beta[JOINT_TERMS.length + k + 1]! })),
    r2: joint.r2,
    places: rows.length,
  };
}
