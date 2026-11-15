// js/lab.js
// The "lab": the two ways of watching a convolution (autoplay or step by step),
// the result frame and the optional detail card. The game (game.js) opens it with Lab.open(tool, pattern).
// It needs convolution.js and data.js to be loaded first (see the <script> order in index.html).

"use strict";

(() => {
  // ---------- 1. SETTINGS AND TEXTS ----------
  const TILE = 40;          // size of one tile on the canvas, in pixels (CSS scales the canvas). Big enough to keep the real picture sharp
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
  const STEP_HINT = "Each press moves the tool to the next tile and adds one new tile on the right.";
  const FREE_HINT = "Press and drag over the painting with your cursor to use the tool yourself, or press Autoplay to watch it work.";

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
    mode: "free",        // "free" (the learner moves the tool), "auto" (plays by itself) or "step" (one tile per press)
    image: null,         // the current pattern: { cols, rows, pixels }
    result: [],          // autoplay: new colour of every tile, computed by the engine
    revealed: 0,         // autoplay: how many tiles have already been changed on screen
    stepIndex: 0,        // step mode: how many tiles have been done
    inspect: null,       // the tile shown in the detail card: { x, y }
    photo: null,         // the real picture (loaded image), shown until the tool changes a tile
    painted: [],         // by hand: new colour of every tile the tool has touched
    paintedCount: 0,
    showOriginal: false, // true while "Hold to see the original" is pressed
    runTimer: null,
    startTimer: null
  };

  // What the 3D game reads: where the tool should be, and whether the picture has been changed yet
  const cursor = { x: 0, y: 0, active: false };   // active: the lab (autoplay or step) is moving the tool
  const info = { dirty: false, version: 0 };      // dirty: some tiles are changed, so the painting must show the live canvas

  // ---------- 3. DRAWING ----------
  // [r, g, b] with values from 0 to 1  ->  "rgb(255, 0, 0)"
  function css(color) {
    return "rgb(" + color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",") + ")";
  }

  function updateDirty() {
    info.dirty = (state.mode === "auto" && state.revealed > 0) || (state.mode === "free" && state.paintedCount > 0);
    info.version++;
  }

  // The new colour of tile i, or null when the tile is still the untouched picture
  function changedColor(i) {
    if (state.showOriginal) return null;
    if (state.mode === "auto" && i < state.revealed) return state.result[i];
    if (state.mode === "free" && state.painted[i]) return state.painted[i];
    return null;                         // step mode: the left canvas always stays original
  }

  // Original canvas. Untouched tiles show the real picture; touched tiles show the tool's result.
  function drawTile(i) {
    const { cols, pixels } = state.image;
    const x = (i % cols) * TILE, y = Math.floor(i / cols) * TILE, col = changedColor(i);
    if (col) { ctx.fillStyle = css(col); ctx.fillRect(x, y, TILE, TILE); }
    else if (state.photo) {
      const sw = state.photo.naturalWidth / cols, sh = state.photo.naturalHeight / state.image.rows;
      ctx.drawImage(state.photo, (i % cols) * sw, Math.floor(i / cols) * sh, sw, sh, x, y, TILE, TILE);
    } else { ctx.fillStyle = css(pixels[i]); ctx.fillRect(x, y, TILE, TILE); }
    info.version++;
  }

  function drawAll() {
    if (state.photo) ctx.drawImage(state.photo, 0, 0, canvas.width, canvas.height);   // the whole picture, smooth
    for (let i = 0; i < state.image.pixels.length; i++) {
      if (state.photo && !changedColor(i)) continue;
      drawTile(i);
    }
    updateDirty();
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
  const moveFrame = (x, y) => { cursor.x = x; cursor.y = y; cursor.active = true; placeBox(frame, x - 1, y - 1, 3, 3); }; // step mode: outline of the 9 tiles
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
    state.painted = []; state.paintedCount = 0;
    cursor.active = false;
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
    cursor.active = false;                // the tool lifts off the painting
    $("fin").textContent = TEXT[state.tool].done + " This is called convolution. Your phone camera does it all the time.";
    state.inspect = null; // the card will explain the middle tile
    setMoreLabel(false);
    $("more").hidden = false;
  }

  // Slide the tool over every tile, row by row, changing each tile in place
  function play() {
    stopAnimation();
    resetMessages();
    state.showOriginal = false;
    state.revealed = 0;
    state.painted = []; state.paintedCount = 0;
    frame.hidden = true;                  // no glowing frame: the tool itself slides over the painting
    state.result = Convolution.applyAll(state.image, state.tool); // all results computed first
    drawAll();

    const total = state.image.pixels.length;
    const cols = state.image.cols;
    let i = 0;
    state.runTimer = setInterval(() => {
      cursor.x = i % cols; cursor.y = Math.floor(i / cols); cursor.active = true;
      i++;
      state.revealed = i;
      drawTile(i - 1);
      info.dirty = true;
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
    cursor.active = false;
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
      cursor.active = false;
      $("next").disabled = true;
      $("fin").textContent = TEXT[state.tool].done + " This is called convolution. Your phone camera does it all the time.";
    }
  }

  // ---------- 8. MODES, SCROLLING AND TOOL CHOICE ----------
  // By hand: the picture is untouched; the learner moves the tool over it
  function resetFree() {
    stopAnimation();
    resetMessages();
    state.painted = []; state.paintedCount = 0;
    state.showOriginal = false;
    state.revealed = 0;
    cursor.active = false;
    frame.hidden = true;
    mark.hidden = true;
    drawAll();
    $("fin").textContent = FREE_HINT;
  }

  // Called by the game each time the tool touches the painting at tile (x, y): the 9 tiles under it change
  function touch(x, y) {
    if (state.mode !== "free" || !state.image || state.showOriginal) return;
    const { cols, rows } = state.image;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
        const i = ty * cols + tx;
        if (state.painted[i]) continue;
        state.painted[i] = Convolution.applyAt(state.image, state.tool, tx, ty);   // always computed from the original tiles
        state.paintedCount++;
        drawTile(i);
      }
    }
    state.inspect = { x: Math.max(0, Math.min(cols - 1, x)), y: Math.max(0, Math.min(rows - 1, y)) };
    if ($("more").hidden) { setMoreLabel(false); $("more").hidden = false; }
    if (!$("real").hidden) fillDetail();
    $("fin").textContent = state.paintedCount >= cols * rows
      ? TEXT[state.tool].done + " This is called convolution. Your phone camera does it all the time."
      : "Every tile you touch is mixed from the 9 tiles under the tool.";
    updateDirty();
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
    cursor.active = false;
    fitCanvas();
    if (step) resetStep();
    else if (mode === "free") resetFree();
    else { state.revealed = 0; state.painted = []; state.paintedCount = 0; drawAll(); play(); }
  }

  // ---------- 9. BUTTONS ----------
  document.querySelectorAll("[data-m]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.m));
  });

  $("next").addEventListener("click", stepNext);
  $("replay").addEventListener("click", () => (state.mode === "step" ? resetStep() : state.mode === "free" ? resetFree() : setMode("auto")));

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
  function open(tool, pattern, photoUrl) {
    state.tool = tool;
    state.photo = null;
    if (photoUrl) {                       // the real picture replaces the flat tiles as soon as it is loaded
      const img = new Image();
      img.onload = () => { if (state.pattern === pattern) { state.photo = img; drawAll(); } };
      img.src = photoUrl;
    }
    $("tName").textContent = Convolution.KERNELS[tool].name;
    $("tWhat").textContent = TEXT[tool].what;
    stopAnimation();
    resetMessages();
    loadPattern(pattern);
    setMode("free");
  }
  function close() { stopAnimation(); resetMessages(); }

  // canvas = the live picture; cursor = where the tool should be; info = has the picture changed;
  // touch = the tool touched the painting (by hand). The game mirrors all of this in 3D.
  window.Lab = { open, close, canvas, frame, cursor, info, touch,
    get mode() { return state.mode; },
    get grid() { return { cols: state.image.cols, rows: state.image.rows }; } };
})();