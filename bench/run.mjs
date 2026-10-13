import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { benchmark } from './scene.js';

const root = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : undefined;
console.log(JSON.stringify(await benchmark(root), null, 2));
