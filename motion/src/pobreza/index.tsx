/**
 * "A pobreza nas Américas, 2000–2026": every country by the share of people living on less
 * than US$ 8,30 a day (World Bank PIP, 2021 PPP), year by year, with the site's color steps;
 * then the camera visits Brazil and the United States, and an end card names the gaps.
 *
 * Data: data/generated/americas-indicators.json, indicator "poverty" (pipeline.americas.indicators).
 * Optional fields, used when the pipeline writes them: `fallback` (an older or consumption
 * survey, painted striped), `missingWhy` (countries left blank on purpose) and
 * `officialByRegion` (the US official rate by state: another, much higher line, never a color).
 */
import { geoAzimuthalEqualArea, geoPath } from "d3-geo";
import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
import americasJson from "../../../data/generated/americas.json";
import indicatorsJson from "../../../data/generated/americas-indicators.json";
import topoJson from "../../../data/generated/americas.topo.json";
import type { AmericasData } from "../../../src/model/americas";
import { STEPS, colorStep, step, valueAt, type IndicatorData } from "../../../src/model/indicators";
import { Footer, Header, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { BODY, DISPLAY, T, rgb } from "../common/theme";
import { Bed, Sfx } from "../video/sound";

type RGB = [number, number, number];

interface Survey {
  year: number;
  value: number;
  welfare: "income" | "consumption";
}
interface PovertyExtras {
  fallback?: Record<string, Survey[]>;
  fallbackMaxAge?: number;
  missingWhy?: Record<string, string>;
  officialByRegion?: Record<string, (number | null)[]>;
  officialSource?: string;
}

const INDICATORS = indicatorsJson as unknown as IndicatorData;
const POVERTY = INDICATORS.indicators.poverty as IndicatorData["indicators"]["poverty"] & PovertyExtras;
const AMERICAS = americasJson as unknown as AmericasData & { territories: Record<string, string> };
const topology = topoJson as unknown as Topology<{
  americas: GeometryCollection<{ name: string; country: string; code: string }>;
}>;

type Props = Record<string, never>;

const FIRST = 2000;
const LAST = 2026;
const YEARS = LAST - FIRST + 1;
const INTRO = 45;
const STEP = 30;
const FADE = 18;
const BRAZIL = 165;
const USA = 165;
const OUTRO = 180;
const yearsEnd = INTRO + YEARS * STEP;
const brazilAt = yearsEnd;
const usaAt = brazilAt + BRAZIL;
const outroAt = usaAt + USA;
const DURATION = outroAt + OUTRO;

/** The site's q0–q9 (viridis): q9 is the light, better end; for poverty, the lowest share. */
const Q = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];
const NO_DATA: RGB = rgb("#23272c");

const nameOf = (iso: string) => AMERICAS.countries[iso]?.name ?? AMERICAS.territories[iso] ?? iso;
const qColor = (v: number) => Q[colorStep("poverty", step("poverty", v))]!;

/** A country's reading in a year: the main series, else a striped fallback survey. */
function reading(iso: string, year: number): { value: number; year: number; striped: boolean } | null {
  const main = valueAt(INDICATORS, "poverty", iso, year);
  if (main) return { ...main, striped: false };
  const max = POVERTY.fallbackMaxAge ?? 10;
  const s = (POVERTY.fallback?.[iso] ?? [])
    .filter((x) => x.year <= year && year - x.year <= max)
    .sort((a, b) => b.year - a.year)[0];
  return s ? { value: s.value, year: s.year, striped: true } : null;
}

