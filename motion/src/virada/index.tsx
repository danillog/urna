import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { NONE, decodeRace, margin, shade, type MapRace } from "../../../src/model/map-data";
import { COUNT, MAP, geo, paint } from "../common/municipios";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, css, int, mix, pct, rgb } from "../common/theme";

type Props = Record<string, never>;

/**
 * Where the vote changed sides: the 2022 runoff (Lula x Bolsonaro) against the 2026 first
 * round (Lula x Flávio Bolsonaro). A runoff and a first round are not the same contest, so
 * the swing is Lula's share of the votes for the top two only, municipality by municipality.
 */

const R22 = decodeRace(MAP, "president-2022-r2", MAP.races["president-2022-r2"]!);
const R26 = decodeRace(MAP, "president-2026-r1", MAP.races["president-2026-r1"]!);
const LEFT = "Lula";
const RIGHT22 = "Bolsonaro";
const RIGHT26 = "Flávio";

/** A candidate's share (0..100) where they came first or second, else null. */
function shareOf(race: MapRace, label: string, i: number): number | null {
  const k = race.labels.indexOf(label);
  if (race.winner[i] === k) return race.winnerShare[i]! / 10;
  if (race.second[i] === k) return race.secondShare[i]! / 10;
  return null;
}

/** Lula's share of the two-way vote, and the two-way votes, per municipality (NaN when not top two). */
function twoWay(race: MapRace, right: string) {
  const share = new Float32Array(COUNT).fill(NaN);
  const votes = new Float64Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const l = shareOf(race, LEFT, i);
    const r = shareOf(race, right, i);
    if (l === null || r === null || l + r === 0) continue;
    share[i] = (l / (l + r)) * 100;
    votes[i] = (race.votes[i]! * (l + r)) / 100;
  }
  return { share, votes };
}

const A = twoWay(R22, RIGHT22);
const B = twoWay(R26, RIGHT26);
/** Change in Lula's two-way share, in points (NaN where a third name came second in 2026). */
const SWING = A.share.map((v, i) => B.share[i]! - v);
const valid = [...SWING.keys()].filter((i) => Number.isFinite(SWING[i]!));
const left = (r: MapRace) => r.labels.indexOf(LEFT);
const right = (r: MapRace, l: string) => r.labels.indexOf(l);

/** Winner flips between the two maps. */
const TO_RIGHT = [...Array(COUNT).keys()].filter(
  (i) => R22.winner[i] === left(R22) && R26.winner[i] === right(R26, RIGHT26),
);
const TO_LEFT = [...Array(COUNT).keys()].filter(
  (i) => R22.winner[i] === right(R22, RIGHT22) && R26.winner[i] === left(R26),
);
const FLIP = new Uint8Array(COUNT);
TO_RIGHT.forEach((i) => (FLIP[i] = 1));
TO_LEFT.forEach((i) => (FLIP[i] = 2));

const towardLeft = valid.filter((i) => SWING[i]! > 0).length;
const towardRight = valid.filter((i) => SWING[i]! < 0).length;
const median = (() => {
  const s = valid.map((i) => SWING[i]!).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
})();

const wins = (r: MapRace, label: string) => {
  const k = r.labels.indexOf(label);
  let n = 0;
  for (let i = 0; i < COUNT; i++) if (r.winner[i] === k) n++;
  return n;
};

/** Votes-weighted two-way share over a set of municipalities, both years. */
function pooled(idx: number[]): { a: number; b: number; swing: number } {
  let la = 0;
  let ta = 0;
  let lb = 0;
  let tb = 0;
  for (const i of idx) {
    la += (A.share[i]! / 100) * A.votes[i]!;
    ta += A.votes[i]!;
    lb += (B.share[i]! / 100) * B.votes[i]!;
    tb += B.votes[i]!;
  }
  const a = (la / ta) * 100;
  const b = (lb / tb) * 100;
  return { a, b, swing: b - a };
}
const NATIONAL = pooled(valid);

