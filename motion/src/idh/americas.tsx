/**
 * "O IDH nas Américas": the continent colored by HDI year by year, Brazil's place in the
 * ranking ticking along, then the countries that rose the most, the one that stalled, and
 * the full ranking of the last year with Brazil in it.
 */
import { geoAzimuthalEqualArea, geoPath } from "d3-geo";
import { useLayoutEffect, useRef } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
import topoJson from "../../../data/generated/americas.topo.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import type { Cue } from "./sound";
import { DISPLAY, T, css, mixRgb, rgb } from "../common/theme";
import { Big, Caption, FIRST_YEAR, HDI, Kicker, clamp, countryName, dec, ease, hdiColor, hdiRgb, signed } from "./kit";

type Props = Record<string, never>;
type Area = { name: string; country: string; code: string };

const topology = topoJson as unknown as Topology<{ americas: GeometryCollection<Area> }>;

const ISO = Object.keys(HDI.values);
const YEAR_COUNT = Math.max(...ISO.map((c) => HDI.values[c]!.length));
const YEARS = Array.from({ length: YEAR_COUNT }, (_, k) => FIRST_YEAR + k);
const FIRST = YEARS[0]!;
const LAST = YEARS.at(-1)!;
const value = (iso: string, year: number) => HDI.values[iso]?.[year - FIRST_YEAR] ?? null;
const ranking = (year: number) =>
  ISO.filter((c) => value(c, year) != null).sort((a, b) => value(b, year)! - value(a, year)!);

const both = ISO.filter((c) => value(c, FIRST) != null && value(c, LAST) != null);
const gain = (c: string) => value(c, LAST)! - value(c, FIRST)!;
const BY_GAIN = [...both].sort((a, b) => gain(b) - gain(a));
const RISERS = BY_GAIN.slice(0, 3);
const STALLED = BY_GAIN.at(-1)!;
const stalledPeak = YEARS.reduce((best, y) => ((value(STALLED, y) ?? 0) > (value(STALLED, best) ?? 0) ? y : best), FIRST);
const brGainRank = BY_GAIN.indexOf("BRA") + 1;
/** Brazil's place among the countries that have both ends, so the two years compare. */
const sameRank = (year: number) => [...both].sort((a, b) => value(b, year)! - value(a, year)!).indexOf("BRA") + 1;

// Timeline.
const INTRO = 40;
const STEP = 20;
const YEARS_END = INTRO + YEARS.length * STEP + 30;
const RISE_AT = YEARS_END;
const STALL_AT = RISE_AT + 180;
const RANK_AT = STALL_AT + 180;
const OUTRO_AT = RANK_AT + 260;
const DURATION = OUTRO_AT + 130;

const NO_DATA = rgb("#23272c");
const RISE_COLOR = "#fde725";
const STALL_COLOR = "#ff8a7a";

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
  const fc = { ...all, features: all.features.filter((f) => f.properties.code !== "US-HI") };
  const projection = geoAzimuthalEqualArea().rotate([72, -5, 0]);
  projection.fitSize([w, h], {
    type: "FeatureCollection",
    features: fc.features.filter((f) => !["CAN", "GRL"].includes(f.properties.country)),
  });
  const path = geoPath(projection);
  const xs = fc.features.map((f) => path.centroid(f)[0]);
  const finite = xs.filter(Number.isFinite);
  const [minX, maxX] = [Math.min(...finite), Math.max(...finite)];
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
    sweep: xs.map((x) => (Number.isFinite(x) ? (x - minX) / (maxX - minX) : 0.5)),
    borders: new Path2D(path(mesh(topology, object, (a, b) => countryOf(a) !== countryOf(b))) ?? ""),
    outline: new Map([...RISERS, STALLED, "BRA"].map((c) => [c, outlineOf(c)])),
  };
  cache.set(key, out);
  return out;
}

const colorOf = (iso: string, year: number) => {
  const v = value(iso, year);
  return v == null ? NO_DATA : hdiRgb(v);
};

