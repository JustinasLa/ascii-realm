import { readFileSync } from 'node:fs';

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
const modules = new Map([['three', dataURL(`
  export * from ${JSON.stringify(threeURL)};
  export class WebGLRenderer { setPixelRatio() {} setSize() {} setClearColor() {} }
`)]]);
function moduleURL(path) {
  const file = new URL(path, import.meta.url);
  const source = readFileSync(file, 'utf8').replace(/from '([^']+)'/g, (_, specifier) => {
    const target = specifier === 'three' ? specifier : new URL(specifier, file).href;
    return `from ${JSON.stringify(modules.get(target) ?? target)}`;
  });
  const url = dataURL(source); modules.set(file.href, url); return url;
}
moduleURL('../vendor/three/utils/BufferGeometryUtils.js');
moduleURL('../vendor/three/utils/SkeletonUtils.js');
const { GLTFLoader } = await import(moduleURL('../vendor/three/loaders/GLTFLoader.js'));
moduleURL('../src/entities/retarget.js'); moduleURL('../src/entities/gear.js'); moduleURL('../src/entities/armory.js');
const { ModelFigure } = await import(moduleURL('../src/entities/model.js'));
const bytes = readFileSync(new URL('../assets/ual1.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');

// The shipped skeleton, captures, mixer and cell-writing methods are real;
// the GPU renderer is the only substituted part of this integration fixture.
export function modelFigure() {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try { return new ModelFigure(gltf); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}
