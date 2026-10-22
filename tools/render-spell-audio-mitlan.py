"""Reproduce Mitlan's restrained current and pressure cues. Requires numpy/scipy and ffmpeg.

Run: python tools/render-spell-audio-mitlan.py [--sources PATH]
Downloads missing CC0 source recordings into PATH. Each spell has its own
material, envelope and rhythm. No boiling, splashes or drops.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import wave
import numpy as np
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'swish.mp3': ('Swosh / Whoosh / Air Cut', 'qubodup', 'https://freesound.org/people/qubodup/sounds/60030/', 'https://cdn.freesound.org/previews/60/60030_71257-hq.mp3'),
    'cloth.mp3': ('Cloth Flapping On A Clothesline Thickly', 'leonelmail', 'https://freesound.org/people/leonelmail/sounds/330638/', 'https://cdn.freesound.org/previews/330/330638_4437257-hq.mp3'),
    'crack.mp3': ('Wood Crack 5', 'utsuru', 'https://freesound.org/people/utsuru/sounds/183450/', 'https://cdn.freesound.org/previews/183/183450_418644-hq.mp3'),
    'thunder.ogg': ('Rain + Long Thunder', 'WuxiaScrub', 'https://opengameart.org/content/rain-long-thunder', 'https://opengameart.org/sites/default/files/rain-thunder.ogg'),
    'creak.mp3': ('Wood Creak Single V7', 'Rudmer_Rotteveel', 'https://freesound.org/people/Rudmer_Rotteveel/sounds/506662/', 'https://cdn.freesound.org/previews/506/506662_4921277-hq.mp3'),
    'logs.mp3': ('Wood logs - woodshed', 'Vrymaa', 'https://freesound.org/people/Vrymaa/sounds/734628/', 'https://cdn.freesound.org/previews/734/734628_13973196-hq.mp3'),
    'leaves.mp3': ('Autumn leaves falling on forest floor', 'Mjeno', 'https://freesound.org/people/Mjeno/sounds/405136/', 'https://cdn.freesound.org/previews/405/405136_3958938-hq.mp3'),
    'branches.mp3': ('Dried branches', 'Vrymaa', 'https://freesound.org/people/Vrymaa/sounds/734627/', 'https://cdn.freesound.org/previews/734/734627_13973196-hq.mp3'),
    'dirt.mp3': ('BODY FALL - V HVY - DIRT', 'leonelmail', 'https://freesound.org/people/leonelmail/sounds/504626/', 'https://cdn.freesound.org/previews/504/504626_4437257-hq.mp3'),
    'jacket.mp3': ('Foley_Whoosh_Clothes.wav', 'Nox_Sound', 'https://freesound.org/people/Nox_Sound/sounds/495390/', 'https://cdn.freesound.org/previews/495/495390_9250976-hq.mp3'),
    'breath.mp3': ('wind 3', 'ZIP.Creates', 'https://freesound.org/people/ZIP.Creates/sounds/726314/', 'https://cdn.freesound.org/previews/726/726314_5905747-hq.mp3'),
    'wind.mp3': ('wind_forest_08_strong_l_01.wav', 'teadrinker', 'https://freesound.org/people/teadrinker/sounds/403051/', 'https://cdn.freesound.org/previews/403/403051_338690-hq.mp3'),
}
# filename, source, crop start/duration, fade-in/out, peak, high/low-pass Hz, reverse
CLIPS = [
    ('current-rise', 'cloth.mp3', 12.57, .70, .20, .20, .50, 320, 2600, True),
    ('shell-hit', 'crack.mp3', .04, .45, .016, .28, .52, 420, 1900, False),
    ('deep-fold', 'cloth.mp3', 12.72, .85, .24, .38, .48, 240, 1200, True),
    ('thunder-clap', 'thunder.ogg', 21.38, 1.4, .018, .70, .58, 170, 3200, False),
    ('storm-air', 'swish.mp3', 0, .436, .15, .16, .46, 800, 4200, True),
    # Tide Shard: a thin forward cut and an extremely short, dry tick.
    ('needle-cut', 'swish.mp3', .06, .24, .008, .09, .50, 1700, 5200, False),
    ('shard-tick', 'crack.mp3', .04, .16, .003, .10, .48, 1800, 4800, False),
    # Bubble Shard: the moving formants of timber strain act as a taut membrane.
    ('membrane-flex', 'creak.mp3', .14, .58, .07, .22, .48, 520, 1450, True),
    ('hollow-pop', 'creak.mp3', .64, .22, .006, .16, .50, 650, 1350, False),
    # Scalding Wave: one continuous airy release, with no percussive wood layer.
    ('steam-draw', 'breath.mp3', .2, .72, .23, .15, .46, 1900, 5000, True),
    ('steam-cut', 'breath.mp3', .9, .52, .012, .40, .48, 1600, 4600, False),
    # Tidal Shield: low-mid cavity resonance followed by a firm single knock.
    ('shell-bow', 'logs.mp3', .30, .65, .25, .13, .48, 190, 700, True),
    ('shield-knock', 'logs.mp3', .30, .38, .005, .25, .54, 220, 1100, False),
    # Glyph: dry textured strokes and tiny marks, phrased in groups of three.
    ('glyph-trace', 'leaves.mp3', 7.52, .22, .015, .08, .46, 1100, 3200, False),
    ('glyph-mark', 'branches.mp3', 1.04, .14, .003, .09, .48, 900, 3600, False),
    # Crashing Wave: broad jacket displacement and a granular ground impact.
    ('crest-push', 'jacket.mp3', .02, .62, .07, .22, .50, 380, 2500, False),
    ('breaker-hit', 'dirt.mp3', .12, .55, .008, .30, .55, 250, 2400, False),
    # Maelstrom: wind turns in three deep amplitude lobes, then folds inward.
    ('vortex-turn', 'wind.mp3', 56.6, .96, .10, .15, .50, 300, 1700, False),
    ('vortex-collapse', 'wind.mp3', 57.5, .68, .04, .30, .50, 260, 1250, True),
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, default=ROOT / '.cache/mitlan-audio')
    args = parser.parse_args()
    args.sources.mkdir(parents=True, exist_ok=True)
    target = ROOT / 'assets/audio/spells/mitlan'
    target.mkdir(parents=True, exist_ok=True)
    decoded, sources = {}, []
    for filename, (title, author, page, download) in SOURCES.items():
        path = args.sources / filename
        if not path.exists():
            urllib.request.urlretrieve(download, path)
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
            '-ar', '44100', '-ac', '1', '-f', 'f32le', '-'])
        decoded[filename] = np.frombuffer(raw, dtype='<f4').astype(np.float64)
        sources.append(dict(file=filename, title=title, author=author, page=page,
            download=download, license='CC0-1.0', sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    clips = []
    for name, source, start, duration, fade_in, fade_out, peak, high_pass, low_pass, reverse in CLIPS:
        samples = decoded[source][round(start*44100):round((start+duration)*44100)].copy()
        assert len(samples) == round(duration*44100), name
        samples -= samples.mean()
        samples = sosfiltfilt(butter(3, [high_pass, low_pass], btype='bandpass', fs=44100, output='sos'), samples)
        if reverse:
            samples = samples[::-1].copy()
        envelope = np.ones(len(samples))
        a, b = round(fade_in*44100), round(fade_out*44100)
        envelope[:a] = np.sin(np.linspace(0, np.pi/2, a))**2
        envelope[-b:] = np.cos(np.linspace(0, np.pi/2, b))**2
        # Modulate the recording's amplitude, without adding a tonal source.
        modulation_hz = 3.5 if name == 'vortex-turn' else 0
        if modulation_hz:
            envelope *= .18 + .82 * np.sin(np.arange(len(samples)) / 44100 * np.pi * modulation_hz)**2
        samples *= envelope
        # Remove any DC introduced by the fade without reopening its endpoints.
        samples -= envelope * samples.sum()/envelope.sum()
        samples *= peak / np.max(np.abs(samples))
        rms_ceiling = .11
        samples *= min(1, rms_ceiling / max(np.sqrt(np.mean(samples*samples)), 1e-9))
        data = np.rint(samples*32767).astype('<i2')
        path = target / (name+'.wav')
        with wave.open(str(path), 'wb') as wav:
            wav.setparams((1, 2, 44100, len(data), 'NONE', 'not compressed'))
            wav.writeframes(data.tobytes())
        clips.append(dict(file=name+'.wav', source=source, start=start, duration=duration,
            fadeIn=fade_in, fadeOut=fade_out, peak=peak, rmsCeiling=rms_ceiling,
            highPassHz=high_pass, lowPassHz=low_pass, reversed=reverse,
            modulationHz=modulation_hz, sampleRate=44100,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        print(name, len(samples)/44100, 'sec', path.stat().st_size, 'bytes')
    manifest = dict(license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
        processing='44.1 kHz mono PCM16; DC removal, third-order zero-phase bandpass, optional reversal and amplitude modulation, sine/cosine fades, peak and RMS ceilings. No generated sound. Each spell uses dedicated material and phrasing; no boiling, splashes, droplets or wading sources.',
        sources=sources, clips=clips)
    (target/'sources.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    notice = ['Mitlan recorded spell foley', '', 'All sources: Creative Commons CC0 1.0 Universal.',
        manifest['licenseUrl'], '', 'Source pages and licenses verified 2026-10-22.',
        'Freesound inputs are public HQ MP3 previews; original source rates may be higher.',
        'Thunder uses the original OGG download. Output is 44,100 Hz mono 16-bit PCM.', '']
    for entry in sources:
        notice += [entry['title']+' by '+entry['author'], entry['page'], entry['download'], '']
    notice += [manifest['processing'], 'Exact crops, fades, input/output checksums: sources.json.',
        'Reproduction: python tools/render-spell-audio-mitlan.py --sources PATH', '']
    (target/'LICENSE.txt').write_text('\n'.join(notice), encoding='utf-8')

if __name__ == '__main__':
    main()
