"""Synthesizes the motions' sound effects and music bed, so nothing needs a licence.

    uv run --with numpy python motion/scripts/sons.py     (from the repository root)

Writes motion/public/sfx/*.wav (44.1 kHz, 16-bit, stereo):
- tick: a soft click, for counters and items coming in
- pop: a short rounded blip, for a mark appearing (the result's diamond)
- whoosh / swish: air moving, long and short, for transitions
- hit: a low, soft impact, for a reveal
- chime: a two-note bell, for a conclusion
- riser: a two-second swell into a reveal
- bed: a 32-second ambient loop (A minor, F, C, G), quiet and slow, for under the voice
- crt: an old TV powering on (a thump, then the line-output whine fading)
- vhs: a tape winding fast (a whirring motor with a rising pitch and flutter)
- blip: an 8-bit square-wave blip
- arp: a quick synth arpeggio rising an octave and a half
- hum: a soft electric neon hum, two seconds
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

RATE = 44100
OUT = Path(__file__).resolve().parents[1] / "public" / "sfx"
rng = np.random.default_rng(7)


def t(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * RATE)) / RATE


def lowpass(x: np.ndarray, cutoff: np.ndarray | float) -> np.ndarray:
    """One-pole low-pass; the cutoff may change sample by sample."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / RATE)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def envelope(n: int, attack: float, decay: float) -> np.ndarray:
    tt = np.arange(n) / RATE
    return np.minimum(1, tt / max(attack, 1e-4)) * np.exp(-np.maximum(0, tt - attack) / decay)


