// Lobby chat shared by the page and the lobby server: the channel table, the
// text cleaner, the slash commands, how clearly speech carries over distance
// and how it is muffled when it doesn't. Nothing here touches the DOM or a
// socket, so both sides run the same rules.
import { mulberry32 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { ASPECT } from '../world/world.js';
import { cleanName, cleanTag } from './protocol.js';

export const MAX_CHAT_LENGTH = 256;
export const CHAT_LOG_LINES = 100;
// Anything longer than this is refused before any work is done on it.
const MAX_RAW_LENGTH = 1024;

const ch = (options) => Object.freeze({ bubble: false, speech: false, switchable: false, toggleable: false, ...options });

// Ranges are in metres; 0 reaches the whole lobby. `speech` channels carry
// speech that fades and muffles with distance; `bubble` ones will float over
// the speaker's head.
export const CHAT_CHANNELS = Object.freeze({
  rp: ch({ commands: ['rp'], range: 15, bubble: true, speech: true, switchable: true, label: 'Say', placeholder: 'Say something…' }),
  ooc: ch({ commands: ['ooc'], range: 0, switchable: true, toggleable: true, label: 'OOC (whole lobby)', placeholder: 'Out of character, to everyone…' }),
  looc: ch({ commands: ['looc'], range: 20, switchable: true, toggleable: true, label: 'Local OOC', placeholder: 'Out of character, nearby…' }),
  whisper: ch({ commands: ['whisper', 'wh'], range: 2, speech: true, switchable: true, label: 'Whisper', placeholder: 'Whisper…' }),
  shout: ch({ commands: ['shout'], range: 24, bubble: true, speech: true, switchable: true, label: 'Shout', placeholder: 'Shout…' }),
  yell: ch({ commands: ['yell', 'y'], range: 48, bubble: true, speech: true, switchable: true, label: 'Yell', placeholder: 'Yell…' }),
  action: ch({ commands: ['me'], range: 20, switchable: true, label: 'Emote', placeholder: 'Describe an action…' }),
  scene: ch({ commands: ['scene'], range: 20, label: 'Scene', placeholder: 'Describe the scene…' }),
});

// Plain text goes to this channel until the player switches. Local speech
// matches the game's roleplay chat; `ooc` would make every line lobby-wide.
export const DEFAULT_CHANNEL = 'rp';

const CHANNEL_IDS = Object.keys(CHAT_CHANNELS);
export const SWITCHABLE = CHANNEL_IDS.filter((id) => CHAT_CHANNELS[id].switchable);
export const TOGGLEABLE = CHANNEL_IDS.filter((id) => CHAT_CHANNELS[id].toggleable);
const COMMANDS = new Map(CHANNEL_IDS.flatMap((id) => CHAT_CHANNELS[id].commands.map((c) => [c, id])));

export const isChannel = (id) => typeof id === 'string' && Object.hasOwn(CHAT_CHANNELS, id);

// How speech carries: full clarity up to `fadeStart` of the range, fading to
// nothing at its edge. Below `minAudible` nothing is heard, below
// `lowIntelligibility` only that someone spoke, and from `fullClarity` up
// every word.
export const HEARING = Object.freeze({ fadeStart: 0.6, minAudible: 0.05, fullClarity: 0.85, lowIntelligibility: 0.15,
  placeholder: '*muffled voices*' });

// Each message adds `add`; the budget drains `drainPerSecond`; a message that
// would take it over `max` is refused. A burst of ten, then one a second.
export const SPAM = Object.freeze({ add: 20, drainPerSecond: 20, max: 200 });

const TYPOGRAPHY = [
  [/[\u2018\u2019\u201a\u201b\u2032]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'],
  [/[\u2013\u2014\u2015]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, ' '],
];

// Printable ASCII only, after turning phone-keyboard quotes, dashes and
// accents into their plain forms. Control, bidi and zero-width characters,
// emoji and colour codes are dropped. Returns '' for nothing left, or null
// for something that isn't text or is far too long to be a message.
export function cleanChatText(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LENGTH) return null;
  let text = raw.normalize('NFKD').replace(/\p{M}/gu, '');
  for (const [pattern, plain] of TYPOGRAPHY) text = text.replace(pattern, plain);
  return text.replace(/[\t\n\r\f\v]/g, ' ').replace(/[^\x20-\x7e]/g, '').replace(/ {2,}/g, ' ').trim();
}

// `/x:shout` works like `/shout`, in any case.
export function normalizeLabel(token) {
  const colon = token.indexOf(':');
  return (colon >= 0 && colon < token.length - 1 ? token.slice(colon + 1) : token).toLowerCase();
}

export const channelForCommand = (label) => COMMANDS.get(normalizeLabel(label)) ?? null;

const resolveChannel = (input) => {
  const label = input.toLowerCase();
  return isChannel(label) ? label : COMMANDS.get(label) ?? null;
};

function message(channel, raw, hidden) {
  const text = cleanChatText(raw);
  if (!text) return { kind: 'empty' };
  if (text.length > MAX_CHAT_LENGTH) return { kind: 'error', code: 'too-long' };
  if (hidden?.has(channel)) return { kind: 'error', code: 'hidden' };
  return { kind: 'send', channel, text };
}

// What the chat bar's text asks for. Plain text goes to the active channel;
// `/<channel command> text` sends once elsewhere; `/channel`,
// `/channeltoggle` and `/help` are handled on the page. Never throws.
export function parseChatInput(raw, { active = DEFAULT_CHANNEL, hidden = new Set() } = {}) {
  if (typeof raw !== 'string') return { kind: 'empty' };
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('/')) return message(active, raw, hidden);
  const body = trimmed.slice(1);
  const space = body.search(/\s/);
  const token = space < 0 ? body : body.slice(0, space);
  if (!token) return { kind: 'error', code: 'unknown' };
  const label = normalizeLabel(token);
  const rest = space < 0 ? '' : body.slice(space + 1).trim();
  const args = rest ? rest.split(/\s+/) : [];
  if (label === 'help') return { kind: 'help' };
  if (label === 'channel') {
    if (!args.length) return { kind: 'show-channel', channel: active };
    if (args.length > 1) return { kind: 'error', code: 'syntax', label };
    const channel = resolveChannel(args[0]);
    if (!channel || !CHAT_CHANNELS[channel].switchable) return { kind: 'error', code: 'not-switchable' };
    if (channel === active) return { kind: 'error', code: 'already' };
    return { kind: 'switch', channel };
  }
  if (label === 'channeltoggle') {
    if (args.length !== 1) return { kind: 'error', code: 'syntax', label };
    const channel = resolveChannel(args[0]);
    if (!channel || !CHAT_CHANNELS[channel].toggleable) return { kind: 'error', code: 'not-toggleable' };
    return { kind: 'toggle', channel };
  }
  const channel = COMMANDS.get(label);
  if (!channel) return { kind: 'error', code: 'unknown' };
  const sent = message(channel, rest, hidden);
  return sent.kind === 'empty' ? { kind: 'error', code: 'usage', label } : sent;
}

