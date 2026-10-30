import { SONG_PAIRS } from './songs.js';
import { setParam } from './voices.js';
import { createMusicRoom, playMusicNote } from './music-voices.js';
import { SEASONS, SEASON_OPTIONS, seasonAt, weatherMood } from './climate.js';
import { nextSoundVariant, ShuffleBag, varySound } from './variations.js';

const LOOKAHEAD = 0.2;
const START_DELAY = 0.04;
const MAX_VOICES_PER_UPDATE = 48;
const SKIP_FADE = 0.32;
const CLIMATE_FADE = 1.8;
const ROTATION_FADE = 1.6;
const STORAGE_KEY = 'ascii-realm.music';
const MAX_RETIRING_PAIRS = 2;
const clamp = value => Math.min(1, Math.max(0, value));

/** Authored score pairs, driven by the unlocked audio clock and game day/night. */
export class Music {
  constructor(engine, { storage } = {}) {
    this.engine = engine;
    this.tracks = [];
    this.voices = new Set();
    this.context = null;
    this.disposed = false;
    this.lastTime = null;
    this.pairIndex = 0;
    this.night = 0;
    this.retiring = [];
    this.room = null;
    this.simulationTime = 0;
    this.seasonPreference = 'auto';
    // The world's season, which automatic seasons follow when it is given.
    this.worldSeason = null;
    this.weatherPreset = 'clear';
    this.weatherIntensity = 0.6;
    this.environmentKey = null;
    this.adaptive = false;
    // Without environmental inputs this is also a standalone full-catalog player.
    this.playlist = SONG_PAIRS.map((_, index) => index);
    this._resetRotation();
    try {
      this.storage = storage === undefined ? globalThis.localStorage : storage;
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) || 'null');
      if (saved?.season === 'auto' || SEASONS.includes(saved?.season)) this.seasonPreference = saved.season;
    } catch { /* Audio still works without preference storage. */ }
    this.adaptive = this.seasonPreference !== 'auto';
  }

  get currentSong() {
    return SONG_PAIRS[this.pairIndex][this.night >= 0.5 ? 'night' : 'day'].title;
  }

  get songCount() {
    return SONG_PAIRS.length * 2;
  }

  get season() {
    if (this.seasonPreference !== 'auto') return this.seasonPreference;
    return this.worldSeason ?? seasonAt(this.simulationTime);
  }

  get seasonOptions() { return SEASON_OPTIONS; }

  get climateLabel() {
    const season = this.season;
    const mood = weatherMood(this.weatherPreset, this.weatherIntensity);
    return `${season[0].toUpperCase() + season.slice(1)} · ${mood === 'clear' ? 'Clear skies' : mood[0].toUpperCase() + mood.slice(1)}`;
  }

  setSeason(id) {
    if (this.disposed || (id !== 'auto' && !SEASONS.includes(id))) return false;
    this.seasonPreference = id;
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ season: id })); } catch { /* Keep the live choice. */ }
    this._environment({ time: this.simulationTime });
    this.update({ night: this.night });
    return true;
  }

  skip() {
    if (this.disposed) return this.currentSong;
    const current = this.playlist.indexOf(this.pairIndex);
    this._changePair(this.playlist[(current + 1) % this.playlist.length], SKIP_FADE);
    this.update({ night: this.night });
    return this.currentSong;
  }

  _environment({ time, weather, weatherIntensity, season: world }) {
    if (Number.isFinite(time)) this.simulationTime = Math.max(0, time);
    if (SEASONS.includes(world)) this.worldSeason = world;
    if (typeof weather === 'string') this.weatherPreset = weather;
    if (Number.isFinite(weatherIntensity)) this.weatherIntensity = clamp(weatherIntensity);
    if (time !== undefined || weather !== undefined || weatherIntensity !== undefined) this.adaptive = true;
    if (!this.adaptive) return;
    const season = this.season;
    const mood = weatherMood(this.weatherPreset, this.weatherIntensity);
    const key = `${season}:${mood}`;
    if (key === this.environmentKey) return;
    this.environmentKey = key;
    this.playlist = SONG_PAIRS.flatMap((pair, index) =>
      (!pair.season || pair.season === season) && (!pair.weather || pair.weather === mood) ? [index] : []);
    const preferred = this.playlist.find(index => SONG_PAIRS[index].weather === mood)
      ?? this.playlist.find(index => SONG_PAIRS[index].season === season) ?? this.playlist[0];
    this._changePair(preferred, CLIMATE_FADE);
    this._resetRotation();
  }

  _resetRotation() {
    this.rotation = new ShuffleBag(this.playlist);
    this.rotation.remaining = this.playlist.filter(index => index !== this.pairIndex);
    this.rotation.last = this.pairIndex;
  }

  _changePair(index, fade = SKIP_FADE) {
    if (index === this.pairIndex) return;
    this.pairIndex = index;
    this.rotation.remaining = this.rotation.remaining.filter(value => value !== index);
    this.rotation.last = index;
    const context = this.engine.context;
    if (!context || context.state !== 'running') {
      if (this.context) this._clear();
      return;
    }
    if (this.context === context && this.route) {
      const now = context.currentTime;
      this._cleanRetiring(now);
      this._fade(this.route.input.gain, 0, now, fade);
      this.retiring.push({
        route: this.route, tracks: this.tracks,
        room: this.room, voices: this.voices, end: now + fade,
      });
      // Rapid repeated skips cannot retain an unbounded number of audio graphs.
      while (this.retiring.length > MAX_RETIRING_PAIRS) {
        this._disposeGroup(this.retiring.shift());
      }
      this.route = null;
      this.room = null;
      this.tracks = [];
      this.voices = new Set();
      this.lastTime = null;
      this._start(context, this.night, fade);
    } else {
      this._clear();
      this._start(context, this.night, fade);
    }
  }

  update({ night = 0, time, weather, weatherIntensity, season } = {}) {
    if (this.disposed) return;
    this.night = Number.isFinite(night) ? clamp(night) : 0;
    this._environment({ time, weather, weatherIntensity, season });
    const context = this.engine.context;
    if (!context || context.state !== 'running') {
      // Suspension stops future voices too; resume starts a fresh phrase.
      if (this.context) this._clear();
      return;
    }
    const blend = this.night;
    if (this.context !== context || !this.route || this.tracks.length !== 2) {
      this._clear();
      if (!this._start(context, blend)) return;
    }
    const now = context.currentTime;
    const gap = this.lastTime !== null && now - this.lastTime > 1;
    if (gap) {
      const track = this.tracks[0];
      const loop = Math.max(0, Math.floor((now - track.start) / track.song.duration));
      this.nextPairAt = track.start + (loop + 1) * track.song.duration;
    } else if (now >= this.nextPairAt) {
      this._changePair(this.rotation.next(), ROTATION_FADE);
      if (!this.route) return;
    }
    this._cleanRetiring(now);
    for (const voice of this.voices) {
      if (voice.handle.ended || voice.end <= now) this.voices.delete(voice);
    }
    // If the tab missed updates, skip old score events instead of replaying them.
    if (gap) {
      for (const voice of this.voices) voice.handle.stop();
      this.voices.clear();
      for (const track of this.tracks) this._seek(track, now + START_DELAY);
    }
    this.lastTime = now;
    const levels = [Math.cos(blend * Math.PI / 2), Math.sin(blend * Math.PI / 2)];
    let scheduled = 0;
    for (let index = 0; index < this.tracks.length; index++) {
      const track = this.tracks[index];
      setParam(track.gain.gain, levels[index], now, 0.8);
      if (this._eventTime(track) < now - 0.03) this._seek(track, now + 0.005);
      while (this._eventTime(track) <= now + LOOKAHEAD && this._eventTime(track) < this.nextPairAt) {
        const event = track.song.events[track.index];
        const when = this._eventTime(track);
        // Keep both scores in phase, while not allocating voices for inaudible tracks.
        if (levels[index] > 0.002 && scheduled < MAX_VOICES_PER_UPDATE) {
          const duration = Math.max(0.06, event.beats * track.secondsPerBeat * event.length);
          const variant = nextSoundVariant(this.engine, `music:${event.voice}`);
          // Articulation changes, but authored note pitches and beat positions stay exact.
          const handle = playMusicNote(track.instrument, varySound(variant, event), Math.max(now, when), duration);
          if (handle) this.voices.add({ handle, end: handle.end });
          scheduled++;
        }
        this._advance(track);
      }
    }
  }

  _start(context, night, fadeIn = 0) {
    const route = this.engine.route('music');
    if (!route?.input) return false;
    this.context = context;
    this.route = route;
    const levels = [Math.cos(night * Math.PI / 2), Math.sin(night * Math.PI / 2)];
    try {
      this.room = createMusicRoom(context, route.input);
      if (!this.room) throw new Error('Music room could not be created');
      if (fadeIn) {
        route.input.gain.setValueAtTime(0, context.currentTime);
        route.input.gain.linearRampToValueAtTime(1, context.currentTime + fadeIn);
      }
      const pair = SONG_PAIRS[this.pairIndex];
      this.nextPairAt = context.currentTime + START_DELAY + pair.day.duration;
      for (const [index, song] of [pair.day, pair.night].entries()) {
        const gain = context.createGain();
        gain.gain.value = levels[index];
        const track = {
          song, gain, index: 0, loop: 0,
          start: context.currentTime + START_DELAY, secondsPerBeat: 60 / song.bpm,
          // Music owns the shared route; each short voice owns only its nodes.
          instrument: { context, route: () => ({ input: gain, dispose() {} }) },
        };
        this.tracks.push(track);
        gain.connect(this.room.input);
      }
      return true;
    } catch {
      this._clear();
      return false;
    }
  }

  _eventTime(track) {
    return track.start + track.loop * track.song.duration
      + track.song.events[track.index].beat * track.secondsPerBeat;
  }

  _advance(track) {
    track.index++;
    if (track.index === track.song.events.length) {
      track.index = 0;
      track.loop++;
    }
  }

  _seek(track, time) {
    const elapsed = Math.max(0, time - track.start);
    track.loop = Math.floor(elapsed / track.song.duration);
    const beat = (elapsed - track.loop * track.song.duration) / track.secondsPerBeat;
    track.index = track.song.events.findIndex(event => event.beat >= beat);
    if (track.index < 0) {
      track.index = 0;
      track.loop++;
    }
  }

  _clear() {
    this._disposeGroup({ voices: this.voices, tracks: this.tracks, room: this.room, route: this.route });
    for (const group of this.retiring) this._disposeGroup(group);
    this.retiring = [];
    this.tracks = [];
    this.route = null;
    this.room = null;
    this.context = null;
    this.lastTime = null;
    this.nextPairAt = null;
  }

  _fade(param, value, now, seconds = SKIP_FADE) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(value, now + seconds);
  }

  _cleanRetiring(now) {
    const remaining = [];
    for (const group of this.retiring) {
      if (group.end <= now) this._disposeGroup(group);
      else remaining.push(group);
    }
    this.retiring = remaining;
  }

  _disposeGroup(group) {
    for (const voice of group.voices) voice.handle.stop();
    group.voices.clear();
    for (const track of group.tracks) {
      try { track.gain.disconnect(); } catch { /* Context already closed. */ }
    }
    try { group.room?.dispose(); } catch { /* Room already disposed. */ }
    try { group.route?.dispose(); } catch { /* Route already disposed. */ }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clear();
  }

  pause() {
    this._clear();
  }
}