def save(name: str, mono: np.ndarray, width: float = 0.0, gain: float = 0.9) -> None:
    mono = mono / (np.max(np.abs(mono)) or 1) * gain
    # A little stereo: the right channel a few samples late.
    delay = int(width * RATE)
    right = np.concatenate([np.zeros(delay), mono])[: len(mono)] if delay else mono
    stereo = np.stack([mono, right], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    print(f"  {name}.wav {len(mono) / RATE:.2f}s")


def tick() -> np.ndarray:
    x = t(0.06)
    click = np.sin(2 * np.pi * 2400 * x) * np.exp(-x / 0.008)
    noise = lowpass(rng.standard_normal(len(x)), 5000) * np.exp(-x / 0.004)
    return click + 0.5 * noise


def pop() -> np.ndarray:
    x = t(0.25)
    freq = 760 * np.exp(-x / 0.08) + 320
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    return np.sin(phase) * envelope(len(x), 0.004, 0.07)


def whoosh(seconds: float) -> np.ndarray:
    x = t(seconds)
    shape = np.sin(np.pi * x / seconds) ** 2
    cutoff = 300 + 2600 * shape
    noise = lowpass(rng.standard_normal(len(x)), cutoff)
    return noise * shape


def hit() -> np.ndarray:
    x = t(1.4)
    freq = 90 * np.exp(-x / 0.25) + 42
    body = np.sin(2 * np.pi * np.cumsum(freq) / RATE) * envelope(len(x), 0.003, 0.45)
    thump = lowpass(rng.standard_normal(len(x)), 900) * envelope(len(x), 0.001, 0.05)
    return body + 0.6 * thump


def chime() -> np.ndarray:
    x = t(2.2)
    out = np.zeros_like(x)
    for f, start, level in ((880, 0.0, 1.0), (1318.5, 0.12, 0.8)):
        s = np.clip(x - start, 0, None)
        on = x >= start
        bell = np.sin(2 * np.pi * f * s) + 0.3 * np.sin(2 * np.pi * f * 2.76 * s)
        out += level * on * bell * np.exp(-s / 0.6)
    return out


def riser() -> np.ndarray:
    x = t(2.0)
    p = x / 2.0
    noise = lowpass(rng.standard_normal(len(x)), 200 + 5000 * p**2) * p**2
    tone = np.sin(2 * np.pi * np.cumsum(220 + 440 * p**2) / RATE) * 0.25 * p**3
    fade = np.minimum(1, (2.0 - x) / 0.03)
    return (noise + tone) * fade


def bed() -> np.ndarray:
    """Four chords of 8 s, soft detuned saws through a slow filter, a pulse underneath."""
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # Am F C G (MIDI)
    seconds = 8.0
    out = []
    for notes in chords:
        x = t(seconds)
        layer = np.zeros_like(x)
        for n in notes:
            f = 440 * 2 ** ((n - 69) / 12)
            for detune in (-0.12, 0.0, 0.11):
                ph = (f * (1 + detune / 100)) * x
                layer += 2 * (ph % 1) - 1  # saw
        cutoff = 500 + 300 * np.sin(np.pi * x / seconds)
        pad = lowpass(layer, cutoff)
        sub = np.sin(2 * np.pi * 440 * 2 ** ((notes[0] - 12 - 69) / 12) * x) * 0.6
        pulse = 0.5 + 0.5 * np.cos(2 * np.pi * x / 2.0)  # a slow breath every 2 s
        out.append((pad * 0.12 + sub * 0.25) * (0.75 + 0.25 * pulse))
    music = np.concatenate(out)
    # Seamless loop: the last 2 s are folded over the first 2 and cut, so the end runs into
    # the start without a seam.
    n = int(2 * RATE)
    fade = np.linspace(0, 1, n)
    music[:n] = music[:n] * fade + music[-n:] * (1 - fade)
    return music[:-n]


def crt() -> np.ndarray:
    x = t(1.6)
    thump = np.sin(2 * np.pi * 55 * x) * envelope(len(x), 0.002, 0.12)
    whine = np.sin(2 * np.pi * 15734 / 4 * x) * 0.15 * np.exp(-x / 0.5) * np.minimum(1, x / 0.05)
    crackle = lowpass(rng.standard_normal(len(x)), 3000) * envelope(len(x), 0.001, 0.08) * 0.6
    return thump + whine + crackle


def vhs() -> np.ndarray:
    x = t(2.4)
    p = x / 2.4
    freq = 90 + 160 * p + 6 * np.sin(2 * np.pi * 7 * x)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    motor = np.sin(phase) + 0.4 * np.sin(phase * 2.01)
    hiss = lowpass(rng.standard_normal(len(x)), 2500) * 0.35
    shape = np.minimum(1, x / 0.15) * np.minimum(1, (2.4 - x) / 0.2)
    return (motor * 0.6 + hiss) * shape


def square(freq: float, seconds: float) -> np.ndarray:
    x = t(seconds)
    return np.sign(np.sin(2 * np.pi * freq * x))


def blip() -> np.ndarray:
    a = square(988, 0.05) * 0.7
    b = square(1319, 0.08) * envelope(int(0.08 * RATE), 0.001, 0.05) * 0.7
    return np.concatenate([a, b])


def arp() -> np.ndarray:
    notes = [57, 60, 64, 69, 72, 76, 81]  # A minor, rising
    out = []
    for i, n in enumerate(notes):
        f = 440 * 2 ** ((n - 69) / 12)
        x = t(0.11 if i < len(notes) - 1 else 0.6)
        saw = 2 * ((f * x) % 1) - 1
        decay = 0.09 if i < len(notes) - 1 else 0.3
        out.append(lowpass(saw, 1800 + i * 500) * envelope(len(x), 0.004, decay))
    return np.concatenate(out)


def hum() -> np.ndarray:
    x = t(2.0)
    tone = np.sin(2 * np.pi * 60 * x) + 0.5 * np.sin(2 * np.pi * 120 * x) + 0.2 * np.sin(2 * np.pi * 180 * x)
    buzz = lowpass(rng.standard_normal(len(x)), 400) * 0.15
    return (tone + buzz) * np.minimum(1, np.minimum(x, 2.0 - x) / 0.3)


def main() -> None:
    save("tick", tick(), gain=0.5)
    save("pop", pop(), gain=0.6)
    save("whoosh", whoosh(0.9), width=0.004, gain=0.55)
    save("swish", whoosh(0.35), width=0.003, gain=0.45)
    save("hit", hit(), gain=0.8)
    save("chime", chime(), width=0.006, gain=0.5)
    save("riser", riser(), width=0.004, gain=0.55)
    save("bed", bed(), width=0.012, gain=0.7)
    # Added after the others, so their random noise (and files) stay the same.
    save("crt", crt(), width=0.003, gain=0.5)
    save("vhs", vhs(), width=0.004, gain=0.45)
    save("blip", blip(), gain=0.35)
    save("arp", arp(), width=0.006, gain=0.45)
    save("hum", hum(), width=0.002, gain=0.3)


if __name__ == "__main__":
    main()
