import { geoAzimuthalEqualArea, geoPath } from "d3-geo";
import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
import americasJson from "../../../data/generated/americas.json";
import topoJson from "../../../data/generated/americas.topo.json";
import { countByFamily, electionAt, regionFamily, type AmericasData } from "../../../src/model/americas";
import { Footer, Header, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { BODY, DISPLAY, FAMILY, T, rgb } from "../common/theme";

const data = americasJson as unknown as AmericasData;
const topology = topoJson as unknown as Topology<{
  americas: GeometryCollection<{ name: string; country: string; code: string }>;
}>;

/** texto: false is the background loop (Gomes Code's home); true, the Reels with title and legend. */
type Props = { texto: boolean };

const FAMILY_NAME: Record<string, string> = {
  left: "Esquerda",
  "centre-left": "Centro-esquerda",
  "centre-right": "Centro-direita",
  right: "Direita",
};

const FIRST = 2000;
const LAST = 2026;
const YEARS = LAST - FIRST + 1;
/** Each year: a crossfade, then a short hold. */
const STEP = 36;
const FADE = 22;
/** Brazil lights up on the last year, then everything fades back to 2000. */
const GLOW = 165;
const BACK = 75;
const DURATION = YEARS * STEP + GLOW + BACK;

const NO_DATA = rgb("#23272c");
const BG = rgb(T.bg);
const BRAZIL_LIGHT = rgb("#ffe7b8");

type RGB = [number, number, number];

const countryOf = (g: GeometryObject) => (g.properties as { country?: string } | undefined)?.country;

interface Prepared {
  paths: Path2D[];
  countries: string[];
  codes: string[];
  /** 0..1 west → east, so a year's change sweeps across the map. */
  sweep: number[];
  /** Per-area phase for the breathing. */
  phase: number[];
  /** Color of each area in each year: years × areas. */
  colors: RGB[][];
  borders: Path2D;
  inner: Path2D;
  brazil: Path2D;
}

const cache = new Map<string, Prepared>();
/** The map fitted to the frame, then moved by the camera. */
/** Box the map is fitted into: x0, y0, x1, y1. */
type Box = [number, number, number, number];
function prepare(W: number, H: number, box: Box): Prepared {
  const key = `${W}x${H}:${box.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const object = topology.objects.americas;
  // Hawaii would sit alone in the Pacific, far from the frame: left out.
  const all = feature(topology, object);
  const fc = { ...all, features: all.features.filter((f) => f.properties.code !== "US-HI") };
  // Equal-area like the site. Upright in 9:16, where the tall continent fits as it is;
  // rolled a little in 16:9 so it leans into the wide frame.
  const projection = geoAzimuthalEqualArea().rotate([72, -5, H > W ? 0 : 22]);
  // Framed on the inhabited Americas: Canada's Arctic islands and Alaska's tip run off the top.
  const frame = {
    type: "FeatureCollection" as const,
    features: fc.features.filter((f) => !["CAN", "GRL"].includes(f.properties.country)),
  };
  projection.fitExtent(
    [
      [box[0], box[1]],
      [box[2], box[3]],
    ],
    frame,
  );
  const path = geoPath(projection);
  const paths = fc.features.map((f) => new Path2D(path(f) ?? ""));
  const xs = fc.features.map((f) => path.centroid(f)[0]);
  const minX = Math.min(...xs.filter(Number.isFinite));
  const maxX = Math.max(...xs.filter(Number.isFinite));
  const countries = fc.features.map((f) => f.properties.country);
  const codes = fc.features.map((f) => f.properties.code);
  const colors: RGB[][] = [];
  for (let y = FIRST; y <= LAST; y++) {
    colors.push(
      countries.map((c, i) => {
        const country = data.countries[c];
        const fam = country ? regionFamily(country, y, codes[i]!) : null;
        return fam ? rgb(FAMILY[fam]!) : NO_DATA;
      }),
    );
  }
  type G = GeometryObject;
  const prepared: Prepared = {
    paths,
    countries,
    codes,
    sweep: xs.map((x) => (Number.isFinite(x) ? (x - minX) / (maxX - minX) : 0.5)),
    phase: countries.map((_, i) => ((i * 2654435761) % 1000) / 1000),
    colors,
    borders: new Path2D(path(mesh(topology, object, (a: G, b: G) => countryOf(a) !== countryOf(b))) ?? ""),
    inner: new Path2D(
      path(mesh(topology, object, (a: G, b: G) => a !== b && countryOf(a) === countryOf(b))) ?? "",
    ),
    // Brazil's outline only: its coast and its borders, not the lines between its states.
    brazil: new Path2D(
      path(
        mesh(topology, object, (a: G, b: G) => {
          const ia = countryOf(a) === "BRA";
          return a === b ? ia : ia !== (countryOf(b) === "BRA");
        }),
      ) ?? "",
    ),
  };
  cache.set(key, prepared);
  return prepared;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
const lerp = (a: RGB, b: RGB, p: number): RGB => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

function Americas({ texto }: Props) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { portrait, u, pad } = useLayout();
  const ref = useRef<HTMLCanvasElement>(null);
  // With text, the map leaves room for the title and the legend.
  const box: Box = !texto
    ? [width * 0.07, height * 0.06, width * 0.93, height * 0.94]
    : portrait
      ? [pad, 300 * u, width - pad, height - 400 * u]
      : [width * 0.4, pad, width - pad, height - pad];

  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const P = prepare(width, height, box);
    const loop = frame / DURATION; // 0..1, seamless at both ends
    const glowStart = YEARS * STEP;
    const backStart = glowStart + GLOW;

    // Year shown: year k holds from k * STEP; its colors fade in over the first FADE frames
    // (year 0 needs no fade: the loop's end fades into it).
    const k = Math.min(YEARS - 1, Math.floor(frame / STEP));
    const into = frame - k * STEP;
    // Brazil: lights up, holds with a slow pulse, lets go while the map fades back to 2000.
    const glowIn = interpolate(frame, [glowStart - 20, glowStart + 40], [0, 1], { ...clamp, easing: ease });
    const glowOut = interpolate(frame, [backStart, backStart + BACK * 0.8], [1, 0], { ...clamp, easing: ease });
    const glow = glowIn * glowOut * (0.85 + 0.15 * Math.sin(((frame - glowStart) / 45) * Math.PI * 2));
    const back = interpolate(frame, [backStart, DURATION], [0, 1], { ...clamp, easing: ease });

    // Camera: a slow ellipse and a breath of zoom, one full turn per loop.
    const angle = loop * Math.PI * 2;
    const zoom = 1.015 + 0.02 * Math.sin(angle);
    const dx = 22 * Math.cos(angle);
    const dy = 12 * Math.sin(angle * 2);
    const s = zoom;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(s, 0, 0, s, width / 2 - (width / 2) * s + dx, height / 2 - (height / 2) * s + dy);

    const n = P.paths.length;
    for (let i = 0; i < n; i++) {
      let c: RGB;
      if (frame >= backStart) {
        c = lerp(P.colors[YEARS - 1]![i]!, P.colors[0]![i]!, back);
      } else if (k > 0) {
        // The change sweeps west to east across the crossfade.
        const d = P.sweep[i]! * (FADE * 0.45);
        const q = ease(interpolate(into, [d, d + FADE * 0.55], [0, 1], clamp));
        c = lerp(P.colors[k - 1]![i]!, P.colors[k]![i]!, q);
      } else {
        c = P.colors[0]![i]!;
      }
      // Breathing: each area drifts a few percent lighter and darker, out of step with its neighbours.
      const b = 0.045 * Math.sin(angle * 3 + P.phase[i]! * Math.PI * 2);
      c = b > 0 ? lerp(c, [255, 255, 255], b) : lerp(c, BG, -b);
      if (glow > 0) {
        c = P.countries[i] === "BRA" ? lerp(c, BRAZIL_LIGHT, 0.22 * glow) : lerp(c, BG, 0.55 * glow);
      }
      ctx.fillStyle = css(c);
      ctx.fill(P.paths[i]!);
    }

    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(15,17,19,0.55)`;
    ctx.lineWidth = 0.5 / zoom;
    ctx.stroke(P.inner);
    ctx.strokeStyle = T.bg;
    ctx.lineWidth = 1.4 / zoom;
    ctx.stroke(P.borders);

    if (glow > 0) {
      // A soft halo around Brazil, then its outline in warm light.
      ctx.save();
      ctx.shadowColor = `rgba(255,214,150,${0.75 * glow})`;
      ctx.shadowBlur = 60 * s;
      ctx.strokeStyle = `rgba(255,226,180,${0.9 * glow})`;
      ctx.lineWidth = 2.2 / zoom;
      ctx.stroke(P.brazil);
      ctx.shadowBlur = 24 * s;
      ctx.stroke(P.brazil);
      ctx.restore();
    }
    }, [frame, width, height, texto]);

  return (
    <AbsoluteFill style={{ background: T.bg, color: T.ink, fontFamily: BODY }}>
      <canvas ref={ref} width={width} height={height} />
      {texto ? <Captions frame={frame} portrait={portrait} u={u} pad={pad} /> : null}
    </AbsoluteFill>
  );
}

