const C = require("../js/convolution.js");

// Flat grey image: the sponge should keep it, the chalk should stay dark
const flat = { cols: 3, rows: 3, pixels: Array(9).fill([0.5, 0.5, 0.5]) };
console.log("sponge on flat:", C.applyAt(flat, "sponge", 1, 1)); // about [0.5, 0.5, 0.5]
console.log("chalk on flat:", C.applyAt(flat, "chalk", 1, 1));   // dark (the INK colour)

// Black left, white right: the chalk should light up at the border
const px = [];
for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) px.push(x < 2 ? [0, 0, 0] : [1, 1, 1]);
const edge = { cols: 4, rows: 3, pixels: px };
console.log("chalk at the border:", C.applyAt(edge, "chalk", 1, 1)); // cream
console.log("sponge at the border:", C.applyAt(edge, "sponge", 1, 1)); // about 0.33