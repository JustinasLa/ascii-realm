# Audio

ASCII Realm creates its soundtrack and effects with Web Audio oscillators and
filtered noise. All compositions and sound recipes are original; there are no
audio downloads, samples, media assets or additional dependencies.

Sound starts after the first keyboard or pointer gesture. `M` toggles mute, and
the Audio panel offers master, music, effects, sword and ambience sliders. The
Sword control changes sword effects and charge independently; its bus feeds the
Effects bus, so Effects and Master also affect it. The panel shows the current
song and offers a Skip song button with the `N` shortcut. Mute and
levels are stored in `localStorage` under `ascii-realm.audio`; blocked storage
does not prevent controls from working. Saved mute is applied before playback.

## Structure

- `src/audio/audio.js` connects animation events and environment signals to
  sounds, sets the listener at the camera and pauses sustained voices when
  playback stops. `controls.js` binds the persistent Audio panel, keyboard
  shortcuts, first-gesture unlock and visibility handling.
- `src/audio/engine.js` creates the audio context lazily and connects independent
  music, SFX and ambience gain buses through the master bus. It owns preference
  persistence, listener position, positional routes and context teardown. The
  sword gain bus feeds SFX for both separate sword adjustment and overall effects
  control.
- `voices.js` provides enveloped oscillator tones, filtered noise bursts,
  sustained noise beds and parameter smoothing. A deterministic, two-second
  noise buffer is shared by voices in each context; short cues start at varied
  positions in that buffer to vary the grain without allocating new samples.
- `footsteps.js` layers close, unpitched material textures: dry boot contact
  and brief grass-blade rustle, compressed dirt and grit, dense sand drag,
  low stone contact and sole scrape, or shallow-water splash and runoff. Broad
  filters, falling envelopes and small timing/level variations keep them earthy.
  Footfalls follow animation contact events rather than an independent timer.
- `movement.js` uses short, close filtered-noise textures for cloth/leather
  tension on jumping, weight and damped surface resonance on landing, and quiet
  brushes on skidding. Skid particles can arrive every frame, so scrape grains
  are limited to ten per second. Fast attacks decay to low sustain levels and
  soft releases, leaving space for the music.
- `sword.js` supplies draw, sheathe, swing, slam and spinning-slash sounds. Its
  filtered-noise layers combine weathered steel scrapes, leather handling,
  broad air rush, a low pressure wake and deeply damped impact grit. `ChargeHum`
  maintains a quiet low air texture, with slow filter and playback-rate drift,
  during a held charge and releases it smoothly when charging ends. All sword
  sounds use the `sword` bus.
- `environment.js` samples the same gust noise field as rendered grass,
  nearby lake position and an audio day/night cycle. Water searches are bounded
  to a local radius and reused between samples.
- `ambience.js` layers slowly breathing low wind, soft grass/leaf rustle and
  occasional gust textures, alongside quieter positional lake beds. Its sparse,
  distant outdoor calls use softened attacks and filtered decays, and include
  daytime birds and insect chirrs, nighttime crickets and owl hoots, frogs near
  lakes, rare distant deer-like calls and nearby insect buzz/clicks. It also adds
  rare nighttime filtered-noise glints when a nearby rendered firefly pulse is
  bright. Wildlife calls are synthesized atmosphere; they do not add visible
  animal entities.
- `songs.js` contains immutable authored note events and instrument recipes;
  `music.js` schedules the selected day/night pair against the audio clock and
  blends its two tracks through dedicated gain nodes and a shared room into the
  music bus. `music-voices.js` supplies soft music envelopes, drifting oscillator
  layers and the procedurally generated convolution reverb.

Positioned sources use stereo pan and distance attenuation relative to the
camera, correcting for the width/height aspect ratio of world cells. Browsers
without stereo-panner support retain distance attenuation. Shore cells touching
a lake produce wet footsteps; other shore cells produce sand. Deep lake
collision remains unchanged.

The audio day/night signal cycles every 240 simulation seconds, beginning at
night. Music crossfades between day and night arrangements as this signal
changes. The existing visual scene remains moonlit.

## Songs

The six songs form three pairs in the order shown below. Skip song or `N`
advances to the next pair and wraps after the third. The day/night signal still
selects the blend within that pair; the title shows the dominant arrangement.
An audible skip fades the old pair out and the new pair in over 0.32 seconds.
`Music.skip()` can also select a pair while audio is locked without creating
an audio context.

| Song | Setting | Key | Tempo | Loop |
| --- | --- | --- | --- | --- |
| Runes in the Mist | Day | D Aeolian | 54 BPM | 16 bars / 64 beats / about 71.11 seconds |
| Beneath the Veil | Night | D Aeolian | 54 BPM | 16 bars / 64 beats / about 71.11 seconds |
| The Sealed Gate | Day | E Phrygian | 50 BPM | 16 bars / 64 beats / 76.8 seconds |
| Whispers of the Deep | Night | E Phrygian | 50 BPM | 16 bars / 64 beats / 76.8 seconds |
| Forgotten Sanctum | Day | A harmonic minor | 56 BPM | 16 bars / 64 beats / about 68.57 seconds |
| Embers of the Covenant | Night | A harmonic minor | 56 BPM | 16 bars / 64 beats / about 68.57 seconds |

The soundtrack uses slow, spacious motifs and dark harmonies, with softly
drifting choir and bowed tones, low drones, breathy melodies and distant bells.
Instrument names describe oscillator recipes. Each original composition has
authored phrase variations and rests, with room reflections carrying its tails.
Each pair shares its key, tempo and harmonic progression so its arrangements
overlap coherently at twilight. Two-bar drones hold a root and fifth beneath
suspended choir by day and lower bowed harmonies at night. Day melodies use
breathy tones in Runes in the Mist, bowed tones in The Sealed Gate and choir
in Forgotten Sanctum; all night melodies use sparse ritual bells.

