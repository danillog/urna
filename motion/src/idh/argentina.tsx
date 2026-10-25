/**
 * "Como o IDH da Argentina é tão alto?": a very high HDI next to 41.7% poverty, explained in
 * five scenes: the three parts of the index, why income counts less than it seems, which
 * poverty line, how the typical income shrank, and the answer. Data: motion/data/argentina.json
 * (scripts/argentina.py).
 */
import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import data from "../../data/argentina.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import type { Cue } from "./sound";
import { DISPLAY, T } from "../common/theme";
import { Big, Caption, Kicker, between, clamp, dec, ease } from "./kit";

type Props = Record<string, never>;

interface Country {
  hdi: number;
  rank: number;
  ihdi: number;
  le: number;
  eys: number;
  mys: number;
  gnipc: number;
  index: { health: number; education: number; income: number };
  series: { hdi: (number | null)[]; gnipc: (number | null)[] };
  survey: Record<string, { extreme: number; median: number; gini: number }>;
}
const D = data as unknown as {
  lastYear: number;
  firstYear: number;
  indec: { period: string; poverty: number }[];
  countries: Record<"ARG" | "BRA", Country>;
};
const AR = D.countries.ARG;
const BR = D.countries.BRA;
const LAST = D.lastYear;

const AR_COLOR = "#74acdf";
const BR_COLOR = "#fde725";
const RED = "#ff7a6b";

/** Peak of Argentina's income per person, and how much it has lost since. */
const gniAt = (c: Country, y: number) => c.series.gnipc[y - D.firstYear]!;
const hdiAt = (c: Country, y: number) => c.series.hdi[y - D.firstYear]!;
const PEAK = D.firstYear + AR.series.gnipc.reduce<number>((best, v, i, a) => ((v ?? 0) > (a[best] ?? 0) ? i : best), 0);
const GNI_DROP = gniAt(AR, LAST) / gniAt(AR, PEAK) - 1;
/** Typical (median) income per day, from the peak year's survey to the last. */
const surveyYear = (c: Country, y: number) => c.survey[String(y)] ?? c.survey[Object.keys(c.survey).filter((k) => +k <= y).at(-1)!]!;
const MEDIAN_FROM = PEAK;
const MEDIAN_TO = LAST;

const pct = (v: number, digits = 1) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const one = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const thousands = (v: number) => `US$ ${one(v / 1000)} mil`;
const change = (r: number) => `${r >= 0 ? "+" : "−"}${Math.round(Math.abs(r) * 100)}%`;

// Scenes.
const HOOK = [0, 220] as const;
const PARTS = [220, 620] as const;
const LOG = [620, 940] as const;
const LINE = [940, 1300] as const;
const RULER = [1300, 1600] as const;
const ANSWER = [1600, 1860] as const;
const DURATION = ANSWER[1];

/** A pair of bars, Argentina over Brazil, growing in from `at`. */
function Pair({
  a,
  b,
  max,
  at,
  fmt,
  valueWidth = 150,
}: {
  a: number;
  b: number;
  max: number;
  at: number;
  fmt: (v: number) => string;
  valueWidth?: number;
}) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const g = ease(interpolate(frame, [at, at + 30], [0, 1], clamp));
  const bar = (v: number, color: string, label: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 14 * u, height: 46 * u }}>
      <span style={{ width: 150 * u, fontSize: 26 * u, color }}>{label}</span>
      <div style={{ flex: 1, height: 28 * u, background: T.surface, borderRadius: 4 * u }}>
        <div style={{ width: `${(v / max) * 100 * g}%`, height: "100%", background: color, borderRadius: 4 * u }} />
      </div>
      <span style={{ width: valueWidth * u, textAlign: "right", fontSize: 30 * u, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {fmt(v)}
      </span>
    </div>
  );
  return (
    <>
      {bar(a, AR_COLOR, "Argentina")}
      {bar(b, BR_COLOR, "Brasil")}
    </>
  );
}