function IdhAmericas(_: Props) {
  const frame = useCurrentFrame();
  const { width, u, pad } = useLayout();
  const ref = useRef<HTMLCanvasElement>(null);
  const box = { x: pad, y: 250 * u, w: width - 2 * pad, h: 1050 * u };

  const t = frame - INTRO;
  const k = Math.max(0, Math.min(YEARS.length - 1, Math.floor(t / STEP)));
  const into = t - k * STEP;
  const year = YEARS[k]!;

  const rise = interpolate(frame, [RISE_AT, RISE_AT + 20, STALL_AT - 10, STALL_AT], [0, 1, 1, 0], clamp);
  const stall = interpolate(frame, [STALL_AT, STALL_AT + 20, RANK_AT - 10, RANK_AT], [0, 1, 1, 0], clamp);
  const mapAway = interpolate(frame, [RANK_AT, RANK_AT + 25, OUTRO_AT, OUTRO_AT + 30], [0, 0.96, 0.96, 0.3], clamp);

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const P = prepare(box.w, box.h);
    const bg = rgb(T.bg);
    const mapIn = interpolate(frame, [4, 36], [0, 1], clamp);
    ctx.clearRect(0, 0, box.w, box.h);
    P.paths.forEach((p, i) => {
      const iso = P.countries[i]!;
      let c = colorOf(iso, year);
      if (k > 0 && t >= 0 && frame < YEARS_END) {
        const d = P.sweep[i]! * STEP * 0.4;
        const q = ease(interpolate(into, [d, d + STEP * 0.6], [0, 1], clamp));
        c = mixRgb(colorOf(iso, YEARS[k - 1]!), c, q);
      }
      const lit = (rise > 0 && RISERS.includes(iso)) || (stall > 0 && iso === STALLED) || iso === "BRA";
      const dim = Math.max(rise, stall) * (lit ? 0 : 0.75) + mapAway;
      ctx.fillStyle = css(mixRgb(bg, c, mapIn * (1 - Math.min(1, dim))));
      ctx.fill(p);
    });
    ctx.lineJoin = "round";
    ctx.strokeStyle = T.bg;
    ctx.lineWidth = 1.2 * u;
    ctx.stroke(P.borders);
    const outline = (iso: string, color: string, alpha: number) => {
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.5 * u;
      ctx.stroke(P.outline.get(iso)!);
      ctx.globalAlpha = 1;
    };
    RISERS.forEach((c) => outline(c, RISE_COLOR, rise));
    outline(STALLED, STALL_COLOR, stall);
    outline("BRA", T.ink, mapIn * (1 - mapAway));
  });

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const yearsOut = interpolate(frame, [YEARS_END - 15, YEARS_END], [1, 0], clamp);
  const br = { rank: sameRank(year), of: both.length };
  const brValue = value("BRA", year)!;
  const panelTop = 1340 * u;

  return (
    <Stage>
      <Header title="O IDH nas Américas" subtitle={`${FIRST} a ${LAST}: onde o Brasil fica no continente`} opacity={headerIn} />
      <canvas
        ref={ref}
        width={Math.round(box.w)}
        height={Math.round(box.h)}
        style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}
      />

      <div style={{ position: "absolute", left: pad, right: pad, top: panelTop, opacity: headerIn * yearsOut }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Big>{year}</Big>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 26 * u, color: T.muted }}>Brasil</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 84 * u, lineHeight: 1 }}>
              {br.rank}º <span style={{ fontSize: 36 * u, color: T.ink2, fontWeight: 500 }}>de {br.of}</span>
            </div>
            <div style={{ fontSize: 30 * u, color: hdiColor(brValue), fontVariantNumeric: "tabular-nums" }}>
              IDH {dec(brValue)}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 26 * u, fontSize: 30 * u, color: T.ink2 }}>
          {k === 0 ? "Cada país com a cor do seu IDH. O Brasil, contornado." : `Do 1º ao último: ${countryName(ranking(year)[0]!)} e ${countryName(ranking(year).at(-1)!)}.`}
        </div>
      </div>

      <Caption from={RISE_AT} to={STALL_AT} top={panelTop}>
        <Kicker color={RISE_COLOR}>Quem mais subiu</Kicker>
        {RISERS.map((c) => (
          <Row key={c} iso={c} color={RISE_COLOR} />
        ))}
        <div style={{ marginTop: 18 * u, fontSize: 30 * u, color: T.muted }}>
          O Brasil ({signed(gain("BRA"))}) foi o {brGainRank}º que mais subiu, de {both.length}.
        </div>
      </Caption>

      <Caption from={STALL_AT} to={RANK_AT} top={panelTop}>
        <Kicker color={STALL_COLOR}>Quem ficou parado</Kicker>
        <Row iso={STALLED} color={STALL_COLOR} />
        <div style={{ marginTop: 18 * u, fontSize: 34 * u, color: T.ink2 }}>
          Chegou a <b style={{ color: T.ink }}>{dec(value(STALLED, stalledPeak)!)}</b> em {stalledPeak}, e voltou quase ao
          ponto de partida.
        </div>
      </Caption>

      <Ranking />

      <Caption from={OUTRO_AT} to={DURATION + 30} top={panelTop}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 62 * u, lineHeight: 1.05 }}>
          {sameRank(FIRST) === sameRank(LAST)
            ? `${sameRank(LAST)}º em ${FIRST} e em ${LAST}: o Brasil subiu, mas os vizinhos também.`
            : `De ${sameRank(FIRST)}º para ${sameRank(LAST)}º: o Brasil ${sameRank(LAST) < sameRank(FIRST) ? "subiu" : "caiu"} no ranking.`}
        </div>
        <div style={{ color: T.muted, fontSize: 24 * u, marginTop: 10 * u }}>
          Entre os {both.length} países com dados nos dois anos.
        </div>
        <div style={{ color: T.ink2, fontSize: 32 * u, marginTop: 14 * u }}>
          Explore o mapa em <b style={{ color: T.ink }}>danillogomes.com/urna</b>
        </div>
      </Caption>
      <Footer source="IDH: PNUD, Relatório de Desenvolvimento Humano 2025" opacity={headerIn} />
    </Stage>
  );
}

