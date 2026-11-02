# CiteFox product video music: an original, calm, upbeat instrumental, synthesised
# here from sine waves and noise (no samples, no loops from anywhere else), under the
# CiteFox Source-Available License with the rest of the project (see NOTICE).
#
# It follows the video's beat grid (scripts/media/video/timeline.json): 100 BPM, one
# chord per bar, I-V-vi-IV in D major with add9 colour. Soft pads and a plucked
# arpeggio carry the hook; a light kick, rim and shaker join with the first product
# scene; the engines strip lifts; the end card resolves on D and rings out.
#
# Run: uv run --with numpy python scripts/media/make-music.py   (or python3 with numpy)
# Writes media/demo-music.wav, then media/demo-music.m4a at -16 LUFS with ffmpeg.
import json, os, subprocess, sys, wave
import numpy as np

SR = 44100
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TIMELINE = json.load(open(os.path.join(ROOT, 'scripts/media/video/timeline.json')))
BPM = TIMELINE['bpm']
BEAT = 60 / BPM
SCENES = TIMELINE['scenes']
STARTS = {}
t = 0
for s in SCENES:
    STARTS[s['id']] = t
    t += s['beats'] * BEAT
TOTAL = t
N = int(TOTAL * SR) + SR

rng = np.random.default_rng(7)


def freq(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    return 440.0 * 2 ** ((names[name[:-1]] + (int(name[-1]) - 4) * 12) / 12)


def tt(dur):
    return np.arange(int(SR * dur)) / SR


def adsr(n, a, d, s, r):
    env = np.ones(n) * s
    ia, idd, ir = int(a * SR), int(d * SR), int(r * SR)
    ia = min(ia, n)
    env[:ia] = np.linspace(0, 1, ia, endpoint=False)
    end_d = min(n, ia + idd)
    env[ia:end_d] = np.linspace(1, s, end_d - ia, endpoint=False)
    if ir > 0 and n > ir:
        env[-ir:] *= np.linspace(1, 0, ir) ** 1.5
    return env


def lowpass_fast(y, cutoff):
    # FFT brick-ish low-pass with a soft knee, for long signals.
    spec = np.fft.rfft(y)
    f = np.fft.rfftfreq(len(y), 1 / SR)
    spec *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(spec, len(y))


def pad_voice(f, dur, detune=0.0035):
    x = tt(dur)
    y = np.zeros_like(x)
    for d, g in [(-detune, 0.5), (0, 0.7), (detune, 0.5)]:
        ph = 2 * np.pi * f * (1 + d) * x + rng.uniform(0, 6.28)
        # A soft saw: a few decaying harmonics.
        y += g * sum(np.sin(k * ph) / k ** 1.6 for k in range(1, 7))
    return y


def pluck(f, dur=0.9):
    x = tt(dur)
    y = sum(np.sin(2 * np.pi * f * k * x) * np.exp(-x * (5 + 3.5 * k)) / k for k in range(1, 6))
    return y * np.minimum(1, x / 0.004)


def bell(f, dur=1.6):
    x = tt(dur)
    y = sum(a * np.sin(2 * np.pi * f * m * x) * np.exp(-x * (2.2 + m)) for m, a in [(1, 1), (2.01, 0.35), (3.98, 0.12)])
    return y * np.minimum(1, x / 0.003)


def kick():
    x = tt(0.42)
    f = 46 + 70 * np.exp(-x * 30)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 9)
    return y * np.minimum(1, x / 0.002)


def rim():
    x = tt(0.12)
    noise = rng.standard_normal(len(x))
    tone = np.sin(2 * np.pi * 1750 * x) * 0.5
    return (np.diff(noise, prepend=0) * 0.35 + tone) * np.exp(-x * 55)


def shaker():
    x = tt(0.09)
    noise = np.diff(np.diff(rng.standard_normal(len(x)), prepend=0), prepend=0)
    return noise * np.exp(-x * 60) * np.minimum(1, x / 0.01)


def put(buf, at, sig, gain, pan=0.0):
    i = int(at * SR)
    if i >= buf.shape[1]:
        return
    sig = sig[: buf.shape[1] - i]
    left = np.cos((pan + 1) * np.pi / 4)
    right = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + len(sig)] += sig * gain * left
    buf[1, i:i + len(sig)] += sig * gain * right


# D major: I - V - vi - IV, voiced close and warm, with the 9th on top.
CHORDS = [
    (['D3', 'A3', 'D4', 'F#4', 'E5'], 'D2', ['D4', 'F#4', 'A4', 'E5', 'A4', 'F#4', 'D5', 'A4']),
    (['A2', 'E3', 'A3', 'C#4', 'B4'], 'A1', ['C#4', 'E4', 'A4', 'B4', 'A4', 'E4', 'C#5', 'A4']),
    (['B2', 'F#3', 'B3', 'D4', 'C#5'], 'B1', ['D4', 'F#4', 'B4', 'C#5', 'B4', 'F#4', 'D5', 'B4']),
    (['G2', 'D3', 'G3', 'B3', 'A4'], 'G1', ['B3', 'D4', 'G4', 'A4', 'G4', 'D4', 'B4', 'G4']),
]

pads = np.zeros((2, N))
keys = np.zeros((2, N))
bass = np.zeros((2, N))
drums = np.zeros((2, N))

BAR = 4 * BEAT
bars = int(np.ceil(TOTAL / BAR))
groove_from = STARTS['summary']
lift_from = STARTS['engines']
end_from = STARTS['end']

