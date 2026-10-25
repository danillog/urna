import { Easing, interpolate, useCurrentFrame } from "remotion";
import congressJson from "../../../data/generated/congress.json";
import governismoJson from "../../../data/generated/governismo.json";
import type { CongressData } from "../../../src/model/congress";
import { pattern, stances, type GovernismoData, type Term } from "../../../src/model/governismo";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { DISPLAY, IDEO, T, pct } from "../common/theme";

const data = governismoJson as unknown as GovernismoData;
const congress = congressJson as unknown as CongressData;

type Props = Record<string, never>;

const INTRO = 170;
const MOVE = 30;
const TERM = 140;
const REORDER = 50;
const SUMMARY = 420;
const terms = data.terms;
const TERMS_END = INTRO + terms.length * TERM;
const duration = () => TERMS_END + SUMMARY;

const ease = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The parties on screen: the big ones of these 24 years, both sides. */
const CAST = ["PSOL", "PT", "PCDOB", "PSB", "PDT", "MDB", "PSDB", "DEM", "PSD", "PODE", "PL", "PTB", "PP", "PSC", "REP", "NOVO"];

/** Name and ideology group of a party line, from the last Chamber where it had seats. */
function partyInfo(lineage: string) {
  for (const e of [...congress.houses.chamber].reverse()) {
    const p = e.parties.find((x) => x.lineage === lineage);
    if (p) return { name: p.party, group: p.group ?? "none", score: p.score ?? 0 };
  }
  return { name: lineage, group: "none", score: 0 };
}

const share = (lineage: string, key: string): number | null => data.parties[lineage]?.[key]?.share ?? null;
const num = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const s = (lineage: string, key: string) => pct(share(lineage, key) ?? 0);

interface Row {
  lineage: string;
  name: string;
  color: string;
  always: boolean;
  min: number;
  max: number;
}
const ROWS: Row[] = CAST.map((lineage) => {
  const info = partyInfo(lineage);
  const st = stances(data, lineage);
  return {
    lineage,
    name: info.name,
    color: IDEO[info.group]!,
    score: info.score,
    always: pattern(st) === "always-base",
    min: Math.min(...st.map((x) => x.share)),
    max: Math.max(...st.map((x) => x.share)),
  };
})
  .sort((a, b) => a.score - b.score)
  .map(({ score: _, ...r }) => r);

/** Slot of each row while the terms play (by ideology) and in the summary (by pattern). */
const termSlot = new Map(ROWS.map((r, i) => [r.lineage, i + 1]));
const summarySlot = (() => {
  const top = ROWS.filter((r) => r.always).sort((a, b) => b.min - a.min);
  const rest = ROWS.filter((r) => !r.always).sort((a, b) => a.max - a.min - (b.max - b.min));
  const m = new Map<string, number>();
  top.forEach((r, i) => m.set(r.lineage, i + 1));
  rest.forEach((r, i) => m.set(r.lineage, top.length + 2 + i));
  return { m, top: top.length };
})();
const SLOTS = ROWS.length + 2;
const CENTRE = ["MDB", "PP", "REP"];

const years = (t: Term) => {
  const a = t.from.slice(0, 4);
  const b = t.to.slice(0, 4);
  return a === b ? a : `${a}–${b}`;
};
const PRESIDENT_PARTY: Record<string, string> = { PT: "PT", MDB: "MDB", PL: "PL" };

/** One line per term, numbers from the data. */
const CAPTION: Record<string, () => string> = {
  lula1: () =>
    `PL (${s("PL", "lula1")}) e PP (${s("PP", "lula1")}) votam com Lula. PSDB (${s("PSDB", "lula1")}) e DEM (${s("DEM", "lula1")}) fazem oposição.`,
  lula2: () =>
    `O MDB entra na base: ${s("MDB", "lula2")}. À esquerda do PT, o PSOL fica em ${s("PSOL", "lula2")}.`,
  dilma1: () =>
    `A base afrouxa, mas segue: MDB ${s("MDB", "dilma1")}, PP ${s("PP", "dilma1")}, Republicanos ${s("REP", "dilma1")}.`,
  dilma2: () =>
    `Até o impeachment, o PSB cai para ${s("PSB", "dilma2")}. O MDB, partido do vice, ainda vota ${s("MDB", "dilma2")} com Dilma.`,
  temer: () =>
    `O lado se inverte: PT ${s("PT", "temer")}, PSDB ${s("PSDB", "temer")}, DEM ${s("DEM", "temer")}. MDB e PP: ${s("PP", "temer")}.`,
  bolsonaro: () =>
    `PT ${s("PT", "bolsonaro")}, PCdoB ${s("PCDOB", "bolsonaro")}. E o centro segue no governo: PP ${s("PP", "bolsonaro")}, Republicanos ${s("REP", "bolsonaro")}.`,
  lula3: () =>
    `O PL cai de ${s("PL", "bolsonaro")} para ${s("PL", "lula3")}. MDB, PSD e Republicanos: ${s("MDB", "lula3")} cada.`,
};

