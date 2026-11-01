const P = require("../js/data.js");
const C = require("../js/convolution.js");

for (const key of ["mosaic", "rug"]) {
  const img = P[key];
  console.log(img.name, img.cols + "x" + img.rows, "tiles:", img.pixels.length);
  for (const tool of ["sponge", "knife", "chalk"]) {
    console.log("  ", tool, "->", C.applyAll(img, tool).length, "new tiles");
  }
}