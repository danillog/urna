import { Easing, interpolate, useCurrentFrame } from "remotion";
import congressJson from "../../../data/generated/congress.json";
import {
  GROUPS,
  hemicycle,
  type CongressData,
  type CongressElection,
  type IdeologyGroup,
} from "../../../src/model/congress";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { DISPLAY, IDEO, T, css, int, mixRgb, rgb } from "../common/theme";

const data = congressJson as unknown as CongressData;

type CongressHouse = "chamber" | "senate";
type Props = { house: CongressHouse };

const INTRO = 50;
const HOLD = 54;
const MOVE = 40;
const OUTRO = 150;

const HOUSE_NAME: Record<CongressHouse, string> = { chamber: "Câmara dos Deputados", senate: "Senado" };
const GROUP_NAME: Record<IdeologyGroup | "none", string> = {
  left: "Esquerda",
  "centre-left": "Centro-esquerda",
  centre: "Centro",
  "centre-right": "Centro-direita",
  right: "Direita",
  none: "Sem classificação",
};
/** The three blocks the big numbers add up: left side, centre, right side. */
const SIDES: { label: string; groups: (IdeologyGroup | "none")[] }[] = [
  { label: "esquerda e centro-esquerda", groups: ["left", "centre-left"] },
  { label: "centro", groups: ["centre"] },
  { label: "centro-direita e direita", groups: ["centre-right", "right"] },
];

interface Spot {
  angle: number;
  r: number;
  group: string;
  lineage: string;
}
interface Year {
  e: CongressElection;
  spots: Spot[];
  dot: number;
  groups: Record<string, number>;
}

function layoutYear(e: CongressElection): Year {
  const { seats, radius } = hemicycle(e.parties.map((p) => p.seats));
  const spots = seats.map((s) => {
    const p = e.parties[s.party]!;
    return { angle: Math.atan2(s.y, s.x), r: Math.hypot(s.x, s.y), group: p.group ?? "none", lineage: p.lineage };
  });
  const groups: Record<string, number> = {};
  for (const p of e.parties) groups[p.group ?? "none"] = (groups[p.group ?? "none"] ?? 0) + p.seats;
  return { e, spots, dot: radius, groups };
}

/** Where every seat of year A goes in year B: same party first, then leftovers by position. */
interface Move {
  from: Spot | null;
  to: Spot | null;
}
function moves(a: Year, b: Year): Move[] {
  const byLineage = (y: Year) => {
    const m = new Map<string, Spot[]>();
    for (const s of y.spots) m.set(s.lineage, [...(m.get(s.lineage) ?? []), s]);
    return m;
  };
  const la = byLineage(a);
  const lb = byLineage(b);
  const out: Move[] = [];
  const restA: Spot[] = [];
  const restB: Spot[] = [];
  for (const [lineage, sa] of la) {
    const sb = lb.get(lineage) ?? [];
    sa.forEach((s, i) => (i < sb.length ? out.push({ from: s, to: sb[i]! }) : restA.push(s)));
    restB.push(...sb.slice(sa.length));
  }
  for (const [lineage, sb] of lb) if (!la.has(lineage)) restB.push(...sb);
  // Seats that change party: paired left to right, so they flow sideways instead of crossing.
  const order = (x: Spot, y: Spot) => y.angle - x.angle || x.r - y.r;
  restA.sort(order);
  restB.sort(order);
  const n = Math.max(restA.length, restB.length);
  for (let i = 0; i < n; i++) out.push({ from: restA[i] ?? null, to: restB[i] ?? null });
  return out;
}

const cache = new Map<CongressHouse, { years: Year[]; moves: Move[][] }>();
function prepared(house: CongressHouse) {
  let p = cache.get(house);
  if (!p) {
    const years = data.houses[house].map(layoutYear);
    p = { years, moves: years.slice(1).map((y, i) => moves(years[i]!, y)) };
    cache.set(house, p);
  }
  return p;
}

