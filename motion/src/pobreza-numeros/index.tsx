/**
 * "Os pobres que o mapa esconde": the poverty map paints by percent, and 1.8% of the United
 * States looks like nothing. Here the same countries in people instead (bars that re-sort),
 * the smallest countries summed against the US, then the US by its own official line and
 * its states in a table. Data: motion/data/pobreza-absoluta.json (scripts/pobreza_absoluta.py).
 */
import { Easing, interpolate, useCurrentFrame } from "remotion";
import json from "../../data/pobreza-absoluta.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, pct } from "../common/theme";
import { Bed, Sfx } from "../video/sound";

interface Country {
  iso: string;
  name: string;
  year: number;
  rate: number;
  population: number;
  poor: number;
  urbanOnly: boolean;
}
interface Official {
  poor: number;
  rate: number;
  name: string;
}
interface Data {
  year: number;
  countries: Country[];
  usOfficial: Official & { series: Record<string, Official> };
  states: Official[];
}

const D = json as unknown as Data;
type Props = Record<string, never>;

const COUNTRIES = D.countries;
const US = COUNTRIES.find((c) => c.iso === "USA")!;
const BY_RATE = [...COUNTRIES].sort((a, b) => b.rate - a.rate);
const BY_POOR = [...COUNTRIES].sort((a, b) => b.poor - a.poor);
const MAX_RATE = BY_RATE[0]!.rate;
const MAX_POOR = BY_POOR[0]!.poor;
const US_RANK = BY_POOR.indexOf(US) + 1;

/** The smallest Latin American countries whose poor, summed, stay below the US's. */
const SMALL: Country[] = (() => {
  const out: Country[] = [];
  let sum = 0;
  for (const c of [...COUNTRIES].filter((c) => c.iso !== "USA" && c.iso !== "CAN").sort((a, b) => a.poor - b.poor)) {
    if (sum + c.poor > US.poor) break;
    out.push(c);
    sum += c.poor;
  }
  return out;
})();
const SMALL_SUM = SMALL.reduce((s, c) => s + c.poor, 0);

const SERIES = Object.entries(D.usOfficial.series)
  .map(([y, v]) => ({ year: Number(y), poor: v.poor }))
  .sort((a, b) => a.year - b.year);
const ONE_IN = Math.round(100 / D.usOfficial.rate);
const STATES = D.states.slice(0, 8);
const STATE_NAME: Record<string, string> = {
  California: "Califórnia",
  Florida: "Flórida",
  "New York": "Nova York",
  Pennsylvania: "Pensilvânia",
  Georgia: "Geórgia",
  "North Carolina": "Carolina do Norte",
  "New Jersey": "Nova Jersey",
};
const stateName = (n: string) => STATE_NAME[n] ?? n;

// Beats, in frames (30 fps, 60 s).
const B = { hook: 0, flip: 330, compare: 690, official: 990, table: 1320, close: 1620, end: 1800 };
const MORPH = [B.flip + 30, B.flip + 150] as const;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
const out = Easing.out(Easing.cubic);

const NUMBER = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];
const dec = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
/** 6.12e6 → "6,1 milhões"; 890e3 → "890 mil". */
function people(n: number): string {
  if (n >= 1e6) return `${dec(n / 1e6)} ${n >= 2e6 ? "milhões" : "milhão"}`;
  return `${Math.round(n / 1e3).toLocaleString("pt-BR")} mil`;
}
const mi = (n: number) => `${dec(n / 1e6)} mi`;

const colorOf = (c: Country) =>
  c.iso === "USA" ? COLOR.sky : c.iso === "CAN" ? COLOR.cyan : c.iso === "BRA" ? COLOR.gold : "#4a4f57";
const label = (c: Country) => `${c.name}${c.urbanOnly ? "*" : ""}`;

/** Fade in at `a`, out at `b` (frames), with a small rise. */
function useShow(a: number, b: number) {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [a, a + 15], [0, 1], { ...clamp, easing: out });
  const outP = interpolate(frame, [b - 15, b], [1, 0], clamp);
  return { opacity: inP * outP, rise: (1 - inP) * 24 };
}

