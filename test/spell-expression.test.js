import assert from 'node:assert/strict';
import test from 'node:test';
import { arithmetic } from '../src/spells/expression.js';

test('powers precede products, associate right and support signed operands', () => {
  for (const [expression, expected] of [
    ['2 * 3 ^ 2', 18], ['2 ^ 3 ^ 2', 512], ['-2 ^ 2', -4],
    ['(-2) ^ 2', 4], ['2 ^ -2', 0.25], ['2 ^ -2 ^ 2', 0.0625],
    ['3 * -2 + +4', -2], ['max(2, 3) ^ 2', 9],
  ]) assert.equal(arithmetic(expression), expected, expression);
});

test('remainder operators coexist with percent placeholders', () => {
  const resolve = key => key === 'mmocore_mana' ? 17 : 0;
  for (const expression of ['5%2+3%2', '5 % 2 + 3 % 2']) {
    assert.equal(arithmetic(expression, resolve), 2, expression);
  }
  assert.equal(arithmetic('%mmocore_mana%', resolve), 17);
  assert.equal(arithmetic('%mmocore_mana% % 5 + 3 % 2', resolve), 3);
  assert.equal(arithmetic('%missing% + 1', resolve), 1);
});
