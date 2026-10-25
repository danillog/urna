/**
 * "O que é o IDH?": the explainer for the series. What the index is for, the three parts
 * and how each becomes a 0–1 score, how they join, what life looks like at each level of
 * the scale (real countries), the world, and the Brazilian IDHM with its own tiers.
 * Data: motion/data/idh-explicador.json and argentina.json (scripts/).
 */
import { interpolate, useCurrentFrame } from "remotion";
import arg from "../../data/argentina.json";
import ex from "../../data/idh-explicador.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import type { Cue } from "./sound";
import { DISPLAY, T } from "../common/theme";
import { Big, Caption, Kicker, clamp, dec, ease, hdiText } from "./kit";
import { BANDS, PARTS, Ruler } from "./primer";

type Props = Record<string, never>;

interface Card {
  iso: string;
  name: string;
  hdi: number;
  le: number;
  mys: number;
  gnipc: number;
}
const E = ex as unknown as {
  year: number;
  firstYear: number;
  count: number;
  anchors: Card[];
  top: Card;
  bottom: Card;
  world: { first: number; last: number };
  brazilRank: number;
};
const BR = (arg as unknown as { countries: { BRA: { le: number; eys: number; mys: number; gnipc: number; hdi: number; index: Record<"health" | "education" | "income", number> } } })
  .countries.BRA;
const CARDS = [...E.anchors, E.top];

const one = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const thousands = (v: number) => `US$ ${one(v / 1000)} mil`;

// Scenes.
const WHY = [0, 210] as const;
const PARTS_AT = [210, 660] as const;
const JOIN = [660, 860] as const;
const SCALE = [860, 1380] as const;
const WORLD = [1380, 1540] as const;
const IDHM = [1540, 1730] as const;
const DURATION = IDHM[1];
const CARD = 62;
const LO = 0.35;

