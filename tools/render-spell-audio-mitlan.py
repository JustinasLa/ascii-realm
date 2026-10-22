"""Reproduce Mitlan's restrained current and pressure cues. Requires numpy/scipy and ffmpeg.

Run: python tools/render-spell-audio-mitlan.py [--sources PATH]
Downloads missing CC0 source recordings into PATH. Movement carries the spells;
only a quiet, filtered wash tail remains as a hint of water. No boiling or drops.
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
    'splash-small.mp3': ('Water splash, emptying a bucket 2', 'wormer2', 'https://freesound.org/people/wormer2/sounds/415670/', 'https://cdn.freesound.org/previews/415/415670_2383863-hq.mp3'),
    'thunder.ogg': ('Rain + Long Thunder', 'WuxiaScrub', 'https://opengameart.org/content/rain-long-thunder', 'https://opengameart.org/sites/default/files/rain-thunder.ogg'),
}
# filename, source, crop start/duration, fade-in/out, peak, high/low-pass Hz, reverse
CLIPS = [
    ('current-rise', 'cloth.mp3', 12.57, .70, .20, .20, .50, 320, 2600, True),
    ('current-pass', 'swish.mp3', 0, .436, .025, .20, .52, 350, 3200, False),
    ('shell-hit', 'crack.mp3', .04, .45, .016, .28, .52, 420, 1900, False),
    ('undertow', 'splash-small.mp3', 1.5, .65, .16, .32, .40, 320, 1050, True),
    ('deep-fold', 'cloth.mp3', 12.72, .85, .24, .38, .48, 240, 1200, True),
    ('thunder-clap', 'thunder.ogg', 21.38, 1.4, .018, .70, .58, 170, 3200, False),
    ('storm-air', 'swish.mp3', 0, .436, .15, .16, .46, 800, 4200, True),
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
        samples *= envelope
        # Remove any DC introduced by the fade without reopening its endpoints.
        samples -= envelope * samples.sum()/envelope.sum()
        samples *= peak / np.max(np.abs(samples))
        rms_ceiling = .05 if name == 'undertow' else .11
        samples *= min(1, rms_ceiling / max(np.sqrt(np.mean(samples*samples)), 1e-9))
        data = np.rint(samples*32767).astype('<i2')
        path = target / (name+'.wav')
        with wave.open(str(path), 'wb') as wav:
            wav.setparams((1, 2, 44100, len(data), 'NONE', 'not compressed'))
            wav.writeframes(data.tobytes())
        clips.append(dict(file=name+'.wav', source=source, start=start, duration=duration,
            fadeIn=fade_in, fadeOut=fade_out, peak=peak, rmsCeiling=rms_ceiling,
            highPassHz=high_pass, lowPassHz=low_pass, reversed=reverse, sampleRate=44100,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        print(name, len(samples)/44100, 'sec', path.stat().st_size, 'bytes')
    manifest = dict(license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
        processing='44.1 kHz mono PCM16; DC removal, third-order zero-phase bandpass, optional reversal, sine/cosine fades, peak and RMS ceilings. No generated sound. Water is limited to a filtered wash tail; no boiling, droplets or wading sources.',
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
