import { methodOf, type AppState } from "../state";
import { UNDECIDED, type Dataset, type Poll, type Race } from "../types";
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
  const bw = bandwidth(endDay - firstDay, s.office === "president");
  const grid = Array.from({ length: endDay - firstDay }, (_, i) => firstDay + i);

  const trends: Record<string, TrendPoint[]> = {};
  for (const series of race.series) {
    const trend = smoothSeries(polls, series, grid, bw);
    if (trend) trends[series] = trend;
  }
  return { race, polls, trends, order: orderSeries(trends), firstDay, endDay, hasResult };
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