const REGIONS: { name: string; ufs: string[] }[] = [
  { name: "Norte", ufs: ["AC", "AP", "AM", "PA", "RO", "RR", "TO"] },
  { name: "Nordeste", ufs: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"] },
  { name: "Centro-Oeste", ufs: ["DF", "GO", "MT", "MS"] },
  { name: "Sudeste", ufs: ["ES", "MG", "RJ", "SP"] },
  { name: "Sul", ufs: ["PR", "RS", "SC"] },
];
const UF_NAME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima",
  SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
const UF = MAP.municipalities.uf;
const inUfs = (ufs: string[]) => valid.filter((i) => ufs.includes(UF[i]!));
const BY_REGION = REGIONS.map((r) => ({ name: r.name, ...pooled(inUfs(r.ufs)) }))
  .sort((a, b) => a.swing - b.swing);
const BY_STATE = Object.keys(UF_NAME)
  .map((uf) => ({ uf, ...pooled(inUfs([uf])) }))
  .sort((a, b) => a.swing - b.swing);
const FLIPS_BY_STATE = Object.keys(UF_NAME)
  .map((uf) => ({ uf, n: TO_RIGHT.filter((i) => UF[i] === uf).length }))
  .sort((a, b) => b.n - a.n);
const TOP_FLIP_STATES = FLIPS_BY_STATE.slice(0, 4);
const topFlipSum = TOP_FLIP_STATES.reduce((s, x) => s + x.n, 0);

/** 2026 first round, national: the share that went to neither of the top two. */
const OTHERS_2026 = (() => {
  let two = 0;
  let all = 0;
  for (let i = 0; i < COUNT; i++) {
    all += R26.votes[i]!;
    const l = shareOf(R26, LEFT, i) ?? 0;
    const r = shareOf(R26, RIGHT26, i) ?? 0;
    two += (R26.votes[i]! * (l + r)) / 100;
  }
  return 100 - (two / all) * 100;
})();
const excluded = COUNT - valid.length;

// Timeline (frames at 30 fps).
const T22 = 0;
const M1 = 190; // 2022 → 2026
const CAVEAT = 400;
const M2 = 640; // 2026 → swing
const FLIPS = 900;
const M3 = 900; // swing → flips
const REG = 1160;
const M4 = 1160; // flips → swing
const STATES = 1340;
const END = 1520;
const DURATION = 1680;
const MOVE = 45;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
/** Share of the candidate's color by margin step, as the site's --mix (28/52/76/100%). */
const STRENGTH = [0.28, 0.52, 0.76, 1];
/** Swing (points) at which the diverging scale is fully saturated. */
const SAT = 8;

const surface = rgb(T.surface);
const empty = rgb(T.rule);
const red = rgb(COLOR.red);
const blue = rgb(COLOR.blue);
const lerp = (c: readonly number[], d: readonly number[], s: number) => [0, 1, 2].map((k) => d[k]! * s + c[k]! * (1 - s));

function fills(f: (i: number) => number[]): Float32Array {
  const out = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) out.set(f(i), i * 3);
  return out;
}
const winnerFill = (race: MapRace) =>
  fills((i) => {
    const w = race.winner[i]!;
    if (w === NONE) return [...empty];
    const base = rgb(COLOR[race.groupColors[race.groups[w]!] ?? "gray"]);
    return lerp(surface, base, STRENGTH[shade(margin(race, i))]!);
  });
const swingColor = (s: number) =>
  Number.isFinite(s) ? lerp(surface, s > 0 ? red : blue, Math.min(1, Math.abs(s) / SAT) * 0.9 + 0.1) : [...empty];
const F22 = winnerFill(R22);
const F26 = winnerFill(R26);
const FSWING = fills((i) => swingColor(SWING[i]!));
const FFLIP = fills((i) => (FLIP[i] === 1 ? [...blue] : FLIP[i] === 2 ? [...red] : lerp(rgb(T.bg), surface, 1)));

/** The map's states in order, and where each change starts. */
const STEPS: { at: number; fill: Float32Array }[] = [
  { at: T22, fill: F22 },
  { at: M1, fill: F26 },
  { at: M2, fill: FSWING },
  { at: M3, fill: FFLIP },
  { at: M4, fill: FSWING },
];