// Metres between two positions on the ground, the unit the party frames show.
export function metresBetween(a, b) {
  return Math.hypot((a.x - b.x) * ASPECT / SCALE, (a.y - b.y) / (SCALE * TILT));
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// How clearly a listener this far away hears speech on a channel of this
// range: 1 near, easing to 0 at the edge. A lobby-wide channel is always 1.
export function clarityAt(distance, range) {
  if (range <= 0) return 1;
  if (distance > range) return 0;
  const fadeStart = range * HEARING.fadeStart;
  if (distance <= fadeStart) return 1;
  return 1 - smoothstep((distance - fadeStart) / Math.max(0.001, range - fadeStart));
}

// One seed per message and listener, so each hears their own muffling and
// the same message always muffles the same way for them.
export function chatSeed(seq, listenerId) {
  let h = 0x811c9dc5;
  for (const c of `${seq}:${listenerId}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

function randomFrom(seed) {
  const next = mulberry32(seed);
  return { double: next, int: (n) => Math.floor(next() * n), bool: () => next() < 0.5 };
}

// The words that blur first, in order, each with its chance at full distortion
// and the clarity at or below which it can happen. Each changes only its first
// match; `-end-` trails the line off.
const MUFFLE_RULES = [
  { replace: 'th', to: 'th...', max: 0.7, percentage: 70 },
  { replace: 'sh', to: 'sh...', max: 0.6, percentage: 60 },
  { replace: '-end-', to: '...', max: 0.5, percentage: 40 },
];

function applyRule(text, rule, random, chance) {
  if (rule.replace === '-end-') {
    return random.int(100) < chance && !text.endsWith('...') ? `${text}...` : text;
  }
  const index = text.toLowerCase().indexOf(rule.replace);
  if (index < 0 || random.int(100) >= chance) return text;
  return text.slice(0, index) + rule.to + text.slice(index + rule.replace.length);
}

function applyRules(text, clarity, random) {
  const distortion = 1 - clarity;
  let result = text;
  for (const rule of MUFFLE_RULES) {
    if (clarity > rule.max) continue;
    const chance = Math.round(rule.percentage * distortion);
    if (chance > 0) result = applyRule(result, rule, random, chance);
  }
  return result;
}

// The phonetic muffler: sounds swap for their nearest blur (`st` → `sn`,
// `th` → `n`), stem-final and inner consonants smear into `m`/`n`, long words
// break with `...` and lose their first letters.
const ELLIPSIS = '...';
const isVowel = (c) => 'aeiou'.includes(c);
const isLetter = (c) => /[a-z]/i.test(c);
const pickNasal = (random) => random.bool() ? 'm' : 'n';

function toNasal(c, random) {
  if ('tdszcx'.includes(c)) return 'n';
  if ('pbfvm'.includes(c)) return 'm';
  if ('kgqlrhjwy'.includes(c)) return pickNasal(random);
  return c;
}

const CLUSTERS = [
  ['st', 'sn', 0.88, true], ['ss', 'sm', 0.88, true], ['th', 'n', 0.76], ['sh', 'm', 0.72], ['ch', 'm', 0.68],
  ['mp', 'm', 0.66], ['mb', 'm', 0.66], ['ck', 'k', 0.62], ['ng', 'n', 0.58], ['tt', 'tn', 0.74],
  ['dd', 'n', 0.74], ['ll', 'l', 0.58], ['ght', 'nt', 0.7], ['tion', 'n', 0.55],
];

function replaceCluster(word, from, to, distortion, random, weight, force) {
  if (!word.includes(from)) return word;
  if (!force && random.double() >= distortion * weight) return word;
  return word.replaceAll(from, to);
}

function applyClusters(word, distortion, random) {
  const forceCore = distortion >= 0.45;
  return CLUSTERS.reduce((w, [from, to, weight, core]) =>
    replaceCluster(w, from, to, distortion, random, weight, core && forceCore), word);
}

const isSuffixTail = (s) => s.length <= 3 || (s.endsWith('ing') && s.length <= 5);

function muffleStemFinal(word, distortion, random) {
  let stem = word;
  let suffix = '';
  for (const tail of ['ing', 'ed', 'le']) {
    if (word.endsWith(tail) && word.length > tail.length + 1) {
      stem = word.slice(0, -tail.length);
      suffix = tail;
      break;
    }
  }
  const last = stem.at(-1);
  if (isVowel(last) || random.double() >= distortion * 0.86) return word;
  return stem.slice(0, -1) + toNasal(last, random) + suffix;
}

function smearInner(word, distortion, random) {
  if (word.length < 3) return word;
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (isVowel(c) || i === 0 || i === word.length - 1 || random.double() >= distortion * 0.42) {
      out += c;
      continue;
    }
    const smeared = toNasal(c, random);
    out += smeared === c ? pickNasal(random) : smeared;
  }
  return out;
}

function processSegment(segment, distortion, random) {
  let working = replaceCluster(segment, 'ff', 'f', distortion, random, 0.78, false);
  if (!isSuffixTail(working)) working = muffleStemFinal(working, distortion, random);
  return smearInner(working, distortion, random);
}

function doubleConsonantBreak(word) {
  for (let i = 2; i < word.length - 1; i++) {
    if (word[i - 1] === word[i] && !isVowel(word[i])) return i;
  }
  return -1;
}

// The likeliest syllable edge near the middle of the word.
function breakIndex(word) {
  const mid = Math.floor(word.length / 2);
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 2; i < word.length - 1; i++) {
    const prev = word[i - 1];
    const current = word[i];
    let score = 0;
    if (isVowel(prev) && !isVowel(current)) score += 3;
    if (!isVowel(prev) && isVowel(current)) score += 2;
    if (i >= Math.floor(word.length / 2) && !isVowel(prev) && isVowel(current)) score += 2;
    if (prev === current && !isVowel(current)) score += 5;
    score -= Math.abs(i - mid);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

const trimBridge = (left, right) => left.at(-1) === right[0] && !isVowel(right[0]) ? right.slice(1) : right;

function secondBreak(word, distortion, random) {
  const at = word.indexOf(ELLIPSIS) + ELLIPSIS.length;
  const right = word.slice(at);
  if (right.length < 4 || random.double() >= distortion * 0.5) return word;
  const local = breakIndex(right);
  const left = right.slice(0, local);
  return word.slice(0, at) + left + ELLIPSIS + trimBridge(left, right.slice(local));
}

function insertBreaks(word, distortion, random) {
  let at = doubleConsonantBreak(word);
  if (at < 0 || distortion < 0.32) {
    if (random.double() >= distortion * 0.68) return word;
    at = breakIndex(word);
  }
  const left = word.slice(0, at);
  let result = left + ELLIPSIS + trimBridge(left, word.slice(at));
  if (word.length >= 8 && distortion > 0.42 && random.double() < distortion * 0.45) {
    result = secondBreak(result, distortion, random);
  }
  return result;
}

function slurLead(word, distortion, random) {
  if (word.length < 5 || distortion < 0.38 || random.double() >= distortion * 0.48) return word;
  const ellipsis = word.indexOf(ELLIPSIS);
  const lead = ellipsis >= 0 ? word.slice(0, ellipsis) : word;
  if (lead.length < 4) return word;
  let drop = 1;
  if (lead.length >= 6 && random.double() < distortion * 0.25) drop = 2;
  return ELLIPSIS + lead.slice(drop) + (ellipsis >= 0 ? word.slice(ellipsis) : '');
}

function muffleWord(word, distortion, random) {
  if (word.length <= 1) return word;
  let working = applyClusters(word.toLowerCase(), distortion, random);
  if (working.length >= 5) working = insertBreaks(working, distortion, random);
  working = working.split(ELLIPSIS).map((part) => processSegment(part, distortion, random)).join(ELLIPSIS);
  return slurLead(working, distortion, random);
}

export function phoneticMuffle(text, clarity, random) {
  const distortion = 1 - clarity;
  if (distortion < 0.05) return text;
  return text.replace(/[A-Za-z]+/g, (word) => muffleWord(word, distortion, random));
}

// Muffling can lengthen a line; keep every version within the message limit.
export function capChat(text) {
  if (text.length <= MAX_CHAT_LENGTH) return text;
  const room = MAX_CHAT_LENGTH - ELLIPSIS.length;
  const space = text.lastIndexOf(' ', room);
  return `${text.slice(0, space > 0 ? space : room)}${ELLIPSIS}`;
}

// What a listener at this clarity hears: `{ text, muffled }`, where `muffled`
// means only the placeholder got through, or null when nothing did.
export function muffle(text, clarity, seed) {
  if (clarity < HEARING.minAudible) return null;
  if (clarity >= HEARING.fullClarity) return { text, muffled: false };
  if (clarity < HEARING.lowIntelligibility) return { text: HEARING.placeholder, muffled: true };
  const random = randomFrom(seed);
  const ruled = applyRules(text, clarity, random);
  const heard = ruled !== text ? ruled : phoneticMuffle(text, clarity, random);
  return { text: capChat(heard), muffled: false };
}

const finite01 = (value) => typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : 1;
const validId = (id) => typeof id === 'string' && /^[0-9a-f]{1,32}$/.test(id);

// A relayed line as the server sends it, re-checked on the page: a known
// channel, a hex speaker id and clean text within the limit. Anything else is
// dropped.
export function readChat(raw) {
  if (!raw || typeof raw !== 'object' || raw.type !== 'chat') return null;
  if (!Number.isSafeInteger(raw.seq) || raw.seq < 0 || !isChannel(raw.channel) || !validId(raw.from)) return null;
  const text = cleanChatText(raw.text);
  if (!text || text.length > MAX_CHAT_LENGTH) return null;
  return { seq: raw.seq, channel: raw.channel, from: raw.from, name: cleanName(raw.name), tag: cleanTag(raw.tag), text,
    clarity: Math.round(finite01(raw.clarity) * 100) / 100, muffled: raw.muffled === true };
}

export const NOTICE_CODES = ['unheard', 'rate', 'too-long', 'hidden', 'toggled', 'invalid'];

// Server notices are codes, never text, so a server can't write system lines.
export function readChatNotice(raw) {
  if (!raw || typeof raw !== 'object' || raw.type !== 'chat-notice' || !NOTICE_CODES.includes(raw.code)) return null;
  if (raw.code !== 'toggled') return { code: raw.code };
  if (!isChannel(raw.channel) || !CHAT_CHANNELS[raw.channel].toggleable) return null;
  return { code: 'toggled', channel: raw.channel, hidden: raw.hidden === true };
}

// The page's wording for every notice and local error.
export function noticeText(code, data = {}) {
  switch (code) {
    case 'unheard': return 'No one can hear you in this channel.';
    case 'rate': return 'You are sending messages too fast.';
    case 'too-long': return `Message too long (${MAX_CHAT_LENGTH} characters at most).`;
    case 'hidden': return 'Channel is toggled off. Toggle it back on.';
    case 'toggled': return `Toggled ${data.channel} visibility ${data.hidden ? 'OFF' : 'ON'}.`;
    case 'usage': return `Usage: /${data.label} <message>`;
    case 'syntax': return `Bad syntax. Try /${data.label} <channel>.`;
    case 'not-switchable': return `You cannot target that channel. Allowed channels: ${SWITCHABLE.join(', ')}.`;
    case 'not-toggleable': return `You cannot target that channel. Allowed channels: ${TOGGLEABLE.join(', ')}.`;
    case 'already': return 'You are already using that channel.';
    case 'switched': return `Switched to ${data.channel}.`;
    case 'show-channel': return `Your default chat channel is ${data.channel}.`;
    case 'unknown': return 'Unknown command. Type /help for a list.';
    case 'offline': return 'Not connected. Your message was not sent.';
    default: return 'That channel cannot be used.';
  }
}

export const HELP_LINES = [
  'Chat commands:',
  ...CHANNEL_IDS.map((id) => {
    const def = CHAT_CHANNELS[id];
    const reach = def.range > 0 ? `${def.range} m` : 'whole lobby';
    return `/${def.commands.join(', /')} <message> - ${def.label.replace(/ \(.*\)$/, '')} (${reach})`;
  }),
  `/channel [${SWITCHABLE.join('|')}] - show or switch your channel`,
  `/channeltoggle <${TOGGLEABLE.join('|')}> - hide or show a channel`,
];
