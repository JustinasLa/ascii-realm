import { fineBuffers, packFine } from './fine-bakes.js';
import { fineRecipe } from './prop-art.js';
import { rebuildProp } from './props.js';

// Bakes props in small letters for the fine grid, off the main thread (see
// fine-bakes.js). Each message names a prop by the source it was made from;
// the reply carries its packed cells, or none if it could not be rebuilt.
self.onmessage = ({ data }) => {
  let cells = null;
  try {
    const recipe = fineRecipe(rebuildProp(data.source, true));
    if (recipe) {
      const steps = recipe();
      let step = steps.next();
      while (!step.done) step = steps.next();
      cells = packFine(step.value);
    }
  } catch {
    cells = null;
  }
  self.postMessage({ id: data.id, cells }, cells ? fineBuffers(cells) : []);
};
