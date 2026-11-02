// Connects the page to the engine: tool choice, scrolling, the sliding animation and the buttons.

"use strict";

(() => {
//settings and texts
  const TILE = 20;          // size of one tile on the canvas, in pixels (CSS scales the canvas)
  const RUN_TIME = 7500;    // total duration of one run, in milliseconds
  const START_DELAY = 900;  // pause after the page scrolls, before the run starts

  const TEXT = {
    sponge: {
      what: "A wet sponge mixes the paint under it. Watch it melt 9 tiles into one soft colour.",
      done: "Same canvas, now soft and blended.",
      why: "Why it blurs: all 9 weights are equal, so each new tile is simply the average of the 9 tiles under the frame. Averaging smooths out sharp differences. This is a blur kernel."
    },
    knife: {
      what: "A palette knife lifts the paint around it. Each tile keeps itself and pulls away from its neighbours, so colours pop.",
      done: "Same canvas, now with stronger contrast.",
      why: "Why colours pop: the middle weight is big (5) and the four neighbours are negative (−1). A tile lighter than its neighbours gets lighter, and a darker tile gets darker, so differences are exaggerated. This is a sharpening kernel."
    },
    chalk: {
      what: "A chalk line marks a border. Flat colour stays dark, and a light line appears only where two colours meet.",
      done: "Same canvas, now showing only its borders.",
      why: "Why only borders show: the middle weight is 8 and the 8 neighbours are −1, so the weights add up to 0. On flat colour the result is 0, which stays dark. Where colours change, the sum is no longer 0 and the tile lights up. This is an edge-detection kernel."
    }
  };

// shortcuts and state
  const $ = (id) => document.getElementById(id);
  const canvas = $("cv");
  const ctx = canvas.getContext("2d");
  const wrap = $("wrap");
  const frame = $("win");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    tool: null,          // "sponge", "knife" or "chalk"
    pattern: "mosaic",   // "mosaic" or "rug"
    image: null,         // the current pattern: { cols, rows, pixels }
    result: [],          // new colour of every tile, computed by the engine
    revealed: 0,         // how many tiles have already been changed on screen
    showOriginal: false, // true while the "Hold to see the original" button is pressed
    runTimer: null,      // the sliding animation
    startTimer: null     // the short pause before the animation starts
  };

//drawing functionss
  function css(color) {
    return "rgb(" + color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",") + ")";
  }

  // Draw one tile: its new colour if it has been revealed, otherwise its original colour
  function drawTile(i) {
    const { cols, pixels } = state.image;
    const useResult = i < state.revealed && !state.showOriginal;
    ctx.fillStyle = css(useResult ? state.result[i] : pixels[i]);
    ctx.fillRect((i % cols) * TILE, Math.floor(i / cols) * TILE, TILE, TILE);
  }

  function drawAll() {
    for (let i = 0; i < state.image.pixels.length; i++) drawTile(i);
  }

  // Scale the canvas so it fits the screen while keeping the pattern's proportions
  function fitCanvas() {
    if (!state.image) return;
    const { cols, rows } = state.image;
    const maxHeight = Math.min(window.innerHeight * 0.48, 460);
    const maxWidth = Math.min(window.innerWidth * 0.86, 540);
    const size = Math.min(maxWidth / cols, maxHeight / rows);
    wrap.style.width = cols * size + "px";
    wrap.style.height = rows * size + "px";
  }

  // Place the glowing 3x3 frame around the tile (x, y). % keeps it correct at any size.
  function moveFrame(x, y) {
    const { cols, rows } = state.image;
    frame.hidden = false;
    frame.style.left = ((x - 1) / cols) * 100 + "%";
    frame.style.top = ((y - 1) / rows) * 100 + "%";
    frame.style.width = (3 / cols) * 100 + "%";
    frame.style.height = (3 / rows) * 100 + "%";
  }

//animation and messages
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
  }

  // Prepare a pattern on the canvas (without starting the animation)
  function loadPattern(key) {
    state.pattern = key;
    state.image = Patterns[key];
    state.revealed = 0;
    state.showOriginal = false;
    canvas.width = state.image.cols * TILE;
    canvas.height = state.image.rows * TILE;
    frame.hidden = true;
    fitCanvas();
    drawAll();
    document.querySelectorAll("[data-c]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.c === key));
    });
  }

  // "1/9" for fractions, "−1" for negative numbers (typographic minus sign)
  function weightLabel(w) {
    if (!Number.isInteger(w)) return "1/" + Math.round(1 / w);
    return w < 0 ? "−" + Math.abs(w) : String(w);
  }

  // Fill the optional "In real convolution terms" card for the current tool
  function fillRealCard() {
    const weights = Convolution.KERNELS[state.tool].weights;
    $("kg").innerHTML = weights
      .map((w) => '<span class="' + (w === 0 ? "z" : w < 0 ? "n" : "p") + '">' + weightLabel(w) + "</span>")
      .join("");
    $("rwhy").textContent = TEXT[state.tool].why;
  }

  function finishRun() {
    stopAnimation();
    frame.hidden = true;
    $("fin").textContent = TEXT[state.tool].done + " This is called convolution.";
    fillRealCard();
    $("more").setAttribute("aria-expanded", "false");
    $("more").textContent = "Want more detail? ▾";
    $("more").hidden = false;
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
      moveFrame(i % cols, Math.floor(i / cols));
      i++;
      state.revealed = i;
      drawTile(i - 1);
      if (i >= total) finishRun();
    }, Math.max(8, RUN_TIME / total));
  }

//scrolling and tool choice
  function scrollToSection(id) {
    $(id).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  function chooseTool(key) {
    state.tool = key;
    $("noTool").hidden = true;
    $("withTool").hidden = false;
    $("tName").textContent = Convolution.KERNELS[key].name;
    $("tWhat").textContent = TEXT[key].what;
    stopAnimation();
    resetMessages();
    loadPattern(state.pattern);
    scrollToSection("stage");
    state.startTimer = setTimeout(play, reduceMotion ? 100 : START_DELAY);
  }

//buttons and events
  document.querySelectorAll(".opt").forEach((button) => {
    button.addEventListener("click", () => chooseTool(button.dataset.t));
  });

  document.querySelectorAll("[data-c]").forEach((button) => {
    button.addEventListener("click", () => {
      stopAnimation();
      resetMessages();
      loadPattern(button.dataset.c);
      play();
    });
  });

  $("replay").addEventListener("click", play);

  const goToOptions = () => { stopAnimation(); scrollToSection("options"); };
  $("another").addEventListener("click", goToOptions);
  $("toOpts").addEventListener("click", goToOptions);

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

  // Show or hide the optional detail card
  $("more").addEventListener("click", () => {
    const opening = $("real").hidden;
    $("real").hidden = !opening;
    $("more").setAttribute("aria-expanded", String(opening));
    $("more").textContent = opening ? "Hide detail ▴" : "Want more detail? ▾";
    if (opening && !reduceMotion) $("real").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  window.addEventListener("resize", fitCanvas);
})();