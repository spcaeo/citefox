# CiteFox's own event sounds (check started, check done, problem), synthesised from sine waves
# here (no samples, no AI music), under the CiteFox Source-Available License (see NOTICE).
# All three sit in A major, the key of the welcome tour music, so they never clash with it.
# Run: python3 scripts/sounds/make_events.py (needs numpy); it writes the WAVs into
# src/renderer/src/assets/sounds/. The app ships WAV: an MP3 adds encoder silence at the start.
import numpy as np, wave, os

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'renderer', 'src', 'assets', 'sounds')
NOTES = {'C#': -8, 'E': -5, 'A': 0, 'B': 2, 'F#': -3}


def hz(name):
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTES[pitch] + (octave - 4) * 12) / 12)


def tone(f, dur, decay, partials):
    t = np.arange(int(SR * dur)) / SR
    y = sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t * decay * (1 + 0.5 * m)) for m, a in partials)
    return y * np.minimum(1, t / 0.004)  # a 4 ms attack: no click, and it starts at once


def soft(f, dur):
    return tone(f, dur, 5.0, [(1, 1.0), (2, 0.3)])


def bell(f, dur):
    return tone(f, dur, 2.2, [(1, 1.0), (2.0, 0.4), (3.01, 0.2), (4.2, 0.08)])


def mix(total, events):
    y = np.zeros(int(SR * total))
    for at, sig, gain in events:
        i = int(at * SR)
        sig = sig[: len(y) - i]
        y[i:i + len(sig)] += sig * gain
    return y


def save(y, name, peak=0.55):
    n = int(0.12 * SR)
    y[-n:] *= np.linspace(1, 0, n) ** 2
    y = y / np.max(np.abs(y)) * peak
    path = os.path.normpath(os.path.join(OUT, name + '.wav'))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((y * 32767).astype(np.int16).tobytes())
    print(path, round(len(y) / SR, 2), 's')


# Check started: two quick rising notes, E5 then A5. Short, so it never waits for the click.
save(mix(0.55, [(0.0, soft(hz('E5'), 0.4), 0.8), (0.11, soft(hz('A5'), 0.44), 1.0)]), 'check-started')

# Check done: a rising A major arpeggio that ends on a ringing A.
save(mix(1.5, [(0.0, bell(hz('A4'), 1.2), 0.8), (0.14, bell(hz('C#5'), 1.2), 0.8),
               (0.28, bell(hz('E5'), 1.2), 0.85), (0.42, bell(hz('A5'), 1.08), 1.0)]), 'check-done')

# Problem: two low, soft notes going down (E4 then B3), calm, never a buzzer.
save(mix(0.9, [(0.0, soft(hz('E4'), 0.6), 0.9), (0.2, soft(hz('B3'), 0.7), 1.0)]), 'check-problem', peak=0.45)
