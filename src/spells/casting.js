import { arithmetic, mechanic } from './expression.js';
import { SpellEffects } from './effects.js';
import { hasPresentation } from './presentation.js';
import { toCells, toMetres } from '../entities/monsters.js';

const lower = value => String(value ?? '').toLowerCase();
const distance = (a, b) => Math.hypot(...toMetres(a.x - b.x, a.y - b.y));
const alive = entity => entity && entity.alive !== false && (entity.vitals?.health ?? entity.health ?? 1) > 0;
const isPlayer = entity => entity?.spellPlayer === true || Boolean(entity?.vitals);
const TRUE = value => lower(value) === 'true';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const health = entity => entity.vitals?.health ?? entity.health ?? 0;
const maxHealth = entity => entity.vitals?.maxHealth ?? entity.maxHealth ?? 100;
const MAX_TASKS = 4096;

// A bounded simulation of the gameplay mechanics in TF's configured skills.
// Tick counts in the source are converted to seconds here; distances are metres.
export class Spellcasting {
  constructor({ player, world, monsters, spells = [], peers = () => [], notify = () => {}, onCast = () => {}, onSound = () => {},
    onLightning = () => {} }) {
    Object.assign(this, { player, world, monsters, peers, notify, onCast, onSound, onLightning });
    this.spells = new Map(spells.map(s => [s.id, s]));
    this.states = new Map();
    this.tasks = [];
    this.projectiles = [];
    this.zones = [];
    this.effects = new SpellEffects();
    this.presentationCues = new Map();
    this.time = 0;
    this.generation = 0;
    this.characterClass = 'mage';
    this.level = 1;
    this.selected = spells[0]?.id ?? '';
    this.sync();
  }

  state(entity = this.player) {
    if (!this.states.has(entity)) {
      this.states.set(entity, { auras: new Map(), potions: new Map(), vars: new Map(),
        shield: 0, shieldUntil: 0, mana: 100, maxMana: 100, manaDelay: 0, timer: new Map(), motion: null });
    }
    return this.states.get(entity);
  }

  entities() { return [this.player, ...(this.monsters?.list ?? []), ...this.peers()].filter(alive); }

  sync() {
    for (const entity of this.entities()) {
      this.state(entity);
      entity.magic = { incoming: amount => this.incoming(entity, amount),
        received: (amount, attacker) => this.trigger('DAMAGED', entity, attacker, amount) };
    }
  }

  variants(spell) { return (spell?.variants ?? []).filter(v => v.kind === 'rune' || v.class === this.characterClass); }
  variant(spell) { return this.variants(spell).find(v => v.class === this.characterClass) ?? this.variants(spell)[0]; }
  get available() { return [...this.spells.values()].filter(s => this.variant(s)); }
  get mana() { return this.state().mana; }
  get maxMana() { return this.state().maxMana; }

  modifiers(variant) {
    const values = {};
    for (const [name, value] of Object.entries(variant.params ?? {})) {
      if (typeof value === 'number') values[name] = value;
      else values[name] = clamp((value.base ?? 0) + (value['per-level'] ?? 0) * (this.level - 1), value.min ?? -Infinity, value.max ?? Infinity);
    }
    return values;
  }

  context(spell, variant, caster, options = {}) {
    return { spell, variant, caster, target: options.target ?? null, origin: { x: caster.x, y: caster.y },
      heading: options.heading ?? caster.heading ?? 0, aim: options.aim ?? null, modifiers: this.modifiers(variant),
      vars: new Map(), depth: 0, generation: this.generation, ...options };
  }

  number(value, ctx, fallback = 0) {
    if (value === undefined || value === '') return fallback;
    return arithmetic(value, key => this.resolve(key, ctx));
  }

  resolve(key, ctx) {
    key = lower(key);
    const s = this.state(ctx.caster);
    if (key.startsWith('modifier.')) return ctx.modifiers[key.slice(9)] ?? 0;
    if (key.startsWith('caster.var.')) return this.variable(ctx.caster, key.slice(11)) ?? 0;
    if (key.startsWith('target.var.')) return this.variable(ctx.target ?? ctx.caster, key.slice(11)) ?? 0;
    if (key.startsWith('skill.var.')) return ctx.vars.get(key.slice(10)) ?? 0;
    if (key === 'caster.hp' || key === 'caster.health') return health(ctx.caster);
    if (key === 'caster.mhp') return maxHealth(ctx.caster);
    if (key === 'target.hp') return health(ctx.target ?? ctx.caster);
    if (key === 'utils.epoch.seconds') return this.time;
    if (key.includes('max_mana')) return s.maxMana;
    if (key.includes('mana')) return s.mana;
    if (key === 'x') return ctx.x ?? 0;
    return 0;
  }

  variable(entity, key) {
    const entry = this.state(entity).vars.get(this.expand(key, { caster: entity, target: entity }));
    return entry && entry.until > this.time ? entry.value : undefined;
  }

  expand(text, ctx) {
    return lower(text).replace(/<caster.uuid>/g, String(ctx.caster?.spellId ?? ctx.caster?.id ?? 'self'))
      .replace(/<target.uuid>/g, String(ctx.target?.spellId ?? ctx.target?.id ?? 'self'));
  }

  aimTarget(caster, point, supportive = false) {
    return this.entities().filter(e => e !== caster && (supportive ? isPlayer(e) : !isPlayer(e)))
      .map(e => ({ e, d: distance(e, point ?? caster) })).filter(e => e.d < (point ? 5 : 40))
      .sort((a, b) => a.d - b.d)[0]?.e ?? null;
  }

