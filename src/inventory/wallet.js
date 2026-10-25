// The pouch: the money a character carries, kept in whole cents of denars
// and shown as `12.40d`. Coins go straight here and never into the bag.

// The item id of a coin stack lying on the ground; its count is its value
// in cents.
export const DENARS = 'denars';

// Where the pouch is kept between visits. Only `cents` needs keeping when
// the game is saved: the stacks the credited ids guard are not saved.
export const WALLET_KEY = 'ascii-realm-wallet';
const VERSION = 1;

// The coins of the realm, largest first, in cents.
export const DENOMINATIONS = Object.freeze([
  { id: 'goldPouch', cents: 10000, name: 'Pouch of coins' },
  { id: 'goldStack', cents: 1000, name: 'Stack of gold coins' },
  { id: 'goldHandful', cents: 500, name: 'Handful of gold coins' },
  { id: 'goldDenar', cents: 100, name: 'Gold denar' },
  { id: 'silverStack', cents: 10, name: 'Stack of silver coins' },
  { id: 'silverHandful', cents: 5, name: 'Handful of silver coins' },
  { id: 'silverCoin', cents: 1, name: 'Silver coin' },
].map((coin) => Object.freeze(coin)));

const amount = (cents) => Number.isSafeInteger(cents) && cents >= 0;

// Cents as denars with two decimals, "0.73" or "12.40", in whole numbers
// only so a balance never shows a float's error.
export function denars(cents) {
  const whole = Math.floor(cents / 100);
  return `${whole}.${String(cents - whole * 100).padStart(2, '0')}`;
}

// The largest coin that fits in `cents`: gold from a denar up, silver below.
export function coinOf(cents) {
  return DENOMINATIONS.find((coin) => coin.cents <= cents) ?? DENOMINATIONS.at(-1);
}

export class Wallet {
  constructor({ storage } = {}) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
    }
    this.storage = storage;
    this.cents = this.load();
    // Operation ids already paid, so no coin is ever paid twice.
    this.credited = new Set();
  }

  load() {
    try {
      const saved = JSON.parse(this.storage?.getItem(WALLET_KEY) ?? 'null');
      return saved?.v === VERSION && amount(saved.cents) ? saved.cents : 0;
    } catch {
      return 0;
    }
  }

  save() {
    try {
      this.storage?.setItem(WALLET_KEY, JSON.stringify({ v: VERSION, cents: this.cents }));
    } catch {
      // Full or disabled storage keeps the balance for this visit.
    }
  }

  // Pays `cents` under `opId`, completely or not at all, and never twice.
  earn(opId, cents) {
    if (!amount(cents) || cents === 0 || this.credited.has(opId) || !amount(this.cents + cents)) return false;
    this.cents += cents;
    this.credited.add(opId);
    this.save();
    return true;
  }

  get balance() {
    return `${denars(this.cents)}d`;
  }
}
