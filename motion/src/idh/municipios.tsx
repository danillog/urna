/**
 * "30 anos de IDHM, cidade por cidade": the 5,570 municipalities colored by IDHM in each
 * census (1991, 2000, 2010 and our 2022 estimate), the count per Atlas tier ticking along,
 * then who rose the most, who rose the least, who stayed behind, and the gap between regions.
 */
import { useLayoutEffect, useRef } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COUNT, MAP, bytes, geo, paint } from "../common/municipios";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import type { Cue } from "./sound";
import { DISPLAY, T, css, int, pct, rgb } from "../common/theme";
import { Big, Caption, Kicker, ScaleKey, TIERS, clamp, dec, ease, hdiRgb, signed, tierOf } from "./kit";

type Props = Record<string, never>;

const YEARS = Object.keys(MAP.idhm ?? {})
  .map(Number)
  .sort((a, b) => a - b);
const FIRST = YEARS[0]!;
const LAST = YEARS.at(-1)!;
const ESTIMATE = new Set(MAP.idhmEstimate?.years ?? []);
/** IDHM per municipality per year, 0..1 (NaN where there is no figure). */
const VALUES: Float32Array[] = YEARS.map((y) => {
  const raw = new Uint16Array(bytes(MAP.idhm![String(y)]!).buffer);
  return Float32Array.from(raw, (v) => (v ? v / 1000 : NaN));
});
const NAMES = MAP.municipalities.names;
const UF = MAP.municipalities.uf;

const NO_DATA = rgb(T.rule);
const FILLS: Float32Array[] = VALUES.map((vs) => {
  const out = new Float32Array(COUNT * 3);
  vs.forEach((v, i) => out.set(Number.isNaN(v) ? NO_DATA : hdiRgb(v), i * 3));
  return out;
});

/** Municipalities per Atlas tier, per year. */
const TIER_COUNTS = VALUES.map((vs) => {
  const c = TIERS.map(() => 0);
  for (const v of vs) if (!Number.isNaN(v)) c[tierOf(v)]! += 1;
  return c;
});
const counted = (k: number) => TIER_COUNTS[k]!.reduce((a, b) => a + b, 0);

const REGIONS: { name: string; ufs: string[] }[] = [
  { name: "Norte", ufs: ["RO", "AC", "AM", "RR", "PA", "AP", "TO"] },
  { name: "Nordeste", ufs: ["MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE", "BA"] },
  { name: "Centro-Oeste", ufs: ["MS", "MT", "GO", "DF"] },
  { name: "Sudeste", ufs: ["MG", "ES", "RJ", "SP"] },
  { name: "Sul", ufs: ["PR", "SC", "RS"] },
];
/** Plain mean over the region's municipalities, per year. */
const REGION_MEAN = REGIONS.map((r) =>
  VALUES.map((vs) => {
    let s = 0;
    let n = 0;
    vs.forEach((v, i) => {
      if (!Number.isNaN(v) && r.ufs.includes(UF[i]!)) {
        s += v;
        n += 1;
      }
    });
    return s / n;
  }),
);
const regionMean = (name: string, year: number) =>
  REGION_MEAN[REGIONS.findIndex((r) => r.name === name)]![YEARS.indexOf(year)]!;

// The stories.
const both = [...Array(COUNT).keys()].filter((i) => !Number.isNaN(VALUES[0]![i]!) && !Number.isNaN(VALUES.at(-1)![i]!));
const gain = (i: number) => VALUES.at(-1)![i]! - VALUES[0]![i]!;
const byGain = [...both].sort((a, b) => gain(b) - gain(a));
const ROSE_MOST = byGain.slice(0, 2);
const ROSE_LEAST = byGain.slice(-2).reverse();
const lowestIn = (k: number) =>
  [...Array(COUNT).keys()].filter((i) => !Number.isNaN(VALUES[k]![i]!)).sort((a, b) => VALUES[k]![a]! - VALUES[k]![b]!);
const BEHIND = lowestIn(YEARS.length - 1).slice(0, 2);
const LOWEST_FIRST = lowestIn(0)[0]!;
/** Share of municipalities below i in the first census, to say whether it already started high. */
const firstRank = (i: number) => both.filter((j) => VALUES[0]![j]! < VALUES[0]![i]!).length / both.length;
const LEAST_STARTED_HIGH = ROSE_LEAST.every((i) => firstRank(i) > 0.9);