Events in `songs.js` use MIDI note numbers and beat positions/durations.
`music.js` converts beats using each song's tempo and schedules 0.2 seconds
ahead, capped at 48 voices per update. It keeps each loop's own musical clock
while using an equal-power day/night crossfade. Long gaps skip missed notes;
audio suspension clears scheduled voices and resumes with a fresh phrase.

## Music voices and room

`playMusicNote(engine, event, when, duration)` uses a full attack, decay, sustain
and release envelope, with the release continuing beyond the note's gate. Choir,
bowed and drone profiles can layer gently detuned oscillators that drift over
the note. Bells combine a sine fundamental with a quiet inharmonic partial;
breathy tones combine sine and triangle layers. Lowpass filters soften the
upper harmonics. These are original synthesis recipes, with no recorded voices
or instruments.

`createMusicRoom(context, destination)` gives each active score pair a shared
dry path and a darker wet path. A deterministic stereo impulse is generated
locally, normalized for sample rate, and cached per context. Its 2.8-second
decaying reflections feed a convolution node followed by a 2200 Hz lowpass
filter. This produces the distant stone-room atmosphere without loading an
impulse-response asset. A skip fades and disposes the retiring pair's room
along with its notes; pausing or teardown clears both dry and reverberant paths.

## Authoring synthesized sounds

Use `tone(engine, options)` for a pitched note or `noise(engine, options)` for a
short texture. Options include `bus` (`music`, `sfx`, `sword` or `ambience`), `gain`,
`duration`, `attack`, `decay`, `sustain`, `release`, `cutoff`, `filterType`, `Q`,
and optional world coordinates `x`/`y`. Tones also accept `frequency`,
`endFrequency`, `detune` and `type`
(`sine`, `triangle`, `square` or `sawtooth`). Frequencies are in hertz, detune
is in cents, and envelope durations are in seconds.

For these generic one-shots, `duration` includes the release. Attack reaches
`gain`; optional decay lowers it to the `sustain` fraction of that peak, then
release reaches zero at the end. With zero decay, attack goes directly to the
sustained level. Sustain ranges from 0 to 1. Omitting the new
envelope options preserves the original peak-and-release behavior. Filter `Q`
defaults to 0.7 and is bounded from 0 to 30. Low `Q`, short transient decays and
modest sustain suit close material sounds; higher `Q` can describe damped
resonance. Music uses its separate release-after-gate helper described above.

**`when` is an absolute audio-context time in seconds**, not a delay or the game
clock. For a delayed note, add the delay to `engine.context.currentTime`:

```js
import { noise } from './voices.js';

if (engine.context?.state === 'running') {
  noise(engine, {
    bus: 'sfx', cutoff: 700, filterType: 'lowpass', Q: 0.5,
    when: engine.context.currentTime + 0.05,
    duration: 0.12, attack: 0.003, decay: 0.025,
    sustain: 0.08, release: 0.07, gain: 0.03,
  });
}
```

One-shots disconnect their nodes and route when finished. Returned handles have
an idempotent `stop()` for early cleanup. `loopNoise()` returns a sustained voice
with gain and filter nodes; animate them with `setParam()` and call `stop()` on
teardown. Helpers return `null` when audio is locked or unavailable. Keep new
sound levels modest, route them through their category bus, and reuse actual
game events to avoid repeating cues every frame.

## Verification

Run the repository's dependency-free Node tests with `npm test`. Audio tests
use fake audio graphs and parameter automation to check lazy initialization,
unlock recovery, preference handling, routing, finite values and voice cleanup.
They do not replace listening in a browser.

Serve the game locally and verify:

1. A fresh load creates no audio context until a key press or click. The first
   gesture starts sound without interrupting movement or combat.
2. `M` and the Audio panel mute all categories; each slider changes its category.
   Set Sword to zero: footsteps should remain audible while sword effects and
   charge stop. Set Effects to zero: both sword and movement sounds should stop.
   Reload to check saved settings, including starting muted.
3. Walk and sprint across grass, dirt, stone and shore. Listen for contact-synced
   earthy texture changes, including low wet splashes at lake edges; deep water
   still blocks movement. Jump, land and stop from a sprint to hear short cloth,
   weighted material contact and skid brushes.
4. Draw and sheathe with `F`, strike with `J` or left click, and hold then release
   a strike. Listen for weathered blade friction, leather movement, low air rush
   and weighted, damped contact; charge should build as a quiet drifting air
   texture.
5. Approach a lake from either side and walk away. Its sound should pan toward
   the source and fade with distance. Wind and grass rustle follow gusts slowly;
   birds, insect chirrs, crickets, owls and occasional distant calls remain soft
   behind the music. Near water, listen for frog croaks at night. Bright fireflies
   occasionally produce a faint noise glint from their visible position.
6. Listen through a complete 240-second audio cycle for gentle song transitions
   and clean repeated phrases. Listen for slow, mysterious motifs, soft choir
   and bowed tones, low drones and distant bells with decaying room reflections.
   Check that the scene retains its moonlit look.
7. Use Skip song or `N` to visit all three song pairs; the current title should
   update and return to the first pair after three skips. Try skipping before
   unlocking audio, while muted and after returning from a background tab.

With `?debug` in the URL, `window.game.audio` exposes the engine in the browser
console. `audio.setVolume('music', 0)`, `audio.setMuted(true)` and
`audio.toggleMute()` use the same persisted preferences as the UI. Inspect
`audio.context`, `audio.volumes` and `audio.buses` to check initialization and
routing. `window.game.sound.music` exposes `currentSong`, `songCount` and
`skip()` for soundtrack inspection.
