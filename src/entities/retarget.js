import * as THREE from 'three';
import { JOINTS } from './jumps.js';

// Puts motion capture onto the character's skeleton. A capture is a list of
// joint positions per frame (see jumps.js); each bone is turned so that it
// lies along the same body segment as in the capture, twisted the same way.
// Every segment gets a frame from joint positions alone (along the segment,
// plus a second direction such as which way the knee bends), worked out the
// same way for the capture and for the character's own rest pose, so the
// turn between the two carries straight over whatever pose each skeleton
// rests in.

const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);
const v3 = () => new THREE.Vector3();

// An orientation whose y axis lies along `along` and x axis as near `side`
// as it can.
function basis(along, side) {
  const y = along.clone().normalize();
  const x = side.clone().addScaledVector(y, -side.dot(y)).normalize();
  const z = v3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// Every segment's frame from a pose's joint positions, `j(key)`.
function frames(j) {
  const sub = (a, b) => j(a).clone().sub(j(b));
  const hipMid = j('hipL').clone().add(j('hipR')).multiplyScalar(0.5);
  const pelvisSide = sub('hipL', 'hipR');
  const chestSide = sub('shoulderL', 'shoulderR');
  const chestUp = sub('neck', 'chest');
  const f = {
    pelvis: basis(j('chest').clone().sub(hipMid), pelvisSide),
    chest: basis(chestUp, chestSide),
    neck: basis(sub('head', 'neck'), chestSide),
    head: basis(sub('headEnd', 'head'), chestSide),
  };
  const forward = v3().crossVectors(chestSide, chestUp).normalize();
  for (const s of ['L', 'R']) {
    // The knee bends in the plane of the leg; when the leg is straight the
    // foot shows which way it faces.
    const thigh = sub(`knee${s}`, `hip${s}`).normalize();
    const shin = sub(`ankle${s}`, `knee${s}`).normalize();
    const foot = sub(`toe${s}`, `ankle${s}`).normalize();
    const knee = v3().crossVectors(thigh, shin).add(v3().crossVectors(thigh, foot.clone().negate()).multiplyScalar(0.15));
    f[`thigh${s}`] = basis(thigh, knee);
    f[`shin${s}`] = basis(shin, knee);
    const up = sub(`knee${s}`, `ankle${s}`);
    f[`foot${s}`] = basis(foot, up);
    f[`toe${s}`] = basis(sub(`toeEnd${s}`, `toe${s}`), up);
    // Likewise the elbow, which bends forwards from a straight arm.
    const upper = sub(`elbow${s}`, `shoulder${s}`).normalize();
    const fore = sub(`wrist${s}`, `elbow${s}`).normalize();
    const elbow = v3().crossVectors(upper, fore).add(v3().crossVectors(upper, forward).multiplyScalar(0.15));
    f[`clav${s}`] = basis(sub(`shoulder${s}`, `clav${s}`), chestUp);
    f[`upper${s}`] = basis(upper, elbow);
    f[`fore${s}`] = basis(fore, elbow);
  }
  return f;
}

// Which segment frame turns each bone; the spine is shared out between the
// pelvis and chest.
const DRIVE = {
  'DEF-hips': 'pelvis',
  'DEF-spine.001': ['pelvis', 'chest', 1 / 3],
  'DEF-spine.002': ['pelvis', 'chest', 2 / 3],
  'DEF-spine.003': 'chest',
  'DEF-neck': 'neck',
  'DEF-head': 'head',
};
for (const s of ['L', 'R']) {
  Object.assign(DRIVE, {
    [`DEF-thigh.${s}`]: `thigh${s}`, [`DEF-shin.${s}`]: `shin${s}`, [`DEF-foot.${s}`]: `foot${s}`,
    [`DEF-toe.${s}`]: `toe${s}`, [`DEF-shoulder.${s}`]: `clav${s}`, [`DEF-upper_arm.${s}`]: `upper${s}`,
    [`DEF-forearm.${s}`]: `fore${s}`, [`DEF-hand.${s}`]: `fore${s}`,
  });
}

// The character's joints at rest, under the capture's names.
function restJoints(bones) {
  const at = (n) => bones[bone(n)].getWorldPosition(v3());
  const tail = (n, len) => at(n).add(v3().set(0, 1, 0).transformDirection(bones[bone(n)].matrixWorld).multiplyScalar(len));
  const j = {
    hips: at('DEF-hips'), spine: at('DEF-spine.001'), chest: at('DEF-spine.003'), neck: at('DEF-neck'),
    head: at('DEF-head'), headEnd: tail('DEF-head', 0.2),
  };
  for (const s of ['L', 'R']) {
    Object.assign(j, {
      [`hip${s}`]: at(`DEF-thigh.${s}`), [`knee${s}`]: at(`DEF-shin.${s}`), [`ankle${s}`]: at(`DEF-foot.${s}`),
      [`toe${s}`]: at(`DEF-toe.${s}`), [`toeEnd${s}`]: tail(`DEF-toe.${s}`, 0.06), [`clav${s}`]: at(`DEF-shoulder.${s}`),
      [`shoulder${s}`]: at(`DEF-upper_arm.${s}`), [`elbow${s}`]: at(`DEF-forearm.${s}`),
      [`wrist${s}`]: at(`DEF-hand.${s}`), [`hand${s}`]: tail(`DEF-hand.${s}`, 0.08),
    });
  }
  return j;
}

// Reads frame i of a capture as joint positions, mirrored left for right
// if asked.
function captureJoints(data, i, mirror) {
  const row = data.frames[i];
  const j = {};
  JOINTS.forEach((k, n) => {
    const key = mirror ? k.replace(/L$/, '#').replace(/R$/, 'L').replace(/#$/, 'R') : k;
    j[key] = new THREE.Vector3(mirror ? -row[n * 3] : row[n * 3], row[n * 3 + 1], row[n * 3 + 2]);
  });
  return j;
}

// Builds an AnimationClip for `model` (whose bones are `bones`, by
// sanitised name) from capture `data`. The model must be in its rest pose.
// Bones the capture does not cover (fingers, the root) are held as they
// start in the clip `hold`.
export function captureClip(name, data, model, bones, { mirror = false, hold } = {}) {
  model.updateMatrixWorld(true);
  const restWorld = {};
  for (const n of Object.keys(DRIVE)) restWorld[n] = bones[bone(n)].getWorldQuaternion(new THREE.Quaternion());
  const restJ = restJoints(bones);
  const restF = frames((k) => restJ[k]);
  const hips = bones[bone('DEF-hips')];
  const hipMid = restJ.hipL.clone().add(restJ.hipR).multiplyScalar(0.5);
  // Where the middle of the hip joints sits in the hips bone's own frame.
  const midInHips = hipMid.clone().sub(hips.getWorldPosition(v3())).applyQuaternion(restWorld['DEF-hips'].clone().invert());
  const rootWorld = hips.parent.getWorldQuaternion(new THREE.Quaternion());
  const rootInv = hips.parent.matrixWorld.clone().invert();
  const byName = Object.fromEntries(Object.keys(DRIVE).map((k) => [bone(k), k]));

  const n = data.frames.length;
  const times = Float32Array.from({ length: n }, (_, i) => i / data.fps);
  const quats = Object.fromEntries(Object.keys(DRIVE).map((k) => [k, new Float32Array(n * 4)]));
  const hipPos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const cj = captureJoints(data, i, mirror);
    const cf = frames((k) => cj[k]);
    // The turn from the rest pose to this frame for each segment.
    const turn = (key) => cf[key].clone().multiply(restF[key].clone().invert());
    const world = {};
    for (const [b, d] of Object.entries(DRIVE)) {
      const t = Array.isArray(d) ? turn(d[0]).slerp(turn(d[1]), d[2]) : turn(d);
      world[b] = t.multiply(restWorld[b]);
    }
    for (const b of Object.keys(DRIVE)) {
      const parent = byName[bones[bone(b)].parent.name];
      const parentWorld = parent ? world[parent] : rootWorld;
      parentWorld.clone().invert().multiply(world[b]).toArray(quats[b], i * 4);
    }
    const mid = cj.hipL.clone().add(cj.hipR).multiplyScalar(0.5);
    const at = mid.sub(midInHips.clone().applyQuaternion(world['DEF-hips'])).applyMatrix4(rootInv);
    at.toArray(hipPos, i * 3);
  }
  // Keep each key on the same side as the last, so slerping between keys
  // takes the short way round.
  for (const q of Object.values(quats)) {
    for (let i = 4; i < q.length; i += 4) {
      if (q[i] * q[i - 4] + q[i + 1] * q[i - 3] + q[i + 2] * q[i - 2] + q[i + 3] * q[i - 1] < 0) {
        for (let c = 0; c < 4; c++) q[i + c] = -q[i + c];
      }
    }
  }
  const tracks = Object.entries(quats).map(([b, q]) => new THREE.QuaternionKeyframeTrack(`${bone(b)}.quaternion`, times, q));
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, hipPos));
  if (hold) {
    const driven = new Set(Object.keys(DRIVE).map(bone));
    const end = [0, times[n - 1]];
    for (const t of hold.tracks) {
      const [node, prop] = t.name.split('.');
      if (driven.has(node) || prop === 'scale') continue;
      const first = Array.from(t.values.slice(0, t.getValueSize()));
      const Track = prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new Track(t.name, end, [...first, ...first]));
    }
  }
  return new THREE.AnimationClip(name, times[n - 1], tracks);
}
