import { useLayoutEffect, useRef } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import censusJson from "../../../data/generated/census-vote.json";
import {
  byDecile,
  decodeCensusVote,
  groupOf,
  pooledShare,
  populationBreaks,
  placesWith,
  quadrants,
  valueAt,
  voteAt,
  type CensusVar,
  type EncodedCensusVote,
} from "../../../src/model/census-vote";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, int, pct, rgb } from "../common/theme";

type Props = Record<string, never>;

// --- Data ------------------------------------------------------------------------------

const data = decodeCensusVote(censusJson as unknown as EncodedCensusVote);
const ELECTION = data.elections.find((e) => e.year === 2026 && e.round === "r1")!;
const YEAR = ELECTION.census;
const all = () => true;

interface Cut {
  v: CensusVar;
  kicker: string;
  headline: string;
  axis: string;
  log: boolean;
  domain: [number, number];
  ticks: number[];
  tick: (x: number) => string;
  /** How the edge of the lowest and the highest fifth reads. */
  edge: (x: number) => string;
  lowName: string;
  highName: string;
  note?: string;
}

const reais = (x: number) => `R$ ${int(x)}`;
const pts = (x: number) => pct(x);

const CUTS: Cut[] = [
  {
    v: "income",
    kicker: "Renda",
    headline: "Mais renda, menos voto em Lula",
    axis: "Renda domiciliar por pessoa, R$ de julho de 2022 (escala log)",
    log: true,
    domain: [250, 5000],
    ticks: [300, 500, 1000, 2000, 4000],
    tick: (x) => `R$ ${int(x)}`,
    edge: reais,
    lowName: "mais pobres",
    highName: "mais ricas",
    note: "No topo a linha volta a subir um pouco: ali estão São Paulo, Belo Horizonte e Porto Alegre.",
  },
  {
    v: "evangelical",
    kicker: "Religião",
    headline: "Mais evangélicos, menos voto em Lula",
    axis: "% de evangélicos entre as pessoas de 10 anos ou mais",
    log: false,
    domain: [0, 90],
    ticks: [0, 20, 40, 60, 80],
    tick: (x) => `${x}%`,
    edge: (x) => `${pts(x)} de evangélicos`,
    lowName: "menos evangélicas",
    highName: "mais evangélicas",
    note: "A queda maior vem até uns 25% de evangélicos; dali em diante, a linha desce devagar.",
  },
  {
    v: "degree",
    kicker: "Escolaridade",
    headline: "Mais diplomas, menos voto em Lula",
    axis: "% dos adultos (25 anos ou mais) com superior completo",
    log: false,
    domain: [0, 50],
    ticks: [0, 10, 20, 30, 40, 50],
    tick: (x) => `${x}%`,
    edge: (x) => `${pts(x)} com superior`,
    lowName: "com menos diplomas",
    highName: "com mais diplomas",
    note: "A queda está embaixo: passando de uns 13% com superior, a linha oscila entre 35% e 45%.",
  },
];

const COUNT = ELECTION.valid.length;
const pos = (c: Cut, x: number) => {
  const [lo, hi] = c.log ? c.domain.map(Math.log) : c.domain;
  return ((c.log ? Math.log(x) : x) - lo!) / (hi! - lo!);
};

interface Stats {
  /** Each municipality's x along the cut, 0..1 (NaN without data). */
  x: Float32Array;
  /** Edges of the lowest and the highest fifth of the population. */
  lowEdge: number;
  highEdge: number;
  low: { pt: number; rival: number; places: number };
  high: { pt: number; rival: number; places: number };
  line: { x: number; y: number }[];
}

