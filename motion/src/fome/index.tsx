/**
 * "Insegurança alimentar não é pobreza": what food insecurity measures (questions about the plate, not income),
 * the Americas by the FAO's food insecurity, year by year; the surprise of the US next to
 * Brazil, in percent and in people; the USDA's series in the US until it was discontinued; and
 * Brazil's EBIA. FAO numbers (people) never share an axis with USDA or IBGE ones (households).
 *
 * Data: data/generated/americas-indicators.json, indicator "food" (pipeline.americas.indicators);
 * populations from motion/data/pobreza-absoluta.json (World Bank PIP, 2024).
 */
import { geoAzimuthalEqualArea, geoPath } from "d3-geo";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
import americasJson from "../../../data/generated/americas.json";
import indicatorsJson from "../../../data/generated/americas-indicators.json";
import topoJson from "../../../data/generated/americas.topo.json";
import type { AmericasData } from "../../../src/model/americas";
import { STEPS, colorStep, step, valueAt, type IndicatorData } from "../../../src/model/indicators";
import absolutaJson from "../../data/pobreza-absoluta.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, rgb } from "../common/theme";
import { Bed, Sfx } from "../video/sound";

type RGB = [number, number, number];
type Props = Record<string, never>;

const IND = indicatorsJson as unknown as IndicatorData;
const FOOD = IND.indicators.food as IndicatorData["indicators"]["food"] & {
  missingWhy?: Record<string, string>;
  usStates?: { source: string; periods: string[]; values: Record<string, (number | null)[]> };
  usNational?: Record<string, number>;
  brStates?: { source: string; years: number[]; values: Record<string, (number | null)[]> };
  brNational?: Record<string, number>;
};
const AMERICAS = americasJson as unknown as AmericasData & { territories: Record<string, string> };
const topology = topoJson as unknown as Topology<{
  americas: GeometryCollection<{ name: string; country: string; code: string }>;
}>;
const POP = new Map(
  (absolutaJson as unknown as { countries: { iso: string; population: number; urbanOnly: boolean }[] }).countries
    .filter((c) => !c.urbanOnly)
    .map((c) => [c.iso, c.population]),
);

/** FAO's first 3-year average is 2014–2016, stored at its centre year. */
const FIRST = (() => {
  let first = Infinity;
  for (const s of Object.values(FOOD.values))
    s.forEach((v, i) => {
      if (v != null) first = Math.min(first, IND.firstYear + i);
    });
  return first;
})();
const LAST = FOOD.lastYear;
const span = (centre: number) => `${centre - 1}–${centre + 1}`;

// Timeline (frames at 30 fps).
const S1 = 0; // poverty ≠ food insecurity
const S2 = 330; // the map, year by year
const MAP_STEP = 42;
const S3 = S2 + 40 + (LAST - FIRST + 1) * MAP_STEP + 80; // latest values, then people
const S4 = S3 + 390; // the US: USDA series and states
const S5 = S4 + 480; // Brazil: EBIA series and states
const S6 = S5 + 420; // closing
const DURATION = S6 + 210;

/** The site's q0–q9 (viridis): q9 is the light, better end (the lowest share). */
const Q = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];
const NO_DATA: RGB = rgb("#23272c");
const qColor = (v: number) => Q[colorStep("food", step("food", v))]!;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
const easeOut = Easing.out(Easing.cubic);
const lerp = (a: RGB, b: RGB, p: number): RGB => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const millions = (n: number) => `${Math.round(n / 1e6).toLocaleString("pt-BR")} milhões`;
const nameOf = (iso: string) => AMERICAS.countries[iso]?.name ?? AMERICAS.territories[iso] ?? iso;
const latest = (iso: string) => valueAt(IND, "food", iso, LAST);

const REGION_NAMES = new Map(
  topology.objects.americas.geometries.map((g) => {
    const p = g.properties as { code: string; name: string };
    return [p.code, p.name] as const;
  }),
);

// ---- Numbers, all computed -----------------------------------------------------------------

