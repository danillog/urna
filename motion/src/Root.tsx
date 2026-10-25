import { Composition } from "remotion";
import { FPS, SIZE } from "./common/registry";
import { MOTIONS } from "./motions";

export function Root() {
  return (
    <>
      {MOTIONS.flatMap((m) =>
        m.formats.map((format) => (
          <Composition
            key={`${m.id}-${format}`}
            id={format === m.formats[0] ? m.id : `${m.id}-${format === "landscape" ? "horizontal" : "vertical"}`}
            component={m.component}
            defaultProps={m.defaultProps}
            fps={FPS}
            {...SIZE[format]}
            durationInFrames={m.durationInFrames(m.defaultProps)}
            calculateMetadata={({ props }) => ({ durationInFrames: m.durationInFrames(props) })}
          />
        )),
      )}
    </>
  );
}
