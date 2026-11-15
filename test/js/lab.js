// js/lab.js
// The "lab": the two ways of watching a convolution (autoplay or step by step),
// the result frame and the optional detail card. The game (game.js) opens it with Lab.open(tool, pattern).
// It needs convolution.js and data.js to be loaded first (see the <script> order in index.html).

"use strict";

(() => {
  // ---------- 1. SETTINGS AND TEXTS ----------
  const TILE = 40;          // size of a tile on the canvas while the real picture is still loading
  const RUN_TIME = 7500;    // total duration of one autoplay run, in milliseconds
  const MAX_SIDE = 1024;    // the picture is worked on at no more than this many pixels along its longest side
  const BRUSH = 1.5;        // how far the tool reaches, in tiles from its centre (so it covers about 3 x 3 tiles)
  // The size of one "cell" of each tool's 3 x 3 kernel, in pixels of the picture (measured on a 736 px wide picture).
  // The kernel is the same 3 x 3 grid of weights as in convolution.js; here each cell is as big as a few stones of the mosaic.
  const SCALE = { sponge: 10, knife: 3, chalk: 5 };
  const KNIFE_AMOUNT = 1.6, CHALK_GAIN = 2.0, CHALK_THRESHOLD = 24;
  const SLATE = [24, 27, 52], CHALK = [244, 228, 200];

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
    touched: false,      // by hand: the tool has touched the painting
    showOriginal: false, // true while "Hold to see the original" is pressed
    runTimer: null,
    startTimer: null
  };

  // What the 3D game reads: where the tool should be, and whether the picture has been changed yet
  const cursor = { x: 0, y: 0, active: false };   // active: the lab (autoplay or step) is moving the tool
  const info = { dirty: false, version: 0 };      // dirty: some tiles are changed, so the painting must show the live canvas

  // ---------- 3. DRAWING: the real picture, the real convolution, and a soft brush ----------
  // The tool is applied to the real pixels of the mosaic (section 4), so the picture is never turned into blocks.
  // Where the tool passes, a soft round brush fades the convolved picture in over the original.
  const make = () => { const c = document.createElement("canvas"); return [c, c.getContext("2d")]; };
  const [maskC, mctx] = make();      // where the tool has passed (the alpha channel), on the main canvas
  const [mask2C, m2ctx] = make();    // the same for the result canvas in step mode
  const [layerC, lctx] = make();     // scratch: the convolved picture cut out by a mask
  const [resC, rctx] = make();       // the whole picture convolved by the current tool
  let ready = false;                 // true once the picture is loaded and convolved

  function setSize(w, h) {
    [canvas, canvasOut, maskC, mask2C, layerC, resC].forEach((c) => { c.width = w; c.height = h; });
  }
  const fullRect = () => ({ x: 0, y: 0, w: canvas.width, h: canvas.height });
  const tileW = () => canvas.width / state.image.cols, tileH = () => canvas.height / state.image.rows;

  function updateDirty() {
    info.dirty = ready && ((state.mode === "auto" && state.revealed > 0) || (state.mode === "free" && state.touched));
    info.version++;
  }

  function drawBase(c, r) {
    if (state.photo) c.drawImage(state.photo, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    else { c.fillStyle = "#14162b"; c.fillRect(r.x, r.y, r.w, r.h); }
  }

  // Cut the convolved picture out with a mask and put it on the target (over the original picture, if withBase)
  function composite(mask, target, r, withBase) {
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(r.x, r.y, r.w, r.h);
    lctx.drawImage(resC, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(mask, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    lctx.globalCompositeOperation = "source-over";
    target.clearRect(r.x, r.y, r.w, r.h);
    if (withBase) drawBase(target, r);
    target.drawImage(layerC, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    info.version++;
  }

  // Main canvas: the original picture, with the tool's result where the tool has passed
  function refreshMain(r) {
    if (state.showOriginal || state.mode === "step" || !ready) { ctx.clearRect(r.x, r.y, r.w, r.h); drawBase(ctx, r); info.version++; }
    else composite(maskC, ctx, r, true);
  }
  const refreshOut = (r) => { if (ready) composite(mask2C, ctxOut, r, false); };   // step mode: only the part that has been done

  function drawAll() {
    refreshMain(fullRect());
    updateDirty();
  }

  // Put one soft, round dab of the brush on a mask at pixel (x, y). Returns the part of the canvas that changed.
  function stamp(m, x, y) {
    const r = BRUSH * tileW();
    const g = m.createRadialGradient(x, y, r * 0.45, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
    m.fillStyle = g; m.fillRect(x - r, y - r, 2 * r, 2 * r);
    const x0 = Math.max(0, Math.floor(x - r) - 1), y0 = Math.max(0, Math.floor(y - r) - 1);
    const x1 = Math.min(canvas.width, Math.ceil(x + r) + 1), y1 = Math.min(canvas.height, Math.ceil(y + r) + 1);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }
  const clearMasks = () => { mctx.clearRect(0, 0, maskC.width, maskC.height); m2ctx.clearRect(0, 0, mask2C.width, mask2C.height); };

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

  // ---------- 4. THE REAL CONVOLUTION ON THE REAL PICTURE ----------
  // Each tool is its 3 x 3 kernel from convolution.js, but every cell of the kernel is a small patch of the mosaic
  // (an average over `s` pixels) and the cells are `s` pixels apart. So the sponge really blurs the stones,
  // the knife really sharpens their edges, and the chalk really finds the lines between them.
  function boxMean(src, W, H, s) {          // average over an s x s square around every pixel (edges use what is there)
    const lo = -(s >> 1), hi = lo + s - 1, tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    const P = new Float64Array(Math.max(W, H) + 1);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) P[x + 1] = P[x] + src[row + x];
      for (let x = 0; x < W; x++) { const a = Math.max(0, x + lo), b = Math.min(W - 1, x + hi); tmp[row + x] = (P[b + 1] - P[a]) / (b - a + 1); }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) P[y + 1] = P[y] + tmp[y * W + x];
      for (let y = 0; y < H; y++) { const a = Math.max(0, y + lo), b = Math.min(H - 1, y + hi); out[y * W + x] = (P[b + 1] - P[a]) / (b - a + 1); }
    }
    return out;
  }

  function buildResult() {
    ready = false;
    const photo = state.photo, W = photo.width, H = photo.height;
    const [tc, tctx] = make(); tc.width = W; tc.height = H; tctx.drawImage(photo, 0, 0);
    const data = tctx.getImageData(0, 0, W, H).data, N = W * H;
    const src = [0, 1, 2].map((c) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = data[i * 4 + c]; return a; });
    const s = Math.max(1, Math.round(SCALE[state.tool] * W / 736));
    const A = src.map((a) => boxMean(a, W, H, s));
    const w = Convolution.KERNELS[state.tool].weights;
    const clampX = (x) => (x < 0 ? 0 : x >= W ? W - 1 : x), clampY = (y) => (y < 0 ? 0 : y >= H ? H - 1 : y);
    const K = [0, 1, 2].map((c) => {                                  // the 3 x 3 kernel applied to the patches
      const acc = new Float32Array(N);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const wt = w[(j + 1) * 3 + (i + 1)]; if (wt === 0) continue;
        for (let y = 0; y < H; y++) { const yy = clampY(y + j * s) * W; for (let x = 0; x < W; x++) acc[y * W + x] += wt * A[c][yy + clampX(x + i * s)]; }
      }
      return acc;
    });
    const out = rctx.createImageData(W, H), o = out.data;
    for (let i = 0; i < N; i++) {
      if (state.tool === "sponge") for (let c = 0; c < 3; c++) o[i * 4 + c] = K[c][i];
      else if (state.tool === "knife") for (let c = 0; c < 3; c++) o[i * 4 + c] = src[c][i] + KNIFE_AMOUNT * (K[c][i] - A[c][i]);   // the picture plus the kernel's extra contrast
      else {
        const lum = Math.abs(0.299 * K[0][i] + 0.587 * K[1][i] + 0.114 * K[2][i]);
        const v = Math.max(0, Math.min(1, ((lum - CHALK_THRESHOLD) / 255) * CHALK_GAIN));   // line strength: dark slate, chalk line where colours meet
        for (let c = 0; c < 3; c++) o[i * 4 + c] = SLATE[c] * (1 - v) + CHALK[c] * v;
      }
      o[i * 4 + 3] = 255;
    }
    resC.width = W; resC.height = H;
    rctx.putImageData(out, 0, 0);
    ready = true;
  }

  // ---------- 5. SHARED HELPERS ----------
  // [r, g, b] with values from 0 to 1  ->  "rgb(255, 0, 0)" (used by the detail card)
  function css(color) {
    return "rgb(" + color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",") + ")";
  }

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
    state.touched = false;
    cursor.active = false;
    if (!state.photo) setSize(state.image.cols * TILE, state.image.rows * TILE);   // until the real picture is loaded
    clearMasks();
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
    mctx.fillStyle = "#fff"; mctx.fillRect(0, 0, maskC.width, maskC.height); drawAll();   // make sure every last pixel is done
    $("fin").textContent = TEXT[state.tool].done + " This is called convolution. Your phone camera does it all the time.";
    state.inspect = null; // the card will explain the middle tile
    setMoreLabel(false);
    $("more").hidden = false;
  }

  // Slide the tool over the painting, row by row: wherever it passes, the picture is changed by the real convolution
  function play() {
    stopAnimation();
    resetMessages();
    state.showOriginal = false;
    state.revealed = 0;
    state.touched = false;
    clearMasks();
    frame.hidden = true;                  // no glowing frame: the tool itself slides over the painting
    drawAll();
    if (!ready) { state.startTimer = setTimeout(play, 150); return; }   // wait for the picture to be ready

    const total = state.image.pixels.length;
    const cols = state.image.cols;
    let i = 0;
    state.runTimer = setInterval(() => {
      const x = i % cols, y = Math.floor(i / cols);
      cursor.x = x; cursor.y = y; cursor.active = true;
      i++;
      state.revealed = i;
      refreshMain(stamp(mctx, (x + 0.5) * tileW(), (y + 0.5) * tileH()));
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
    clearMasks();
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
    refreshOut(stamp(m2ctx, (x + 0.5) * tileW(), (y + 0.5) * tileH()));   // the result appears, softly, on the right

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
    state.touched = false;
    state.showOriginal = false;
    state.revealed = 0;
    cursor.active = false;
    frame.hidden = true;
    mark.hidden = true;
    clearMasks();
    drawAll();
    $("fin").textContent = FREE_HINT;
  }

  // The tool touches the painting at (u, v), both from 0 to 1 across the picture (v from the top): the real convolution
  // appears under it, with a soft edge. A stroke does all its dabs first and redraws the changed area once.
  const union = (a, b) => { if (!a) return b; const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  function afterPainting(x, y) {
    const first = !state.touched;
    state.touched = true;
    const { cols, rows } = state.image;
    state.inspect = { x: Math.max(0, Math.min(cols - 1, Math.floor(x / tileW()))), y: Math.max(0, Math.min(rows - 1, Math.floor(y / tileH()))) };
    if (first) {
      setMoreLabel(false); $("more").hidden = false;
      $("fin").textContent = "Wherever the tool touches, the picture is recalculated from the pixels around it.";
    }
    if (!$("real").hidden) fillDetail();
    updateDirty();
  }
  const canPaint = () => state.mode === "free" && ready && !state.showOriginal;
  function touchUV(u, v) {
    if (!canPaint()) return;
    const x = u * canvas.width, y = v * canvas.height;
    refreshMain(stamp(mctx, x, y));
    afterPainting(x, y);
  }
  // a smooth stroke from one point to the next, so fast movements leave no gaps
  function stroke(u0, v0, u1, v1) {
    if (!canPaint()) return;
    const dx = (u1 - u0) * canvas.width, dy = (v1 - v0) * canvas.height;
    const n = Math.min(80, Math.max(1, Math.ceil(Math.hypot(dx, dy) / (BRUSH * tileW() * 0.3))));
    let rect = null, x = 0, y = 0;
    for (let k = 1; k <= n; k++) {
      x = (u0 + ((u1 - u0) * k) / n) * canvas.width; y = (v0 + ((v1 - v0) * k) / n) * canvas.height;
      rect = union(rect, stamp(mctx, x, y));
    }
    refreshMain(rect);
    afterPainting(x, y);
  }
  const touch = (x, y) => touchUV((x + 0.5) / state.image.cols, (y + 0.5) / state.image.rows);   // by tile, kept for older code

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
    else { state.revealed = 0; state.touched = false; clearMasks(); drawAll(); play(); }
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
    ready = false;
    if (photoUrl) {                       // the real picture, convolved by the tool, as soon as it is loaded
      const img = new Image();
      img.onload = () => {
        if (state.pattern !== pattern || state.tool !== tool) return;
        const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));   // work at a size every computer handles smoothly
        const [wc, wctx] = make(); wc.width = Math.round(img.naturalWidth * k); wc.height = Math.round(img.naturalHeight * k);
        wctx.drawImage(img, 0, 0, wc.width, wc.height);
        state.photo = wc;
        setSize(wc.width, wc.height);
        clearMasks();
        buildResult();
        if (state.mode === "step") resetStep(); else drawAll();
      };
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
  window.Lab = { open, close, canvas, frame, cursor, info, touch, touchUV, stroke,
    get mode() { return state.mode; },
    get grid() { return { cols: state.image.cols, rows: state.image.rows }; } };
})();