const featured = ["USA", "CAN", "BRA", "MEX", "ARG"].filter((iso) => latest(iso));
const allLatest = Object.keys(FOOD.values)
  .map((iso) => ({ iso, r: latest(iso) }))
  .filter((x): x is { iso: string; r: NonNullable<typeof x.r> } => x.r !== null);
const worst = [...allLatest].sort((a, b) => b.r.value - a.r.value)[0]!;
const bars = [...new Set([...featured, worst.iso])]
  .map((iso) => ({ iso, value: latest(iso)!.value }))
  .sort((a, b) => b.value - a.value);
const people = ["USA", "MEX", "BRA", "CAN"]
  .filter((iso) => latest(iso) && POP.has(iso))
  .map((iso) => ({ iso, n: (latest(iso)!.value / 100) * POP.get(iso)! }))
  .sort((a, b) => b.n - a.n);

const usSeries = Object.entries(FOOD.usNational ?? {})
  .map(([y, v]) => ({ year: Number(y), v }))
  .sort((a, b) => a.year - b.year);
const usPeak = usSeries.reduce((a, b) => (b.v > a.v ? b : a), usSeries[0] ?? { year: 0, v: 0 });
const usLast = usSeries.at(-1);
const usPeriods = FOOD.usStates?.periods ?? [];
const usStates = Object.entries(FOOD.usStates?.values ?? {})
  .map(([code, s]) => ({ code, v: s[s.length - 1] ?? null }))
  .filter((s): s is { code: string; v: number } => s.v != null)
  .sort((a, b) => b.v - a.v);

const brSeries = Object.entries(FOOD.brNational ?? {})
  .map(([y, v]) => ({ year: Number(y), v }))
  .sort((a, b) => a.year - b.year);
const brYears = FOOD.brStates?.years ?? [];
const brStates = Object.entries(FOOD.brStates?.values ?? {})
  .map(([code, s]) => ({ code, v: s[s.length - 1] ?? null }))
  .filter((s): s is { code: string; v: number } => s.v != null)
  .sort((a, b) => b.v - a.v);
/** The low before the 2018 rise (2013), labelled with the first, the rise and the last. */
const brLowBefore = brSeries.filter((s) => s.year < 2018).reduce<(typeof brSeries)[number] | null>((a, b) => (!a || b.v < a.v ? b : a), null);

// ---- The map ------------------------------------------------------------------------------

