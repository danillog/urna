import type { MunicipalRace } from "../types";

/**
 * Margin of victory (points) where each shade starts. The fill gets stronger
 * as the winner pulls further ahead of the runner-up.
 */
export const MARGIN_STEPS = [0, 5, 15, 30] as const;

/** Winner's lead over the runner-up, in percentage points. */
export function margin(race: MunicipalRace, i: number): number {
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

/** Municipalities won by each candidate, most wins first. */
export function winsByCandidate(race: MunicipalRace): { candidate: string; wins: number }[] {
  const counts = race.candidates.map(() => 0);
  for (const w of race.winner) if (w >= 0) counts[w]! += 1;
  return race.candidates
    .map((candidate, i) => ({ candidate, wins: counts[i]! }))
    .filter((c) => c.wins > 0)
    .sort((a, b) => b.wins - a.wins);
}
