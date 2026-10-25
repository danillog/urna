import { useLayoutEffect, useMemo, useRef } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { displayName as tseName } from "../../../src/model/apuracao";
import { geo, paint } from "../common/municipios";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { DISPLAY, T, css, int, mixRgb, pct, rgb } from "../common/theme";
import { at, count, pacing, tally, type CountRound } from "./count";

/** The TSE writes ballot names without accents; the ones on screen get theirs back. */
const ACCENTS: Record<string, string> = { Flavio: "Flávio" };
const displayName = (name: string) => tseName(name).replace(/\p{L}+/gu, (w) => ACCENTS[w] ?? w);

type Props = { round: CountRound };

const INTRO = 45;
const COUNTING = 1500;
const OUTRO = 255;
/** A municipality flashes for this many frames when its votes arrive. */
const FLASH = 10;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const paceCache = new Map<CountRound, Float64Array>();

function clock(minutes: number): string {
  const m = Math.floor(minutes) % (24 * 60);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function Apuracao({ round }: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const canvas = useRef<HTMLCanvasElement>(null);
  const c = count(round);
  const pace = useMemo(() => {
    let p = paceCache.get(round);
    if (!p) {
      p = pacing(c, COUNTING);
      paceCache.set(round, p);
    }
    return p;
  }, [c, round]);

  const f = Math.min(COUNTING - 1, Math.max(0, frame - INTRO));
  const minute = frame < INTRO ? c.from : pace[f]!;
  // Minutes covered by the last few frames: what counts as "just arrived".
  const recent = minute - pace[Math.max(0, f - FLASH)]!;
  const now = tally(c, minute);

  // A third candidate on the scoreboard (1st round) takes room from the map in 9:16.
  const extra = portrait ? (c.top.length - 2) * 130 * u : 0;
  const box = portrait
    ? { x: pad, y: 290 * u, w: width - 2 * pad, h: 940 * u - extra }
    : { x: pad, y: 300 * u, w: 1060 * u, h: height - 300 * u - 100 * u };

  const colors = useMemo(() => c.colors.map(rgb), [c]);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = geo(box.w, box.h);
    const empty = rgb(T.surface);
    const white: [number, number, number] = [255, 255, 255];
    paint(
      el,
      g,
      (i) => {
        const p = c.places[i];
        if (!p) return css(empty);
        const k = at(p, minute);
        if (k < 0) return css(empty);
        const votes = p.votes[k]!;
        let lead = 0;
        for (let j = 1; j < votes.length; j++) if (votes[j]! > votes[lead]!) lead = j;
        const base = mixRgb(empty, colors[lead]!, 0.35 + 0.65 * p.c[k]!);
        // Just arrived: a short flash towards white.
        const age = minute - p.t[0]!;
        const flash = recent > 0 && age < recent ? 0.55 * (1 - age / recent) : 0;
        return css(mixRgb(base, white, flash));
      },
      { color: T.bg, width: 1 * u },
    );
  });

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const outroAt = INTRO + COUNTING;
  const outro = interpolate(frame, [outroAt + 15, outroAt + 40], [0, 1], clamp);
  const final = tally(c, c.to + 1);
  const leader = c.top[0]!;
  const leaderShare = final.valid ? (final.votes[leader]! / final.valid) * 100 : 0;
  // The round whose votes these are: a simulation may borrow the 1st round's.
  const runoff = (c.borrowed ?? c.round) === "r2";
  const verdict = c.borrowed
    ? "Prévia com os votos do 1º turno: o resultado do 2º turno sai em 25 de outubro."
    : runoff || leaderShare > 50
      ? `${displayName(c.names[leader]!)} vence com ${pct(leaderShare)} dos votos válidos.`
      : `${displayName(c.names[leader]!)} termina à frente, com ${pct(leaderShare)}: vai ao 2º turno.`;

  const board = portrait
    ? { left: pad, right: pad, top: 1250 * u - extra }
    : { left: box.x + box.w + 60 * u, right: pad, top: 250 * u };

  return (
    <Stage>
      <Header
        title={`A apuração do ${round === "r2" ? "2º" : "1º"} turno em 60 segundos`}
        subtitle="Cada município aparece quando seus votos são contados"
        opacity={headerIn}
      />
      <canvas
        ref={canvas}
        width={Math.round(box.w)}
        height={Math.round(box.h)}
        style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, opacity: headerIn }}
      />
      {c.simulated ? (
        <div
          style={{
            position: "absolute",
            left: box.x,
            top: box.y - (portrait ? 10 : 62) * u,
            padding: `${6 * u}px ${14 * u}px`,
            border: `${2 * u}px solid #e0453f`,
            color: "#ff7b73",
            borderRadius: 6 * u,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 24 * u,
            letterSpacing: 1.5 * u,
          }}
        >
          SIMULAÇÃO — PRÉVIA COM ORDEM INVENTADA
          {c.borrowed ? ` E RESULTADO DO ${c.borrowed === "r1" ? "1º" : "2º"} TURNO` : ""}
        </div>
      ) : null}

      <div style={{ position: "absolute", ...board, opacity: headerIn }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 * u }}>
          <span
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 120 * u,
              lineHeight: 0.9,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {clock(c.clock0 + minute)}
          </span>
          <span style={{ fontSize: 20 * u, color: T.muted }}>horário de Brasília</span>
        </div>
        <div style={{ marginTop: 26 * u, fontSize: 22 * u, color: T.ink2, display: "flex", justifyContent: "space-between" }}>
          <span>urnas apuradas</span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{pct(now.counted * 100, 2)}</b>
        </div>
        <div style={{ height: 10 * u, background: T.rule, borderRadius: 5 * u, marginTop: 8 * u, overflow: "hidden" }}>
          <div style={{ width: `${now.counted * 100}%`, height: "100%", background: T.ink2 }} />
        </div>
        <div style={{ marginTop: 34 * u, display: "flex", flexDirection: "column", gap: 26 * u }}>
          {c.top.map((k) => {
            const share = now.valid ? (now.votes[k]! / now.valid) * 100 : 0;
            return (
              <div key={k}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 * u }}>
                  <i
                    style={{
                      width: 20 * u,
                      height: 20 * u,
                      borderRadius: 4 * u,
                      background: c.colors[k],
                      alignSelf: "center",
                    }}
                  />
                  <span style={{ fontSize: 30 * u, flex: 1 }}>
                    {displayName(c.names[k]!)} <span style={{ color: T.muted, fontSize: 22 * u }}>{c.parties[k]}</span>
                  </span>
                  <span
                    style={{
                      fontFamily: DISPLAY,
                      fontWeight: 700,
                      fontSize: 64 * u,
                      lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {pct(share, 2)}
                  </span>
                </div>
                <div style={{ position: "relative", height: 14 * u, background: T.rule, borderRadius: 3 * u, marginTop: 10 * u }}>
                  <div style={{ width: `${share}%`, height: "100%", background: c.colors[k], borderRadius: 3 * u }} />
                  {runoff ? (
                    <div style={{ position: "absolute", left: "50%", top: -4 * u, bottom: -4 * u, width: 2 * u, background: T.ink }} />
                  ) : null}
                </div>
                <div style={{ fontSize: 20 * u, color: T.muted, marginTop: 6 * u, fontVariantNumeric: "tabular-nums" }}>
                  {int(now.votes[k]!)} votos
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 36 * u, fontSize: 30 * u, lineHeight: 1.35, opacity: outro, fontWeight: 500 }}>
          {verdict}
        </div>
      </div>
      <Footer
        source={
          c.simulated
            ? "Resultados por município: TSE · ordem da apuração simulada"
            : c.fromReports
              ? "Boletins de urna do TSE: a hora em que cada seção chegou"
              : "Apuração por município: TSE, lida ao vivo"
        }
        opacity={headerIn}
      />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Apuracao",
  title: "A apuração do 2º turno em 60 segundos",
  description: "O mapa dos municípios pintado na ordem em que os votos foram contados, com o placar subindo.",
  component: Apuracao,
  defaultProps: { round: "r2" },
  durationInFrames: () => INTRO + COUNTING + OUTRO,
  formats: ["portrait", "landscape"],
  controls: [
    {
      prop: "round",
      label: "Turno",
      options: [
        { value: "r2", label: "2º turno (25/10)" },
        { value: "r1", label: "1º turno (4/10)" },
      ],
    },
  ],
});
