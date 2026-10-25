import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { DISPLAY } from "../src/common/theme";
import { FPS, SIZE, type Format } from "../src/common/registry";
import { MOTIONS } from "../src/motions";

/** ?m=Mapa&f=portrait&house=senate: the address keeps the selection, so a link opens it. */
function readSearch() {
  const q = new URLSearchParams(location.search);
  const motion = MOTIONS.find((m) => m.id === q.get("m")) ?? MOTIONS[0]!;
  const asked = q.get("f") as Format | null;
  const format: Format = asked && motion.formats.includes(asked) ? asked : motion.formats[0]!;
  const props = { ...motion.defaultProps };
  for (const c of motion.controls ?? []) {
    const v = q.get(c.prop);
    const opt = c.options.find((o) => String(o.value) === v);
    if (opt) props[c.prop] = opt.value;
  }
  return { id: motion.id, format, props };
}

const chip = (on: boolean): CSSProperties => ({
  font: "500 14px/1 inherit",
  padding: "8px 12px",
  borderRadius: 999,
  border: `1px solid ${on ? "var(--ink)" : "var(--rule)"}`,
  background: on ? "var(--ink)" : "transparent",
  color: on ? "var(--bg)" : "var(--ink-2)",
  cursor: "pointer",
});

function App() {
  const initial = useMemo(readSearch, []);
  const [id, setId] = useState(initial.id);
  const [format, setFormat] = useState<Format>(initial.format);
  const [props, setProps] = useState<Record<string, unknown>>(initial.props);
  const player = useRef<PlayerRef>(null);
  const motion = MOTIONS.find((m) => m.id === id)!;
  const size = SIZE[format];
  const duration = motion.durationInFrames(props);

  useEffect(() => {
    const q = new URLSearchParams({ m: id });
    if (format !== motion.formats[0]) q.set("f", format);
    for (const c of motion.controls ?? []) {
      if (props[c.prop] !== motion.defaultProps[c.prop]) q.set(c.prop, String(props[c.prop]));
    }
    history.replaceState(null, "", `?${q}`);
  }, [id, format, props, motion]);

  const pick = (next: string) => {
    const m = MOTIONS.find((x) => x.id === next)!;
    setId(next);
    setProps({ ...m.defaultProps });
    setFormat(m.formats[0]!);
  };

  const portrait = format === "portrait";
  return (
    <>
      <header style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, letterSpacing: 3, color: "var(--muted)" }}>URNA</div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 44, lineHeight: 1.05, margin: "4px 0 8px" }}>
          Em movimento
        </h1>
        <p style={{ margin: 0, color: "var(--ink-2)", maxWidth: 720 }}>
          Seis histórias contadas com os dados do Urna. Dê play, arraste a linha do tempo para parar em qualquer
          momento e troque o recorte nos botões.
        </p>
      </header>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }} aria-label="Motions">
        {MOTIONS.map((m) => (
          <button key={m.id} style={chip(m.id === id)} onClick={() => pick(m.id)} aria-pressed={m.id === id}>
            {m.title}
          </button>
        ))}
      </nav>

      <section>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, margin: "0 0 4px" }}>{motion.title}</h2>
        <p style={{ margin: "0 0 16px", color: "var(--ink-2)" }}>{motion.description}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 16, alignItems: "center" }}>
          {motion.formats.length > 1 ? (
            <Group label="Formato">
              {motion.formats.map((f) => (
                <button key={f} style={chip(f === format)} onClick={() => setFormat(f)} aria-pressed={f === format}>
                  {f === "landscape" ? "Horizontal 16:9" : "Reels 9:16"}
                </button>
              ))}
            </Group>
          ) : null}
          {(motion.controls ?? []).map((c) => (
            <Group key={c.prop} label={c.label}>
              {c.options.map((o) => {
                const on = props[c.prop] === o.value;
                return (
                  <button
                    key={String(o.value)}
                    style={chip(on)}
                    aria-pressed={on}
                    onClick={() => {
                      setProps({ ...props, [c.prop]: o.value });
                      player.current?.seekTo(0);
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </Group>
          ))}
        </div>

        <div
          style={{
            width: "100%",
            maxWidth: portrait ? 460 : undefined,
            margin: portrait ? "0 auto" : undefined,
            border: "1px solid var(--rule)",
            borderRadius: 8,
            overflow: "hidden",
            background: "var(--surface)",
          }}
        >
          <Player
            key={`${id}-${format}`}
            ref={player}
            component={motion.component}
            inputProps={props}
            durationInFrames={duration}
            fps={FPS}
            compositionWidth={size.width}
            compositionHeight={size.height}
            style={{ width: "100%" }}
            controls
            loop={motion.loop ?? false}
            autoPlay={motion.loop ?? false}
            clickToPlay
            doubleClickToFullscreen
            spaceKeyToPlayOrPause
          />
        </div>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 12 }}>
          Para gerar o vídeo: <code>npx remotion render src/index.ts {format === motion.formats[0] ? id : `${id}-${portrait ? "vertical" : "horizontal"}`}</code>
          {Object.keys(props).length ? (
            <>
              {" "}
              <code>--props='{JSON.stringify(props)}'</code>
            </>
          ) : null}
        </p>
      </section>
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "var(--muted)", marginRight: 4 }}>{label}</span>
      {children}
    </div>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
