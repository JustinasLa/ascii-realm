"""Reproduce Mitlan's real foley crops. Requires Python/numpy and ffmpeg.

Run: python tools/render-spell-audio-mitlan.py [--sources PATH]
Downloads missing CC0 source recordings into PATH (default .cache/mitlan-audio).
No oscillators, generated noise, pitch sweeps, reversal or resynthesis.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'wading.mp3': ('Walking through water', 'rosenberg3', 'https://freesound.org/people/rosenberg3/sounds/627004/', 'https://cdn.freesound.org/previews/627/627004_13855267-hq.mp3'),
    'splash-small.mp3': ('Water splash, emptying a bucket 2', 'wormer2', 'https://freesound.org/people/wormer2/sounds/415670/', 'https://cdn.freesound.org/previews/415/415670_2383863-hq.mp3'),
    'splash-medium.mp3': ('Water splash, emptying a bucket 3', 'wormer2', 'https://freesound.org/people/wormer2/sounds/415669/', 'https://cdn.freesound.org/previews/415/415669_2383863-hq.mp3'),
    'boiling.mp3': ('Boiling water.wav', 'xenognosis', 'https://freesound.org/people/xenognosis/sounds/137229/', 'https://cdn.freesound.org/previews/137/137229_2515465-hq.mp3'),
    'thunder.ogg': ('Rain + Long Thunder', 'WuxiaScrub', 'https://opengameart.org/content/rain-long-thunder', 'https://opengameart.org/sites/default/files/rain-thunder.ogg'),
}
# filename, source, crop start/duration, fade-in/out, peak
CLIPS = [
    ('water-strike', 'splash-small.mp3', .31, .85, .004, .16, .80),
    ('breaker', 'splash-medium.mp3', .10, 2.68, .004, .30, .84),
    ('wash', 'splash-small.mp3', 1.18, 1.05, .025, .18, .68),
    ('water-lift', 'wading.mp3', .52, .62, .012, .10, .72),
    ('droplets', 'wading.mp3', 2.315, .56, .008, .10, .62),
    ('boil', 'boiling.mp3', 3.0, 1.5, .035, .22, .72),
    ('bubbles', 'boiling.mp3', 7.1, .68, .02, .14, .68),
    ('thunder-clap', 'thunder.ogg', 21.38, 4.8, .004, .8, .84),
    ('storm-rain', 'thunder.ogg', 5.0, .9, .04, .18, .62),
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
    for name, source, start, duration, fade_in, fade_out, peak in CLIPS:
        samples = decoded[source][round(start*44100):round((start+duration)*44100)].copy()
        assert len(samples) == round(duration*44100), name
        samples -= samples.mean()
        envelope = np.ones(len(samples))
        a, b = round(fade_in*44100), round(fade_out*44100)
        envelope[:a] = np.sin(np.linspace(0, np.pi/2, a))**2
        envelope[-b:] = np.cos(np.linspace(0, np.pi/2, b))**2
        samples *= envelope
        # Remove any DC introduced by the fade without reopening its endpoints.
        samples -= envelope * samples.sum()/envelope.sum()
        samples *= peak / np.max(np.abs(samples))
        data = np.rint(samples*32767).astype('<i2')
        path = target / (name+'.wav')
        with wave.open(str(path), 'wb') as wav:
            wav.setparams((1, 2, 44100, len(data), 'NONE', 'not compressed'))
            wav.writeframes(data.tobytes())
        clips.append(dict(file=name+'.wav', source=source, start=start, duration=duration,
            fadeIn=fade_in, fadeOut=fade_out, peak=peak, sampleRate=44100,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        print(name, len(samples)/44100, 'sec', path.stat().st_size, 'bytes')
    manifest = dict(license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
        processing='44.1 kHz mono PCM16; DC removal, sine/cosine fades, peak balance only; no generated sound.',
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