function PobrezaNumeros(_: Props) {
  const frame = useCurrentFrame();
  const { height, portrait, u } = useLayout();
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const top = portrait ? 330 * u : 250 * u;
  const bottom = portrait ? height - 330 * u : height - 150 * u;

  return (
    <Stage>
      <Bed volume={0.12} />
      <Header
        title="Os pobres que o mapa esconde"
        subtitle={portrait ? "Percentual e número de pessoas" : "Percentual e número de pessoas na pobreza, nas Américas"}
        opacity={headerIn}
      />
      <Bars top={top} bottom={bottom} />
      <Compare top={top} bottom={bottom} />
      <OfficialLine top={top} bottom={bottom} />
      <StatesTable top={top} bottom={bottom} />
      <Closing top={top} />
      <Footer
        source={
          frame < B.official
            ? `Banco Mundial (PIP), US$ 8,30 por dia (PPC 2021), última pesquisa até ${D.year} · *Argentina: só áreas urbanas`
            : "Banco Mundial (PIP) e US Census Bureau (SAIPE)"
        }
        opacity={headerIn}
      />
      {/* Sounds */}
      <Sfx name="swish" at={MORPH[0]} volume={0.4} />
      <Sfx name="hit" at={B.compare + 40} volume={0.35} />
      {Array.from({ length: 16 }, (_, k) => (
        <Sfx key={k} name="tick" at={B.official + 20 + k * 6} volume={0.3} />
      ))}
      {STATES.map((_, i) => (
        <Sfx key={i} name="pop" at={B.table + 30 + i * 14} volume={0.3} />
      ))}
      <Sfx name="chime" at={B.close + 10} volume={0.45} />
    </Stage>
  );
}

/** Beats 1–2: percent bars, then the same bars in people, re-sorted. */
function Bars({ top, bottom }: { top: number; bottom: number }) {
  const frame = useCurrentFrame();
  const { width, portrait, u, pad } = useLayout();
  const show = useShow(B.hook, B.compare);
  if (show.opacity <= 0) return null;
  const grow = interpolate(frame, [15, 90], [0, 1], { ...clamp, easing: out });
  const t = interpolate(frame, MORPH, [0, 1], { ...clamp, easing: ease });
  // Landscape: the caption above the chart; portrait: below it.
  const captionTop = portrait ? bottom + 30 * u : top;
  const chartTop = top + (portrait ? 0 : 90 * u);
  const rowH = (bottom - chartTop) / COUNTRIES.length;
  const labelW = (portrait ? 290 : 300) * u;
  const valueW = (portrait ? 190 : 220) * u;
  const barX = pad + labelW + 14 * u;
  const barMax = width - pad - valueW - barX;
  const firstCaption = interpolate(frame, [110, 125, MORPH[0] - 10, MORPH[0]], [0, 1, 1, 0], clamp);
  const secondCaption = interpolate(frame, [MORPH[1] + 10, MORPH[1] + 25], [0, 1], clamp);

  return (
    <div style={{ position: "absolute", inset: 0, opacity: show.opacity }}>
      {COUNTRIES.map((c) => {
        const y = BY_RATE.indexOf(c) + (BY_POOR.indexOf(c) - BY_RATE.indexOf(c)) * t;
        const len = (c.rate / MAX_RATE) * (1 - t) + (c.poor / MAX_POOR) * t;
        const focus = c.iso === "USA" || c.iso === "CAN";
        return (
          <div
            key={c.iso}
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              top: chartTop + y * rowH,
              height: rowH,
              display: "flex",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: labelW,
                textAlign: "right",
                fontSize: Math.min(26 * u, rowH * 0.55),
                color: focus ? T.ink : T.ink2,
                fontWeight: focus ? 600 : 400,
                whiteSpace: "nowrap",
              }}
            >
              {label(c)}
            </div>
            <div
              style={{
                marginLeft: 14 * u,
                width: Math.max(2 * u, len * barMax * grow),
                height: rowH * 0.62,
                background: colorOf(c),
                borderRadius: 3 * u,
              }}
            />
            <div
              style={{
                marginLeft: 10 * u,
                fontSize: Math.min(24 * u, rowH * 0.5),
                fontVariantNumeric: "tabular-nums",
                color: focus ? T.ink : T.muted,
                fontWeight: focus ? 600 : 400,
                whiteSpace: "nowrap",
                position: "relative",
              }}
            >
              <span style={{ opacity: 1 - t }}>{pct(c.rate)}</span>
              <span style={{ position: "absolute", left: 0, opacity: t }}>{people(c.poor)}</span>
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: captionTop,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 48 * u,
          lineHeight: 1.1,
        }}
      >
        <div style={{ position: "absolute", opacity: firstCaption }}>
          {portrait ? <>% abaixo de US$ 8,30 por dia.<br /></> : null}
          No mapa, os EUA quase somem: <span style={{ color: COLOR.sky }}>{pct(US.rate)}</span>
        </div>
        <div style={{ position: "absolute", opacity: secondCaption }}>
          Mas {pct(US.rate)} de {Math.round(US.population / 1e6)} milhões é muita gente:{" "}
          <span style={{ color: COLOR.sky }}>{people(US.poor)}</span>, {US_RANK}º lugar
        </div>
      </div>
    </div>
  );
}

