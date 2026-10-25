/**
 * "Quem mora onde", in motion: a capital's bairros (the IBGE's, or São Paulo's from
 * OpenStreetMap with approximate borders, as on the site) colored by one Census 2022 indicator,
 * then a camera that visits the bairros where it is highest and pulls back to the whole city.
 * The default is the original: same-sex couples in São Paulo.
 */
import { geoMercator, geoPath } from "d3-geo";
import type { ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import capitalsJson from "../../../data/generated/capitals.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { DISPLAY, T, css, int, mixRgb, pct, rgb } from "../common/theme";

type Indicator = "sameSex" | "income" | "negro";

interface Bairro {
  id: string;
  bairros: string[];
  population: number;
  sameSex?: number | null;
  income?: number | null;
  negro?: number | null;
}
interface Unit {
  areas: Bairro[];
  topology: Topology<{ areas: GeometryCollection }>;
  source?: "osm";
}
interface Capital {
  code: string;
  name: string;
  units: Partial<Record<string, Unit>>;
}

const CAPITALS = (capitalsJson as unknown as { capitals: Capital[] }).capitals;

/** The capitals with the IBGE's bairros covering (nearly) everyone, and São Paulo's. */
const PLACES: Record<string, { short: string; in: string }> = {
  "3550308": { short: "São Paulo", in: "em São Paulo" },
  "3304557": { short: "Rio", in: "no Rio" },
  "4314902": { short: "Porto Alegre", in: "em Porto Alegre" },
  "2927408": { short: "Salvador", in: "em Salvador" },
  "2611606": { short: "Recife", in: "no Recife" },
  "3106200": { short: "Belo Horizonte", in: "em Belo Horizonte" },
  "4106902": { short: "Curitiba", in: "em Curitiba" },
  "2304400": { short: "Fortaleza", in: "em Fortaleza" },
};

type Props = { stops: number; capital: string; indicator: Indicator };

/** A stop needs this many people, so the camera does not land on a handful of houses. */
const MIN_POP = 1000;

const plural = (n: number, one: string, many: string) => `${int(n)} ${n === 1 ? one : many}`;

interface Spec {
  title: (place: string) => string;
  subtitle: string;
  /** Upper bounds of the color steps, in the indicator's unit. */
  steps: number[];
  labels: string[];
  hue: string;
  bright: string;
  value: (v: number) => string;
  unit: [string, string];
  closing: (ranked: Bairro[], get: (b: Bairro) => number) => ReactNode;
  note: string;
  source: string;
}

const SPECS: Record<Indicator, Spec> = {
  sameSex: {
    title: (place) => `Casais do mesmo sexo ${place}`,
    subtitle: "De cada 100 casais que moram juntos, quantos são do mesmo sexo, por bairro (Censo 2022)",
    steps: [1, 2, 4, 8, Infinity],
    labels: ["até 1%", "1–2%", "2–4%", "4–8%", "8% ou mais"],
    hue: "#9085e9",
    bright: "#b9b0f5",
    value: (v) => pct(v, 1),
    unit: ["dos casais", "são do mesmo sexo"],
    closing: (ranked, get) => {
      const over5 = ranked.filter((a) => get(a) >= 5).length;
      const under1 = ranked.filter((a) => get(a) < 1).length;
      return (
        <>
          {/* Text nodes split as in the original, so São Paulo's render stays pixel-identical. */}
          Em {over5}
          {`${over5 === 1 ? " bairro" : " bairros"}, perto do centro, mais de 5 em cada 100 casais são do mesmo sexo. Em `}
          {under1} dos {int(ranked.length)}, menos de 1.
        </>
      );
    },
    note: "O Censo não pergunta orientação sexual: o dado conta só casais que moram juntos e declararam o companheiro, e não mede a população LGBT+.",
    source: "IBGE, Censo 2022 (setores censitários)",
  },
  income: {
    title: (place) => `Renda por pessoa ${place}`,
    subtitle:
      "Renda média da casa dividida pelos moradores, por bairro, em reais de julho de 2022 (Censo 2022)",
    steps: [1000, 2000, 4000, 8000, Infinity],
    labels: ["até R$ 1 mil", "1–2 mil", "2–4 mil", "4–8 mil", "8 mil ou mais"],
    hue: "#c98500",
    bright: "#f2c25a",
    value: (v) => `R$ ${int(v)}`,
    unit: ["por pessoa,", "por mês"],
    closing: (ranked, get) => {
      const top = ranked[0]!;
      const big = ranked.filter((a) => a.population >= MIN_POP);
      const low = get(big[big.length - 1]!);
      const poorest = big.filter((a) => get(a) === low).map((a) => a.bairros[0]!);
      const names =
        poorest.length > 1 ? `${poorest.slice(0, -1).join(", ")} e ${poorest.at(-1)}` : poorest[0];
      const times = Math.round(get(top) / low);
      return `${top.bairros[0]}: R$ ${int(get(top))} por pessoa. ${names}: R$ ${int(low)}, ${times} vezes menos.`;
    },
    note: "A renda vem da amostra do Censo, que o IBGE publica por área de ponderação: num bairro, é a das suas áreas, pesadas pela população, e bairros vizinhos podem ter o mesmo valor.",
    source: "IBGE, Censo 2022 (amostra, por área de ponderação)",
  },
  negro: {
    title: (place) => `Pretos e pardos ${place}`,
    subtitle: "De cada 100 moradores, quantos se declararam pretos ou pardos, por bairro (Censo 2022)",
    steps: [15, 30, 45, 60, Infinity],
    labels: ["até 15%", "15–30%", "30–45%", "45–60%", "60% ou mais"],
    hue: "#ef8a3a",
    bright: "#f7b77f",
    value: (v) => pct(v, 1),
    unit: ["dos moradores", "são pretos ou pardos"],
    closing: (ranked, get) => {
      const people = ranked.reduce((s, a) => s + a.population, 0);
      const city = ranked.reduce((s, a) => s + get(a) * a.population, 0) / people;
      const over60 = ranked.filter((a) => get(a) >= 60).length;
      const under15 = ranked.filter((a) => get(a) < 15).length;
      return `Na cidade toda, ${pct(city, 0)} dos moradores são pretos ou pardos. Em ${plural(over60, "bairro", "bairros")}, mais de 60 em cada 100; em ${under15}, menos de 15.`;
    },
    note: "Cor ou raça como cada pessoa declarou ao Censo 2022, contando todas as pessoas. Negros: pretos e pardos somados, como o IBGE agrega.",
    source: "IBGE, Censo 2022 (setores censitários)",
  },
};

const LOW = rgb("#22252b");

const REVEAL = 75;
const MOVE = 32;
const HOLD = 78;
const BACK = 50;
const OUTRO = 210;
const duration = ({ stops }: Props) => REVEAL + stops * (MOVE + HOLD) + BACK + OUTRO;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);

