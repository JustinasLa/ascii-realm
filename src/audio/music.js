import { SONG_PAIRS, midiToFrequency } from './songs.js';
import { tone, setParam } from './voices.js';

const LOOKAHEAD = 0.2;
const START_DELAY = 0.04;
const MAX_VOICES_PER_UPDATE = 48;
const SKIP_FADE = 0.32;
const MAX_RETIRING_PAIRS = 2;
const clamp = value => Math.min(1, Math.max(0, value));

/** Authored score pairs, driven by the unlocked audio clock and game day/night. */
export class Music {
  constructor(engine) {
    this.engine = engine;
    this.tracks = [];
    this.voices = new Set();
    this.context = null;
    this.disposed = false;
    this.lastTime = null;
    this.pairIndex = 0;
    this.night = 0;
    this.retiring = [];
  }

  get currentSong() {
    return SONG_PAIRS[this.pairIndex][this.night >= 0.5 ? 'night' : 'day'].title;
  }

  get songCount() {
    return SONG_PAIRS.length * 2;
  }

  skip() {
    if (this.disposed) return this.currentSong;
    this.pairIndex = (this.pairIndex + 1) % SONG_PAIRS.length;
    const context = this.engine.context;
    if (!context || context.state !== 'running') {
      if (this.context) this._clear();
      return this.currentSong;
    }
    if (this.context === context && this.route) {
      const now = context.currentTime;
      this._cleanRetiring(now);
      this._fade(this.route.input.gain, 0, now);
      this.retiring.push({
        route: this.route, tracks: this.tracks,
        voices: this.voices, end: now + SKIP_FADE,
      });
      // Rapid repeated skips cannot retain an unbounded number of audio graphs.
      while (this.retiring.length > MAX_RETIRING_PAIRS) {
        this._disposeGroup(this.retiring.shift());
      }
      this.route = null;
      this.tracks = [];
      this.voices = new Set();
      this.lastTime = null;
      this._start(context, this.night, true);
    } else {
      this._clear();
      this._start(context, this.night, true);
    }
    this.update({ night: this.night });
    return this.currentSong;
  }

  update({ night = 0 } = {}) {
    if (this.disposed) return;
    this.night = Number.isFinite(night) ? clamp(night) : 0;
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
    this._cleanRetiring(now);
    for (const voice of this.voices) {
      if (voice.end <= now) this.voices.delete(voice);
    }
    // If the tab missed updates, skip old score events instead of replaying them.
    if (this.lastTime !== null && now - this.lastTime > 1) {
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
      while (this._eventTime(track) <= now + LOOKAHEAD) {
        const event = track.song.events[track.index];
        const when = this._eventTime(track);
        // Keep both scores in phase, while not allocating voices for inaudible tracks.
        if (levels[index] > 0.002 && scheduled < MAX_VOICES_PER_UPDATE) {
          const duration = Math.max(0.06, event.beats * track.secondsPerBeat * event.length);
          const handle = tone(track.instrument, {
            bus: 'music', frequency: midiToFrequency(event.note), type: event.type,
            when: Math.max(now, when), duration, gain: event.gain,
            attack: Math.min(event.attack, duration * 0.4),
          });
          if (handle) this.voices.add({ handle, end: Math.max(now, when) + duration + 0.02 });
          scheduled++;
        }
        this._advance(track);
      }
    }
  }

  _start(context, night, fadeIn = false) {
    const route = this.engine.route('music');
    if (!route?.input) return false;
    this.context = context;
    this.route = route;
    const levels = [Math.cos(night * Math.PI / 2), Math.sin(night * Math.PI / 2)];
    try {
      if (fadeIn) {
        route.input.gain.setValueAtTime(0, context.currentTime);
        route.input.gain.linearRampToValueAtTime(1, context.currentTime + SKIP_FADE);
      }
      for (const [index, song] of Object.values(SONG_PAIRS[this.pairIndex]).entries()) {
        const gain = context.createGain();
        gain.gain.value = levels[index];
        gain.connect(route.input);
        const track = {
          song, gain, index: 0, loop: 0,
          start: context.currentTime + START_DELAY, secondsPerBeat: 60 / song.bpm,
          // Music owns the shared route; each short voice owns only its nodes.
          instrument: { context, route: () => ({ input: gain, dispose() {} }) },
        };
        this.tracks.push(track);
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
    this._disposeGroup({ voices: this.voices, tracks: this.tracks, route: this.route });
    for (const group of this.retiring) this._disposeGroup(group);
    this.retiring = [];
    this.tracks = [];
    this.route = null;
    this.context = null;
    this.lastTime = null;
  }

  _fade(param, value, now) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(value, now + SKIP_FADE);
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