/** Beat 3: the US against the smallest countries summed. */
function Compare({ top, bottom }: { top: number; bottom: number }) {
  const frame = useCurrentFrame();
  const { width, portrait, u, pad } = useLayout();
  const show = useShow(B.compare, B.official);
  if (show.opacity <= 0) return null;
  const grow = interpolate(frame, [B.compare + 20, B.compare + 70], [0, 1], { ...clamp, easing: out });
  const scale = (width - 2 * pad) / Math.max(US.poor, SMALL_SUM) * 0.92;
  const barH = (portrait ? 110 : 90) * u;
  const y0 = top + (portrait ? 220 : 120) * u;
  let x = 0;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: show.opacity, transform: `translateY(${show.rise}px)` }}>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: top + (portrait ? 20 : 0) * u,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 54 * u,
          lineHeight: 1.1,
        }}
      >
        Mais do que esses {NUMBER[SMALL.length] ?? SMALL.length} países somados
      </div>
      <div style={{ position: "absolute", left: pad, top: y0 - 40 * u, fontSize: 26 * u, color: T.ink2 }}>
        Estados Unidos · <b style={{ color: COLOR.sky }}>{people(US.poor)}</b>
      </div>
      <div
        style={{
          position: "absolute",
          left: pad,
          top: y0,
          width: US.poor * scale * grow,
          height: barH,
          background: COLOR.sky,
          borderRadius: 4 * u,
        }}
      />
      <div style={{ position: "absolute", left: pad, top: y0 + barH + 60 * u, fontSize: 26 * u, color: T.ink2 }}>
        Somados · <b style={{ color: T.ink }}>{people(SMALL_SUM)}</b>
      </div>
      {SMALL.map((c, i) => {
        const w = c.poor * scale;
        const left = x;
        x += w;
        const p = interpolate(frame, [B.compare + 80 + i * 12, B.compare + 100 + i * 12], [0, 1], {
          ...clamp,
          easing: out,
        });
        return (
          <div key={c.iso}>
            <div
              style={{
                position: "absolute",
                left: pad + left,
                top: y0 + barH + 100 * u,
                width: Math.max(0, w * p - 3 * u),
                height: barH,
                background: i % 2 ? "#5b616a" : "#71777f",
                borderRadius: 3 * u,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: pad + left,
                // Alternate rows, so narrow segments' names do not collide.
                top: y0 + 2 * barH + 112 * u + (i % 2) * 60 * u,
                width: 260 * u,
                fontSize: 20 * u,
                color: T.muted,
                opacity: p,
                lineHeight: 1.25,
              }}
            >
              {c.name}
              <br />
              <span style={{ color: T.ink2 }}>{mi(c.poor)}</span>
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: Math.min(bottom - 60 * u, y0 + 2 * barH + (portrait ? 300 : 270) * u),
          fontSize: 24 * u,
          color: T.muted,
          lineHeight: 1.4,
        }}
      >
        Pessoas abaixo de US$ 8,30 por dia, na última pesquisa de cada país.
      </div>
    </div>
  );
}