const sign = (n: number, digits = 1) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** "1,9 ponto", "4,3 pontos": singular below two. */
const points = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${Math.abs(n) < 2 ? "ponto" : "pontos"}`;

/** A block of the panel shown between two frames, with a fade at both ends. */
function Scene({ from, to, children }: { from: number; to: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  if (frame < from - 1 || frame > to + 1) return null;
  const o = interpolate(frame, [from, from + 15, to - 12, to], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o, transform: `translateY(${(1 - o) * 16}px)` }}>
      {children}
    </div>
  );
}

function Big({ children, color }: { children: ReactNode; color?: string }) {
  const { u, portrait } = useLayout();
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize: (portrait ? 120 : 130) * u,
        lineHeight: 0.92,
        fontVariantNumeric: "tabular-nums",
        color: color ?? T.ink,
      }}
    >
      {children}
    </div>
  );
}

function WinRow({ label, n, color }: { label: string; n: number; color: string }) {
  const { u } = useLayout();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 * u }}>
      <i style={{ width: 22 * u, height: 22 * u, borderRadius: 4 * u, background: color, flex: "none" }} />
      <span style={{ fontSize: 30 * u, flex: 1, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 42 * u, fontVariantNumeric: "tabular-nums" }}>
        {int(n)}
      </span>
    </div>
  );
}

function RaceCard({ year, round, rows, two }: { year: number; round: string; rows: { label: string; n: number; color: string }[]; two: string }) {
  const { u, portrait } = useLayout();
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 20 * u }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 140 : 160) * u, lineHeight: 0.9 }}>
          {year}
        </span>
        <span style={{ fontSize: 28 * u, color: T.ink2 }}>{round}</span>
      </div>
      <div style={{ fontSize: 22 * u, color: T.muted, margin: `${18 * u}px 0 ${12 * u}px` }}>municípios vencidos</div>
      <div style={{ display: "grid", gridTemplateColumns: portrait ? "1fr 1fr" : "1fr", gap: `${10 * u}px ${36 * u}px` }}>
        {rows.map((r) => (
          <WinRow key={r.label} {...r} />
        ))}
      </div>
      <div style={{ fontSize: 24 * u, color: T.ink2, marginTop: 24 * u, lineHeight: 1.4 }}>{two}</div>
    </div>
  );
}

function SwingLegend() {
  const { u } = useLayout();
  const steps = [-SAT, -SAT / 2, -1, 1, SAT / 2, SAT];
  return (
    <div style={{ fontSize: 19 * u, color: T.muted }}>
      <div style={{ display: "flex", gap: 3 * u }}>
        {steps.map((s) => (
          <div key={s} style={{ flex: 1, height: 14 * u, borderRadius: 2 * u, background: css(swingColor(s)) }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 * u }}>
        <span>← para Flávio</span>
        <span>cor cheia: {SAT} pontos ou mais</span>
        <span>para Lula →</span>
      </div>
    </div>
  );
}

function Bar({ label, value, max, note }: { label: string; value: number; max: number; note?: string }) {
  const { u, portrait } = useLayout();
  const w = Math.abs(value) / max;
  const toLeft = value > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 * u, height: (portrait ? 46 : 52) * u }}>
      <span style={{ width: (portrait ? 270 : 210) * u, fontSize: 27 * u, whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, position: "relative", height: 26 * u }}>
        <div style={{ position: "absolute", left: "50%", top: -6 * u, bottom: -6 * u, width: 1, background: T.muted }} />
        <div
          style={{
            position: "absolute",
            [toLeft ? "left" : "right"]: "50%",
            width: `${w * 50}%`,
            height: "100%",
            borderRadius: 3 * u,
            background: toLeft ? COLOR.red : COLOR.blue,
          }}
        />
      </div>
      <span
        style={{
          width: 120 * u,
          textAlign: "right",
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: 34 * u,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {sign(value)}
      </span>
      {note ? <span style={{ width: 120 * u, fontSize: 20 * u, color: T.muted, whiteSpace: "nowrap" }}>{note}</span> : null}
    </div>
  );
}

function Virada(_: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const canvas = useRef<HTMLCanvasElement>(null);

  const box = portrait
    ? { x: pad, y: 300 * u, w: width - 2 * pad, h: 900 * u }
    : { x: 720 * u, y: 110 * u, w: width - 720 * u - pad, h: height - 110 * u - 100 * u };

  // The map step being shown, and how far into the move to the next one.
  let s = 0;
  while (s + 1 < STEPS.length && frame >= STEPS[s + 1]!.at) s++;
  const prev = STEPS[Math.max(0, s - 1)]!;
  const cur = STEPS[s]!;
  const p = s === 0 ? 1 : interpolate(frame, [cur.at, cur.at + MOVE], [0, 1], clamp);
  const mapIn = interpolate(frame, [8, 40], [0, 1], clamp);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = geo(box.w, box.h);
    const fa = prev.fill;
    const fb = cur.fill;
    const bg = rgb(T.bg);
    // The new colors sweep west to east; each municipality fades over 40% of the move.
    paint(
      el,
      g,
      (k) => {
        const q = p >= 1 ? 1 : ease(interpolate(p, [g.nx[k]! * 0.6, g.nx[k]! * 0.6 + 0.4], [0, 1], clamp));
        const c = [0, 1, 2].map((j) => fa[k * 3 + j]! + (fb[k * 3 + j]! - fa[k * 3 + j]!) * q);
        return css(mapIn < 1 ? c.map((v, j) => bg[j]! + (v - bg[j]!) * mapIn) : c);
      },
      { color: T.bg, width: 1.1 * u },
    );
  });

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const panel = portrait
    ? { left: pad, right: pad, top: 1230 * u, height: 560 * u }
    : { left: pad, width: 600 * u, top: 340 * u, height: 640 * u };
  const text = { fontSize: 28 * u, lineHeight: 1.4, color: T.ink2 } as const;
  const strong = { color: T.ink, fontWeight: 600 } as const;
  const maxRegion = Math.max(...BY_REGION.map((r) => Math.abs(r.swing)));
  const states = [...BY_STATE.slice(0, 3), ...BY_STATE.slice(-3).reverse()];
  const maxState = Math.max(...states.map((r) => Math.abs(r.swing)));

  return (
    <Stage>
      <Header
        title="Onde o voto mudou de lado"
        subtitle="2º turno de 2022 x 1º turno de 2026, município por município"
        opacity={headerIn}
      />
      <canvas
        ref={canvas}
        width={Math.round(box.w)}
        height={Math.round(box.h)}
        style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}
      />
      <div style={{ position: "absolute", ...panel }}>
        <Scene from={T22 + 10} to={M1 + 20}>
          <RaceCard
            year={2022}
            round="2º turno"
            rows={[
              { label: "Lula", n: wins(R22, LEFT), color: COLOR.red },
              { label: "Bolsonaro", n: wins(R22, RIGHT22), color: COLOR.blue },
            ]}
            two={`Lula venceu com ${pct(NATIONAL.a)} dos votos válidos.`}
          />
        </Scene>
        <Scene from={M1 + 20} to={CAVEAT}>
          <RaceCard
            year={2026}
            round="1º turno · 2º turno em 25/10"
            rows={[
              { label: "Flávio Bolsonaro", n: wins(R26, RIGHT26), color: COLOR.blue },
              { label: "Lula", n: wins(R26, LEFT), color: COLOR.red },
            ]}
            two={`Lula venceu em ${int(wins(R22, LEFT) - wins(R26, LEFT))} municípios a menos que em 2022.`}
          />
        </Scene>
        <Scene from={CAVEAT} to={M2 + 20}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 56 * u, lineHeight: 1.05 }}>
            Antes de comparar: não é a mesma disputa
          </div>
          <div style={{ ...text, marginTop: 22 * u }}>
            Em 2022, o 2º turno tinha só dois nomes. No 1º turno de 2026 foram onze, e{" "}
            <span style={strong}>{pct(OTHERS_2026)}</span> dos votos válidos ficaram com os outros nove.
          </div>
          <div style={{ ...text, marginTop: 18 * u }}>
            Por isso a conta usa só os votos dos dois primeiros: a fatia de Lula entre Lula e Bolsonaro (2022) e
            entre Lula e Flávio (2026). Ainda assim, quem votou em terceiros pode se dividir no 2º turno.
          </div>
          {excluded ? (
            <div style={{ fontSize: 21 * u, color: T.muted, marginTop: 18 * u, lineHeight: 1.4 }}>
              {excluded === 1 ? "Fica de fora 1 município" : `Ficam de fora ${excluded} municípios`}, onde Lula ou
              Flávio não ficou entre os dois primeiros.
            </div>
          ) : null}
        </Scene>
        <Scene from={M2 + 20} to={FLIPS + 10}>
          <div style={{ fontSize: 24 * u, color: T.muted }}>Fatia de Lula entre os dois primeiros</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 * u, marginTop: 8 * u }}>
            <Big>{pct(NATIONAL.a)}</Big>
            <span style={{ fontSize: 40 * u, color: T.muted }}>→</span>
            <Big>{pct(NATIONAL.b)}</Big>
          </div>
          <div style={{ ...text, marginTop: 20 * u }}>
            A fatia de Lula caiu em <span style={strong}>{int(towardRight)}</span> dos {int(valid.length)} municípios e
            subiu em <span style={strong}>{int(towardLeft)}</span>. Na metade deles, caiu mais de{" "}
            <span style={strong}>{points(-median)}</span>.
          </div>
          <div style={{ marginTop: 26 * u }}>
            <SwingLegend />
          </div>
        </Scene>
        <Scene from={FLIPS + 10} to={REG + 10}>
          <div style={{ fontSize: 24 * u, color: T.muted }}>Municípios que trocaram de vencedor</div>
          <div style={{ display: "flex", gap: 48 * u, marginTop: 12 * u }}>
            <div>
              <Big color={COLOR.blue}>{int(TO_RIGHT.length)}</Big>
              <div style={{ fontSize: 24 * u, color: T.ink2, marginTop: 8 * u }}>de Lula para Flávio</div>
            </div>
            <div>
              <Big color={COLOR.red}>{int(TO_LEFT.length)}</Big>
              <div style={{ fontSize: 24 * u, color: T.ink2, marginTop: 8 * u }}>de Bolsonaro para Lula</div>
            </div>
          </div>
          <div style={{ ...text, marginTop: 24 * u }}>
            {TOP_FLIP_STATES.map((x, k) => (
              <span key={x.uf}>
                {k ? (k === TOP_FLIP_STATES.length - 1 ? " e " : ", ") : ""}
                {UF_NAME[x.uf]} <span style={strong}>{x.n}</span>
              </span>
            ))}
            : {int(topFlipSum)} das {int(TO_RIGHT.length)} viradas.
            {TO_LEFT.length === 1
              ? ` O único caminho inverso foi ${MAP.municipalities.names[TO_LEFT[0]!]} (${UF[TO_LEFT[0]!]}).`
              : ""}
          </div>
        </Scene>
        <Scene from={REG + 10} to={STATES}>
          <div style={{ fontSize: 24 * u, color: T.muted, marginBottom: 14 * u }}>
            Variação da fatia de Lula entre os dois primeiros, por região (pontos)
          </div>
          {BY_REGION.map((r) => (
            <Bar key={r.name} label={r.name} value={r.swing} max={maxRegion} />
          ))}
          <div style={{ ...text, fontSize: 24 * u, marginTop: 16 * u }}>
            Todas as regiões andaram para Flávio. Mais: {BY_REGION[0]!.name}; menos: {BY_REGION.at(-1)!.name}.
          </div>
        </Scene>
        <Scene from={STATES} to={END}>
          <div style={{ fontSize: 24 * u, color: T.muted, marginBottom: 14 * u }}>
            Os estados que mais se moveram, para cada lado (pontos)
          </div>
          {states.map((r) => (
            <Bar key={r.uf} label={UF_NAME[r.uf]!} value={r.swing} max={maxState} />
          ))}
          <div style={{ ...text, fontSize: 24 * u, marginTop: 16 * u }}>
            {BY_STATE.filter((x) => x.swing > 0.05).length} estados foram na direção de Lula, a maioria no Norte.
          </div>
        </Scene>
        <Scene from={END} to={DURATION + 20}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 64 : 66) * u, lineHeight: 1.05 }}>
            Um recuo pequeno, mas quase em todo lugar
          </div>
          <div style={{ ...text, marginTop: 22 * u }}>
            A fatia de Lula caiu {points(-NATIONAL.swing)} no país, e {int(TO_RIGHT.length)} cidades trocaram de
            vencedor. O 2º turno, em
            25 de outubro, é que vai dizer para onde vão os votos dos outros nove candidatos.
          </div>
          <div style={{ fontSize: 26 * u, marginTop: 26 * u }}>
            Explore cada município em <b>danillogomes.com/urna</b>.
          </div>
        </Scene>
      </div>
      <Footer source="Resultados por município: TSE" opacity={headerIn} />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Virada",
  title: "Onde o voto mudou de lado, de 2022 a 2026",
  description:
    "O 2º turno de 2022 contra o 1º turno de 2026, município por município: a variação da fatia de Lula entre os dois primeiros e as cidades que viraram.",
  component: Virada,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
});
