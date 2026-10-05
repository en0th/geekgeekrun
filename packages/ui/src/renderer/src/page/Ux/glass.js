/* Liquid-glass refraction for the macOS navigation panel.
   The panel's backdrop runs through an SVG filter: blur → refraction (feDisplacementMap) → colour
   mixing (saturation / lift). The displacement map below models the panel as a slab with a convex
   rounded bezel: flat in the middle (no bending), and increasingly steep towards the rim, where the
   backdrop is pulled inwards along the edge normal — the lensing seen at the edge of real glass. */

/** Displacement map for a w×h rounded rect, encoded as R = x shift, G = y shift (128 = none). */
export function refractionMap(w, h, { radius, bezel, maxShift }) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hx = w / 2 - radius,
    hy = h / 2 - radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // signed distance to the rounded rect edge and the outward normal there
      const px = x + 0.5 - w / 2,
        py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - hx,
        qy = Math.abs(py) - hy;
      let inside, nx, ny;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        inside = radius - len;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        inside = radius - qx;
        nx = Math.sign(px);
        ny = 0;
      } else {
        inside = radius - qy;
        nx = 0;
        ny = Math.sign(py);
      }
      // bezel slope: steepest at the rim, flat once past the bezel
      const t = Math.min(Math.max(inside / bezel, 0), 1);
      const shift = Math.pow(1 - t, 2.4);
      const i = (y * w + x) * 4;
      data[i] = 128 - nx * shift * 127;
      data[i + 1] = 128 - ny * shift * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), scale: maxShift * 2 };
}
