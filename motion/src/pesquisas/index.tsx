import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from "remotion";
import electionsJson from "../../../data/generated/elections.json";
import { bandwidth, smoothSeries, type TrendPoint } from "../../../src/model/smoothing";
import { UNDECIDED, type Dataset, type Race, type RoundId } from "../../../src/types";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, pct } from "../common/theme";

const data = electionsJson as unknown as Dataset;

type Props = { year: number | "todos"; round: RoundId };

const YEARS = [2010, 2014, 2018, 2022, 2026];
const ROUND_NAME: Record<RoundId, string> = { r1: "1º turno", r2: "2º turno" };

/** One election's timing, in frames from its start. */
const FADE = 15;
const SWEEP = 180;
const DIAMONDS = 22;
const VERDICT_AT = FADE + SWEEP + DIAMONDS + 4;
/** Length of one election inside the five-year chain, and alone (a longer hold). */
const SEGMENT = 300;
const SINGLE = 390;
const INTRO = 75;
const OUTRO = 200;
/** A trend ending this close to election day counts as the final average (src/model/view.ts). */
const REACHES_END_DAYS = 3;
/** Line days are drawn next to a poll of the candidate, or between two polls this close. */
const EDGE_DAYS = 3;
const MAX_GAP_DAYS = 30;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// --- Data ------------------------------------------------------------------------------

interface Line {
  series: string;
  color: string;
  points: { d: number; y: number }[];
  /** Final average in valid votes, when the line reaches election day. */
  final: number | null;
  result: number | null;
}
interface Prepared {
  year: number;
  round: RoundId;
  race: Race;
  firstDay: number;
  endDay: number;
  yMax: number;
  lines: Line[];
  dots: { d: number; y: number; color: string }[];
  /** How the polls were turned into valid votes. */
  conversion: "undecided" | "valid" | "sum";
  verdict: {
    rows: { series: string; color: string; final: number | null; result: number; diff: number | null }[];
    meanError: number | null;
    marginError: number | null;
    leaderRight: boolean | null;
    predicted: string | null;
    winner: string;
  } | null;
}

const cache = new Map<string, Prepared | null>();