function Block({ at, title, detail, children }: { at: number; title: string; detail: ReactNode; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const o = interpolate(frame, [at, at + 15], [0, 1], clamp);
  return (
    <div style={{ opacity: o, marginTop: 34 * u }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 * u }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 48 * u }}>{title}</span>
        <span style={{ fontSize: 24 * u, color: T.muted, textAlign: "right" }}>{detail}</span>
      </div>
      {children}
    </div>
  );
}

function Argentina(_: Props) {
  const frame = useCurrentFrame();
  const { width, u, pad } = useLayout();
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const top = 300 * u;

  // Line scene: income per person and HDI, 2000 to the last year, drawn left to right.
  const years = Array.from({ length: LAST - D.firstYear + 1 }, (_, k) => D.firstYear + k);
  const draw = ease(interpolate(frame, [LINE[0] + 20, LINE[0] + 140], [0, 1], clamp));
  const chart = (
    values: number[],
    lo: number,
    hi: number,
    y0: number,
    h: number,
    color: string,
    fmt: (v: number) => string,
  ) => {
    const w = width - 2 * pad - 140 * u;
    const X = (i: number) => pad + (i / (values.length - 1)) * w;
    const Y = (v: number) => y0 + (1 - (v - lo) / (hi - lo)) * h;
    const n = Math.max(1, Math.floor(draw * (values.length - 1)) + 1);
    const pts = values.slice(0, n).map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join("");
    const peakI = PEAK - D.firstYear;
    return (
      <g>
        <line x1={pad} x2={pad + w} y1={y0 + h} y2={y0 + h} stroke={T.rule} strokeWidth={2 * u} />
        {draw > 0.6 ? (
          <line
            x1={X(peakI)}
            x2={X(peakI)}
            y1={y0 - 10 * u}
            y2={y0 + h}
            stroke={T.muted}
            strokeDasharray={`${6 * u} ${6 * u}`}
            strokeWidth={2 * u}
            opacity={interpolate(draw, [0.6, 0.8], [0, 1], clamp)}
          />
        ) : null}
        <path d={pts} fill="none" stroke={color} strokeWidth={6 * u} strokeLinejoin="round" strokeLinecap="round" />
        {n > peakI ? (
          <>
            <circle cx={X(peakI)} cy={Y(values[peakI]!)} r={9 * u} fill={color} />
            <text x={X(peakI)} y={Y(values[peakI]!) - 20 * u} textAnchor="middle" fill={T.ink} fontSize={26 * u}>
              {fmt(values[peakI]!)}
            </text>
          </>
        ) : null}
        {n === values.length ? (
          <>
            <circle cx={X(values.length - 1)} cy={Y(values.at(-1)!)} r={9 * u} fill={color} />
            <text x={X(values.length - 1) + 16 * u} y={Y(values.at(-1)!) + 9 * u} fill={T.ink} fontSize={28 * u} fontWeight={600}>
              {fmt(values.at(-1)!)}
            </text>
          </>
        ) : null}
        <text x={pad} y={y0 + h + 34 * u} fill={T.muted} fontSize={22 * u}>
          {D.firstYear}
        </text>
        <text x={X(peakI)} y={y0 + h + 34 * u} fill={T.muted} fontSize={22 * u} textAnchor="middle">
          {PEAK}
        </text>
        <text x={pad + w} y={y0 + h + 34 * u} fill={T.muted} fontSize={22 * u} textAnchor="end">
          {LAST}
        </text>
      </g>
    );
  };
  const lineOpacity = between(frame, LINE[0], LINE[1]);

  const indec = D.indec;
  const extremeYear = LAST;

  return (
    <Stage>
      <Header title="Como o IDH da Argentina é tão alto?" subtitle="Se tanta gente lá é pobre" opacity={headerIn} />

      {/* 1. The puzzle. */}
      <Caption from={HOOK[0]} to={HOOK[1]} top={top + 60 * u}>
        <Kicker color={AR_COLOR}>IDH da Argentina, {LAST}</Kicker>
        <Big size={220} color={AR_COLOR}>
          {dec(AR.hdi)}
        </Big>
        <div style={{ fontSize: 36 * u, color: T.ink2, marginTop: 14 * u }}>
          {AR.rank}º do mundo, “muito alto”. O Brasil é {BR.rank}º.
        </div>
        <div style={{ opacity: interpolate(frame, [85, 100], [0, 1], clamp), marginTop: 70 * u }}>
          <Kicker color={RED}>Pobreza na Argentina, {indec[0]!.period}</Kicker>
          <Big size={220} color={RED}>
            {pct(indec[0]!.poverty)}
          </Big>
          <div style={{ fontSize: 36 * u, color: T.ink2, marginTop: 14 * u }}>das pessoas, segundo o INDEC.</div>
        </div>
        <div
          style={{
            opacity: interpolate(frame, [150, 165], [0, 1], clamp),
            marginTop: 70 * u,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 64 * u,
          }}
        >
          Como as duas coisas são verdade?
        </div>
      </Caption>

      {/* 2. Three parts. */}
      <Caption from={PARTS[0]} to={PARTS[1]} top={top}>
        <Kicker>O IDH junta três notas, de 0 a 1</Kicker>
        <Block at={PARTS[0] + 20} title="Saúde" detail={`expectativa de vida: ${one(AR.le)} × ${one(BR.le)} anos`}>
          <Pair a={AR.index.health} b={BR.index.health} max={1} at={PARTS[0] + 30} fmt={(v) => dec(v)} />
        </Block>
        <Block
          at={PARTS[0] + 80}
          title="Educação"
          detail={`anos de estudo: ${one(AR.mys)} × ${one(BR.mys)}`}
        >
          <Pair a={AR.index.education} b={BR.index.education} max={1} at={PARTS[0] + 90} fmt={(v) => dec(v)} />
        </Block>
        <Block at={PARTS[0] + 140} title="Renda" detail={`por pessoa: ${thousands(AR.gnipc)} × ${thousands(BR.gnipc)}`}>
          <Pair a={AR.index.income} b={BR.index.income} max={1} at={PARTS[0] + 150} fmt={(v) => dec(v)} />
        </Block>
        <div
          style={{
            opacity: interpolate(frame, [PARTS[0] + 220, PARTS[0] + 240], [0, 1], clamp),
            marginTop: 50 * u,
            fontSize: 38 * u,
            lineHeight: 1.35,
          }}
        >
          A maior vantagem está na <b style={{ color: AR_COLOR }}>educação</b>: universidade pública e gratuita, e{" "}
          {one(AR.eys)} anos de escola esperados para uma criança, acima do teto do índice (18).
        </div>
      </Caption>

      {/* 3. Income on a log scale. */}
      <Caption from={LOG[0]} to={LOG[1]} top={top}>
        <Kicker>A renda conta menos do que parece</Kicker>
        <div style={{ fontSize: 40 * u, lineHeight: 1.35 }}>
          A renda por pessoa da Argentina é <b style={{ color: AR_COLOR }}>{change(AR.gnipc / BR.gnipc - 1)}</b> maior
          que a do Brasil.
        </div>
        <div style={{ marginTop: 20 * u }}>
          <Pair a={AR.gnipc} b={BR.gnipc} max={AR.gnipc * 1.1} at={LOG[0] + 20} fmt={thousands} valueWidth={210} />
        </div>
        <div style={{ opacity: interpolate(frame, [LOG[0] + 90, LOG[0] + 105], [0, 1], clamp), marginTop: 50 * u }}>
          <div style={{ fontSize: 40 * u, lineHeight: 1.35 }}>
            Mas a nota de renda do IDH é só <b style={{ color: AR_COLOR }}>{change(AR.index.income / BR.index.income - 1)}</b>{" "}
            maior:
          </div>
          <div style={{ marginTop: 20 * u }}>
            <Pair a={AR.index.income} b={BR.index.income} max={1} at={LOG[0] + 105} fmt={(v) => dec(v)} />
          </div>
        </div>
        <div
          style={{
            opacity: interpolate(frame, [LOG[0] + 170, LOG[0] + 185], [0, 1], clamp),
            marginTop: 44 * u,
            fontSize: 34 * u,
            lineHeight: 1.4,
            color: T.ink2,
          }}
        >
          A renda entra em escala logarítmica: cada dólar a mais vale menos que o anterior. Uma crise que corta a renda
          mexe pouco no índice.
        </div>
      </Caption>

      {/* 4. Income fell, HDI did not. */}
      <div style={{ position: "absolute", left: 0, top: 0, opacity: lineOpacity }}>
        <svg width={width} height={1600 * u}>
          <text x={pad} y={top + 250 * u} fill={AR_COLOR} fontSize={30 * u} fontWeight={600}>
            Renda por pessoa (US$ mil, PPC)
          </text>
          {chart(
            years.map((y) => gniAt(AR, y) / 1000),
            18,
            31,
            top + 300 * u,
            300 * u,
            AR_COLOR,
            (v) => one(v),
          )}
          <text x={pad} y={top + 720 * u} fill={T.ink} fontSize={30 * u} fontWeight={600}>
            IDH
          </text>
          {chart(
            years.map((y) => hdiAt(AR, y)),
            0.78,
            0.88,
            top + 770 * u,
            300 * u,
            T.ink,
            (v) => dec(v),
          )}
        </svg>
      </div>
      <Caption from={LINE[0]} to={LINE[1]} top={top}>
        <Kicker>Argentina, {D.firstYear}–{LAST}</Kicker>
        <div style={{ fontSize: 38 * u, lineHeight: 1.3 }}>
          Desde {PEAK}, a renda por pessoa caiu <b style={{ color: RED }}>{change(GNI_DROP)}</b>. O IDH foi de{" "}
          {dec(hdiAt(AR, PEAK))} para <b>{dec(AR.hdi)}</b>.
        </div>
      </Caption>
      <Caption from={LINE[0] + 160} to={LINE[1]} top={top + 1160 * u}>
        <span style={{ color: T.ink2, fontSize: 34 * u }}>
          Saúde e educação não despencam numa crise. A renda, sim.
        </span>
      </Caption>

      {/* 5. Which poverty line. */}
      <Caption from={RULER[0]} to={RULER[1]} top={top}>
        <Kicker>Pobre comparado com o quê?</Kicker>
        <div style={{ fontSize: 34 * u, color: T.ink2 }}>
          Pobreza extrema, linha internacional de US$ 3 por dia ({extremeYear}):
        </div>
        <div style={{ marginTop: 14 * u }}>
          <Pair
            a={surveyYear(AR, extremeYear).extreme}
            b={surveyYear(BR, extremeYear).extreme}
            max={60}
            at={RULER[0] + 15}
            fmt={(v) => pct(v)}
          />
        </div>
        <div style={{ fontSize: 34 * u, color: T.ink2, marginTop: 40 * u }}>
          Pobreza pela linha argentina (INDEC), que é o custo de uma cesta básica no país:
        </div>
        <div style={{ marginTop: 14 * u }}>
          {indec.map((p, i) => {
            const g = ease(interpolate(frame, [RULER[0] + 60 + i * 12, RULER[0] + 90 + i * 12], [0, 1], clamp));
            return (
              <div key={p.period} style={{ display: "flex", alignItems: "center", gap: 14 * u, height: 46 * u }}>
                <span style={{ width: 210 * u, fontSize: 26 * u, color: AR_COLOR }}>{p.period}</span>
                <div style={{ flex: 1, height: 28 * u, background: T.surface, borderRadius: 4 * u }}>
                  <div style={{ width: `${(p.poverty / 60) * 100 * g}%`, height: "100%", background: RED, borderRadius: 4 * u }} />
                </div>
                <span style={{ width: 110 * u, textAlign: "right", fontSize: 30 * u, fontVariantNumeric: "tabular-nums" }}>
                  {pct(p.poverty)}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            opacity: interpolate(frame, [RULER[0] + 140, RULER[0] + 155], [0, 1], clamp),
            marginTop: 40 * u,
            fontSize: 36 * u,
            lineHeight: 1.35,
          }}
        >
          A régua argentina é bem mais alta. Quando os preços sobem mais rápido que os salários, muita gente cai abaixo
          dela, e sai quando a inflação baixa.
        </div>
      </Caption>

      {/* 6. Typical income and the answer. */}
      <Caption from={ANSWER[0]} to={DURATION + 30} top={top}>
        <Kicker>Renda típica por dia (mediana, US$ PPC)</Kicker>
        <div style={{ marginTop: 6 * u }}>
          <Pair
            a={surveyYear(AR, MEDIAN_TO).median}
            b={surveyYear(BR, MEDIAN_TO).median}
            max={surveyYear(AR, MEDIAN_FROM).median * 1.1}
            at={ANSWER[0] + 10}
            fmt={(v) => `${one(v)}`}
          />
        </div>
        <div style={{ fontSize: 30 * u, color: T.ink2, marginTop: 10 * u }}>
          Em {MEDIAN_FROM}, o argentino típico tinha {one(surveyYear(AR, MEDIAN_FROM).median)} por dia:{" "}
          <b style={{ color: RED }}>{change(surveyYear(AR, MEDIAN_TO).median / surveyYear(AR, MEDIAN_FROM).median - 1)}</b> até{" "}
          {MEDIAN_TO}.
        </div>
        <div
          style={{
            opacity: interpolate(frame, [ANSWER[0] + 70, ANSWER[0] + 85], [0, 1], clamp),
            marginTop: 56 * u,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 60 * u,
            lineHeight: 1.08,
          }}
        >
          A Argentina não é um país pobre na média. É um país que ficou mais pobre do que já foi.
        </div>
        <div
          style={{
            opacity: interpolate(frame, [ANSWER[0] + 130, ANSWER[0] + 145], [0, 1], clamp),
            marginTop: 26 * u,
            fontSize: 32 * u,
            lineHeight: 1.4,
            color: T.ink2,
          }}
        >
          O IDH mede médias de saúde, educação e renda. Ajustado pela desigualdade, cai para {dec(AR.ihdi)} (o do
          Brasil, para {dec(BR.ihdi)}).
        </div>
      </Caption>

      <Footer
        source={`PNUD (RDH 2025), Banco Mundial (PIP; Argentina: só áreas urbanas), INDEC`}
        opacity={headerIn}
      />
    </Stage>
  );
}

/** Hits on the two numbers of the puzzle, whoosh per scene, a riser into the answer. */
export const cues: Cue[] = [
  { name: "hit", at: 4 },
  { name: "hit", at: 86 },
  { name: "pop", at: 152 },
  ...[PARTS, LOG, LINE, RULER, ANSWER].map((s) => ({ name: "whoosh" as const, at: s[0] - 6 })),
  ...[30, 90, 150].map((d) => ({ name: "pop" as const, at: PARTS[0] + d, volume: 0.35 })),
  { name: "riser", at: ANSWER[0] + 12, volume: 0.35 },
  { name: "hit", at: ANSWER[0] + 70 },
  { name: "chime", at: ANSWER[0] + 132 },
];

export const def = motion<Props>({
  id: "IdhArgentina",
  title: "Como o IDH da Argentina é tão alto?",
  description: "IDH muito alto e 41,7% de pobreza: as três notas do índice, a renda em log, a régua da pobreza e a renda que encolheu.",
  component: Argentina,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait"],
});
