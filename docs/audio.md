# Audio

ASCII Realm creates its original soundtrack, weather and most effects with
Web Audio oscillators and filtered noise. Grass footfalls, water movement
and lightning thunder use local CC0 recordings. Audio adds no runtime
library dependencies; the recordings are served with the game, without
requests to third-party sites.

Sound starts after the first keyboard or pointer gesture. `M` toggles mute, and
the Audio panel offers master, music, effects, sword, ambience and weather
sliders. The Sword control changes sword effects and charge independently; its bus feeds the
Effects bus, so Effects and Master also affect it. Weather feeds Ambience, then
Master, so all three controls affect weather. The panel shows the current
song and offers a Skip song button with the `N` shortcut. Mute and
levels are stored in `localStorage` under `ascii-realm.audio`; the weather
selection and intensity use `ascii-realm.weather`. Blocked storage does not
prevent controls from working. Saved mute is applied before playback.
The Season selector offers automatic seasons or a fixed season for music and
ambience; this choice is stored under `ascii-realm.music`.

Preview grass footsteps briefly quiets the music and ambience to play six
recorded footfalls at a walking cadence and the effects volume. It restores
the current levels after the preview and respects mute.

## Structure

- `src/audio/audio.js` connects animation events and environment signals to
  sounds, sets the listener at the camera and pauses sustained voices when
  playback stops. `controls.js` binds the persistent Audio panel, keyboard
  shortcuts, first-gesture unlock and visibility handling.
- `src/audio/engine.js` creates the audio context lazily and connects independent
  music, SFX and ambience gain buses through the master bus. It owns preference
  persistence, listener position, positional routes and context teardown. The
  sword gain bus feeds SFX for both separate sword adjustment and overall effects
  control. The weather gain bus feeds ambience.
- `voices.js` provides enveloped oscillator tones, filtered noise bursts,
  sustained noise beds and parameter smoothing. A deterministic, two-second
  noise buffer is shared by voices in each context; short cues start at varied
  positions in that buffer to vary the grain without allocating new samples.
- `variations.js` supplies 25 immutable recipes per sound, with an independent
  shuffled deck for each cue and engine. A deck exhausts all recipes before
  refilling, and cannot repeat across its boundary. Recipes change filter color,
  grain, articulation, envelope tails and layer balance; they reuse the existing
  buffers and voice counts. Music articulation varies while note pitches and
  beat positions stay authored. `climate.js` defines the audio seasons, weather
  families and seasonal wildlife balance.
- `footsteps.js` selects recorded grass or water contacts, or layers close,
  unpitched procedural textures for compressed dirt, dense sand drag and stone
  contact. Footfalls follow animation contact events rather than a timer.
- `grass-steps.js` loads and decodes the six local grass recordings once per
  audio context, varies the chosen recording and plays it through the positional
  Effects route. Loading begins after audio unlock. Contacts while locked or
  loading stay quiet, and old contacts are not replayed after decoding finishes.
- `movement.js` uses short, close filtered-noise textures for cloth/leather
  tension on jumping, weight and damped surface resonance on landing, and quiet
  brushes on skidding. Skid particles can arrive every frame, so scrape grains
  are limited to ten per second. Fast attacks decay to low sustain levels and
  soft releases, leaving space for the music.
- `recordings.js` shares context-local loading, shuffled sample selection,
  25 subtle articulations, positional routes and bounded voice ownership for
  water and lightning. It preserves each recording's real envelope and runoff.
  Samples load after unlock, decode once per context, and retry missing files
  with backoff. Locked, muted and missed contacts stay quiet without replay.
- `water.js` plays six creek-wading contacts, two boot-lift washes, short wet
  skids, two spinning washes, and heavier recorded splash/returning-droplet
  tails on landings and water strikes. A lake lightning strike gets a larger
  displaced-water recording. These contact-synced Effects sounds add no
  synthesized noise or oscillator layers. Running increases contact weight;
  standing still stays quiet. Skids are throttled and at most 24 voices overlap.
