"""Shape licensed movement recordings into Oseni's dark, non-burning spell bank.

Requires Python, numpy, scipy, and ffmpeg. No fire or blowtorch recordings.
Band-limited air, cloth and muted impacts keep weight above sub-bass; reverse
swells and shaped decays give the magic a voice without a continuous burn bed.
Run from any directory; --source-dir may point at an existing download cache.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/audio/spells/oseni'
SOURCES = [
    ('swish', 'Swosh / Whoosh / Air Cut', 'qubodup', '60030', '71257', 'Bamboo stick swung through air; Zoom H2.'),
    ('crack', 'Wood Crack 5', 'utsuru', '183450', '418644', 'Real cracking wood recorded with Zoom H4N.'),
    ('cloth', 'Cloth Flapping On A Clothesline Thickly', 'leonelmail', '330638', '4437257', 'Real cloth movement; source itself is a 128 kbps MP3.'),
    ('thunder', 'Thunder Clap And Rumble #1', 'Kinoton', '397952', '2247456', 'Real medium-distance lightning strike, DR-60D MkII and Mk 012 microphones; source denoised/compressed.'),
]
# output, source, start, seconds, entry fade, exit fade, peak, high-pass, low-pass, reverse
CROPS = [
    ('air-draw', 'swish', 0.0, 0.436, 0.16, 0.09, 0.52, 180, 1700, True),
    ('air-release', 'swish', 0.0, 0.436, 0.025, 0.20, 0.55, 200, 2400, False),
    ('muted-hit', 'crack', 0.04, 0.48, 0.018, 0.29, 0.55, 180, 1400, False),
    ('pressure', 'thunder', 1.20, 0.80, 0.045, 0.48, 0.52, 170, 850, False),
    ('wing-sweep', 'cloth', 12.57, 0.65, 0.035, 0.28, 0.52, 210, 1800, False),
    ('dark-swell', 'thunder', 3.0, 0.90, 0.34, 0.30, 0.48, 200, 1200, True),
    ('soft-return', 'cloth', 12.72, 0.45, 0.12, 0.24, 0.42, 260, 1300, True),
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT.parent / 'ascii-tools/oseni-recorded-sources')
    args = parser.parse_args()
    args.source_dir.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    sources = []
    for name, title, author, sid, uid, description in SOURCES:
        url = f'https://freesound.org/people/{author}/sounds/{sid}/'
        preview = f'https://cdn.freesound.org/previews/{int(sid)//1000}/{sid}_{uid}-hq.mp3'
        path = args.source_dir / f'{name}.mp3'
        if not path.exists():
            request = urllib.request.Request(preview, headers={'User-Agent': 'ASCII-Realm-audio-build/1.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                path.write_bytes(response.read())
        decoded = args.source_dir / f'{name}-48k.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-ac', '1', '-ar', '48000', str(decoded)], check=True)
        sources.append(dict(id=name, title=title, author=author, source=url, download=preview,
            license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
            recording=description, originalPreviewSha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    clips = []
    for name, source, start, duration, fade_in, fade_out, peak, high_pass, low_pass, reverse in CROPS:
        sr, pcm = wavfile.read(args.source_dir / f'{source}-48k.wav')
        data = pcm[round(start * sr):round((start + duration) * sr)].astype(np.float64) / 32768
        assert len(data) == round(duration * sr), name
        data -= data.mean()
        # Offline zero-phase filtering avoids adding a new runtime effect graph.
        data = sosfiltfilt(butter(3, [high_pass, low_pass], btype='bandpass', fs=sr, output='sos'), data)
        if reverse:
            data = data[::-1].copy()
        entry, tail = round(fade_in * sr), round(fade_out * sr)
        data[:entry] *= np.sin(np.linspace(0, np.pi / 2, entry)) ** 2
        data[-tail:] *= np.cos(np.linspace(0, np.pi / 2, tail)) ** 2
        data *= peak / max(np.max(np.abs(data)), 1e-9)
        # A dense rumble must not become louder than a short air transient.
        data *= min(1, 0.12 / max(np.sqrt(np.mean(data * data)), 1e-9))
        data[0] = data[-1] = 0
        path = OUT / f'{name}.wav'
        wavfile.write(path, sr, np.round(data * 32767).astype(np.int16))
        clips.append(dict(file=path.name, source=source, startSeconds=start, durationSeconds=duration,
            fadeInSeconds=fade_in, fadeOutSeconds=fade_out, peak=peak, rmsCeiling=0.12,
            highPassHz=high_pass, lowPassHz=low_pass, reversed=reverse, sampleRate=sr,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    manifest = dict(format='mono PCM16 WAV at 48000 Hz', sources=sources, clips=clips,
        processing='HQ MP3 previews decoded at 48 kHz, mono downmix, DC removed, cropped, third-order zero-phase bandpass, optional reversal, cosine fades, peak ceiling and 0.12 RMS ceiling. No fire sources, generated waveform or added noise.',
        previewNote='The public high-quality MP3 previews are used; these are compressed source files, not claimed to be original lossless masters.')
    (OUT / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    license_lines = ['Oseni dark movement and impact bank', '', 'All source recordings are CC0 1.0 Universal.',
        'https://creativecommons.org/publicdomain/zero/1.0/',
        'Source licenses verified on the linked Freesound pages on 2026-10-22.',
        'Credits are supplied for provenance even though CC0 does not require attribution.', '']
    for source in sources:
        license_lines += [f'"{source["title"]}" by {source["author"]}', source['source'], source['recording'], '']
    license_lines += [manifest['processing'], manifest['previewNote'],
        'See sources.json for exact download URLs, SHA-256 values and per-file crop/fade details.',
        'Rebuild: python tools/render-spell-audio-oseni.py', '']
    (OUT / 'LICENSE.txt').write_text('\n'.join(license_lines), encoding='utf8')
    print(json.dumps(clips, indent=2))

if __name__ == '__main__':
    main()
