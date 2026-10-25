import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";

/** The effects synthesized by scripts/sons.py (public/sfx/). */
export type SfxName = "tick" | "pop" | "whoosh" | "swish" | "hit" | "chime" | "riser" | "crt" | "vhs" | "blip" | "arp" | "hum";

/** One sound effect at a frame of the scene it is placed in. Quiet by default: the voice comes on top. */
export function Sfx({ name, at, volume = 0.5 }: { name: SfxName; at: number; volume?: number }) {
  return (
    <Sequence from={Math.max(0, Math.round(at))} layout="none" name={`sfx:${name}`}>
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  );
}

/** The music bed, looped under the whole video, fading in and out. */
export function Bed({ volume = 0.16 }: { volume?: number }) {
  const { durationInFrames, fps } = useVideoConfig();
  return (
    <Audio
      src={staticFile("sfx/bed.wav")}
      loop
      volume={(f) =>
        volume *
        interpolate(f, [0, fps * 2, durationInFrames - fps * 3, durationInFrames], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
  );
}
