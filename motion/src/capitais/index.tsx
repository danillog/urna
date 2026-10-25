/**
 * "Como a capital votou para governador": the areas of a capital painted as its stations'
 * reports arrived, with the governor's count climbing. The states that elected their governor
 * in the 1st round (pipeline.capitais_governador → motion/data/capitais-governador.json) and,
 * closing on the two who go on, those with a runoff (capitais-governador-2turno.json).
 */
import { geoMercator, geoPath } from "d3-geo";
import { useMemo } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import capitalsJson from "../../../data/generated/capitals.json";
import { displayName, partyColor } from "../../../src/model/apuracao";
import { MARGIN_STEPS } from "../../../src/model/map-data";
import governorJson from "../../data/capitais-governador.json";
import runoffJson from "../../data/capitais-governador-2turno.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { MAP } from "../common/municipios";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, css, int, mixRgb, pct, rgb } from "../common/theme";

interface Standing {
  name: string;
  party: string;
  share: number;
}

interface CapitalVote {
  code: string;
  name: string;
  uf: string;
  names: string[];
  parties: string[];
  /** Who won outright, or the two in the runoff (shares of the state's valid votes). */
  elected?: Standing;
  runoff?: [Standing, Standing];
  /** Candidates whose votes the TSE annulled: out of the valid votes, as here. */
  annulled?: string[];
  start: string;
  places: [number, number][];
  /** [polling place or -1, minute after 17:00, votes per candidate…] */
  stations: number[][];
}

/** "A", "A e B", "A, B e C". */
const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);

/** Capitals that take an article: "Como o Rio de Janeiro votou". */
const ARTICLE: Record<string, string> = { "Rio de Janeiro": "o " };

const DATA = [governorJson, runoffJson].flatMap((d) => (d as unknown as { capitals: CapitalVote[] }).capitals);
const TOPO = (capitalsJson as unknown as { topology: Topology<{ areas: GeometryCollection }> }).topology;

type Props = { code: string };

const INTRO = 45;
const COUNT = 630;
const OUTRO = 165;
const DURATION = INTRO + COUNT + OUTRO;
const FLASH = 10;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** Fill strength by the leader's margin in an area, as on the site's maps. */
const MIX = [0.28, 0.52, 0.76, 1];
const FALLBACK = [COLOR.gold, COLOR.violet, COLOR.teal, COLOR.pink, COLOR.orange, COLOR.brown];
/** Colors that read as one on a map. */
const ALIKE = [
  [COLOR.green, COLOR.teal, COLOR.cyan],
  [COLOR.blue, COLOR.sky],
  [COLOR.red, COLOR.pink],
];
const family = (col: string) => ALIKE.find((g) => g.includes(col))?.[0] ?? col;

/** Words the TSE writes without accents. */
const ACCENTS: Record<string, string> = { Joao: "João", Jose: "José", Flavio: "Flávio", Antonio: "Antônio" };
const nameOf = (n: string) =>
  n === "Outros" ? n : displayName(n).replace(/\p{L}+/gu, (w) => ACCENTS[w] ?? w);

interface Prepared {
  c: CapitalVote;
  paths: string[];
  /** Area of each station, or -1 when its polling place has no coordinates or falls outside. */
  area: Int32Array;
  /** Stations per area. */
  size: Int32Array;
  colors: string[];
  /** Minute of the k-th station, for pacing the clock by share counted. */
  minutes: number[];
}

