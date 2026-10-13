import { Ambience } from './ambience.js';
import { AudioEngine } from './engine.js';
import { EnvironmentSampler, surfaceAt } from './environment.js';
import { playFootstep } from './footsteps.js';
import { prepareGrassFootsteps } from './grass-steps.js';
import { playMovement } from './movement.js';
import { Music } from './music.js';
import { ChargeHum, playSword } from './sword.js';
import { WeatherAudio } from './weather.js';

// The game hands over animation events before clearing them. Audio never
// drives animation or emits footsteps on its own timer.
export class GameAudio {
  constructor(world, engine = new AudioEngine()) {
    this.engine = engine;
    this.world = world;
    this.environment = new EnvironmentSampler(world);
    this.ambience = new Ambience(engine);
    this.music = new Music(engine);
    this.charge = new ChargeHum(engine);
    this.effects = new Set();
    this.weather = new WeatherAudio(engine);
  }

  play(event) {
    if (this.engine.context?.state !== 'running') return;
    let handles;
    switch (event.type) {
      case 'step':
        handles = playFootstep(this.engine, surfaceAt(this.world, event.x, event.y), event);
        break;
      case 'jump': case 'land': case 'skid':
        handles = playMovement(this.engine, event, surfaceAt(this.world, event.x, event.y));
        break;
      case 'draw': case 'sheathe': case 'swing': case 'slam': case 'whirl':
        handles = playSword(this.engine, event);
        break;
    }
    for (const handle of handles ?? []) if (handle && !handle.ended) this.effects.add(handle);
  }

  update(dt, time, player, camera, fireflies) {
    for (const handle of this.effects) if (handle.ended) this.effects.delete(handle);
    this.engine.setListener(camera.x, camera.y);
    if (this.engine.context?.state !== 'running') {
      this.pause();
      return;
    }
    const signals = this.environment.update(dt, camera.x, camera.y, time);
    void prepareGrassFootsteps(this.engine);
    this.charge.update(player.combat.charge, player.x, player.y);
    this.ambience.update({ ...signals, time, fireflies });
    this.music.update({ night: signals.night, time, dt });
    this.weather.update({ time, dt });
  }

  pause() {
    for (const handle of this.effects) handle.stop();
    this.effects.clear();
    this.charge.pause();
    this.music.pause();
    this.ambience.pause();
    this.weather.pause();
  }

  async dispose() {
    this.pause();
    this.charge.dispose();
    this.ambience.dispose();
    this.music.dispose();
    this.weather.dispose();
    await this.engine.dispose();
  }
}
