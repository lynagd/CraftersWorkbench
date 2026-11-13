// Connects the page to the engine: tool choice, tile by tile, explanation, full simulation and the buttons.

"use strict";

(() => {
//settings and texts
  const TILE = 20;          // size of one tile on the canvas, in pixels (CSS scales the canvas)
  const RUN_TIME = 7500;    // total duration of the full simulation, in milliseconds
  const START_DELAY = 900;  // pause after the page scrolls, before the simulation starts

  const TEXT = {
    sponge: {
      what: "A wet sponge mixes the paint under it. Watch it melt 9 tiles into one soft colour.",
      done: "Same canvas, now soft and blended."
    },
    knife: {
      what: "A palette knife lifts the paint around it. Each tile keeps itself and pulls away from its neighbours, so colours pop.",
      done: "Same canvas, now with stronger contrast."
    },
    chalk: {
      what: "A chalk line marks a border. Flat colour stays dark, and a light line appears only where two colours meet.",
      done: "Same canvas, now showing only its borders."
    }
  };

  // Page 4: one plain sentence per tool, told with cups instead of numbers
  const DETAIL = {
    sponge: "Every tile gives the same amount (all the cups are equally full). So the middle tile becomes a mix of all 9 tiles, and the colours melt together.",
    knife: "The middle tile counts a lot (a full cup). The 4 tiles right beside it are taken away (the striped cups). So the middle tile moves away from its neighbours: lighter gets lighter, darker gets darker.",
    chalk: "The middle tile counts a lot (a full cup) and each of its 8 neighbours takes a little of it away (the striped cups). If all 9 tiles look alike, everything cancels out and the tile stays dark. If the middle one is different, a light mark is left."
  };

  const EDGE_NOTE = "This tile is on the border, so the missing tiles copy the nearest one.";

// shortcuts and state
  const $ = (id) => document.getElementById(id);
  const all = (selector) => document.querySelectorAll(selector);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // page 5 (full simulation)
  const cv = $("cv"), ctx = cv.getContext("2d"), wrap = $("wrap"), frame = $("win");
  // page 3 (tile by tile): A = original, B = result
  const cvA = $("cvA"), ctxA = cvA.getContext("2d"), wrapA = $("wrapA"), winA = $("winA");
  const cvB = $("cvB"), ctxB = cvB.getContext("2d"), wrapB = $("wrapB"), winB = $("winB");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    tool: null,          // "sponge", "knife" or "chalk"
    pattern: "mosaic",   // "mosaic" or "rug"
    image: null,         // the current pattern: { cols, rows, pixels }

    // page 3: tile by tile
    lResult: [],         // new colour of every tile
    order: [],           // the order tiles are shown in (a visible one first, then row by row)
    step: 0,             // how many tiles have been shown so far
    cur: null,           // the last tile shown: { x, y }
    holdOn: false,       // true while Next tile / Space is held down
    holdTimer: null,

    // page 4: explanation
    dTile: null,         // the tile being explained
    dTiles: [],          // the 9 colours under the frame
    dPoured: [],         // for each of the 9 cups: has it been poured yet?
    dBusy: false,        // true while a cup is pouring
    dDrag: null,         // the cup being dragged: { k, cup, ghost, ... }

    // page 5: full simulation
    result: [],
    revealed: 0,         // how many tiles have already been changed on screen
    showOriginal: false, // true while "Hold to see the original" is pressed
    runTimer: null,
    startTimer: null
  };

//drawing helpers
  function css(color) {
    return "rgb(" + color.map((v) => Math.round(clamp(v, 0, 1) * 255)).join(",") + ")";
  }

  // Paint tile i of an image with a colour on the given canvas context
  function paint(c, i, color) {
    const { cols } = state.image;
    c.fillStyle = css(color);
    c.fillRect((i % cols) * TILE, Math.floor(i / cols) * TILE, TILE, TILE);
  }

  // Page 5: its new colour if the tile has been revealed, otherwise its original colour
  function drawTile(i) {
    const useResult = i < state.revealed && !state.showOriginal;
    paint(ctx, i, useResult ? state.result[i] : state.image.pixels[i]);
  }

  function drawAll() {
    for (let i = 0; i < state.image.pixels.length; i++) drawTile(i);
  }

  // Scale a canvas box so it fits while keeping the pattern's proportions
  function fit(box, maxWidth, maxHeight) {
    const { cols, rows } = state.image;
    const size = Math.min(maxWidth / cols, maxHeight / rows);
    box.style.width = cols * size + "px";
    box.style.height = rows * size + "px";
  }

  function fitAll() {
    if (!state.image) return;
    const half = (Math.min(window.innerWidth * 0.9, 1100) - 90) / 2;
    const smallHeight = Math.min(window.innerHeight * 0.36, 380);
    fit(wrapA, half, smallHeight);
    fit(wrapB, half, smallHeight);
    fit(wrap, Math.min(window.innerWidth * 0.86, 540), Math.min(window.innerHeight * 0.48, 460));
  }

  // Place a glowing frame (size x size tiles) around the tile (x, y). % keeps it correct at any size.
  function moveFrame(el, x, y, size) {
    const { cols, rows } = state.image;
    const off = (size - 1) / 2;
    el.hidden = false;
    el.style.left = ((x - off) / cols) * 100 + "%";
    el.style.top = ((y - off) / rows) * 100 + "%";
    el.style.width = (size / cols) * 100 + "%";
    el.style.height = (size / rows) * 100 + "%";
  }

  function isBorder(t) {
    const { cols, rows } = state.image;
    return t.x === 0 || t.y === 0 || t.x === cols - 1 || t.y === rows - 1;
  }

//page 3: tile by tile
  // Tiles are shown in a simple order: row by row, starting at the top-left corner.
  function buildOrder() {
    return state.image.pixels.map((_, i) => i);
  }

  // A tile where something clearly happens (not flat, not on the border).
  // Page 4 uses it when the user has not stepped through any tile yet.
  function pickDemo() {
    const { cols, rows, pixels } = state.image;
    const res = state.lResult;
    const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
    const cand = [];
    let max = 0;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        const s = state.tool === "chalk"
          ? lum(res[i])
          : Math.abs(res[i][0] - pixels[i][0]) + Math.abs(res[i][1] - pixels[i][1]) + Math.abs(res[i][2] - pixels[i][2]);
        cand.push({ i, x, y, s });
        if (s > max) max = s;
      }
    }
    const good = cand.filter((c) => c.s >= max * 0.5);
    const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    good.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
    return good[0].i;
  }

  function updateLearnText() {
    const total = state.order.length;
    const done = state.step >= total;
    $("count").textContent = state.step === 0
      ? "Press “Next tile” or the Space bar to start. Hold it to go faster."
      : done
        ? "All " + total + " tiles are done. Press Play to see it at full speed."
        : "Tile " + state.step + " of " + total;
    $("next").disabled = done;
    $("edge").textContent = state.cur && isBorder(state.cur) ? EDGE_NOTE : "";
  }

  // Put page 3 back to its start: original on the left, empty canvas on the right
  function prepareLearn() {
    stopHold();
    const { pixels } = state.image;
    state.lResult = Convolution.applyAll(state.image, state.tool);
    state.order = buildOrder();
    state.step = 0;
    state.cur = null;
    for (let i = 0; i < pixels.length; i++) paint(ctxA, i, pixels[i]);
    ctxB.clearRect(0, 0, cvB.width, cvB.height);
    winA.hidden = true;
    winB.hidden = true;
    updateLearnText();
  }

  // Show one more tile: the frame moves, and the new middle tile appears on the right
  function stepLearn() {
    if (!state.image || state.step >= state.order.length) { stopHold(); return false; }
    const { cols } = state.image;
    const i = state.order[state.step++];
    const x = i % cols, y = Math.floor(i / cols);
    state.cur = { x, y };
    moveFrame(winA, x, y, 3);
    moveFrame(winB, x, y, 1);
    paint(ctxB, i, state.lResult[i]);
    updateLearnText();
    return true;
  }

  // Holding the button (or Space) repeats the step, a little faster each time
  function startHold() {
    if (state.holdOn) return;
    state.holdOn = true;
    stepLearn();
    let delay = 320;
    const tick = () => {
      if (!state.holdOn) return;
      if (!stepLearn()) return;
      delay = Math.max(25, delay * 0.85);
      state.holdTimer = setTimeout(tick, delay);
    };
    state.holdTimer = setTimeout(tick, 450);
  }

  function stopHold() {
    state.holdOn = false;
    clearTimeout(state.holdTimer);
    state.holdTimer = null;
  }

  // Space only works while page 3 is the one on screen
  function learnInView() {
    return !!state.tool && !$("learn").hidden;
  }

