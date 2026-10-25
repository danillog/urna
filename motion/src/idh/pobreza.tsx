/**
 * "A pobreza nas Américas": first what counts as poor (the World Bank's $8.30 a day,
 * in reais), then the map from Canada to Patagonia year by year with the site's colors
 * (light = less poverty), who cut it the most, where it did not fall, Brazil's line, and
 * the ranking of the last year. Data: data/generated/americas-indicators.json (poverty).
 */
import { geoAzimuthalEqualArea, geoPath } from "d3-geo";
import { useLayoutEffect, useRef } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
import topoJson from "../../../data/generated/americas.topo.json";
import { STEPS, colorStep, step, valueAt } from "../../../src/model/indicators";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { DISPLAY, T, css, mix, mixRgb, rgb } from "../common/theme";
import { Big, Caption, IND, Kicker, VIRIDIS, clamp, countryName, ease } from "./kit";
import type { Cue } from "./sound";

type Props = Record<string, never>;
type Area = { name: string; country: string; code: string };

const topology = topoJson as unknown as Topology<{ americas: GeometryCollection<Area> }>;
const POV = IND.indicators.poverty;
/** Not countries of the analysis (Greenland, Saint-Pierre, Bermuda): never drawn. */
const OUT_OF_FRAME = new Set(["GRL", "SPM", "BMU"]);
/** Framed on the inhabited Americas: Canada is drawn but its Arctic runs off the top. */
const NOT_FITTED = new Set(["CAN"]);

const FIRST = 2002;
const LAST = POV.lastYear > 2024 ? 2024 : POV.lastYear;
const YEARS = Array.from({ length: LAST - FIRST + 1 }, (_, k) => FIRST + k);
const COUNTRIES = Object.keys(POV.values).filter((c) => !OUT_OF_FRAME.has(c));
const at = (iso: string, year: number) => valueAt(IND, "poverty", iso, year);

const both = COUNTRIES.filter((c) => at(c, FIRST) && at(c, LAST));
const drop = (c: string) => at(c, LAST)!.value - at(c, FIRST)!.value;
const BY_DROP = [...both].sort((a, b) => drop(a) - drop(b));
const CUT_MOST = BY_DROP.slice(0, 3);
const ROSE = both.filter((c) => drop(c) > 0);
/** Still at 40% or more in the last year. */
const STILL_HIGH = both.filter((c) => at(c, LAST)!.value >= 40 && !ROSE.includes(c));
const STUCK = [...ROSE, ...STILL_HIGH];
const NO_RECENT = COUNTRIES.filter((c) => at(c, FIRST) && !at(c, LAST));

/** The line in reais: $8.30 a day × days per month × Brazil's 2021 PPP factor for private consumption. */
const PPP_BRL_2021 = 2.45;
const MONTH_BRL = Math.round((8.3 * (365.25 / 12) * PPP_BRL_2021) / 10) * 10;

const color = (v: number) => VIRIDIS[colorStep("poverty", step("poverty", v))]!;
/** Readable as text on the dark ground. */
const textColor = (v: number) => {
  const k = colorStep("poverty", step("poverty", v));
  return k > 2 ? VIRIDIS[k]! : mix(VIRIDIS[k]!, T.ink, 0.45);
};
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const pp = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} pontos`;

// Timeline.
const LINE_AT = 0;
const MAP_AT = 230;
const STEP = 22;
const YEARS_END = MAP_AT + 30 + YEARS.length * STEP + 30;
const CUT_AT = YEARS_END;
const STUCK_AT = CUT_AT + 180;
const BR_AT = STUCK_AT + 180;
const RANK_AT = BR_AT + 270;
const OUTRO_AT = RANK_AT + 230;
const DURATION = OUTRO_AT + 140;

const NO_DATA = rgb("#23272c");
const CUT_COLOR = "#fde725";
const STUCK_COLOR = "#ff8a7a";
const BR_COLOR = "#ffffff";

interface Prepared {
  paths: Path2D[];
  countries: string[];
  sweep: number[];
  borders: Path2D;
  outline: Map<string, Path2D>;
}
const cache = new Map<string, Prepared>();
function prepare(w: number, h: number): Prepared {
  const key = `${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const object = topology.objects.americas;
  const all = feature(topology, object);
  const fc = { ...all, features: all.features.filter((f) => !OUT_OF_FRAME.has(f.properties.country)) };
  const projection = geoAzimuthalEqualArea().rotate([80, -5, 0]);
  projection.fitSize([w, h], { ...fc, features: fc.features.filter((f) => !NOT_FITTED.has(f.properties.country)) });
  const path = geoPath(projection);
  const xs = fc.features.map((f) => path.centroid(f)[1]);
  const finite = xs.filter(Number.isFinite);
  const [minY, maxY] = [Math.min(...finite), Math.max(...finite)];
  const countryOf = (g: GeometryObject) => (g.properties as Area).country;
  const outlineOf = (iso: string) =>
    new Path2D(
      path(
        mesh(topology, object, (a: GeometryObject, b: GeometryObject) => {
          const ia = countryOf(a) === iso;
          return a === b ? ia : ia !== (countryOf(b) === iso);
        }),
      ) ?? "",
    );
  const out: Prepared = {
    paths: fc.features.map((f) => new Path2D(path(f) ?? "")),
    countries: fc.features.map((f) => f.properties.country),
    // Each year's change sweeps north to south, down the continent.
    sweep: xs.map((y) => (Number.isFinite(y) ? (y - minY) / (maxY - minY) : 0.5)),
    borders: new Path2D(
      path(mesh(topology, object, (a, b) => countryOf(a) !== countryOf(b) && !OUT_OF_FRAME.has(countryOf(a)))) ?? "",
    ),
    outline: new Map([...CUT_MOST, ...STUCK, "BRA"].map((c) => [c, outlineOf(c)])),
  };
  cache.set(key, out);
  return out;
}

