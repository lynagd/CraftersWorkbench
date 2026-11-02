// The engine: applies a 3x3 kernel to an image.

const Convolution = (() => {
  // Edge Chalk colours (values 0 to 1): flat areas stay INK, borders turn CREAM
  const INK = [0x1f / 255, 0x09 / 255, 0x0b / 255];
  const CREAM = [0xf5 / 255, 0xd4 / 255, 0xa8 / 255];

  // The three kernels: 9 weights, read row by row
  const KERNELS = {
    sponge: { name: "Water Sponge",  weights: Array(9).fill(1 / 9) },
    knife:  { name: "Palette Knife", weights: [0, -1, 0, -1, 5, -1, 0, -1, 0] },
    chalk:  { name: "Edge Chalk",    weights: [-1, -1, -1, -1, 8, -1, -1, -1, -1] }
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const brightness = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

  // Colour of the tile at (x, y). Outside the image, reuse the nearest edge tile.
  function pixelAt(image, x, y) {
    const cx = clamp(x, 0, image.cols - 1);
    const cy = clamp(y, 0, image.rows - 1);
    return image.pixels[cy * image.cols + cx];
  }

  // New colour of the tile at (x, y) after one tool passes over it
  function applyAt(image, toolKey, x, y) {
    const w = KERNELS[toolKey].weights;

    if (toolKey === "chalk") {
      let sum = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          sum += brightness(pixelAt(image, x + i, y + j)) * w[(j + 1) * 3 + (i + 1)];
        }
      }
      const strength = Math.min(1, Math.abs(sum) * 0.9);
      return INK.map((v, c) => v + (CREAM[c] - v) * strength);
    }

    const out = [0, 0, 0];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const p = pixelAt(image, x + i, y + j);
        const weight = w[(j + 1) * 3 + (i + 1)];
        for (let c = 0; c < 3; c++) out[c] += p[c] * weight;
      }
    }
    return out.map((v) => clamp(v, 0, 1));
  }

  // New colour of every tile, row by row
  function applyAll(image, toolKey) {
    const result = [];
    for (let y = 0; y < image.rows; y++) {
      for (let x = 0; x < image.cols; x++) result.push(applyAt(image, toolKey, x, y));
    }
    return result;
  }

  return { KERNELS, applyAt, applyAll };
})();

if (typeof module !== "undefined") module.exports = Convolution; // lets Node load it for tests