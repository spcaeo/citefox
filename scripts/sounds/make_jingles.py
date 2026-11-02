# CiteFox's own celebration sounds, synthesised from sine waves here (no samples), under the CiteFox Source-Available License (see NOTICE).
# Run: python3 scripts/sounds/make_jingles.py (needs numpy), then
#   cp scripts/sounds/cited-soft-sparkle.wav src/renderer/src/assets/sounds/
# The app ships the WAV: an MP3 adds encoder silence at the start.
# The app plays cited-soft-sparkle (block 4b); the others are the alternatives the owner compared.
import numpy as np, wave, sys, os

SR = 44100
OUT = os.path.dirname(os.path.abspath(__file__))


def note(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[pitch] + (octave - 4) * 12) / 12)


def t_of(dur):
    return np.arange(int(SR * dur)) / SR


def bell(f, dur, decay=1.6):
    t = t_of(dur)
    parts = [(1, 1.0), (2.0, 0.45), (3.01, 0.25), (4.2, 0.12), (5.43, 0.08)]
    y = sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t * decay * (1 + m * 0.6)) for m, a in parts)
    return y * np.minimum(1, t / 0.003)


def marimba(f, dur, decay=7.0):
    t = t_of(dur)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * decay) + 0.3 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * decay * 3)
    return y * np.minimum(1, t / 0.002)


def brass(f, dur, vib=True):
    t = t_of(dur)
    fm = f * (1 + (0.006 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.25) if vib else 0))
    phase = 2 * np.pi * np.cumsum(fm) / SR
    bright = np.minimum(1, t / 0.06) * 0.7 + 0.3
    y = sum((bright ** (k - 1)) * np.sin(k * phase) / k for k in range(1, 9))
    env = np.minimum(1, t / 0.03) * np.where(t > dur - 0.08, np.maximum(0, (dur - t) / 0.08), 1)
    return y * env * 0.6


def pad(freqs, dur, attack=0.4):
    t = t_of(dur)
    y = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.003 * t) for f in freqs)
    return y * np.minimum(1, t / attack) * np.exp(-t * 0.9)


def sparkle(dur, seed=1, density=18):
    rng = np.random.default_rng(seed)
    y = np.zeros(int(SR * dur))
    for _ in range(int(density * dur)):
        start = rng.uniform(0, dur - 0.3)
        f = rng.uniform(2200, 5200)
        s = bell(f, 0.3, decay=9) * rng.uniform(0.05, 0.15)
        i = int(start * SR)
        y[i:i + len(s)] += s
    return y


def mix(total, events):
    y = np.zeros(int(SR * total))
    for at, sig, gain in events:
        i = int(at * SR)
        sig = sig[: len(y) - i]
        y[i:i + len(sig)] += sig * gain
    return y


def reverb(y, mix_amt=0.18):
    out = y.copy()
    for d, g in [(0.031, 0.5), (0.047, 0.4), (0.071, 0.33), (0.113, 0.25), (0.167, 0.18), (0.241, 0.12)]:
        k = int(d * SR)
        out[k:] += y[:-k] * g * mix_amt * 2
    return out


def finish(y, name, fade=0.6):
    y = reverb(y)
    n = int(fade * SR)
    y[-n:] *= np.linspace(1, 0, n) ** 2
    y = y / np.max(np.abs(y)) * 0.7
    pcm = (y * 32767).astype(np.int16)
    path = os.path.join(OUT, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print(path, round(len(y) / SR, 2), 's')


# 1. Bright bells: rising arpeggio into a ringing chord with sparkle.
arp = ['C5', 'E5', 'G5', 'C6']
ev = [(i * 0.11, bell(note(n), 2.5), 0.8) for i, n in enumerate(arp)]
ev += [(0.5, bell(note(n), 2.6, 1.1), 0.5) for n in ['C5', 'E5', 'G5', 'C6', 'E6']]
ev += [(0.45, sparkle(2.4), 1.0)]
finish(mix(3.2, ev), '1-bright-bells')

# 2. Marimba ta-da: quick run up, then a happy two-chord hit.
run = ['G4', 'A4', 'B4', 'D5', 'E5', 'G5']
ev = [(i * 0.07, marimba(note(n), 0.6), 0.7) for i, n in enumerate(run)]
ev += [(0.5, marimba(note(n), 1.0, 5), 0.55) for n in ['D5', 'F#5', 'A5']]
ev += [(0.78, marimba(note(n), 1.8, 3), 0.6) for n in ['G4', 'B4', 'D5', 'G5']]
ev += [(0.78, bell(note('G6'), 1.6, 2.5), 0.25)]
finish(mix(2.8, ev), '2-marimba-tada')

# 3. Little brass fanfare: ta-ta-ta-TAAA.
ev = [(0.0, brass(note('G4'), 0.14, False), 0.6), (0.17, brass(note('G4'), 0.14, False), 0.6),
      (0.34, brass(note('G4'), 0.14, False), 0.6)]
ev += [(0.52, brass(note(n), 1.9), 0.55) for n in ['C5', 'E5', 'G5']]
ev += [(0.52, pad([note('C3'), note('G3')], 2.2), 0.25), (0.55, sparkle(2.0, 3, 10), 0.8)]
finish(mix(3.2, ev), '3-brass-fanfare', fade=0.9)

# 4. Soft sparkle chime: gentle twinkles over a warm pad, calm and classy.
ev = [(0.0, pad([note('F3'), note('A3'), note('C4'), note('E4')], 3.2), 0.35)]
mel = ['C6', 'A5', 'F5', 'C6', 'E6']
ev += [(0.1 + i * 0.16, bell(note(n), 2.0, 2.0), 0.55) for i, n in enumerate(mel)]
ev += [(0.2, sparkle(2.8, 7, 14), 0.9)]
finish(mix(3.4, ev), '4-soft-sparkle', fade=1.0)

# 4b. Soft sparkle, one second longer (owner's pick, 2026-10-29): same melody, longer glow.
# It starts on the first sample (owner: "it starts pretty late"): the first chime and a
# quick pad attack land with the card, not 0.1-0.4 s after it.
ev = [(0.0, pad([note('F3'), note('A3'), note('C4'), note('E4')], 4.4, attack=0.03), 0.35)]
ev += [(i * 0.16, bell(note(n), 2.6, 1.6), 0.55) for i, n in enumerate(mel)]
ev += [(1.0, bell(note('A6'), 2.4, 2.2), 0.18)]
ev += [(0.05, sparkle(3.8, 7, 14), 0.9)]
finish(mix(4.4, ev), 'cited-soft-sparkle', fade=1.4)