const colorOf = (iso: string, year: number) => {
  const r = at(iso, year);
  return r ? rgb(color(r.value)) : NO_DATA;
};

function Pobreza(_: Props) {
  const frame = useCurrentFrame();
  const { width, u, pad } = useLayout();
  const ref = useRef<HTMLCanvasElement>(null);
  const box = { x: pad, y: 250 * u, w: width - 2 * pad, h: 1080 * u };

  const t = frame - MAP_AT - 30;
  const k = Math.max(0, Math.min(YEARS.length - 1, Math.floor(t / STEP)));
  const into = t - k * STEP;
  const year = YEARS[k]!;

  const mapIn = interpolate(frame, [MAP_AT - 10, MAP_AT + 25], [0, 1], clamp);
  const cut = interpolate(frame, [CUT_AT, CUT_AT + 20, STUCK_AT - 10, STUCK_AT], [0, 1, 1, 0], clamp);
  const stuck = interpolate(frame, [STUCK_AT, STUCK_AT + 20, BR_AT - 10, BR_AT], [0, 1, 1, 0], clamp);
  const away = interpolate(frame, [BR_AT, BR_AT + 25, OUTRO_AT, OUTRO_AT + 30], [0, 0.94, 0.94, 0.25], clamp);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const P = prepare(box.w, box.h);
    const bg = rgb(T.bg);
    ctx.clearRect(0, 0, box.w, box.h);
    if (mapIn === 0) return;
    P.paths.forEach((p, i) => {
      const iso = P.countries[i]!;
      let c = colorOf(iso, year);
      if (k > 0 && t >= 0 && frame < YEARS_END) {
        const d = P.sweep[i]! * STEP * 0.4;
        const q = ease(interpolate(into, [d, d + STEP * 0.6], [0, 1], clamp));
        c = mixRgb(colorOf(iso, YEARS[k - 1]!), c, q);
      }
      const lit = (cut > 0 && CUT_MOST.includes(iso)) || (stuck > 0 && STUCK.includes(iso));
      const dim = Math.max(cut, stuck) * (lit ? 0 : 0.75) + away;
      ctx.fillStyle = css(mixRgb(bg, c, mapIn * (1 - Math.min(1, dim))));
      ctx.fill(p);
    });
    ctx.lineJoin = "round";
    ctx.strokeStyle = T.bg;
    ctx.lineWidth = 1.3 * u;
    ctx.stroke(P.borders);
    const outline = (iso: string, c: string, alpha: number) => {
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = c;
      ctx.lineWidth = 3.5 * u;
      ctx.stroke(P.outline.get(iso)!);
      ctx.globalAlpha = 1;
    };
    CUT_MOST.forEach((c) => outline(c, CUT_COLOR, cut));
    STUCK.forEach((c) => outline(c, STUCK_COLOR, stuck));
    outline("BRA", BR_COLOR, mapIn * (1 - away) * (1 - Math.max(cut, stuck)));
  });

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const yearsOut = interpolate(frame, [YEARS_END - 15, YEARS_END], [1, 0], clamp);
  const yearsIn = interpolate(frame, [MAP_AT + 10, MAP_AT + 30], [0, 1], clamp);
  const br = at("BRA", year);
  const majority = COUNTRIES.filter((c) => (at(c, year)?.value ?? 0) >= 50).length;
  const panelTop = 1370 * u;

  return (
    <Stage>
      <Header title="A pobreza nas Américas" subtitle={`${FIRST} a ${LAST}, país por país`} opacity={headerIn} />

      <canvas
        ref={ref}
        width={Math.round(box.w)}
        height={Math.round(box.h)}
        style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}
      />

      {/* What counts as poor. */}
      <Caption from={LINE_AT} to={MAP_AT} top={330 * u}>
        <Kicker>Antes: quem conta como pobre?</Kicker>
        <div style={{ fontSize: 44 * u, lineHeight: 1.3 }}>Quem vive com menos de</div>
        <Big size={190} color={CUT_COLOR}>
          US$ 8,30
        </Big>
        <div style={{ fontSize: 44 * u, lineHeight: 1.3 }}>por dia, por pessoa.</div>
        <div
          style={{
            opacity: interpolate(frame, [55, 70], [0, 1], clamp),
            marginTop: 40 * u,
            fontSize: 38 * u,
            lineHeight: 1.35,
            color: T.ink2,
          }}
        >
          O valor é corrigido pelo custo de vida de cada país. No Brasil, dá cerca de{" "}
          <b style={{ color: T.ink }}>R$ {MONTH_BRL.toLocaleString("pt-BR")} por mês</b> por pessoa (preços de 2021):{" "}
          <b style={{ color: T.ink }}>R$ {(MONTH_BRL * 4).toLocaleString("pt-BR")}</b> para uma família de quatro.
        </div>
        <div
          style={{
            opacity: interpolate(frame, [120, 135], [0, 1], clamp),
            marginTop: 30 * u,
            fontSize: 32 * u,
            lineHeight: 1.4,
            color: T.muted,
          }}
        >
          É a régua do Banco Mundial para países de renda média, como o Brasil.
        </div>
        <div style={{ opacity: interpolate(frame, [150, 165], [0, 1], clamp), marginTop: 40 * u }}>
          <div style={{ display: "flex", gap: 3 * u }}>
            {STEPS.poverty.map((_, i) => (
              <i key={i} style={{ flex: 1, height: 18 * u, background: VIRIDIS[colorStep("poverty", i)], borderRadius: 2 * u }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 * u, fontSize: 24 * u, color: T.ink2 }}>
            <span>menos de 5% pobres</span>
            <span>60% ou mais</span>
          </div>
        </div>
      </Caption>

      {/* Year by year. */}
      <div style={{ position: "absolute", left: pad, right: pad, top: panelTop, opacity: yearsIn * yearsOut }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Big>{year}</Big>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 26 * u, color: T.muted }}>Brasil</div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 96 * u,
                lineHeight: 1,
                color: br ? textColor(br.value) : T.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {br ? pct(br.value) : "–"}
            </div>
            <div style={{ fontSize: 24 * u, color: T.muted }}>de pobres</div>
          </div>
        </div>
        <div style={{ marginTop: 22 * u, fontSize: 30 * u, color: T.ink2 }}>
          {majority > 0
            ? `${majority} ${majority === 1 ? "país" : "países"} com metade ou mais da população na pobreza.`
            : "Nenhum país com metade da população na pobreza."}
        </div>
      </div>

      <Caption from={CUT_AT} to={STUCK_AT} top={panelTop}>
        <Kicker color={CUT_COLOR}>Quem mais reduziu, {FIRST}–{LAST}</Kicker>
        {CUT_MOST.map((c) => (
          <Row key={c} iso={c} color={CUT_COLOR} />
        ))}
      </Caption>

      <Caption from={STUCK_AT} to={BR_AT} top={panelTop}>
        <Kicker color={STUCK_COLOR}>Onde piorou ou segue alta</Kicker>
        {STUCK.map((c) => (
          <Row key={c} iso={c} color={STUCK_COLOR} />
        ))}
        {NO_RECENT.length ? (
          <div style={{ marginTop: 16 * u, fontSize: 26 * u, color: T.muted }}>
            Sem pesquisa recente: {NO_RECENT.map(countryName).join(", ")}.
          </div>
        ) : null}
      </Caption>

      <BrazilLine />
      <Ranking />

      <Caption from={OUTRO_AT} to={DURATION + 30} top={panelTop}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 60 * u, lineHeight: 1.05 }}>
          Em {LAST - FIRST} anos, a pobreza caiu em {both.length - ROSE.length} de {both.length} países.
        </div>
        <div style={{ color: T.ink2, fontSize: 32 * u, marginTop: 14 * u }}>
          Veja ano a ano em <b style={{ color: T.ink }}>danillogomes.com/urna</b> · Américas · Pobreza
        </div>
      </Caption>
      <Footer source="Banco Mundial, Poverty and Inequality Platform (US$ 8,30/dia, PPC 2021)" opacity={headerIn} />
    </Stage>
  );
}