  cast(id = this.selected, options = {}) {
    const spell = this.spells.get(id);
    const variant = options.variant ?? this.variant(spell);
    const caster = options.caster ?? this.player;
    if (!spell || !variant || !alive(caster)) return { ok: false, reason: 'Choose an available spell.' };
    if (variant.trigger && variant.trigger !== 'CAST' && !options.passive) return { ok: false, reason: 'This ability triggers automatically.' };
    const ctx = this.context(spell, variant, caster, options);
    const s = this.state(caster);
    if (this.hasAura(caster, 'Silenced')) return { ok: false, reason: 'Silenced.' };
    const root = spell.nodes[lower(variant.root ?? spell.root)];
    if (!root) return { ok: false, reason: 'Spell definition missing.' };
    if (!ctx.target) ctx.target = this.aimTarget(caster, options.aim, spell.supportive);
    const relay = () => {
      if (!options.remote && !options.passive) this.onCast({ id, variant: variant.id, heading: ctx.heading, aim: options.aim,
        targetId: ctx.target?.spellId ?? null, characterClass: this.characterClass, level: this.level });
    };
    if (!this.conditions(root.conditions, ctx, caster) || !this.conditions(root.targetConditions, ctx, ctx.target)) {
      if (ctx.stopped) relay();
      return { ok: Boolean(ctx.stopped), stopped: Boolean(ctx.stopped), reason: 'No valid target in range.' };
    }
    const cost = Math.max(0, ctx.modifiers.mana ?? 0);
    if (s.mana < cost) return { ok: false, reason: 'Not enough mana.' };
    s.mana -= cost;
    s.manaDelay = this.time + 1;
    this.run(variant.root ?? spell.root, ctx);
    this.present(ctx, caster, 'cast', { shape: 'ward', radius: 0.8, life: hasPresentation(spell) ? spell.presentation.duration : 0.25 });
    if (!hasPresentation(spell)) this.onSound({ type: 'draw', x: caster.x, y: caster.y });
    relay();
    return { ok: true };
  }

