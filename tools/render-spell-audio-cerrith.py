"""Rebuild Cerrith's recorded foley; requires Python, numpy, scipy and ffmpeg.

Run from any directory: python tools/render-spell-audio-cerrith.py
Verified public HQ previews are cached outside the checkout. No synthesis,
pitch conversion, compression or bit-depth effects are used in these assets.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import wave

import numpy as np
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets/audio/spells/cerrith'
CACHE = Path(tempfile.gettempdir()) / 'ascii-cerrith-foley'


def main():
    manifest = json.loads((DEST / 'sources.json').read_text(encoding='utf-8'))
    rate = manifest['sampleRate']
    CACHE.mkdir(exist_ok=True)
    decoded = {}
    for source in manifest['sources']:
        path = CACHE / (source['id'] + '.mp3')
        if not path.exists():
            with urllib.request.urlopen(source['url'], timeout=60) as response:
                path.write_bytes(response.read())
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != source['sha256']:
            raise ValueError(f"Source checksum mismatch: {source['id']}")
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
            '-f', 'f32le', '-ac', '1', '-ar', str(rate), 'pipe:1'])
        samples = np.frombuffer(raw, dtype='<f4').astype(np.float64)
        # A gentle subsonic cleanup preserves the recorded grain and attack.
        decoded[source['id']] = sosfiltfilt(butter(2, 28, 'highpass', fs=rate, output='sos'), samples)

    for crop in manifest['crops']:
        start = round(crop['start'] * rate)
        count = round(crop['duration'] * rate)
        audio = decoded[crop['source']][start:start + count].copy()
        if len(audio) != count:
            raise ValueError(f"Crop exceeds source: {crop['file']}")
        audio -= np.mean(audio)
        entry, tail = round(.004 * rate), round(.055 * rate)
        audio[:entry] *= np.sin(np.linspace(0, np.pi / 2, entry)) ** 2
        audio[-tail:] *= np.cos(np.linspace(0, np.pi / 2, tail)) ** 2
        # Remove residual mean introduced by fades without disturbing endpoints.
        window = np.sin(np.linspace(0, np.pi, count)) ** 2
        audio -= np.sum(audio) / np.sum(window) * window
        audio *= crop['peak'] / max(float(np.max(np.abs(audio))), 1e-12)
        pcm = np.rint(audio * 32767).astype('<i2')
        with wave.open(str(DEST / crop['file']), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate)
            output.writeframes(pcm.tobytes())
        crop['sha256'] = hashlib.sha256((DEST / crop['file']).read_bytes()).hexdigest()
        print(f"{crop['file']}: {crop['duration']:.2f}s, peak {np.max(np.abs(pcm.astype(float))) / 32768:.3f}")
    (DEST / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    credits = ['Cerrith recorded spell foley', '',
        'All seven source recordings: Creative Commons CC0 1.0 Universal.', manifest['licenseUrl'], '',
        'Downloaded public high-quality previews; original source files may require a Freesound account.',
        'The previews are lossy source encodings; exported WAV files are 48 kHz mono 16-bit PCM.', '']
    for source in manifest['sources']:
        credits.extend([source['title'], source['source'], 'Public preview: ' + source['url'],
            'Source SHA-256: ' + source['sha256'], ''])
    credits.extend(['Adaptations: exact crops in sources.json; mono resampling at 48 kHz;',
        '28 Hz high-pass, DC removal, 4 ms entry and 55 ms exit fades, linear peak balancing.',
        'No synthetic tones/noise, bit crushing, compression, reverse playback or artificial reverb.',
        'Wood creak is recorded floor timber; branches are twisted twigs/herbs; leaves are a forest',
        'field recording; logs are heavy timber impacts; cloth is a recorded jacket whoosh;',
        'water is poured into a glass; earth impact is a heavy body landing on dirt.',
        'Names describe their role in the spell mix; no claim of recording magical objects.',
        'Rebuild: python tools/render-spell-audio-cerrith.py (numpy, scipy, ffmpeg required).', ''])
    (DEST / 'LICENSE.txt').write_text('\n'.join(credits), encoding='utf-8')


if __name__ == '__main__':
    main()