//page 4: why it works
  // The 9 colours around tile (x, y), row by row (outside the canvas, copy the nearest tile)
  function neighbourhood(x, y) {
    const { cols, rows, pixels } = state.image;
    const out = [];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = clamp(x + i, 0, cols - 1);
        const cy = clamp(y + j, 0, rows - 1);
        out.push(pixels[cy * cols + cx].slice());
      }
    }
    return out;
  }

  // Explain the tile the user just looked at (or a tile where something visible happens)
  function fillDetail() {
    const { cols } = state.image;
    const demo = pickDemo();
    const tile = state.cur || { x: demo % cols, y: Math.floor(demo / cols) };
    state.dTile = tile;
    state.dTiles = neighbourhood(tile.x, tile.y);
    resetPour();
  }

  const detailWeights = () => Convolution.KERNELS[state.tool].weights;
  const usedCount = () => detailWeights().filter((w) => w !== 0).length;
  const pouredCount = () => detailWeights().filter((w, k) => w !== 0 && state.dPoured[k]).length;

  // Empty the tile and refill every cup
  function resetPour() {
    state.dBusy = false;
    state.dDrag = null;
    state.dPoured = detailWeights().map(() => false);
    all(".flying, .stream").forEach((e) => e.remove());
    renderDetail();
  }

  function renderDetail() {
    // 1. the 9 tiles (just to look at)
    $("dTiles").innerHTML = state.dTiles.map((c, k) =>
      '<div class="t' + (k === 4 ? " mid" : "") + '" style="background:' + css(c) + '"></div>'
    ).join("");

    // 2. one cup per tile: coloured like its tile, filled by how much that tile counts
    const weights = detailWeights();
    const biggest = Math.max(...weights.map(Math.abs));
    $("dCups").innerHTML = weights.map((w, k) => {
      const kind = w === 0 ? "none" : w > 0 ? "add" : "take";
      const level = Math.round((Math.abs(w) / biggest) * 100);
      const fill = w === 0 ? "" : '<i style="height:' + level + "%;background:" + css(state.dTiles[k]) + '"></i>';
      const label = w === 0 ? "Tile " + (k + 1) + ", not used by this tool"
                            : "Tile " + (k + 1) + ", drag it onto the empty tile";
      return '<button type="button" class="cup ' + kind + '" data-k="' + k + '"' + (w === 0 ? " disabled" : "") +
        ' aria-label="' + label + '">' + fill + "</button>";
    }).join("");

    $("dWhy").textContent = DETAIL[state.tool];
    $("dEdge").textContent = isBorder(state.dTile) ? EDGE_NOTE : "";
    updatePour();
  }

  // 3. the tile on the right: colour made by the cups poured so far
  function updatePour() {
    const colour = Convolution.applyPartial(state.dTiles, state.tool, state.dPoured);
    const out = $("dOut");
    out.classList.toggle("empty", !colour);
    out.style.background = colour ? css(colour) : "";
    const n = pouredCount(), total = usedCount();
    $("dCount").textContent = n + " of " + total + " poured";
    $("dDone").textContent = n === total
      ? "All poured! This is exactly the colour this tile got on the tile by tile page. Press Start again and pour in another order: you will get the same colour."
      : "";
    $("dRestart").disabled = n === 0 || state.dBusy;
  }

  function anim(el, frames, ms) {
    if (reduceMotion) return Promise.resolve();
    return el.animate(frames, { duration: ms, easing: "ease-in-out", fill: "forwards" }).finished.catch(() => {});
  }

  // A copy of the cup that follows the mouse
  function makeGhost(cup) {
    const r = cup.getBoundingClientRect();
    const ghost = cup.cloneNode(true);
    ghost.removeAttribute("data-k");
    ghost.removeAttribute("aria-label");
    ghost.disabled = false;
    ghost.tabIndex = -1;
    ghost.classList.add("flying");
    ghost.style.left = r.left + "px";
    ghost.style.top = r.top + "px";
    document.body.appendChild(ghost);
    cup.classList.add("lifted");
    return { ghost, r };
  }

  // The cup goes over the tile, tips and pours (or dips in and scoops paint out), then the tile changes
  async function pour(d) {
    state.dBusy = true;
    $("dRestart").disabled = true;
    const { k, cup, ghost } = d;
    const take = detailWeights()[k] < 0;
    const out = $("dOut");
    out.classList.remove("aim");
    const t = out.getBoundingClientRect();
    const g = ghost.getBoundingClientRect();
    const h = g.width / 2;
    const cx = t.left + t.width / 2;
    const tr = (x, y, rot) => "translate(" + x + "px," + y + "px) rotate(" + (rot || 0) + "deg)";
    const markDone = () => {
      state.dPoured[k] = true;
      cup.classList.remove("lifted");
      cup.classList.add("done");
      cup.disabled = true;
      updatePour();
    };
    try {
      if (!take) {
        const dx = cx - 1.98 * h - g.left, dy = t.top - 25 - 1.17 * h - g.top;
        await anim(ghost, [{ transform: "none" }, { transform: tr(dx, dy) }], 280);
        await anim(ghost, [{ transform: tr(dx, dy, 0) }, { transform: tr(dx, dy, 100) }], 300);
        const stream = document.createElement("div");
        stream.className = "stream";
        stream.style.background = css(state.dTiles[k]);
        stream.style.left = cx - 3 + "px";
        stream.style.top = t.top - 24 + "px";
        stream.style.height = t.height * 0.45 + 24 + "px";
        document.body.appendChild(stream);
        anim(stream, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], 180);
        markDone();
        await anim(ghost.querySelector("i"), [{ height: ghost.querySelector("i").style.height }, { height: "0%" }], 650);
        await Promise.all([
          anim(stream, [{ opacity: 1 }, { opacity: 0 }], 160),
          anim(ghost, [{ transform: tr(dx, dy, 100), opacity: 1 }, { transform: tr(dx, dy, 100), opacity: 0 }], 200)
        ]);
        stream.remove();
      } else {
        const dx = cx - h - g.left, dy = t.top - 2 * h - 20 - g.top;
        const dip = dy + h * 1.3 + 20;
        await anim(ghost, [{ transform: "none" }, { transform: tr(dx, dy) }], 280);
        await anim(ghost, [{ transform: tr(dx, dy) }, { transform: tr(dx, dip) }], 220);
        markDone(); // the paint is scooped out of the tile
        await anim(ghost, [{ transform: tr(dx, dip), opacity: 1 }, { transform: tr(dx, dy - 40), opacity: 0 }], 480);
      }
    } finally {
      ghost.remove();
      state.dBusy = false;
      if (!state.dPoured[k]) { state.dPoured[k] = true; cup.classList.add("done"); cup.disabled = true; }
      updatePour();
    }
  }