- `lightning.js` plays a recorded thunderclap and rolling tail through Weather,
  with at most four overlapping thunder voices. Manual and weather-driven
  bolts share this sound. The visible strike callback supplies actual impact
  coordinates; nearby water impacts add a positional Effects splash, while
  dry strikes and distant sky flashes do not. Successfully started recordings
  replace the procedural weather thunder, avoiding duplicate thunderclaps.
  Weather intensity zero, preset changes and pause stop automatic strike tails.
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
- `weather.js` manages the selected weather soundscape and its saved intensity.
  The 17 definitions in `weather/presets.js` use the shared `weather/runtime.js`
  scheduler for filtered-noise beds and irregular one-shots. Each selection owns
  its source routes and cleanup; switching fades over 1.2 seconds and retains at
  most two retiring groups. Pausing releases beds and event tails.
- `songs.js` contains 42 immutable authored scores and instrument recipes;
  `music.js` chooses and rotates a season/weather playlist, schedules the selected
  day/night pair against the audio clock and
  blends its two tracks through dedicated gain nodes and a shared room into the
  music bus. `music-voices.js` supplies soft music envelopes, drifting oscillator
  layers and the procedurally generated convolution reverb.

Positioned sources use stereo pan and distance attenuation relative to the
camera, correcting for the width/height aspect ratio of world cells. Browsers
without stereo-panner support retain distance attenuation. Shore cells touching
a lake produce wet footsteps; other shore cells produce sand. Wading footfalls,
takeoffs, landings and water strikes each have their own water variation bank.

The audio day/night signal cycles every 240 simulation seconds, beginning at
night. Music crossfades between day and night arrangements as this signal
changes. The existing visual scene remains moonlit.
Automatic audio seasons progress Spring, Summer, Autumn, Winter every 960
simulation seconds (four day/night cycles); pausing also pauses this year.
Spring emphasizes birds and frogs, summer insects, autumn dry leaves, and
winter sheltered wind with fewer birds and no insect or frog calls. Stormy
and snowy weather reduces wildlife levels. Wind, leaves and water beds smooth
their parameter changes rather than restarting every frame.

## Grass recordings

