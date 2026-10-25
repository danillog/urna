/**
 * 6:00 · O que isso não significa. A neutral ground and few words: error is not fraud; a
 * poll is a picture of a moment; polls miss everywhere; and the two prints that get
 * forwarded, calmly crossed out.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { DISPLAY, T } from "../../common/theme";
import { Reveal, Scene, at, clamp, easeInOut, easeOut, type SceneProps } from "../kit";
import { Sfx } from "../sound";

const B = {
  fraud: 0.03,
  manipulation: 0.14,
  moment: 0.27,
  world: 0.5,
  prints: 0.66,
  strike: 0.8,
  close: 0.86,
};

export function NaoSignifica({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (k: keyof typeof B) => at(duration, B[k]);
  // Part 1 (≠) leaves for part 2; part 2 for part 3; and so on.
  const part = (from: number, to: number) =>
    Math.min(
      interpolate(frame, [from, from + 16], [0, 1], { ...clamp, easing: easeOut }),
      interpolate(frame, [to - 14, to], [1, 0], clamp),
    );
  const ne = part(f("fraud"), f("moment"));
  const moment = part(f("moment"), f("world"));
  const world = part(f("world"), f("prints"));
  const prints = part(f("prints"), duration + 30);

  return (
    <Scene chapter="O que isso não significa">
      {/* erro ≠ fraude, erro ≠ manipulação */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 300, textAlign: "center", opacity: ne }}>
        <Neq word="fraude" />
        <div
          style={{
            opacity: interpolate(frame, [f("manipulation"), f("manipulation") + 14], [0, 1], clamp),
            marginTop: 20,
          }}
        >
          <Neq word="manipulação" />
        </div>
      </div>
      <Sfx name="hit" at={f("fraud")} volume={0.35} />
      <Sfx name="swish" at={f("manipulation")} volume={0.25} />

      {/* A picture of a moment. */}
      <div style={{ position: "absolute", left: 160, right: 160, top: 250, opacity: moment }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 96, lineHeight: 1.05 }}>
          Pesquisa é um retrato de um momento,
          <br />
          <span style={{ color: T.ink2 }}>com margem de erro.</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 40, marginTop: 70 }}>
          <Figure big="alguns milhares" small="de entrevistas" />
          <span style={{ fontSize: 60, color: T.muted }}>→</span>
          <Figure big="mais de 150 milhões" small="de eleitores" />
        </div>
      </div>
      <Sfx name="swish" at={f("moment")} volume={0.25} />

      {/* Everywhere. */}
      <div style={{ position: "absolute", left: 160, right: 160, top: 330, opacity: world }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 96, lineHeight: 1.05 }}>
          Pesquisas erram
          {["nos Estados Unidos,", "no Reino Unido,", "em qualquer lugar."].map((w, k) => (
            <span
              key={w}
              style={{
                display: "block",
                color: k === 2 ? T.ink : T.ink2,
                opacity: interpolate(frame, [f("world") + 20 + k * 40, f("world") + 34 + k * 40], [0, 1], clamp),
              }}
            >
              {w}
            </span>
          ))}
        </div>
        <div
          style={{
            fontSize: 34,
            color: T.ink2,
            marginTop: 40,
            opacity: interpolate(frame, [f("world") + 150, f("world") + 166], [0, 1], clamp),
          }}
        >
          O que importa: o erro tem lado? E o instituto corrige o método depois?
        </div>
      </div>
      <Sfx name="swish" at={f("world")} volume={0.25} />

      {/* The two prints. */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 230, opacity: prints }}>
        <Bubble text="é tudo comprado" left={360} top={0} appear={f("prints")} strike={f("strike")} />
        <Bubble text="a pesquisa já decidiu a eleição" left={760} top={190} appear={f("prints") + 40} strike={f("strike") + 24} />
      </div>
      <Sfx name="pop" at={f("prints")} volume={0.3} />
      <Sfx name="pop" at={f("prints") + 40} volume={0.3} />
      <Sfx name="tick" at={f("strike")} volume={0.3} />
      <Sfx name="tick" at={f("strike") + 24} volume={0.3} />
      <Reveal duration={duration} from={B.close} style={{ position: "absolute", left: 0, right: 0, top: 760, textAlign: "center" }}>
        <div style={{ fontSize: 44 }}>
          Um erro de pesquisa, sozinho, <b>não prova nenhuma das duas.</b>
        </div>
      </Reveal>
    </Scene>
  );
}

function Neq({ word }: { word: string }) {
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 170, lineHeight: 1.05 }}>
      erro <span style={{ color: T.muted }}>≠</span> {word}
    </div>
  );
}

function Figure({ big, small }: { big: string; small: string }) {
  return (
    <div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 72, lineHeight: 1 }}>{big}</div>
      <div style={{ fontSize: 30, color: T.ink2, marginTop: 8 }}>{small}</div>
    </div>
  );
}

/** A forwarded message, then a calm line through it. */
function Bubble({ text, left, top, appear, strike }: { text: string; left: number; top: number; appear: number; strike: number }) {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [appear, appear + 14], [0, 1], { ...clamp, easing: easeOut });
  const line = interpolate(frame, [strike, strike + 22], [0, 1], { ...clamp, easing: easeInOut });
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        opacity: inP * (1 - 0.45 * line),
        transform: `scale(${0.92 + 0.08 * inP})`,
        transformOrigin: "left center",
      }}
    >
      <div style={{ fontSize: 22, color: T.muted, marginBottom: 8 }}>Encaminhada</div>
      <div
        style={{
          position: "relative",
          background: "#23272d",
          borderRadius: "22px 22px 22px 6px",
          padding: "26px 36px",
          fontSize: 50,
          whiteSpace: "nowrap",
        }}
      >
        “{text}”
        <div
          style={{
            position: "absolute",
            left: 24,
            top: "52%",
            height: 4,
            width: `calc(${line} * (100% - 48px))`,
            background: T.ink2,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}