const place = (i: number) => `${NAMES[i]} (${UF[i]})`;

// Timeline (frames at 30 fps).
const INTRO = 50;
const HOLD = 110;
const MOVE = 45;
const YEARS_END = INTRO + YEARS.length * HOLD + (YEARS.length - 1) * MOVE;
const STOP = 150;
const STOPS = 3;
const REGIONS_AT = YEARS_END + STOPS * STOP;
const REGIONS_LEN = 300;
const OUTRO_AT = REGIONS_AT + REGIONS_LEN;
const OUTRO = 150;
const DURATION = OUTRO_AT + OUTRO;

/** Which municipalities a highlight stop rings, and in which color. */
const STOP_PICKS = [ROSE_MOST, ROSE_LEAST, BEHIND];
const STOP_COLOR = ["#fde725", "#9fd3ff", "#ff8a7a"];

/** Year index and progress of the move to the next one, at a frame. */
function yearAt(frame: number): { k: number; p: number } {
  const t = frame - INTRO;
  if (t < 0) return { k: 0, p: 0 };
  if (frame >= YEARS_END) return { k: YEARS.length - 1, p: 0 };
  const step = HOLD + MOVE;
  const k = Math.min(YEARS.length - 1, Math.floor(t / step));
  const p = k < YEARS.length - 1 ? interpolate(t - k * step, [HOLD, step], [0, 1], clamp) : 0;
  return { k, p };
}

