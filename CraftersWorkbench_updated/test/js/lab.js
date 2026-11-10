// js/lab.js
// The "lab": the two ways of watching a convolution (autoplay or step by step),
// the result frame and the optional detail card. The game (game.js) opens it with Lab.open(tool, pattern).
// It needs convolution.js and data.js to be loaded first (see the <script> order in index.html).

"use strict";

(() => {
  // ---------- 1. SETTINGS AND TEXTS ----------
  const TILE = 20;          // size of one tile on the canvas, in pixels (CSS scales the canvas)
  const RUN_TIME = 7500;    // total duration of one autoplay run, in milliseconds

  const TEXT = {
    sponge: {
      what: "A wet sponge mixes the paint under it. Watch it melt 9 tiles into one soft colour.",
      done: "Same canvas, now soft and blended.",
      why: "Why it blurs: every tile counts the same, so each new tile is simply the average of the tiles under the frame. Averaging smooths out sharp differences. This is a blur kernel."
    },
    knife: {
      what: "A palette knife lifts the paint around it. Each tile keeps itself and pulls away from its neighbours, so colours pop.",
      done: "Same canvas, now with stronger contrast.",
      why: "Why colours pop: the middle tile counts strongly and the tiles next to it count against it. A tile lighter than its neighbours gets lighter, and a darker tile gets darker, so differences are exaggerated. This is a sharpening kernel."
    },
    chalk: {
      what: "A chalk line marks a border. Flat colour stays dark, and a light line appears only where two colours meet.",
      done: "Same canvas, now showing only its borders.",
      why: "Why only borders show: the middle tile counts strongly and its neighbours count against it by exactly the same amount. On flat colour they cancel out and the tile stays dark. Where colours change, they no longer cancel and the tile lights up. This is an edge-detection kernel."
    }
  };
  const STEP_HINT = "Each press moves the frame to the next tile and adds one new tile on the right.";

  // ---------- 2. SHORTCUTS AND STATE ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("cv"), ctx = canvas.getContext("2d");           // original canvas
  const canvasOut = $("cvOut"), ctxOut = canvasOut.getContext("2d"); // result canvas (step mode)
  const wrap = $("wrap"), wrapOut = $("wrapOut");
  const frame = $("win"), mark = $("mark");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    tool: null,          // "sponge", "knife" or "chalk"
    pattern: "garden",   // a key of Patterns (see data.js)
    mode: "idle",        // "idle" (waiting), "auto" (plays by itself) or "step" (one tile per press)
    image: null,         // the current pattern: { cols, rows, pixels }
    result: [],          // autoplay: new colour of every tile, computed by the engine
    revealed: 0,         // autoplay: how many tiles have already been changed on screen
    stepIndex: 0,        // step mode: how many tiles have been done
    inspect: null,       // the tile shown in the detail card: { x, y }
    showOriginal: false, // true while "Hold to see the original" is pressed
    runTimer: null,
    startTimer: null
  };

  // ---------- 3. DRAWING ----------
  // [r, g, b] with values from 0 to 1  ->  "rgb(255, 0, 0)"
  function css(color) {
    return "rgb(" + color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",") + ")";
  }

  // Original canvas. In autoplay the tiles change in place; in step mode it always stays original.
  function drawTile(i) {
    const { cols, pixels } = state.image;
    const useResult = state.mode === "auto" && i < state.revealed && !state.showOriginal;
    ctx.fillStyle = css(useResult ? state.result[i] : pixels[i]);
    ctx.fillRect((i % cols) * TILE, Math.floor(i / cols) * TILE, TILE, TILE);
  }

  function drawAll() {
    for (let i = 0; i < state.image.pixels.length; i++) drawTile(i);
  }

  // Scale the canvas (or the two canvases) to fit the lab panel, keeping the pattern's proportions
  function fitCanvas() {
    if (!state.image) return;
    const { cols, rows } = state.image;
    const boards = state.mode === "step" ? 2 : 1;
    const panelWidth = ($("lab").clientWidth || 420) - 56;
    const maxHeight = Math.min(window.innerHeight * 0.34, 340);
    const maxWidth = panelWidth / boards - (boards === 2 ? 10 : 0);
    const size = Math.min(maxWidth / cols, maxHeight / rows);
    [wrap, wrapOut].forEach((w) => {
      w.style.width = cols * size + "px";
      w.style.height = rows * size + "px";
    });
  }

  // Place a box of (w x h) tiles around the tile (x, y). Percentages keep it correct at any size.
  function placeBox(el, x, y, w, h) {
    const { cols, rows } = state.image;
    el.hidden = false;
    el.style.left = (x / cols) * 100 + "%";
    el.style.top = (y / rows) * 100 + "%";
    el.style.width = (w / cols) * 100 + "%";
    el.style.height = (h / rows) * 100 + "%";
  }
  const moveFrame = (x, y) => placeBox(frame, x - 1, y - 1, 3, 3); // the glowing 3x3 frame
  const moveMark = (x, y) => placeBox(mark, x, y, 1, 1);           // the newest tile on the result

  // ---------- 4. SHARED HELPERS ----------
  function stopAnimation() {
    clearInterval(state.runTimer);
    clearTimeout(state.startTimer);
    state.runTimer = null;
    state.startTimer = null;
  }

  function resetMessages() {
    $("fin").textContent = "";
    $("more").hidden = true;
    $("real").hidden = true;
    state.inspect = null;
  }

  function setMoreLabel(open) {
    $("more").setAttribute("aria-expanded", String(open));
    $("more").textContent = open ? "Hide detail ▴" : "Want more detail? ▾";
  }

  // Prepare a pattern on the canvas (without starting anything)
  function loadPattern(key) {
    state.pattern = key;
    state.image = Patterns[key];
    state.revealed = 0;
    state.stepIndex = 0;
    state.showOriginal = false;
    [canvas, canvasOut].forEach((c) => {
      c.width = state.image.cols * TILE;
      c.height = state.image.rows * TILE;
    });
    frame.hidden = true;
    mark.hidden = true;
    fitCanvas();
    drawAll();
  }

  // ---------- 5. THE DETAIL CARD (colours only, no numbers) ----------
  // Colour of the tile at (x, y); outside the image we reuse the nearest edge tile, like the engine
  function pixelAt(x, y) {
    const { cols, rows, pixels } = state.image;
    return pixels[Math.max(0, Math.min(rows - 1, y)) * cols + Math.max(0, Math.min(cols - 1, x))];
  }

  // Weight -> colour: warm orange adds, slate takes away, a stronger colour counts more
  function weightColor(w, maxAbs) {
    if (w === 0) return "rgba(128,128,128,.18)";
    const strength = 0.25 + 0.75 * (Math.abs(w) / maxAbs);
    return w > 0 ? "rgba(179,102,51," + strength + ")" : "rgba(84,116,161," + strength + ")";
  }

  function fillDetail() {
    const img = state.image;
    // which tile to explain: the current step, or the middle of the canvas
    const p = state.inspect || { x: Math.floor(img.cols / 2), y: Math.floor(img.rows / 2) };
    const weights = Convolution.KERNELS[state.tool].weights;
    const maxAbs = Math.max(...weights.map(Math.abs));

    let tiles = "", grid = "";
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const k = (j + 1) * 3 + (i + 1);
        const ring = k === 4 ? ' class="c"' : "";   // the middle tile is the one that changes
        tiles += "<span" + ring + ' style="background:' + css(pixelAt(p.x + i, p.y + j)) + '"></span>';
        grid += "<span" + ring + ' style="background:' + weightColor(weights[k], maxAbs) + '"></span>';
      }
    }
    $("gTiles").innerHTML = tiles;
    $("gWeights").innerHTML = grid;
    $("gResult").style.background = css(Convolution.applyAt(img, state.tool, p.x, p.y));
    $("rwhy").textContent = TEXT[state.tool].why;
  }

  // ---------- 6. AUTOPLAY ----------
  function finishRun() {
    stopAnimation();
    frame.hidden = true;
    $("fin").textContent = TEXT[state.tool].done + " This is called convolution. Your phone camera does it all the time.";
    state.inspect = null; // the card will explain the middle tile
    setMoreLabel(false);
    $("more").hidden = false;
  }

  // Slide the frame over every tile, row by row, changing each tile in place
  function play() {
    stopAnimation();
    resetMessages();
    state.showOriginal = false;
    state.revealed = 0;
    state.result = Convolution.applyAll(state.image, state.tool); // all results computed first
    drawAll();

    const total = state.image.pixels.length;
    const cols = state.image.cols;
    let i = 0;
    state.runTimer = setInterval(() => {
      moveFrame(i % cols, Math.floor(i / cols));
      i++;
      state.revealed = i;
      drawTile(i - 1);
      if (i >= total) finishRun();
    }, Math.max(8, RUN_TIME / total));
  }

  // ---------- 7. STEP BY STEP ----------
  function resetStep() {
    stopAnimation();
    resetMessages();
    state.stepIndex = 0;
    frame.hidden = true;
    mark.hidden = true;
    ctxOut.clearRect(0, 0, canvasOut.width, canvasOut.height);
    drawAll();
    $("next").disabled = false;
    $("fin").textContent = "Press “Next step”. " + STEP_HINT;
  }

  // Move the frame to the next tile and write one new tile on the result frame
  function stepNext() {
    const total = state.image.pixels.length;
    if (state.stepIndex >= total) return;
    const i = state.stepIndex;
    const x = i % state.image.cols, y = Math.floor(i / state.image.cols);

    moveFrame(x, y);
    moveMark(x, y);
    ctxOut.fillStyle = css(Convolution.applyAt(state.image, state.tool, x, y));
    ctxOut.fillRect(x * TILE, y * TILE, TILE, TILE);

    state.stepIndex = i + 1;
    state.inspect = { x, y };
    $("fin").textContent = STEP_HINT;
    if ($("more").hidden) { setMoreLabel(false); $("more").hidden = false; }
    if (!$("real").hidden) fillDetail(); // keep the open card in sync with the frame

    if (state.stepIndex >= total) {
      frame.hidden = true;
      $("next").disabled = true;
      $("fin").textContent = TEXT[state.tool].done + " This is called convolution. Your phone camera does it all the time.";
    }
  }

  // ---------- 8. MODES, SCROLLING AND TOOL CHOICE ----------
  // Waiting state: the original canvas, nothing playing, no mode chosen yet
  function showIdle() {
    stopAnimation();
    resetMessages();
    state.mode = "idle";
    document.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    $("outBoard").hidden = true;
    $("stepControls").hidden = true;
    $("lblIn").hidden = true;
    $("orig").hidden = true;
    frame.hidden = true;
    mark.hidden = true;
    state.revealed = 0;
    fitCanvas();
    drawAll();
    $("fin").textContent = "Press Autoplay to watch it by itself, or Step by step to go one tile at a time.";
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("[data-m]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.m === mode));
    });
    const step = mode === "step";
    $("outBoard").hidden = !step;
    $("stepControls").hidden = !step;
    $("lblIn").hidden = !step;
    $("orig").hidden = step; // in step mode the left canvas is always the original
    stopAnimation();
    resetMessages();
    frame.hidden = true;
    mark.hidden = true;
    fitCanvas();
    if (step) resetStep();
    else { state.revealed = 0; drawAll(); play(); }
  }

  // ---------- 9. BUTTONS ----------
  document.querySelectorAll("[data-m]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.m));
  });

  $("next").addEventListener("click", stepNext);
  $("replay").addEventListener("click", () => (state.mode === "step" ? resetStep() : setMode("auto")));

  // Hold to see the original (autoplay only): show the untouched pattern while pressed
  const original = $("orig");
  function holdOriginal(on) {
    if (!state.image) return;
    state.showOriginal = on;
    drawAll();
  }
  original.addEventListener("pointerdown", () => holdOriginal(true));
  ["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
    original.addEventListener(type, () => holdOriginal(false));
  });

  // Show or hide the optional detail card
  $("more").addEventListener("click", () => {
    const opening = $("real").hidden;
    if (opening) fillDetail();
    $("real").hidden = !opening;
    setMoreLabel(opening);
    if (opening && !reduceMotion) $("real").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  window.addEventListener("resize", fitCanvas);

  // ---------- 10. WHAT THE GAME USES ----------
  // Open the lab with a tool on a pattern. Nothing plays until the learner presses a mode button.
  function open(tool, pattern) {
    state.tool = tool;
    $("tName").textContent = Convolution.KERNELS[tool].name;
    $("tWhat").textContent = TEXT[tool].what;
    stopAnimation();
    resetMessages();
    loadPattern(pattern);
    showIdle();
  }
  function close() { stopAnimation(); resetMessages(); }

  // canvas = the live picture, frame = the glowing 3x3 frame (the game mirrors both in 3D)
  window.Lab = { open, close, canvas, frame };
})();
