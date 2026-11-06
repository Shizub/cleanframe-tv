"""Compute the Duo sounds with NumPy: several styles, the same gestures, the same scale.

Writes to ignored staging and never replaces app assets automatically. Needs NumPy (a
development dependency only). With --uisfx, it also adds Zen, the one pack kept from UI SFX,
at the same perceived loudness, which needs afconvert from macOS; see docs/assets.md.
"""
import argparse
import json
import subprocess
import tempfile
import wave
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.local/materials/sounds'

RATE = 48000
# A major pentatonic: two notes of this scale always sound right together.
PENTATONIC = {9, 11, 1, 4, 6}
NOTES = 8
# Springs of motion.js (duration, bounce): the breath follows the moving panel.
PANEL_IN = (0.50, 0.15)
PANEL_OUT = (0.35, 0.0)
# Longest duration of each gesture, and the perceived level aimed at, in dB.
LIMITS = {'select': .05, 'edge': .06, 'switch': .08, 'ok': .12, 'back': .12, 'panelIn': .35, 'panelOut': .25,
          'wake': .40, 'launch': .35, 'sourceOn': .30, 'sourceOff': .30, 'error': .20}
# A very low note needs a little more time to exist.
LONG_CLICKS = {'feutre', 'bronze', 'ardoise'}
LIMITS_LONG = dict(LIMITS, select=.07, edge=.08)
TARGETS = {'select': -32, 'edge': -33, 'switch': -30, 'ok': -29, 'back': -30, 'panelIn': -31, 'panelOut': -33,
           'wake': -27, 'launch': -29, 'sourceOn': -27, 'sourceOff': -27, 'error': -29}
PEAK_LIMIT = -6
# A small speaker renders low notes poorly: the weighting must not push to overcompensate.
WEIGHT_FLOOR = -8
# UI SFX packs kept (CC0 audio): for each gesture, the pack's sound with the same role.
UISFX_PACKS = ('zen',)
UISFX_CUES = {'edge': 'blocked', 'switch': 'snap', 'ok': 'press', 'back': 'back', 'panelIn': 'open', 'panelOut': 'close', 'wake': 'wake',
              'launch': 'start', 'sourceOn': 'connect', 'sourceOff': 'disconnect', 'error': 'error'}
# The original click stays in the middle of the scale, so the timbre never strays too far.
UISFX_STEPS = (-5, -3, 0, 2, 4, 7, 9, 12)
# Their sounds have longer tails than ours: they fade out instead of being cut.
UISFX_LIMITS = {'select': .20, 'edge': .30, 'switch': .25, 'ok': .25, 'back': .30, 'panelIn': .50, 'panelOut': .45,
                'wake': .60, 'launch': .60, 'sourceOn': .70, 'sourceOff': .70, 'error': .60}


def size(seconds):
    return int(round(seconds * RATE))


def times(n):
    return np.arange(n) / RATE