for b in range(bars):
    at = b * BAR
    final = at >= end_from
    chord, root, arp = CHORDS[0] if final else CHORDS[b % 4]
    dur = (TOTAL - at + 2.5) if final else BAR + 0.6
    for n in chord:
        v = pad_voice(freq(n), dur)
        v *= adsr(len(v), 0.55 if b else 1.4, 0.4, 0.8, 0.9 if not final else 3.0)
        put(pads, at, v, 0.055, pan=rng.uniform(-0.5, 0.5))
    # Bass: root on beat 1, softer on beat 3 (and the 5th on the "and" of 4 in the groove).
    if at >= groove_from - 0.01 and not final:
        for beat, g in [(0, 1.0), (2, 0.7)]:
            x = tt(BEAT * 1.6)
            y = np.sin(2 * np.pi * freq(root) * x) + 0.25 * np.sin(4 * np.pi * freq(root) * x)
            put(bass, at + beat * BEAT, y * adsr(len(x), 0.01, 0.3, 0.6, 0.25), 0.33 * g)
    elif final:
        x = tt(dur)
        y = np.sin(2 * np.pi * freq('D2') * x)
        put(bass, at, y * adsr(len(x), 0.02, 0.6, 0.5, 2.5), 0.3)
    # Plucked arpeggio in eighths; sparse during the hook, full after.
    if not final:
        for i, n in enumerate(arp):
            if at < groove_from and i % 2:
                continue
            g = 0.16 if at >= groove_from else 0.12
            put(keys, at + i * BEAT / 2, pluck(freq(n)), g * (1.0 if i % 4 == 0 else 0.8), pan=0.35 if i % 2 else -0.35)
    else:
        for i, n in enumerate(['D5', 'F#5', 'A5', 'E6']):
            put(keys, at + i * BEAT * 0.5, bell(freq(n), 3.0), 0.14, pan=(-0.4, 0.2, 0.4, -0.2)[i])

# A bell on each scene change, so every caption lands on something.
for s in SCENES[1:-1]:
    put(keys, STARTS[s['id']], bell(freq('A5'), 1.4), 0.07, pan=0.2)

# Drums: from the first product scene to the end card; the engines strip doubles the shaker.
beat_count = int(TOTAL / BEAT)
for k in range(beat_count):
    at = k * BEAT
    if at < groove_from - 0.01 or at >= end_from:
        continue
    if k % 4 in (0, 2) or (k % 4 == 3 and at >= lift_from):
        put(drums, at, kick(), 0.5)
    if k % 4 in (1, 3):
        put(drums, at, rim(), 0.12, pan=0.15)
    # Shaker: eighths in the groove (the offbeat louder), sixteenths in the lift.
    split = 2 if at < lift_from else 4
    for h in range(split):
        put(drums, at + h * BEAT / split, shaker(), 0.07 if h % 2 else 0.04, pan=-0.3)

pads[0] = lowpass_fast(pads[0], 2400)
pads[1] = lowpass_fast(pads[1], 2400)

# Sidechain-ish breathing: the pads dip a little under each kick in the groove.
duck = np.ones(N)
for k in range(beat_count):
    at = k * BEAT
    if groove_from <= at < end_from and k % 2 == 0:
        i = int(at * SR)
        x = tt(BEAT)
        seg = 1 - 0.28 * np.exp(-x * 9)
        duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], seg[: N - i])
pads *= duck

mix = pads + keys * 1.0 + bass + drums


def reverb(y):
    # Convolution with a short, dark, decaying noise tail (about 2.2 s).
    n = int(2.2 * SR)
    x = np.arange(n) / SR
    out = np.zeros_like(y)
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-x * 3.2)
        ir = lowpass_fast(ir, 3500)
        ir /= np.sqrt(np.sum(ir ** 2))
        size = len(y[c]) + n
        nfft = 1 << (size - 1).bit_length()
        wet = np.fft.irfft(np.fft.rfft(y[c], nfft) * np.fft.rfft(ir, nfft), nfft)[: len(y[c])]
        out[c] = wet
    return out


mix = mix + reverb(keys + pads * 0.6) * 0.32
# Fade in over 1.2 s, out over the last 3 s of the video.
fade_in = int(1.2 * SR)
mix[:, :fade_in] *= np.linspace(0, 1, fade_in) ** 2
end = int(TOTAL * SR)
fade_out = int(3.0 * SR)
mix[:, end - fade_out:end] *= np.linspace(1, 0, fade_out) ** 1.6
mix = mix[:, :end]
mix /= np.max(np.abs(mix)) / 0.8
mix = np.tanh(mix * 1.1) / np.tanh(1.1)

media = os.path.join(ROOT, 'media')
wav = os.path.join(media, 'demo-music.wav')
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(wav, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(wav, round(TOTAL, 2), 's')

# -16 LUFS integrated, -1.5 dBTP, two-pass loudnorm, AAC 160k.
m4a = os.path.join(media, 'demo-music.m4a')
probe = subprocess.run(
    ['ffmpeg', '-hide_banner', '-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    capture_output=True, text=True,
)
key = probe.stderr.index('"input_i"')
stats = json.loads(probe.stderr[probe.stderr.rindex('{', 0, key):probe.stderr.index('}', key) + 1])
af = (
    'loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:'
    f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
    f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}"
)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', m4a], check=True)
os.remove(wav)
print(m4a)
