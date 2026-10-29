import assert from 'node:assert/strict';
import { SCALE, TILT } from '../../src/entities/rig.js';

// Frames `slot` with the renderer's own camera and checks that every bone of
// `model` lands on the row the camera pitch `look` puts it at: `y` less its
// height at `look.up` and its depth at TILT, in SCALE rows a metre, inside
// the slot. Returns how many bones were checked.
export function assertPitched(figures, model, x, y, slot, look) {
  figures.frame(x, y, slot);
  figures.camera.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  let n = 0;
  model.traverse((o) => {
    if (!o.isBone) return;
    const v = o.getWorldPosition(o.position.clone());
    const ndc = v.clone().project(figures.camera);
    const row = slot.cy0 + ((1 - ndc.y) / 2) * slot.rows;
    const want = y - (v.y * look.up - v.z * TILT) * SCALE;
    assert.ok(Math.abs(row - want) < 1e-6, `${look.deg}° ${o.name} row ${row} vs ${want}`);
    assert.ok(row > slot.cy0 && row < slot.cy0 + slot.rows, `${look.deg}° ${o.name} at ${row} outside ${JSON.stringify(slot)}`);
    n++;
  });
  return n;
}
