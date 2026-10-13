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
  noise buffer is shared by voices in each context.
- `footsteps.js` layers a sole impact with grass rustle, dirt crunch, sand brush,
  rock click or shallow-water splash. Footfalls follow animation contact events
  rather than an independent sound timer.
- `movement.js` supplies jump, landing and skid textures. Skid particles can
  arrive every frame, so scrape grains are limited to ten per second.
- `sword.js` supplies draw, sheathe, swing, slam and spinning-slash sounds. Its
  dry blade scrapes, leather movement, air rush and damped metal impacts aim for
  natural material sounds. `ChargeHum` maintains a quiet filtered-noise texture
  during a held charge and releases it smoothly when charging ends. All sword
  sounds use the `sword` bus.
- `environment.js` samples the same gust noise field as rendered grass,
  nearby lake position and an audio day/night cycle. Water searches are bounded
  to a local radius and reused between samples.
- `ambience.js` layers low wind turbulence, fine grass/leaf rustle and occasional
  gust textures, alongside positional lake beds. Its sparse outdoor calls include
  daytime birds and insect chirrs, nighttime crickets and owl hoots, frogs near
  lakes, rare distant deer-like calls and nearby insect buzz/clicks. It also adds
  positional shimmer when a nearby rendered firefly pulse is bright. Wildlife
  calls are synthesized atmosphere; they do not add visible animal entities.
- `songs.js` contains immutable authored note events and instrument recipes;
  `music.js` schedules the selected day/night pair against the audio clock and
  blends its two tracks through dedicated gain nodes into the music bus.

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
| Meadow Road | Day | D dorian | 72 BPM | 16 bars / 64 beats / about 53.33 seconds |
| Lanterns on the Lake | Night | D minor | 60 BPM | 16 bars / 64 beats / 64 seconds |
| Orchard Waltz | Day | G major | 68 BPM | 16 bars / 64 beats / about 56.47 seconds |
| Firefly Reverie | Night | E minor | 54 BPM | 16 bars / 64 beats / about 71.11 seconds |
| The Wandering Brook | Day | A mixolydian | 76 BPM | 16 bars / 64 beats / about 50.53 seconds |
| Under the Quiet Stars | Night | A minor | 58 BPM | 16 bars / 64 beats / about 66.21 seconds |

Meadow Road layers a triangle-wave lute melody, quiet sine pads and triangle
bass, with occasional flute answers. Lanterns on the Lake uses sine bells with
a quiet octave partial over pads and bass. These instrument names describe
oscillator recipes, rather than sampled recordings. Each score has deliberate
phrase variations and rests.

The other pairs feature reed and soft glass-like melodies in Orchard Waltz /
Firefly Reverie, and harp and flute melodies in The Wandering Brook / Under the
Quiet Stars. Each melody sits over quiet pads and bass.

Events in `songs.js` use MIDI note numbers and beat positions/durations.
`music.js` converts beats using each song's tempo and schedules 0.2 seconds
ahead, capped at 48 voices per update. It keeps each loop's own musical clock
while using an equal-power day/night crossfade. Long gaps skip missed notes;
audio suspension clears scheduled voices and resumes with a fresh phrase.

## Authoring synthesized sounds

Use `tone(engine, options)` for a pitched note or `noise(engine, options)` for a
short texture. Options include `bus` (`music`, `sfx`, `sword` or `ambience`), `gain`,
`duration`, `attack`, `cutoff`, `filterType`, and optional world coordinates
`x`/`y`. Tones also accept `frequency`, `endFrequency`, `detune` and `type`
(`sine`, `triangle`, `square` or `sawtooth`). Frequencies are in hertz, detune
is in cents, and envelope durations are in seconds.

**`when` is an absolute audio-context time in seconds**, not a delay or the game
clock. For a delayed note, add the delay to `engine.context.currentTime`:

```js
import { tone } from './voices.js';

if (engine.context?.state === 'running') {
  tone(engine, {
    bus: 'sfx', type: 'triangle', frequency: 440, endFrequency: 220,
    when: engine.context.currentTime + 0.05,
    duration: 0.12, attack: 0.005, gain: 0.03,
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
   texture changes, including wet steps at lake edges; deep water still blocks
   movement. Jump, land and stop from a sprint to hear the corresponding cues.
4. Draw and sheathe with `F`, strike with `J` or left click, and hold then release
   a strike. Listen for blade friction, leather movement, air rush and short dull
   metal contact; charge should build as a quiet air texture.
5. Approach a lake from either side and walk away. Its sound should pan toward
   the source and fade with distance. Wind and grass rustle follow gusts; birds,
   insect chirrs, crickets, owls and occasional distant calls remain subtle. Near
   water, listen for frog croaks at night and occasional firefly shimmer.
6. Listen through a complete 240-second audio cycle for gentle song transitions
   and clean repeated phrases. Check that the scene retains its moonlit look.
7. Use Skip song or `N` to visit all three song pairs; the current title should
   update and return to the first pair after three skips. Try skipping before
   unlocking audio, while muted and after returning from a background tab.

With `?debug` in the URL, `window.game.audio` exposes the engine in the browser
console. `audio.setVolume('music', 0)`, `audio.setMuted(true)` and
`audio.toggleMute()` use the same persisted preferences as the UI. Inspect
`audio.context`, `audio.volumes` and `audio.buses` to check initialization and
routing. `window.game.sound.music` exposes `currentSong`, `songCount` and
`skip()` for soundtrack inspection.
