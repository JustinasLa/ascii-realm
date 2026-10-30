import { adoptFine, dropRebake, fineWorkers, rebake, unpackCells } from './fine-bakes.js';
import { fineRecipe, fineSource, withFine } from './prop-art.js';
import { bakeWhole, rebuildProp } from './props.js';
import { SEASON_DAYS, dayOfSeason, seasonAt, treeSeasonAt } from './seasons.js';

// Rolls the world's seasons with the clock (see seasons.js). At sunrise the
// new season is the world's: land made from then on grows in it, and the
// river's flotsam and the music follow. The trees near the view turn one by
// one through the night before, each made again in its new season by the
// fine-bake workers (never here: a tree no worker can make keeps its look).
// A tree turns only while nobody can see it, directly or in the water: one
// in view keeps its season until it leaves the view.

// At most this many trees are being made again at once, and landings stop
// for the frame once this many milliseconds have gone (after the first).
const MAX_JOBS = 24;
const LANDING_MS = 1;
// Everyone in a lobby shares the realm's seasons, whatever the page asked for.
const SHARED = Object.freeze({ length: SEASON_DAYS, pinned: null });

// A grown tree or bush, standing whole.
export const seasonal = (prop) => (prop.kind === 'tree' || prop.kind === 'bush') && fineSource(prop)?.make === 'tree'
  && !prop.chopped && !prop.burnt && !prop.burning;

export class Seasons {
  constructor(world, { length = SEASON_DAYS, pinned = null, debris = null } = {}) {
    this.world = world;
    this.debris = debris;
    this.solo = { length, pinned };
    this.shared = false;
    this.day = 0;
    this.tick = 0;
    // Trees being made again: prop → { want, source, handle, retried }.
    this.jobs = new Map();
    // Trees no worker could make, which keep their look.
    this.stuck = new WeakSet();
    this.failed = 0;
  }

  get plan() { return this.shared ? SHARED : this.solo; }
  get length() { return this.plan.length; }
  get pinned() { return this.plan.pinned; }
  get name() { return seasonAt(this.day, this.plan); }
  get dayOfSeason() { return dayOfSeason(this.day, this.length); }
  get pending() { return this.jobs.size; }

  // The world's season for the day, before the frame makes any land, so
  // land first made at sunrise grows in the new season. `hold` while a lobby
  // is being joined, whose season is not yet known. False while held.
  roll(day, { hold = false, shared = false } = {}) {
    if (hold) return false;
    this.shared = shared;
    this.day = day;
    const name = seasonAt(day, this.plan);
    if (this.world.season !== name) {
      this.world.season = name;
      if (this.debris) this.debris.season = name;
    }
    return true;
  }

  // Once a frame, with the frame's props. `instant` while nothing is watched
  // (the play card is up); `hold` as for roll; `visible(prop, bounds)`
  // whether a tree is seen, directly or in the water.
  update(props, day, tick, time, { instant = false, hold = false, shared = false, visible = () => false } = {}) {
    if (!this.roll(day, { hold, shared })) return;
    this.tick = tick;
    const plan = this.plan;
    for (const prop of props) {
      if (!seasonal(prop)) continue;
      const want = treeSeasonAt(prop, day, tick, plan);
      const job = this.jobs.get(prop);
      if (job?.want === want) continue;
      if (job) this.#drop(prop, job);
      if (prop.season === want || this.stuck.has(prop) || (!instant && visible(prop))) continue;
      this.#ask(prop, want);
    }
    this.#land(instant, visible);
  }

  // Lands every tree still being made, at once: for scripted screenshots.
  // It makes the trees here.
  finish() {
    for (const [prop, job] of this.jobs) {
      this.#drop(prop, job);
      if (this.#wanted(prop, job)) this.#commit(prop, job.source, job.handle.result ?? bakeWhole(job.source));
    }
  }

  #ask(prop, want) {
    if (this.jobs.size >= MAX_JOBS) return;
    const source = fineSource(prop);
    const next = { ...source, options: { ...source.options, season: want } };
    this.jobs.set(prop, { want, source: next, handle: rebake(next), retried: false });
  }

  // Whether a job still makes the season its tree wants now, in view of
  // this frame or not: a clock jump or a lobby may have moved it on.
  #wanted(prop, job) {
    return seasonal(prop) && job.want === treeSeasonAt(prop, this.day, this.tick, this.plan);
  }

  #drop(prop, job) {
    dropRebake(job.handle);
    this.jobs.delete(prop);
  }

  #land(instant, visible) {
    const start = performance.now();
    let landed = 0;
    for (const [prop, job] of this.jobs) {
      if (landed && performance.now() - start >= LANDING_MS) return;
      const { handle } = job;
      if (handle.failed) {
        this.jobs.delete(prop);
        if (this.#wanted(prop, job)) this.#failed(prop, job);
        continue;
      }
      // A tree that came into view keeps its old look until it leaves.
      if (!handle.result || (!instant && (visible(prop) || visible(prop, handle.result.bounds)))) continue;
      this.jobs.delete(prop);
      if (!this.#wanted(prop, job)) continue;
      this.#commit(prop, job.source, handle.result);
      landed++;
    }
  }

  // A tree no worker made is asked for once more, then keeps its look.
  #failed(prop, job) {
    if (!job.retried && fineWorkers()) {
      this.jobs.set(prop, { ...job, handle: rebake(job.source), retried: true });
      return;
    }
    this.stuck.add(prop);
    if (!this.failed++) console.info('Some trees keep their season: no worker could make them again.');
  }

  // The prop takes the new season's look and measures at once, so
  // everything that reads it sees one season.
  #commit(prop, source, result) {
    prop.season = result.season;
    prop.cells = unpackCells(result.cells);
    prop.leafColor = result.leafColor;
    Object.assign(prop, { bounds: result.bounds, top: result.top, height: result.height });
    withFine(prop, function* () { return yield* fineRecipe(rebuildProp(source, true))(); }, source);
    adoptFine(prop, result.fine);
    this.world.measureProp(prop);
  }
}