function Row({ iso, color }: { iso: string; color: string }) {
  const { u } = useLayout();
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 16 * u, marginTop: 10 * u }}>
      <span style={{ flex: 1, fontSize: 40 * u, fontWeight: 600 }}>{countryName(iso)}</span>
      <span style={{ fontSize: 30 * u, color: T.ink2, fontVariantNumeric: "tabular-nums" }}>
        {dec(value(iso, FIRST)!)} → <b style={{ color: T.ink }}>{dec(value(iso, LAST)!)}</b>{" "}
        <span style={{ color }}>({signed(gain(iso))})</span>
      </span>
    </div>
  );
}

/** Every country in the last year, Brazil in yellow, over the faded map. */
function Ranking() {
  const frame = useCurrentFrame();
  const { u, pad } = useLayout();
  const list = ranking(LAST);
  const o = interpolate(frame, [RANK_AT + 10, RANK_AT + 30, OUTRO_AT - 10, OUTRO_AT], [0, 1, 1, 0], clamp);
  if (o === 0) return null;
  const rowH = 36 * u;
  const top = 270 * u;
  const lo = 0.5;
  const hi = 0.95;
  return (
    <div style={{ position: "absolute", left: pad, right: pad, top, opacity: o }}>
      <Kicker>
        Ranking de {LAST} · {list.length} países
      </Kicker>
      {list.length > both.length ? (
        <div style={{ fontSize: 22 * u, color: T.muted, margin: `${-4 * u}px 0 ${8 * u}px` }}>
          Inclui {list.length - both.length} sem dado em {FIRST}: aqui o Brasil é {list.indexOf("BRA") + 1}º.
        </div>
      ) : null}
      {list.map((c, i) => {
        const v = value(c, LAST)!;
        const isBr = c === "BRA";
        const grow = ease(interpolate(frame, [RANK_AT + 15 + i * 2, RANK_AT + 45 + i * 2], [0, 1], clamp));
        return (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 12 * u, height: rowH }}>
            <span style={{ width: 44 * u, textAlign: "right", fontSize: 22 * u, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
              {i + 1}
            </span>
            <span
              style={{
                width: 330 * u,
                fontSize: (isBr ? 28 : 23) * u,
                fontWeight: isBr ? 700 : 400,
                color: isBr ? "#fde725" : T.ink2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {countryName(c)}
            </span>
            <div style={{ flex: 1, height: (isBr ? 22 : 16) * u }}>
              <div
                style={{
                  width: `${((v - lo) / (hi - lo)) * 100 * grow}%`,
                  height: "100%",
                  background: isBr ? "#fde725" : hdiColor(v),
                  opacity: isBr ? 1 : 0.8,
                  borderRadius: 3 * u,
                }}
              />
            </div>
            <span style={{ width: 80 * u, textAlign: "right", fontSize: 22 * u, fontVariantNumeric: "tabular-nums", color: isBr ? T.ink : T.muted }}>
              {dec(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A tick every other year, whoosh per act, a chime at the end. */
export const cues: Cue[] = [
  ...YEARS.slice(1)
    .map((_, k) => ({ name: "tick" as const, at: INTRO + (k + 1) * STEP, volume: 0.35 }))
    .filter((_, k) => k % 2 === 1),
  { name: "whoosh", at: RISE_AT + 4 },
  { name: "whoosh", at: STALL_AT + 4 },
  { name: "whoosh", at: RANK_AT + 4 },
  { name: "chime", at: OUTRO_AT + 6 },
];

export const def = motion<Props>({
  id: "IdhAmericas",
  title: "O IDH nas Américas, 2000–2023",
  description: "O continente mudando de cor ano a ano, quem mais subiu, quem parou e onde o Brasil fica no ranking.",
  component: IdhAmericas,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait"],
});
