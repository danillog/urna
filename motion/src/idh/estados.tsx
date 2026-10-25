/**
 * "O IDHM dos estados, 2000 a 2024": the 27 states on the map and in a ranking that
 * re-sorts itself year by year, then re-sorted by how much each one rose, then the gap
 * between first and last closing while the order barely moves.
 */
import { geoMercator, geoPath } from "d3-geo";
import { interpolate, useCurrentFrame } from "remotion";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import topoJson from "../../../data/generated/americas.topo.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import type { Cue } from "./sound";
import { DISPLAY, T, css, mixRgb, rgb } from "../common/theme";
import { Big, Caption, FIRST_YEAR, HDI, Kicker, clamp, dec, ease, hdiRgb, signed } from "./kit";

type Props = Record<string, never>;

const topology = topoJson as unknown as Topology<{
  americas: GeometryCollection<{ name: string; country: string; code: string }>;
}>;

const REGIONS = HDI.regions!;
const CODES = Object.keys(REGIONS).sort();
const uf = (code: string) => code.slice(3);
/** Years every state has a figure for (the Atlas skips 2001–2009 and 2011). */
const YEARS = REGIONS[CODES[0]!]!.map((_, k) => FIRST_YEAR + k).filter((y) =>
  CODES.every((c) => REGIONS[c]![y - FIRST_YEAR] != null),
);
const FIRST = YEARS[0]!;
const LAST = YEARS.at(-1)!;
const val = (code: string, year: number) => REGIONS[code]![year - FIRST_YEAR]!;
type Area = { name: string; country: string; code: string };
const NAME = new Map(
  topology.objects.americas.geometries
    .map((g) => g.properties as Area)
    .filter((a) => a.country === "BRA")
    .map((a) => [a.code, a.name]),
);

const order = (score: (c: string) => number) => [...CODES].sort((a, b) => score(b) - score(a));
const RANKS = YEARS.map((y) => order((c) => val(c, y)));
const gain = (c: string) => val(c, LAST) - val(c, FIRST);
const BY_GAIN = order(gain);
const TOP_GAIN = BY_GAIN.slice(0, 3);
const LOW_GAIN = BY_GAIN.slice(-3).reverse();
const gap = (y: number) => {
  const r = RANKS[YEARS.indexOf(y)]!;
  return val(r[0]!, y) - val(r.at(-1)!, y);
};
const first = (y: number) => RANKS[YEARS.indexOf(y)]![0]!;
const last = (y: number) => RANKS[YEARS.indexOf(y)]!.at(-1)!;
const rankOf = (c: string, y: number) => RANKS[YEARS.indexOf(y)]!.indexOf(c);
/** How far, on average, a state moved in the ranking between the first and last year. */
const MEAN_SHIFT = CODES.reduce((s, c) => s + Math.abs(rankOf(c, FIRST) - rankOf(c, LAST)), 0) / CODES.length;

// Timeline.
const INTRO = 45;
const HOLD0 = 100;
const MOVE = 22;
const HOLD = 24;
const YEARS_END = INTRO + HOLD0 + (YEARS.length - 1) * (MOVE + HOLD) + 40;
const GAIN_AT = YEARS_END;
const GAIN_LEN = 240;
const GAP_AT = GAIN_AT + GAIN_LEN;
const GAP_LEN = 230;
const OUTRO_AT = GAP_AT + GAP_LEN;
const DURATION = OUTRO_AT + 130;

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