  present(ctx, point, stage, options = {}) {
    const presentation = hasPresentation(ctx.spell) ? ctx.spell.presentation : null;
    this.effects.add(point, { element: ctx.spell.element, presentation, stage, heading: ctx.heading,
      owner: ctx.caster, ...options });
    if (!presentation || this.effects.paused || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    const soundStage = stage === 'cast' ? 'cast' : stage === 'impact' || stage === 'aura' ? 'impact' : 'pulse';
    const key = `${ctx.spell.id}:${soundStage}`;
    if (soundStage !== 'cast' && (this.presentationCues.get(key) ?? -Infinity) > this.time) return;
    this.presentationCues.set(key, this.time + (soundStage === 'pulse' ? 0.28 : 0.12));
    // Keep peer casts and area hits from retaining a growing cue history.
    if (this.presentationCues.size > 128) this.presentationCues.delete(this.presentationCues.keys().next().value);
    this.onSound({ type: 'spell', spellId: ctx.spell.id, stage: soundStage,
      presentation, x: point.x, y: point.y, owner: this });
  }

  setPresentationPaused(paused) {
    paused = Boolean(paused);
    if (paused && !this.effects.paused) this.clearPresentation();
    this.effects.paused = paused;
  }

  clearPresentation() {
    this.effects.clear(); this.presentationCues.clear();
    this.onSound({ type: 'spell-stop', owner: this });
  }

  hasAura(entity, name) { return (this.state(entity).auras.get(lower(name))?.until ?? 0) > this.time; }

  conditions(conditions = [], ctx, entity) {
    for (const text of conditions) {
      const match = String(text).match(/^(.+?)(?:\s+(true|false|castinstead|cast|orelsecast)\s*(\S+)?)?\s*$/i);
      const { op, args: a } = mechanic(match?.[1] ?? text);
      const mode = lower(match?.[2] ?? 'true');
      let pass;
      if (op === 'hasaura' || op === 'hasaurastacks') {
        const entry = entity && this.state(entity).auras.get(lower(a.aura ?? a.auraname ?? a.n));
        pass = Boolean(entry && entry.until > this.time && (op !== 'hasaurastacks' || !a.stacks || entry.stacks === this.number(a.stacks, ctx)));
      }
      else if (op === 'isplayer') pass = isPlayer(entity);
      else if (op === 'iscaster' || op === 'owner' || op === 'ischild') pass = entity === ctx.caster;
      else if (op === 'entitytype' || op === 'mythicmobtype') pass = false;
      else if (op === 'ismonster') pass = Boolean(entity?.kind);
      else if (op === 'onground') pass = (entity?.air ?? 0) <= 0.02;
      else if (op === 'crouching') pass = false;
      else if (op === 'incombat') pass = this.time - (this.state(entity).lastCombat ?? -Infinity) < 8;
      else if (op === 'mmocantarget') pass = entity !== ctx.caster && !isPlayer(entity);
      else if (op === 'entitiesinradius' || op === 'eir') {
        const origin = ctx.origin ?? ctx.caster, r = this.number(a.r ?? a.radius, ctx, 5);
        const count = this.entities().filter(e => e !== ctx.caster && distance(e, origin) <= r).length;
        pass = this.compare(count, a.amount ?? a.a ?? '>0', ctx);
      }
      else if (op === 'distance') pass = entity && this.compare(distance(ctx.caster, entity), a.d, ctx);
      else if (op === 'healthpercent') pass = entity && this.compare(health(entity) / maxHealth(entity) * 100, a.p ?? a.h ?? a.amount, ctx);
      else if (op === 'health') pass = entity && this.compare(health(entity), a.h ?? a.amount, ctx);
      else if (op === 'variableequals' || op === 'variableinrange') {
        const owner = lower(a.var).startsWith('target.') ? entity : ctx.caster;
        const key = lower(a.var).replace(/^(?:caster|target)\./, '');
        const value = this.variable(owner ?? ctx.caster, this.expand(key, ctx));
        pass = op === 'variableinrange' ? value !== undefined && this.compare(Number(value), a.value, ctx)
          : String(value) === String(this.expand(a.value, ctx)).replace(/^"|"$/g, '');
        if (!pass && value !== undefined && op === 'variableequals') pass = Number(value) === this.number(a.value, ctx);
      } else if (op === 'stringequals' || op === 'uuid') {
        pass = this.expand(a.v1 ?? '<target.uuid>', ctx) === this.expand(a.v2 ?? a.uuid, ctx);
      } else throw new Error(`Unsupported spell condition: ${op}`);
      if (mode === 'castinstead' || mode === 'cast') {
        if (pass) { this.run(match[3], ctx); if (mode === 'castinstead') { ctx.stopped = /_stop$/i.test(match[3]); return false; } }
      } else if (mode === 'orelsecast') { if (!pass) { this.run(match[3], ctx); return false; } }
      else if (Boolean(pass) !== (mode !== 'false')) return false;
    }
    return true;
  }

  compare(value, rule, ctx) {
    const text = String(rule ?? '0').replace(/["']/g, '');
    const range = text.match(/^(.+?)(?:to|~)(.+)$/);
    if (range) return value >= this.number(range[1], ctx) && value <= this.number(range[2], ctx);
    const match = text.match(/^(<=|>=|<|>|=)?(.*)$/);
    const right = this.number(match[2], ctx);
    return match[1] === '<' ? value < right : match[1] === '>' ? value > right
      : match[1] === '<=' ? value <= right : match[1] === '>=' ? value >= right : value === right;
  }

  targets(targeter, ctx) {
    if (!targeter) return ctx.target ? [ctx.target] : [ctx.caster];
    const { op, args: a } = typeof targeter === 'string' ? mechanic(targeter.replace(/^@/, '')) : targeter;
    const n = (key, fallback) => this.number(a[key], ctx, fallback);
    if (['self', 'selflocation', 'selfeyelocation'].includes(op)) return [ctx.caster];
    if (op === 'origin') return [ctx.origin];
    if (op === 'target' || op === 'targetedtarget' || op === 'trigger') {
      if (!ctx.target) return [];
      const excluded = a.conditions?.match(/hasaura\{aura=([^}]+)\}\s+false/i);
      return excluded && this.hasAura(ctx.target, excluded[1]) ? [] : [ctx.target];
    }
    if (op === 'targetlocation') return [ctx.aim ?? ctx.target ?? this.forward(ctx, n('max', 20))];
    if (op === 'forward') return [{ ...this.forward(ctx, n('f', 20), n('rot', 0)), h: n('y', 0) }];
    if (['cone', 'ring', 'ringaroundorigin'].includes(op)) return [op === 'ringaroundorigin' ? ctx.origin : ctx.caster];
    const origin = ['entitiesnearorigin', 'playersnearorigin'].includes(op) ? ctx.origin : ctx.caster;
    const playersOnly = ['pir', 'playersnearorigin', 'playersinworld'].includes(op);
    let targets = this.entities().filter(e => (!playersOnly || isPlayer(e)) && distance(e, origin) <= n('r', op === 'playersinworld' ? 1000 : 5));
    if (['entitiesnearorigin', 'playersnearorigin'].includes(op)) targets = targets.filter(e => e !== ctx.caster);
    if (['livingincone', 'livinginradius', 'eir', 'entitiesinradius'].includes(op)) targets = targets.filter(e => e !== ctx.caster);
    if (op === 'mir') return this.summons?.filter(e => distance(e, ctx.caster) < n('r', 40)) ?? [];
    if (op === 'livingincone') targets = targets.filter(e => {
      const [x, z] = toMetres(e.x - ctx.caster.x, e.y - ctx.caster.y);
      return Math.abs(Math.atan2(Math.sin(Math.atan2(x, z) - ctx.heading), Math.cos(Math.atan2(x, z) - ctx.heading))) <= n('a', 90) * Math.PI / 360;
    });
    if (a.sort || a.limit) targets.sort((x, y) => distance(x, origin) - distance(y, origin));
    return targets.slice(0, n('limit', targets.length));
  }

  forward(ctx, metres, degrees = 0) {
    const a = ctx.heading + degrees * Math.PI / 180;
    const [x, y] = toCells(Math.sin(a) * metres, Math.cos(a) * metres);
    return { x: ctx.caster.x + x, y: ctx.caster.y + y };
  }

  schedule(delay, callback, ctx) {
    if (this.tasks.length >= MAX_TASKS) return;
    this.tasks.push({ at: this.time + Math.max(0, delay), callback, generation: ctx.generation, caster: ctx.caster });
  }

  run(name, ctx) {
    if (!name || ctx.depth > 32 || ctx.generation !== this.generation || !alive(ctx.caster)) return;
    const node = ctx.spell.nodes[lower(name)];
    if (!node) return;
    const nested = { ...ctx, depth: ctx.depth + 1 };
    if (!this.conditions(node.conditions, nested, ctx.caster) || !this.conditions(node.targetConditions, nested, ctx.target)) return;
    if (node.cooldown) {
      const state = this.state(ctx.caster);
      state.skillReady ??= new Map();
      if ((state.skillReady.get(lower(name)) ?? 0) > this.time) return;
      state.skillReady.set(lower(name), this.time + node.cooldown);
    }
    let delay = 0;
    for (const step of node.steps) {
      if (step.op === 'delay') { delay += this.number(step.args.ticks, ctx) / 20; continue; }
      if (step.op === 'wait') {
        delay += String(step.args.cond).includes('onground') ? Math.max(0.1, (ctx.caster.vy ?? 0) / 10 + 0.5) : 0.2;
        continue;
      }
      const extra = this.number(step.args.delay, ctx) / 20;
      const repeats = clamp(Math.floor(this.number(step.args.repeat, ctx)), 0, 100);
      for (let i = 0; i <= repeats; i++) {
        const at = delay + extra + i * this.number(step.args.repeatinterval ?? step.args.repeati ?? step.args.ri, ctx, 1) / 20;
        if (at > 0) this.schedule(at, () => this.step(step, nested), ctx);
        else this.step(step, nested);
      }
    }
  }

  step(step, ctx) {
    if (step.chance !== undefined && Math.random() > step.chance) return;
    const a = step.args;
    const n = (key, fallback) => this.number(a[key], ctx, fallback);
    const targets = this.targets(step.target, ctx);
    if (step.op === 'skill' || step.op === 'sudoskill' || step.op === 'randomskill') {
      const name = step.op === 'randomskill' ? a.s?.split(',')[0] : a.s ?? a.skill;
      for (const target of targets) this.run(name, { ...ctx, target,
        ...(step.op === 'sudoskill' ? { caster: target, target: ctx.caster } : {}) });
      return;
    }
    if (step.op === 'projectile' || step.op === 'missile') { for (const target of targets) this.launch(a, ctx, target, step.op === 'missile'); return; }
    if (step.op === 'totem' || step.op === 'orbital') { for (const target of targets) this.zone(a, ctx, target, step.op === 'orbital'); return; }
    for (const target of targets) {
      const s = this.state(target);
      const duration = clamp(n('d', n('duration', 20)) / 20, 0.05, 5000);
      switch (step.op) {
        case 'mmodamage': case 'damage': this.damage(target, Math.max(0, n('a', n('amount', 0))), ctx, a); break;
        case 'heal': {
          const value = n('a', n('amount', 0));
          if (target.heal) target.heal(value);
          else if (target.health !== undefined) target.health = Math.min(maxHealth(target), target.health + value);
          this.present(ctx, target, 'impact', { element: 'cerrith', shape: 'ward', radius: 1 });
          break;
        }
        case 'potion': this.potion(target, a, ctx); break;
        case 'potionclear': if (a.type) s.potions.delete(lower(a.type)); else s.potions.clear(); break;
        case 'aura': this.aura(target, a, ctx); break;
        case 'auraremove': this.removeAura(target, a.aura ?? a.auraname); break;
        case 'shield': s.shield = a.ms !== undefined ? Math.min(n('ms'), s.shield + n('a')) : s.shield + n('a');
          if (hasPresentation(ctx.spell)) this.present(ctx, target, 'aura', { shape: 'ward', radius: 1 }); break;
        case 'attribute': break; // Absorption's Bukkit maximum is represented by shieldUntil.
        case 'throw': case 'pull': case 'lunge': case 'disengage': case 'leap': this.motion(target, a, ctx, step.op); break;
        case 'teleport': case 'teleportto': {
          const point = step.op === 'teleportto' ? this.targets(a.location, ctx)[0] : target;
          if (point) this.teleport(ctx.caster, point);
          break;
        }
        case 'swap': { const origin = { x: target.x, y: target.y }; this.teleport(target, ctx.caster); this.teleport(ctx.caster, origin); break; }
        case 'setvariable': case 'variableadd': case 'variablemath': {
          const owner = lower(a.var).startsWith('target.') ? target : ctx.caster;
          const key = this.expand(lower(a.var).replace(/^(?:caster|target)\./, ''), ctx);
          const previous = this.variable(owner, key) ?? 0;
          const value = lower(a.type) === 'string' ? this.expand(a.value, ctx)
            : step.op === 'variablemath' ? this.number(String(a.equation).replace(/\bx\b/g, String(previous)), ctx)
              : this.number(a.value ?? a.amount, ctx) + (step.op === 'variableadd' ? Number(previous) : 0);
          this.state(owner).vars.set(key, { value, until: a.duration ? this.time + n('duration') / 20 : Infinity });
          break;
        }
        case 'onjump': s.potions.set('jump_lock', { until: this.time + duration, level: 100 }); break;
        case 'ondamaged': case 'onattack': case 'onshoot': case 'ondeath': this.aura(target, { ...a, event: step.op }, ctx); break;
        case 'stun': s.potions.set('stun', { until: this.time + duration, level: 100 }); break;
        case 'ignite': s.potions.set('fire', { until: this.time + n('ticks', 40) / 20, next: this.time + 1, level: 0, ctx }); break;
        case 'command': {
          // The only commands imported from TF are resource-mana give/take.
          const match = String(a.c).match(/resource-mana (give|take) <(caster|target)\.name> (.+)$/i);
          if (!match) throw new Error('Unsupported spell resource command');
          const state = this.state(lower(match[2]) === 'caster' ? ctx.caster : target);
          state.mana = clamp(state.mana + this.number(match[3], ctx) * (match[1] === 'give' ? 1 : -1), 0, state.maxMana);
          break;
        }
        case 'sethealth': if (target.vitals) target.vitals.health = clamp(n('a'), 0, maxHealth(target)); break;
        case 'hide': s.potions.set('invisibility', { until: this.time + duration, level: 0 }); break;
        case 'showentity': s.potions.delete('invisibility'); break;
        case 'modifyprojectile': case 'projectilevelocity':
          if (ctx.projectile) ctx.projectile.speed = lower(a.action ?? a.mode) === 'multiply'
            ? ctx.projectile.speed * n('value', n('vz', 1)) : n('value', n('vz', 12));
          break;
        case 'remove': if (target.summoned) target.health = 0; break;
        case 'summon': this.summon(a, ctx, target); break;
        case 'chain': this.chain(target, a, ctx); break;
        case 'actionmessage': case 'message': if (target === this.player && a.m) this.notify(a.m.replace(/<[^>]+>|&[0-9a-fklmnor]/gi, '')); break;
        // The bolt is a presentation; the host may answer it with its own thunder.
        case 'lightning': case 'fakelightning':
          this.present(ctx, target, 'impact', { shape: 'bolt', radius: n('r', 1), life: n('life', 0.9) });
          if (!this.effects.paused) this.onLightning({ x: target.x, y: target.y, strength: clamp(n('strength', 1), 0, 1) }, ctx);
          if (step.op === 'lightning') this.damage(target, n('damage', 0), ctx, a);
          break;
        case 'visual': this.present(ctx, target, 'pulse', { shape: a.shape ?? 'burst', radius: n('radius', 2), life: n('life', 0.5) }); break;
        default: throw new Error(`Unsupported spell mechanic: ${step.op}`);
      }
    }
  }

  aura(target, args, ctx) {
    const s = this.state(target), name = lower(args.auraname ?? args.aura ?? args.event ?? 'aura');
    const previous = s.auras.get(name);
    if (previous && !args.maxstacks) this.removeAura(target, name);
    const entry = { args, ctx, target, until: this.time + clamp(this.number(args.d ?? args.duration, ctx, 20) / 20, 0.05, 5000),
      interval: Math.max(0.05, this.number(args.i ?? args.interval, ctx, 20) / 20), next: this.time,
      charges: this.number(args.charges, ctx, Infinity),
      stacks: Math.min(this.number(args.maxstacks, ctx, 1), (previous?.stacks ?? 0) + 1) };
    s.auras.set(name, entry);
    if (hasPresentation(ctx.spell)) this.present(ctx, target, 'aura', { shape: 'ward', radius: 1, life: Math.min(1.5, entry.until - this.time) });
    if (args.os ?? args.onstart) this.run(args.os ?? args.onstart, { ...ctx, target });
  }

  removeAura(target, name) {
    const s = this.state(target), entry = s.auras.get(lower(name));
    s.auras.delete(lower(name));
    if (entry?.args.oe ?? entry?.args.onend) this.run(entry.args.oe ?? entry.args.onend, { ...entry.ctx, target });
  }

  potion(target, a, ctx) {
    const s = this.state(target), name = lower(a.type);
    const level = this.number(a.level, ctx, 0), duration = clamp(this.number(a.duration ?? a.d, ctx, 20) / 20, 0.05, 120);
    const previous = s.potions.get(name);
    if (!previous || previous.level <= level || previous.until <= this.time) {
      s.potions.set(name, { until: this.time + duration,
        level, next: this.time + (name === 'regeneration' ? 2.5 / 2 ** level : 1), ctx });
      if (name === 'absorption') { s.shield = Math.max(s.shield, 4 * (level + 1)); s.shieldUntil = this.time + duration; }
    }
    this.present(ctx, target, 'aura', { shape: 'ward', radius: 1, life: 0.3 });
  }

  incoming(entity, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const s = this.state(entity);
    const resistance = s.potions.get('damage_resistance');
    if (resistance?.until > this.time) amount *= Math.max(0, 1 - (resistance.level + 1) * 0.2);
    for (const entry of [...s.auras.values()]) if (entry.args.event === 'ondamaged') {
      if (TRUE(entry.args.ce)) amount = 0;
      const ctx = { ...entry.ctx, target: entity, vars: new Map(entry.ctx.vars) };
      ctx.vars.set('damage-amount', amount);
      this.run(entry.args.oh ?? entry.args.onhit, ctx);
      if (--entry.charges <= 0) this.removeAura(entity, entry.args.auraname ?? entry.args.event);
    }
    const shielded = Math.min(s.shield, amount);
    s.shield -= shielded;
    return amount - shielded;
  }

  damage(target, amount, ctx, options = {}) {
    if (!alive(target) || target === ctx.caster || !Number.isFinite(amount) || amount <= 0) return;
    const targetState = this.state(target);
    const hitDamage = amount;
    if (!TRUE(options.ii) && (targetState.invulnerableUntil ?? 0) > this.time) {
      if (amount <= targetState.lastHitDamage) return;
      amount -= targetState.lastHitDamage;
    }
    if (!TRUE(options.pi)) { targetState.invulnerableUntil = this.time + 0.5; targetState.lastHitDamage = hitDamage; }
    this.state(ctx.caster).lastCombat = this.time;
    this.state(target).lastCombat = this.time;
    if (target.takeHit) {
      const wasAlive = target.alive;
      if (target.takeHit(amount, ctx.caster.x, ctx.caster.y)) {
        if (wasAlive && !target.alive) { this.monsters.kills++; this.trigger('KILL_ENTITY', ctx.caster, target); }
        this.monsters.collect(target);
      }
    } else if (target.takeDamage) target.takeDamage(amount, ctx.caster);
    this.present(ctx, target, 'impact', { radius: 1 });
    if (!hasPresentation(ctx.spell)) this.onSound({ type: 'slam', strength: 0.25, x: target.x, y: target.y });
  }

  motion(target, a, ctx, op) {
    const n = (key, fallback) => this.number(a[key], ctx, fallback);
    const actor = ['lunge', 'leap', 'disengage'].includes(op) ? ctx.caster : target;
    const point = op === 'pull' ? ctx.origin : target;
    let [mx, mz] = toMetres(point.x - actor.x, point.y - actor.y);
    if (op === 'throw') { [mx, mz] = toMetres(actor.x - ctx.caster.x, actor.y - ctx.caster.y); }
    if (!Math.hypot(mx, mz)) { mx = Math.sin(ctx.heading); mz = Math.cos(ctx.heading); }
    if (op === 'disengage') { mx = -Math.sin(ctx.heading); mz = -Math.cos(ctx.heading); }
    const length = Math.hypot(mx, mz) || 1;
    let speed = n('velocity', n('v', 4));
    if (op === 'leap') speed = Math.min(25, length * 3);
    if (op === 'lunge' && speed < 5) speed *= 5;
    this.state(actor).motion = { x: mx / length * speed, z: mz / length * speed, left: 0.35,
      ...(op === 'pull' ? { stop: point } : {}) };
    const up = n('velocityy', n('vy', op === 'leap' ? (target.h ?? 0) * 4 : 0));
    if (isPlayer(actor) && up > 0) {
      const speed = Math.min(12, up < 2 ? up * 8 : up);
      if (actor.launch) actor.launch(speed);
      else { actor.air = Math.max(actor.air ?? 0, 0.05); actor.vy = speed; actor.jumpKind = 'stand'; }
    }
    if (isPlayer(actor) && up < 0 && actor.air > 0) actor.vy = up;
    if (!isPlayer(actor) && up > 0) actor.magicLift = Math.min(2.5, up * 0.12);
  }

  teleport(entity, point) {
    const from = { x: entity.x, y: entity.y };
    const [mx, mz] = toMetres(point.x - from.x, point.y - from.y), length = Math.hypot(mx, mz);
    const steps = Math.max(1, Math.ceil(Math.min(length, 40) / 0.25));
    for (let i = 1; i <= steps; i++) {
      const fraction = i / steps * Math.min(1, 40 / (length || 1));
      const x = from.x + (point.x - from.x) * fraction, y = from.y + (point.y - from.y) * fraction;
      if (!this.world.isWalkable(x, y)) break;
      entity.x = x; entity.y = y;
    }
  }

  launch(a, ctx, target, homing = false) {
    if (this.projectiles.length >= 96) return;
    const origin = TRUE(a.fromorigin) ? ctx.origin : ctx.caster;
    const [mx, mz] = toMetres(target.x - origin.x, target.y - origin.y);
    const length = Math.hypot(mx, mz) || 1;
    const angle = Math.atan2(mx, mz) + this.number(a.ho, ctx) * Math.PI / 180;
    const p = { ...origin, h: this.number(a.syo, ctx, 1.5) + (ctx.caster.air ?? 0), a, ctx, speed: Math.max(0, this.number(a.v, ctx, 20)),
      dx: Math.sin(angle), dz: Math.cos(angle), range: this.number(a.mr, ctx, 40), travelled: 0, age: 0,
      life: this.number(a.md, ctx, 200) / 20, trail: [], hit: new Set(), homing, target: ctx.target };
    p.vh = (this.number(a.tyo, ctx, 1.5) + (target.h ?? 0) - p.h) * p.speed / length;
    const [sideX, sideY] = toCells(Math.cos(angle) * this.number(a.sso, ctx), -Math.sin(angle) * this.number(a.sso, ctx));
    p.x += sideX; p.y += sideY;
    this.projectiles.push(p);
    this.run(a.os ?? a.onstart, { ...ctx, origin: p, projectile: p });
  }

  zone(a, ctx, point, orbital = false) {
    if (this.zones.length >= 96) return;
    const z = { x: point.x, y: point.y, a, ctx, follow: orbital ? point : null, age: 0, next: this.time,
      until: this.time + clamp(this.number(a.md ?? a.duration, ctx, 20) / 20, 0.05, 120), hit: new Set(),
      radius: Math.max(0.1, this.number(a.hr ?? a.r, ctx, 1)), count: 0 };
    this.zones.push(z);
    this.run(a.os ?? a.onstart, { ...ctx, origin: z });
    this.present(ctx, z, 'zone', { shape: 'vortex', radius: z.radius, life: Math.min(8, z.until - this.time), follow: z.follow });
  }

  // MythicMobs' chain: onbounce hops from the target to the nearest entity not
  // yet struck within bounceradius of the last link. originradius (ours) also
  // lets it reach anything within that distance of the skill's origin.
  chain(first, a, ctx) {
    const n = (key, fallback) => this.number(a[key], ctx, fallback);
    const bounces = clamp(Math.floor(n('bounces', n('b', 2))), 0, 16);
    const reach = n('bounceradius', n('br', 2)), around = n('originradius', 0);
    const delay = Math.max(0, n('bouncedelay', n('bd', 0))) / 20, skill = a.onbounce ?? a.ob;
    const center = ctx.origin ?? first, hit = new Set([ctx.caster, first]);
    if (a.hittarget === undefined || TRUE(a.hittarget)) this.run(skill, { ...ctx, target: first, origin: first });
    let from = first;
    for (let i = 1; i <= bounces; i++) {
      const next = this.entities().filter(e => !hit.has(e) && (a.hitplayers !== 'false' || !isPlayer(e))
        && (distance(e, from) <= reach || around > 0 && distance(e, center) <= around))
        .sort((x, y) => distance(x, from) - distance(y, from))[0];
      if (!next) break;
      hit.add(next);
      const link = { x: from.x, y: from.y };
      const bounce = () => {
        if (!alive(next)) return;
        const [mx, mz] = toMetres(next.x - link.x, next.y - link.y);
        this.present(ctx, link, 'pulse', { shape: 'chain', radius: Math.hypot(mx, mz), heading: Math.atan2(mx, mz), life: 0.35 });
        this.run(skill, { ...ctx, target: next, origin: next });
      };
      if (delay * i > 0) this.schedule(delay * i, bounce, ctx); else bounce();
      from = next;
    }
  }

  summon(a, ctx, target) {
    const name = lower(a.type);
    if (name.startsWith('tfmc_vfx') || !ctx.spell.summons?.[name]) {
      this.present(ctx, target, 'pulse', { shape: name.includes('ward') ? 'ward' : 'burst', radius: 2 });
      return;
    }
    this.summons ??= [];
    if (this.summons.length >= 24) return;
    const mob = { x: target.x, y: target.y, health: 1, summoned: true, kind: { radius: 0.5 },
      until: this.time + 10, owner: ctx.caster };
    this.summons.push(mob);
    for (const step of ctx.spell.summons[name]) {
      const copy = { ...ctx, caster: mob, owner: ctx.caster, origin: mob };
      if (step.event === 'onspawn') this.step(step, copy);
      else if (step.event.startsWith('ontimer')) {
        const interval = Number(step.event.split(':')[1]) / 20 || 1;
        for (let at = interval; at <= 10; at += interval) this.schedule(at, () => { if (alive(mob)) this.step(step, copy); }, ctx);
      }
    }
    this.present(ctx, mob, 'aura', { shape: 'ward', radius: 0.8, life: 10, follow: mob });
  }

  trigger(event, caster = this.player, target = null, amount = 0) {
    if (!alive(caster)) return false;
    const s = this.state(caster);
    let replaced = false;
    for (const aura of [...s.auras.values()]) {
      const matches = event === 'SHOOT' ? aura.args.event === 'onshoot' : event === 'ATTACK' ? aura.args.event === 'onattack' : false;
      if (!matches) continue;
      this.run(aura.args.osh ?? aura.args.oh ?? aura.args.onhit, { ...aura.ctx, target, origin: caster });
      replaced ||= TRUE(aura.args.cancelevent) || TRUE(aura.args.ce);
      if (--aura.charges <= 0) this.removeAura(caster, aura.args.auraname ?? aura.args.event);
    }
    if (caster !== this.player) return replaced;
    for (const spell of this.available) {
      const v = this.variant(spell);
      if (!v.trigger || v.trigger === 'CAST' || v.trigger !== event && !(event === 'DAMAGED' && v.trigger === 'DAMAGED_BY_ENTITY')) continue;
      const ctx = this.context(spell, v, caster, { target }); ctx.vars.set('damage-amount', amount);
      this.cast(spell.id, { variant: v, caster, target, passive: true, vars: ctx.vars });
    }
    return replaced;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Fixed small steps keep a high-speed shard from skipping targets or walls.
    let left = Math.min(dt, 2);
    while (left > 1e-9) { const step = Math.min(left, 0.025); this.tick(step); left -= step; }
  }

  tick(dt) {
    this.time += dt;
    if (!alive(this.player) && !this.presentationDead) this.clearPresentation();
    this.presentationDead = !alive(this.player);
    this.sync();
    for (const [entity, s] of this.states) {
      if (!alive(entity)) continue;
      if (this.time > s.manaDelay) s.mana = Math.min(s.maxMana, s.mana + dt * 0.5);
      if (s.shieldUntil && s.shieldUntil <= this.time) { s.shield = 0; s.shieldUntil = 0; }
      for (const [name, entry] of [...s.auras]) {
        if (entry.until <= this.time) { this.removeAura(entity, name); continue; }
      if (entry.next <= this.time && !entry.args.event) {
          entry.next += entry.interval;
          this.run(entry.args.ot ?? entry.args.ontick, { ...entry.ctx,
            target: entity === entry.ctx.caster ? entry.ctx.target ?? entity : entity, origin: entity });
        }
      }
      for (const [name, entry] of s.potions) {
        if (entry.until <= this.time) { s.potions.delete(name); continue; }
        if (entry.next <= this.time && ['regeneration', 'poison', 'wither', 'fire'].includes(name)) {
          const interval = name === 'regeneration' ? 2.5 / 2 ** entry.level : name === 'poison' ? 1.25 / 2 ** entry.level : 1;
          entry.next += Math.max(0.1, interval);
          if (name === 'regeneration') entity.heal?.(1);
          else {
            const damage = name === 'poison' ? Math.min(1, Math.max(0, health(entity) - 1)) : 1;
            this.damage(entity, damage, entry.ctx);
          }
        }
      }
      const potion = name => s.potions.get(name)?.until > this.time ? s.potions.get(name) : null;
      const slow = potion('slow') ?? potion('slowness');
      entity.magicSpeed = Math.max(0, 1 - (slow ? (slow.level + 1) * 0.15 : 0)) * (1 + (potion('speed') ? (potion('speed').level + 1) * 0.2 : 0));
      entity.magicRooted = entity.magicSpeed === 0 || Boolean(potion('jump_lock') || potion('stun'));
      entity.magicStunned = Boolean(potion('stun'));
      entity.magicHidden = Boolean(potion('invisibility'));
      entity.magicHaste = Math.max(0.1, 1 + (potion('fast_digging') ? 0.1 * (potion('fast_digging').level + 1) : 0)
        - (potion('slow_digging') ? 0.1 * (potion('slow_digging').level + 1) : 0));
      entity.magicDamage = (potion('increase_damage') ? 3 * (potion('increase_damage').level + 1) : 0) - (potion('weakness') ? 4 * (potion('weakness').level + 1) : 0);
      if (s.motion) {
        const m = s.motion, step = Math.min(dt, m.left);
        if (!m.stop || distance(entity, m.stop) > 0.5) {
          const [x, y] = toCells(m.x * step, m.z * step);
          if (this.world.isWalkable(entity.x + x, entity.y)) entity.x += x;
          if (this.world.isWalkable(entity.x, entity.y + y)) entity.y += y;
        }
        m.left -= dt; if (m.left <= 0) s.motion = null;
      }
      entity.magicLift = Math.max(0, (entity.magicLift ?? 0) - dt * 2);
    }
    const due = this.tasks.filter(t => t.at <= this.time);
    this.tasks = this.tasks.filter(t => t.at > this.time);
    for (const task of due) if (task.generation === this.generation && alive(task.caster)) task.callback();
    this.updateProjectiles(dt);
    this.updateZones();
    for (const spell of this.available) {
      const v = this.variant(spell);
      if (v.trigger !== 'TIMER') continue;
      const s = this.state(), every = Math.max(0.5, this.modifiers(v).timer / 20 || 8);
      if ((s.timer.get(spell.id) ?? 0) <= this.time) { s.timer.set(spell.id, this.time + every); this.cast(spell.id, { variant: v, passive: true }); }
    }
    if (this.summons) this.summons = this.summons.filter(e => alive(e) && e.until > this.time);
    this.effects.update(dt);
    for (const entity of this.states.keys()) if (entity !== this.player && !this.entities().includes(entity) && !this.summons?.includes(entity)) this.states.delete(entity);
  }

  updateProjectiles(dt) {
    const keep = [];
    const active = this.projectiles;
    this.projectiles = [];
    for (const p of active) {
      if (!alive(p.ctx.caster)) continue;
      p.age += dt;
      if (p.homing && alive(p.target)) {
        const [x, z] = toMetres(p.target.x - p.x, p.target.y - p.y), length = Math.hypot(x, z) || 1;
        p.dx = x / length; p.dz = z / length;
      }
      const travel = Math.min(p.speed * dt, Math.max(0, p.range - p.travelled));
      const samples = Math.max(1, Math.ceil(travel / 0.2));
      let done = false;
      for (let sample = 0; sample < samples; sample++) {
        const [x, y] = toCells(p.dx * travel / samples, p.dz * travel / samples);
        p.x += x; p.y += y; p.travelled += travel / samples;
        p.h += p.vh * dt / samples;
        if (p.a.gravity) p.h -= this.number(p.a.gravity, p.ctx) * p.age * dt / samples * 10;
        const ctx = { ...p.ctx, origin: { x: p.x, y: p.y }, projectile: p };
        const candidates = this.entities().filter(e => e !== p.ctx.caster && !p.hit.has(e)
          && (isPlayer(e) ? p.a.hp !== 'false' : p.a.hnp !== 'false'))
          .filter(e => distance(e, p) <= this.number(p.a.hr, ctx, 1) + (e.kind?.radius ?? 0.4))
          .sort((a, b) => distance(a, p) - distance(b, p));
        if (candidates.length) {
          const target = candidates[0]; p.hit.add(target);
          this.run(p.a.oh ?? p.a.onhit, { ...ctx, target });
          done = p.a.se !== 'false';
        }
        const wall = p.a.sb !== 'false' && !this.world.isWalkable(p.x, p.y);
        if (done || wall || (p.a.gravity || p.vh < 0) && p.h <= 0 || p.travelled >= p.range || p.age >= p.life) {
          this.run(p.a.oe ?? p.a.onend, ctx); done = true; break;
        }
      }
      p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > 8) p.trail.shift();
      if (!done) {
        if (p.nextTick === undefined || p.nextTick <= this.time) {
          p.nextTick = this.time + Math.max(0.05, this.number(p.a.i, p.ctx, 1) / 20);
          this.run(p.a.ot ?? p.a.ontick, { ...p.ctx, origin: { x: p.x, y: p.y }, projectile: p });
        }
        keep.push(p);
      }
    }
    // Callback-created projectiles must survive this update.
    this.projectiles = [...keep, ...this.projectiles];
  }

  updateZones() {
    for (const z of [...this.zones]) {
      if (z.follow) { z.x = z.follow.x; z.y = z.follow.y; }
      const ctx = { ...z.ctx, origin: z };
      if (z.next <= this.time) {
        z.next += Math.max(0.05, this.number(z.a.i ?? z.a.interval, ctx, 1) / 20);
        this.run(z.a.ot ?? z.a.ontick, ctx);
        for (const e of this.entities()) {
          if (e === ctx.caster || z.hit.has(e) || distance(e, z) > z.radius
            || (isPlayer(e) ? z.a.hp === 'false' : z.a.hnp === 'false')) continue;
          z.hit.add(e); z.count++;
          this.run(z.a.oh ?? z.a.onhit, { ...ctx, target: e });
          if (z.a.ch === '1' || this.number(z.a.c, ctx) > 0 && z.count >= this.number(z.a.c, ctx)) { z.until = this.time; break; }
        }
      }
      if (z.until <= this.time) this.run(z.a.oe ?? z.a.onend, ctx);
    }
    this.zones = this.zones.filter(z => z.until > this.time && alive(z.ctx.caster));
  }

  reset() {
    this.generation++;
    this.presentationDead = false;
    this.tasks.length = 0; this.projectiles.length = 0; this.zones.length = 0;
    this.summons = []; this.clearPresentation();
    for (const [entity] of this.states) {
      entity.magicSpeed = 1; entity.magicDamage = 0; entity.magicHaste = 1;
      entity.magicRooted = false; entity.magicStunned = false; entity.magicHidden = false; entity.magicLift = 0;
    }
    this.states.clear(); this.sync();
  }
}
