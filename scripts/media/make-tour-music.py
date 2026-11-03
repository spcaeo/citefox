# CiteFox welcome-tour music: an original instrumental, synthesised here from sine waves
# and noise (no samples, no loops, no AI music, nothing copied or imitated from any other
# product), under the CiteFox Source-Available License with the rest of the project.
#
# 96 BPM, A major, 18 bars = exactly 45 s, on the beat grid in scripts/media/video/tour.json.
# Chords (one a bar, with add9 colour): A E F#m D | A D E A | E F#m D A | E F#m D E | A A.
# The shape follows the film:
#   0-2 s      quiet swell (pad), the first notes at 0.8 s
#   2-10 s     pad and sparse plucks (the hook and the added questions)
#   10-13.5 s  bass, a soft kick, a rim and a shaker join (the check starts)
#   13.5-16.6  a 7 dB dip: pads and a few plucks only, for the silent counting beat
#   17.5 s     a 5 dB step up and a bell: the result is cited
#   40 s       the low end is cut and a small bloom of bells; a last open fifth
#   42.5-45 s  fades out
#
# Run: uv run --with numpy python scripts/media/make-tour-music.py [out.m4a]
# (or python3 with numpy). Writes AAC 96 kbps stereo 48 kHz to `out.m4a` (default
# media/tour-music.m4a), loudness about -23 LUFS integrated, sample peak at or below -6 dBFS.
import json, os, re, subprocess, sys, tempfile, wave
import numpy as np

SR = 48000
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TIMELINE = json.load(open(os.path.join(ROOT, 'scripts/media/video/tour.json')))
BPM = TIMELINE['bpm']
BEAT = 60 / BPM
BAR = 4 * BEAT
TOTAL = sum(s['beats'] for s in TIMELINE['scenes']) * BEAT
N = int(TOTAL * SR)
TARGET_LUFS = -23.0
MAX_PEAK = 10 ** (-6 / 20)

rng = np.random.default_rng(2611)

# Section times in seconds (the film's own scene starts; see tour.json).
GROOVE_FROM = 10.0
DIP_FROM, DIP_TO = 13.5, 16.6
STEP_AT = 17.5
CUT_AT = 40.0
FADE_FROM = 42.5


def freq(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1,
             'A': 0, 'A#': 1, 'B': 2}
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


def lowpass(y, cutoff):
    spec = np.fft.rfft(y)
    f = np.fft.rfftfreq(len(y), 1 / SR)
    spec *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(spec, len(y))


def human_freq(f):
    # About 3 cents of random pitch drift per note.
    return f * 2 ** (rng.normal(0, 3) / 1200)


def pad_voice(f, dur, detune=0.0035):
    x = tt(dur)
    y = np.zeros_like(x)
    for d, g in [(-detune, 0.5), (0, 0.7), (detune, 0.5)]:
        ph = 2 * np.pi * f * (1 + d) * x + rng.uniform(0, 6.28)
        y += g * sum(np.sin(k * ph) / k ** 1.7 for k in range(1, 6))
    return y


def pluck(f, dur=0.9):
    f = human_freq(f)
    x = tt(dur)
    y = sum(np.sin(2 * np.pi * f * k * x) * np.exp(-x * (5 + 3.5 * k)) / k for k in range(1, 6))
    return y * np.minimum(1, x / 0.004)


def bell(f, dur=1.8):
    f = human_freq(f)
    x = tt(dur)
    y = sum(a * np.sin(2 * np.pi * f * m * x) * np.exp(-x * (2.0 + m)) for m, a in [(1, 1), (2.01, 0.35), (3.98, 0.12)])
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
    # A few ms of random timing and about 15% of random loudness, so it does not sound like MIDI.
    at = max(0.0, at + rng.normal(0, 0.004))
    gain = gain * (1 + rng.uniform(-0.15, 0.15))
    i = int(at * SR)
    if i >= buf.shape[1]:
        return
    sig = sig[: buf.shape[1] - i]
    left = np.cos((pan + 1) * np.pi / 4)
    right = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + len(sig)] += sig * gain * left
    buf[1, i:i + len(sig)] += sig * gain * right