The six files in `assets/audio/grass` are excerpts from gabytoledosci's
[Walking on grass.wav](https://freesound.org/people/gabytoledosci/sounds/398266/),
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
`grass-L1.wav` through `grass-L3.wav` and `grass-R1.wav` through `grass-R3.wav`
are mono 16-bit PCM at 22,050 Hz, 0.32 seconds each and 85 KB total.
The recorded brush keeps its natural envelope, with short boundary fades.
Filtering reduces rumble and sharp treble; restrained level balancing and
soft peak control keep small contact spikes from dominating every step.
Detailed source offsets and processing are in
[LICENSE.txt](../assets/audio/grass/LICENSE.txt).

Grass contacts shuffle these six recordings, independently from a deck of 25
articulations. All recordings play before reuse, without an immediate repeat
at a deck boundary. Contact strength and the chosen recipe control the level;
playback rate stays within 2% of the recording. The entire recording and its
natural envelope remain intact. Synthetic splash,
squeeze and noise layers are absent from grass
footfalls. A contact that arrives before the recordings are ready stays quiet;
the helper does not queue it or substitute a procedural grass sound.

## Water and lightning recordings

The 15 local files in `assets/audio/water` retain real sloshing, water
displacement, bubbles and returning droplets. Sources are rosenberg3's
[Walking through water](https://freesound.org/people/rosenberg3/sounds/627004/),
wormer2's [bucket splash 2](https://freesound.org/people/wormer2/sounds/415670/)
and [bucket splash 3](https://freesound.org/people/wormer2/sounds/415669/), and
qubodup's [Big Water Splash](https://freesound.org/people/qubodup/sounds/442773/).
Thunder comes from WuxiaScrub's
[Rain + Long Thunder](https://opengameart.org/content/rain-long-thunder).
All are CC0. Source URLs, excerpt offsets and edits are recorded in the
[water license](../assets/audio/water/LICENSE.txt) and
[thunder license](../assets/audio/lightning/LICENSE.txt).

The mono 16-bit PCM files use 24,000 Hz and total about 1.25 MB. Edits remove
subsonic rumble and boundary clicks and balance levels; playback preserves the
entire recorded envelope. Water and thunder use subtle rate changes within
1.5% (running footfalls can be 4% faster) and positional category gains.
There is no procedural water fallback: unavailable contacts are discarded.
Weather retains its original thunder if the recording cannot start.

## Weather soundscapes

Use **Weather sound** in the Audio panel to choose a preset and **Intensity**
to adjust its strength from 0 to 100%. A fresh profile starts on **Clear** at
60% intensity; saved choices are restored on reload. Clear leaves the meadow's
ordinary wind, lakes and wildlife audible. The selector changes audio only;
terrain, movement and rendering keep their existing behavior.

The separate **Weather** volume slider adjusts this category. Its routing is
Weather → Ambience → Master, so setting any of those levels to zero silences
weather. Intensity zero silences the selected preset's beds and event tails.
Selecting a preset while sound is locked saves the choice without allocating
an audio context. Events follow the audio clock; missed rain impacts or thunder
are skipped after pauses rather than replayed in a burst.

Gentle rain, drizzle, heavy rain, thunderstorms, sleet and freezing rain add
small liquid impacts when the player is close to water. These splashes come
from the nearby lake's position and fade with the player's distance, becoming
silent about 12 aspect-correct world units away. The player lookup is separate
from the camera's ambience lookup, so moving the view does not trigger shoreline
splashes. Rain intensity and the Weather, Ambience and Master levels also control
them. Dry weather does not produce this layer.

| Preset | Sound texture |
| --- | --- |
| Gentle rain | Soft shower, fine patter and leaf drips |
| Drizzle | Thin rain on foliage with scattered ticks |
| Heavy rain | Dense downpour, low rushing roar and ground impacts |
| Thunderstorm | Wind-driven rain with nearby rolling thunder |
| Distant thunder | Restrained wind and dark rolls beyond the horizon |
| Hail | Hard ice pellets rattling and bouncing |
| Sleet | Wind-slanted ice grains, damp wash and uneven taps |
| Light snowfall | Sheltered cold air and rare soft powder brushes |
| Snowstorm | Muted cold wind and dry powder sweeps |
| Blizzard | Heavy cold wind and slow surges of blowing snow |
| Meadow wind gusts | Rolling breezes brushing dry grass and foliage |
| Gale | Deep wind pressure and turbulent gusts |
| Sandstorm | Muffled wind, dry sand hiss and rubbing grit |
| Coastal storm | Offshore surf, tearing wind and long gritty breakers |
| Foggy stillness | Sheltered air and rare distant leaf or reed brushes |
| Ice storm | Fine freezing rain, brittle ice and strained branches |
| Forest squall | Canopy wind, rattling leaves and creaking branches |

Definitions are plain, side-effect-free objects with an ID, label, description,
up to three filtered-noise layers and up to two event groups. Modulation and
event gains include intensity; callbacks receive audio time, simulation time
and a supplied random function. The shared runtime smooths parameters, bounds
cue values and caps short voices across active and fading selections. Definitions
do not create audio contexts or timers.
Rainy definitions also provide a rainfall strength; the runtime adds a shared
water-splash event with its own smoothly controlled proximity gain and fixed
world positions, within the same short-voice budget.

## Songs

The 42 songs form 21 pairs: three general pairs, two per season, and two each
for rain, storms, snow/ice, wind/sand and fog. Clear-weather playlists contain
the three general pairs and the current season's two pairs. Other weather adds
its two matching pairs. Selecting a season or changing weather family starts a
matching score with a 1.8-second fade. Intensity zero restores the seasonal
playlist; changing intensity within the same family does not restart a score.

Scores advance after their 16-bar arrangement, with a 1.6-second fade and a
shuffled playlist that visits every eligible pair before reusing one. Skip song
or `N` advances through eligible pairs in catalog order, fading over 0.32 seconds.
The day/night signal still selects the blend within a pair; the title shows the
dominant arrangement. Rapid changes retain at most two retiring pairs.
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

The additional authored pairs are:

| Setting | Day song | Night song | Tempo |
| --- | --- | --- | --- |
| Spring | The First Green | Petals Under the Moon | 60 BPM |
| Spring | Water Beneath the Roots | The Seedkeeper | 57 BPM |
| Summer | Long Meadow Light | Moths at the Lantern | 62 BPM |
| Summer | The Quiet Orchard | A Thousand Small Lights | 59 BPM |
| Autumn | Ochre Fields | The Last Harvest Bell | 53 BPM |
| Autumn | Leaves on the Old Road | Amber Vigil | 55 BPM |
| Winter | Frost on the Threshold | Stars Above the Ice | 46 BPM |
| Winter | The Sheltered Hearth | Ashes Until Dawn | 49 BPM |
| Rain | Silver on the Lake | Rain at the Window | 52 BPM |
| Rain | Rain Through the Reeds | The Sunken Ferry | 55 BPM |
| Storm | Under an Iron Sky | Thunder Beyond the Keep | 50 BPM |
| Storm | The Broken Spire | Oath in the Downpour | 54 BPM |
| Snow / ice | The White Road | Footprints Without a Name | 45 BPM |
| Snow / ice | The Buried Shrine | A Candle in the Snow | 48 BPM |
| Wind / sand | The Wanderer Wind | Cairns in the Dark | 58 BPM |
| Wind / sand | Dust of the Pilgrim | The Empty Watchtower | 56 BPM |
| Fog | Where the Path Vanishes | Names in the Fog | 47 BPM |
| Fog | The Glass Fen | A Boat Without Oars | 51 BPM |

The soundtrack uses slow, spacious motifs and dark harmonies, with softly
drifting choir and bowed tones, low drones, breathy melodies and distant bells.
Instrument names describe oscillator recipes. Each original composition has
authored phrase variations and rests, with room reflections carrying its tails.
Each pair shares its key, tempo and harmonic progression so its arrangements
overlap coherently at twilight. Two-bar drones hold a root and fifth beneath
suspended choir by day and lower bowed harmonies at night. Day melodies use
breathy tones in Runes in the Mist, bowed tones in The Sealed Gate and choir
in Forgotten Sanctum. New scores also give night melodies slower choir,
bowed or breathy answers alongside sparse ritual bells.

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
short texture. Options include `bus` (`music`, `sfx`, `sword`, `ambience` or
`weather`), `gain`,
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
   soft brushing on grass and distinct material changes, including low wet splashes
   at lake edges. With wading enabled, walk and run through knee-deep water,
   then jump and land to hear the takeoff wash and larger landing splash.
   Stop from a sprint to hear short cloth, weighted material contact and skid
   brushes. Check that standing still creates no extra step or splash cues.
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
7. Choose every season and weather family, checking the displayed climate and
   matching song. Use Skip song or `N` to visit the five clear-weather or seven
   wet/windy/foggy pairs; the title should update and wrap within that playlist.
   Let a complete score finish to hear automatic rotation. Check saved seasons,
   intensity zero, skipping before unlock, mute and background-tab resumption.
8. Choose each weather soundscape, then rapidly switch between several and
   Clear. Listen for smooth fades and distinct textures. Check intensity zero,
   Weather zero, Ambience zero and Master zero; each should silence weather.
   Reload to check the saved selection and intensity. Hide and restore the tab
   to confirm clean resumption without accumulated impacts or thunder.

With `?debug` in the URL, `window.game.audio` exposes the engine in the browser
console. `audio.setVolume('music', 0)`, `audio.setMuted(true)` and
`audio.toggleMute()` use the same persisted preferences as the UI. Inspect
`audio.context`, `audio.volumes` and `audio.buses` to check initialization and
routing. `window.game.sound.music` exposes `currentSong`, `songCount` and
`skip()` for soundtrack inspection. It also exposes `season`, `seasonPreference`,
`playlist`, `climateLabel` and `setSeason('auto' | 'spring' | 'summer' | 'autumn' | 'winter')`.
`window.game.sound.weather` exposes `preset`, `intensity`, `presets`,
`setPreset(id)` and `setIntensity(value)`; intensity uses the range 0 to 1.

For lightning, use the existing summon control or a thunder weather preset.
Check a dry strike, a strike meeting lake water, and a distant sky flash:
all have a single thunderclap; only the lake hit adds the displaced-water
splash and falling-droplet tail. Master/Ambience/Weather control thunder;
Master/Effects control the lake splash. Intensity zero stops automatic tails.
