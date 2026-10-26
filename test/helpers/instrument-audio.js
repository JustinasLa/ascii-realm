import assert from 'node:assert/strict';

// A fake audio graph: parameters must be finite and scheduled on the audio
// clock; nodes record their connections, starts and stops.
export function fakeAudio({ sampleRate = 48000, currentTime = 10, throwOn = null, state = 'running' } = {}) {
  const nodes = [];
  const routes = [];
  const buffers = [];
  let made = 0;
  // Enough of a context for the real AudioEngine too: resume and close are
  // counted, and resume runs when called, as a browser's does.
  const context = { state, currentTime, sampleRate, resumeCalls: 0,
    resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); } };
  function param(value = 0) {
    const calls = [];
    const result = { value, calls };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
      'setTargetAtTime', 'cancelAndHoldAtTime', 'cancelScheduledValues']) {
      result[method] = (...args) => {
        assert.ok(args.every(Number.isFinite), `${method} parameters are finite`);
        const at = ['cancelAndHoldAtTime', 'cancelScheduledValues'].includes(method) ? args[0] : args[1];
        assert.ok(at >= context.currentTime - 1e-9, `${method} is scheduled on the audio clock`);
        calls.push({ method, args });
      };
    }
    return result;
  }
  function node(kind) {
    made++;
    if (throwOn && throwOn(kind, made)) throw new Error('Unsupported node');
    const result = { kind, connections: [], disconnects: 0, starts: [], stops: [],
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnects++; },
      start(at, offset) {
        assert.ok(Number.isFinite(at) && at >= context.currentTime - 1e-9);
        if (offset !== undefined) assert.ok(Number.isFinite(offset) && offset >= 0);
        this.starts.push(at);
      },
      stop(at) {
        if (at !== undefined) assert.ok(Number.isFinite(at) && at >= context.currentTime - 1e-9);
        this.stops.push(at);
      } };
    nodes.push(result);
    return result;
  }
  context.destination = { kind: 'destination', connect() {}, disconnect() {} };
  context.createGain = () => Object.assign(node('gain'), { gain: param(1) });
  context.createOscillator = () => Object.assign(node('oscillator'), { frequency: param(), detune: param() });
  context.createBiquadFilter = () => Object.assign(node('filter'), { frequency: param(), Q: param(), gain: param() });
  context.createBufferSource = () => Object.assign(node('bufferSource'), { playbackRate: param(1) });
  context.createBuffer = (channels, length, rate) => {
    assert.ok(Number.isInteger(length) && length > 0);
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate: rate, getChannelData: channel => data[channel] };
    buffers.push(buffer);
    return buffer;
  };
  const engine = { context,
    route(bus, x, y) {
      const route = { bus, x, y, input: { kind: 'route', gain: { value: 1 } }, disposals: 0,
        dispose() { this.disposals++; } };
      routes.push(route);
      return route;
    } };
  return { context, engine, nodes, routes, buffers,
    sources: () => nodes.filter(item => ['oscillator', 'bufferSource'].includes(item.kind)) };
}
