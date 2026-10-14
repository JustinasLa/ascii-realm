import { readFile } from 'node:fs/promises';

export function fakeRecordedAudio() {
  const nodes = [], routes = [], invalid = [], allocations = [];
  const context = { state: 'running', currentTime: 10, sampleRate: 24000 };
  const parameter = (value = 0) => {
    const result = { value, calls: [] };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
      'setTargetAtTime', 'cancelAndHoldAtTime', 'cancelScheduledValues']) result[method] = (...args) => {
      if (!args.every(Number.isFinite)) invalid.push({ method, args });
      result.calls.push({ method, args });
    };
    return result;
  };
  const node = kind => {
    const result = { kind, starts: [], stops: [], disconnects: 0,
      connect() {}, disconnect() { this.disconnects++; },
      start(at = context.currentTime) { this.starts.push(at); },
      stop(at = context.currentTime) { this.stops.push(at); },
    };
    nodes.push(result);
    return result;
  };
  context.createGain = () => Object.assign(node('gain'), { gain: parameter() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: parameter(), Q: parameter() });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: parameter(), detune: parameter() });
  context.createBufferSource = () => Object.assign(node('source'), { playbackRate: parameter(1) });
  context.createBuffer = (channels, length) => {
    allocations.push(length);
    const samples = new Float32Array(length);
    return { length, getChannelData: () => samples };
  };
  const engine = { context, muted: false, volumes: { master: 0.7, sfx: 0.8, ambience: 0.6, weather: 0.8 },
    listener: { x: 0, y: 0 }, spatial: () => ({ gain: 1, pan: 0 }), setListener() {},
    route(bus, x, y) {
      const route = { bus, x, y, input: {}, disposals: 0, update() {}, dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    },
  };
  return { engine, context, nodes, routes, invalid, allocations };
}

export async function loadTestRecording(url) {
  const bytes = await readFile(url);
  let position = 12, length;
  while (position < bytes.length) {
    const size = bytes.readUInt32LE(position + 4);
    if (bytes.toString('ascii', position, position + 4) === 'data') { length = size; break; }
    position += 8 + size + (size % 2);
  }
  return { id: url.pathname.split('/').at(-1), duration: length / bytes.readUInt32LE(28) };
}

export const sources = audio => audio.nodes.filter(node => node.kind === 'source');
export const peak = audio => Math.max(...audio.nodes.filter(node => node.kind === 'gain')
  .flatMap(node => node.gain.calls.map(call => call.args[0])));