const STATS: Stats[] = CUTS.map((c) => {
  const places = placesWith(data, ELECTION, c.v, all);
  const breaks = populationBreaks(data, YEAR, c.v, places, 5);
  const fifth = (g: number) => {
    const here = places.filter((i) => groupOf(valueAt(data, YEAR, c.v, i)!, breaks) === g);
    return { pt: pooledShare(ELECTION, "pt", here)!, rival: pooledShare(ELECTION, "rival", here)!, places: here.length };
  };
  const x = new Float32Array(COUNT).fill(NaN);
  for (const i of places) x[i] = pos(c, valueAt(data, YEAR, c.v, i)!);
  return {
    x,
    lowEdge: breaks[0]!,
    highEdge: breaks[3]!,
    low: fifth(0),
    high: fifth(4),
    line: byDecile(data, ELECTION, c.v, "pt", all).map((d) => ({ x: pos(c, d.x), y: d.share })),
  };
});

/** Income × Evangelicals, each split at its population median. */
const QUAD = quadrants(data, ELECTION, "income", "evangelical", all);
const quad = (richer: boolean, moreEv: boolean) =>
  QUAD.groups.find((g) => g.high[0] === richer && g.high[1] === moreEv)!.pt!;

const NATIONAL = { pt: pooledShare(ELECTION, "pt", [...Array(COUNT).keys()])!, rival: 0 };
NATIONAL.rival = pooledShare(ELECTION, "rival", [...Array(COUNT).keys()])!;

const LULA = rgb(COLOR.red);
const RIVAL = rgb(COLOR.blue);
let maxValid = 0;
for (const v of ELECTION.valid) maxValid = Math.max(maxValid, v);
/** Biggest first, so the small towns sit on top. */
const ORDER = [...Array(COUNT).keys()]
  .filter((i) => ELECTION.valid[i]! > 0 && voteAt(ELECTION, "pt", i) !== null)
  .sort((a, b) => ELECTION.valid[b]! - ELECTION.valid[a]!);
let wonPt = 0;
for (const i of ORDER) if (voteAt(ELECTION, "pt", i)! > voteAt(ELECTION, "rival", i)!) wonPt++;
/** A fixed scatter of start times, so the dots do not move in lockstep. */
const JITTER = Float32Array.from({ length: COUNT }, (_, i) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
});

// --- Timing ----------------------------------------------------------------------------

const INTRO = 120;
const CUT = 420;
const MOVE = 60;
const LINE_AT = 60;
const TEXT_AT = 105;
const CLOSE = 360;
const DURATION = INTRO + CUTS.length * CUT + CLOSE;
const CLOSE_AT = INTRO + CUTS.length * CUT;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);

// --- Component -------------------------------------------------------------------------

