/**
 * The 2023 half: a neon HUD over a moving grid floor. Each country's HDI travels from 1990 to
 * 2023 as a stream of light, the "time twins" come up as holographic cards, then the twist:
 * the same HDI, a very different plate.
 */
import { loadFont } from "@remotion/google-fonts/Orbitron";
import type { CSSProperties, ReactNode } from "react";
import { interpolate, random, useCurrentFrame } from "remotion";
import { useLayout } from "../common/layout";
import { BODY } from "../common/theme";
import { EPOCAS, PAGE_COUNTRIES, PAIRS, TWINS, WITH_FOOD, caps, hdi, pct } from "./data";
import { F, clamp, ease, easeOut } from "./timeline";

export const NEON = loadFont("normal", { weights: ["500", "700", "900"], subsets: ["latin"] }).fontFamily;
export const N = { cyan: "#2ef2ff", magenta: "#ff3df2", red: "#ff3b5c", ink: "#e9f6ff", dim: "#7b8bb0", deep: "#05060f" };
const glow = (c: string, r = 12) => `drop-shadow(0 0 ${r}px ${c}) drop-shadow(0 0 ${r * 2.5}px ${c}66)`;

/** Space, the horizon's glow and a grid floor running towards the viewer. */
export function Space({ children, floor = 1 }: { children: ReactNode; floor?: number }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  return (
    <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 35%, #12163a 0%, ${N.deep} 60%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: "62%", height: 3 * u, background: N.magenta, filter: glow(N.magenta, 18), opacity: 0.8 * floor }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: "62%", bottom: 0, perspective: 380 * u, perspectiveOrigin: "50% 0%", overflow: "hidden", opacity: floor }}>
        <div
          style={{
            position: "absolute",
            left: "-100%",
            right: "-100%",
            top: 0,
            height: "300%",
            transform: "rotateX(72deg)",
            transformOrigin: "50% 0%",
            backgroundImage: `linear-gradient(${N.cyan}99 ${2 * u}px, transparent ${2 * u}px), linear-gradient(90deg, ${N.cyan}99 ${2 * u}px, transparent ${2 * u}px)`,
            backgroundSize: `${110 * u}px ${110 * u}px`,
            backgroundPositionY: `${(frame * 3 * u) % (110 * u)}px`,
            maskImage: "linear-gradient(to bottom, transparent 0%, black 25%)",
          }}
        />
      </div>
      {/* Dust of stars, fixed. */}
      {Array.from({ length: 70 }, (_, i) => (
        <i
          key={i}
          style={{
            position: "absolute",
            left: `${random(`sx${i}`) * 100}%`,
            top: `${random(`sy${i}`) * 60}%`,
            width: 2 * u,
            height: 2 * u,
            borderRadius: "50%",
            background: "#fff",
            opacity: 0.25 + 0.5 * random(`so${i}`) * (0.6 + 0.4 * Math.sin(frame / 20 + i)),
          }}
        />
      ))}
      {children}
    </div>
  );
}

/** A glassy holographic panel with corner brackets. */
export function Panel({ children, style, color = N.cyan }: { children: ReactNode; style?: CSSProperties; color?: string }) {
  const { u } = useLayout();
  const c = 22 * u;
  const corner = (pos: CSSProperties, b: CSSProperties): ReactNode => (
    <i style={{ position: "absolute", width: c, height: c, ...pos, ...b, borderColor: color }} />
  );
  return (
    <div
      style={{
        position: "absolute",
        background: "linear-gradient(135deg, rgba(46,242,255,0.10), rgba(255,61,242,0.06)), rgba(7,9,26,0.88)",
        border: `${1 * u}px solid ${color}55`,
        boxShadow: `0 0 ${30 * u}px ${color}22 inset, 0 0 ${24 * u}px ${color}33`,
        backdropFilter: "blur(4px)",
        ...style,
      }}
    >
      {corner({ left: -2 * u, top: -2 * u }, { borderLeft: `${3 * u}px solid`, borderTop: `${3 * u}px solid` })}
      {corner({ right: -2 * u, top: -2 * u }, { borderRight: `${3 * u}px solid`, borderTop: `${3 * u}px solid` })}
      {corner({ left: -2 * u, bottom: -2 * u }, { borderLeft: `${3 * u}px solid`, borderBottom: `${3 * u}px solid` })}
      {corner({ right: -2 * u, bottom: -2 * u }, { borderRight: `${3 * u}px solid`, borderBottom: `${3 * u}px solid` })}
      {children}
    </div>
  );
}

