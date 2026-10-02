import type { ColorName, EncodedMapRace, MunicipalMap, RoundId } from "../types";

/** Elections, or the municipal HDI of the censuses (not an election, same map). */
export type MapOffice = "president" | "mayor" | "idhm";

/** Index value meaning "no result in this municipality". */
export const NONE = 255;
export const OTHERS = "others";

/**
 * Margin of victory (points) where each shade starts, for the presidential map.
 * The fill gets stronger as the winner pulls further ahead of the runner-up.
 */
export const MARGIN_STEPS = [0, 5, 15, 30] as const;

/** A decoded race, ready to draw. */
export interface MapRace {
  key: string;
  office: MapOffice;
  year: number;
  round: RoundId | null;
  labels: string[];
  /** Color group per label: the candidate (president) or the party lineage (mayor). */
  groups: string[];
  groupColors: Record<string, ColorName>;
  winner: Uint8Array;
  winnerShare: Uint16Array;
  second: Uint8Array;
  secondShare: Uint16Array;
  votes: Uint32Array;
  mayors: string[] | null;
}

function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseKey(key: string): { office: MapOffice; year: number; round: RoundId | null } {
  const [office, year, round] = key.split("-");
  return { office: office as MapOffice, year: Number(year), round: (round as RoundId | undefined) ?? null };
}

export function decodeRace(map: MunicipalMap, key: string, encoded: EncodedMapRace): MapRace {
  const { office, year, round } = parseKey(key);
  const groups =
    office === "mayor" ? (encoded.lineages ?? encoded.labels.map(() => OTHERS)) : [...encoded.labels];
  const groupColors: Record<string, ColorName> =
    office === "mayor"
      ? {
          ...Object.fromEntries(Object.entries(map.lineages).map(([k, v]) => [k, v.color])),
          [OTHERS]: "gray",
        }
      : { ...encoded.colors };
  return {
    key,
    office,
    year,
    round,
    labels: encoded.labels,
    groups,
    groupColors,
    winner: bytes(encoded.winner),
    winnerShare: new Uint16Array(bytes(encoded.winnerShare).buffer),
    second: bytes(encoded.second),
    secondShare: new Uint16Array(bytes(encoded.secondShare).buffer),
    votes: new Uint32Array(bytes(encoded.votes).buffer),
    mayors: encoded.mayors?.split("\n") ?? null,
  };
}

/** Lazily decodes races; each is decoded once. */
export class MapData {
  private cache = new Map<string, MapRace>();

  constructor(readonly map: MunicipalMap) {}

  keys(office: MapOffice): string[] {
    return Object.keys(this.map.races)
      .filter((k) => parseKey(k).office === office)
      .sort();
  }

  years(office: MapOffice): number[] {
    if (office === "idhm")
      return Object.keys(this.map.idhm ?? {})
        .map(Number)
        .sort();
    return [...new Set(this.keys(office).map((k) => parseKey(k).year))];
  }

  /** Whether a year's IDHM is our own estimate rather than the Atlas's figure. */
  idhmIsEstimate(year: number): boolean {
    return this.map.idhmEstimate?.years.includes(year) ?? false;
  }

  /** Municipal HDI in a census year, in thousandths (0 = no data). */
  idhm(year: number): Uint16Array {
    return new Uint16Array(bytes(this.map.idhm![String(year)]!).buffer);
  }

  rounds(year: number): RoundId[] {
    return this.keys("president")
      .map(parseKey)
      .filter((k) => k.year === year)
      .map((k) => k.round!);
  }

  race(key: string): MapRace | undefined {
    const encoded = this.map.races[key];
    if (!encoded) return undefined;
    let race = this.cache.get(key);
    if (!race) {
      race = decodeRace(this.map, key, encoded);
      this.cache.set(key, race);
    }
    return race;
  }
}

export function raceKey(office: MapOffice, year: number, round: RoundId): string {
  return office === "president" ? `president-${year}-${round}` : `${office}-${year}`;
}

/** Winner's lead over the runner-up, in percentage points. */
export function margin(race: MapRace, i: number): number {
  return (race.winnerShare[i]! - race.secondShare[i]!) / 10;
}

/** 0 for a close race up to MARGIN_STEPS.length - 1 for a landslide. */
export function shade(marginPoints: number): number {
  let step = 0;
  MARGIN_STEPS.forEach((start, i) => {
    if (marginPoints >= start) step = i;
  });
  return step;
}

export interface GroupWins {
  group: string;
  /** What the legend shows: the candidate, or the acronyms used that year ("PFL", "DEM"). */
  label: string;
  wins: number;
}

/** Municipalities won per color group, most wins first; "others" always last. */
export function winsByGroup(race: MapRace): GroupWins[] {
  const wins = new Map<string, number>();
  const labels = new Map<string, Set<string>>();
  for (const w of race.winner) {
    if (w === NONE) continue;
    const group = race.groups[w]!;
    wins.set(group, (wins.get(group) ?? 0) + 1);
    if (!labels.has(group)) labels.set(group, new Set());
    labels.get(group)!.add(race.labels[w]!);
  }
  return [...wins]
    .map(([group, n]) => ({ group, label: [...labels.get(group)!].join("/"), wins: n }))
    .sort((a, b) => Number(a.group === OTHERS) - Number(b.group === OTHERS) || b.wins - a.wins);
}
