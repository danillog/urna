import { defaultState, methodOf, raceFor, type AppState } from "../state";
import { UNDECIDED, type Dataset, type Poll, type Race, type RoundId } from "../types";
import { bandwidth, smoothSeries, type TrendPoint } from "./smoothing";

/** Days shown before the first poll when a filter leaves nothing to show. */
const EMPTY_SPAN_DAYS = 30;
/** A trend ending this close to the last day counts as reaching it. */
export const REACHES_END_DAYS = 3;

/** Everything the page renders for the current selection. */
export interface View {
  race: Race;
  polls: Poll[];
  trends: Record<string, TrendPoint[]>;
  /** Series with a trend, top of the latest average first, undecided last. */
  order: string[];
  firstDay: number;
  /** Exclusive end of the x axis: election day, or the day after the last poll. */
  endDay: number;
  /** First day the chart shows when zoomed in (see AppState.zoomDays); null: from the first poll. */
  zoomFrom: number | null;
  /** First day of a fit of its own (a runoff's campaign after the 1st round): lines break there. */
  breakDay: number | null;
  hasResult: boolean;
}

export function filterPolls(data: Dataset, race: Race, s: AppState): Poll[] {
  return race.polls.filter(
    (p) => !s.excludedPollsters.has(p.p) && !s.excludedMethods.has(methodOf(data, p.p)),
  );
}

export function buildView(data: Dataset, race: Race, s: AppState): View {
  const polls = filterPolls(data, race, s);
  const hasResult = race.result !== null;
  const lastPoll = (ps: Poll[]) => Math.max(...ps.map((p) => p.d)) + 1;
  const endDay = hasResult ? race.electionDay : lastPoll(polls.length ? polls : race.polls);
  const firstDay = polls.length ? Math.min(...polls.map((p) => p.d)) : endDay - EMPTY_SPAN_DAYS;

  const parts = segments(data, s, firstDay, endDay);
  const byPollster = s.weighByRecord ? recordWeights(data, race) : undefined;
  const trends: Record<string, TrendPoint[]> = {};
  for (const [from, to] of parts) {
    const inside = polls.filter((p) => p.d >= from && p.d < to);
    if (!inside.length) continue;
    const start = Math.min(...inside.map((p) => p.d));
    const bw = bandwidth(to - start, s.office === "president");
    const grid = Array.from({ length: to - from }, (_, i) => from + i);
    for (const series of race.series) {
      const trend = smoothSeries(inside, series, grid, bw, byPollster);
      if (trend) trends[series] = [...(trends[series] ?? []), ...trend];
    }
  }
  const breakDay = parts.length > 1 ? parts[1]![0] : null;
  const zoomFrom = zoomStart(race, s.zoomDays);
  const order = orderSeries(trends);
  return { race, polls, trends, order, firstDay, endDay, zoomFrom, breakDay, hasResult };
}

/**
 * First day shown when the chart is zoomed to the last `days` days, or null when the race
 * (every poll, whatever the filters) is not longer than that.
 */
export function zoomStart(race: Race, days: number | null): number | null {
  if (!days || !race.polls.length) return null;
  const end = race.result !== null ? race.electionDay : Math.max(...race.polls.map((p) => p.d)) + 1;
  const first = Math.min(...race.polls.map((p) => p.d));
  return end - first > days ? end - days : null;
}

/**
 * Day ranges [from, to) fitted on their own. A runoff splits at the 1st round:
 * the hypothetical runoff polls of the months before and the campaign after it
 * are different races, and one line through both bends at the jump and keeps
 * that slope to the last day.
 */
function segments(data: Dataset, s: AppState, firstDay: number, endDay: number): [number, number][] {
  const first = s.round === "r2" ? raceFor(data, { ...s, round: "r1" }) : undefined;
  const split = first?.electionDay;
  if (split == null || split <= firstDay || split >= endDay) return [[firstDay, endDay]];
  // Polls whose fieldwork ended on the 1st round's day were taken before its result.
  return [
    [firstDay, split + 1],
    [split + 1, endDay],
  ];
}