/** "2023", the dumbbells (1990 → 2023 as a stream of light) and the time twins. */
export function Future() {
  const frame = useCurrentFrame();
  const { width, portrait, u, pad } = useLayout();
  const t = frame - F.future[0];
  const enter = interpolate(t, [0, 30], [0, 1], { ...clamp, easing: easeOut });
  const chart = portrait
    ? { left: pad, top: 330 * u, w: width - 2 * pad, rowH: 52 * u }
    : { left: pad, top: 340 * u, w: 900 * u, rowH: 52 * u };
  const x = (v: number) => chart.left + 250 * u + ((v - 0.4) / 0.6) * (chart.w - 330 * u);
  const travel = interpolate(t, [30, 150], [0, 1], { ...clamp, easing: ease });
  const twinsAt = F.twins;
  const perTwin = Math.floor((F.future[1] - twinsAt) / TWINS.length);
  const card = portrait
    ? { left: pad, right: pad, top: 1080 * u, height: 440 * u }
    : { left: 1080 * u, right: pad, top: 330 * u, height: 470 * u };
  return (
    <>
      <div style={{ position: "absolute", left: pad, top: 70 * u, opacity: enter }}>
        <div style={{ fontFamily: NEON, fontWeight: 900, fontSize: 120 * u, color: N.cyan, filter: glow(N.cyan, 10), letterSpacing: 6 * u }}>
          {EPOCAS.now}
        </div>
        <div style={{ fontFamily: BODY, fontSize: 30 * u, color: N.ink, marginTop: 4 * u }}>
          {EPOCAS.now - EPOCAS.then} anos depois · IDH de {EPOCAS.then} <span style={{ color: N.magenta }}>●</span> → {EPOCAS.now}{" "}
          <span style={{ color: N.cyan }}>◎</span>
        </div>
      </div>
      <svg style={{ position: "absolute", inset: 0, overflow: "visible", opacity: enter }} width="100%" height="100%">
        {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={chart.top - 20 * u} y2={chart.top + PAGE_COUNTRIES.length * chart.rowH} stroke={`${N.cyan}22`} strokeWidth={1 * u} />
            <text x={x(v)} y={chart.top - 30 * u} fill={N.dim} fontSize={20 * u} fontFamily={NEON} textAnchor="middle">
              {hdi(v).slice(0, 3)}
            </text>
          </g>
        ))}
        {PAGE_COUNTRIES.map((c, i) => {
          const cy = chart.top + i * chart.rowH + chart.rowH / 2;
          const x0 = x(c.then);
          const x1 = x0 + (x(c.now) - x0) * travel;
          const brazil = c.iso === "BRA";
          return (
            <g key={c.iso}>
              <text x={chart.left} y={cy} dy="0.35em" fill={brazil ? N.cyan : N.ink} fontSize={24 * u} fontFamily={NEON} fontWeight={brazil ? 700 : 500}>
                {c.iso === "USA" ? "EUA" : caps(c.name).slice(0, 11)}
              </text>
              <line x1={x0} x2={x1} y1={cy} y2={cy} stroke={brazil ? N.cyan : `${N.cyan}aa`} strokeWidth={(brazil ? 4 : 2.5) * u} style={{ filter: glow(N.cyan, 4) }} />
              {/* Packets of light running along the stream. */}
              {travel > 0.05
                ? Array.from({ length: 3 }, (_, k) => {
                    const p = ((frame / 40 + k / 3 + i * 0.07) % 1) * travel;
                    return <circle key={k} cx={x0 + (x(c.now) - x0) * p} cy={cy} r={3 * u} fill="#fff" opacity={0.8} />;
                  })
                : null}
              <circle cx={x0} cy={cy} r={6 * u} fill={N.magenta} style={{ filter: glow(N.magenta, 5) }} />
              <circle cx={x1} cy={cy} r={(brazil ? 12 : 9) * u} fill="none" stroke={N.cyan} strokeWidth={3 * u} style={{ filter: glow(N.cyan, 6) }} />
              <text x={x1 + 18 * u} y={cy} dy="0.35em" fill={N.ink} fontSize={20 * u} fontFamily={NEON} opacity={travel}>
                {hdi(c.now)}
              </text>
            </g>
          );
        })}
      </svg>
      {TWINS.map((tw, i) => {
        const at = twinsAt + i * perTwin;
        const p = interpolate(frame, [at, at + 18, at + perTwin - 12, at + perTwin], [0, 1, 1, 0], clamp);
        if (p <= 0) return null;
        const count = interpolate(frame, [at + 15, at + 60], [tw.then, tw.now], { ...clamp, easing: easeOut });
        return (
          <Panel key={tw.iso} style={{ ...card, opacity: p, transform: `translateY(${(1 - p) * 30 * u}px)`, padding: `${34 * u}px ${40 * u}px` }}>
            <div style={{ fontFamily: NEON, fontSize: 22 * u, color: N.magenta, letterSpacing: 4 * u }}>GÊMEOS NO TEMPO · {i + 1}/{TWINS.length}</div>
            <div style={{ fontFamily: NEON, fontWeight: 700, fontSize: 44 * u, color: N.ink, marginTop: 18 * u, lineHeight: 1.2 }}>
              {caps(tw.name)} {EPOCAS.then}
              <span style={{ color: N.cyan }}> = </span>
              {caps(tw.twinName)} HOJE
            </div>
            <div style={{ fontFamily: BODY, fontSize: 26 * u, color: N.dim, marginTop: 14 * u }}>
              IDH {hdi(tw.then)} em {EPOCAS.then} · {tw.twinName} tem {hdi(tw.twinNow)} em {EPOCAS.now}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18 * u, marginTop: 28 * u }}>
              <span style={{ fontFamily: NEON, fontSize: 40 * u, color: N.magenta, filter: glow(N.magenta, 6) }}>{hdi(tw.then)}</span>
              <span style={{ fontFamily: NEON, fontSize: 40 * u, color: N.dim }}>→</span>
              <span style={{ fontFamily: NEON, fontWeight: 900, fontSize: 84 * u, color: N.cyan, filter: glow(N.cyan, 8) }}>{hdi(count)}</span>
            </div>
            <div style={{ fontFamily: BODY, fontSize: 24 * u, color: N.ink, marginTop: 10 * u }}>
              {tw.name} hoje · +{hdi(tw.gain)} em {EPOCAS.now - EPOCAS.then} anos
            </div>
          </Panel>
        );
      })}
    </>
  );
}