function IdhmMunicipios(_: Props) {
  const frame = useCurrentFrame();
  const { width, u, pad } = useLayout();
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = { x: pad, y: 300 * u, w: width - 2 * pad, h: 880 * u };
  const { k, p } = yearAt(frame);

  const stop = frame >= YEARS_END && frame < REGIONS_AT ? Math.floor((frame - YEARS_END) / STOP) : -1;
  // Everything else dims while a stop rings its municipalities.
  const dim =
    frame < YEARS_END ? 0 : interpolate(frame, [YEARS_END, YEARS_END + 20, REGIONS_AT - 20, REGIONS_AT], [0, 0.72, 0.72, 0], clamp);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = geo(box.w, box.h);
    const fa = FILLS[k]!;
    const fb = FILLS[Math.min(k + 1, YEARS.length - 1)]!;
    const bg = rgb(T.bg);
    const mapIn = interpolate(frame, [6, 40], [0, 1], clamp);
    const picks = new Set(stop >= 0 ? STOP_PICKS[stop] : []);
    paint(
      el,
      g,
      (i) => {
        // The new colors sweep west to east across the move.
        const q = p === 0 ? 0 : ease(interpolate(p, [g.nx[i]! * 0.6, g.nx[i]! * 0.6 + 0.4], [0, 1], clamp));
        let c = [0, 1, 2].map((j) => fa[i * 3 + j]! + (fb[i * 3 + j]! - fa[i * 3 + j]!) * q);
        const d = picks.has(i) ? 0 : dim;
        const fade = mapIn * (1 - d);
        c = c.map((v, j) => bg[j]! + (v - bg[j]!) * fade);
        return css(c);
      },
      { color: T.bg, width: 1.1 * u },
    );
    if (stop < 0) return;
    // Rings around the stop's municipalities, numbered as in the card.
    const ctx = el.getContext("2d")!;
    const t = frame - (YEARS_END + stop * STOP);
    const grow = interpolate(t, [8, 30], [0, 1], { ...clamp, easing: ease });
    const out = interpolate(t, [STOP - 14, STOP], [1, 0], clamp);
    STOP_PICKS[stop]!.forEach((i, n) => {
      const x = g.cx[i]!;
      const y = g.cy[i]!;
      const r = (22 + 4 * Math.sin(t / 6)) * u * grow;
      ctx.globalAlpha = out;
      ctx.strokeStyle = STOP_COLOR[stop]!;
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = STOP_COLOR[stop]!;
      ctx.beginPath();
      ctx.arc(x + r * 0.9, y - r * 0.9, 17 * u * grow, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = T.bg;
      ctx.font = `700 ${22 * u}px ${DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n + 1), x + r * 0.9, y - r * 0.9 + 1);
      ctx.globalAlpha = 1;
    });
  });

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const panelTop = 1215 * u;
  return (
    <Stage>
      <Header
        title="30 anos de IDHM, cidade por cidade"
        subtitle={`${FIRST} a ${LAST}: o desenvolvimento humano em cada um dos ${int(COUNT)} municípios`}
        opacity={headerIn}
      />
      <canvas
        ref={canvas}
        width={Math.round(box.w)}
        height={Math.round(box.h)}
        style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}
      />
      <YearsPanel k={k} p={p} top={panelTop} opacity={headerIn * interpolate(frame, [YEARS_END - 12, YEARS_END], [1, 0], clamp)} />
      <YearCaptions top={1680 * u} />
      <Stops top={panelTop} />
      <RegionsPanel top={panelTop} />
      <Outro top={panelTop} />
      <Footer
        source={
          ESTIMATE.has(LAST)
            ? `IDHM: Atlas Brasil (PNUD, Ipea, FJP); ${LAST}: estimativa do Urna com o Censo`
            : "IDHM: Atlas do Desenvolvimento Humano no Brasil (PNUD, Ipea, FJP)"
        }
        opacity={headerIn}
      />
    </Stage>
  );
}

/** The year, and the municipalities per tier ticking from one census to the next. */
function YearsPanel({ k, p, top, opacity }: { k: number; p: number; top: number; opacity: number }) {
  const { u, pad } = useLayout();
  if (opacity === 0) return null;
  const shown = p < 0.5 ? k : k + 1;
  const flip = p === 0 ? 1 : Math.abs(p - 0.5) * 2;
  const q = ease(p);
  const a = TIER_COUNTS[k]!;
  const b = TIER_COUNTS[Math.min(k + 1, YEARS.length - 1)]!;
  const now = a.map((v, i) => v + (b[i]! - v) * q);
  const total = counted(shown);
  const year = YEARS[shown]!;
  return (
    <div style={{ position: "absolute", left: pad, right: pad, top, opacity }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 22 * u, opacity: flip }}>
        <Big>{year}</Big>
        {ESTIMATE.has(year) ? (
          <span style={{ fontSize: 26 * u, color: T.ink2 }}>estimativa (o Atlas ainda não publicou)</span>
        ) : null}
      </div>
      <div style={{ fontSize: 22 * u, color: T.muted, margin: `${16 * u}px 0 ${10 * u}px` }}>
        municípios por faixa de IDHM
      </div>
      {TIERS.map((t, i) => (
        <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 14 * u, height: 44 * u }}>
          <span style={{ width: 170 * u, fontSize: 26 * u, color: T.ink2 }}>{t.label}</span>
          <div style={{ flex: 1, height: 26 * u, background: T.surface, borderRadius: 4 * u }}>
            <div
              style={{
                width: `${(now[i]! / total) * 100}%`,
                height: "100%",
                background: t.color,
                borderRadius: 4 * u,
              }}
            />
          </div>
          <span
            style={{
              width: 110 * u,
              textAlign: "right",
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: 36 * u,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {int(now[i]!)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One line under the panel per census. */
function YearCaptions({ top }: { top: number }) {
  const { u } = useLayout();
  const ne = (y: number) => regionMean("Nordeste", y);
  const s = (y: number) => regionMean("Sul", y);
  const t0 = TIER_COUNTS[0]!;
  const tl = TIER_COUNTS.at(-1)!;
  const lines = YEARS.map((y, k) => {
    if (k === 0) {
      return (
        <>
          <b>{pct((t0[0]! / counted(0)) * 100, 0)}</b> das cidades com IDHM muito baixo.
          {t0[3]! + t0[4]! === 0 ? " Nenhuma chegava a alto." : null}
        </>
      );
    }
    if (k === YEARS.length - 1) {
      return (
        <>
          <b>{pct(((tl[3]! + tl[4]!) / counted(k)) * 100, 0)}</b> das cidades já com IDHM alto ou muito alto.{" "}
          {tl[0] === 0 ? "Nenhuma no muito baixo." : null}
        </>
      );
    }
    const prev = YEARS[k - 1]!;
    // Who is pulling ahead in this decade: the South's lead or the Northeast's catch-up.
    return ne(y) - ne(prev) > s(y) - s(prev) ? (
      <>
        O Nordeste acelera: <b>{signed(ne(y) - ne(prev))}</b> na média, contra {signed(s(y) - s(prev))} no Sul.
      </>
    ) : (
      <>
        Sul e Sudeste saem na frente: média de <b>{dec(s(y))}</b> no Sul e {dec(ne(y))} no Nordeste.
      </>
    );
  });
  return (
    <>
      {lines.map((l, k) => {
        const from = INTRO + k * (HOLD + MOVE) + 10;
        return (
          <Caption key={k} from={from} to={from + HOLD + (k === YEARS.length - 1 ? 20 : 10)} top={top}>
            <span style={{ fontSize: 34 * u, color: T.ink2 }}>{l}</span>
          </Caption>
        );
      })}
    </>
  );
}

function PlaceRow({ i, n, color }: { i: number; n: number; color: string }) {
  const { u } = useLayout();
  const a = VALUES[0]![i]!;
  const b = VALUES.at(-1)![i]!;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 * u, marginTop: 22 * u }}>
      <span
        style={{
          width: 48 * u,
          height: 48 * u,
          borderRadius: "50%",
          background: color,
          color: T.bg,
          display: "grid",
          placeItems: "center",
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 30 * u,
          flex: "none",
        }}
      >
        {n}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 40 * u, fontWeight: 600, lineHeight: 1.15 }}>{place(i)}</div>
        <div style={{ fontSize: 30 * u, color: T.ink2, fontVariantNumeric: "tabular-nums" }}>
          {FIRST}: {dec(a)} → {LAST}: <b style={{ color: T.ink }}>{dec(b)}</b>{" "}
          <span style={{ color }}>({signed(b - a)})</span>
        </div>
      </div>
    </div>
  );
}

/** Who rose the most, the least, and who is lowest now. */
function Stops({ top }: { top: number }) {
  const { u } = useLayout();
  const cards = [
    {
      kicker: "Quem mais subiu",
      line: `Saíram do fundo da tabela em ${FIRST}.`,
      picks: ROSE_MOST,
    },
    {
      kicker: "Quem menos subiu",
      line: LEAST_STARTED_HIGH ? `Já estavam entre os 10% mais altos em ${FIRST}: tinham menos espaço para subir.` : "",
      picks: ROSE_LEAST,
    },
    {
      kicker: `Os mais baixos em ${LAST}`,
      line: `Em ${FIRST}, o mais baixo do país era ${place(LOWEST_FIRST)}.`,
      picks: BEHIND,
    },
  ];
  return (
    <>
      {cards.map((c, s) => (
        <Caption key={c.kicker} from={YEARS_END + s * STOP} to={YEARS_END + (s + 1) * STOP} top={top}>
          <Kicker color={STOP_COLOR[s]}>{c.kicker}</Kicker>
          {c.picks.map((i, n) => (
            <PlaceRow key={i} i={i} n={n + 1} color={STOP_COLOR[s]!} />
          ))}
          {c.line ? <div style={{ marginTop: 26 * u, fontSize: 30 * u, color: T.muted }}>{c.line}</div> : null}
        </Caption>
      ))}
    </>
  );
}

/** Mean per region, first census against the last, bars growing. */
function RegionsPanel({ top }: { top: number }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const grow = ease(interpolate(frame, [REGIONS_AT + 15, REGIONS_AT + 75], [0, 1], clamp));
  const gapFirst = regionMean("Sul", FIRST) - regionMean("Nordeste", FIRST);
  const gapLast = regionMean("Sul", LAST) - regionMean("Nordeste", LAST);
  // The census where the South had what the Northeast has now, if any.
  const southThen = YEARS.find((y) => regionMean("Sul", y) >= regionMean("Nordeste", LAST));
  const lo = 0.25;
  const hi = 0.85;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <Caption from={REGIONS_AT} to={OUTRO_AT} top={top}>
      <Kicker>Média dos municípios por região</Kicker>
      {REGIONS.map((r, i) => {
        const a = REGION_MEAN[i]![0]!;
        const b = REGION_MEAN[i]!.at(-1)!;
        return (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 14 * u, height: 50 * u }}>
            <span style={{ width: 210 * u, fontSize: 28 * u, color: T.ink2 }}>{r.name}</span>
            <div style={{ position: "relative", flex: 1, height: 22 * u }}>
              <div
                style={{
                  position: "absolute",
                  left: x(a),
                  width: `calc(${x(a + (b - a) * grow)} - ${x(a)})`,
                  top: 8 * u,
                  height: 6 * u,
                  background: T.muted,
                }}
              />
              <i style={dot(x(a), T.ink2, u)} />
              <i style={dot(x(a + (b - a) * grow), "#fde725", u)} />
            </div>
            <span style={{ width: 120 * u, textAlign: "right", fontSize: 28 * u, fontVariantNumeric: "tabular-nums" }}>
              {signed((b - a) * grow)}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 28 * u, fontSize: 22 * u, color: T.muted, margin: `${16 * u}px 0 ${18 * u}px` }}>
        <span>
          <i style={{ ...dot("0", T.ink2, u), position: "static", display: "inline-block", marginRight: 8 * u }} />
          {FIRST}
        </span>
        <span>
          <i style={{ ...dot("0", "#fde725", u), position: "static", display: "inline-block", marginRight: 8 * u }} />
          {LAST}
        </span>
      </div>
      <div style={{ fontSize: 34 * u, lineHeight: 1.35, opacity: interpolate(frame, [REGIONS_AT + 90, REGIONS_AT + 110], [0, 1], clamp) }}>
        A distância entre Sul e Nordeste caiu de <b>{dec(gapFirst)}</b> para <b>{dec(gapLast)}</b>.
        {southThen && southThen < LAST ? (
          <span style={{ color: T.ink2 }}>
            {" "}
            Mas o Nordeste de {LAST} ainda não chegou ao Sul de {southThen}.
          </span>
        ) : null}
      </div>
    </Caption>
  );
}

const dot = (left: string, color: string, u: number) =>
  ({
    position: "absolute",
    left,
    top: 0,
    width: 22 * u,
    height: 22 * u,
    marginLeft: -11 * u,
    borderRadius: "50%",
    background: color,
  }) as const;

function Outro({ top }: { top: number }) {
  const { u } = useLayout();
  return (
    <Caption from={OUTRO_AT} to={DURATION + 30} top={top}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 76 * u, lineHeight: 1.05 }}>
        E a sua cidade?
      </div>
      <div style={{ marginTop: 18 * u, fontSize: 36 * u, color: T.ink2 }}>
        Veja o IDHM de cada município, censo a censo, em <b style={{ color: T.ink }}>danillogomes.com/urna</b>.
      </div>
      {ESTIMATE.has(LAST) ? (
        <div style={{ marginTop: 28 * u, fontSize: 24 * u, color: T.muted, lineHeight: 1.4 }}>
          {LAST}: estimativa feita com as tabelas do Censo, calibrada no IDHM oficial de 2010 (erro médio de{" "}
          {dec(MAP.idhmEstimate!.error2010)}).
        </div>
      ) : null}
      <div style={{ marginTop: 34 * u }}>
        <ScaleKey />
      </div>
    </Caption>
  );
}

/** Whoosh into each census, a swish per highlight, a hit for the regions, a chime at the end. */
export const cues: Cue[] = [
  ...YEARS.slice(1).map((_, k) => ({ name: "whoosh" as const, at: INTRO + k * (HOLD + MOVE) + HOLD })),
  ...Array.from({ length: STOPS }, (_, s) => ({ name: "swish" as const, at: YEARS_END + s * STOP + 4 })),
  ...Array.from({ length: STOPS * 2 }, (_, i) => ({
    name: "pop" as const,
    at: YEARS_END + Math.floor(i / 2) * STOP + 14 + (i % 2) * 8,
    volume: 0.35,
  })),
  { name: "hit", at: REGIONS_AT + 10 },
  { name: "chime", at: OUTRO_AT + 6 },
];

export const def = motion<Props>({
  id: "IdhmMunicipios",
  title: "30 anos de IDHM, cidade por cidade",
  description: "Os 5.570 municípios de 1991 a 2022: quem mais subiu, quem menos subiu e quem ficou para trás.",
  component: IdhmMunicipios,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait"],
});