function Row({ iso, color: c }: { iso: string; color: string }) {
  const { u } = useLayout();
  const a = at(iso, FIRST)!;
  const b = at(iso, LAST)!;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 16 * u, marginTop: 10 * u }}>
      <span style={{ flex: 1, fontSize: 40 * u, fontWeight: 600 }}>{countryName(iso)}</span>
      <span style={{ fontSize: 30 * u, color: T.ink2, fontVariantNumeric: "tabular-nums" }}>
        {pct(a.value)} → <b style={{ color: T.ink }}>{pct(b.value)}</b> <span style={{ color: c }}>({pp(b.value - a.value)})</span>
      </span>
    </div>
  );
}

/** Brazil's share year by year, with what moved it. */
function BrazilLine() {
  const frame = useCurrentFrame();
  const { width, u, pad } = useLayout();
  const o = interpolate(frame, [BR_AT + 10, BR_AT + 30, RANK_AT - 10, RANK_AT], [0, 1, 1, 0], clamp);
  if (o === 0) return null;
  const pts = YEARS.map((y) => ({ y, r: at("BRA", y) })).filter((p) => p.r && p.r.year === p.y) as {
    y: number;
    r: { value: number };
  }[];
  const draw = ease(interpolate(frame, [BR_AT + 20, BR_AT + 140], [0, 1], clamp));
  const top = 420 * u;
  const h = 640 * u;
  const w = width - 2 * pad - 120 * u;
  const X = (y: number) => pad + ((y - FIRST) / (LAST - FIRST)) * w;
  const Y = (v: number) => top + (1 - v / 60) * h;
  const shown = pts.filter((p) => p.y <= FIRST + (LAST - FIRST) * draw);
  const d = shown.map((p, i) => `${i ? "L" : "M"}${X(p.y)},${Y(p.r.value)}`).join("");
  const v = (y: number) => pts.find((p) => p.y === y)?.r.value;
  const notes: { y: number; text: string; dy: number }[] = [
    { y: FIRST, text: pct(v(FIRST)!), dy: -24 },
    { y: 2014, text: `${pct(v(2014)!)}`, dy: 48 },
    { y: 2020, text: `auxílio ${pct(v(2020)!)}`, dy: 10 },
    { y: 2021, text: `${pct(v(2021)!)} fim do auxílio`, dy: -26 },
    { y: LAST, text: pct(v(LAST)!), dy: 48 },
  ].filter((n) => v(n.y) !== undefined);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <div style={{ position: "absolute", left: pad, right: pad, top: 280 * u }}>
        <Kicker color={CUT_COLOR}>Brasil, {FIRST}–{LAST}</Kicker>
        <div style={{ fontSize: 34 * u, color: T.ink2 }}>% da população abaixo de US$ 8,30 por dia</div>
      </div>
      <svg width={width} height={top + h + 80 * u} style={{ position: "absolute", left: 0, top: 0 }}>
        {[0, 20, 40, 60].map((g) => (
          <g key={g}>
            <line x1={pad} x2={pad + w} y1={Y(g)} y2={Y(g)} stroke={T.grid} strokeWidth={1.5 * u} />
            <text x={pad + w + 14 * u} y={Y(g) + 8 * u} fill={T.muted} fontSize={22 * u}>
              {g}%
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke={CUT_COLOR} strokeWidth={7 * u} strokeLinejoin="round" strokeLinecap="round" />
        {notes.map((n) =>
          n.y <= FIRST + (LAST - FIRST) * draw ? (
            <g key={n.y}>
              <circle cx={X(n.y)} cy={Y(v(n.y)!)} r={9 * u} fill={CUT_COLOR} />
              <text
                x={X(n.y) + (n.y === 2020 ? -16 * u : 0)}
                y={Y(v(n.y)!) + n.dy * u}
                textAnchor={n.y === LAST || n.y === 2020 ? "end" : n.y === FIRST ? "start" : "middle"}
                fill={T.ink}
                fontSize={28 * u}
                fontWeight={600}
              >
                {n.text}
              </text>
            </g>
          ) : null,
        )}
        {[FIRST, 2014, 2020, LAST].map((y) => (
          <text key={y} x={X(y)} y={top + h + 40 * u} textAnchor="middle" fill={T.muted} fontSize={22 * u}>
            {y}
          </text>
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: top + h + 100 * u,
          fontSize: 34 * u,
          lineHeight: 1.4,
          opacity: interpolate(frame, [BR_AT + 150, BR_AT + 165], [0, 1], clamp),
        }}
      >
        Caiu à metade até 2014, voltou a subir na recessão, despencou com o auxílio emergencial de 2020 e saltou quando
        ele acabou. Em {LAST}, <b style={{ color: CUT_COLOR }}>{pct(v(LAST)!)}</b>: o menor da série.
      </div>
    </div>
  );
}

/** Every country with a recent survey, least poor first. */
function Ranking() {
  const frame = useCurrentFrame();
  const { u, pad } = useLayout();
  const o = interpolate(frame, [RANK_AT + 10, RANK_AT + 30, OUTRO_AT - 10, OUTRO_AT], [0, 1, 1, 0], clamp);
  if (o === 0) return null;
  const list = COUNTRIES.filter((c) => at(c, LAST)).sort((a, b) => at(a, LAST)!.value - at(b, LAST)!.value);
  return (
    <div style={{ position: "absolute", left: pad, right: pad, top: 280 * u, opacity: o }}>
      <Kicker>
        {LAST}: do menos ao mais pobre · {list.length} países
      </Kicker>
      {list.map((c, i) => {
        const r = at(c, LAST)!;
        const isBr = c === "BRA";
        const grow = ease(interpolate(frame, [RANK_AT + 15 + i * 3, RANK_AT + 45 + i * 3], [0, 1], clamp));
        return (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 12 * u, height: 58 * u }}>
            <span style={{ width: 40 * u, textAlign: "right", fontSize: 24 * u, color: T.muted }}>{i + 1}</span>
            <span
              style={{
                width: 300 * u,
                fontSize: (isBr ? 32 : 28) * u,
                fontWeight: isBr ? 700 : 400,
                color: isBr ? CUT_COLOR : T.ink2,
                whiteSpace: "nowrap",
              }}
            >
              {countryName(c)}
              {r.year < LAST ? <span style={{ fontSize: 20 * u, color: T.muted }}> ({r.year})</span> : null}
            </span>
            <div style={{ flex: 1, height: (isBr ? 26 : 20) * u }}>
              <div
                style={{
                  width: `${(r.value / 60) * 100 * grow}%`,
                  height: "100%",
                  background: isBr ? CUT_COLOR : color(r.value),
                  borderRadius: 3 * u,
                }}
              />
            </div>
            <span style={{ width: 100 * u, textAlign: "right", fontSize: 26 * u, fontVariantNumeric: "tabular-nums" }}>
              {pct(r.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A tick every other year, whoosh per act, a riser into Brazil, a chime at the end. */
export const cues: Cue[] = [
  { name: "hit", at: 8 },
  { name: "pop", at: 56, volume: 0.35 },
  { name: "whoosh", at: MAP_AT - 8 },
  ...YEARS.slice(1)
    .map((_, i) => ({ name: "tick" as const, at: MAP_AT + 30 + (i + 1) * STEP, volume: 0.35 }))
    .filter((_, i) => i % 2 === 1),
  { name: "whoosh", at: CUT_AT + 4 },
  { name: "whoosh", at: STUCK_AT + 4 },
  { name: "whoosh", at: BR_AT + 4 },
  { name: "hit", at: BR_AT + 150 },
  { name: "whoosh", at: RANK_AT + 4 },
  { name: "chime", at: OUTRO_AT + 6 },
];

export const def = motion<Props>({
  id: "PobrezaAmericas",
  title: "A pobreza nas Américas, 2002–2024",
  description: "O que é a linha de US$ 8,30 por dia, o mapa ano a ano, quem mais reduziu, onde não melhorou e o Brasil.",
  component: Pobreza,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait"],
});