const BRAZIL = data.countries.BRA!;

/** Title, the year, countries per family, and what Brazil's light means. */
function Captions({ frame, portrait, u, pad }: { frame: number; portrait: boolean; u: number; pad: number }) {
  const glowStart = YEARS * STEP;
  const backStart = glowStart + GLOW;
  const k = Math.min(YEARS - 1, Math.floor(frame / STEP));
  const year = FIRST + k;
  const counts = countByFamily(data, year);
  const fadeIn = interpolate(frame, [0, 15], [0, 1], clamp);
  // The year and the legend step aside while Brazil is lit, and come back with 2000.
  const yearOpacity = interpolate(frame, [glowStart + 5, glowStart + 25, DURATION - 20, DURATION], [1, 0, 0, 1], clamp);
  const note = interpolate(frame, [glowStart + 10, glowStart + 35, backStart, backStart + 20], [0, 1, 1, 0], clamp);
  const br = electionAt(BRAZIL, LAST);
  const brYear = br ? br.date.slice(0, 4) : "";
  const brFamily = br?.family ? FAMILY_NAME[br.family]!.toLowerCase() : "";

  const legend = (
    <div style={{ opacity: fadeIn * yearOpacity }}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 150 * u,
          lineHeight: 0.9,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {year}
      </div>
      <div style={{ fontSize: 22 * u, color: T.muted, margin: `${16 * u}px 0 ${10 * u}px` }}>
        países, pela família do presidente eleito
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${10 * u}px ${28 * u}px` }}>
        {data.families.map((f) => (
          <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 * u, fontSize: 26 * u }}>
            <i style={{ width: 20 * u, height: 20 * u, borderRadius: 4 * u, background: FAMILY[f] }} />
            <span style={{ flex: 1, color: T.ink2 }}>{FAMILY_NAME[f]}</span>
            <b style={{ fontVariantNumeric: "tabular-nums" }}>{counts.get(f) ?? 0}</b>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Header
        title="A onda nas Américas"
        subtitle="2000 a 2026: quem venceu a eleição para presidente, por estado onde há o dado"
        opacity={fadeIn}
      />
      <div
        style={{
          position: "absolute",
          left: pad,
          right: portrait ? pad : undefined,
          width: portrait ? undefined : 560 * u,
          ...(portrait ? { bottom: 140 * u } : { top: 520 * u }),
        }}
      >
        {legend}
      </div>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: portrait ? pad : undefined,
          width: portrait ? undefined : 560 * u,
          ...(portrait ? { bottom: 170 * u } : { top: 560 * u }),
          opacity: note,
          fontSize: 34 * u,
          lineHeight: 1.35,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64 * u, color: "#ffe2b4" }}>Brasil</div>
        Na eleição de {brYear}, {br?.winner} ({brFamily}). Cada estado tem a cor de quem venceu nele.
        <div style={{ color: T.ink2, fontSize: 28 * u, marginTop: 12 * u }}>2026: 2º turno em 25 de outubro.</div>
      </div>
      <Footer
        source={portrait ? "Wikipedia e Global Party Survey" : "Eleições: Wikipedia · posição dos partidos: Global Party Survey 2019"}
        opacity={fadeIn}
      />
    </>
  );
}

export const def = motion<Props>({
  id: "Americas",
  title: "A onda nas Américas, 2000–2026",
  description:
    "O continente mudando de cor ano a ano, e o Brasil acendendo no fim. Sem texto, é o loop de fundo da home.",
  component: Americas,
  defaultProps: { texto: true },
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
  loop: true,
  controls: [
    {
      prop: "texto",
      label: "Versão",
      options: [
        { value: true, label: "Com texto" },
        { value: false, label: "Fundo, sem texto" },
      ],
    },
  ],
});