CHORD = {
    'A': (['A3', 'E4', 'B4', 'C#5'], 'A2', ['E5', 'C#5', 'A4', 'C#5', 'E5', 'B4', 'C#5', 'A4']),
    'E': (['E3', 'B3', 'F#4', 'G#4'], 'E2', ['B4', 'G#4', 'E4', 'G#4', 'B4', 'F#4', 'G#4', 'E4']),
    'F#m': (['F#3', 'C#4', 'G#4', 'A4'], 'F#2', ['A4', 'F#4', 'C#4', 'F#4', 'A4', 'G#4', 'F#4', 'C#5']),
    'D': (['D3', 'A3', 'E4', 'F#4'], 'D2', ['A4', 'F#4', 'D4', 'F#4', 'A4', 'E4', 'F#4', 'D5']),
}
BARS = ['A', 'E', 'F#m', 'D', 'A', 'D', 'E', 'A', 'E', 'F#m', 'D', 'A', 'E', 'F#m', 'D', 'E', 'A', 'A']
assert len(BARS) * BAR == TOTAL

pads = np.zeros((2, N))
keys = np.zeros((2, N))
bass = np.zeros((2, N))
drums = np.zeros((2, N))


def quiet(t):
    """True while the music is in the silent counting beat."""
    return DIP_FROM <= t < DIP_TO


for b, name in enumerate(BARS):
    at = b * BAR
    chord, root, arp = CHORD[name]
    final = at >= CUT_AT
    last = b == len(BARS) - 1
    dur = BAR + 0.8 if not last else BAR
    # Pads: a swell in the first bar; the last bar is an open fifth that rings out.
    notes = ['A3', 'E4', 'A4'] if last else chord
    for n in notes:
        v = pad_voice(freq(n), dur)
        v *= adsr(len(v), 1.6 if b == 0 else 0.5, 0.4, 0.8, 1.2 if not last else 2.0)
        put(pads, at, v, 0.06, pan=rng.uniform(-0.5, 0.5))
    # Bass and drums: only in the groove, never in the dip, cut at 40 s.
    if GROOVE_FROM - 0.01 <= at < CUT_AT:
        for beat, g in [(0, 1.0), (2, 0.7)]:
            t = at + beat * BEAT
            if quiet(t) or quiet(t + BEAT):
                continue
            x = tt(BEAT * 1.6)
            y = np.sin(2 * np.pi * freq(root) * x) + 0.25 * np.sin(4 * np.pi * freq(root) * x)
            put(bass, t, y * adsr(len(x), 0.01, 0.3, 0.6, 0.25), 0.33 * g)
    # Plucked eighths: sparse in the hook and the dip, fuller in the groove; a bloom at the end.
    if not final:
        for i, n in enumerate(arp):
            t = at + i * BEAT / 2
            if t < 0.8:
                continue
            sparse = at < GROOVE_FROM or quiet(t)
            if sparse and i % 2:
                continue
            g = 0.16 if not sparse else 0.12
            put(keys, t, pluck(freq(n)), g * (1.0 if i % 4 == 0 else 0.8), pan=0.35 if i % 2 else -0.35)
    elif not last:
        for i, n in enumerate(['A5', 'C#6', 'E6', 'A6']):
            put(keys, at + 0.1 + i * BEAT * 0.5, bell(freq(n), 3.4), 0.14, pan=(-0.4, 0.2, 0.4, -0.2)[i])
        put(keys, at, bell(freq('A4'), 3.4), 0.12)

# The first notes (a short phrase at 0.8 s, so the film's first seconds have its own voice).
for i, n in enumerate(['E5', 'A5', 'C#6']):
    put(keys, 0.8 + i * BEAT * 0.75, bell(freq(n), 2.2), 0.09, pan=(-0.3, 0.1, 0.3)[i])

# A soft bell on each scene change, so every caption lands on something; a bigger one when the
# result comes in at 17.5 s.
for t in [5.0, 10.0, 22.5, 27.5, 35.0]:
    put(keys, t, bell(freq('A5'), 1.6), 0.07, pan=0.2)
put(keys, STEP_AT, bell(freq('A5'), 2.2), 0.13, pan=-0.2)
put(keys, STEP_AT + 0.02, bell(freq('E6'), 2.2), 0.08, pan=0.25)