const cache = new Map<string, Prepared>();
function prepare(code: string, w: number, h: number): Prepared {
  const key = `${code}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = DATA.find((x) => x.code === code) ?? DATA[0]!;
  const obj = TOPO.objects.areas;
  const fc = feature(TOPO, {
    ...obj,
    geometries: obj.geometries.filter((g) => String(g.id).startsWith(c.code)),
  });
  const projection = geoMercator().fitSize([w, h], fc);
  const path = geoPath(projection);
  const paths = fc.features.map((f) => path(f) ?? "");

  // Each polling place in the area its projected point falls in.
  const ctx = document.createElement("canvas").getContext("2d")!;
  const shapes = paths.map((d) => new Path2D(d));
  const placeArea = c.places.map(([lon, lat]) => {
    const p = projection([lon, lat]);
    if (!p) return -1;
    return shapes.findIndex((s) => ctx.isPointInPath(s, p[0], p[1], "evenodd"));
  });
  const area = Int32Array.from(c.stations, (s) => (s[0]! >= 0 ? placeArea[s[0]!]! : -1));
  const size = new Int32Array(paths.length);
  area.forEach((a) => {
    if (a >= 0) size[a] = size[a]! + 1;
  });

  // Party colors, unless two candidates would look alike (green and teal, blue and sky…).
  const used = new Set<string>();
  const colors = c.parties.map((party, i) => {
    if (c.names[i] === "Outros") return COLOR.gray;
    let col = party ? COLOR[partyColor(party, MAP.lineages)] : COLOR.gray;
    if (col === COLOR.gray || used.has(family(col))) col = FALLBACK.find((f) => !used.has(family(f)))!;
    used.add(family(col));
    return col;
  });
  const prepared = { c, paths, area, size, colors, minutes: c.stations.map((s) => s[1]!) };
  cache.set(key, prepared);
  return prepared;
}

function Capital({ code }: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const box = portrait
    ? { x: pad, y: 280 * u, w: width - 2 * pad, h: 820 * u }
    : { x: pad + 640 * u, y: 120 * u, w: width - pad * 2 - 640 * u, h: height - 240 * u };
  const P = useMemo(() => prepare(code, Math.round(box.w), Math.round(box.h)), [code, box.w, box.h]);
  const { c, paths, area, size, colors, minutes } = P;
  const n = c.stations.length;

  // The clock runs half by time, half by share of stations counted, so the long tail of
  // late reports does not take the whole video.
  const p = Easing.inOut(Easing.quad)(interpolate(frame, [INTRO, INTRO + COUNT], [0, 1], clamp));
  const last = minutes[n - 1] ?? 0;
  const byCount = minutes[Math.min(n - 1, Math.floor(p * n))] ?? 0;
  const now = p >= 1 ? last : 0.5 * p * last + 0.5 * byCount;
  // Stations in by now (sorted by minute in the pipeline).
  let k = 0;
  while (k < n && minutes[k]! <= now) k++;
  if (p >= 1) k = n;

  // Tallies: per area (for colors) and for the whole capital (scoreboard).
  const cands = c.names.length;
  const areaVotes = paths.map(() => new Array<number>(cands).fill(0));
  const areaIn = new Int32Array(paths.length);
  const areaLast = new Float64Array(paths.length).fill(-1);
  const total = new Array<number>(cands).fill(0);
  for (let i = 0; i < k; i++) {
    const s = c.stations[i]!;
    const a = area[i]!;
    for (let j = 0; j < cands; j++) total[j]! += s[2 + j]!;
    if (a < 0) continue;
    for (let j = 0; j < cands; j++) areaVotes[a]![j]! += s[2 + j]!;
    areaIn[a] = areaIn[a]! + 1;
    areaLast[a] = s[1]!;
  }
  const valid = total.reduce((a, b) => a + b, 0);
  // Frames per minute of clock, to turn "arrived at minute m" into a short flash.
  const framesPerMinute = COUNT / Math.max(1, last);

  const fills = paths.map((_, a) => {
    if (!areaIn[a]) return null;
    const v = areaVotes[a]!;
    const order = v.map((x, j) => [x, j] as const).sort((x, y) => y[0] - x[0]);
    const sum = v.reduce((x, y) => x + y, 0) || 1;
    const margin = ((order[0]![0] - (order[1]?.[0] ?? 0)) / sum) * 100;
    let step = 0;
    MARGIN_STEPS.forEach((start, i) => margin >= start && (step = i));
    const base = rgb(colors[order[0]![1]]!);
    let col = mixRgb(rgb(T.surface), base, MIX[step]!);
    // Lighter while partly counted, and a flash when a report has just arrived.
    col = mixRgb(rgb(T.surface), col, 0.35 + 0.65 * (areaIn[a] / Math.max(1, size[a]!)));
    const since = (now - areaLast[a]!) * framesPerMinute;
    if (p < 1 && since < FLASH) col = mixRgb(col, [255, 255, 255], 0.5 * (1 - since / FLASH));
    return css(col);
  });

  const clock = 17 * 60 + Math.floor(now);
  const hh = Math.floor(clock / 60) % 24;
  const mm = clock % 60;
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const outro = interpolate(frame, [INTRO + COUNT + 10, INTRO + COUNT + 30], [0, 1], clamp);
  const ranked = total
    .map((v, j) => [v, j] as const)
    .filter(([, j]) => c.names[j] !== "Outros")
    .sort((x, y) => y[0] - x[0])
    .slice(0, 3);
  const winnerHere = ranked[0];
  const here = (name: string) => {
    const j = c.names.indexOf(name);
    return j >= 0 && valid ? (total[j]! / valid) * 100 : 0;
  };
  const electedIdx = c.elected ? c.names.indexOf(c.elected.name) : -1;
  const electedHere = c.elected ? here(c.elected.name) : 0;
  const winnerName = nameOf(c.names[winnerHere?.[1] ?? 0]!);
  const pair = c.runoff ?? [];
  const pairIdx = pair.map((s) => c.names.indexOf(s.name));
  const wholeUnit = c.uf === "DF";

  const board = portrait
    ? { left: pad, right: pad, top: (c.annulled?.length ? 1080 : 1130) * u }
    : { left: pad, width: 560 * u, top: 330 * u };

  return (
    <Stage>
      <Header
        title={`Como ${ARTICLE[c.name] ?? ""}${c.name} votou para governador`}
        subtitle="1º turno de 2026 · cada área se pinta quando suas urnas chegam"
        opacity={headerIn}
      />
      <svg
        width={box.w}
        height={box.h}
        style={{ position: "absolute", left: box.x, top: box.y, opacity: headerIn, overflow: "visible" }}
      >
        {paths.map((d, a) => (
          <path key={a} d={d} fill={fills[a] ?? "#1c1f23"} stroke={T.bg} strokeWidth={1.2 * u} />
        ))}
      </svg>

      <div style={{ position: "absolute", ...board, opacity: headerIn }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 * u }}>
          <div
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 110 * u,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hh}h{String(mm).padStart(2, "0")}
          </div>
          <div style={{ fontSize: 20 * u, color: T.muted }}>horário de Brasília</div>
        </div>
        <div style={{ marginTop: 18 * u, fontSize: 22 * u, color: T.ink2, display: "flex", justifyContent: "space-between" }}>
          <span>urnas apuradas na capital</span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{pct((k / Math.max(1, n)) * 100, 1)}</b>
        </div>
        <div style={{ height: 10 * u, background: T.rule, borderRadius: 5 * u, marginTop: 8 * u, overflow: "hidden" }}>
          <div style={{ width: `${(k / Math.max(1, n)) * 100}%`, height: "100%", background: T.ink2 }} />
        </div>
        <div style={{ marginTop: 30 * u, display: "flex", flexDirection: "column", gap: 22 * u }}>
          {ranked.map(([v, j]) => {
            const share = valid ? (v / valid) * 100 : 0;
            return (
              <div key={j}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 * u }}>
                  <span style={{ fontSize: 28 * u, display: "flex", alignItems: "center", gap: 12 * u }}>
                    <i style={{ width: 18 * u, height: 18 * u, borderRadius: 3 * u, background: colors[j] }} />
                    {nameOf(c.names[j]!)} <span style={{ color: T.muted, fontSize: 20 * u }}>{c.parties[j]}</span>
                  </span>
                  <b
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 56 * u,
                      lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {/* Just under half must not read as 50,0%: that decides a runoff. */}
                    {pct(share, share < 50 && share >= 49.95 ? 2 : 1)}
                  </b>
                </div>
                <div style={{ height: 12 * u, background: T.rule, borderRadius: 3 * u, marginTop: 8 * u }}>
                  <div style={{ width: `${share}%`, height: "100%", background: colors[j], borderRadius: 3 * u }} />
                </div>
                <div style={{ fontSize: 19 * u, color: T.muted, marginTop: 5 * u }}>{int(v)} votos</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 30 * u, fontSize: 28 * u, lineHeight: 1.35, opacity: outro, fontWeight: 500 }}>
          {c.elected ? (
            <>
              {nameOf(c.elected.name)} ({c.elected.party}) venceu no 1º turno, com {pct(c.elected.share)} no estado.{" "}
              {winnerHere && winnerHere[1] === electedIdx
                ? `Na capital, teve ${pct(electedHere)}.`
                : `Na capital, ficou com ${pct(electedHere)}; ${winnerName} venceu aqui.`}
            </>
          ) : (
            <>
              {/* Two decimals: 49,98% must not read as half. */}
              {list(pair.map((s) => `${nameOf(s.name)} (${s.party})`))} vão ao 2º turno em 25/10, com{" "}
              {list(pair.map((s) => pct(s.share, 2)))} {wholeUnit ? "no Distrito Federal" : "no estado"}.
              {/* Brasília is the whole Distrito Federal: its count is the state's. */}
              {wholeUnit ? null : (
                <>
                  {" "}
                  Na capital,{" "}
                  {pair.map((s, i) => `${nameOf(s.name)}${i ? "," : " teve"} ${pct(here(s.name))}`).join(" e ")}
                  {winnerHere && !pairIdx.includes(winnerHere[1]) ? `; ${winnerName} venceu aqui.` : "."}
                </>
              )}
            </>
          )}
          {c.annulled?.length ? (
            <div style={{ fontSize: 20 * u, color: T.muted, fontWeight: 400, marginTop: 10 * u }}>
              Os votos em {list(c.annulled.map(nameOf))} foram anulados pela Justiça Eleitoral e não entram nos
              válidos.
            </div>
          ) : null}
        </div>
      </div>
      <Footer
        source="Boletins de urna do TSE · local de votação de cada seção · áreas: IBGE"
        opacity={headerIn}
      />
    </Stage>
  );
}

export const CAPITAL_CODES = DATA.map((c) => c.code);

export const def = motion<Props>({
  id: "Capital",
  title: "Governador nas capitais",
  description:
    "Cada capital pintada área por área na ordem em que as urnas do governador chegaram no 1º turno: quem venceu ou quem vai ao 2º turno.",
  component: Capital,
  defaultProps: { code: DATA[0]?.code ?? "" },
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
  controls: [
    {
      prop: "code",
      label: "Capital",
      options: DATA.map((c) => ({ value: c.code, label: `${c.name} (${c.uf})${c.runoff ? " · 2º turno" : ""}` })),
    },
  ],
});