interface Prepared {
  paths: Path2D[];
  countries: string[];
  sweep: number[];
  colors: RGB[][];
  striped: boolean[][];
  borders: Path2D;
  inner: Path2D;
  /** Bounding boxes in canvas pixels: Brazil and the contiguous United States. */
  focus: Record<"BRA" | "USA", [number, number, number, number]>;
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
  const paths = fc.features.map((f) => new Path2D(path(f) ?? ""));
  const xs = fc.features.map((f) => path.centroid(f)[0]);
  const fin = xs.filter(Number.isFinite);
  const minX = Math.min(...fin);
  const maxX = Math.max(...fin);
  const countries = fc.features.map((f) => f.properties.country);
  const colors: RGB[][] = [];
  const striped: boolean[][] = [];
  const byCountry = new Map<string, ReturnType<typeof reading>>();
  for (let y = FIRST; y <= LAST; y++) {
    byCountry.clear();
    colors.push(
      countries.map((c) => {
        if (!byCountry.has(c)) byCountry.set(c, reading(c, y));
        const r = byCountry.get(c);
        return r ? rgb(qColor(r.value)) : NO_DATA;
      }),
    );
    striped.push(countries.map((c) => Boolean(byCountry.get(c)?.striped)));
  }
  const boundsOf = (keep: (f: (typeof fc.features)[number]) => boolean): [number, number, number, number] => {
    const [[x0, y0], [x1, y1]] = path.bounds({ ...fc, features: fc.features.filter(keep) });
    return [x0, y0, x1, y1];
  };
  type G = GeometryObject;
  const countryOf = (g: G) => (g.properties as { country?: string } | undefined)?.country;
  const prepared: Prepared = {
    paths,
    countries,
    sweep: xs.map((x) => (Number.isFinite(x) ? (x - minX) / (maxX - minX) : 0.5)),
    colors,
    striped,
    borders: new Path2D(path(mesh(topology, object, (a: G, b: G) => countryOf(a) !== countryOf(b))) ?? ""),
    inner: new Path2D(path(mesh(topology, object, (a: G, b: G) => a !== b && countryOf(a) === countryOf(b))) ?? ""),
    focus: {
      BRA: boundsOf((f) => f.properties.country === "BRA"),
      USA: boundsOf((f) => f.properties.country === "USA" && f.properties.code !== "US-AK"),
    },
  };
  cache.set(key, prepared);
  return prepared;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
const lerp = (a: RGB, b: RGB, p: number): RGB => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Diagonal stripes in the ground color, laid over a fill to mark an older or consumption survey. */
let stripes: CanvasPattern | null = null;
function stripePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (stripes) return stripes;
  const c = document.createElement("canvas");
  c.width = c.height = 10;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(15,17,19,0.55)";
  g.lineWidth = 3;
  g.beginPath();
  for (const o of [-10, 0, 10]) {
    g.moveTo(o, 10);
    g.lineTo(o + 10, 0);
  }
  g.stroke();
  stripes = ctx.createPattern(c, "repeat");
  return stripes;
}

/** Camera: the whole continent, or a country's box filling part of the map. */
interface Cam {
  x: number;
  y: number;
  k: number;
}

