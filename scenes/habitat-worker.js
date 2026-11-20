// Worker for the habitat map (habitat-map.js): decodes the habitat raster, finds the habitat index of
// every pixel (6.5 M pixels) and makes the faded images of highlight(scene), off the main thread.
//   in:  { type: 'load', url, colours: ['#rrggbb', ...] }  -> out: { type: 'image', bitmap }, then { type: 'index', idx }
//   in:  { type: 'fade', scene, on: [bool per habitat] }   -> out: { type: 'faded', scene, bitmap }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
let src = null, idx = null, W = 0, H = 0;

onmessage = async ({ data: m }) => {
  if (m.type === 'load') {
    const bmp = await createImageBitmap(await (await fetch(m.url)).blob());
    W = bmp.width; H = bmp.height;
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    src = g.getImageData(0, 0, W, H).data;
    postMessage({ type: 'image', bitmap: bmp }, [bmp]);
    // habitat index of every pixel (255: none), colours matched once per distinct colour
    const P = src, rgb = m.colours.map(hex), cache = new Map();
    idx = new Uint8Array(W * H);
    for (let i = 0, o = 0; i < idx.length; i++, o += 4) {
      const key = (P[o] << 16) | (P[o + 1] << 8) | P[o + 2];
      let v = cache.get(key);
      if (v === undefined) {
        v = rgb.findIndex((c) => Math.abs(c[0] - P[o]) + Math.abs(c[1] - P[o + 1]) + Math.abs(c[2] - P[o + 2]) < 6);
        if (v < 0) v = 255; cache.set(key, v);
      }
      idx[i] = v;
    }
    postMessage({ type: 'index', idx: idx.slice() });
  } else if (m.type === 'fade') {
    // every habitat but those of the scene blended 68 % towards the page background
    const on = m.on, out = new ImageData(W, H), D = out.data, bg = [246, 244, 238], k = 0.68;
    for (let i = 0, o = 0; i < idx.length; i++, o += 4) {
      const v = idx[i];
      if (v !== 255 && on[v]) { D[o] = src[o]; D[o + 1] = src[o + 1]; D[o + 2] = src[o + 2]; }
      else { D[o] = src[o] + (bg[0] - src[o]) * k; D[o + 1] = src[o + 1] + (bg[1] - src[o + 1]) * k; D[o + 2] = src[o + 2] + (bg[2] - src[o + 2]) * k; }
      D[o + 3] = 255;
    }
    const bitmap = await createImageBitmap(out);
    postMessage({ type: 'faded', scene: m.scene, bitmap }, [bitmap]);
  }
};
