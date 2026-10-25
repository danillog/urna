/**
 * Where each member of Congress sits by their votes in the term in office (pipeline/ideology.py):
 * the first principal component of the contested roll calls, −1 to +1 within each house.
 */

export interface IdeologyMember {
  name: string;
  party: string;
  uf: string;
  /** −1 the furthest left of the house, +1 the furthest right. */
  score: number;
}

export interface IdeologyHouse {
  /** Correlation of party means with Zucco & Power's scores, and how many parties. */
  validation: { r: number | null; parties: number };
  /** Member id (Câmara or Senate code) → position. */
  members: Record<string, IdeologyMember>;
}

export interface IdeologyData {
  since: string;
  minVotes: number;
  minMinority: number;
  chamber?: IdeologyHouse;
  senate?: IdeologyHouse;
}

/** Percent of the house to the member's left. */
export function rightOf(house: IdeologyHouse, score: number): number {
  const all = Object.values(house.members);
  return (all.filter((m) => m.score < score).length / all.length) * 100;
}

/** Parties with their members' positions, left to right by the party's mean. */
export function byParty(
  house: IdeologyHouse,
  minMembers = 1,
): { party: string; mean: number; members: IdeologyMember[] }[] {
  const groups = new Map<string, IdeologyMember[]>();
  for (const m of Object.values(house.members)) {
    const list = groups.get(m.party) ?? [];
    list.push(m);
    groups.set(m.party, list);
  }
  return [...groups]
    .filter(([, ms]) => ms.length >= minMembers)
    .map(([party, members]) => ({
      party,
      mean: members.reduce((s, m) => s + m.score, 0) / members.length,
      members,
    }))
    .sort((a, b) => a.mean - b.mean);
}

export const houseOf = (h: "camara" | "senado"): "chamber" | "senate" =>
  h === "camara" ? "chamber" : "senate";
