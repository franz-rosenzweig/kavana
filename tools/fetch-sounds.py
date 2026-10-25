#!/usr/bin/env python3
"""Make Kavana's recorded background sounds, web/audio/<id>-<n>.mp3, from CC0 recordings on Freesound.

Each pick in PICKS is one Freesound sound, where in it to start, and how long a loop to make. For each
one this downloads the original (or Freesound's high-quality preview, without a sign-in), cuts the
stretch out, crossfades the stretch's end into its start so it loops without a seam, sets its loudness
to that of the version web/sounds.js makes on the device, and saves it as a 128 kbps MP3 with PAD
seconds of its own end before it and of its own start after it (sounds.js loops the middle).

    python3 tools/fetch-sounds.py auth                 print the link to let this script download originals
    python3 tools/fetch-sounds.py auth <code>          swap the code that page shows for a token
    python3 tools/fetch-sounds.py make [ids]           download what's missing and write web/audio/
    python3 tools/fetch-sounds.py check [ids] [--plots <dir>]
                                                       read the files back: the seam, the loudness, the peaks
    python3 tools/fetch-sounds.py try <id> <sound> [--loop 75] [--xfade 4]
                                                       how a Freesound sound would do as <id>, and where to start

The key is a JSON file with client_id and client_secret from https://freesound.org/apiv2/apply (and,
after `auth`, the tokens): /srv/docker/kavana/freesound.key, or FREESOUND_KEY=<path>. Keep it out of
git. Downloads are kept in ~/.cache/kavana-sounds (or SOUNDS_CACHE). Needs numpy, scipy and an ffmpeg
with libmp3lame (FFMPEG="docker exec -i <container> ffmpeg" runs one in a container: everything goes
through its stdin and stdout). --plots needs matplotlib.
"""
import functools, json, os, shlex, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
import numpy as np
from scipy.signal import butter, lfilter, sosfilt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'web' / 'audio'
KEY = Path(os.environ.get('FREESOUND_KEY', '/srv/docker/kavana/freesound.key'))
CACHE = Path(os.environ.get('SOUNDS_CACHE', Path.home() / '.cache' / 'kavana-sounds'))
FFMPEG = shlex.split(os.environ.get('FFMPEG', 'ffmpeg'))
API = 'https://freesound.org/apiv2'
SR = 48000
PAD = 0.5  # the same as PAD in web/sounds.js

# The picks: all "Creative Commons 0" (the script checks). `start` is where the loop begins in the
# recording (seconds), `loop` how long it is (whole seconds, which sounds.js counts on), `xfade` how long
# its end blends into its start, `channels` 1 makes it mono, and `highpass` / `lowpass` (Hz) filter out
# a rumble, hum or whine. `file` is the name in web/audio/: a changed file needs a new number,
# and the same name in FILES in web/sounds.js. docs/sounds.md lists them for people.
PICKS = {
    # "Female cat purr" by Sadiquecat (Pearl, lying on her side): steady breaths every 1.45 s. The
    # loop's two ends land on the same point of a breath, the pause before one, and the short fade
    # sits in that pause.
    'purr': dict(sound=695630, start=35.46, loop=45, xfade=0.25, channels=1, file='purr-1'),
    # "Light rain in a field of bananas trees" by felix.blume (Veracruz, Mexico): soft, even patter.
    'rain': dict(sound=512334, start=350.6, loop=75, xfade=4, file='rain-1'),
    # "Restaurant Atmosphere (crowded)" by felix.blume (São Paulo, around midnight): a dense murmur
    # with no words you can follow, before the machines in the back start humming. A whine above
    # 12 kHz is filtered out.
    'cafe': dict(sound=422097, start=22.4, loop=90, xfade=4, highpass=70, lowpass=12000, file='cafe-1'),
    # "Fireplace for Six Minutes (Stereo)" by petebuchwald: a wood stove, close, low roar and crackles.
    'fire': dict(sound=496130, start=244, loop=90, xfade=4, file='fire-1'),
    # "Wave on the beach in Thailand, at 20 meters form the water, during the night" by felix.blume:
    # gentle surf, and the loop's ends meet in step with the waves.
    'waves': dict(sound=510236, start=14.9, loop=90, xfade=6, file='waves-1'),
    # "Night Ambience 01 - Aug 2 2013 - Back Yard" by rgbrobot (Atlanta): crickets and cicadas on a
    # summer evening. The insects are all above 2 kHz, so a high-pass takes out the far-off rumble.
    'night': dict(sound=195969, start=29.3, loop=60, xfade=4, highpass=200, file='night-1'),
    # "Howling winter storm ambient sounds" by DBlover, mixed from their own recording and five more
    # CC0 ones (Jeffreys2 327771 and 327772, felix.blume 211463, krnd 90898, courter 447823): wind
    # howling round the house. The loop's ends meet in step with the gusts.
    'wind': dict(sound=505999, start=219.0, loop=90, xfade=5, file='wind-1'),
    # "Bird ambience. Coniferous forest dawn chorus." by SamsterBirdies (by a lake): a steady chorus.
    # The garden recordings I tried came and went too much for a loop (a pheasant, a rooster, a plane).
    'birds': dict(sound=745273, start=10.4, loop=90, xfade=5, file='birds-1'),
}