export function prepare(year: number, round: RoundId): Prepared | null {
  const key = `${year}-${round}`;
  if (cache.has(key)) return cache.get(key)!;
  const race = data.presidential[String(year)]?.rounds[round];
  if (!race || !race.polls.length) {
    cache.set(key, null);
    return null;
  }
  // As buildView does: grid from the first poll to the day before the election.
  const polls = race.polls;
  const hasResult = race.result !== null;
  const endDay = hasResult ? race.electionDay : Math.max(...polls.map((p) => p.d)) + 1;
  const firstDay = Math.min(...polls.map((p) => p.d));
  const bw = bandwidth(endDay - firstDay, true);
  const grid = Array.from({ length: endDay - firstDay }, (_, i) => firstDay + i);
  const trends: Record<string, Map<number, number>> = {};
  for (const series of race.series) {
    const trend: TrendPoint[] | null = smoothSeries(polls, series, grid, bw);
    if (trend) trends[series] = new Map(trend.map((p) => [p.d, p.y]));
  }

  // Valid votes on day d: total votes ÷ (100 − undecided), or ÷ the sum of every series
  // when the source has no undecided, or as they are when the source already has valid votes.
  const und = trends[UNDECIDED];
  const conversion: Prepared["conversion"] = race.validVotesOnly ? "valid" : und ? "undecided" : "sum";
  const others = Object.keys(trends).filter((s) => s !== UNDECIDED);
  const factor = (d: number): number | null => {
    if (conversion === "valid") return 1;
    if (conversion === "undecided") {
      const u = und!.get(d);
      return u == null ? null : 100 / (100 - u);
    }
    let sum = 0;
    for (const s of others) {
      const v = trends[s]!.get(d);
      if (v == null) return null;
      sum += v;
    }
    return sum > 0 ? 100 / sum : null;
  };
  const factorNear = (d: number) => {
    for (let k = 0; k <= 4; k++) {
      const f = factor(d - k) ?? factor(d + k);
      if (f != null) return f;
    }
    return null;
  };

  const plotted = (race.result ? Object.keys(race.result) : race.series.filter((s) => s !== UNDECIDED)).filter(
    (s) => trends[s],
  );
  const colorOf = (s: string) => COLOR[race.colors[s] ?? "gray"];
  const lines: Line[] = plotted.map((series) => {
    // The smoothing reaches across long gaps between polls (a candidate tested in May, then
    // again from August): those stretches are left out of the drawing, not the model.
    const days = polls.filter((q) => q.v[series] != null).map((q) => q.d);
    const nearPoll = (d: number) =>
      days.some((q) => Math.abs(q - d) <= EDGE_DAYS) ||
      (days.some((q) => q < d && d - q <= MAX_GAP_DAYS) && days.some((q) => q > d && q - d <= MAX_GAP_DAYS));
    const points: { d: number; y: number }[] = [];
    for (const [d, y] of trends[series]!) {
      const f = factor(d);
      if (f != null && nearPoll(d)) points.push({ d, y: y * f });
    }
    points.sort((a, b) => a.d - b.d);
    const last = points.at(-1);
    return {
      series,
      color: colorOf(series),
      points,
      final: last && last.d >= endDay - REACHES_END_DAYS ? last.y : null,
      result: race.result?.[series] ?? null,
    };
  });
  const dots: Prepared["dots"] = [];
  for (const p of polls) {
    const f = factorNear(p.d);
    if (f == null) continue;
    for (const s of plotted) {
      const v = p.v[s];
      if (v != null) dots.push({ d: p.d, y: v * f, color: colorOf(s) });
    }
  }
  dots.sort((a, b) => a.d - b.d);

  let verdict: Prepared["verdict"] = null;
  if (race.result) {
    const rows = lines
      .filter((l) => l.result != null)
      .map((l) => ({
        series: l.series,
        color: l.color,
        final: l.final,
        result: l.result!,
        diff: l.final == null ? null : l.result! - l.final,
      }))
      .sort((a, b) => b.result - a.result);
    const diffs = rows.map((r) => r.diff).filter((d): d is number => d != null);
    const [r1, r2] = rows;
    const marginError =
      r1 && r2 && r1.final != null && r2.final != null ? r1.result - r2.result - (r1.final - r2.final) : null;
    const withFinal = rows.filter((r) => r.final != null);
    const predicted = withFinal.length ? withFinal.reduce((a, b) => (b.final! > a.final! ? b : a)).series : null;
    verdict = {
      rows,
      meanError: diffs.length ? diffs.reduce((s, d) => s + Math.abs(d), 0) / diffs.length : null,
      marginError,
      leaderRight: predicted ? predicted === r1!.series : null,
      predicted,
      winner: r1!.series,
    };
  }

  const values = [...lines.flatMap((l) => l.points.map((p) => p.y)), ...lines.map((l) => l.result ?? 0)];
  const yMax = Math.max(60, Math.ceil((Math.max(...values) + 4) / 10) * 10);
  const out: Prepared = { year, round, race, firstDay, endDay, yMax, lines, dots, conversion, verdict };
  cache.set(key, out);
  return out;
}

/** The five elections of the chain: those with a result in this round. */
const chain = (round: RoundId) => YEARS.filter((y) => prepare(y, round)?.verdict);

const duration = ({ year, round }: Props) =>
  year === "todos" ? INTRO + chain(round).length * SEGMENT + OUTRO : SINGLE;

// --- Drawing ---------------------------------------------------------------------------