const duration = ({ house }: Props) => {
  const n = data.houses[house].length;
  return INTRO + n * HOLD + (n - 1) * MOVE + OUTRO;
};

const ease = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function Congresso({ house }: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const { years, moves: allMoves } = prepared(house);
  const n = years.length;

  // Where we are: holding year i, or moving from i to i + 1 with progress p.
  const t = frame - INTRO;
  const step = HOLD + MOVE;
  let i = Math.max(0, Math.min(n - 1, Math.floor(t / step)));
  let p = 0;
  if (t >= 0 && i < n - 1) p = interpolate(t - i * step, [HOLD, step], [0, 1], clamp);
  if (t < 0) i = 0;
  const a = years[i]!;
  const b = years[Math.min(i + 1, n - 1)]!;
  const outroAt = INTRO + n * HOLD + (n - 1) * MOVE;

  // Geometry.
  const R = portrait ? (width - 2 * pad) / 2 : 560 * u;
  const cx = portrait ? width / 2 : width - pad - R;
  const cy = portrait ? 840 * u : height - 210 * u;
  const at = (angle: number, r: number) => [cx + Math.cos(angle) * r * R, cy - Math.sin(angle) * r * R] as const;

  // Seats.
  const dots: { x: number; y: number; r: number; c: string }[] = [];
  const intro = (s: Spot) => {
    // Seats grow in from left to right during the intro.
    const delay = (1 - s.angle / Math.PI) * 30;
    return interpolate(frame, [delay, delay + 14], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  };
  if (p === 0) {
    for (const s of a.spots) {
      const [x, y] = at(s.angle, s.r);
      dots.push({ x, y, r: a.dot * R * intro(s), c: IDEO[s.group]! });
    }
  } else {
    for (const m of allMoves[i]!) {
      const ref = m.to ?? m.from!;
      // A small sweep: seats on the left start a little earlier.
      const delay = (1 - ref.angle / Math.PI) * 0.15;
      const q = ease(interpolate(p, [delay, delay + 0.85], [0, 1], clamp));
      if (m.from && m.to) {
        const angle = m.from.angle + (m.to.angle - m.from.angle) * q;
        const r = m.from.r + (m.to.r - m.from.r) * q;
        const [x, y] = at(angle, r);
        const c = mixRgb(rgb(IDEO[m.from.group]!), rgb(IDEO[m.to.group]!), q);
        dots.push({ x, y, r: (a.dot + (b.dot - a.dot) * q) * R, c: css(c) });
      } else if (m.to) {
        const [x, y] = at(m.to.angle, m.to.r);
        dots.push({ x, y, r: b.dot * R * q, c: IDEO[m.to.group]! });
      } else if (m.from) {
        const [x, y] = at(m.from.angle, m.from.r);
        dots.push({ x, y, r: a.dot * R * (1 - q), c: IDEO[m.from.group]! });
      }
    }
  }

  // Numbers, counted between years as the seats move.
  const groupSeats = (g: string) => (a.groups[g] ?? 0) + ((b.groups[g] ?? 0) - (a.groups[g] ?? 0)) * ease(p);
  const yearShown = p < 0.5 ? a.e.year : b.e.year;
  const yearFlip = p === 0 ? 1 : Math.abs(p - 0.5) * 2;
  const total = a.e.total + (b.e.total - a.e.total) * ease(p);
  const top = (p < 0.5 ? a : b).e.parties
    .slice()
    .sort((x, y) => y.seats - x.seats)
    .slice(0, 3);

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const outro = interpolate(frame, [outroAt + 10, outroAt + 30], [0, 1], clamp);
  const first = years[0]!;
  const last = years[n - 1]!;
  const sideOf = (y: Year, s: (typeof SIDES)[number]) => s.groups.reduce((sum, g) => sum + (y.groups[g] ?? 0), 0);

  const numbersBox = portrait
    ? { left: pad, right: pad, top: cy + 70 * u }
    : { left: pad, width: cx - R - pad - 60 * u, top: 380 * u };

  return (
    <Stage>
      <Header
        title={`O Congresso desde ${first.e.year}`}
        subtitle={`${HOUSE_NAME[house]}: cada bolinha é uma cadeira, da esquerda para a direita`}
        opacity={headerIn}
      />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {dots.map((d, k) => (
          <circle key={k} cx={d.x} cy={d.y} r={Math.max(0, d.r)} fill={d.c} />
        ))}
      </svg>
      {/* Year, inside the arc. */}
      <div
        style={{
          position: "absolute",
          left: cx - 220 * u,
          width: 440 * u,
          top: cy - 150 * u,
          textAlign: "center",
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 150 * u,
          lineHeight: 1,
          opacity: headerIn * yearFlip,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {yearShown}
      </div>
      <div
        style={{
          position: "absolute",
          left: cx - 300 * u,
          width: 600 * u,
          top: cy + 8 * u,
          textAlign: "center",
          fontSize: 22 * u,
          color: T.muted,
          opacity: headerIn,
        }}
      >
        {int(total)} cadeiras · maiores: {top.map((x) => `${x.party} ${x.seats}`).join(" · ")}
      </div>

      {/* The three blocks, then the five groups as a bar. */}
      <div style={{ position: "absolute", ...numbersBox, opacity: headerIn }}>
        <div style={{ display: "flex", flexDirection: portrait ? "row" : "column", gap: (portrait ? 24 : 26) * u }}>
          {SIDES.map((s) => (
            <div key={s.label} style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 6 * u, marginBottom: 6 * u }}>
                {s.groups.map((g) => (
                  <i key={g} style={{ width: 18 * u, height: 18 * u, borderRadius: "50%", background: IDEO[g] }} />
                ))}
              </div>
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 700,
                  fontSize: 92 * u,
                  lineHeight: 0.95,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {int(s.groups.reduce((sum, g) => sum + groupSeats(g), 0))}
              </div>
              <div style={{ fontSize: 22 * u, color: T.ink2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", height: 14 * u, marginTop: 36 * u, borderRadius: 7 * u, overflow: "hidden" }}>
          {[...GROUPS, "none"].map((g) => (
            <div key={g} style={{ width: `${(groupSeats(g) / total) * 100}%`, background: IDEO[g] }} />
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: `${8 * u}px ${18 * u}px`, marginTop: 14 * u }}>
          {[...GROUPS, "none" as const].map((g) => (
            <span key={g} style={{ fontSize: 19 * u, color: T.muted, display: "flex", alignItems: "center", gap: 6 * u }}>
              <i style={{ width: 12 * u, height: 12 * u, borderRadius: "50%", background: IDEO[g] }} />
              {GROUP_NAME[g]}
            </span>
          ))}
        </div>
      </div>

      {/* Closing line: first and last election side by side. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 1420 * u : 250 * u,
          fontSize: 30 * u,
          lineHeight: 1.4,
          color: T.ink,
          opacity: outro,
          maxWidth: portrait ? undefined : cx - R - pad - 40 * u,
        }}
      >
        À direita do centro: <b>{sideOf(first, SIDES[2]!)}</b> em {first.e.year}, <b>{sideOf(last, SIDES[2]!)}</b> em{" "}
        {last.e.year}.
      </div>
      <Footer source="Bancadas eleitas: TSE e Câmara · posição dos partidos: Zucco e Power (BLS)" opacity={headerIn} />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Congresso",
  title: "O Congresso desde 1990",
  description: "As cadeiras migrando entre esquerda, centro e direita, eleição a eleição.",
  component: Congresso,
  defaultProps: { house: "chamber" },
  durationInFrames: duration,
  formats: ["portrait", "landscape"],
  controls: [
    {
      prop: "house",
      label: "Casa",
      options: [
        { value: "chamber", label: "Câmara" },
        { value: "senate", label: "Senado (desde 2002)" },
      ],
    },
  ],
});