# ---------- Freesound ----------
def key():
    try: return json.loads(KEY.read_text())
    except FileNotFoundError: sys.exit(f'No key at {KEY}. Get one at https://freesound.org/apiv2/apply.')

def save_key(k):
    tmp = KEY.with_suffix('.tmp')
    old = os.umask(0o077)
    try: tmp.write_text(json.dumps(k))
    finally: os.umask(old)
    os.chmod(tmp, 0o600); os.replace(tmp, KEY)

def token(k, **form):
    data = urllib.parse.urlencode({'client_id': k['client_id'], 'client_secret': k['client_secret'], **form}).encode()
    r = json.load(urllib.request.urlopen(urllib.request.Request(f'{API}/oauth2/access_token/', data=data), timeout=30))
    k.update(access_token=r['access_token'], refresh_token=r['refresh_token'], expires_at=int(time.time()) + int(r.get('expires_in', 86400)))
    save_key(k)

def bearer(k):
    """The OAuth2 token for downloading originals, refreshed when it's run out; None without one."""
    if 'refresh_token' not in k: return None
    if time.time() > k.get('expires_at', 0) - 300:
        try: token(k, grant_type='refresh_token', refresh_token=k['refresh_token'])
        except urllib.error.HTTPError: return None
    return k['access_token']

def get(url, k, auth=False, tries=4):
    """A GET to the API, slowly enough for its 60 a minute."""
    head = {'Authorization': f'Bearer {bearer(k)}'} if auth else {}
    if not auth: url += ('&' if '?' in url else '?') + 'token=' + k['client_secret']
    for i in range(tries):
        time.sleep(1.1)
        try: return urllib.request.urlopen(urllib.request.Request(url, headers=head), timeout=120)
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == tries - 1: raise
            time.sleep(10 * (i + 1))

def info(k, sound):
    f = CACHE / f'{sound}.json'
    if f.exists(): return json.loads(f.read_text())
    fields = 'id,name,username,url,license,duration,channels,samplerate,type,previews,description,tags'
    r = json.load(get(f'{API}/sounds/{sound}/?fields={fields}', k))
    CACHE.mkdir(parents=True, exist_ok=True); f.write_text(json.dumps(r))
    return r

def download(k, sound, preview=False):
    """The recording's bytes and which it is: the original when signed in (and not `preview`), else
    Freesound's high-quality OGG preview."""
    meta = info(k, sound)
    if meta['license'] != 'http://creativecommons.org/publicdomain/zero/1.0/':
        sys.exit(f"{sound} isn't CC0 ({meta['license']}).")
    orig, prev = CACHE / f"{sound}.original.{meta['type']}", CACHE / f'{sound}.preview.ogg'
    if not preview and (orig.exists() or bearer(k)):
        if not orig.exists(): orig.write_bytes(get(f'{API}/sounds/{sound}/download/', k, auth=True).read())
        return orig.read_bytes(), 'original'
    if not prev.exists(): prev.write_bytes(urllib.request.urlopen(meta['previews']['preview-hq-ogg'], timeout=120).read())
    return prev.read_bytes(), 'preview'