function VotoCenso(_: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const canvas = useRef<HTMLCanvasElement>(null);

  // Which cut, and how far the dots are in moving to it from the one before.
  const t = frame - INTRO;
  const k = Math.max(0, Math.min(CUTS.length - 1, Math.floor(t / CUT)));
  const local = t - k * CUT;
  const move = k === 0 ? 1 : interpolate(local, [0, MOVE], [0, 1], clamp);
  const from = STATS[Math.max(0, k - 1)]!;
  const to = STATS[k]!;
  const cut = CUTS[k]!;
  const shownCut = move < 0.5 ? CUTS[Math.max(0, k - 1)]! : cut;
  const axisFade = k === 0 ? 1 : Math.abs(move - 0.5) * 2;

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const dotsIn = interpolate(frame, [15, 80], [0, 1], clamp);
  const close = interpolate(frame, [CLOSE_AT, CLOSE_AT + 30], [0, 1], clamp);
  const lineIn = frame < INTRO ? 0 : interpolate(local, [LINE_AT, LINE_AT + 45], [0, 1], clamp);
  const textIn = frame < INTRO ? 0 : interpolate(local, [TEXT_AT, TEXT_AT + 20], [0, 1], clamp);
  // The cut's line and text leave as the next cut's dots start to move.
  const out = k < CUTS.length - 1 ? interpolate(local, [CUT - 15, CUT], [1, 0], clamp) : 1 - close;

  const plot = portrait
    ? { left: pad + 110 * u, right: width - pad - 10 * u, top: 420 * u, bottom: 1160 * u }
    : { left: pad + 110 * u, right: 1180 * u, top: 300 * u, bottom: height - 210 * u };
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const X = (x: number) => plot.left + x * pw;
  const Y = (share: number) => plot.bottom - (share / 100) * ph;

  useLayoutEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    const alpha = 0.62 * (1 - close * 0.9);
    for (const i of ORDER) {
      const a = from.x[i]!;
      const b = to.x[i]!;
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const q = move >= 1 ? 1 : ease(interpolate(move, [JITTER[i]! * 0.35, JITTER[i]! * 0.35 + 0.65], [0, 1], clamp));
      const x = X(a + (b - a) * q);
      const pt = voteAt(ELECTION, "pt", i)!;
      const y = Y(pt);
      const grow = interpolate(dotsIn, [JITTER[i]! * 0.6, JITTER[i]! * 0.6 + 0.4], [0, 1], clamp);
      if (grow <= 0) continue;
      const r = (1.3 + 34 * Math.sqrt(ELECTION.valid[i]! / maxValid)) * u * grow;
      const c = pt > voteAt(ELECTION, "rival", i)! ? LULA : RIVAL;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
      ctx.fill();
      if (r > 6 * u) {
        ctx.lineWidth = 1.2 * u;
        ctx.strokeStyle = `rgba(15,17,19,${alpha})`;
        ctx.stroke();
      }
    }
  });

  const s = STATS[k]!;
  const linePath = s.line.map((p, j) => `${j ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const bandLow = Math.max(0, Math.min(1, pos(cut, s.lowEdge)));
  const bandHigh = Math.max(0, Math.min(1, pos(cut, s.highEdge)));
  const bandsOp = textIn * out * (1 - close);

  const panel = portrait
    ? { left: pad, right: pad, top: 1290 * u }
    : { left: 1270 * u, right: pad, top: 300 * u };
  const statSize = (portrait ? 92 : 86) * u;

  return (
    <Stage>
      <Header
        title="Como votou cada Brasil"
        subtitle={`1º turno de 2026: os ${int(ORDER.length)} municípios ao lado do Censo ${YEAR}`}
        opacity={headerIn}
      />

      {/* Legend. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          top: plot.top - (portrait ? 82 : 76) * u,
          display: "flex",
          flexWrap: "wrap",
          columnGap: 30 * u,
          rowGap: 6 * u,
          fontSize: 23 * u,
          color: T.ink2,
          opacity: headerIn * (1 - close),
        }}
      >
        <Swatch color={COLOR.red} label={`${ELECTION.pt} venceu (${int(wonPt)})`} />
        <Swatch color={COLOR.blue} label={`${ELECTION.rival} venceu (${int(ORDER.length - wonPt)})`} />
        <span style={{ color: T.muted }}>cada ponto, uma cidade · tamanho: votos válidos</span>
      </div>

      {/* Axes. */}
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, opacity: headerIn * (1 - close) }}>
        {[0, 25, 50, 75, 100].map((y) => (
          <g key={y}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={Y(y)}
              y2={Y(y)}
              stroke={y === 50 ? T.muted : T.grid}
              strokeWidth={(y === 50 ? 1.5 : 1) * u}
              strokeDasharray={y === 50 ? `${6 * u} ${6 * u}` : undefined}
            />
            <text x={plot.left - 14 * u} y={Y(y) + 8 * u} textAnchor="end" fill={T.muted} fontSize={22 * u}>
              {y}%
            </text>
          </g>
        ))}
        <g opacity={axisFade}>
          {shownCut.ticks.map((x) => (
            <text
              key={x}
              x={X(pos(shownCut, x))}
              y={plot.bottom + 36 * u}
              textAnchor="middle"
              fill={T.muted}
              fontSize={22 * u}
            >
              {shownCut.tick(x)}
            </text>
          ))}
          <text x={plot.left} y={plot.bottom + 76 * u} fill={T.ink2} fontSize={23 * u}>
            {shownCut.axis}
          </text>
        </g>
        <text
          x={pad + 20 * u}
          y={plot.top}
          fill={T.ink2}
          fontSize={23 * u}
          transform={`rotate(-90 ${pad + 20 * u} ${plot.top})`}
          textAnchor="end"
        >
          {`% dos votos válidos de ${ELECTION.pt}`}
        </text>
        {/* The lowest and the highest fifth of the population, shaded. */}
        <g opacity={bandsOp}>
          <rect x={X(0)} y={plot.top} width={X(bandLow) - X(0)} height={ph} fill={T.ink} opacity={0.06} />
          <rect x={X(bandHigh)} y={plot.top} width={X(1) - X(bandHigh)} height={ph} fill={T.ink} opacity={0.06} />
          <line x1={X(bandLow)} x2={X(bandLow)} y1={plot.top} y2={plot.bottom} stroke={T.muted} strokeWidth={u} />
          <line x1={X(bandHigh)} x2={X(bandHigh)} y1={plot.top} y2={plot.bottom} stroke={T.muted} strokeWidth={u} />
          <text x={X(bandLow) - 10 * u} y={plot.top + 28 * u} textAnchor="end" fill={T.ink2} fontSize={21 * u}>
            1/5 da população
          </text>
          <text x={X(bandHigh) + 10 * u} y={plot.top + 28 * u} fill={T.ink2} fontSize={21 * u}>
            1/5 da população
          </text>
        </g>
      </svg>
      <canvas
        ref={canvas}
        width={width}
        height={height}
        style={{ position: "absolute", left: 0, top: 0, width, height, pointerEvents: "none" }}
      />
      {/* Trend, above the dots: the vote in each tenth of the population. */}
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, opacity: out * (1 - close) }}>
        <path
          d={linePath}
          fill="none"
          stroke={T.bg}
          strokeWidth={10 * u}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - lineIn}
        />
        <path
          d={linePath}
          fill="none"
          stroke={T.ink}
          strokeWidth={5 * u}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - lineIn}
        />
      </svg>

      {/* Intro: how to read it. */}
      <div
        style={{
          position: "absolute",
          ...panel,
          opacity: interpolate(frame, [20, 40], [0, 1], clamp) * interpolate(frame, [INTRO + 80, INTRO + 100], [1, 0], clamp),
          fontSize: 30 * u,
          lineHeight: 1.4,
          color: T.ink2,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 52 * u, color: T.ink, lineHeight: 1.05 }}>
          {ELECTION.pt} {pct(NATIONAL.pt)} · {ELECTION.rival} {pct(NATIONAL.rival)}
        </div>
        <div style={{ fontSize: 23 * u, color: T.muted, marginTop: 4 * u }}>no país, dos votos válidos</div>
        <div style={{ marginTop: 18 * u }}>
          Cada ponto é uma cidade: quanto mais alto, mais votos {ELECTION.pt} teve nela. Da esquerda para a direita, as
          cidades vão em três ordens: renda, religião e escolaridade.
        </div>
      </div>

      {/* Takeaway for the cut. */}
      <div style={{ position: "absolute", ...panel, opacity: textIn * out }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 26 * u, letterSpacing: 3 * u, color: T.muted }}>
          {k + 1} DE {CUTS.length} · {cut.kicker.toUpperCase()}
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 56 * u, lineHeight: 1.05, marginTop: 6 * u }}>
          {cut.headline}
        </div>
        <div style={{ display: "flex", flexDirection: portrait ? "row" : "column", gap: (portrait ? 40 : 26) * u, marginTop: 26 * u }}>
          <Fifth
            label={`1/5 da população nas cidades ${cut.lowName}`}
            range={`até ${cut.edge(s.lowEdge)}`}
            stats={s.low}
            size={statSize}
          />
          <Fifth
            label={`1/5 nas cidades ${cut.highName}`}
            range={`acima de ${cut.edge(s.highEdge)}`}
            stats={s.high}
            size={statSize}
          />
        </div>
        {cut.note ? (
          <div style={{ fontSize: 23 * u, color: T.muted, marginTop: 22 * u, lineHeight: 1.4 }}>{cut.note}</div>
        ) : null}
      </div>

      <Closing opacity={close} />

      <Footer source={`TSE, resultados de 2026 · IBGE, Censo ${YEAR}`} opacity={headerIn} />
    </Stage>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  const { u } = useLayout();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 * u, whiteSpace: "nowrap" }}>
      <span style={{ width: 18 * u, height: 18 * u, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function Fifth({
  label,
  range,
  stats,
  size,
}: {
  label: string;
  range: string;
  stats: Stats["low"];
  size: number;
}) {
  const { u } = useLayout();
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 23 * u, color: T.ink2, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 21 * u, color: T.muted, lineHeight: 1.3 }}>
        {range} · {int(stats.places)} cidades
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 * u, marginTop: 6 * u }}>
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: size,
            lineHeight: 1,
            color: COLOR.red,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {pct(stats.pt)}
        </span>
        <span style={{ fontSize: 24 * u, color: T.ink2 }}>{ELECTION.pt}</span>
      </div>
      <div style={{ fontSize: 24 * u, color: T.ink2, marginTop: 4 * u }}>
        <span style={{ color: COLOR.blue, fontWeight: 600 }}>{pct(stats.rival)}</span> {ELECTION.rival}
      </div>
    </div>
  );
}

function Closing({ opacity }: { opacity: number }) {
  const { portrait, u, pad } = useLayout();
  const frame = useCurrentFrame();
  if (opacity <= 0) return null;
  const later = interpolate(frame, [CLOSE_AT + 110, CLOSE_AT + 135], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: pad,
        right: pad,
        top: (portrait ? 560 : 270) * u,
        opacity,
        transform: `translateY(${(1 - opacity) * 30 * u}px)`,
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 64 : 60) * u, lineHeight: 1.05, maxWidth: 1500 * u }}>
        Nas cidades mais pobres, menos evangélicas e com menos diplomas, {ELECTION.pt} teve mais votos
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 * u, marginTop: 34 * u, maxWidth: 1300 * u }}>
        {CUTS.map((c, j) => (
          <div key={c.v} style={{ display: "flex", alignItems: "baseline", gap: (portrait ? 14 : 18) * u, fontSize: (portrait ? 22 : 24) * u, color: T.ink2 }}>
            <span style={{ width: (portrait ? 175 : 230) * u, color: T.muted, fontSize: 28 * u }}>{c.kicker}</span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 52 * u, color: COLOR.red }}>
              {pct(STATS[j]!.low.pt)}
            </span>
            <span style={{ width: (portrait ? 205 : 210) * u, whiteSpace: "nowrap" }}>{c.lowName.replace("com ", "")}</span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 52 * u, color: COLOR.red }}>
              {pct(STATS[j]!.high.pt)}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>{c.highName.replace("com ", "")}</span>
          </div>
        ))}
        <div style={{ fontSize: 21 * u, color: T.muted }}>
          Votos de {ELECTION.pt} no quinto da população que vive nas cidades de cada ponta
        </div>
      </div>
      <div style={{ opacity: later, fontSize: 28 * u, color: T.ink2, lineHeight: 1.4, marginTop: 40 * u, maxWidth: 1400 * u }}>
        Renda e religião não contam a mesma história: na metade da população que vive nas cidades mais pobres, {ELECTION.pt} teve {pct(quad(false, false))}{" "}
        onde há menos evangélicos e {pct(quad(false, true))} onde há mais.
        <div style={{ fontSize: 23 * u, color: T.muted, marginTop: 18 * u }}>
          São cidades, não pessoas: correlação, não causa. Uma cidade com mais evangélicos votar menos em {ELECTION.pt}{" "}
          não mostra como votaram os evangélicos dela.
        </div>
      </div>
    </div>
  );
}

export const def = motion<Props>({
  id: "VotoCenso",
  title: "Como votou cada Brasil",
  description: "O 1º turno de 2026 cidade a cidade, ao lado da renda, da religião e da escolaridade do Censo 2022.",
  component: VotoCenso,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
});