/** Beat 4: the US by its own line: a counter and the series, on its own axis. */
function OfficialLine({ top, bottom }: { top: number; bottom: number }) {
  const frame = useCurrentFrame();
  const { width, portrait, u, pad } = useLayout();
  const show = useShow(B.official, B.table);
  if (show.opacity <= 0) return null;
  const count = interpolate(frame, [B.official + 20, B.official + 115], [0, D.usOfficial.poor], {
    ...clamp,
    easing: out,
  });
  const chartTop = top + (portrait ? 420 : 340) * u;
  const chartH = portrait ? 420 * u : bottom - chartTop - 90 * u;
  const chartW = portrait ? width - 2 * pad : (width - 2 * pad) * 0.55;
  const maxSeries = Math.max(...SERIES.map((s) => s.poor));
  const step = chartW / SERIES.length;
  const draw = interpolate(frame, [B.official + 60, B.official + 160], [0, SERIES.length], clamp);
  const noteTop = portrait ? chartTop + chartH + 70 * u : chartTop;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: show.opacity, transform: `translateY(${show.rise}px)` }}>
      <div style={{ position: "absolute", left: pad, top, fontSize: 28 * u, color: T.ink2 }}>
        Pela linha oficial dos EUA, em {D.year}
      </div>
      <div
        style={{
          position: "absolute",
          left: pad,
          top: top + 40 * u,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 170 * u,
          lineHeight: 1,
          color: COLOR.sky,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {dec(count / 1e6)}
        <span style={{ fontSize: 64 * u, marginLeft: 16 * u, color: T.ink }}>milhões</span>
      </div>
      <div style={{ position: "absolute", left: pad, top: top + 230 * u, fontSize: 30 * u, color: T.ink }}>
        cerca de 1 em cada {ONE_IN} americanos ({pct(D.usOfficial.rate)})
      </div>
      {/* The series, in millions, on its own axis. */}
      <div style={{ position: "absolute", left: pad, top: chartTop - 40 * u, fontSize: 20 * u, color: T.muted }}>
        Pessoas abaixo da linha oficial, {SERIES[0]!.year}–{SERIES.at(-1)!.year} (milhões)
      </div>
      {SERIES.map((s, i) => {
        const h = (s.poor / maxSeries) * chartH * Math.min(1, Math.max(0, draw - i));
        const last = i === SERIES.length - 1;
        return (
          <div key={s.year}>
            <div
              style={{
                position: "absolute",
                left: pad + i * step + step * 0.15,
                top: chartTop + chartH - h,
                width: step * 0.7,
                height: h,
                background: last ? COLOR.sky : "#3d4f63",
                borderRadius: 2 * u,
              }}
            />
            {i % 5 === 0 || last ? (
              <div
                style={{
                  position: "absolute",
                  left: pad + i * step - 20 * u,
                  width: step + 40 * u,
                  textAlign: "center",
                  top: chartTop + chartH + 8 * u,
                  fontSize: 18 * u,
                  color: T.muted,
                }}
              >
                {s.year}
                <br />
                <span style={{ color: T.ink2 }}>{dec(s.poor / 1e6)}</span>
              </div>
            ) : null}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: portrait ? pad : pad + chartW + 60 * u,
          right: pad,
          top: noteTop,
          fontSize: 26 * u,
          lineHeight: 1.45,
          color: T.ink2,
          borderLeft: `${4 * u}px solid ${COLOR.sky}`,
          paddingLeft: 20 * u,
        }}
      >
        Pela linha oficial dos EUA, calculada para o custo de vida americano e bem mais alta que US$ 8,30 por dia.{" "}
        <b style={{ color: T.ink }}>Não dá para comparar com os outros países nessa linha.</b>
      </div>
    </div>
  );
}

/** Beat 5: the states with the most people below the official line. */
function StatesTable({ top, bottom }: { top: number; bottom: number }) {
  const frame = useCurrentFrame();
  const { width, portrait, u, pad } = useLayout();
  const show = useShow(B.table, B.close);
  if (show.opacity <= 0) return null;
  const tableTop = top + (portrait ? 140 : 110) * u;
  const rowH = Math.min((portrait ? 110 : 70) * u, (bottom - tableTop - 60 * u) / (STATES.length + 1));
  const maxPoor = STATES[0]!.poor;
  const barMax = (width - 2 * pad) * (portrait ? 0.32 : 0.4);
  const col = { name: pad, people: pad + (portrait ? 420 : 520) * u, rate: width - pad };
  return (
    <div style={{ position: "absolute", inset: 0, opacity: show.opacity }}>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 54 * u,
          lineHeight: 1.1,
          opacity: interpolate(frame, [B.table + 5, B.table + 20], [0, 1], clamp),
        }}
      >
        Só a {stateName(STATES[0]!.name)}: <span style={{ color: COLOR.sky }}>{people(STATES[0]!.poor)}</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: tableTop,
          height: rowH,
          display: "flex",
          alignItems: "flex-end",
          fontSize: 20 * u,
          color: T.muted,
          borderBottom: `1px solid ${T.rule}`,
        }}
      >
        <span style={{ width: col.people - pad }}>Estado</span>
        <span style={{ flex: 1 }}>Pessoas abaixo da linha oficial</span>
        <span>% da população</span>
      </div>
      {STATES.map((s, i) => {
        const p = interpolate(frame, [B.table + 30 + i * 14, B.table + 48 + i * 14], [0, 1], {
          ...clamp,
          easing: out,
        });
        return (
          <div
            key={s.name}
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              top: tableTop + rowH * (i + 1),
              height: rowH,
              display: "flex",
              alignItems: "center",
              opacity: p,
              transform: `translateX(${(1 - p) * 60 * u}px)`,
              borderBottom: `1px solid ${T.grid}`,
              fontSize: 28 * u,
            }}
          >
            <span style={{ width: col.people - pad, fontWeight: i === 0 ? 600 : 400 }}>{stateName(s.name)}</span>
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 14 * u }}>
              <i
                style={{
                  display: "block",
                  width: (s.poor / maxPoor) * barMax * p,
                  height: 16 * u,
                  background: i === 0 ? COLOR.sky : "#3d4f63",
                  borderRadius: 3 * u,
                }}
              />
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{mi(s.poor)}</span>
            </span>
            <span style={{ color: T.ink2, fontVariantNumeric: "tabular-nums" }}>{pct(s.rate)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Beat 6: what each number says. */
function Closing({ top }: { top: number }) {
  const { portrait, u, pad } = useLayout();
  const show = useShow(B.close, B.end + 30);
  if (show.opacity <= 0) return null;
  const line = (big: string, small: string, color: string) => (
    <div style={{ marginBottom: 40 * u }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 84 * u, lineHeight: 1, color }}>{big}</div>
      <div style={{ fontSize: 34 * u, color: T.ink2, marginTop: 8 * u }}>{small}</div>
    </div>
  );
  return (
    <div
      style={{
        position: "absolute",
        left: pad,
        right: pad,
        top: top + (portrait ? 200 : 60) * u,
        opacity: show.opacity,
        transform: `translateY(${show.rise}px)`,
      }}
    >
      {line("Percentual", "o risco de ser pobre", T.ink)}
      {line("Número", "quantas pessoas", COLOR.sky)}
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64 * u, marginTop: 20 * u }}>Os dois contam.</div>
    </div>
  );
}

export const def = motion<Props>({
  id: "PobrezaNumeros",
  title: "Os pobres que o mapa esconde",
  description:
    "Percentual × número de pessoas: os EUA somem no mapa da pobreza, mas 1,8% de 340 milhões é muita gente. Barras, a linha oficial americana e os estados.",
  component: PobrezaNumeros,
  defaultProps: {},
  durationInFrames: () => B.end,
  formats: ["portrait", "landscape"],
});