interface Prepared {
  paths: Path2D[];
  sweep: number[];
  colors: RGB[][];
  borders: Path2D;
}
const cache = new Map<string, Prepared>();
function prepare(W: number, H: number, box: [number, number, number, number]): Prepared {
  const key = `${W}x${H}:${box.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const object = topology.objects.americas;
  const all = feature(topology, object);
  const fc = { ...all, features: all.features.filter((f) => f.properties.code !== "US-HI") };
  const projection = geoAzimuthalEqualArea().rotate([72, -5, H > W ? 0 : 22]);
  projection.fitExtent(
    [
      [box[0], box[1]],
      [box[2], box[3]],
    ],
    { ...fc, features: fc.features.filter((f) => !["CAN", "GRL"].includes(f.properties.country)) },
  );
  const path = geoPath(projection);
  const xs = fc.features.map((f) => path.centroid(f)[0]);
  const fin = xs.filter(Number.isFinite);
  const [minX, maxX] = [Math.min(...fin), Math.max(...fin)];
  const countries = fc.features.map((f) => f.properties.country);
  const colors: RGB[][] = [];
  for (let y = FIRST; y <= LAST; y++) {
    colors.push(
      countries.map((c) => {
        const r = valueAt(IND, "food", c, y);
        return r ? rgb(qColor(r.value)) : NO_DATA;
      }),
    );
  }
  type G = GeometryObject;
  const countryOf = (g: G) => (g.properties as { country?: string } | undefined)?.country;
  const prepared: Prepared = {
    paths: fc.features.map((f) => new Path2D(path(f) ?? "")),
    sweep: xs.map((x) => (Number.isFinite(x) ? (x - minX) / (maxX - minX) : 0.5)),
    colors,
    borders: new Path2D(path(mesh(topology, object, (a: G, b: G) => countryOf(a) !== countryOf(b))) ?? ""),
  };
  cache.set(key, prepared);
  return prepared;
}

function MapScene() {
  const frame = useCurrentFrame() - S2;
  const { width, height, portrait, u, pad } = useLayout();
  const ref = useRef<HTMLCanvasElement>(null);
  const box: [number, number, number, number] = portrait
    ? [pad, 280 * u, width - pad, height - 560 * u]
    : [width * 0.4, 230 * u, width - pad, height - pad];
  const P = prepare(width, height, box);
  const years = LAST - FIRST + 1;
  const k = Math.max(0, Math.min(years - 1, Math.floor((frame - 40) / MAP_STEP)));
  const into = frame - 40 - k * MAP_STEP;

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const appear = interpolate(frame, [0, 25], [0, 1], clamp);
    for (let i = 0; i < P.paths.length; i++) {
      let c: RGB;
      if (k === 0) c = P.colors[0]![i]!;
      else {
        const d = P.sweep[i]! * 10;
        c = lerp(P.colors[k - 1]![i]!, P.colors[k]![i]!, ease(interpolate(into, [d, d + 14], [0, 1], clamp)));
      }
      ctx.fillStyle = css(lerp(rgb(T.bg), c, appear));
      ctx.fill(P.paths[i]!);
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = T.bg;
    ctx.lineWidth = 1.3;
    ctx.stroke(P.borders);
  }, [frame, width, height, k, into, P]);

  const year = FIRST + k;
  const blank = Object.keys(FOOD.missingWhy ?? {}).filter((iso) => !valueAt(IND, "food", iso, LAST));
  const panel = portrait
    ? { left: pad, right: pad, top: height - 520 * u }
    : { left: pad, width: width * 0.4 - pad * 1.5, top: 300 * u };
  return (
    <>
      <canvas ref={ref} width={width} height={height} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", ...panel }}>
        <div style={{ fontSize: 24 * u, color: T.muted }}>média de {span(year)}</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 130 * u, lineHeight: 1 }}>{year}</div>
        <div style={{ fontSize: 22 * u, color: T.ink2, margin: `${14 * u}px 0 ${10 * u}px` }}>
          % da população em insegurança alimentar moderada ou grave
        </div>
        <div style={{ display: "flex", gap: 3 * u }}>
          {STEPS.food.map((from, i) => (
            <div key={from} style={{ flex: 1 }}>
              <div style={{ height: 12 * u, background: Q[colorStep("food", i)] }} />
              <div style={{ fontSize: 15 * u, color: T.muted, marginTop: 4 * u }}>{from}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 18 * u, color: T.muted, marginTop: 14 * u, display: "flex", gap: 8 * u, alignItems: "center" }}>
          <i style={{ width: 14 * u, height: 14 * u, background: css(NO_DATA), display: "inline-block" }} />
          sem dado: {blank.map(nameOf).join(", ")}
        </div>
      </div>
    </>
  );
}

// ---- Pieces -------------------------------------------------------------------------------

function useIn(from: number, len = 14) {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, from + len], [0, 1], { ...clamp, easing: easeOut });
}

function Fade({ from, until, children, style }: { from: number; until: number; children: ReactNode; style?: React.CSSProperties }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [from, from + 14, until - 12, until], [0, 1, 1, 0], clamp);
  return <div style={{ position: "absolute", opacity: o, transform: `translateY(${(1 - Math.min(1, o * 2)) * 16}px)`, ...style }}>{children}</div>;
}

function Title({ children, size = 52 }: { children: ReactNode; size?: number }) {
  const { u } = useLayout();
  return <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size * u, lineHeight: 1.08 }}>{children}</div>;
}

/** Horizontal bars growing in one by one. */
function Bars({
  rows,
  from,
  max,
  format,
  width,
}: {
  rows: { label: string; value: number; color: string; strong?: boolean }[];
  from: number;
  max: number;
  format: (v: number) => string;
  width: number;
}) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const { portrait } = useLayout();
  const z = portrait ? 1.3 : 1;
  const labelW = 230 * u * z;
  const barW = width - labelW - 170 * u * z;
  return (
    <div>
      {rows.map((r, i) => {
        const p = interpolate(frame, [from + i * 8, from + i * 8 + 22], [0, 1], { ...clamp, easing: easeOut });
        return (
          <div key={r.label} style={{ display: "flex", alignItems: "center", height: 58 * u * z, opacity: Math.min(1, p * 2) }}>
            <div style={{ width: labelW, fontSize: 25 * u * z, fontWeight: r.strong ? 600 : 400, color: r.strong ? T.ink : T.ink2 }}>
              {r.label}
            </div>
            <div style={{ width: (barW * r.value * p) / max, height: 30 * u * z, background: r.color, borderRadius: 3 * u }} />
            <div style={{ marginLeft: 12 * u, fontSize: 25 * u * z, fontWeight: r.strong ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>
              {format(r.value * p)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A line over years that draws itself; optional labelled points. */
function Line({
  series,
  from,
  len,
  w,
  h,
  color,
  marks,
  yMax,
}: {
  series: { year: number; v: number }[];
  from: number;
  len: number;
  w: number;
  h: number;
  color: string;
  marks: { year: number; label: string }[];
  yMax: number;
}) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  if (series.length < 2) return null;
  const y0 = series[0]!.year;
  const y1 = series.at(-1)!.year;
  const X = (y: number) => ((y - y0) / (y1 - y0)) * w;
  const Y = (v: number) => h - (v / yMax) * h;
  const p = interpolate(frame, [from, from + len], [0, 1], clamp);
  const upTo = y0 + (y1 - y0) * p;
  const shown = series.filter((s) => s.year <= upTo);
  const d = shown.map((s, i) => `${i ? "L" : "M"}${X(s.year)},${Y(s.v)}`).join(" ");
  const ticks = Array.from({ length: Math.floor(yMax / 5) + 1 }, (_, i) => i * 5);
  return (
    <svg width={w + 80 * u} height={h + 50 * u} style={{ overflow: "visible" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={w} y1={Y(t)} y2={Y(t)} stroke={T.grid} strokeDasharray="3 4" />
          <text x={-8 * u} y={Y(t)} dy="0.32em" textAnchor="end" fill={T.muted} fontSize={16 * u}>
            {t}%
          </text>
        </g>
      ))}
      {(series.length <= 8
        ? series.map((s) => s.year)
        : [y0, ...series.map((s) => s.year).filter((y) => y % 5 === 0 && y !== y0 && y !== y1), y1]
      )
        // A year right before the next label would print on top of it.
        .filter((y, i, ys) => i === ys.length - 1 || ys[i + 1]! - y > 1)
        .map((y) => (
        <text key={y} x={X(y)} y={h + 26 * u} textAnchor="middle" fill={T.muted} fontSize={16 * u}>
          {y}
        </text>
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth={4 * u} strokeLinejoin="round" strokeLinecap="round" />
      {shown.map((s) => (
        <circle key={s.year} cx={X(s.year)} cy={Y(s.v)} r={4 * u} fill={color} />
      ))}
      {marks
        .filter((m) => m.year <= upTo)
        .map((m) => {
          const s = series.find((x) => x.year === m.year)!;
          return (
            <text key={m.year} x={X(m.year)} y={Y(s.v) - 14 * u} textAnchor="middle" fill={T.ink} fontSize={19 * u} fontWeight={600}>
              {m.label}
            </text>
          );
        })}
    </svg>
  );
}

/** A small ranked table: name, bar, value. */
function Table({ rows, from, max, w }: { rows: { name: string; v: number; tone: string }[]; from: number; max: number; w: number }) {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const z = portrait ? 1.3 : 1;
  return (
    <div>
      {rows.map((r, i) => {
        const p = interpolate(frame, [from + i * 6, from + i * 6 + 14], [0, 1], { ...clamp, easing: easeOut });
        return (
          <div
            key={r.name}
            style={{ display: "flex", alignItems: "center", height: 44 * u * z, opacity: p, borderBottom: `1px solid ${T.rule}`, gap: 14 * u }}
          >
            <div style={{ width: 260 * u * z, fontSize: 22 * u * z }}>{r.name}</div>
            <div style={{ width: ((w - 440 * u * z) * r.v) / max, height: 14 * u * z, background: r.tone, borderRadius: 3 * u }} />
            <div style={{ fontSize: 22 * u * z, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{pct(r.v)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---- The motion ---------------------------------------------------------------------------

function Fome() {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const headerIn = useIn(0, 15);
  const cw = width - 2 * pad;
  const top = portrait ? 380 * u : 250 * u;

  const brazil = latest("BRA");
  const usa = latest("USA");
  const surprise =
    usa && brazil && usa.value > brazil.value
      ? `Nos EUA, ${pct(usa.value)}: mais que no Brasil (${pct(brazil.value)})`
      : usa && brazil
        ? `EUA ${pct(usa.value)}, Brasil ${pct(brazil.value)}`
        : "";
  const usPeople = people.find((p) => p.iso === "USA");

  const usTop = usStates.slice(0, 5);
  const usBottom = usStates.slice(-3);
  const brTop = brStates.slice(0, 5);
  const brBottom = brStates.slice(-3);
  const usMax = Math.max(...usStates.map((s) => s.v), 1);
  const brMax = Math.max(...brStates.map((s) => s.v), 1);

  return (
    <Stage>
      <Header title="Insegurança alimentar não é pobreza" subtitle="Quem não consegue comer o suficiente, nas Américas" opacity={headerIn} />

      {/* 1. Two measures. */}
      <Fade from={S1 + 15} until={S2} style={{ left: pad, right: pad, top }}>
        <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: 28 * u }}>
          <Card title="Pobreza" accent={T.muted} from={S1 + 20}>
            <div style={{ fontSize: 30 * u, lineHeight: 1.35 }}>Renda abaixo de uma linha.</div>
            <div style={{ fontSize: 24 * u, color: T.ink2, marginTop: 10 * u }}>
              No mapa anterior: menos de US$ 8,30 por dia por pessoa.
            </div>
          </Card>
          <Card title="Insegurança alimentar" accent={Q[3]!} from={S1 + 70}>
            <div style={{ fontSize: 30 * u, lineHeight: 1.35 }}>Perguntas sobre o prato.</div>
            <div style={{ fontSize: 17 * u, color: T.muted, margin: `${14 * u}px 0 ${6 * u}px`, letterSpacing: 1 }}>
              PERGUNTAS DA ESCALA DA FAO · NOS ÚLTIMOS 12 MESES…
            </div>
            {[
              "…você teve medo de não ter comida suficiente?",
              "…comeu menos do que achava que devia?",
              "…ficou um dia inteiro sem comer?",
            ].map((q, i) => (
              <Question key={q} from={S1 + 110 + i * 35}>
                {q}
              </Question>
            ))}
          </Card>
        </div>
      </Fade>

      {/* 2. The map. */}
      {frame >= S2 && frame < S3 ? <MapScene /> : null}

      {/* 3. Latest values, then people. */}
      <Fade from={S3} until={S3 + 200} style={{ left: pad, right: pad, top }}>
        <Title>{surprise}</Title>
        <div style={{ fontSize: 22 * u, color: T.muted, margin: `${10 * u}px 0 ${24 * u}px` }}>
          FAO, média de {span(LAST)} · % da população
        </div>
        <Bars
          from={S3 + 20}
          width={cw}
          max={Math.max(...bars.map((b) => b.value))}
          format={pct}
          rows={bars.map((b) => ({
            label: nameOf(b.iso),
            value: b.value,
            color: b.iso === "USA" ? COLOR.sky : b.iso === "BRA" ? COLOR.gold : "#5a5e63",
            strong: b.iso === "USA" || b.iso === "BRA",
          }))}
        />
      </Fade>
      <Fade from={S3 + 205} until={S4} style={{ left: pad, right: pad, top }}>
        <Title>{usPeople ? `Nos EUA, cerca de ${millions(usPeople.n)} de pessoas` : ""}</Title>
        <div style={{ fontSize: 22 * u, color: T.muted, margin: `${10 * u}px 0 ${24 * u}px` }}>
          pessoas em insegurança alimentar moderada ou grave (% da FAO × população)
        </div>
        <Bars
          from={S3 + 225}
          width={cw}
          max={Math.max(...people.map((p) => p.n))}
          format={(n) => millions(n)}
          rows={people.map((p) => ({
            label: nameOf(p.iso),
            value: p.n,
            color: p.iso === "USA" ? COLOR.sky : p.iso === "BRA" ? COLOR.gold : "#5a5e63",
            strong: p.iso === "USA",
          }))}
        />
      </Fade>

      {/* 4. The US, by the USDA. */}
      <Fade from={S4} until={S4 + 260} style={{ left: pad, right: pad, top }}>
        <Title size={46}>EUA: domicílios em insegurança alimentar, pelo USDA</Title>
        <div style={{ fontSize: 21 * u, color: T.muted, margin: `${8 * u}px 0 ${50 * u}px` }}>
          Outra escala e outra base (domicílios): não se compara com a FAO
        </div>
        <div style={{ paddingLeft: 50 * u }}>
          <Line
            series={usSeries}
            from={S4 + 25}
            len={120}
            w={cw - 140 * u}
            h={portrait ? 460 * u : 330 * u}
            color={COLOR.sky}
            yMax={20}
            marks={[
              { year: usPeak.year, label: `${usPeak.year}: ${pct(usPeak.v)}` },
              ...(usLast ? [{ year: usLast.year, label: pct(usLast.v) }] : []),
            ]}
          />
        </div>
        <StopCard from={S4 + 155}>
          O governo americano encerrou a pesquisa em 2025: {usLast?.year} foi o último ano.
        </StopCard>
      </Fade>
      <Fade from={S4 + 265} until={S5} style={{ left: pad, right: pad, top }}>
        <Title size={46}>Os estados, {usPeriods.at(-1)}</Title>
        <div style={{ fontSize: 21 * u, color: T.muted, margin: `${8 * u}px 0 ${20 * u}px` }}>USDA · % dos domicílios</div>
        <Table from={S4 + 280} w={cw} max={usMax} rows={usTop.map((s) => ({ name: REGION_NAMES.get(s.code) ?? s.code, v: s.v, tone: COLOR.sky }))} />
        <div style={{ height: 18 * u, color: T.muted, fontSize: 20 * u, margin: `${4 * u}px 0` }}>…</div>
        <Table from={S4 + 320} w={cw} max={usMax} rows={usBottom.map((s) => ({ name: REGION_NAMES.get(s.code) ?? s.code, v: s.v, tone: "#5a5e63" }))} />
      </Fade>

      {/* 5. Brazil, by the IBGE. */}
      <Fade from={S5} until={S5 + 230} style={{ left: pad, right: pad, top }}>
        <Title size={46}>Brasil: domicílios em insegurança moderada ou grave</Title>
        <div style={{ fontSize: 21 * u, color: T.muted, margin: `${8 * u}px 0 ${50 * u}px` }}>IBGE (EBIA) · % dos domicílios</div>
        <div style={{ paddingLeft: 50 * u }}>
          <Line
            series={brSeries}
            from={S5 + 25}
            len={110}
            w={cw - 140 * u}
            h={portrait ? 460 * u : 330 * u}
            color={COLOR.gold}
            yMax={20}
            marks={brSeries
              .filter((s, i) => i === 0 || s === brLowBefore || s.year === 2018 || i === brSeries.length - 1)
              .map((s) => ({ year: s.year, label: `${s.year}: ${pct(s.v)}` }))}
          />
        </div>
      </Fade>
      <Fade from={S5 + 235} until={S6} style={{ left: pad, right: pad, top }}>
        <Title size={46}>Os estados, {brYears.at(-1)}</Title>
        <div style={{ fontSize: 21 * u, color: T.muted, margin: `${8 * u}px 0 ${20 * u}px` }}>IBGE (EBIA) · % dos domicílios</div>
        <Table from={S5 + 250} w={cw} max={brMax} rows={brTop.map((s) => ({ name: REGION_NAMES.get(s.code) ?? s.code, v: s.v, tone: COLOR.gold }))} />
        <div style={{ height: 18 * u, color: T.muted, fontSize: 20 * u, margin: `${4 * u}px 0` }}>…</div>
        <Table from={S5 + 290} w={cw} max={brMax} rows={brBottom.map((s) => ({ name: REGION_NAMES.get(s.code) ?? s.code, v: s.v, tone: "#5a5e63" }))} />
      </Fade>

      {/* 6. Closing. */}
      <Fade from={S6 + 10} until={DURATION + 30} style={{ left: pad, right: pad, top: portrait ? 700 * u : 380 * u }}>
        <Title size={72}>Pobreza mede a renda.</Title>
        <Title size={72}>
          <span style={{ color: Q[7] }}>Insegurança alimentar mede o prato.</span>
        </Title>
        <div style={{ fontSize: 22 * u, color: T.muted, marginTop: 30 * u, maxWidth: 1100 * u, lineHeight: 1.45 }}>
          Escalas e bases diferentes: FAO conta pessoas; USDA e IBGE contam domicílios.
        </div>
      </Fade>

      <Footer source="FAO (FIES), USDA ERS, IBGE (EBIA)" opacity={headerIn} />

      <Bed volume={0.12} />
      <Sfx name="pop" at={S1 + 20} volume={0.35} />
      <Sfx name="pop" at={S1 + 70} volume={0.35} />
      {[0, 1, 2].map((i) => (
        <Sfx key={i} name="tick" at={S1 + 110 + i * 35} volume={0.35} />
      ))}
      <Sfx name="whoosh" at={S2 - 8} volume={0.3} />
      {Array.from({ length: LAST - FIRST + 1 }, (_, i) => (i % 3 === 0 ? <Sfx key={i} name="tick" at={S2 + 40 + i * MAP_STEP} volume={0.25} /> : null))}
      <Sfx name="swish" at={S3} volume={0.3} />
      <Sfx name="hit" at={S3 + 205} volume={0.35} />
      <Sfx name="swish" at={S4} volume={0.3} />
      <Sfx name="hit" at={S4 + 155} volume={0.4} />
      <Sfx name="swish" at={S5} volume={0.3} />
      <Sfx name="chime" at={S6 + 10} volume={0.35} />
    </Stage>
  );
}

function Card({ title, accent, from, children }: { title: string; accent: string; from: number; children: ReactNode }) {
  const { u } = useLayout();
  const p = useIn(from);
  return (
    <div
      style={{
        flex: 1,
        opacity: p,
        transform: `translateY(${(1 - p) * 20}px)`,
        background: T.surface,
        border: `1px solid ${T.rule}`,
        borderTop: `6px solid ${accent}`,
        borderRadius: 10 * u,
        padding: 30 * u,
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 48 * u, marginBottom: 12 * u }}>{title}</div>
      {children}
    </div>
  );
}

function Question({ from, children }: { from: number; children: ReactNode }) {
  const { u } = useLayout();
  const p = useIn(from);
  return (
    <div style={{ opacity: p, fontSize: 24 * u, lineHeight: 1.4, padding: `${6 * u}px 0`, color: T.ink2 }}>{children}</div>
  );
}

function StopCard({ from, children }: { from: number; children: ReactNode }) {
  const { u } = useLayout();
  const p = useIn(from);
  return (
    <div
      style={{
        opacity: p,
        marginTop: 30 * u,
        borderLeft: `5px solid ${COLOR.red}`,
        padding: `${10 * u}px ${20 * u}px`,
        fontSize: 28 * u,
        fontWeight: 600,
        lineHeight: 1.35,
        background: T.surface,
      }}
    >
      {children}
    </div>
  );
}

export const def = motion<Props>({
  id: "Fome",
  title: "Insegurança alimentar não é pobreza",
  description:
    "Insegurança alimentar nas Américas: o que mede, o mapa da FAO ano a ano, os EUA (pesquisa encerrada em 2025) e o Brasil.",
  component: Fome,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
});
