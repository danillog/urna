import { Easing, interpolate, useCurrentFrame } from "remotion";
import cotaJson from "../../data/cota.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, brl } from "../common/theme";
import type { ColorName } from "../../../src/types";

/** Shape of motion/data/cota.json, written by motion/scripts/cota.py. */
interface CotaData {
  months: string[];
  deputies: { id: string; name: string; party: string; uf: string; cumulative: number[] }[];
  deputiesWithSpending: number;
  medianTotal: number;
}
const data = cotaJson as CotaData;

type Props = { closing: string; top: number };

const INTRO = 60;
const PER_MONTH = 30;
const CLOSING = 210;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** The site's party lines and colors (data/generated/map.json lineages); the rest in gray. */
const PARTY_COLOR: Record<string, ColorName> = {
  PT: "red",
  MDB: "green",
  PSDB: "sky",
  UNIÃO: "cyan",
  PP: "violet",
  PL: "blue",
  PSD: "orange",
  PSB: "gold",
  PDT: "pink",
  PTB: "brown",
  REPUBLICANOS: "teal",
};
const colorOf = (party: string) => COLOR[PARTY_COLOR[party.toUpperCase()] ?? "gray"];

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

const lastMonth = data.months.length - 1;
const duration = () => INTRO + lastMonth * PER_MONTH + CLOSING;

/** Rank of every deputy (0 = most spent) at a whole month. */
const ranks = data.months.map((_, m) => {
  const order = data.deputies.map((d, i) => [d.cumulative[m]!, i] as const).sort((a, b) => b[0] - a[0]);
  const r = new Array<number>(data.deputies.length);
  order.forEach(([, i], k) => (r[i] = k));
  return r;
});

function Cota({ closing, top }: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();

  // Month as a fraction: values grow linearly, places swap with an ease.
  const t = Math.max(0, Math.min(lastMonth, (frame - INTRO) / PER_MONTH));
  const m0 = Math.floor(t);
  const m1 = Math.min(lastMonth, m0 + 1);
  const f = t - m0;
  // Each month the bars grow and swap places in its first part, then hold still, in order.
  const g = Math.min(1, f / 0.45);
  const swap = Easing.inOut(Easing.cubic)(g);
  const value = (d: CotaData["deputies"][number]) => d.cumulative[m0]! + (d.cumulative[m1]! - d.cumulative[m0]!) * g;

  const rows = data.deputies
    .map((d, i) => ({ d, v: value(d), rank: ranks[m0]![i]! + (ranks[m1]![i]! - ranks[m0]![i]!) * swap }))
    .filter((r) => r.rank < top + 1)
    .sort((a, b) => a.rank - b.rank);
  const max = Math.max(...rows.map((r) => r.v), 1);

  const box = portrait
    ? { left: pad, right: width - pad, top: 430 * u, bottom: 1480 * u }
    : { left: pad, right: width - pad - 40 * u, top: 300 * u, bottom: height - 190 * u };
  const nameW = (portrait ? 330 : 400) * u;
  const rowH = (box.bottom - box.top) / top;
  const barH = rowH * 0.72;
  const barMax = box.right - box.left - nameW - 190 * u;

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const barsIn = interpolate(frame, [20, 45], [0, 1], clamp);
  const closingAt = INTRO + lastMonth * PER_MONTH + 30;
  const closingIn = interpolate(frame, [closingAt, closingAt + 25], [0, 1], clamp);
  const ym = data.months[g >= 0.5 ? m1 : m0]!;

  return (
    <Stage>
      <Header
        title="A corrida da cota parlamentar"
        subtitle="Os 10 deputados federais que mais gastaram a cota do gabinete (CEAP), somando mês a mês desde fevereiro de 2023"
        opacity={headerIn}
      />
      <div style={{ opacity: barsIn * (1 - closingIn * 0.93) }}>
        {rows.map(({ d, v, rank }) => {
          const y = box.top + rank * rowH;
          const fade = interpolate(rank, [top - 1, top - 0.2], [1, 0], clamp);
          const w = Math.max(2 * u, (v / max) * barMax);
          return (
            <div
              key={d.id}
              style={{
                position: "absolute",
                left: box.left,
                top: y,
                height: barH,
                width: box.right - box.left,
                opacity: fade,
                display: "flex",
                alignItems: "center",
              }}
            >
              <div style={{ width: nameW, paddingRight: 18 * u, textAlign: "right", lineHeight: 1.1 }}>
                <div
                  style={{
                    fontSize: 27 * u,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.name}
                </div>
                <div style={{ fontSize: 20 * u, color: T.muted }}>
                  {d.party} · {d.uf}
                </div>
              </div>
              <div style={{ width: w, height: barH, background: colorOf(d.party), borderRadius: 4 * u }} />
              <div
                style={{
                  marginLeft: 14 * u,
                  fontSize: 26 * u,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {brl(v)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Clock. */}
      <div
        style={{
          position: "absolute",
          right: pad,
          ...(portrait ? { top: 1500 * u } : { top: 70 * u }),
          textAlign: "right",
          opacity: barsIn * (1 - closingIn),
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 120 : 110) * u, lineHeight: 1, color: T.ink2 }}>
          {monthLabel(ym)}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          ...(portrait ? { top: 1660 * u } : { bottom: 112 * u }),
          fontSize: 20 * u,
          color: T.muted,
          lineHeight: 1.4,
          opacity: headerIn,
        }}
      >
        Valores reembolsados, acumulados, até {monthLabel(data.months[lastMonth]!)} (meses seguintes ainda incompletos).
        O teto da cota muda por estado, por causa das passagens: por isso a UF ao lado do nome.
      </div>

      {/* Closing card. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 700 * u : 380 * u,
          opacity: closingIn,
          transform: `translateY(${(1 - closingIn) * 30 * u}px)`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: (portrait ? 84 : 96) * u,
            lineHeight: 1.05,
            maxWidth: 1500 * u,
          }}
        >
          {closing}
        </div>
        <div style={{ fontSize: 30 * u, color: T.ink2, marginTop: 34 * u, maxWidth: 1300 * u, lineHeight: 1.4 }}>
          No mesmo período, metade dos {data.deputiesWithSpending} deputados com gastos usou até {brl(data.medianTotal)}.
        </div>
      </div>
      <Footer source="Câmara dos Deputados, dados abertos da CEAP" opacity={headerIn} />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Cota",
  title: "A corrida da cota parlamentar",
  description: "Os 10 deputados que mais gastam a verba do gabinete, mês a mês.",
  component: Cota,
  defaultProps: {
    closing: "Gastar a cota é permitido. Os números são ponto de partida para perguntar.",
    top: 10,
  },
  durationInFrames: duration,
  formats: ["portrait", "landscape"],
});
