import { adoptFine, dropFine, dropRebake, fineBaked, fineWorkers, rebake, unpackCells } from './fine-bakes.js';
import { endTurn, fineRecipe, fineSource, turnOf, withFine, withTurn } from './prop-art.js';
import { bakeWhole, rebuildProp } from './props.js';
import { SEASON_DAYS, dayOfSeason, seasonAt, treeSeasonAt } from './seasons.js';

// Rolls the world's seasons with the clock (see seasons.js). At sunrise the
// new season is the world's: land made from then on grows in it, and the
// river's flotsam and the music follow. The trees near the view turn one by
// one through the night before, each made again in its new season by the
// fine-bake workers (never here: a tree no worker can make keeps its look),
// and each dissolves from its old look into the new over TURN_SECONDS. A
// tree nobody can see, directly or in the water, turns at once.

export const TURN_SECONDS = 2;
// The longest a falling leaf is in the air: a turn keeps the old cells until
// the leaves born from them have landed (see leaves.js).
const LEAF_LIFE = 8;
// At most this many trees are being made again at once, and landings stop
// for the frame once this many milliseconds have gone (after the first).
const MAX_JOBS = 24;
const LANDING_MS = 1;
// Everyone in a lobby shares the realm's seasons, whatever the page asked for.
const SHARED = Object.freeze({ length: SEASON_DAYS, pinned: null });

// A grown tree or bush, standing whole.
export const seasonal = (prop) => (prop.kind === 'tree' || prop.kind === 'bush') && fineSource(prop)?.make === 'tree'
  && !prop.chopped && !prop.burnt && !prop.burning;

const union = (a, b) => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
  minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) });

export class Seasons {
  constructor(world, { length = SEASON_DAYS, pinned = null, debris = null } = {}) {
    this.world = world;
    this.debris = debris;
    this.solo = { length, pinned };
    this.shared = false;
    this.day = 0;
    // Trees being made again: prop → { want, source, handle, retried }.
    this.jobs = new Map();
    // Trees dissolving into their new season: prop → its turn (see #commit).
    this.turns = new Map();
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
  get turning() { return this.turns.size; }

  // Once a frame, with the frame's props. `instant` while nothing is watched
  // (the play card is up, or the frame is pinned); `hold` while a lobby is
  // being joined, whose season is not yet known; `visible(prop, bounds)`
  // whether a tree is seen, directly or in the water.
  update(props, day, tick, time, { instant = false, hold = false, shared = false, visible = () => false } = {}) {
    if (hold) return;
    this.shared = shared;
    this.day = day;
    const plan = this.plan;
    const name = seasonAt(day, plan);
    if (this.world.season !== name) {
      this.world.season = name;
      if (this.debris) this.debris.season = name;
    }
    // Trees in view are asked for first.
    let later = null;
    for (const prop of props) {
      if (!seasonal(prop)) continue;
      const want = treeSeasonAt(prop, day, tick, plan);
      const job = this.jobs.get(prop);
      if (job?.want === want) continue;
      if (job) this.#drop(prop, job);
      if (prop.season === want || this.stuck.has(prop)) continue;
      if (visible(prop)) this.#ask(prop, want, true);
      else (later ??= []).push(prop, want);
    }
    for (let i = 0; later && i < later.length; i += 2) this.#ask(later[i], later[i + 1], false);
    this.#land(time, instant, visible);
    for (const [prop, turn] of this.turns) {
      turn.k = Math.min(1, Math.max(0, (time - turn.at) / TURN_SECONDS));
      if (turn.k === 1 && turn.pending) {
        const fine = turn.pending;
        turn.pending = null;
        adoptFine(prop, fine);
      }
      if (time - turn.at > TURN_SECONDS + LEAF_LIFE) this.#end(prop, turn);
    }
  }

  // Lands every tree still being made, at once, and ends every turn: for
  // scripted screenshots. It makes the trees here.
  finish() {
    for (const [prop, job] of this.jobs) {
      this.#drop(prop, job);
      if (seasonal(prop)) this.#commit(prop, job.source, job.handle.result ?? bakeWhole(job.source), 0, true);
    }
    for (const [prop, turn] of this.turns) this.#end(prop, turn);
  }

  #ask(prop, want, seen) {
    if (this.jobs.size >= MAX_JOBS) return;
    const source = fineSource(prop);
    const next = { ...source, options: { ...source.options, season: want } };
    this.jobs.set(prop, { want, source: next, handle: rebake(next, seen), retried: false });
  }

  #drop(prop, job) {
    dropRebake(job.handle);
    this.jobs.delete(prop);
  }

  #land(time, instant, visible) {
    const start = performance.now();
    let landed = 0;
    for (const [prop, job] of this.jobs) {
      if (landed && performance.now() - start >= LANDING_MS) return;
      const { handle } = job;
      if (handle.failed) {
        this.jobs.delete(prop);
        this.#failed(prop, job);
        continue;
      }
      if (!handle.result) continue;
      this.jobs.delete(prop);
      if (!seasonal(prop)) continue;
      const seen = visible(prop) || visible(prop, handle.result.bounds);
      this.#commit(prop, job.source, handle.result, time, instant || !seen);
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
  // everything that reads it sees one season; its turn keeps the old look
  // to dissolve from, and the bounds of both until it ends.
  #commit(prop, source, result, time, instant) {
    const before = turnOf(prop);
    if (before) this.#end(prop, before);
    const fine = fineBaked(prop);
    const turn = { from: prop.season, cells: prop.cells, leafColor: prop.leafColor, fine, pending: null, at: time, k: 0,
      target: { bounds: result.bounds, top: result.top, height: result.height } };
    const bottom = Math.max(prop.top + prop.height, result.top + result.height);
    prop.season = result.season;
    prop.cells = unpackCells(result.cells);
    prop.leafColor = result.leafColor;
    withFine(prop, function* () { return yield* fineRecipe(rebuildProp(source, true))(); }, source);
    if (instant) Object.assign(prop, turn.target);
    else {
      prop.bounds = union(prop.bounds, result.bounds);
      prop.top = Math.min(prop.top, result.top);
      prop.height = bottom - prop.top;
      withTurn(prop, turn);
      this.turns.set(prop, turn);
    }
    // A tree seen in small letters dissolves in them; one still drawn in
    // ordinary cells dissolves in those, and takes its new small letters
    // when it is done.
    if (instant || fine) adoptFine(prop, result.fine);
    else {
      turn.pending = result.fine;
      dropFine(prop);
    }
    this.world.measureProp(prop);
  }

  #end(prop, turn) {
    Object.assign(prop, turn.target);
    endTurn(prop);
    this.turns.delete(prop);
    if (turn.pending) adoptFine(prop, turn.pending);
  }
}
