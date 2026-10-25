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
  thresholds: { base: number; opposition: number; centrao?: number };
  /** Party line (as in congress.json) → term → share of votes with the government. */
  parties: Record<string, Record<string, { share: number; votes: number }>>;
  /** The same in the Senate, where the API has the leaders' orientations from `senateSince`. */
  senate?: Record<string, Record<string, { share: number; votes: number }>>;
  senateSince?: string;
}

export type GovHouse = "chamber" | "senate";

export type Stance = "base" | "independent" | "opposition";

export function stance(share: number, t: GovernismoData["thresholds"]): Stance {
  return share >= t.base ? "base" : share <= t.opposition ? "opposition" : "independent";
}

/** A party's stance in every term it has data for, in order. */
export function stances(
  data: GovernismoData,
  lineage: string,
  house: GovHouse = "chamber",
): { term: Term; share: number; votes: number; stance: Stance }[] {
  const mine = (house === "senate" ? data.senate?.[lineage] : data.parties[lineage]) ?? {};
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

/** The presidential term that began after an election (2022 → Lula 3); none for the last one. */
export function termAfter(data: GovernismoData, electionYear: number): Term | null {
  return data.terms.find((t) => Number(t.from.slice(0, 4)) === electionYear + 1) ?? null;
}

/** Party lines whose votes made them the base of the term that followed an election. */
export function measuredBase(
  data: GovernismoData,
  electionYear: number,
  house: GovHouse,
): { term: Term; lineages: Set<string> } | null {
  const term = termAfter(data, electionYear);
  if (!term) return null;
  const parties = house === "senate" ? data.senate : data.parties;
  const lineages = new Set(
    Object.entries(parties ?? {})
      .filter(([, terms]) => terms[term.key] && stance(terms[term.key]!.share, data.thresholds) === "base")
      .map(([lineage]) => lineage),
  );
  return lineages.size ? { term, lineages } : null;
}

/**
 * The Centrão as measured: party lines with the government at `thresholds.centrao` (80%) or
 * more under at least one PT president and at least one from another party.
 */
export function measuredCentrao(data: GovernismoData, house: GovHouse = "chamber"): Set<string> {
  const cut = data.thresholds.centrao ?? 80;
  const parties = house === "senate" ? data.senate : data.parties;
  const out = new Set<string>();
  for (const [lineage, terms] of Object.entries(parties ?? {})) {
    const high = data.terms.filter((t) => (terms[t.key]?.share ?? 0) >= cut);
    if (high.some((t) => t.party === "PT") && high.some((t) => t.party !== "PT")) out.add(lineage);
  }
  return out;
}