def note(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def scale_from(base):
    return [midi for midi in range(base, base + 48) if midi % 12 in PENTATONIC][:NOTES]


def norm(sound):
    return sound / np.abs(sound).max()


def attack(n, seconds):
    env = np.ones(n)
    count = min(max(1, size(seconds)), n)
    env[:count] = 0.5 - 0.5 * np.cos(np.pi * (np.arange(count) + 0.5) / count)
    return env


def fade_out(sound, seconds):
    out = sound.copy()
    count = min(size(seconds), len(out))
    out[-count:] *= np.cos(np.linspace(0, np.pi / 2, count)) ** 2
    return out


def mix(*parts):
    """Each part: (sound, start in seconds, gain)."""
    n = max(size(at) + len(sound) for sound, at, _ in parts)
    out = np.zeros(n)
    for sound, at, gain in parts:
        start = size(at)
        out[start:start + len(sound)] += sound * gain
    return out


def noise(n, seed):
    return np.random.default_rng(zlib.crc32(seed.encode())).standard_normal(n)


def ring(freq, ratios, gains, taus, seconds, soft=0.0003):
    """A struck body: modes that each die away at their own speed."""
    n = size(seconds)
    t = times(n)
    out = np.zeros(n)
    for ratio, gain, tau in zip(ratios, gains, taus):
        if freq * ratio < 0.45 * RATE:
            out += gain * np.exp(-t / tau) * np.sin(2 * np.pi * freq * ratio * t)
    return out * attack(n, soft)


def glide(f0, f1, seconds, tau, soft, harmonics=(), bend=0.07):
    """A note whose pitch glides from f0 to f1 in `bend` seconds."""
    n = size(seconds)
    t = times(n)
    phase = 2 * np.pi * np.cumsum(f0 * (f1 / f0) ** np.minimum(t / bend, 1)) / RATE
    out = np.sin(phase)
    for order, gain in harmonics:
        out += gain * np.sin(order * phase)
    return out * np.exp(-t / tau) * attack(n, soft)


def burst(seconds, low, high, tau, seed):
    """The noise of the contact: very short, limited to a band of frequencies."""
    n = size(seconds)
    spectrum = np.fft.rfft(noise(n, seed))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    spectrum[(freqs < low) | (freqs > high)] = 0
    return norm(np.fft.irfft(spectrum, n)) * np.exp(-times(n) / tau) * attack(n, 0.0002)


def spring(params, n):
    """Position (0 to 1) and speed (0 to 1) of the motion.js spring, released from rest."""
    duration, bounce = params
    w0, zeta, t = 2 * np.pi / duration, 1 - bounce, times(n)
    if zeta >= 1:
        decay = np.exp(-w0 * t)
        return 1 - decay * (1 + w0 * t), norm(t * decay)
    wd = w0 * np.sqrt(1 - zeta * zeta)
    decay = np.exp(-zeta * w0 * t)
    return 1 - decay * (np.cos(wd * t) + zeta * w0 / wd * np.sin(wd * t)), norm(decay * np.sin(wd * t))


def breath(seconds, f0, f1, q, params, seed):
    """Noise through a filter that follows the spring, louder when the panel moves fast."""
    n = size(seconds)
    position, speed = spring(params, n)
    path = f0 * (f1 / f0) ** np.clip(position, 0, 1)
    g = np.tan(np.pi * path / RATE)
    k = 1 / q
    a1 = 1 / (1 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    source = noise(n, seed)
    out = np.zeros(n)
    c1 = c2 = 0.0
    for i in range(n):
        v3 = source[i] - c2
        v1 = a1[i] * c1 + a2[i] * v3
        v2 = c2 + a2[i] * c1 + a3[i] * v3
        c1, c2 = 2 * v1 - c1, 2 * v2 - c2
        out[i] = k * v1
    # A filter of the same width lets more energy through at the top: compensate to keep the breath even.
    return norm(out * np.sqrt(min(f0, f1) / path) * speed)


def swell(f0, f1, seconds, params):
    """A very soft note that goes with the spring."""
    n = size(seconds)
    position, speed = spring(params, n)
    return np.sin(2 * np.pi * np.cumsum(f0 * (f1 / f0) ** np.clip(position, 0, 1)) / RATE) * speed


# ---------- Verre: clear and brief ----------
GLASS_RATIOS = (1, 2.32, 4.25, 6.63)
GLASS_GAINS = (1, .42, .2, .08)


def glass(freq, seconds, tau, soft=0.0003):
    return ring(freq, GLASS_RATIOS, GLASS_GAINS, (tau, tau * .62, tau * .38, tau * .24), seconds, soft)


def glass_knock(midi, seed):
    return mix((ring(note(midi), (1, 2.32), (1, .12), (.009, .003), .1, .0008), 0, 1),
               (ring(note(midi - 12), (1,), (1,), (.012,), .1, .0008), 0, .6),
               (burst(.012, 800, 4000, .002, seed), 0, .05))


def verre():
    sounds = {}
    for i, midi in enumerate(scale_from(88)):
        sounds['select%d' % i] = mix((glass(note(midi), .05, .0065), 0, 1), (burst(.01, 5000, 12000, .0012, 'verre-tick%d' % i), 0, .09))
    sounds['edge'] = mix((ring(note(76), (1, 2.32), (1, .18), (.0045, .002), .06, .0005), 0, 1), (ring(note(64), (1,), (1,), (.007,), .06, .0005), 0, .55))
    sounds['switch'] = mix((glass(note(93), .08, .012), 0, 1), (glass(note(100), .074, .01), .006, .7), (burst(.02, 3000, 9000, .003, 'verre-switch'), 0, .06))
    sounds['ok'] = mix((glide(note(76), note(71), .12, .026, .003, ((2, .12),)), 0, 1), (glass(note(93), .118, .018, .002), .002, .3))
    sounds['back'] = mix((glide(note(71), note(76), .12, .026, .003, ((2, .12),)), 0, 1), (glass(note(88), .118, .018, .002), .002, .3))
    sheen_in = swell(note(93), note(93), .35, PANEL_IN) + .5 * swell(note(100), note(100), .35, PANEL_IN)
    sheen_out = swell(note(100), note(100), .25, PANEL_OUT) + .5 * swell(note(93), note(93), .25, PANEL_OUT)
    sounds['panelIn'] = fade_out(mix((breath(.35, 1700, 6500, .9, PANEL_IN, 'verre-in'), 0, 1), (norm(sheen_in), 0, .12)), .05)
    sounds['panelOut'] = fade_out(mix((breath(.25, 5200, 1500, .9, PANEL_OUT, 'verre-out'), 0, 1), (norm(sheen_out), 0, .1)), .05)
    sounds['wake'] = fade_out(ring(note(57), (1, 2, 4.25, 6.63), (1, .24, .1, .03), (.13, .07, .05, .025), .40, .01), .09)
    sounds['launch'] = fade_out(mix((glass(note(93), .3, .016), 0, .7), (glass(note(97), .3, .016), .05, .8), (glass(note(100), .25, .018), .1, .85),
                                    (glass(note(105), .2, .022), .15, .8), (breath(.35, 1500, 7000, 1, (.35, .1), 'verre-launch'), 0, .22)), .08)
    sounds['sourceOn'] = fade_out(mix((glass(note(88), .19, .04, .001), 0, 1), (glass(note(93), .19, .05, .001), .11, 1)), .05)
    sounds['sourceOff'] = fade_out(mix((glass(note(93), .19, .04, .001), 0, 1), (glass(note(88), .19, .05, .001), .11, 1)), .05)
    sounds['error'] = mix((glass_knock(76, 'verre-err1'), 0, 1), (glass_knock(73, 'verre-err2'), .095, .8))
    return sounds


# ---------- Galet: matt and round ----------
STONE_RATIOS = (1, 1.59, 2.26, 3.1)
STONE_GAINS = (1, .34, .12, .04)


def stone(freq, seconds, tau, soft=0.001):
    return ring(freq, STONE_RATIOS, STONE_GAINS, (tau, tau * .6, tau * .38, tau * .22), seconds, soft)


def galet():
    sounds = {}
    for i, midi in enumerate(scale_from(64)):
        sounds['select%d' % i] = mix((stone(note(midi), .05, .009), 0, 1), (burst(.01, 200, 2500, .002, 'galet-tick%d' % i), 0, .14))
    sounds['edge'] = mix((stone(note(57), .06, .011, .0015), 0, 1), (burst(.012, 150, 1100, .0025, 'galet-edge'), 0, .1))
    sounds['switch'] = mix((stone(note(69), .08, .015), 0, 1), (stone(note(76), .075, .013), .005, .7), (burst(.014, 200, 3000, .002, 'galet-switch'), 0, .1))
    sounds['ok'] = mix((glide(note(59), note(54), .12, .032, .004, ((2, .3), (3, .1))), 0, 1), (burst(.02, 150, 900, .005, 'galet-ok'), 0, .14))
    sounds['back'] = mix((glide(note(54), note(59), .12, .032, .004, ((2, .3), (3, .1))), 0, 1), (burst(.02, 150, 900, .005, 'galet-back'), 0, .14))
    sounds['panelIn'] = fade_out(mix((breath(.35, 320, 1300, .8, PANEL_IN, 'galet-in'), 0, 1), (swell(note(52), note(59), .35, PANEL_IN), 0, .3)), .05)
    sounds['panelOut'] = fade_out(mix((breath(.25, 1100, 300, .8, PANEL_OUT, 'galet-out'), 0, 1), (swell(note(59), note(52), .25, PANEL_OUT), 0, .3)), .05)
    sounds['wake'] = fade_out(ring(note(52), (1, 2, 3, 4), (1, .45, .16, .05), (.13, .08, .05, .03), .40, .014), .09)
    sounds['launch'] = fade_out(mix((stone(note(64), .3, .03), 0, .75), (stone(note(69), .28, .03), .055, .85), (stone(note(73), .24, .03), .11, .9),
                                    (stone(note(76), .18, .034), .165, .85), (breath(.35, 300, 1500, .9, (.35, .1), 'galet-launch'), 0, .25)), .08)
    sounds['sourceOn'] = fade_out(mix((stone(note(64), .19, .05, .002), 0, 1), (stone(note(69), .19, .06, .002), .11, 1)), .05)
    sounds['sourceOff'] = fade_out(mix((stone(note(69), .19, .05, .002), 0, 1), (stone(note(64), .19, .06, .002), .11, 1)), .05)
    sounds['error'] = mix((stone(note(54), .1, .016, .0015), 0, 1), (burst(.014, 150, 900, .003, 'galet-err1'), 0, .12),
                          (stone(note(52), .1, .016, .0015), .095, .85), (burst(.014, 150, 900, .003, 'galet-err2'), .095, .1))
    return sounds


# ---------- Goutte: supple, like water ----------
def drop(freq, seconds, tau, rise=1.35, bend=.022, soft=.0015, h2=.06):
    """Like a real drop, the note rises as it dies away."""
    return glide(freq / rise, freq, seconds, tau, soft, ((2, h2),), bend)


def riser(f0, f1, seconds):
    n = size(seconds)
    u = times(n) / seconds
    return norm(np.sin(2 * np.pi * np.cumsum(f0 * (f1 / f0) ** u) / RATE) * np.sqrt(u) * (1 - u) ** 1.5)


def goutte():
    sounds = {}
    for i, midi in enumerate(scale_from(76)):
        sounds['select%d' % i] = drop(note(midi), .05, .01)
    sounds['edge'] = glide(note(69), note(64), .06, .011, .002, (), .03)
    sounds['switch'] = mix((drop(note(81), .08, .012), 0, 1), (drop(note(88), .058, .01), .022, .65))
    sounds['ok'] = glide(note(73), note(66), .12, .03, .003, ((2, .1),), .06)
    sounds['back'] = glide(note(66), note(73), .12, .03, .003, ((2, .1),), .06)
    sounds['panelIn'] = fade_out(mix((breath(.35, 480, 2400, 3, PANEL_IN, 'goutte-in'), 0, 1), (swell(note(57), note(69), .35, PANEL_IN), 0, .25),
                                     (drop(note(81), .05, .012), .05, .35), (drop(note(85), .05, .012), .12, .3), (drop(note(88), .05, .012), .2, .22)), .05)
    sounds['panelOut'] = fade_out(mix((breath(.25, 1900, 420, 3, PANEL_OUT, 'goutte-out'), 0, 1), (swell(note(69), note(57), .25, PANEL_OUT), 0, .25),
                                      (drop(note(85), .05, .012), .03, .3), (drop(note(81), .05, .012), .09, .24)), .05)
    sounds['wake'] = fade_out(glide(note(57) / 1.25, note(57), .40, .14, .016, ((2, .22), (3, .05)), .07), .09)
    sounds['launch'] = fade_out(mix((riser(note(76), note(88), .35), 0, 1), (drop(note(81), .05, .012), .06, .3), (drop(note(85), .05, .012), .12, .3), (drop(note(88), .05, .012), .18, .26)), .06)
    sounds['sourceOn'] = fade_out(mix((drop(note(76), .19, .05, 1.2, .03), 0, 1), (drop(note(81), .19, .06, 1.2, .03), .11, 1)), .05)
    sounds['sourceOff'] = fade_out(mix((drop(note(81), .19, .05, 1.2, .03), 0, 1), (drop(note(76), .19, .06, 1.2, .03), .11, 1)), .05)
    sounds['error'] = mix((glide(note(66), note(66) * .93, .1, .016, .002, (), .05), 0, 1), (glide(note(64), note(64) * .93, .1, .016, .002, (), .05), .095, .85))
    return sounds


# ---------- Warmer and lower materials ----------
def partials(ratios, gains, decays):
    """A material: its modes, their strength, and their decay relative to the first."""
    def strike(freq, seconds, tau, soft):
        return ring(freq, ratios, gains, [tau * decay for decay in decays], seconds, soft)
    return strike


def pack(name, strike, touch, base, click, edge, switch, press, air, drone, wake, run, two, knock):
    """The same gestures for all these materials: only the body, the contact and the register change."""
    low, high, touch_tau, touch_gain = touch
    tau, soft = click

    def hit(midi, seconds, decay, seed):
        return mix((strike(note(midi), seconds, decay, soft), 0, 1), (burst(min(seconds, .014), low, high, touch_tau, name + seed), 0, touch_gain))

    def two_notes(first, second):
        return fade_out(mix((strike(note(first), .19, two[2], .002), 0, 1), (strike(note(second), .19, two[2] * 1.2, .002), .11, 1)), .05)

    sounds = {}
    for i, midi in enumerate(scale_from(base)):
        sounds['select%d' % i] = hit(midi, .07, tau, '-tick%d' % i)
    sounds['edge'] = hit(edge[0], .08, edge[1], '-edge')
    sounds['switch'] = mix((hit(switch[0], .08, switch[2], '-switch'), 0, 1), (strike(note(switch[1]), .075, switch[2] * .85, soft), .005, .7))
    top, bottom, press_tau, press_soft, harmonics = press
    sounds['ok'] = mix((glide(note(top), note(bottom), .12, press_tau, press_soft, harmonics), 0, 1), (burst(.02, low, high, .005, name + '-ok'), 0, touch_gain))
    sounds['back'] = mix((glide(note(bottom), note(top), .12, press_tau, press_soft, harmonics), 0, 1), (burst(.02, low, high, .005, name + '-back'), 0, touch_gain))
    sounds['panelIn'] = fade_out(mix((breath(.35, air[0], air[1], air[2], PANEL_IN, name + '-in'), 0, 1), (swell(note(drone[0]), note(drone[1]), .35, PANEL_IN), 0, drone[2])), .05)
    sounds['panelOut'] = fade_out(mix((breath(.25, air[1] * .85, air[0] * .94, air[2], PANEL_OUT, name + '-out'), 0, 1), (swell(note(drone[1]), note(drone[0]), .25, PANEL_OUT), 0, drone[2])), .05)
    sounds['wake'] = fade_out(strike(note(wake[0]), .40, wake[1], wake[2]), .09)
    steps = [(strike(note(midi), .3 - i * .03, run[1], soft), i * .055, .75 + i * .05) for i, midi in enumerate(run[0])]
    sounds['launch'] = fade_out(mix(*steps, (breath(.35, air[0], air[1] * 1.2, 1, (.35, .1), name + '-launch'), 0, .25)), .08)
    sounds['sourceOn'] = two_notes(two[0], two[1])
    sounds['sourceOff'] = two_notes(two[1], two[0])
    sounds['error'] = mix((hit(knock[0], .1, knock[2], '-err1'), 0, 1), (hit(knock[1], .1, knock[2], '-err2'), .095, .85))
    return sounds


def bois():
    """Warm, like a marimba bar: the mode almost two octaves up gives the knock of wood."""
    return pack('bois', partials((1, 3.93, 9.2), (1, .45, .1), (1, .4, .18)), (200, 1800, .002, .1), 57, (.013, .0012),
                (52, .012), (57, 64, .018), (64, 59, .034, .004, ((4, .22),)), (260, 1100, .8), (52, 59, .25),
                (45, .16, .012), ((57, 61, 64, 69), .03), (57, 64, .06), (54, 52, .018))


def feutre():
    """Very soft, like a felt piano hammer: slow attack, nothing at the top."""
    return pack('feutre', partials((1, 2.003, 3.01, 4.03), (1, .6, .3, .12), (1, .6, .4, .25)), (120, 700, .004, .08), 52, (.016, .005),
                (47, .014), (52, 59, .02), (59, 54, .036, .007, ((2, .3), (3, .08))), (200, 800, .7), (47, 52, .3),
                (45, .16, .02), ((52, 57, 61, 64), .032), (52, 57, .065), (52, 47, .02))


def bronze():
    """Low and resonant, like a metal bowl: two close modes beat gently on long notes."""
    return pack('bronze', partials((1, 2.71, 2.735, 5.15, 8.1), (1, .6, .45, .3, .1), (1, .7, .7, .4, .2)), (600, 5000, .001, .05), 45, (.02, .0008),
                (40, .016), (45, 52, .026), (52, 47, .04, .003, ((2, .45), (3, .25), (5, .1))), (240, 1000, 1.2), (45, 52, .3),
                (40, .17, .006), ((45, 49, 52, 57), .035), (45, 52, .07), (45, 42, .02))


def ardoise():
    """The lowest, dry: the harmonics carry the note even on a small speaker."""
    return pack('ardoise', partials((1, 2, 3, 4.02, 5.03), (1, .85, .6, .3, .14), (1, .8, .6, .4, .3)), (80, 500, .003, .12), 40, (.02, .0015),
                (37, .02), (45, 52, .024), (52, 47, .04, .004, ((2, .6), (3, .35), (4, .15))), (150, 650, .7), (40, 47, .45),
                (40, .16, .018), ((40, 45, 49, 52), .035), (45, 52, .065), (45, 42, .022))


# ---------- UI SFX packs ----------
def decoded(path):
    """afconvert comes with macOS, so nothing is installed. The leading silence goes, to stay with the key."""
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / 'son.wav'
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@%d' % RATE, '-c', '1', str(path), str(target)], check=True, capture_output=True)
        with wave.open(str(target)) as source:
            sound = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2') / 32768
    return sound[np.nonzero(np.abs(sound) > np.abs(sound).max() * 10 ** (-50 / 20))[0][0]:]


def repitch(sound, semitones):
    """Change the note by resampling: like a shorter bar, the sound shortens as it rises."""
    n = round(len(sound) / 2 ** (semitones / 12))
    return np.fft.irfft(np.fft.rfft(sound), n) * n / len(sound)


def uisfx(folder, pack):
    cue = lambda name: decoded(folder / 'sounds' / pack / (name + '.ogg'))
    hover = cue('hover')
    sounds = {'select%d' % i: repitch(hover, step) for i, step in enumerate(UISFX_STEPS)}
    for name, source in UISFX_CUES.items():
        sounds[name] = cue(source)
    return sounds


# ---------- Finishing ----------
def weighted(sound):
    """A-weighting, the ear's at low volume, with a floor for low notes."""
    n = len(sound) * 2
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    f2 = freqs ** 2 + 1e-9
    response = 12194 ** 2 * f2 ** 2 / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
    db = np.maximum(20 * np.log10(response + 1e-12) + 2.0, WEIGHT_FLOOR)
    return np.fft.irfft(np.fft.rfft(sound, n) * 10 ** (db / 20), n)


def level(sound):
    """Perceived level: the ear sums a very short sound over about 200 ms."""
    return 10 * np.log10(np.sum(weighted(sound) ** 2) / RATE / max(len(sound) / RATE, .2))


def loudest(sound):
    """For a sound with a long tail: its loudest 200 ms, or the tail would make it seem quiet."""
    window = size(.2)
    energy = weighted(sound)[:len(sound)] ** 2
    if len(energy) <= window:
        return 10 * np.log10(energy.sum() / RATE / .2)
    running = np.cumsum(energy)
    return 10 * np.log10((running[window:] - running[:-window]).max() / RATE / .2)


def gesture(name):
    return 'select' if name.startswith('select') else name


def finish(sound, name, limits, measure=level):
    out = sound[:size(limits[gesture(name)])].copy()
    out -= out.mean()
    # What stays under the threshold is no longer heard: cut there, then close at zero to avoid a click.
    above = np.nonzero(np.abs(out) > np.abs(out).max() * 10 ** (-60 / 20))[0]
    out = out[:above[-1] + 1]
    out = fade_out(out, len(out) / RATE / 4)
    out[0] = 0
    # The same perceived loudness across styles: the choice is about timbre, not force.
    out *= 10 ** ((TARGETS[gesture(name)] - measure(out)) / 20)
    # Unless low notes need too high a peak: headroom comes before equality.
    out *= min(1, 10 ** (PEAK_LIMIT / 20) / np.abs(out).max())
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--uisfx', type=Path, help='the folder of the uisfx package, which adds Zen')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    builders = {'verre': verre, 'goutte': goutte, 'galet': galet, 'bois': bois, 'feutre': feutre, 'bronze': bronze, 'ardoise': ardoise}
    if args.uisfx:
        for pack in UISFX_PACKS:
            builders[pack] = lambda pack=pack: uisfx(args.uisfx, pack)
    bank = {'rate': RATE, 'notes': NOTES, 'families': {}}
    print('%-8s %5s %6s %11s %12s %11s' % ('style', 'sounds', 'KiB', 'top peak', 'under target', 'select ms'))
    for family in builders:
        offset, chunks, table, peaks, short = 0, [], {}, [], []
        limits = LIMITS_LONG if family in LONG_CLICKS else LIMITS
        measure = level
        if family in UISFX_PACKS:
            limits, measure = UISFX_LIMITS, loudest
        for name, sound in builders[family]().items():
            out = finish(sound, name, limits, measure)
            peaks.append(20 * np.log10(np.abs(out).max()))
            short.append(TARGETS[gesture(name)] - measure(out))
            assert len(out) <= size(limits[gesture(name)])
            chunks.append(np.round(out * 32767).astype('<i2'))
            table[name] = [offset, len(out)]
            offset += len(out)
        data = np.concatenate(chunks)
        (args.output / (family + '.pcm')).write_bytes(data.tobytes())
        bank['families'][family] = {'file': family + '.pcm', 'sounds': table}
        print('%-8s %5d %6d %8.1f dB %9.1f dB %11.0f' % (family, len(table), data.size * 2 // 1024, max(peaks), max(short), table['select0'][1] / RATE * 1000))
    (args.output / 'bank.js').write_text('window.CleanFrameSounds = ' + json.dumps(bank, separators=(',', ':')) + ';\n')
    print('Review the output in', args.output, 'then copy it into app/assets/sounds/.')


if __name__ == '__main__':
    main()
