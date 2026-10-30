import { fineBuffers, packFine } from './fine-bakes.js';
import { fineRecipe } from './prop-art.js';
import { bakeWhole, finishRecipe, rebuildProp } from './props.js';

// Bakes props in small letters for the fine grid, off the main thread (see
// fine-bakes.js). Each message names a prop by the source it was made from;
// the reply carries its packed cells, or none if it could not be rebuilt.
// A `whole` message makes a tree again in full (a season's re-bake), and the
// reply carries its ordinary cells and measures too.
self.onmessage = ({ data }) => {
  let cells = null;
  let whole = null;
  try {
    if (data.whole) {
      ({ fine: cells, ...whole } = bakeWhole(data.source));
    } else {
      const recipe = fineRecipe(rebuildProp(data.source, true));
      if (recipe) cells = packFine(finishRecipe(recipe));
    }
  } catch {
    cells = whole = null;
  }
  const buffers = cells ? fineBuffers(cells) : [];
  if (whole) buffers.push(whole.cells.buffer);
  self.postMessage({ id: data.id, cells, whole }, buffers);
};
