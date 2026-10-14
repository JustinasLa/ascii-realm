import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { buildRig, rotY } from '../src/entities/rig.js';

test('the cape stays behind the turning body throughout a charged spin', () => {
  const player = new Player(0, 0);
  const meadow = { isWalkable: () => true };
  const tick = (held) => {
    player.update(1 / 60, meadow, { x: 0, y: 0 }, false, held);
    player.events.length = 0;
  };

  player.toggleSword();
  for (let i = 0; i < 100; i++) tick(true);
  assert.ok(player.combat.charged, 'holding the attack button charges the drawn sword');

  let spinFrames = 0;
  let maxTurn = 0;
  for (let i = 0; i < 45; i++) {
    tick(false);
    const turn = player.combat.spin;
    if (turn === 0) continue;
    spinFrames++;
    maxTurn = Math.max(maxTurn, turn);

    const rig = buildRig(player);
    const anchor = rig.at([0, 0.47, -0.12]);
    const back = rotY([0, 0, -1], rig.heading);
    for (const point of player.cape.pts.slice(1)) {
      const behind = (point[0] - anchor[0]) * back[0] + (point[2] - anchor[2]) * back[2];
      assert.ok(behind >= -1e-9, `cape crosses the body at spin ${turn}: ${behind}`);
    }
  }
  assert.ok(spinFrames > 10 && maxTurn > Math.PI, 'the check covers both halves of the spin');
});