function Explicador(_: Props) {
  const frame = useCurrentFrame();
  const { u, pad } = useLayout();
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const top = 300 * u;
  const fade = (at: number) => interpolate(frame, [at, at + 14], [0, 1], clamp);

  const parts = [
    {
      ...PARTS[0]!,
      measure: "Expectativa de vida ao nascer.",
      ends: "20 anos = 0 · 85 anos = 1",
      brazil: `${one(BR.le)} anos`,
      score: BR.index.health,
    },
    {
      ...PARTS[1]!,
      measure: "Anos de estudo dos adultos e anos que uma criança deve estudar.",
      ends: "0 = 0 · 15 anos (adultos) e 18 (crianças) = 1",
      brazil: `${one(BR.mys)} anos (adultos), ${one(BR.eys)} (crianças)`,
      score: BR.index.education,
    },
    {
      ...PARTS[2]!,
      measure: "Renda por pessoa, em dólares ajustados ao custo de vida de cada país.",
      ends: "US$ 100 por ano = 0 · US$ 75 mil = 1",
      brazil: `${thousands(BR.gnipc)} por ano`,
      score: BR.index.income,
    },
  ];

  const x = (v: number) => `${((v - LO) / (1 - LO)) * 100}%`;
  const shownCards = Math.floor((frame - SCALE[0] - 50) / CARD) + 1;

  return (
    <Stage>
      <Header title="O que é o IDH?" subtitle="E o que significa um país ter 0,5, 0,7 ou 0,9" opacity={headerIn} />

      <Caption from={WHY[0]} to={WHY[1]} top={top + 40 * u}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 80 * u, lineHeight: 1.02 }}>
          Índice de Desenvolvimento Humano
        </div>
        <div style={{ marginTop: 30 * u, fontSize: 40 * u, lineHeight: 1.35, color: T.ink2 }}>
          A ONU criou em 1990 para responder a uma pergunta:
        </div>
        <div style={{ opacity: fade(60), marginTop: 22 * u, fontSize: 52 * u, lineHeight: 1.2, fontWeight: 600 }}>
          a vida das pessoas está melhorando?
        </div>
        <div style={{ opacity: fade(110), marginTop: 30 * u, fontSize: 38 * u, lineHeight: 1.35, color: T.ink2 }}>
          Não só “a economia está crescendo?”. Por isso olha para três coisas.
        </div>
      </Caption>

      <Caption from={PARTS_AT[0]} to={PARTS_AT[1]} top={top}>
        <Kicker>Três perguntas, três notas de 0 a 1</Kicker>
        {parts.map((p, i) => {
          const at = PARTS_AT[0] + 15 + i * 120;
          const g = ease(interpolate(frame, [at + 50, at + 80], [0, 1], clamp));
          return (
            <div key={p.name} style={{ opacity: fade(at), marginTop: 30 * u }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 16 * u }}>
                <i style={{ width: 22 * u, height: 22 * u, borderRadius: "50%", background: p.color, flex: "none" }} />
                <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 54 * u }}>{p.name}</span>
                <span style={{ fontSize: 34 * u, color: T.ink2 }}>{p.what}?</span>
              </div>
              <div style={{ fontSize: 30 * u, lineHeight: 1.35, marginTop: 6 * u }}>{p.measure}</div>
              <div style={{ fontSize: 24 * u, color: T.muted, marginTop: 4 * u }}>{p.ends}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 * u, marginTop: 12 * u, opacity: fade(at + 45) }}>
                <span style={{ fontSize: 26 * u, color: "#fde725", width: 120 * u }}>Brasil</span>
                <div style={{ flex: 1, height: 24 * u, background: T.surface, borderRadius: 4 * u }}>
                  <div style={{ width: `${p.score * 100 * g}%`, height: "100%", background: p.color, borderRadius: 4 * u }} />
                </div>
                <span style={{ width: 100 * u, textAlign: "right", fontSize: 30 * u, fontVariantNumeric: "tabular-nums" }}>
                  {dec(p.score * g)}
                </span>
              </div>
              <div style={{ fontSize: 24 * u, color: T.muted, marginTop: 4 * u, opacity: fade(at + 45) }}>{p.brazil}</div>
            </div>
          );
        })}
      </Caption>

      <Caption from={JOIN[0]} to={JOIN[1]} top={top + 40 * u}>
        <Kicker>As três viram uma nota só</Kicker>
        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 18 * u, fontFamily: DISPLAY, fontWeight: 700, fontSize: 70 * u }}>
          {parts.map((p, i) => (
            <span key={p.name} style={{ color: p.color }}>
              {dec(p.score)}
              {i < 2 ? <span style={{ color: T.muted }}> ·</span> : null}
            </span>
          ))}
        </div>
        <div style={{ opacity: fade(JOIN[0] + 45), marginTop: 20 * u, display: "flex", alignItems: "baseline", gap: 20 * u }}>
          <span style={{ fontSize: 40 * u, color: T.ink2 }}>IDH do Brasil:</span>
          <Big size={150} color={hdiText(BR.hdi)}>
            {dec(BR.hdi)}
          </Big>
        </div>
        <div style={{ opacity: fade(JOIN[0] + 90), marginTop: 30 * u, fontSize: 38 * u, lineHeight: 1.35 }}>
          É uma média em que uma nota boa não compensa toda uma ruim: se uma das três é muito baixa, puxa o resultado para
          baixo.
        </div>
      </Caption>

      <Caption from={SCALE[0]} to={SCALE[1]} top={top}>
        <Kicker>O que cada número significa, na vida real ({E.year})</Kicker>
        <div style={{ position: "relative", marginTop: 50 * u }}>
          <Ruler scale="idh" at={SCALE[0] + 10} lo={LO} />
          {CARDS.slice(0, Math.max(0, shownCards)).map((c, i) => {
            const at = SCALE[0] + 50 + i * CARD;
            const isLast = i === Math.max(0, shownCards) - 1;
            return (
              <div
                key={c.iso}
                style={{
                  position: "absolute",
                  left: x(c.hdi),
                  top: -6 * u,
                  width: 4 * u,
                  height: 42 * u,
                  marginLeft: -2 * u,
                  background: c.iso === "BRA" ? "#fde725" : T.ink,
                  opacity: interpolate(frame, [at, at + 10], [0, isLast ? 1 : 0.45], clamp),
                }}
              />
            );
          })}
        </div>
        <div style={{ marginTop: 10 * u }}>
          {CARDS.map((c, i) => {
            const at = SCALE[0] + 50 + i * CARD;
            const o = interpolate(frame, [at, at + 12], [0, 1], clamp);
            if (o === 0) return null;
            const br = c.iso === "BRA";
            return (
              <div
                key={c.iso}
                style={{
                  opacity: o,
                  display: "flex",
                  alignItems: "center",
                  gap: 18 * u,
                  padding: `${10 * u}px 0`,
                  borderBottom: `1px solid ${T.rule}`,
                }}
              >
                <span
                  style={{
                    width: 130 * u,
                    fontFamily: DISPLAY,
                    fontWeight: 700,
                    fontSize: 46 * u,
                    color: hdiText(c.hdi),
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {dec(c.hdi)}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 32 * u, fontWeight: 600, color: br ? "#fde725" : T.ink }}>{c.name}</div>
                  <div style={{ fontSize: 25 * u, color: T.ink2 }}>
                    vive {Math.round(c.le)} anos · estuda {one(c.mys)} anos · {thousands(c.gnipc)}/ano
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ opacity: fade(SCALE[0] + 50 + CARDS.length * CARD + 10), marginTop: 22 * u, fontSize: 30 * u, color: T.ink2 }}>
          Ninguém tem 0 ou 1: são os limites da régua. O mais baixo do mundo é {E.bottom.name} ({dec(E.bottom.hdi)}).
        </div>
      </Caption>

      <Caption from={WORLD[0]} to={WORLD[1]} top={top + 40 * u}>
        <Kicker>E o mundo?</Kicker>
        <div style={{ fontSize: 40 * u, color: T.ink2 }}>Média mundial</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 24 * u, marginTop: 10 * u }}>
          <Big size={120} color={hdiText(E.world.first)}>
            {dec(E.world.first)}
          </Big>
          <span style={{ fontSize: 34 * u, color: T.muted }}>em {E.firstYear}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 24 * u, marginTop: 10 * u, opacity: fade(WORLD[0] + 30) }}>
          <Big size={120} color={hdiText(E.world.last)}>
            {dec(E.world.last)}
          </Big>
          <span style={{ fontSize: 34 * u, color: T.muted }}>em {E.year}</span>
        </div>
        <div style={{ opacity: fade(WORLD[0] + 70), marginTop: 40 * u, fontSize: 40 * u, lineHeight: 1.35 }}>
          O Brasil, com {dec(BR.hdi)}, é o <b>{E.brazilRank}º</b> de {E.count} países: acima da média, na faixa “alto”.
        </div>
      </Caption>

      <Caption from={IDHM[0]} to={DURATION + 30} top={top + 40 * u}>
        <Kicker>E o IDHM?</Kicker>
        <div style={{ fontSize: 40 * u, lineHeight: 1.35 }}>
          É a versão brasileira, calculada para cada <b>município</b> e <b>estado</b> pelo Atlas do Desenvolvimento
          Humano (PNUD, Ipea e FJP). A ideia é a mesma; as faixas mudam um pouco:
        </div>
        <div style={{ marginTop: 70 * u }}>
          <Ruler scale="idhm" at={IDHM[0] + 30} />
        </div>
        <div style={{ opacity: fade(IDHM[0] + 70), marginTop: 20 * u, fontSize: 34 * u, color: T.ink2 }}>
          Abaixo de {dec(BANDS.idhm[1]!.from, 1)}, “muito baixo”. Acima de {dec(BANDS.idhm.at(-1)!.from, 1)}, “muito alto”.
        </div>
      </Caption>

      <Footer source="PNUD, Relatório de Desenvolvimento Humano 2025; Atlas Brasil" opacity={headerIn} />
    </Stage>
  );
}

/** Whoosh per scene, a pop per part and per country, a chime at the end. */
export const cues: Cue[] = [
  { name: "pop", at: 62 },
  ...[PARTS_AT, JOIN, SCALE, WORLD, IDHM].map((s) => ({ name: "whoosh" as const, at: s[0] - 6 })),
  ...[0, 1, 2].map((i) => ({ name: "pop" as const, at: PARTS_AT[0] + 15 + i * 120, volume: 0.35 })),
  { name: "hit", at: JOIN[0] + 45 },
  ...CARDS.map((_, i) => ({ name: "pop" as const, at: SCALE[0] + 50 + i * CARD, volume: 0.35 })),
  { name: "chime", at: IDHM[0] + 75 },
];

export const def = motion<Props>({
  id: "IdhExplicador",
  title: "O que é o IDH?",
  description: "As três notas, como viram uma, e o que 0,4, 0,6 ou 0,9 significam na vida real, com países de exemplo.",
  component: Explicador,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait"],
});
