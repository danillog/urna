/**
 * "Brasil x <país>": the two HDI lines drawn from 2000 to the last year, then the gap at
 * both ends, how many years behind Brazil is, and the dip of the pandemic.
 * One video per country: --props='{"pais":"CHL"}'.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import type { Cue } from "./sound";
import { DISPLAY, T } from "../common/theme";
import { Caption, FIRST_YEAR, HDI, Kicker, clamp, countryName, dec, ease, signed } from "./kit";

type Props = { pais: string };

const BR = "#fde725";
const OTHER = "#6cb4ea";

/** Article for the country in a sentence: "o Chile", "a Argentina". */
const ARTICLE: Record<string, "o" | "a"> = { CHL: "o", MEX: "o", ARG: "a", URY: "o", PRY: "o", PER: "o", COL: "a", VEN: "a", BOL: "a" };

const series = (iso: string) => HDI.values[iso]!.map((v, k) => ({ year: FIRST_YEAR + k, v })).filter((p) => p.v != null) as { year: number; v: number }[];

// Timeline.
const INTRO = 30;
const DRAW = 300;
const GAP_AT = INTRO + DRAW + 20;
const BEHIND_AT = GAP_AT + 170;
const DIP_AT = BEHIND_AT + 190;
const OUTRO_AT = DIP_AT + 160;
const DURATION = OUTRO_AT + 130;

function story(iso: string) {
  const br = series("BRA");
  const ot = series(iso);
  const years = br.map((p) => p.year).filter((y) => ot.some((p) => p.year === y));
  const at = (s: typeof br, y: number) => s.find((p) => p.year === y)!.v;
  const first = years[0]!;
  const last = years.at(-1)!;
  const gapFirst = at(ot, first) - at(br, first);
  const gapLast = at(ot, last) - at(br, last);
  // The year the other country first reached Brazil's latest figure.
  const caughtAt = ot.find((p) => p.v >= at(br, last))?.year;
  const dip = (s: typeof br) => {
    const before = at(s, 2019);
    const low = Math.min(at(s, 2020), at(s, 2021));
    return low - before;
  };
  return { br, ot, years, at, first, last, gapFirst, gapLast, caughtAt, dipBr: dip(br), dipOt: dip(ot) };
}

