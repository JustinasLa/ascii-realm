import { Ambience } from './ambience.js';
import { playBones } from './bones.js';
import { playGoblin } from './goblin.js';
import { playTroll } from './troll.js';
import { playElf } from './elf.js';
import { AudioEngine } from './engine.js';
import { EnvironmentSampler, nightAmount, surfaceAt } from './environment.js';
import { FireAudio } from './fire.js';
import { playFootstep } from './footsteps.js';
import { playInstrumentNote } from './instruments.js';
import { prepareGrassFootsteps } from './grass-steps.js';
import { playLightning, prepareLightningSounds } from './lightning.js';
import { playMovement } from './movement.js';
import { playPickup } from './pickup.js';
import { Music } from './music.js';
import { ChargeHum, playSword } from './sword.js';
import { playWaterSound, prepareWaterSounds } from './water.js';
import { WeatherAudio } from './weather.js';
import { playSpellSound, prepareSpellSounds } from './spells.js';
import { WATER } from '../world/world.js';

// The game hands over animation events before clearing them. Audio never
// drives animation or emits footsteps on its own timer.
export class GameAudio {
  constructor(world, engine = new AudioEngine()) {
    this.engine = engine;
    this.world = world;
    this.environment = new EnvironmentSampler(world);
    this.weatherEnvironment = new EnvironmentSampler(world);
    this.ambience = new Ambience(engine);
    this.fires = new FireAudio(engine);
    this.music = new Music(engine);
    this.charge = new ChargeHum(engine);
    this.effects = new Set();
    this.spellEffects = new Map();
    this.weather = new WeatherAudio(engine);
    this.weather.onLightningSound = event => this.play({ ...event, type: 'lightning' });
  }

  play(event) {
    if (event.type === 'spell-stop') { this.stopSpells(event.owner); return []; }
    if (this.engine.context?.state !== 'running') return;
    for (const handle of this.effects) if (handle.ended) this.effects.delete(handle);
    let handles;
    switch (event.type) {
      case 'spell': {
        for (const [handle] of this.spellEffects) if (handle.ended) this.spellEffects.delete(handle);
        handles = playSpellSound(this.engine, event);
        for (const handle of handles) this.spellEffects.set(handle, event.owner);
        while (this.spellEffects.size > 96) {
          const handle = this.spellEffects.keys().next().value;
          handle.stop(); this.spellEffects.delete(handle); this.effects.delete(handle);
        }
        break;
      }
      case 'fire-stir':
        handles = this.fires.react(event);
        break;
      case 'lightning':
        handles = event.thunder === false ? [] : playLightning(this.engine, event);
        if (!event.distant && Number.isFinite(event.x) && Number.isFinite(event.y)
          && this.world.typeAt(event.x, event.y) === WATER) {
          handles.push(...playWaterSound(this.engine, event));
        }
        break;
      case 'step': case 'jump': case 'land': case 'skid': {
        const surface = surfaceAt(this.world, event.x, event.y);
        handles = surface === 'water' ? playWaterSound(this.engine, event)
          : event.type === 'step' ? playFootstep(this.engine, surface, event)
            : playMovement(this.engine, event, surface);
        break;
      }
      case 'splash':
        if (this.world.typeAt(event.x, event.y) === WATER) handles = playWaterSound(this.engine, event);
        break;
      case 'pickup':
        handles = playPickup(this.engine, event);
        break;
      case 'instrument':
        handles = [playInstrumentNote(this.engine, event)].filter(Boolean);
        break;
      case 'bone-hit': case 'bone-collapse': case 'bone-rise':
        handles = playBones(this.engine, event);
        break;
      case 'goblin-spot': case 'goblin-hit': case 'goblin-death':
        handles = playGoblin(this.engine, event);
        break;
      case 'troll-roar': case 'troll-hit': case 'troll-death':
        handles = playTroll(this.engine, event);
        break;
      case 'elf-spot': case 'elf-hit': case 'elf-death': case 'elf-shoot':
        handles = playElf(this.engine, event);
        break;
      case 'draw': case 'sheathe': case 'swing':
        handles = playSword(this.engine, event);
        break;
      case 'slam': case 'whirl':
        handles = playSword(this.engine, event) ?? [];
        if (this.world.typeAt(event.x, event.y) === WATER) handles.push(...playWaterSound(this.engine, event));
        break;
    }
    for (const handle of handles ?? []) if (handle && !handle.ended) this.effects.add(handle);
    return handles ?? [];
  }

  update(dt, time, player, camera, fireflies, fires = []) {
    for (const handle of this.effects) if (handle.ended) this.effects.delete(handle);
    for (const [handle] of this.spellEffects) if (handle.ended) this.spellEffects.delete(handle);
    this.engine.setListener(camera.x, camera.y);
    if (this.engine.context?.state !== 'running') {
      this.music.update({ night: nightAmount(time), time,
        weather: this.weather.preset, weatherIntensity: this.weather.intensity });
      this.pause();
      return;
    }
    const signals = this.environment.update(dt, camera.x, camera.y, time);
    void prepareGrassFootsteps(this.engine);
    void prepareWaterSounds(this.engine);
    void prepareLightningSounds(this.engine);
    void prepareSpellSounds(this.engine);
    this.charge.update(player.combat.charge, player.x, player.y);
    this.music.update({ night: signals.night, time, dt,
      weather: this.weather.preset, weatherIntensity: this.weather.intensity });
    this.ambience.update({ ...signals, time, fireflies, season: this.music.season,
      weather: this.weather.preset, weatherIntensity: this.weather.intensity });
    this.fires.update(fires, time);
    const water = this.weather.hasRain && this.weather.intensity > 0
      ? this.weatherEnvironment.update(dt, player.x, player.y, time).water : null;
    this.weather.update({ time, dt, water });
  }

  stopSpells(owner) {
    for (const [handle, caster] of this.spellEffects) if (owner === undefined || caster === owner) {
      handle.stop(); this.spellEffects.delete(handle); this.effects.delete(handle);
    }
  }

  pause() {
    this.stopSpells();
    for (const handle of this.effects) handle.stop();
    this.effects.clear();
    this.charge.pause();
    this.music.pause();
    this.ambience.pause();
    this.fires.pause();
    this.weather.pause();
  }

  async dispose() {
    this.pause();
    this.charge.dispose();
    this.ambience.dispose();
    this.fires.dispose();
    this.music.dispose();
    this.weather.dispose();
    await this.engine.dispose();
  }
}