interface Camera {
  x: number;
  y: number;
  k: number;
}

const unitOf = (code: string) => CAPITALS.find((c) => c.code === code)!.units.bairros!;

/** Each capital × indicator: the bairros ranked, highest first. */
const rankCache = new Map<string, Bairro[]>();
function rank(capital: string, indicator: Indicator) {
  const key = `${capital}/${indicator}`;
  const hit = rankCache.get(key);
  if (hit) return hit;
  const out = unitOf(capital)
    .areas.filter((a) => a[indicator] != null)
    .sort((a, b) => b[indicator]! - a[indicator]!);
  rankCache.set(key, out);
  return out;
}

const cache = new Map<
  string,
  { paths: Map<string, string>; centroid: Map<string, [number, number]>; size: Map<string, [number, number]> }
>();
function project(capital: string, w: number, h: number) {
  const key = `${capital}/${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { topology } = unitOf(capital);
  const fc = feature(topology, topology.objects.areas);
  const projection = geoMercator().fitSize([w, h], fc);
  const path = geoPath(projection);
  const paths = new Map<string, string>();
  const centroid = new Map<string, [number, number]>();
  const size = new Map<string, [number, number]>();
  for (const f of fc.features) {
    paths.set(String(f.id), path(f) ?? "");
    centroid.set(String(f.id), path.centroid(f));
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    size.set(String(f.id), [x1 - x0, y1 - y0]);
  }
  const out = { paths, centroid, size };
  cache.set(key, out);
  return out;
}

function QuemMoraOnde({ stops, capital, indicator }: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const spec = SPECS[indicator];
  const unit = unitOf(capital);
  const AREAS = unit.areas;
  const get = (b: Bairro) => b[indicator]!;
  const ranked = rank(capital, indicator);
  const VIOLET = rgb(spec.hue);
  const STEPS = spec.steps;
  const stepOf = (v: number) => STEPS.findIndex((s) => v < s);
  const shade = (i: number) => css(mixRgb(LOW, VIOLET, 0.18 + (0.82 * i) / (STEPS.length - 1)));
  const colorOf = (v: number | null | undefined) => (v == null ? "#1a1c20" : shade(stepOf(v)));
  const osm = unit.source === "osm";

  const box = portrait
    ? { x: 0, y: 250 * u, w: width, h: 1060 * u }
    : { x: 640 * u, y: 0, w: width - 640 * u, h: height };
  const { paths, centroid, size } = project(capital, Math.round(box.w), Math.round(box.h));
  const tour = ranked.filter((a) => a.population >= MIN_POP).slice(0, stops);

  // Camera: the whole city, then each stop, then the whole city again.
  const whole: Camera = { x: box.w / 2, y: box.h / 2, k: 1 };
  const at = (b: Bairro): Camera => {
    const [x, y] = centroid.get(b.id)!;
    // Close in, but a big bairro (Barra da Tijuca) keeps to half the frame.
    const [bw, bh] = size.get(b.id)!;
    const fit = Math.min((0.5 * box.w) / bw, (0.5 * box.h) / bh);
    return { x, y, k: Math.max(1.5, Math.min(4.2, fit)) };
  };
  const cams: Camera[] = [whole, ...tour.map(at), whole];
  const tourStart = REVEAL;
  const t = frame - tourStart;
  const step = MOVE + HOLD;
  let cam = whole;
  let stopIdx = -1;
  let hold = 0;
  if (t >= 0) {
    const i = Math.min(tour.length, Math.floor(t / step));
    const into = t - i * step;
    const moveLen = i === tour.length ? BACK : MOVE;
    const q = ease(interpolate(into, [0, moveLen], [0, 1], clamp));
    const a = cams[i]!;
    const b = cams[i + 1]!;
    // Zoom in log space so the move feels even.
    const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * q);
    cam = { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, k };
    if (i < tour.length) {
      stopIdx = i;
      hold = interpolate(into, [MOVE, MOVE + 12, step - 10, step], [0, 1, 1, 0], clamp);
    }
  }
  const tx = box.w / 2 - cam.x * cam.k;
  const ty = box.h / 2 - cam.y * cam.k;

  // Reveal: bairros fill from the lowest value to the highest.
  const revealed = interpolate(frame, [10, REVEAL - 5], [0, AREAS.length], clamp);
  const order = new Map([...ranked].reverse().map((a, i) => [a.id, i]));
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const outroAt = REVEAL + tour.length * step + BACK;
  const outro = interpolate(frame, [outroAt, outroAt + 20], [0, 1], clamp);
  const stop = stopIdx >= 0 ? tour[stopIdx]! : null;

  return (
    <Stage>
      <svg
        width={box.w}
        height={box.h}
        style={{ position: "absolute", left: box.x, top: box.y, overflow: "hidden" }}
      >
        <g transform={`translate(${tx},${ty}) scale(${cam.k})`}>
          {AREAS.map((a) => {
            const shown = (order.get(a.id) ?? 0) < revealed;
            const isStop = stop?.id === a.id;
            return (
              <path
                key={a.id}
                d={paths.get(a.id)}
                fill={shown ? colorOf(a[indicator]) : "#1a1c20"}
                stroke={isStop ? T.ink : T.bg}
                strokeWidth={(isStop ? 2.4 : 0.6) / cam.k}
                strokeOpacity={isStop ? hold : 1}
              />
            );
          })}
        </g>
      </svg>
      {/* Fade the map's edges under the text. */}
      {portrait ? null : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(90deg, ${T.bg} 33%, transparent 45%)`,
          }}
        />
      )}
      <Header title={spec.title(PLACES[capital]!.in)} subtitle={spec.subtitle} opacity={headerIn} />

      {/* The stop's card. */}
      {stop ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            right: portrait ? pad : undefined,
            width: portrait ? undefined : 540 * u,
            ...(portrait ? { top: 1470 * u } : { top: 360 * u }),
            opacity: hold,
          }}
        >
          <div style={{ fontSize: 24 * u, color: T.muted }}>
            {ranked.indexOf(stop) + 1}º de {int(ranked.length)} bairros
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 72 * u, lineHeight: 1.05 }}>
            {stop.bairros[0]}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 * u, marginTop: 6 * u }}>
            <span
              style={{
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 110 * u,
                lineHeight: 1,
                color: spec.bright,
              }}
            >
              {spec.value(get(stop))}
            </span>
            <span style={{ fontSize: 26 * u, color: T.ink2, lineHeight: 1.3 }}>
              {spec.unit[0]}
              <br />
              {spec.unit[1]}
            </span>
          </div>
        </div>
      ) : null}

      {/* Closing: the contrast, and what the number is not. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: portrait ? pad : undefined,
          width: portrait ? undefined : 540 * u,
          ...(portrait ? { top: 1430 * u } : { top: 330 * u }),
          opacity: outro,
        }}
      >
        <div style={{ fontSize: 34 * u, lineHeight: 1.35, fontWeight: 500 }}>{spec.closing(ranked, get)}</div>
        <div style={{ fontSize: 21 * u, lineHeight: 1.45, color: T.muted, marginTop: 18 * u }}>
          {`${spec.note} ${osm ? "Bairros do OpenStreetMap, com fronteiras aproximadas." : "Bairros do IBGE."}`}
        </div>
      </div>

      {/* Legend. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          ...(portrait ? { top: 1345 * u, right: pad } : { bottom: 120 * u, width: 540 * u }),
          display: "flex",
          gap: 6 * u,
          opacity: headerIn,
        }}
      >
        {spec.labels.map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ height: 12 * u, borderRadius: 3 * u, background: shade(i) }} />
            <div style={{ fontSize: 18 * u, color: T.muted, marginTop: 6 * u }}>{label}</div>
          </div>
        ))}
      </div>
      <Footer source={`${spec.source} · bairros: ${osm ? "OpenStreetMap" : "IBGE"}`} opacity={headerIn} />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "SaoPaulo",
  title: "Quem mora onde: os bairros de uma capital",
  description:
    "Os bairros de uma capital por um dado do Censo 2022 (casais do mesmo sexo, renda, pretos e pardos), com a câmera passando pelos maiores.",
  component: QuemMoraOnde,
  defaultProps: { stops: 6, capital: "3550308", indicator: "sameSex" },
  durationInFrames: duration,
  formats: ["portrait", "landscape"],
  controls: [
    {
      prop: "capital",
      label: "Capital",
      options: Object.entries(PLACES).map(([value, p]) => ({ value, label: p.short })),
    },
    {
      prop: "indicator",
      label: "Dado",
      options: [
        { value: "sameSex", label: "Casais do mesmo sexo" },
        { value: "income", label: "Renda por pessoa" },
        { value: "negro", label: "Pretos e pardos" },
      ],
    },
    {
      prop: "stops",
      label: "Bairros visitados",
      options: [
        { value: 4, label: "4" },
        { value: 6, label: "6" },
        { value: 8, label: "8" },
      ],
    },
  ],
});