/** Same HDI, a different plate: the scatter, the pairs joined one by one. */
export function Twist() {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const t = frame - F.twist[0];
  const enter = interpolate(t, [0, 24], [0, 1], { ...clamp, easing: easeOut });
  const box = portrait
    ? { x: pad + 70 * u, y: 560 * u, w: width - 2 * pad - 110 * u, h: 860 * u }
    : { x: pad + 80 * u, y: 330 * u, w: 1000 * u, h: 600 * u };
  const xMin = 0.55;
  const xMax = 0.95;
  const yMax = 90;
  const sx = (v: number) => box.x + ((v - xMin) / (xMax - xMin)) * box.w;
  const sy = (v: number) => box.y + box.h - (v / yMax) * box.h;
  const pairStart = 120;
  const perPair = Math.floor((F.twist[1] - F.twist[0] - pairStart - 30) / PAIRS.length);
  const active = Math.floor((t - pairStart) / perPair);
  const glitch = t < 30 ? (random(`g-${frame}`) - 0.5) * 18 * u * (1 - t / 30) : 0;
  const pulse = 0.6 + 0.4 * Math.sin(frame / 5);
  const side = portrait
    ? { left: pad, right: pad, top: 1460 * u }
    : { left: 1180 * u, right: pad, top: 330 * u };
  const pair = active >= 0 && active < PAIRS.length ? PAIRS[active]! : null;
  return (
    <>
      <Panel color={N.red} style={{ left: pad, right: pad, top: 70 * u, padding: `${22 * u}px ${30 * u}px`, opacity: enter, transform: `translateX(${glitch}px)` }}>
        <div style={{ fontFamily: NEON, fontSize: 22 * u, color: N.red, letterSpacing: 4 * u }}>⚠ ALERTA</div>
        <div style={{ fontFamily: NEON, fontWeight: 700, fontSize: (portrait ? 46 : 54) * u, color: N.ink, marginTop: 8 * u, lineHeight: 1.15 }}>
          Mas o futuro não chegou para todo prato.
        </div>
        <div style={{ fontFamily: BODY, fontSize: 26 * u, color: N.dim, marginTop: 10 * u }}>
          A tendência existe (correlação de {EPOCAS.correlation.toLocaleString("pt-BR")}): mais IDH, menos insegurança alimentar. Mas com o mesmo IDH…
        </div>
      </Panel>
      <svg style={{ position: "absolute", inset: 0, overflow: "visible", opacity: enter }} width={width} height={height}>
        <line x1={box.x} x2={box.x + box.w} y1={box.y + box.h} y2={box.y + box.h} stroke={`${N.cyan}88`} strokeWidth={2 * u} />
        <line x1={box.x} x2={box.x} y1={box.y} y2={box.y + box.h} stroke={`${N.cyan}88`} strokeWidth={2 * u} />
        {[0.6, 0.7, 0.8, 0.9].map((v) => (
          <text key={v} x={sx(v)} y={box.y + box.h + 34 * u} fill={N.dim} fontSize={20 * u} fontFamily={NEON} textAnchor="middle">
            {hdi(v).slice(0, 3)}
          </text>
        ))}
        {[0, 20, 40, 60, 80].map((v) => (
          <text key={v} x={box.x - 14 * u} y={sy(v)} dy="0.35em" fill={N.dim} fontSize={20 * u} fontFamily={NEON} textAnchor="end">
            {v}%
          </text>
        ))}
        <text x={box.x + box.w} y={box.y + box.h + 66 * u} fill={N.ink} fontSize={20 * u} fontFamily={BODY} textAnchor="end">
          IDH {EPOCAS.now} →
        </text>
        <text x={box.x} y={box.y - 18 * u} fill={N.ink} fontSize={20 * u} fontFamily={BODY}>
          ↑ insegurança alimentar
        </text>
        {WITH_FOOD.map((c, i) => {
          const appear = interpolate(t, [24 + i * 3, 40 + i * 3], [0, 1], clamp);
          const inPair = pair && (pair.low.iso === c.iso || pair.high.iso === c.iso);
          const hot = c.food! >= 30;
          const color = hot ? N.red : N.cyan;
          return (
            <circle
              key={c.iso}
              cx={sx(c.now)}
              cy={sy(c.food!)}
              r={(inPair ? 11 : 6) * u * appear}
              fill={inPair ? color : `${color}aa`}
              style={{ filter: glow(color, inPair ? 8 : 4) }}
              opacity={pair && !inPair ? 0.35 : 1}
            />
          );
        })}
        {pair ? (
          <line
            x1={sx(pair.low.now)}
            y1={sy(pair.low.food!)}
            x2={sx(pair.high.now)}
            y2={sy(pair.high.food!)}
            stroke={N.magenta}
            strokeWidth={3 * u}
            strokeDasharray={`${8 * u} ${6 * u}`}
            strokeDashoffset={-frame * 2}
            opacity={pulse}
            style={{ filter: glow(N.magenta, 6) }}
          />
        ) : null}
      </svg>
      {pair ? (
        <Panel style={{ ...side, padding: `${26 * u}px ${32 * u}px`, opacity: interpolate((t - pairStart) % perPair, [0, 14], [0, 1], clamp) }}>
          <div style={{ fontFamily: NEON, fontSize: 22 * u, color: N.magenta, letterSpacing: 4 * u }}>MESMO IDH · OUTRO PRATO</div>
          {[pair.low, pair.high].map((c) => (
            <div key={c.iso} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 16 * u, gap: 16 * u }}>
              <span style={{ fontFamily: NEON, fontWeight: 700, fontSize: (portrait ? 34 : 26) * u, color: N.ink }}>{caps(c.name)}</span>
              <span style={{ fontFamily: BODY, fontSize: 24 * u, color: N.dim, whiteSpace: "nowrap" }}>IDH {hdi(c.now)}</span>
              <span style={{ fontFamily: NEON, fontWeight: 900, fontSize: 44 * u, color: c.food! >= 30 ? N.red : N.cyan }}>{pct(c.food!)}</span>
            </div>
          ))}
        </Panel>
      ) : null}
    </>
  );
}

/** The last line, in the clean light of the future. */
export function Close() {
  const frame = useCurrentFrame();
  const { u, pad, portrait } = useLayout();
  const a = interpolate(frame, [F.close[0], F.close[0] + 20], [0, 1], { ...clamp, easing: easeOut });
  const b = interpolate(frame, [F.close[0] + 35, F.close[0] + 55], [0, 1], { ...clamp, easing: easeOut });
  return (
    <div style={{ position: "absolute", left: pad, right: pad, top: portrait ? 700 * u : 380 * u, textAlign: "center" }}>
      <div style={{ fontFamily: NEON, fontWeight: 700, fontSize: (portrait ? 64 : 72) * u, color: N.ink, opacity: a, lineHeight: 1.2 }}>
        O IDH mede médias.
      </div>
      <div style={{ fontFamily: NEON, fontWeight: 900, fontSize: (portrait ? 64 : 72) * u, color: N.cyan, filter: glow(N.cyan, 10), opacity: b, lineHeight: 1.2, marginTop: 20 * u }}>
        O prato mede quem ficou para trás.
      </div>
    </div>
  );
}
