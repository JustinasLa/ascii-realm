"""Rebuild Seithr's recorded ice/air foley (Python, numpy, scipy, ffmpeg).

No synthesizers, procedural noise, pitch processing or artificial reverberation.
Uses the freely downloadable high-quality Freesound previews, with hash-checked
sources. Original previews are lossy MP3; exported game clips are 48 kHz PCM16.
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
OUT = ROOT / 'assets/audio/spells/seithr'
CACHE = Path(tempfile.gettempdir()) / 'ascii-seithr-sources'
SOURCES = [
    (549014, 'AlBundyX', 'Ice Fields Moving Rumbling', '135898', '7c39a302820f9740a845642cecc8d15f403cd96b9abe4fe2264fcad359b10045', 'CC0-1.0', 'Recorded on an ice field under a cardboard box; physical ice rumble and cracks.'),
    (733814, 'Salomé_Lubczanski', 'Ice cubes creaky', '7796757', 'b7a481f8f5a0b8905e12ddda12e89ee0c10976ab11572c6e7a72471e556865ea', 'CC0-1.0', 'Unedited ice cubes recorded with Aquarian H1a hydrophone and Sound Devices Mix-Pre 6 ii.'),
    (737896, 'Vrymaa', 'Ice - Lake fractures', '13973196', '54e53658a5feb0e4667b9f691d82f9cd7055a21230b4a3ab94a51cf12eceebe5', 'CC0-1.0', 'Close recording of frozen lake fractures; no added reverb or echo.'),
    (336765, 'luminadii', 'Snow crunch 01.WAV', '4040987', '15deece65cefc3520af3276a1123e38b9e203e7fe24773c47abe5127b4316d67', 'CC-BY-4.0', 'Snow crunching under feet; cropped individual crush and scuff.'),
    (403051, 'teadrinker', 'wind_forest_08_strong_l_01.wav', '338690', 'e83241dd2780ebb9771e6163deac01e731c2d0d9cea8f987755df45fbaa681e6', 'CC0-1.0', 'Wind through trees recorded with Zoom H4n in Rosendal, Nerikes Kil, Sweden.'),
    (726314, 'ZIP.Creates', 'wind 3', '5905747', '0c9fed1ecea6c199af34eafcfcd3474388aeea41acf7b1f69402f4bc02f1ca09', 'CC0-1.0', 'Physical breath blown gently across a Zoom H2n windscreen; recorded foley, not synthesis.'),
]
# name, source, start seconds, duration seconds, fade in/out seconds, target peak
CROPS = [
    ('ice-crack', 737896, 9.34, 1.20, .003, .08, .78),
    ('ice-split', 737896, 23.40, 1.45, .003, .12, .78),
    ('ice-strain', 549014, 3.05, 2.50, .025, .18, .72),
    ('ice-rumble', 549014, 5.90, 2.50, .05, .25, .72),
    ('ice-grit', 733814, .44, 1.18, .004, .10, .70),
    ('ice-tick', 733814, 4.39, .32, .003, .055, .62),
    ('snow-crush', 336765, .03, .72, .004, .08, .72),
    ('snow-scuff', 336765, 3.37, .75, .008, .10, .68),
    ('cold-breath', 726314, .10, 1.75, .08, .28, .58),
    ('wind-swell', 403051, 56.6, 2.40, .18, .38, .58),
]
SR = 48000


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    decoded, manifest = {}, {'family': 'seithr', 'sources': [], 'clips': []}
    for sid, artist, title, uid, digest, license_id, provenance in SOURCES:
        url = f'https://cdn.freesound.org/previews/{sid // 1000}/{sid}_{uid}-hq.mp3'
        path = CACHE / f'{sid}.mp3'
        if not path.exists():
            path.write_bytes(urllib.request.urlopen(url, timeout=60).read())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, f'Source changed: {sid}'
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1',
                                       '-ar', str(SR), '-f', 'f32le', '-'])
        decoded[sid] = np.frombuffer(raw, dtype='<f4').astype(np.float64)
        manifest['sources'].append(dict(id=sid, artist=artist, title=title,
            page=f'https://freesound.org/s/{sid}/', download=url, sha256=digest,
            license=license_id, licenseUrl='https://creativecommons.org/licenses/by/4.0/'
            if license_id == 'CC-BY-4.0' else 'https://creativecommons.org/publicdomain/zero/1.0/',
            verified='2026-10-22', provenance=provenance, format='Freesound HQ MP3 preview'))
    for name, sid, start, duration, fade_in, fade_out, target in CROPS:
        audio = decoded[sid][round(start * SR):round((start + duration) * SR)].copy()
        assert len(audio) == round(duration * SR)
        # Remove infrasonic/DC offset only, retaining the recorded transient detail.
        audio = sosfiltfilt(butter(2, 22, btype='highpass', fs=SR, output='sos'), audio)
        audio -= audio.mean()
        audio[:round(fade_in * SR)] *= np.linspace(0, 1, round(fade_in * SR))
        audio[-round(fade_out * SR):] *= np.linspace(1, 0, round(fade_out * SR))
        audio *= target / max(np.max(np.abs(audio)), 1e-8)
        pcm = np.round(audio * 32767).astype('<i2')
        path = OUT / f'{name}.wav'
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, SR, len(pcm), 'NONE', 'not compressed'))
            output.writeframes(pcm.tobytes())
        manifest['clips'].append(dict(file=path.name, sourceId=sid, start=start,
            duration=duration, sampleRate=SR, channels=1, bits=16,
            fadeIn=fade_in, fadeOut=fade_out, highpassHz=22,
            peak=float(np.max(np.abs(pcm.astype(float))) / 32768),
            rms=float(np.sqrt(np.mean((pcm.astype(float) / 32768) ** 2))),
            sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        print(f'{name}: {duration:.2f}s, peak {target:.2f}')
    (OUT / 'sources.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    credits = ['# Seithr recorded foley sources', '',
        'All clips are derived from real field/foley recordings. No synthesized sound is included.',
        'The game clips are mono 48 kHz PCM16 crops of Freesound HQ MP3 previews.',
        'Changes: crop, mono downmix, 22 Hz high-pass/DC removal, short endpoint fades and peak normalization.',
        'No endorsement by the original artists is implied.', '']
    for source in manifest['sources']:
        credits += [f"- **{source['title']}** by **{source['artist']}**, [Freesound]({source['page']}), "
                    f"[{source['license']}]({source['licenseUrl']}). {source['provenance']}"]
    credits += ['', 'Exact source hashes, crop positions and derived-file hashes are in `sources.json`.',
                'Rebuild with `python tools/render-spell-audio-seithr.py` (numpy, scipy and ffmpeg required).', '']
    (OUT / 'LICENSE.md').write_text('\n'.join(credits), encoding='utf8')


if __name__ == '__main__':
    main()
