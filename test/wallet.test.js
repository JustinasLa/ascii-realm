import assert from 'node:assert/strict';
import test from 'node:test';
import { coinOf, DENARS, denars, DENOMINATIONS, Wallet, WALLET_KEY } from '../src/inventory/wallet.js';
import { ITEMS } from '../src/inventory/items.js';

// A localStorage stand-in holding strings by key.
function memory(entries = {}) {
  const map = new Map(Object.entries(entries));
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

test('cents read as denars with two decimals, never a float', () => {
  for (const [cents, text] of [[0, '0.00'], [5, '0.05'], [73, '0.73'], [100, '1.00'], [1240, '12.40'], [123456, '1234.56']]) {
    assert.equal(denars(cents), text);
  }
});

test('the largest coin that fits: gold from a denar up, silver below', () => {
  assert.equal(coinOf(99).id, 'silverStack');
  assert.equal(coinOf(100).id, 'goldDenar');
  assert.equal(coinOf(10000).id, 'goldPouch');
  assert.equal(coinOf(0).id, 'silverCoin');
  assert.deepEqual(DENOMINATIONS.map((c) => c.cents), [10000, 1000, 500, 100, 10, 5, 1]);
  assert.ok(Object.isFrozen(DENOMINATIONS) && DENOMINATIONS.every(Object.isFrozen));
  assert.equal(ITEMS[DENARS].weight, 0);
});

test('the pouch pays each operation once, in whole positive cents', () => {
  const wallet = new Wallet({ storage: null });
  assert.equal(wallet.balance, '0.00d');
  assert.equal(wallet.earn('coin:1', 1200), true);
  assert.equal(wallet.earn('coin:2', 40), true);
  assert.equal(wallet.earn('coin:2', 40), false, 'never twice');
  assert.equal(wallet.cents, 1240);
  for (const bad of [0, -1, 1.5, NaN, 2 ** 60, '5']) assert.equal(wallet.earn(`bad:${bad}`, bad), false, String(bad));
  wallet.cents = Number.MAX_SAFE_INTEGER - 1;
  assert.equal(wallet.earn('coin:3', 5), false, 'no overflow');
  wallet.cents = 1240;
  assert.equal(wallet.balance, '12.40d');
});

test('the pouch is kept on the device under its own versioned key', () => {
  const storage = memory();
  const wallet = new Wallet({ storage });
  wallet.earn('coin:1', 73);
  assert.deepEqual(JSON.parse(storage.map.get(WALLET_KEY)), { v: 1, cents: 73 });
  assert.equal(WALLET_KEY, 'ascii-realm-wallet');
  assert.equal(new Wallet({ storage }).cents, 73, 'read back on the next visit');

  for (const saved of ['{', '{"v":2,"cents":5}', '{"v":1,"cents":-5}', '{"v":1,"cents":1.5}', 'null', '7']) {
    assert.equal(new Wallet({ storage: memory({ [WALLET_KEY]: saved }) }).cents, 0, saved);
  }
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const kept = new Wallet({ storage: broken });
  assert.equal(kept.cents, 0);
  assert.equal(kept.earn('coin:1', 50), true, 'a full store keeps the balance in memory');
  assert.equal(kept.cents, 50);
});

test('the pouch finds the page\'s storage itself, or does without', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const storage = memory({ [WALLET_KEY]: '{"v":1,"cents":9}' });
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    assert.equal(new Wallet().cents, 9);
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
    assert.equal(new Wallet().storage, null);
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    assert.equal(new Wallet().storage, null);
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});