//page 5: full simulation
  function stopAnimation() {
    clearInterval(state.runTimer);
    clearTimeout(state.startTimer);
    state.runTimer = null;
    state.startTimer = null;
  }

  function resetMessages() {
    $("fin").textContent = "";
  }

  function finishRun() {
    stopAnimation();
    frame.hidden = true;
    $("fin").textContent = TEXT[state.tool].done + " This is called convolution.";
  }

  // Slide the frame over every tile, row by row, changing each tile as it goes
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
      moveFrame(frame, i % cols, Math.floor(i / cols), 3);
      i++;
      state.revealed = i;
      drawTile(i - 1);
      if (i >= total) finishRun();
    }, Math.max(8, RUN_TIME / total));
  }

//scrolling, tool choice and pattern choice
  // Only one page is visible at a time. Pages change only through buttons, never by scrolling.
  const PAGES = ["hello", "options", "learn", "detail", "stage"];

  function goTo(id) {
    PAGES.forEach((p) => { $(p).hidden = p !== id; });
    window.scrollTo(0, 0);
  }

  // Prepare a pattern on every page (without starting any animation)
  function setPattern(key) {
    state.pattern = key;
    state.image = Patterns[key];
    state.revealed = 0;
    state.showOriginal = false;
    const { cols, rows } = state.image;
    [cv, cvA, cvB].forEach((c) => { c.width = cols * TILE; c.height = rows * TILE; });
    frame.hidden = true;
    fitAll();
    drawAll();
    all("[data-c]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === key)));
    if (state.tool) { prepareLearn(); fillDetail(); }
  }

  function chooseTool(key) {
    state.tool = key;
    all(".with-tool").forEach((e) => { e.hidden = false; });
    all("[data-tname]").forEach((e) => { e.textContent = Convolution.KERNELS[key].name; });
    all("[data-twhat]").forEach((e) => { e.textContent = TEXT[key].what; });
    stopAnimation();
    resetMessages();
    setPattern(state.pattern);
    goTo("learn");
  }

  // Go to the full simulation and start it after a short pause
  function goPlay() {
    stopHold();
    stopAnimation();
    resetMessages();
    frame.hidden = true;
    state.revealed = 0;
    state.showOriginal = false;
    drawAll();
    goTo("stage");
    state.startTimer = setTimeout(play, reduceMotion ? 100 : START_DELAY);
  }

  function goDetail() {
    stopHold();
    fillDetail();
    goTo("detail");
  }

  function goOptions() {
    stopHold();
    stopAnimation();
    goTo("options");
  }

//buttons and events
  all(".opt").forEach((button) => {
    button.addEventListener("click", () => chooseTool(button.dataset.t));
  });

  // Mosaic / rug buttons exist on page 3 and page 5 and always stay in sync
  all("[data-c]").forEach((button) => {
    button.addEventListener("click", () => {
      const onStage = !!button.closest("#stage");
      stopAnimation();
      stopHold();
      resetMessages();
      setPattern(button.dataset.c);
      if (onStage) play();
    });
  });

  $("start").addEventListener("click", () => goTo("options"));
  $("backHello").addEventListener("click", () => goTo("hello"));
  all(".toOpts").forEach((button) => button.addEventListener("click", goOptions));
  $("another").addEventListener("click", goOptions);
  $("backLearn").addEventListener("click", () => { stopAnimation(); goTo("learn"); });

  // Page 3: Next tile (hold to speed up) and Space
  const next = $("next");
  next.addEventListener("pointerdown", () => startHold());
  ["pointerup", "pointerleave", "pointercancel"].forEach((type) => next.addEventListener(type, stopHold));
  next.addEventListener("click", (e) => { if (e.detail === 0) stepLearn(); }); // Enter key

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !learnInView()) return;
    e.preventDefault();
    if (!e.repeat) startHold();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    stopHold();
    if (learnInView()) e.preventDefault();
  });

  $("restart").addEventListener("click", prepareLearn);
  $("play").addEventListener("click", goPlay);
  $("more").addEventListener("click", goDetail);

  // Page 4: drag a cup onto the empty tile (a simple click or Enter pours it too)
  const overTile = (e) => {
    const r = $("dOut").getBoundingClientRect(), m = 40;
    return e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m;
  };

  $("dCups").addEventListener("pointerdown", (e) => {
    const cup = e.target.closest(".cup");
    if (!cup || cup.disabled || state.dBusy || state.dDrag || e.button > 0) return;
    e.preventDefault();
    const { ghost, r } = makeGhost(cup);
    state.dDrag = { k: Number(cup.dataset.k), cup, ghost, ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
  });

  document.addEventListener("pointermove", (e) => {
    const d = state.dDrag;
    if (!d) return;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.moved = true;
    if (!d.moved) return;
    d.ghost.style.left = e.clientX - d.ox + "px";
    d.ghost.style.top = e.clientY - d.oy + "px";
    $("dOut").classList.toggle("aim", overTile(e));
  });

  function endDrag(e, cancelled) {
    const d = state.dDrag;
    if (!d) return;
    state.dDrag = null;
    $("dOut").classList.remove("aim");
    if (!cancelled && (!d.moved || overTile(e))) pour(d);
    else { d.ghost.remove(); d.cup.classList.remove("lifted"); }
  }
  document.addEventListener("pointerup", (e) => endDrag(e, false));
  document.addEventListener("pointercancel", (e) => endDrag(e, true));

  $("dCups").addEventListener("click", (e) => { // keyboard (Enter / Space on a focused cup)
    if (e.detail !== 0) return;
    const cup = e.target.closest(".cup");
    if (!cup || cup.disabled || state.dBusy) return;
    pour({ k: Number(cup.dataset.k), cup, ghost: makeGhost(cup).ghost });
  });

  $("dRestart").addEventListener("click", () => { if (!state.dBusy) resetPour(); });

  // Page 4: back and play
  $("dBack").addEventListener("click", () => goTo("learn"));
  $("dPlay").addEventListener("click", goPlay);

  $("replay").addEventListener("click", play);

  // Hold to see the original: show the untouched pattern while the button is pressed
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

  window.addEventListener("resize", fitAll);
})();