# Drums: a soft kick on 1 and 3, a rim on 2 and 4, a shaker on the eighths; not in the dip.
for k in range(int(CUT_AT / BEAT)):
    t = k * BEAT
    if t < GROOVE_FROM - 0.01 or quiet(t):
        continue
    if k % 4 in (0, 2):
        put(drums, t, kick(), 0.5)
    if k % 4 in (1, 3):
        put(drums, t, rim(), 0.12, pan=0.15)
    for h in range(2):
        put(drums, t + h * BEAT / 2, shaker(), 0.07 if h % 2 else 0.04, pan=-0.3)

pads[0] = lowpass(pads[0], 2400)
pads[1] = lowpass(pads[1], 2400)

# The pads breathe a little under each kick in the groove.
duck = np.ones(N)
for k in range(int(CUT_AT / BEAT)):
    t = k * BEAT
    if GROOVE_FROM <= t < CUT_AT and k % 2 == 0 and not quiet(t):
        i = int(t * SR)
        seg = 1 - 0.28 * np.exp(-tt(BEAT) * 9)
        seg = seg[: N - i]
        duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], seg)
pads *= duck

mix = pads + keys + bass + drums


def reverb(y):
    n = int(2.2 * SR)
    x = np.arange(n) / SR
    out = np.zeros_like(y)
    for c in range(2):
        ir = rng.standard_normal(n) * np.exp(-x * 3.2)
        ir = lowpass(ir, 3500)
        ir /= np.sqrt(np.sum(ir ** 2))
        size = len(y[c]) + n
        nfft = 1 << (size - 1).bit_length()
        out[c] = np.fft.irfft(np.fft.rfft(y[c], nfft) * np.fft.rfft(ir, nfft), nfft)[: len(y[c])]
    return out


mix = mix + reverb(keys + pads * 0.6) * 0.32

# The film's loudness shape, as one master curve (linear gain): a quiet swell, a base level, a
# -7 dB dip for the silent beat, a +5 dB step up at 17.5 s, a lower level for the end card
# (the low end is already cut), and a fade out by 45 s.
curve_t = [0, 2.0, 13.1, 13.9, 16.3, 17.3, 17.5, 17.62, 39.6, 40.2, FADE_FROM, TOTAL]
curve_g = [0, 0.56, 0.56, 0.25, 0.25, 0.56, 0.56, 1.0, 1.0, 0.8, 0.8, 0.0]
ts = np.arange(N) / SR
gain = np.interp(ts, curve_t, curve_g)
gain[: int(2.0 * SR)] = (ts[: int(2.0 * SR)] / 2.0) ** 2 * 0.56
tail = ts >= FADE_FROM
gain[tail] = 0.8 * np.clip((TOTAL - ts[tail]) / (TOTAL - FADE_FROM), 0, 1) ** 1.6
mix = mix * gain
mix = np.tanh(mix * 1.1) / np.tanh(1.1)


def write_wav(path, y):
    pcm = (np.clip(y, -1, 1).T * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def lufs(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=sample', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    tail_text = out[out.rindex('Summary:'):]
    return float(re.search(r'I:\s+(-?[\d.]+) LUFS', tail_text).group(1))


out_m4a = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'media', 'tour-music.m4a'))
os.makedirs(os.path.dirname(out_m4a), exist_ok=True)
tmp = tempfile.mkdtemp(prefix='citefox-tour-music-')
wav = os.path.join(tmp, 'tour-music.wav')

# Set the loudness (integrated) to the target, then make sure the sample peak stays at or
# below -6 dBFS (a soft clip on the peaks if needed, then the level is set again).
level = 1.0
for _ in range(6):
    write_wav(wav, mix * level)
    now = lufs(wav)
    level *= 10 ** ((TARGET_LUFS - now) / 20)
    peak = np.max(np.abs(mix * level))
    if abs(TARGET_LUFS - now) < 0.15 and peak <= MAX_PEAK:
        break
    if peak > MAX_PEAK:
        mix = (MAX_PEAK / level) * np.tanh(mix * level / MAX_PEAK)
final = mix * level
write_wav(wav, final)
print(f'{TOTAL:.2f} s, integrated {lufs(wav):.1f} LUFS, sample peak {20 * np.log10(np.max(np.abs(final))):.1f} dBFS')

subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', out_m4a], check=True)
os.remove(wav)
os.rmdir(tmp)
print(out_m4a)