function Governismo(_: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();

  // Chart box: party names, the 0–100% axis, the number column.
  const box = portrait
    ? { left: pad, right: width - pad, top: 520 * u, bottom: 1440 * u }
    : { left: pad, right: 1260 * u, top: 290 * u, bottom: 930 * u };
  const nameW = (portrait ? 190 : 200) * u;
  const numW = (portrait ? 200 : 180) * u;
  const x0 = box.left + nameW;
  const x1 = box.right - numW;
  const X = (v: number) => x0 + (v / 100) * (x1 - x0);
  const slotH = (box.bottom - box.top) / SLOTS;
  const dotR = (portrait ? 13 : 10) * u;

  // Where we are.
  const t = frame - INTRO;
  const i = Math.max(0, Math.min(terms.length - 1, Math.floor(t / TERM)));
  const into = t - i * TERM;
  const p = t < 0 ? 0 : ease(interpolate(into, [0, MOVE], [0, 1], clamp));
  const term = terms[i]!;
  const prev = i > 0 ? terms[i - 1]! : null;
  const r = ease(interpolate(frame, [TERMS_END, TERMS_END + REORDER], [0, 1], clamp));
  const summaryIn = interpolate(frame, [TERMS_END + REORDER - 10, TERMS_END + REORDER + 20], [0, 1], clamp);
  const closingIn = interpolate(frame, [TERMS_END + 120, TERMS_END + 145], [0, 1], clamp);

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const cardIn = interpolate(frame, [12, 30], [0, 1], clamp) * interpolate(frame, [INTRO - 30, INTRO - 8], [1, 0], clamp);
  const chartIn = interpolate(frame, [INTRO - 20, INTRO + 5], [0, 1], clamp);
  const termIn = interpolate(into, [0, 12], [0, 1], clamp) * (1 - r);
  const captionIn = interpolate(into, [MOVE - 5, MOVE + 10], [0, 1], clamp) * (1 - r);
  const presidentParty = PRESIDENT_PARTY[term.party];

  const panel = portrait
    ? { left: pad, right: pad, top: 350 * u }
    : { left: 1360 * u, right: pad, top: 290 * u };

  return (
    <Stage>
      <Header
        title="Quem vota com qualquer governo"
        subtitle="Quanto cada partido votou com o governo na Câmara, de Lula 1 a Lula 3"
        opacity={headerIn}
      />

      {/* What the number is. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 600 * u : 330 * u,
          opacity: cardIn,
          transform: `translateY(${(1 - interpolate(frame, [12, 30], [0, 1], clamp)) * 30 * u}px)`,
          maxWidth: 1400 * u,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 64 : 70) * u, lineHeight: 1.08 }}>
          Em cada votação nominal, o líder do governo e o de cada partido orientam a bancada: sim ou não.
        </div>
        <div style={{ fontSize: 32 * u, color: T.ink2, marginTop: 36 * u, lineHeight: 1.4 }}>
          A conta: em quantas vezes o partido orientou igual ao governo. Só entram votações disputadas, em que alguma
          bancada pediu o contrário do governo: as quase unânimes deixariam todo mundo governista.
        </div>
        <div style={{ fontSize: 28 * u, color: T.muted, marginTop: 28 * u }}>
          {data.thresholds.base}% ou mais: base do governo · até {data.thresholds.opposition}%: oposição
        </div>
      </div>

      {/* Chart. */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: chartIn }}>
        {/* Base and opposition zones. */}
        <rect
          x={X(data.thresholds.base)}
          y={box.top + slotH * 0.5}
          width={X(100) - X(data.thresholds.base)}
          height={slotH * (SLOTS - 1)}
          fill={T.surface}
        />
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line x1={X(v)} x2={X(v)} y1={box.top + slotH * 0.5} y2={box.top + slotH * (SLOTS - 0.5)} stroke={T.grid} />
            <text
              x={X(v)}
              y={box.top + slotH * (SLOTS - 0.5) + 30 * u}
              fill={T.muted}
              fontSize={20 * u}
              textAnchor="middle"
              fontFamily="inherit"
            >
              {v}%
            </text>
          </g>
        ))}
        <text
          x={X(100) - 8 * u}
          y={box.top + slotH * 0.5 - 10 * u}
          fill={T.muted}
          fontSize={19 * u}
          textAnchor="end"
        >
          base do governo ({data.thresholds.base}%+)
        </text>

        {ROWS.map((row) => {
          const slot = termSlot.get(row.lineage)! + (summarySlot.m.get(row.lineage)! - termSlot.get(row.lineage)!) * r;
          const y = box.top + slot * slotH;
          const now = share(row.lineage, term.key);
          const before = prev ? share(row.lineage, prev.key) : null;
          // The dot moves between terms; it grows in or out where a party has no data.
          let v: number | null = null;
          let size = 1;
          if (t < 0) v = null;
          else if (now !== null && before !== null) v = before + (now - before) * p;
          else if (now !== null) {
            v = now;
            size = p;
          } else if (before !== null) {
            v = before;
            size = 1 - p;
          }
          const isGov = row.lineage === presidentParty && r < 1;
          const past = terms.slice(0, t < 0 ? 0 : i + (r > 0 ? 1 : 0));
          return (
            <g key={row.lineage}>
              {isGov ? (
                <rect
                  x={box.left - 12 * u}
                  y={y - slotH / 2 + 2 * u}
                  width={box.right - box.left + 24 * u}
                  height={slotH - 4 * u}
                  rx={6 * u}
                  fill="none"
                  stroke={T.ink2}
                  strokeOpacity={0.5 * termIn}
                />
              ) : null}
              <text
                x={x0 - 18 * u}
                y={y + 8 * u}
                fill={T.ink}
                fontSize={(portrait ? 25 : 22) * u}
                fontWeight={600}
                textAnchor="end"
              >
                {row.name}
              </text>
              {/* Range in the summary. */}
              <line
                x1={X(row.min)}
                x2={X(row.max)}
                y1={y}
                y2={y}
                stroke={row.color}
                strokeWidth={4 * u}
                strokeOpacity={0.8 * summaryIn}
              />
              {/* Earlier terms: thin marks, then in the summary rings (PT) and dots (others). */}
              {past.map((pt) => {
                const pv = share(row.lineage, pt.key);
                if (pv === null) return null;
                const ring = pt.party === "PT";
                return (
                  <g key={pt.key}>
                    <line
                      x1={X(pv)}
                      x2={X(pv)}
                      y1={y - slotH * 0.28}
                      y2={y + slotH * 0.28}
                      stroke={row.color}
                      strokeWidth={2.5 * u}
                      strokeOpacity={0.45 * (1 - summaryIn)}
                    />
                    <circle
                      cx={X(pv)}
                      cy={y}
                      r={dotR * 0.8}
                      fill={ring ? T.bg : row.color}
                      stroke={row.color}
                      strokeWidth={3 * u}
                      opacity={summaryIn}
                    />
                  </g>
                );
              })}
              {v !== null && r < 1 ? (
                <circle cx={X(v)} cy={y} r={dotR * Math.max(0, size)} fill={row.color} opacity={1 - r} />
              ) : null}
              {/* Number column: this term's share, then the range. */}
              <text
                x={box.right}
                y={y + 8 * u}
                fill={T.ink2}
                fontSize={(portrait ? 24 : 22) * u}
                textAnchor="end"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {r < 0.5
                  ? v !== null && size > 0.5
                    ? pct(v)
                    : "–"
                  : `${num(row.min)}–${pct(row.max)}`}
              </text>
            </g>
          );
        })}

        {/* Group headings in the summary. */}
        {[
          { slot: 0, label: `${data.thresholds.base}% ou mais com todos os governos` },
          { slot: summarySlot.top + 1, label: `Abaixo de ${data.thresholds.base}% com algum governo` },
        ].map((h) => (
          <text
            key={h.slot}
            x={box.left}
            y={box.top + h.slot * slotH + 10 * u}
            fill={T.ink}
            fontSize={(portrait ? 26 : 23) * u}
            fontWeight={600}
            opacity={summaryIn}
            fontFamily={DISPLAY}
            letterSpacing={1 * u}
          >
            {h.label.toUpperCase()}
          </text>
        ))}
      </svg>

      {/* Term: president, years, one line on what changed. */}
      <div style={{ position: "absolute", ...panel, opacity: chartIn }}>
        <div style={{ opacity: termIn, display: "flex", alignItems: "baseline", gap: 20 * u, flexWrap: "wrap" }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 96 : 110) * u, lineHeight: 1 }}>
            {term.label}
          </span>
          <span style={{ fontSize: 28 * u, color: T.ink2 }}>
            {term.party} · {years(term)}
          </span>
        </div>
        {portrait ? null : (
          <div style={{ opacity: captionIn, fontSize: 32 * u, lineHeight: 1.4, marginTop: 30 * u, color: T.ink }}>
            {CAPTION[term.key]?.()}
          </div>
        )}
      </div>
      {portrait ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            right: pad,
            top: 1575 * u,
            opacity: captionIn * chartIn,
            fontSize: 32 * u,
            lineHeight: 1.4,
          }}
        >
          {CAPTION[term.key]?.()}
        </div>
      ) : null}

      {/* Ideology legend and how to read the marks. */}
      <div
        style={{
          position: "absolute",
          left: portrait ? pad : panel.left,
          right: pad,
          top: portrait ? 1478 * u : 800 * u,
          display: "flex",
          flexWrap: "wrap",
          gap: `${8 * u}px ${18 * u}px`,
          fontSize: 19 * u,
          color: T.muted,
          opacity: chartIn * (1 - summaryIn),
        }}
      >
        {(["left", "centre-left", "centre", "centre-right", "right"] as const).map((g) => (
          <span key={g} style={{ display: "flex", alignItems: "center", gap: 6 * u }}>
            <i style={{ width: 12 * u, height: 12 * u, borderRadius: "50%", background: IDEO[g] }} />
            {{ left: "Esquerda", "centre-left": "Centro-esquerda", centre: "Centro", "centre-right": "Centro-direita", right: "Direita" }[g]}
          </span>
        ))}
        <span style={{ width: "100%" }}>Contorno: partido do presidente</span>
      </div>

      {/* Summary: how to read it, then the takeaway. */}
      <div
        style={{
          position: "absolute",
          ...(portrait ? { left: pad, right: pad, top: 1490 * u } : panel),
          opacity: summaryIn,
          display: "flex",
          gap: 26 * u,
          fontSize: 22 * u,
          color: T.ink2,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 * u }}>
          <i style={{ width: 16 * u, height: 16 * u, borderRadius: "50%", border: `${3 * u}px solid ${T.ink2}` }} />
          governos do PT
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 * u }}>
          <i style={{ width: 22 * u, height: 22 * u, borderRadius: "50%", background: T.ink2 }} />
          Temer e Bolsonaro
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          ...(portrait ? { left: pad, right: pad, top: 320 * u } : { ...panel, top: panel.top + 70 * u }),
          opacity: closingIn,
          transform: `translateY(${(1 - closingIn) * 20 * u}px)`,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 46 * u,
          lineHeight: 1.1,
        }}
      >
        MDB, PP e Republicanos nunca votaram menos de {pct(Math.min(...CENTRE.map((l) => ROWS.find((x) => x.lineage === l)!.min)))}{" "}
        com o governo, fosse ele do PT, do MDB ou do PL.
      </div>
      <div
        style={{
          position: "absolute",
          ...(portrait ? { left: pad, right: pad, top: 1545 * u } : { ...panel, top: panel.top + 330 * u }),
          opacity: closingIn,
          fontSize: 28 * u,
          color: T.ink2,
          lineHeight: 1.4,
        }}
      >
        PT e PL trocam de lado: o PT foi de {s("PT", "lula3")} com Lula 3 a {s("PT", "bolsonaro")} com Bolsonaro; o PL,
        de {s("PL", "bolsonaro")} com Bolsonaro a {s("PL", "lula3")} com Lula 3.
      </div>

      <Footer
        source="Câmara dos Deputados, orientações de bancada em votações nominais · posição dos partidos: Zucco e Power (BLS)"
        opacity={headerIn}
      />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Governismo",
  title: "Quem vota com qualquer governo",
  description: "Quanto cada partido votou com o governo na Câmara, de Lula 1 a Lula 3: o centro fica, os lados trocam.",
  component: Governismo,
  defaultProps: {},
  durationInFrames: duration,
  formats: ["portrait", "landscape"],
});
