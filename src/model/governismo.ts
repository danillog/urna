/**
 * How often each party voted with the government in the Chamber, per presidential term.
 * Data from pipeline/governismo.py: contested plenary votes only, party orientation
 * against the government's.
 */

export interface Term {
  key: string;
  label: string;
  /** The president's party: "PT", "MDB", "PL". */
  party: string;
  from: string;
  to: string;
}

export interface GovernismoData {
  terms: Term[];
  /** Our reading: from `base` up, the government's base; up to `opposition`, the opposition. */
  thresholds: { base: number; opposition: number };
  /** Party line (as in congress.json) → term → share of votes with the government. */
  parties: Record<string, Record<string, { share: number; votes: number }>>;
}

export type Stance = "base" | "independent" | "opposition";

export function stance(share: number, t: GovernismoData["thresholds"]): Stance {
  return share >= t.base ? "base" : share <= t.opposition ? "opposition" : "independent";
}

/** A party's stance in every term it has data for, in order. */
export function stances(
  data: GovernismoData,
  lineage: string,
): { term: Term; share: number; votes: number; stance: Stance }[] {
  const mine = data.parties[lineage] ?? {};
  return data.terms.flatMap((term) => {
    const x = mine[term.key];
    return x ? [{ term, share: x.share, votes: x.votes, stance: stance(x.share, data.thresholds) }] : [];
  });
}

/**
 * One line for the whole path: always with the government whoever governed (the Centrão's
 * mark), always against, or with one side and against the other.
 */
export function pattern(
  rows: ReturnType<typeof stances>,
): "always-base" | "always-opposition" | "switches" | "mixed" | null {
  if (rows.length < 2) return null;
  const left = rows.filter((r) => r.term.party === "PT");
  const right = rows.filter((r) => r.term.party !== "PT");
  if (rows.every((r) => r.stance === "base") && left.length && right.length) return "always-base";
  if (rows.every((r) => r.stance === "opposition")) return "always-opposition";
  const side = (rs: typeof rows) =>
    rs.length && rs.every((r) => r.stance === rs[0]!.stance) ? rs[0]!.stance : null;
  const l = side(left);
  const r = side(right);
  if (l && r && l !== r) return "switches";
  return "mixed";
}