const cache = new Map<string, Map<string, string>>();
function shapes(w: number, h: number) {
  const key = `${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const all = feature(topology, topology.objects.americas);
  const fc = { ...all, features: all.features.filter((f) => f.properties.country === "BRA") };
  const path = geoPath(geoMercator().fitSize([w, h], fc));
  const out = new Map(fc.features.map((f) => [f.properties.code, path(f) ?? ""]));
  cache.set(key, out);
  return out;
}

function IdhmEstados(_: Props) {
  const frame = useCurrentFrame();
  const { width, u, pad } = useLayout();

  // Before the yearly part the first year holds; each step moves to the next year.
  const t = frame - INTRO - HOLD0;
  const step = MOVE + HOLD;
  const kk = t < 0 ? -1 : Math.min(YEARS.length - 2, Math.floor(t / step));
  const pp = t < 0 ? 0 : ease(interpolate(t - kk * step, [0, MOVE], [0, 1], clamp));
  const from = Math.max(0, kk);
  const to = t < 0 ? 0 : Math.min(YEARS.length - 1, kk + 1);
  const yearValue = (c: string) => lerp(val(c, YEARS[from]!), val(c, YEARS[to]!), t < 0 ? 0 : pp);
  const yearRank = (c: string) =>
    lerp(RANKS[from]!.indexOf(c), RANKS[to]!.indexOf(c), t < 0 ? 0 : pp);
  const shownYear = YEARS[t < 0 ? 0 : pp < 0.5 ? from : to]!;

  // Gain act: rows move from the last year's order to the gain order, bars turn into gains.
  const toGain = ease(interpolate(frame, [GAIN_AT + 10, GAIN_AT + 50, GAP_AT - 10, GAP_AT + 30], [0, 1, 1, 0], clamp));
  // Gap act: last year's order, with a ghost of the first year's value on each row.
  const ghost = interpolate(frame, [GAP_AT + 40, GAP_AT + 80], [0, 1], { ...clamp, easing: ease });
  const highlight = interpolate(frame, [GAIN_AT + 40, GAIN_AT + 60, GAP_AT - 20, GAP_AT], [0, 1, 1, 0], clamp);

  const rank = (c: string) => lerp(yearRank(c), BY_GAIN.indexOf(c), toGain);
  const lit = (c: string) => TOP_GAIN.includes(c) || LOW_GAIN.includes(c);
  const accent = (c: string) => (TOP_GAIN.includes(c) ? "#fde725" : LOW_GAIN.includes(c) ? "#9fd3ff" : null);

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const mapBox = { x: pad + 330 * u, y: 490 * u, w: width - 2 * pad - 330 * u, h: 490 * u };
  const paths = shapes(mapBox.w, mapBox.h);
  const bg = rgb(T.bg);

  // Ranking box.
  const rows = { top: 1010 * u, left: pad, right: pad, h: 28 * u };
  const lo = 0.4;
  const hi = 0.9;
  const valueW = (v: number) => Math.max(0, (v - lo) / (hi - lo));
  const gainW = (g: number) => g / gain(BY_GAIN[0]!);

  return (
    <Stage>
      <Header
        title="O IDHM dos estados"
        subtitle={`${FIRST} a ${LAST}: quem subiu mais, quem subiu menos`}
        opacity={headerIn}
      />

      {/* Year, top left of the map, during the yearly part. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          top: 540 * u,
          opacity: headerIn * interpolate(frame, [YEARS_END - 15, YEARS_END], [1, 0], clamp),
        }}
      >
        <Big size={140}>{shownYear}</Big>
        <div style={{ fontSize: 24 * u, color: T.muted, marginTop: 12 * u, width: 300 * u }}>
          IDHM de cada estado, do maior para o menor
        </div>
      </div>

      <svg
        width={mapBox.w}
        height={mapBox.h}
        style={{ position: "absolute", left: mapBox.x, top: mapBox.y, opacity: interpolate(frame, [5, 35], [0, 1], clamp) }}
      >
        {CODES.map((c) => {
          const base = hdiRgb(yearValue(c));
          const d = highlight * (lit(c) ? 0 : 0.75);
          return (
            <path
              key={c}
              d={paths.get(c)}
              fill={css(mixRgb(base, bg, d))}
              stroke={accent(c) && highlight > 0 ? accent(c)! : T.bg}
              strokeWidth={(accent(c) && highlight > 0 ? 3 : 1.2) * u}
              strokeOpacity={accent(c) && highlight > 0 ? highlight : 1}
            />
          );
        })}
      </svg>

      {CODES.map((c) => {
        const v = yearValue(c);
        const color = css(hdiRgb(v));
        const w = lerp(valueW(v), gainW(gain(c)), toGain);
        const a = accent(c);
        const dimRow = highlight * (lit(c) ? 0 : 0.6);
        return (
          <div
            key={c}
            style={{
              position: "absolute",
              left: rows.left,
              right: rows.right,
              top: rows.top + rank(c) * rows.h,
              height: rows.h,
              display: "flex",
              alignItems: "center",
              gap: 12 * u,
              opacity: headerIn * (1 - dimRow),
            }}
          >
            <span
              style={{
                width: 56 * u,
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: 25 * u,
                color: a && highlight > 0.5 ? a : T.ink2,
              }}
            >
              {uf(c)}
            </span>
            <div style={{ position: "relative", flex: 1, height: 20 * u }}>
              <div
                style={{
                  width: `${w * 100}%`,
                  height: "100%",
                  background: toGain > 0.5 ? (a ?? T.muted) : color,
                  borderRadius: 3 * u,
                }}
              />
              {ghost > 0 ? (
                <i
                  style={{
                    position: "absolute",
                    left: `${valueW(val(c, FIRST)) * 100}%`,
                    top: -3 * u,
                    width: 4 * u,
                    height: 26 * u,
                    background: T.ink,
                    opacity: ghost,
                  }}
                />
              ) : null}
            </div>
            <span
              style={{
                width: 96 * u,
                textAlign: "right",
                fontSize: 23 * u,
                fontVariantNumeric: "tabular-nums",
                color: T.ink,
              }}
            >
              {toGain > 0.5 ? signed(gain(c)) : dec(v)}
            </span>
          </div>
        );
      })}

      <YearCaptions />
      <Caption from={GAIN_AT + 10} to={GAP_AT} top={270 * u}>
        <Kicker color="#fde725">Quem mais subiu</Kicker>
        <div>
          {TOP_GAIN.map((c) => NAME.get(c)).join(", ")}: os que estavam mais embaixo em {FIRST}.
        </div>
        <div style={{ color: "#9fd3ff", fontSize: 34 * u, marginTop: 10 * u }}>
          Menos: {LOW_GAIN.map((c) => NAME.get(c)).join(", ")}, que já estavam no topo.
        </div>
      </Caption>
      <Caption from={GAP_AT + 10} to={OUTRO_AT} top={270 * u}>
        <Kicker>A distância encolheu</Kicker>
        <div>
          Do 1º ao último: <b>{dec(gap(FIRST))}</b> em {FIRST}, <b>{dec(gap(LAST))}</b> em {LAST}.
        </div>
        <div style={{ color: T.ink2, fontSize: 34 * u, marginTop: 10 * u }}>
          Mas a ordem quase não mudou: {NAME.get(first(LAST))} segue no topo, e cada estado andou em média{" "}
          {Math.round(MEAN_SHIFT)} posições. <span style={{ color: T.muted }}>(traço branco: {FIRST})</span>
        </div>
      </Caption>
      <Caption from={OUTRO_AT} to={DURATION + 30} top={270 * u}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64 * u, lineHeight: 1.05 }}>
          Todos subiram. Os de baixo, mais rápido.
        </div>
        <div style={{ color: T.ink2, fontSize: 32 * u, marginTop: 12 * u }}>
          Explore estado por estado em <b style={{ color: T.ink }}>danillogomes.com/urna</b>
        </div>
      </Caption>
      <Footer source="IDHM: Atlas do Desenvolvimento Humano no Brasil (PNUD, Ipea, FJP), via Ipeadata" opacity={headerIn} />
    </Stage>
  );
}

/** Lines over the map while the years run. */
function YearCaptions() {
  const { u } = useLayout();
  const yearStart = (y: number) => INTRO + HOLD0 + (YEARS.indexOf(y) - 1) * (MOVE + HOLD);
  const mid = YEARS.find((y) => y >= FIRST + 10) ?? YEARS[1]!;
  return (
    <>
      <Caption from={INTRO} to={INTRO + HOLD0 + 10} top={270 * u}>
        Em {FIRST}, {NAME.get(first(FIRST))} tinha <b>{dec(val(first(FIRST), FIRST))}</b>. {NAME.get(last(FIRST))},{" "}
        <b>{dec(val(last(FIRST), FIRST))}</b>.
      </Caption>
      <Caption from={yearStart(mid)} to={yearStart(mid) + 140} top={270 * u}>
        Em {mid}, nenhum estado abaixo de <b>{dec(Math.floor(val(last(mid), mid) * 100) / 100, 2)}</b>.
      </Caption>
      <Caption from={yearStart(LAST) - 60} to={YEARS_END} top={270 * u}>
        Em {LAST}: {NAME.get(first(LAST))} <b>{dec(val(first(LAST), LAST))}</b>, {NAME.get(last(LAST))}{" "}
        <b>{dec(val(last(LAST), LAST))}</b>.
      </Caption>
    </>
  );
}

/** A tick per year, whoosh into the gain ranking and back, a chime at the end. */
export const cues: Cue[] = [
  ...YEARS.slice(1).map((_, k) => ({ name: "tick" as const, at: INTRO + HOLD0 + k * (MOVE + HOLD), volume: 0.4 })),
  { name: "whoosh", at: GAIN_AT + 8 },
  { name: "whoosh", at: GAP_AT + 8 },
  { name: "chime", at: OUTRO_AT + 6 },
];

export const def = motion<Props>({
  id: "IdhmEstados",
  title: "O IDHM dos estados, 2000–2024",
  description: "O ranking dos 27 estados ano a ano, quem mais subiu e como a distância entre o 1º e o último encolheu.",
  component: IdhmEstados,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait"],
});