export function orderSeries(trends: Record<string, TrendPoint[]>): string[] {
  const latest = (s: string) => trends[s]!.at(-1)!.y;
  return Object.keys(trends).sort((a, b) => {
    if (a === UNDECIDED) return 1;
    if (b === UNDECIDED) return -1;
    return latest(b) - latest(a);
  });
}

/** Latest point of a trend, if the line runs (almost) to the end of the chart. */
export function finalPoint(view: View, series: string): TrendPoint | null {
  const last = view.trends[series]?.at(-1);
  return last && last.d >= view.endDay - REACHES_END_DAYS ? last : null;
}

export interface TrackRecord {
  pollster: string;
  /** Number of past rounds with a final poll. */
  rounds: number;
  meanError: number | null;
  marginError: number | null;
}

/** Average error of each pollster's final poll over every past presidential round. */
export function trackRecord(data: Dataset, pollsters: Iterable<string>): TrackRecord[] {
  const history = new Map<string, { meanError: number; marginError: number }[]>();
  for (const election of Object.values(data.presidential)) {
    for (const race of Object.values(election.rounds)) {
      for (const a of race.accuracy) {
        const rows = history.get(a.p) ?? [];
        rows.push(a);
        history.set(a.p, rows);
      }
    }
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  return [...pollsters]
    .map((pollster) => {
      const rows = history.get(pollster) ?? [];
      return {
        pollster,
        rounds: rows.length,
        meanError: mean(rows.map((r) => r.meanError)),
        marginError: mean(rows.map((r) => r.marginError)),
      };
    })
    .sort(
      (a, b) =>
        Number(a.meanError === null) - Number(b.meanError === null) ||
        (a.meanError ?? 0) - (b.meanError ?? 0) ||
        a.pollster.localeCompare(b.pollster),
    );
}

/** Past rounds a pollster with no record counts as, at the average error of everyone. */
const RECORD_PRIOR_ROUNDS = 2;
/** Bounds of the record's multiplier: a good record doubles a poll's weight at most. */
const RECORD_MIN_WEIGHT = 0.5;
const RECORD_MAX_WEIGHT = 2;

/**
 * Weight multiplier of each pollster from its margin error in the presidential rounds held
 * before this race (never the race itself or later ones): the average error of every
 * pollster over the pollster's own, after pulling the latter toward the former as if it
 * had RECORD_PRIOR_ROUNDS more rounds at that average. One lucky round moves it little; a
 * pollster with no record gets exactly 1.
 */
export function recordWeights(data: Dataset, race: Race): Map<string, number> {
  const errors = new Map<string, number[]>();
  for (const election of Object.values(data.presidential)) {
    for (const past of Object.values(election.rounds)) {
      if (past.date >= race.date) continue;
      for (const a of past.accuracy) errors.set(a.p, [...(errors.get(a.p) ?? []), a.marginError]);
    }
  }
  const all = [...errors.values()].flat();
  const weights = new Map<string, number>();
  if (!all.length) return weights;
  const prior = all.reduce((sum, e) => sum + e, 0) / all.length;
  for (const [pollster, es] of errors) {
    const shrunk =
      (es.reduce((sum, e) => sum + e, 0) + RECORD_PRIOR_ROUNDS * prior) / (es.length + RECORD_PRIOR_ROUNDS);
    weights.set(pollster, Math.min(RECORD_MAX_WEIGHT, Math.max(RECORD_MIN_WEIGHT, prior / shrunk)));
  }
  return weights;
}

/** The polls' final average for a race, in valid votes, keyed by the candidates' parties. */
export interface FinalAverage {
  year: number;
  /** Day of the year the average stops at (the last poll's, or the eve of the election). */
  day: number;
  byParty: Record<string, number>;
}

/** "Republicanos", "REPUBLICANOS" and "PC do B" match the TSE's spelling of the same party. */
export const partyKey = (party: string) =>
  party.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toUpperCase();

/**
 * Each candidate's final average converted to valid votes, as the comparison table does: as
 * is when the source gives valid votes, else over (100 − undecided); null when the polls
 * carry no undecided column to convert with. Candidates whose line stops early are left out.
 */
export function finalValidShares(view: View): Record<string, number> | null {
  const { race } = view;
  const undecided = finalPoint(view, UNDECIDED);
  if (!race.validVotesOnly && !undecided) return null;
  const shares: Record<string, number> = {};
  for (const series of race.series) {
    const end = finalPoint(view, series);
    if (series === UNDECIDED || !end) continue;
    shares[series] = race.validVotesOnly ? end.y : (end.y / (100 - undecided!.y)) * 100;
  }
  return shares;
}

/** finalValidShares keyed by the candidates' parties; null when no line reaches the end. */
export function finalAverage(data: Dataset, race: Race, s: AppState): FinalAverage | null {
  const view = buildView(data, race, s);
  const shares = finalValidShares(view) ?? {};
  const byParty: Record<string, number> = {};
  for (const [series, share] of Object.entries(shares)) {
    const party = race.parties[series];
    if (party) byParty[partyKey(party)] = share;
  }
  const year = Number(race.date.slice(0, 4));
  return Object.keys(byParty).length ? { year, day: view.endDay - 1, byParty } : null;
}

/** How far the final average missed the margin between the top two in one past round. */
export interface PastError {
  year: number;
  round: RoundId;
  /** Size of the miss on the margin, in points of valid votes. */
  size: number;
  /** The candidate the average gave less than the ballot box did (of that round's top two). */
  underestimated: string;
}

/** Today's margin between the two leaders, and every past miss to apply to it. */
export interface ErrorScenarios {
  leader: string;
  runnerUp: string;
  /** Leader minus runner-up in valid votes, ≥ 0. */
  margin: number;
  errors: PastError[];
}

/**
 * The miss of the final average in a round with a result, on the margin between its top two
 * in valid votes, with every pollster in (the record weighting as chosen). Null when its polls
 * cannot be converted to valid votes or a line stops before the end.
 */
export function pastError(data: Dataset, year: string, round: RoundId, s: AppState): PastError | null {
  const race = data.presidential[year]?.rounds[round];
  if (!race?.result) return null;
  const state = { ...defaultState(data), year, round, weighByRecord: s.weighByRecord };
  const shares = finalValidShares(buildView(data, race, state));
  const [first, second] = Object.keys(race.result).sort((a, b) => race.result![b]! - race.result![a]!);
  if (!shares || !first || !second || shares[first] == null || shares[second] == null) return null;
  const miss = race.result[first]! - race.result[second]! - (shares[first] - shares[second]);
  return { year: Number(year), round, size: Math.abs(miss), underestimated: miss > 0 ? first : second };
}

/**
 * A presidential race still without a result, against the polls' past misses: the same round
 * of every earlier election and, for a runoff, this election's 1st round. Each miss is kept
 * as a size, without a direction, since none can be told in advance. Null for any other race.
 */
export function errorScenarios(data: Dataset, view: View, s: AppState): ErrorScenarios | null {
  if (s.office !== "president" || view.hasResult) return null;
  const shares = finalValidShares(view);
  const [leader, runnerUp] = Object.entries(shares ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([series]) => series);
  if (!shares || !leader || !runnerUp) return null;
  const errors: PastError[] = [];
  for (const year of Object.keys(data.presidential).sort()) {
    const sameRound = year < s.year;
    const firstRound = year === s.year && s.round === "r2";
    if (!sameRound && !firstRound) continue;
    const error = pastError(data, year, sameRound ? s.round : "r1", s);
    if (error) errors.push(error);
  }
  return errors.length ? { leader, runnerUp, margin: shares[leader]! - shares[runnerUp]!, errors } : null;
}