function Comparativo({ pais }: Props) {
  const frame = useCurrentFrame();
  const { width, u, pad } = useLayout();
  const s = story(pais);
  const name = countryName(pais);
  const art = ARTICLE[pais];
  /** "o Chile" */
  const the = art ? `${art} ${name}` : name;
  /** "do Chile" */
  const of = art ? `d${art} ${name}` : `de ${name}`;
  const all = [...s.br, ...s.ot].map((p) => p.v);
  const lo = Math.floor((Math.min(...all) - 0.01) * 20) / 20;
  const hi = Math.ceil((Math.max(...all) + 0.01) * 20) / 20;

  const box = { x: pad + 70 * u, y: 380 * u, w: width - 2 * pad - 230 * u, h: 820 * u };
  const X = (y: number) => box.x + ((y - s.first) / (s.last - s.first)) * box.w;
  const Y = (v: number) => box.y + (1 - (v - lo) / (hi - lo)) * box.h;

  // How far the lines are drawn, in years.
  const drawn = s.first + (s.last - s.first) * interpolate(frame, [INTRO, INTRO + DRAW], [0, 1], { ...clamp, easing: ease });
  const line = (pts: typeof s.br) => {
    const shown = pts.filter((p) => p.year <= drawn);
    const next = pts.find((p) => p.year > drawn);
    const prev = shown.at(-1)!;
    const tip = next ? { year: drawn, v: prev.v + (next.v - prev.v) * (drawn - prev.year) } : prev;
    return { d: [...shown, tip].map((p, i) => `${i ? "L" : "M"}${X(p.year)},${Y(p.v)}`).join(""), tip };
  };
  const lb = line(s.br);
  const lo2 = line(s.ot);

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const gapShow = interpolate(frame, [GAP_AT, GAP_AT + 20, BEHIND_AT - 10, BEHIND_AT], [0, 1, 1, 0], clamp);
  const behind = interpolate(frame, [BEHIND_AT, BEHIND_AT + 40], [0, 1], { ...clamp, easing: ease });
  const behindOut = interpolate(frame, [DIP_AT - 10, DIP_AT], [1, 0], clamp);
  const dip = interpolate(frame, [DIP_AT, DIP_AT + 20, OUTRO_AT - 10, OUTRO_AT], [0, 1, 1, 0], clamp);

  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += 0.05) ticks.push(Math.round(v * 100) / 100);
  const gapWord = (a: number, b: number) =>
    Math.abs(b) - Math.abs(a) > 0.005 ? "aumentou" : Math.abs(a) - Math.abs(b) > 0.005 ? "diminuiu" : "quase não mudou";
  const ahead = (g: number) => (g >= 0 ? the : "o Brasil");

  const label = (tip: { year: number; v: number }, color: string, text: string, dy: number) => (
    <div
      style={{
        position: "absolute",
        left: X(tip.year) + 18 * u,
        top: Y(tip.v) - 22 * u + dy,
        color,
        fontFamily: DISPLAY,
        fontWeight: 600,
        fontSize: 30 * u,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {text}
      <div style={{ fontSize: 34 * u, fontVariantNumeric: "tabular-nums", color: T.ink }}>{dec(tip.v)}</div>
    </div>
  );
  // Keep the two end labels apart when the lines are close.
  const sep = Y(lb.tip.v) - Y(lo2.tip.v);
  const push = Math.max(0, 70 * u - Math.abs(sep)) / 2;
  const brDy = sep >= 0 ? push : -push;

  return (
    <Stage>
      <Header title={`Brasil x ${name}`} subtitle={`IDH de ${s.first} a ${s.last}, ano a ano`} opacity={headerIn} />
      <svg width={width} height={box.y + box.h + 80 * u} style={{ position: "absolute", left: 0, top: 0, opacity: headerIn }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={box.x} x2={box.x + box.w} y1={Y(v)} y2={Y(v)} stroke={T.grid} strokeWidth={1.5 * u} />
            <text x={box.x - 14 * u} y={Y(v) + 8 * u} textAnchor="end" fill={T.muted} fontSize={22 * u}>
              {dec(v, 2)}
            </text>
          </g>
        ))}
        {[s.first, 2010, s.last].map((y) => (
          <text key={y} x={X(y)} y={box.y + box.h + 44 * u} textAnchor="middle" fill={T.muted} fontSize={24 * u}>
            {y}
          </text>
        ))}
        {/* Pandemic band. */}
        <rect x={X(2019)} y={box.y} width={X(2021) - X(2019)} height={box.h} fill={T.ink} opacity={0.08 * dip} />
        {/* Brazil's latest level, back to the year the other country reached it. */}
        {s.caughtAt && behind > 0 ? (
          <g opacity={behind * behindOut}>
            <line
              x1={X(s.last)}
              x2={X(s.last) + (X(s.caughtAt) - X(s.last)) * behind}
              y1={Y(s.at(s.br, s.last))}
              y2={Y(s.at(s.br, s.last))}
              stroke={BR}
              strokeWidth={3 * u}
              strokeDasharray={`${10 * u} ${8 * u}`}
            />
            <circle cx={X(s.caughtAt)} cy={Y(s.at(s.ot, s.caughtAt))} r={12 * u * behind} fill={OTHER} />
          </g>
        ) : null}
        {/* Gap at both ends. */}
        {[s.first, s.last].map((y) => (
          <line
            key={y}
            x1={X(y)}
            x2={X(y)}
            y1={Y(s.at(s.br, y))}
            y2={Y(s.at(s.ot, y))}
            stroke={T.ink}
            strokeWidth={4 * u}
            opacity={gapShow}
          />
        ))}
        <path d={lo2.d} fill="none" stroke={OTHER} strokeWidth={7 * u} strokeLinejoin="round" strokeLinecap="round" />
        <path d={lb.d} fill="none" stroke={BR} strokeWidth={7 * u} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(lo2.tip.year)} cy={Y(lo2.tip.v)} r={10 * u} fill={OTHER} />
        <circle cx={X(lb.tip.year)} cy={Y(lb.tip.v)} r={10 * u} fill={BR} />
      </svg>
      <div style={{ opacity: headerIn }}>
        {label(lo2.tip, OTHER, name, -brDy)}
        {label(lb.tip, BR, "Brasil", brDy)}
      </div>

      <Caption from={INTRO} to={GAP_AT} top={1330 * u}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 120 * u, lineHeight: 0.9 }}>{Math.floor(drawn)}</div>
        <div style={{ marginTop: 16 * u, color: T.ink2 }}>
          Em {s.first}, {the} tinha <b style={{ color: T.ink }}>{dec(s.at(s.ot, s.first))}</b> e o Brasil,{" "}
          <b style={{ color: T.ink }}>{dec(s.at(s.br, s.first))}</b>.
        </div>
      </Caption>
      <Caption from={GAP_AT} to={BEHIND_AT} top={1330 * u}>
        <Kicker>A distância</Kicker>
        Em {s.first}, {ahead(s.gapFirst)} estava <b>{dec(Math.abs(s.gapFirst))}</b> na frente. Em {s.last},{" "}
        {Math.sign(s.gapFirst) === Math.sign(s.gapLast) ? "a diferença" : `${ahead(s.gapLast)} passou à frente, e a diferença`}{" "}
        {gapWord(s.gapFirst, s.gapLast) === "quase não mudou" ? "quase não mudou" : `${gapWord(s.gapFirst, s.gapLast)} para`}{" "}
        <b>{dec(Math.abs(s.gapLast))}</b>.
      </Caption>
      <Caption from={BEHIND_AT} to={DIP_AT} top={1330 * u}>
        <Kicker color={BR}>Quantos anos atrás?</Kicker>
        {s.caughtAt === undefined ? (
          <>O Brasil já passou de todos os valores do IDH {of} desde {s.first}.</>
        ) : s.caughtAt <= s.first ? (
          <>
            O IDH do Brasil em {s.last} (<b>{dec(s.at(s.br, s.last))}</b>) ainda não chegou ao {of} em {s.first}:{" "}
            <b>mais de {s.last - s.first} anos</b> de distância.
          </>
        ) : (
          <>
            O Brasil de {s.last} tem o IDH que {the} tinha em <b>{s.caughtAt}</b>:{" "}
            <b>
              {s.last - s.caughtAt} {s.last - s.caughtAt === 1 ? "ano" : "anos"}
            </b>{" "}
            de distância.
          </>
        )}
      </Caption>
      <Caption from={DIP_AT} to={OUTRO_AT} top={1330 * u}>
        <Kicker>A pandemia</Kicker>
        De 2019 ao ponto mais baixo em 2020–2021: Brasil <b>{signed(s.dipBr)}</b>, {name} <b>{signed(s.dipOt)}</b>.{" "}
        <span style={{ color: T.ink2 }}>
          {s.at(s.br, s.last) > s.at(s.br, 2019) && s.at(s.ot, s.last) > s.at(s.ot, 2019)
            ? `Em ${s.last}, os dois já estavam acima de 2019.`
            : `Em ${s.last}: Brasil ${signed(s.at(s.br, s.last) - s.at(s.br, 2019))} e ${name} ${signed(s.at(s.ot, s.last) - s.at(s.ot, 2019))} em relação a 2019.`}
        </span>
      </Caption>
      <Caption from={OUTRO_AT} to={DURATION + 30} top={1330 * u}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 60 * u, lineHeight: 1.05 }}>
          E com os outros países das Américas?
        </div>
        <div style={{ color: T.ink2, fontSize: 32 * u, marginTop: 12 * u }}>
          Compare em <b style={{ color: T.ink }}>danillogomes.com/urna</b>
        </div>
      </Caption>
      <Footer source="IDH: PNUD, Relatório de Desenvolvimento Humano 2025" opacity={headerIn} />
    </Stage>
  );
}

export const COMPARISONS = [
  { value: "CHL", label: "Chile" },
  { value: "MEX", label: "México" },
  { value: "ARG", label: "Argentina" },
];

/** The lines drawing over a riser, a swish per beat, a chime at the end. */
export const cues: Cue[] = [
  { name: "whoosh", at: INTRO - 10 },
  { name: "pop", at: INTRO + DRAW - 4 },
  { name: "swish", at: GAP_AT + 2 },
  { name: "riser", at: BEHIND_AT - 20, volume: 0.35 },
  { name: "hit", at: BEHIND_AT + 30 },
  { name: "swish", at: DIP_AT + 2 },
  { name: "chime", at: OUTRO_AT + 6 },
];

export const def = motion<Props>({
  id: "IdhComparativo",
  title: "Brasil x vizinhos: o IDH de 2000 a 2023",
  description: "As duas linhas de IDH lado a lado: a distância, quantos anos o Brasil está atrás e a pandemia.",
  component: Comparativo,
  defaultProps: { pais: "CHL" },
  durationInFrames: () => DURATION,
  formats: ["portrait"],
  controls: [{ prop: "pais", label: "País", options: COMPARISONS }],
});