function Pobreza() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { portrait, u, pad } = useLayout();
  const ref = useRef<HTMLCanvasElement>(null);
  const box: [number, number, number, number] = portrait
    ? [pad, 300 * u, width - pad, height - 560 * u]
    : [width * 0.42, 250 * u, width - pad, height - pad * 0.8];
  const P = prepare(width, height, box);

  const k = Math.max(0, Math.min(YEARS - 1, Math.floor((frame - INTRO) / STEP)));
  const into = frame - INTRO - k * STEP;
  const year = FIRST + k;

  // Camera keyframes.
  const whole: Cam = { x: width / 2, y: height / 2, k: 1 };
  const onto = (b: [number, number, number, number], fill: number): Cam => {
    const w = box[2] - box[0];
    const h = box[3] - box[1];
    const kk = Math.min(3.2, fill * Math.min(w / (b[2] - b[0]), h / (b[3] - b[1])));
    // The country's centre moves to the map box's centre.
    return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, k: kk };
  };
  const mapCentre = { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
  const brazil = onto(P.focus.BRA, 0.8);
  const usa = onto(P.focus.USA, 0.8);
  const moveTo = (a: Cam, b: Cam, from: number, len: number): Cam => {
    const q = ease(interpolate(frame, [from, from + len], [0, 1], clamp));
    return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, k: Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * q) };
  };
  let cam: Cam = whole;
  const wholeAsTarget: Cam = { x: mapCentre.x, y: mapCentre.y, k: 1 };
  if (frame >= brazilAt) cam = moveTo(wholeAsTarget, brazil, brazilAt, 40);
  if (frame >= usaAt) cam = moveTo(brazil, usa, usaAt, 45);
  if (frame >= outroAt) cam = moveTo(usa, wholeAsTarget, outroAt, 45);
  const zoomed = frame >= brazilAt;

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, width, height);
    // The map never runs under the title; zoomed in, it stays inside its box, clear of the cards.
    ctx.beginPath();
    if (zoomed) ctx.rect(box[0] - pad * 0.5, box[1] - 10 * u, box[2] - box[0] + pad, box[3] - box[1] + 20 * u);
    else ctx.rect(0, 215 * u, width, height);
    ctx.clip();
    if (zoomed) {
      // Point (cam.x, cam.y) goes to the map box's centre, scaled by cam.k.
      ctx.setTransform(cam.k, 0, 0, cam.k, mapCentre.x - cam.x * cam.k, mapCentre.y - cam.y * cam.k);
    }
    const appear = interpolate(frame, [0, 25], [0, 1], clamp);
    const pattern = stripePattern(ctx);
    const focusIso = frame >= usaAt && frame < outroAt ? "USA" : frame >= brazilAt && frame < usaAt ? "BRA" : null;
    for (let i = 0; i < P.paths.length; i++) {
      let c: RGB;
      if (frame < INTRO || k === 0) c = P.colors[0]![i]!;
      else {
        const d = P.sweep[i]! * (FADE * 0.45);
        const q = ease(interpolate(into, [d, d + FADE * 0.55], [0, 1], clamp));
        c = lerp(P.colors[k - 1]![i]!, P.colors[k]![i]!, q);
      }
      if (focusIso && P.countries[i] !== focusIso) c = lerp(c, rgb(T.bg), 0.55);
      c = lerp(rgb(T.bg), c, appear);
      ctx.fillStyle = css(c);
      ctx.fill(P.paths[i]!);
      if (pattern && P.striped[k]![i]) {
        ctx.fillStyle = pattern;
        ctx.fill(P.paths[i]!);
      }
    }
    const z = zoomed ? cam.k : 1;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(15,17,19,0.5)";
    ctx.lineWidth = 0.5 / z;
    ctx.stroke(P.inner);
    ctx.strokeStyle = T.bg;
    ctx.lineWidth = 1.4 / z;
    ctx.stroke(P.borders);
    ctx.restore();
  }, [frame, width, height, k, into, cam.k, cam.x, cam.y, zoomed]);

  // Panels.
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const panelOn = interpolate(frame, [brazilAt - 5, brazilAt + 10], [1, 0], clamp);
  const brazilCard = interpolate(frame, [brazilAt + 30, brazilAt + 45, usaAt - 10, usaAt], [0, 1, 1, 0], clamp);
  const usaCard = interpolate(frame, [usaAt + 35, usaAt + 50, outroAt - 10, outroAt], [0, 1, 1, 0], clamp);
  const endCard = interpolate(frame, [outroAt + 30, outroAt + 50], [0, 1], clamp);

  const watch = ["BRA", "MEX", "COL", "ARG", "USA"];
  const rows = watch.map((iso) => ({ iso, r: reading(iso, year) }));
  const maxBar = 60;

  // Brazil's way down: its first and latest readings.
  const brSeries = POVERTY.values.BRA ?? [];
  const brFirstIdx = brSeries.findIndex((v) => v != null);
  const brLastIdx = brSeries.length - 1 - [...brSeries].reverse().findIndex((v) => v != null);
  const brFirst = brFirstIdx >= 0 ? { year: FIRST + brFirstIdx, value: brSeries[brFirstIdx]! } : null;
  const brLast = brLastIdx >= 0 && brLastIdx < brSeries.length ? { year: FIRST + brLastIdx, value: brSeries[brLastIdx]! } : null;

  // The US: this line, and the official one by state if the pipeline wrote it.
  const us = reading("USA", LAST);
  const official = POVERTY.officialByRegion;
  let officialLine: string | null = null;
  if (official) {
    const names = new Map(
      topology.objects.americas.geometries.map((g) => {
        const props = g.properties as { code: string; name: string };
        return [props.code, props.name] as const;
      }),
    );
    let latest = -1;
    for (const s of Object.values(official)) s.forEach((v, i) => v != null && i > latest && (latest = i));
    const states = Object.entries(official)
      .map(([code, s]) => ({ code, v: s[latest] }))
      .filter((s): s is { code: string; v: number } => s.v != null)
      .sort((a, b) => a.v - b.v);
    if (states.length) {
      const lo = states[0]!;
      const hi = states.at(-1)!;
      officialLine = `Pela linha oficial americana, bem mais alta, os estados vão de ${pct(lo.v)} (${names.get(lo.code) ?? lo.code}) a ${pct(hi.v)} (${names.get(hi.code) ?? hi.code}), em ${FIRST + latest}.`;
    }
  }

  // Gaps: the pipeline's list, else every country with nothing in the last year.
  const gaps = POVERTY.missingWhy
    ? Object.keys(POVERTY.missingWhy)
    : Object.keys(AMERICAS.countries).filter((iso) => !reading(iso, LAST));
  const gapNames = gaps.map(nameOf).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const anyStriped = P.striped.some((row) => row.some(Boolean));

  const textBox = portrait
    ? { left: pad, right: pad, top: height - 540 * u }
    : { left: pad, width: width * 0.4 - pad - 40 * u, top: 320 * u };

  const legend = (
    <div style={{ marginTop: 22 * u }}>
      <div style={{ display: "flex", gap: 3 * u }}>
        {STEPS.poverty.map((from) => (
          <div key={from} style={{ flex: 1, height: 12 * u, background: qColor(from) }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 * u, color: T.muted, marginTop: 6 * u }}>
        <span>0%</span>
        <span>20%</span>
        <span>40%</span>
        <span>60% ou mais</span>
      </div>
      <div style={{ display: "flex", gap: 18 * u, fontSize: 18 * u, color: T.muted, marginTop: 8 * u }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 * u }}>
          <i style={{ width: 14 * u, height: 14 * u, background: css(NO_DATA), borderRadius: 2 * u }} /> sem dado
        </span>
        {anyStriped ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6 * u }}>
            <i
              style={{
                width: 14 * u,
                height: 14 * u,
                borderRadius: 2 * u,
                background: `repeating-linear-gradient(135deg, ${Q[6]} 0 ${3 * u}px, ${T.bg} ${3 * u}px ${5 * u}px)`,
              }}
            />{" "}
            pesquisa antiga ou de consumo
          </span>
        ) : null}
      </div>
    </div>
  );

  const card = (opacity: number, title: string, body: React.ReactNode) => (
    <div style={{ position: "absolute", ...textBox, opacity }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 72 * u, lineHeight: 1 }}>{title}</div>
      <div style={{ fontSize: 30 * u, lineHeight: 1.4, marginTop: 14 * u }}>{body}</div>
    </div>
  );

  // Sounds: a tick every five years, swishes on the camera moves, a chime at the end.
  const ticks = Array.from({ length: YEARS }, (_, i) => i).filter((i) => i > 0 && (FIRST + i) % 5 === 0);

  return (
    <AbsoluteFill style={{ background: T.bg, color: T.ink, fontFamily: BODY }}>
      <canvas ref={ref} width={width} height={height} />
      <Header
        title="A pobreza nas Américas"
        subtitle="Quem vive com menos de US$ 8,30 por dia (dólares de 2021, ajustados pelo custo de vida)"
        opacity={headerIn}
      />

      {/* Year, the five countries, the legend. */}
      <div style={{ position: "absolute", ...textBox, opacity: headerIn * panelOn }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 130 * u, lineHeight: 0.9, fontVariantNumeric: "tabular-nums" }}>
          {year}
        </div>
        <div style={{ marginTop: 18 * u, display: "flex", flexDirection: "column", gap: 10 * u }}>
          {rows.map(({ iso, r }) => (
            <div key={iso} style={{ display: "grid", gridTemplateColumns: `${170 * u}px 1fr ${110 * u}px`, alignItems: "center", gap: 12 * u }}>
              <span style={{ fontSize: 24 * u, color: T.ink2 }}>{nameOf(iso)}</span>
              <div style={{ height: 14 * u, background: T.rule, borderRadius: 3 * u }}>
                {r ? (
                  <div
                    style={{
                      width: `${Math.max(1, Math.min(100, (r.value / maxBar) * 100))}%`,
                      height: "100%",
                      background: qColor(r.value),
                      borderRadius: 3 * u,
                    }}
                  />
                ) : null}
              </div>
              <b style={{ fontSize: 26 * u, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r ? pct(r.value) : "—"}
              </b>
            </div>
          ))}
        </div>
        {legend}
      </div>

      {brFirst && brLast
        ? card(
            brazilCard,
            "Brasil",
            <>
              De <b>{pct(brFirst.value)}</b> em {brFirst.year} para <b>{pct(brLast.value)}</b> em {brLast.year}: a parte
              da população abaixo da linha caiu para menos da metade.
            </>,
          )
        : null}
      {us
        ? card(
            usaCard,
            "Estados Unidos",
            <>
              <b>{pct(us.value)}</b> nesta linha ({us.year}): quase ninguém vive com menos de US$ 8,30 por dia.
              {officialLine ? <div style={{ color: T.ink2, fontSize: 25 * u, marginTop: 12 * u }}>{officialLine}</div> : null}
            </>,
          )
        : null}
      {card(
        endCard,
        "Onde falta dado",
        <>
          <span style={{ fontSize: 26 * u, color: T.ink2 }}>
            Sem pesquisa comparável recente: {gapNames.join(", ")}.
          </span>
          {anyStriped ? (
            <div style={{ fontSize: 24 * u, color: T.muted, marginTop: 12 * u }}>
              Listrado: pesquisa antiga ou de consumo, do mesmo Banco Mundial.
            </div>
          ) : null}
        </>,
      )}

      <Footer source="Banco Mundial, Poverty and Inequality Platform" opacity={headerIn} />

      <Bed volume={0.12} />
      {ticks.map((i) => (
        <Sfx key={i} name="tick" at={INTRO + i * STEP} volume={0.35} />
      ))}
      <Sfx name="swish" at={brazilAt} volume={0.4} />
      <Sfx name="swish" at={usaAt} volume={0.4} />
      <Sfx name="whoosh" at={outroAt} volume={0.35} />
      <Sfx name="chime" at={outroAt + 30} volume={0.45} />
    </AbsoluteFill>
  );
}

export const def = motion<Props>({
  id: "Pobreza",
  title: "A pobreza nas Américas, 2000–2026",
  description:
    "Cada país pela parte da população que vive com menos de US$ 8,30 por dia, ano a ano, com o Brasil e os EUA em destaque.",
  component: Pobreza,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
});
