/**
 * 7:40 · Fechamento. The Urna in a browser window (the site's own poll chart, 2026's 1st
 * round, drawing itself), the address typed in; "Dados e código abertos"; the Gomes Code card.
 */
import { interpolate, Sequence, useCurrentFrame } from "remotion";
import { DISPLAY, T } from "../../common/theme";
import { Election, prepare } from "../../pesquisas";
import { Scene, at, clamp, easeInOut, easeOut, type SceneProps } from "../kit";
import { Sfx } from "../sound";

const URL = "danillogomes.com/urna";
const B = { type: 0.04, typed: 0.2, chart: 0.12, open: 0.52, card: 0.74 };
const SCALE = 0.6;
const BAR = 64;

export function Fechamento({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (k: keyof typeof B) => at(duration, B[k]);
  const chars = Math.round(interpolate(frame, [f("type"), f("typed")], [0, URL.length], clamp));
  const winIn = interpolate(frame, [0, 16], [0, 1], { ...clamp, easing: easeOut });
  const side = interpolate(frame, [f("open"), f("open") + 24], [0, 1], { ...clamp, easing: easeInOut });
  const card = interpolate(frame, [f("card"), f("card") + 20], [0, 1], { ...clamp, easing: easeOut });
  const p = prepare(2026, "r1");

  const w = 1920 * SCALE;
  const h = 1080 * SCALE;
  const left = (1920 - w) / 2 - side * ((1920 - w) / 2 - 72);
  const top = 140;
  const typeTicks = Array.from({ length: URL.length }, (_, k) =>
    Math.round(f("type") + ((f("typed") - f("type")) * (k + 0.5)) / URL.length),
  ).filter((_, k) => k % 2 === 0);

  return (
    <Scene>
      <div style={{ opacity: 1 - card }}>
        {/* The browser window. */}
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: w,
            height: h + BAR,
            borderRadius: 14,
            overflow: "hidden",
            border: `1px solid ${T.rule}`,
            background: T.bg,
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
            opacity: winIn,
            transform: `translateY(${(1 - winIn) * 30}px)`,
          }}
        >
          <div style={{ height: BAR, background: "#1b1e22", display: "flex", alignItems: "center", gap: 10, padding: "0 22px" }}>
            {["#e0453f", "#c98500", "#199e70"].map((c) => (
              <i key={c} style={{ width: 14, height: 14, borderRadius: "50%", background: c, opacity: 0.8 }} />
            ))}
            <div
              style={{
                marginLeft: 22,
                flex: 1,
                height: 38,
                borderRadius: 19,
                background: T.bg,
                display: "flex",
                alignItems: "center",
                padding: "0 20px",
                fontSize: 22,
                color: T.ink2,
              }}
            >
              {URL.slice(0, chars)}
              <span style={{ opacity: chars < URL.length && Math.floor(frame / 15) % 2 === 0 ? 1 : 0 }}>|</span>
            </div>
          </div>
          {/* The page, drawn at full size and scaled into the window. */}
          <div style={{ position: "relative", width: 1920, height: 1080, transform: `scale(${SCALE})`, transformOrigin: "0 0" }}>
            <div style={{ position: "absolute", left: 72, top: 60 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 26, letterSpacing: 3, color: T.muted }}>URNA</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64, marginTop: 6 }}>Pesquisas eleitorais 2026</div>
              <div style={{ fontSize: 26, color: T.ink2, marginTop: 10 }}>
                Presidente, 1º turno · cada pesquisa registrada e a média
              </div>
            </div>
            {p ? (
              <Sequence from={f("chart")} layout="none">
                <Election p={p} hold={duration * 4} />
              </Sequence>
            ) : null}
          </div>
        </div>

        {/* Open data, beside the window. */}
        <div
          style={{
            position: "absolute",
            left: 72 + w + 70,
            right: 72,
            top: 330,
            opacity: side,
            transform: `translateX(${(1 - side) * 40}px)`,
          }}
        >
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64, lineHeight: 1.05 }}>Dados e código abertos</div>
          <div style={{ fontSize: 28, color: T.ink2, marginTop: 20, lineHeight: 1.4 }}>
            Exclua institutos, troque de eleição e tire as suas conclusões.
          </div>
          <div style={{ fontSize: 30, marginTop: 30, fontWeight: 600 }}>{URL}</div>
        </div>
      </div>
      {typeTicks.map((t, k) => (
        <Sfx key={k} name="tick" at={t} volume={0.18} />
      ))}
      <Sfx name="swish" at={f("open")} volume={0.25} />

      {/* Gomes Code. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          // Above the scene's corner tag: the card stands on its own.
          zIndex: 1,
          background: T.bg,
          opacity: card,
          transform: `scale(${0.96 + 0.04 * card})`,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 150, lineHeight: 1 }}>Gomes Code</div>
        <div style={{ fontSize: 40, color: T.ink2, marginTop: 24 }}>dados que viram história</div>
        <div style={{ fontSize: 26, color: T.muted, marginTop: 60 }}>{URL}</div>
      </div>
      <Sfx name="chime" at={f("card")} volume={0.4} />
    </Scene>
  );
}