const num = (v: number, digits = 1) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v))}`;

/** Day of the year (0 = January 1st) where month m starts. */
const monthStart = (year: number, m: number) => (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 864e5;

/** Pushes labels apart so none overlap; keeps them in order. */
function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const out = order.map(([y]) => y);
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k]!, out[k - 1]! + gap);
  const over = out.length ? out[out.length - 1]! - hi : 0;
  if (over > 0) for (let k = 0; k < out.length; k++) out[k] = out[k]! - over;
  for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k]!, out[k + 1]! - gap);
  for (let k = 0; k < out.length; k++) out[k] = Math.max(out[k]!, lo);
  const res = new Array<number>(ys.length);
  order.forEach(([, i], k) => (res[i] = out[k]!));
  return res;
}

const CONVERSION_NOTE: Record<Prepared["conversion"], string> = {
  undecided: "Média de todas as pesquisas, em votos válidos: sem brancos, nulos e indecisos.",
  valid: "Média de todas as pesquisas; a fonte já traz votos válidos.",
  sum: "Sem indecisos na fonte: convertido em votos válidos pela soma dos candidatos.",
};

/** One election: the average walking to election day, then the result. */
export function Election({ p, hold }: { p: Prepared; hold: number }) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const fadeIn = interpolate(frame, [0, FADE], [0, 1], clamp);
  const fadeOut = interpolate(frame, [hold - 12, hold], [1, 0], clamp);
  const opacity = Math.min(fadeIn, fadeOut);

  // Chart box.
  const panelW = 520 * u;
  const box = portrait
    ? { left: pad + 56 * u, top: 470 * u, right: width - pad - 170 * u, bottom: 1240 * u }
    : { left: pad + 56 * u, top: 290 * u, right: width - pad - panelW - 240 * u, bottom: height - 185 * u };
  const x = (d: number) => box.left + ((d - p.firstDay) / (p.endDay - p.firstDay)) * (box.right - box.left);
  const y = (v: number) => box.bottom - (v / p.yMax) * (box.bottom - box.top);

  const sweep = interpolate(frame, [FADE, FADE + SWEEP], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const cursor = p.firstDay + sweep * (p.endDay - p.firstDay);
  const resultIn = (k: number) =>
    interpolate(frame, [FADE + SWEEP + k * 5, FADE + SWEEP + k * 5 + 14], [0, 1], {
      ...clamp,
      easing: Easing.out(Easing.back(2.2)),
    });
  const verdictIn = interpolate(frame, [VERDICT_AT, VERDICT_AT + 16], [0, 1], clamp);

  const path = (pts: { d: number; y: number }[]) => {
    let s = "";
    let prev: number | null = null;
    for (const q of pts) {
      if (q.d > cursor) break;
      s += `${prev != null && q.d - prev <= 2 ? "L" : "M"}${x(q.d).toFixed(1)},${y(q.y).toFixed(1)}`;
      prev = q.d;
    }
    return s;
  };
  const headAt = (pts: { d: number; y: number }[]) => {
    let last: { d: number; y: number } | null = null;
    for (const q of pts) {
      if (q.d > cursor) break;
      last = q;
    }
    return last;
  };

  // Month ticks.
  const ticks: { d: number; label: string }[] = [];
  for (let m = 0; m < 12; m++) {
    const d = monthStart(p.year, m);
    if (d >= p.firstDay && d <= p.endDay) ticks.push({ d, label: MONTHS[m]! });
  }
  // A short runoff campaign: days instead of months.
  if (ticks.length < 3) {
    ticks.length = 0;
    const step = Math.max(2, Math.round((p.endDay - p.firstDay) / 6));
    for (let d = p.endDay; d >= p.firstDay; d -= step) {
      const date = new Date(Date.UTC(p.year, 0, 1 + d));
      ticks.push({ d, label: `${date.getUTCDate()}/${MONTHS[date.getUTCMonth()]}` });
    }
  }
  const yTicks = Array.from({ length: p.yMax / 10 + 1 }, (_, i) => i * 10);

  // End labels: at the head of each line while it walks; with the result once it is in.
  const heads = p.lines.map((l) => headAt(l.points));
  const labelYs = spread(
    heads.map((h) => (h ? y(h.y) : box.bottom)),
    34 * u,
    box.top - 10 * u,
    box.bottom,
  );
  const shownResult = resultIn(0) > 0.5;
  const fs = 24 * u;

  const v = p.verdict;
  const panel = portrait
    ? { left: pad, right: pad, top: 1330 * u }
    : { left: width - pad - panelW, width: panelW, top: 290 * u };

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={box.left} x2={box.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? T.rule : T.grid} strokeWidth={u} />
            <text x={box.left - 12 * u} y={y(t) + 7 * u} fill={T.muted} fontSize={20 * u} textAnchor="end">
              {t}%
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t.d} x={x(t.d)} y={box.bottom + 32 * u} fill={T.muted} fontSize={20 * u} textAnchor="middle">
            {t.label}
          </text>
        ))}
        {/* Election day. */}
        <line
          x1={x(p.endDay)}
          x2={x(p.endDay)}
          y1={box.top - 10 * u}
          y2={box.bottom}
          stroke={T.rule}
          strokeWidth={1.5 * u}
          strokeDasharray={`${6 * u} ${6 * u}`}
        />
        <text x={x(p.endDay)} y={box.top - 22 * u} fill={T.muted} fontSize={20 * u} textAnchor="middle">
          eleição
        </text>
        {/* Polls. */}
        {p.dots.map((dot, k) =>
          dot.d <= cursor ? (
            <circle
              key={k}
              cx={x(dot.d)}
              cy={y(dot.y)}
              r={4 * u * interpolate(cursor - dot.d, [0, 3], [1.8, 1], clamp)}
              fill={dot.color}
              opacity={0.28}
            />
          ) : null,
        )}
        {/* Averages. */}
        {p.lines.map((l) => (
          <path
            key={l.series}
            d={path(l.points)}
            fill="none"
            stroke={l.color}
            strokeWidth={5 * u}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {p.lines.map((l, k) => {
          const h = heads[k];
          return h ? <circle key={l.series} cx={x(h.d)} cy={y(h.y)} r={7 * u} fill={l.color} /> : null;
        })}
        {/* Results: diamonds on election day. */}
        {p.lines.map((l, k) => {
          if (l.result == null) return null;
          const s = resultIn(k) * 15 * u;
          const cx = x(p.endDay);
          const cy = y(l.result);
          return (
            <path
              key={l.series}
              d={`M${cx},${cy - s}L${cx + s},${cy}L${cx},${cy + s}L${cx - s},${cy}Z`}
              fill={T.bg}
              stroke={l.color}
              strokeWidth={4 * u}
            />
          );
        })}
      </svg>
      {p.lines.map((l, k) => {
        const h = heads[k];
        if (!h) return null;
        return (
          <div
            key={l.series}
            style={{
              position: "absolute",
              left: (shownResult && l.result != null ? x(p.endDay) + 8 * u : x(h.d)) + 22 * u,
              top: labelYs[k]! - fs * 0.7,
              fontSize: fs,
              whiteSpace: "nowrap",
              color: T.ink,
              fontVariantNumeric: "tabular-nums",
              opacity: interpolate(sweep, [0, 0.04], [0, 1], clamp),
            }}
          >
            <b style={{ color: l.color }}>{l.series}</b> {shownResult && l.result != null ? `◇ ${pct(l.result)}` : pct(h.y)}
          </div>
        );
      })}

      {/* Year and, at the end, the verdict. */}
      <div style={{ position: "absolute", ...panel }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 120 * u, lineHeight: 0.9 }}>{p.year}</div>
        <div style={{ fontSize: 26 * u, color: T.ink2, marginTop: 6 * u }}>
          {ROUND_NAME[p.round]} · {p.race.polls.length} pesquisas
        </div>
        {v ? (
          <div style={{ opacity: verdictIn, marginTop: 34 * u }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                columnGap: 22 * u,
                rowGap: 8 * u,
                fontSize: 23 * u,
                fontVariantNumeric: "tabular-nums",
                alignItems: "baseline",
              }}
            >
              <span style={{ color: T.muted, fontSize: 19 * u }} />
              <span style={{ color: T.muted, fontSize: 19 * u, textAlign: "right" }}>média</span>
              <span style={{ color: T.muted, fontSize: 19 * u, textAlign: "right" }}>urna</span>
              <span style={{ color: T.muted, fontSize: 19 * u, textAlign: "right" }}>erro</span>
              {v.rows.slice(0, portrait ? 4 : 5).map((r) => (
                <Row key={r.series} r={r} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 40 * u, marginTop: 30 * u }}>
              <Stat label="erro médio" value={v.meanError == null ? "—" : `${num(v.meanError)} p.p.`} />
              <Stat label="erro na margem" value={v.marginError == null ? "—" : `${signed(v.marginError)} p.p.`} />
            </div>
            <div style={{ fontSize: 26 * u, marginTop: 24 * u, lineHeight: 1.35 }}>
              {v.leaderRight == null
                ? null
                : v.leaderRight
                  ? `✓ A média apontava ${v.winner} na frente, e ${v.winner} chegou na frente.`
                  : `✗ A média apontava ${v.predicted} na frente; ${v.winner} chegou na frente.`}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 26 * u, color: T.ink2, marginTop: 30 * u }}>Resultado em {p.race.date.split("-").reverse().join("/")}.</div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 1290 * u : height - 130 * u,
          fontSize: 19 * u,
          color: T.muted,
          display: portrait ? "none" : "block",
        }}
      >
        {CONVERSION_NOTE[p.conversion]} Losango: resultado oficial.
      </div>
    </AbsoluteFill>
  );
}

function Row({ r }: { r: NonNullable<Prepared["verdict"]>["rows"][number] }) {
  const { u } = useLayout();
  return (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 10 * u }}>
        <i style={{ width: 14 * u, height: 14 * u, borderRadius: "50%", background: r.color }} />
        {r.series}
      </span>
      <span style={{ textAlign: "right", color: T.ink2 }}>{r.final == null ? "—" : num(r.final)}</span>
      <span style={{ textAlign: "right", fontWeight: 600 }}>{num(r.result)}</span>
      <span style={{ textAlign: "right", color: r.diff != null && Math.abs(r.diff) >= 3 ? "#f0a35e" : T.ink2 }}>
        {r.diff == null ? "—" : signed(r.diff)}
      </span>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { u } = useLayout();
  return (
    <div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 60 * u, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 20 * u, color: T.muted }}>{label}</div>
    </div>
  );
}

// --- The motion --------------------------------------------------------------------------

function Pesquisas({ year, round }: Props) {
  const frame = useCurrentFrame();
  const { u, pad, portrait, width } = useLayout();
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const subtitle = "A média das pesquisas para presidente até o dia da eleição, e o que a urna disse";

  if (year !== "todos") {
    const p = prepare(year, round);
    return (
      <Stage>
        <Header title="As pesquisas acertaram?" subtitle={subtitle} opacity={headerIn} />
        {p ? <Election p={p} hold={SINGLE + 20} /> : null}
        <Footer source="Pesquisas registradas no TSE · resultado: TSE" opacity={headerIn} />
      </Stage>
    );
  }

  const years = chain(round);
  const preps = years.map((y) => prepare(y, round)!);
  const outroAt = INTRO + years.length * SEGMENT;
  const introOut = interpolate(frame, [INTRO - 15, INTRO], [1, 0], clamp);
  const outroIn = interpolate(frame, [outroAt, outroAt + 20], [0, 1], clamp);
  const maxErr = Math.max(...preps.map((p) => p.verdict!.meanError ?? 0), 1);

  return (
    <Stage>
      <Header title="As pesquisas acertaram?" subtitle={subtitle} opacity={headerIn} />
      {/* Intro: the question and the five years. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 700 * u : 420 * u,
          opacity: Math.min(headerIn, introOut),
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: (portrait ? 110 : 140) * u,
          lineHeight: 1,
          color: T.ink2,
          display: "flex",
          flexWrap: "wrap",
          gap: `${10 * u}px ${48 * u}px`,
        }}
      >
        {years.map((y, k) => (
          <span key={y} style={{ opacity: interpolate(frame, [8 + k * 6, 20 + k * 6], [0, 1], clamp) }}>
            {y}
          </span>
        ))}
      </div>
      {preps.map((p, k) => (
        <Sequence key={p.year} from={INTRO + k * SEGMENT} durationInFrames={SEGMENT} layout="none">
          <Election p={p} hold={SEGMENT} />
        </Sequence>
      ))}
      {/* Outro: mean error per year. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 400 * u : 300 * u,
          opacity: outroIn,
          display: frame >= outroAt ? "block" : "none",
        }}
      >
        <div style={{ fontSize: 30 * u, color: T.ink2, marginBottom: 28 * u }}>
          Erro médio da média final, em pontos, por candidato
        </div>
        {preps.map((p, k) => {
          const v = p.verdict!;
          const grow = interpolate(frame, [outroAt + 10 + k * 8, outroAt + 40 + k * 8], [0, 1], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          });
          const barW = (portrait ? width - 2 * pad - 360 * u : 1000 * u) * ((v.meanError ?? 0) / maxErr) * grow;
          return (
            <div key={p.year} style={{ display: "flex", alignItems: "center", gap: 24 * u, marginBottom: 22 * u }}>
              <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64 * u, width: 150 * u }}>{p.year}</span>
              <div style={{ height: 40 * u, width: barW, background: T.ink2, borderRadius: 4 * u }} />
              <span style={{ fontSize: 30 * u, fontVariantNumeric: "tabular-nums", opacity: grow }}>
                {v.meanError == null ? "—" : num(v.meanError)} {v.leaderRight ? "✓" : "✗"}
              </span>
            </div>
          );
        })}
        <div style={{ fontSize: 24 * u, color: T.muted, marginTop: 20 * u }}>
          ✓ a média apontava quem chegou na frente · ✗ não apontava
        </div>
      </div>
      <Footer source="Pesquisas registradas no TSE · resultado: TSE" opacity={headerIn} />
    </Stage>
  );
}

const yearOptions = [
  { value: "todos", label: "Todas (2010–2026)" },
  ...YEARS.map((y) => ({ value: y, label: String(y) })),
];

export const def = motion<Props>({
  id: "Pesquisas",
  title: "As pesquisas acertaram?",
  description: "A média das pesquisas andando até o dia da eleição, e o losango do resultado no fim.",
  component: Pesquisas,
  defaultProps: { year: "todos", round: "r1" },
  durationInFrames: duration,
  formats: ["portrait", "landscape"],
  controls: [
    { prop: "year", label: "Eleição", options: yearOptions },
    {
      prop: "round",
      label: "Turno",
      options: [
        { value: "r1", label: "1º turno" },
        { value: "r2", label: "2º turno" },
      ],
    },
  ],
});