# ---------- audio in and out ----------
def decode(data, channels=None, sr=SR, secs=None):
    """Any audio file's bytes → float32 array (channels, samples) at `sr`, the first `secs` of it."""
    if channels is None:
        probe = run(FFMPEG + ['-hide_banner', '-i', 'pipe:0', '-f', 'null', '-'], data, check=False).stderr.decode(errors='replace')
        channels = 1 if ' mono' in probe and 'stereo' not in probe else 2
    raw = run(FFMPEG + ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0'] + (['-t', str(secs)] if secs else []) +
              ['-ac', str(channels), '-ar', str(sr), '-f', 'f32le', 'pipe:1'], data).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, channels).T.copy()

def encode_mp3(x, sr=SR, kbps=128):
    pcm = np.ascontiguousarray(np.clip(x, -1, 1).T, np.float32).tobytes()
    return run(FFMPEG + ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', str(sr), '-ac', str(len(x)), '-i', 'pipe:0',
                         '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-f', 'mp3', 'pipe:1'], pcm).stdout

def run(cmd, data, check=True):
    p = subprocess.run(cmd, input=data, capture_output=True)
    if check and p.returncode: sys.exit(f'ffmpeg failed: {p.stderr.decode(errors="replace")[-400:]}')
    return p

# ---------- loudness (ITU-R BS.1770: K-weighting and gating) ----------
def kweight(x, sr):
    # The two filters from BS.1770, worked out for any rate (as pyloudnorm does).
    def shelf(G=3.999843853973347, Q=0.7071752369554196, fc=1681.974450955533):
        A = 10 ** (G / 40); w = 2 * np.pi * fc / sr; a = np.sin(w) / (2 * Q); c = np.cos(w)
        b = [A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * a), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * a)]
        d = [(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * a, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * a]
        return np.array(b) / d[0], np.array(d) / d[0]
    def highpass(Q=0.5003270373238773, fc=38.13547087602444):
        w = 2 * np.pi * fc / sr; a = np.sin(w) / (2 * Q); c = np.cos(w)
        b = np.array([(1 + c) / 2, -(1 + c), (1 + c) / 2]); d = np.array([1 + a, -2 * c, 1 - a])
        return b / d[0], d / d[0]
    for b, a in (shelf(), highpass()): x = lfilter(b, a, x, axis=-1)
    return x

def blocks(x, sr, win=0.4, hop=0.1):
    """Loudness of each window (LUFS) of a (channels, n) signal. A mono one counts as played on two
    speakers, the way Web Audio plays a mono buffer, so mono and stereo compare fairly."""
    z = kweight(x, sr) ** 2
    pw = z.sum(0) * (2 if len(x) == 1 else 1)
    n, h = int(win * sr), int(hop * sr)
    c = np.concatenate([[0], np.cumsum(pw)])
    starts = np.arange(0, len(pw) - n + 1, h)
    return -0.691 + 10 * np.log10(np.maximum((c[starts + n] - c[starts]) / n, 1e-12))

def lufs(x, sr):
    """Integrated loudness, gated like BS.1770 (-70 LUFS, then 10 under the mean)."""
    l = blocks(x, sr)
    l = l[l > -70]
    if not len(l): return -70.0
    mean = lambda v: 10 * np.log10(np.mean(10 ** (v / 10)))
    return float(mean(l[l > mean(l) - 10]))

# ---------- the versions sounds.js makes on the device, to match their loudness ----------
# Ported from MAKERS in web/sounds.js (the same filters and levels, other random numbers).
LEVEL = {'purr': 0.11, 'rain': 0.1, 'brown': 0.14, 'white': 0.08, 'cafe': 0.11, 'fire': 0.12, 'waves': 0.12, 'birds': 0.08, 'night': 0.09, 'wind': 0.11}
SECONDS = {'purr': 6, 'waves': 20, 'cafe': 16, 'fire': 12, 'birds': 16, 'night': 8, 'wind': 16, 'rain': 6, 'brown': 6, 'white': 6}

def made(id, sr=SR, seed=1):
    g = np.random.default_rng(seed)
    n = int(sr * SECONDS[id]); t = np.arange(n) / sr
    rnd = lambda m=n: g.uniform(-1, 1, m)
    def pink(m=n):
        w = rnd(m); out = w * 0.5362
        for c, k in ((0.99886, 0.0555179), (0.99332, 0.0750759), (0.969, 0.153852), (0.8665, 0.3104856), (0.55, 0.5329522)):
            out = out + lfilter([k], [1, -c], w)
        out = out + lfilter([-0.016898], [1, 0.7616], w) + 0.115926 * np.concatenate([[0], w[:-1]])
        return out * 0.11
    brown = lambda m=n: lfilter([0.02 / 1.02], [1, -1 / 1.02], rnd(m)) * 3.2
    low = lambda k, x: lfilter([k], [1, -(1 - k)], x)
    if id == 'purr':
        c = t % 3
        env = np.where(c < 1.3, 0.55 * np.sin(np.pi * c / 1.3), np.where((c > 1.45) & (c < 2.85), np.sin(np.pi * (c - 1.45) / 1.4), 0))
        ph = np.cumsum(2 * np.pi * np.where(c < 1.4, 22, 26) / sr)
        pulse = (0.5 + 0.5 * np.cos(ph)) ** 6
        last = lfilter([0.02 / 1.02], [1, -1 / 1.02], rnd())
        d = low(0.14, (last * 3.4 + rnd() * 0.06) * pulse * env) * 2.6
    elif id == 'white': d = rnd() * 0.18
    elif id == 'brown': d = brown()
    elif id == 'rain': d = pink() * 0.45
    elif id == 'cafe':
        x = pink(); swell = 0.75 + 0.25 * np.sin(2 * np.pi * t / (n / sr)) * np.sin(2 * np.pi * t * 0.37)
        d = (low(0.08, x) - low(0.01, x)) * 2.2 * swell
        j = np.arange(int(sr * 0.5))
        for _ in range(7):
            at = int((0.05 + 0.9 * g.random()) * (n - sr)); f = 1800 + g.random() * 2200; amp = 0.05 + g.random() * 0.05
            d[at:at + len(j)] += amp * np.sin(2 * np.pi * f * j / sr) * np.exp(-j / (sr * 0.06))
    elif id == 'fire':
        d = low(0.05, brown()) * 2.4
        for _ in range(round(n / sr * 9)):
            at = int(g.random() * (n - sr * 0.05)); amp = 0.08 + g.random() ** 3 * 0.5; ln = sr * (0.002 + g.random() * 0.01)
            j = np.arange(int(np.ceil(ln))); d[at:at + len(j)] += amp * rnd(len(j)) * np.exp(-j / (ln / 3))
    elif id == 'waves':
        c = (np.arange(n) / n * 2) % 1
        env = 0.15 + 0.85 * np.sin(np.pi * np.minimum(1, c * 1.6)) ** 2 * np.where(c < 0.62, 1, np.maximum(0, 1 - (c - 0.62) / 0.38))
        d = low(0.12, pink()) * 1.9 * env
    elif id == 'birds':
        d = low(0.04, pink()) * 0.35
        for _ in range(round(n / sr / 1.6)):
            at = int(g.random() * (n - sr * 1.2)); notes = 2 + int(g.random() * 5); base = 2600 + g.random() * 2400; amp = 0.05 + g.random() * 0.06
            for _ in range(notes):
                ln = int(sr * (0.05 + g.random() * 0.08)); down = g.random() < 0.6
                p = np.arange(ln) / ln; f = base * (1.25 - 0.45 * p if down else 0.85 + 0.4 * p)
                seg = amp * np.sin(np.cumsum(2 * np.pi * f / sr)) * np.sin(np.pi * p)
                m = min(ln, n - at); d[at:at + m] += seg[:m]
                at += ln + int(sr * (0.03 + g.random() * 0.06))
    elif id == 'night':
        d = low(0.03, brown()) * 0.9
        for f, rate, amp, off in ((4400, 2.1, 0.035, 0), (4900, 1.7, 0.025, 0.31), (4100, 2.6, 0.02, 0.62)):
            chirp = ((t + off) * rate) % 1
            pulse = np.maximum(0, np.sin(np.pi * ((chirp / 0.22) * 4 % 1)))
            d += np.where(chirp > 0.22, 0, amp * pulse * np.sin(2 * np.pi * f * np.arange(n) / sr))
    elif id == 'wind':
        x = pink(); c = np.arange(n) / n
        k = 0.01 + 0.05 * (0.5 + 0.5 * np.sin(2 * np.pi * c * 2 + np.sin(2 * np.pi * c * 3)))
        y = np.empty(n); v = 0.0
        for i in range(n): v += k[i] * (x[i] - v); y[i] = v
        d = y * (3.2 + 1.6 * np.sin(2 * np.pi * c * 2))
    d = d - (d[-1] - d[0]) * np.arange(n) / n
    gain = LEVEL[id] / max(1e-6, np.sqrt(np.mean(d ** 2)))
    return (np.tanh(d * gain * 1.1) / 1.1)[None, :]

@functools.cache
def target(id):
    """How loud the recording should be: as loud as the version made on the device (LUFS)."""
    return np.mean([lufs(made(id, seed=s), SR) for s in (1, 2, 3)])

# ---------- making a loop ----------
def loop_of(x, sr, start, loop, xfade):
    """The stretch [start, start + loop) of x, with what comes after it crossfaded into its first
    `xfade` seconds, so its last sample runs on into its first. A recording that slowly gets louder
    or softer gets a gentle tilt first (in dB, the same all the way along), so its two ends are
    equally loud and the loop doesn't step up or down where it wraps. The fade keeps the power
    steady for however alike the two bits are (equal power when they're unrelated, like rain; equal
    gain when they're the same; more when they half cancel out, like two purrs out of step)."""
    s, L, X = int(start * sr), int(loop * sr), int(xfade * sr)
    if s + L + X > x.shape[1]: sys.exit(f'The recording is {x.shape[1] / sr:.0f}s; that needs {(s + L + X) / sr:.0f}s.')
    x = x[:, s:s + L + X].copy()
    W = max(X, 3 * sr)
    tilt = lufs(x[:, :W], sr) - lufs(x[:, L:L + W] if L + W <= x.shape[1] else x[:, L - W + X:L + X], sr)
    x *= 10 ** ((tilt * (np.arange(x.shape[1]) / L - 0.5)) / 20)
    head, tail = x[:, :X], x[:, L:L + X]
    r = float(np.sum(head * tail) / np.sqrt(np.sum(head ** 2) * np.sum(tail ** 2) + 1e-12))
    p = 0.5 - 0.5 * np.cos(np.pi * (np.arange(X) + 0.5) / X)  # 0 → 1, smooth at both ends
    a, b = 1 - p, p
    norm = np.sqrt(a * a + b * b + 2 * max(r, -0.6) * a * b)
    y = x[:, :L].copy()
    y[:, :X] = (tail * a + head * b) / norm
    return y, r, tilt

def limit(y, sr, ceiling=0.89):
    """A limiter for the odd loud crackle, splash or click, worked out around the loop (so the seam
    stays seamless): it comes down 5 ms early and back in 60 ms, which the loud bit itself covers."""
    hop = sr // 1000
    n = y.shape[1] // hop * hop
    peak = np.abs(y[:, :n]).max(0).reshape(-1, hop).max(1)
    want = np.minimum(1, ceiling / np.maximum(peak, 1e-9))
    want = np.tile(want, 3)  # three times round, keep the middle one
    look = 5
    want = np.min(np.lib.stride_tricks.sliding_window_view(np.concatenate([want, np.ones(look)]), look + 1), axis=1)
    g = np.empty_like(want); v = 1.0; rel = 1 - np.exp(-1 / 60)
    for i, w in enumerate(want):
        v = w if w < v else v + rel * (w - v); g[i] = v
    g = g[len(g) // 3: 2 * len(g) // 3]
    gs = np.interp(np.arange(y.shape[1]), np.arange(len(g)) * hop + hop / 2, g, period=y.shape[1])
    return y * gs, float(g.min()), float(np.mean(g < 10 ** (-1 / 20)))

def padded(y, sr):
    p = int(PAD * sr)
    return np.concatenate([y[:, -p:], y, y[:, :p]], axis=1)

def make(id, k):
    pick = PICKS[id]
    data, kind = download(k, pick['sound'])
    x = decode(data, pick.get('channels'), secs=pick['start'] + pick['loop'] + pick.get('xfade', 4) + 1)
    # `highpass` and `lowpass` (Hz) take out a rumble, a hum or a whine that's in the recording
    for band in ('highpass', 'lowpass'):
        if pick.get(band): x = sosfilt(butter(4, pick[band], band, fs=SR, output='sos'), x, axis=-1).astype(np.float32)
    y, r, tilt = loop_of(x, SR, pick['start'], pick['loop'], pick.get('xfade', 4))
    want = target(id)
    y *= 10 ** ((want - lufs(y, SR)) / 20)
    y, g, busy = limit(y, SR)
    y *= 10 ** ((want - lufs(y, SR)) / 20)  # once more, for what the limiter took
    OUT.mkdir(exist_ok=True)
    f = OUT / f"{pick['file']}.mp3"
    f.write_bytes(encode_mp3(padded(y, SR)))
    print(f"{id:6} {f.name:12} from {pick['sound']} ({kind}) {pick['start']}s+{pick['loop']}s, {len(y)}ch, tilted {tilt:+.1f} dB, ends alike {r:+.2f}, "
          f"{want:.1f} LUFS, limiter at most {20 * np.log10(g):.1f} dB and over 1 dB {busy:.1%} of the time, {f.stat().st_size / 1e6:.2f} MB")

# ---------- checking the files ----------
def seam(y, sr):
    """How the loop's wrap compares with the rest: the jump from the last sample to the first against
    the usual sample-to-sample step, and the loudness and the spectrum just before and after the
    wrap against any other two neighbouring moments."""
    m = y.mean(0)
    step = np.abs(np.diff(m))
    jump = abs(m[0] - m[-1]) / (np.percentile(step, 99) + 1e-12)
    w = int(0.25 * sr)
    def spec(a): return np.log(np.abs(np.fft.rfft(a * np.hanning(len(a)))) + 1e-9)
    def lvl(a): return 10 * np.log10(np.mean(a ** 2) + 1e-12)
    pairs = [(m[i - w:i], m[i:i + w]) for i in range(w, len(m) - w, w)]
    sd = [np.mean(np.abs(spec(a) - spec(b))) for a, b in pairs]
    ld = [abs(lvl(a) - lvl(b)) for a, b in pairs]
    a, b = m[-w:], m[:w]
    return jump, abs(lvl(a) - lvl(b)), np.percentile(ld, 95), np.mean(np.abs(spec(a) - spec(b))), np.percentile(sd, 95)

def check(ids, plots=None):
    print('id      loop  ch  LUFS (made-on-device)  RMS (LEVEL)  peak dBFS  short-term spread  seam: jump/step, level dB (p95), spectrum (p95)')
    for id in ids:
        f = OUT / f"{PICKS[id]['file']}.mp3"
        x = decode(f.read_bytes(), None)
        L = round(x.shape[1] / SR - 2 * PAD)
        # The loop as sounds.js plays it, and as a browser would whose decoder leaves in the encoder's
        # delay (LAME's 1105 samples, or a whole frame more): the worst of the three.
        y = x[:, int(PAD * SR):int(PAD * SR) + L * SR]
        jump, ldiff, lp95, sdiff, sp95 = max((seam(x[:, int(PAD * SR) - d:int(PAD * SR) - d + L * SR], SR) for d in (0, 1105, 2257)), key=lambda v: v[0] + v[1] / max(v[2], 0.1) + v[3] / v[4])
        st = blocks(y, SR, 3, 1)
        print(f'{id:6} {L:4}s  {len(x)}   {lufs(y, SR):6.1f} ({target(id):6.1f})       {np.sqrt(np.mean(y ** 2)):.3f} ({LEVEL[id]:.2f})'
              f'   {20 * np.log10(np.abs(y).max()):6.1f}     {np.percentile(st, 95) - np.percentile(st, 5):4.1f} dB         '
              f'{jump:4.2f}, {ldiff:4.1f} ({lp95:4.1f}), {sdiff:4.2f} ({sp95:4.2f})')
        if plots: plot(id, y, Path(plots))

def plot(id, y, out):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    out.mkdir(parents=True, exist_ok=True)
    m = y.mean(0); n = len(m); t = np.arange(n) / SR
    fig, ax = plt.subplots(4, 1, figsize=(12, 10))
    ax[0].plot(t[::40], m[::40], lw=0.3); ax[0].set_title(f'{id}: the whole loop'); ax[0].set_xlim(0, t[-1])
    st = blocks(y, SR, 0.4, 0.1); ax[1].plot(np.arange(len(st)) * 0.1, st, lw=0.6); ax[1].set_title('momentary loudness (LUFS)'); ax[1].set_xlim(0, t[-1])
    ax[2].specgram(m, NFFT=2048, Fs=SR, noverlap=1024, cmap='magma'); ax[2].set_ylim(0, 12000); ax[2].set_title('spectrogram')
    w = int(0.05 * SR); around = np.concatenate([m[-w:], m[:w]])
    ax[3].plot((np.arange(2 * w) - w) / SR * 1000, around, lw=0.5); ax[3].axvline(0, color='r', lw=0.5); ax[3].set_title('the seam, 50 ms each side (ms)')
    fig.tight_layout(); fig.savefig(out / f'{id}.png', dpi=80); plt.close(fig)

# ---------- trying a recording ----------
def suggest(id, sound, loop, k, xfade=4):
    """Where in a recording a loop would sit best: a steady stretch whose two ends are alike, in
    loudness and, for something with a rhythm (a purr's breaths, waves), in step, so the crossfade
    doesn't blur two breaths or two waves into one."""
    data, kind = download(k, sound)
    x = decode(data, None, secs=900)
    meta = info(k, sound)
    dur = x.shape[1] / SR
    print(f"{sound} {meta['name']!r} by {meta['username']}, {dur:.0f}s, {len(x)}ch, {kind}")
    st = blocks(x, SR, 3, 1)  # short-term loudness, every second
    mo = blocks(x, SR, 0.4, 0.1)
    env = blocks(x, SR, 0.05, 0.01)  # the loudness every 10 ms, for the rhythm
    best = []
    X1, X100 = max(1, round(xfade)), int(xfade * 100)
    for s10 in range(0, int((dur - loop - max(xfade, 3) - 1) * 10)):  # every tenth of a second
        s = s10 / 10
        i, j = int(s), int(s + loop)
        w = st[i:j]
        spread = np.percentile(w, 95) - np.percentile(w, 5)
        events = np.max(mo[s10:s10 + loop * 10]) - np.median(w)
        ends = abs(np.mean(st[i:i + X1]) - np.mean(st[j:j + X1]))
        h, t = env[s10 * 10:s10 * 10 + X100], env[(s10 + loop * 10) * 10:(s10 + loop * 10) * 10 + X100]
        step = float(np.corrcoef(h, t)[0, 1]) if len(h) == len(t) and h.std() > 0 and t.std() > 0 else 0.0
        best.append((spread + 0.5 * ends + 0.1 * max(0, events - 6) - 2 * step, s, spread, events, ends, step))
    best.sort()
    shown = []
    for score, s, spread, events, ends, step in best:
        if any(abs(s - o) < 5 for o in shown): continue
        shown.append(s)
        print(f'  start {s:6.1f}s: spread {spread:4.1f} dB, loudest moment +{events:4.1f} dB, ends differ {ends:3.1f} dB, in step {step:+.2f}')
        if len(shown) == 6: break
    print(f'  whole: {lufs(x, SR):.1f} LUFS, short-term spread {np.percentile(st, 95) - np.percentile(st, 5):.1f} dB; made on device: {target(id):.1f} LUFS')

def main():
    args = sys.argv[1:]
    if not args: sys.exit(__doc__)
    cmd, rest = args[0], args[1:]
    k = key()
    if cmd == 'auth':
        if rest: token(k, grant_type='authorization_code', code=rest[0]); print('Signed in; the token is in', KEY)
        else: print(f"Open this, press Authorize, and run `auth <code>` with the code it shows:\n{API}/oauth2/authorize/?client_id={k['client_id']}&response_type=code")
    elif cmd == 'make':
        for id in rest or PICKS: make(id, k)
    elif cmd == 'check':
        plots = None
        if '--plots' in rest: i = rest.index('--plots'); plots = rest[i + 1]; del rest[i:i + 2]
        check(rest or list(PICKS), plots)
    elif cmd == 'try':
        loop, xfade = 75, 4
        if '--loop' in rest: i = rest.index('--loop'); loop = int(rest[i + 1]); del rest[i:i + 2]
        if '--xfade' in rest: i = rest.index('--xfade'); xfade = float(rest[i + 1]); del rest[i:i + 2]
        suggest(rest[0], int(rest[1]), loop, k, xfade)
    else: sys.exit(__doc__)

if __name__ == '__main__':
    main()
