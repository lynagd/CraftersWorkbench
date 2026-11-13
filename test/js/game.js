// js/game.js
// The 3D workshop. The learner is the painter: first-person view, drag to look around.
// Flow: title -> pick a painting (it moves to the easel) -> pick a tool (it goes into the hand)
//       -> the lab opens (lab.js) and the convolution plays on the painting itself.
// Needs: Patterns (data.js) and Lab (lab.js), which are loaded before this module.

import * as THREE from "three";
const { RoundedBoxGeometry, RoomEnvironment } = THREE;   // both are bundled inside vendor/three.module.min.js

const $ = (id) => document.getElementById(id);
const TILE = 20;                                   // pixels per tile in the painting textures
const INK = 0x1f2240, BRN = 0x5b1f11, ORG = 0xb36633, SLATE = 0x5474a1, CREAM = 0xf4e4c8;

// ---------- 1. RENDERER, SCENE, CAMERA ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $("scene"), antialias: true });
} catch (error) {
  $("noGL").hidden = false;            // no WebGL: point to the simple version
  throw error;
}
const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || window.innerWidth < 760;
const maxPixelRatio = Math.min(window.devicePixelRatio, mobile ? 1.5 : 2);
let pixelRatio = maxPixelRatio;
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;     // blurred shadow edges (see sun.shadow.radius)
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // film-like highlights and colours
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(INK);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 60);
scene.add(camera);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- 2. HELPERS: materials, procedural textures, shapes ----------
const SRGB = THREE.SRGBColorSpace;
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, y) {                                   // smooth value noise
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;

// A texture computed pixel by pixel: fn(x, y) -> [r, g, b] (0..255)
function pixelTexture(w, h, fn, repeat, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), id = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, gg, b] = fn(x, y), i = (y * w + x) * 4;
    id.data[i] = r; id.data[i + 1] = gg; id.data[i + 2] = b; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = SRGB;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function canvasTexture(w, h, draw, repeat) {            // a texture drawn with the 2D canvas API
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const retile = (t, rx, ry) => { const c = t.clone(); c.repeat.set(rx, ry); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c; };

function woodMaps(base, planks = 6) {                    // wood grain: colour + bump
  const S = 512, pw = S / planks;
  const shade = (x, y) => {
    const p = Math.floor(x / pw), lx = x - p * pw;
    const grain = 0.5 + 0.5 * Math.sin(lx * 0.32 + fbm(lx * 0.025 + p * 5.1, y * 0.004 + p) * 10);
    return (0.74 + 0.26 * grain + (hash(p, 3) - 0.5) * 0.14) * (lx < 2 || lx > pw - 2 ? 0.55 : 1);
  };
  return {
    map: pixelTexture(S, S, (x, y) => { const s = shade(x, y); return [base[0] * s, base[1] * s, base[2] * s]; }),
    bump: pixelTexture(S, S, (x, y) => { const s = shade(x, y) * 255; return [s, s, s]; }, null, false),
  };
}
function plasterMaps(base) {                             // mottled plaster: colour + bump
  const S = 256;
  return {
    map: pixelTexture(S, S, (x, y) => { const s = 0.92 + 0.12 * fbm(x * 0.04, y * 0.04) + 0.02 * hash(x, y); return [base[0] * s, base[1] * s, base[2] * s]; }),
    bump: pixelTexture(S, S, (x, y) => { const s = fbm(x * 0.09, y * 0.09) * 255; return [s, s, s]; }, null, false),
  };
}
const weave = pixelTexture(64, 64, (x, y) => { const v = ((x >> 1) + (y >> 1)) % 2 ? 190 : 110, n = hash(x, y) * 30; return [v + n, v + n, v + n]; }, [1, 1], false);   // canvas / fabric weave

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, envMapIntensity: 0.6, ...o });

function box(w, h, d, material, x, y, z, parent = scene, radius) {   // boxes have softly rounded edges
  const r = Math.min(radius ?? 0.015, Math.min(w, h, d) * 0.45);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const cyl = (r1, r2, h, material, x, y, z, parent = scene, seg = 28) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
};
const sph = (r, material, x, y, z, parent = scene) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), material);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
};
function lathe(profile, material, x, y, z, parent = scene) {          // a smooth round object from a side profile [radius, height]
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 40), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}

// ---------- 3. THE STUDIO: a tall, bright artist's workshop ----------
const EH = 3.3, RH = 6.4, Z_BACK = -5, Z_FRONT = 4.5, Z_MID = (Z_BACK + Z_FRONT) / 2;
scene.background = new THREE.Color(0xd5dbe8);
const pmrem = new THREE.PMREMGenerator(renderer);                  // soft, realistic ambient light and reflections
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const paleMaps = woodMaps([228, 198, 152], 10), beamMaps = woodMaps([50, 54, 89], 2), floorMaps = woodMaps([214, 168, 116], 6);
const furnMaps = woodMaps([150, 100, 58], 4);
const paleWood = std(0xffffff, { map: paleMaps.map, bumpMap: paleMaps.bump, bumpScale: 1.5, roughness: 0.7 });
const beam = std(0xffffff, { map: beamMaps.map, bumpMap: beamMaps.bump, bumpScale: 1.2, roughness: 0.6 });
const wood = std(0xffffff, { map: furnMaps.map, bumpMap: furnMaps.bump, bumpScale: 1.5, roughness: 0.55 });
const dark = std(BRN, { roughness: 0.7 });
const pl = plasterMaps([244, 228, 200]);
const plasterShape = std(0xffffff, { map: retile(pl.map, 0.3, 0.3), bumpMap: retile(pl.bump, 0.3, 0.3), bumpScale: 0.6, roughness: 1, side: THREE.DoubleSide });
const plasterPlane = std(0xffffff, { map: retile(pl.map, 3, 1), bumpMap: retile(pl.bump, 3, 1), bumpScale: 0.6, roughness: 1, side: THREE.DoubleSide });

// floor: real wooden boards, and the real Persian rug
// colour + bump canvases computed pixel by pixel: fn(x, y) -> { c: [r,g,b], h: 0..1 }
function pixelMaps(w, h, fn, repeat) {
  const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); return [c, g, g.createImageData(w, h)]; };
  const [cc, cg, cd] = mk(), [bc, bg, bd] = mk();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = fn(x, y), i = (y * w + x) * 4, k = Math.round(o.h * 255);
    cd.data[i] = o.c[0]; cd.data[i + 1] = o.c[1]; cd.data[i + 2] = o.c[2]; cd.data[i + 3] = 255;
    bd.data[i] = bd.data[i + 1] = bd.data[i + 2] = k; bd.data[i + 3] = 255;
  }
  cg.putImageData(cd, 0, 0); bg.putImageData(bd, 0, 0);
  const wrap = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = SRGB; t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
  };
  return { map: wrap(cc, true), bump: wrap(bc, false) };
}

// Real wooden boards: 8 boards across, two staggered board lengths per tile, each with its own tone,
// grain, a few knots, dark gaps between boards and soft bevelled edges.
const boardMaps = pixelMaps(512, 1024, (x, y) => {
  const PW = 64, SEG = 512;
  const p = Math.floor(x / PW), lx = x - p * PW;
  const yy = (y + Math.floor(hash(p, 7) * SEG)) % 1024, seg = Math.floor(yy / SEG), ly = yy - seg * SEG;
  const b = p * 2 + seg + 1;                                        // board id
  const tone = hash(b, 1), warm = hash(b, 2);
  const base = [198 + 36 * tone + 8 * warm, 142 + 34 * tone, 92 + 26 * tone - 6 * warm];
  const n = fbm(lx * 0.09 + b * 7.3, ly * 0.012 + b * 3.1);
  let rings = 0.5 + 0.5 * Math.sin(lx * 0.34 + n * 14 + hash(b, 5) * 6.28);
  const pores = vnoise(lx * 0.9 + b * 13, ly * 0.05);
  let shade = 0.80 + 0.12 * rings + 0.14 * (pores - 0.5) + 0.12 * (n - 0.5);
  if (hash(b, 9) > 0.72) {                                          // a knot on some boards
    const kx = 14 + hash(b, 10) * 36, ky = 60 + hash(b, 11) * 390, r = Math.hypot(lx - kx, (ly - ky) * 0.45);
    if (r < 11) { shade *= 0.62 + 0.38 * smooth(r / 11) + 0.08 * Math.sin(r * 1.7); rings = 0.3; }
  }
  const d = Math.min(lx, PW - 1 - lx), e = Math.min(ly, SEG - 1 - ly);
  const gap = Math.min(smooth(Math.min(1, d / 2.2)), smooth(Math.min(1, e / 2.2)));   // 0 in the crack, 1 on the board
  shade *= 0.35 + 0.65 * gap;
  const hgt = 0.12 + 0.88 * gap;
  return { c: [base[0] * shade, base[1] * shade, base[2] * shade], h: Math.max(0, Math.min(1, hgt * (0.9 + 0.1 * rings))) };
}, [8, 3]);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 9.5),
  std(0xffffff, { map: boardMaps.map, bumpMap: boardMaps.bump, bumpScale: 1.6, roughness: 0.55 }));
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, Z_MID); floor.receiveShadow = true; scene.add(floor);
new THREE.TextureLoader().load("assets/rug.jpg", (t) => {
  t.colorSpace = SRGB; t.anisotropy = 8;
  const r = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.9), std(0xffffff, { map: t, bumpMap: retile(weave, 18, 27), bumpScale: 1.5, roughness: 1 }));
  r.rotation.x = -Math.PI / 2; r.rotation.z = Math.PI / 2; r.position.set(0.3, 0.012, 0.9); r.receiveShadow = true; scene.add(r);
});

// soft contact shadows under furniture (they ground the objects on the floor)
const contactTex = canvasTexture(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62); gr.addColorStop(0, "rgba(25,10,4,.6)"); gr.addColorStop(1, "rgba(25,10,4,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
function contact(x, z, w, d, o = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: o, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); m.renderOrder = 1; scene.add(m);
}

// walls, roof, beams
function gableWall(z, hole) {
  const s = new THREE.Shape();
  s.moveTo(-6, 0); s.lineTo(6, 0); s.lineTo(6, EH); s.lineTo(0, RH); s.lineTo(-6, EH); s.closePath();
  const h = new THREE.Path(); hole.forEach(([x, y], i) => (i ? h.lineTo(x, y) : h.moveTo(x, y))); h.closePath(); s.holes.push(h);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), plasterShape);
  m.position.z = z; m.castShadow = true; m.receiveShadow = true; scene.add(m);
}
gableWall(Z_BACK, [[-1.9, 0.9], [1.9, 0.9], [1.9, 4.4], [0, 5.5], [-1.9, 4.4]]);
gableWall(Z_FRONT, [[-0.9, 0], [0.9, 0], [0.9, 2.3], [-0.9, 2.3]]);
[[-6, Math.PI / 2], [6, -Math.PI / 2]].forEach(([x, ry]) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Z_FRONT - Z_BACK, EH), plasterPlane);
  m.position.set(x, EH / 2, Z_MID); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = true; scene.add(m);
});
const ang = Math.atan2(RH - EH, 6), slope = Math.hypot(6, RH - EH), roofY = (EH + RH) / 2;
[-1, 1].forEach((s) => {
  const slab = box(slope + 0.2, 0.12, Z_FRONT - Z_BACK + 0.3, paleWood, s * 3, roofY, Z_MID); slab.rotation.z = -s * ang;
  for (let z = -4.6; z <= 4.2; z += 1.4) { const r = box(slope + 0.3, 0.22, 0.14, beam, s * 3, roofY - 0.14, z, scene, 0.02); r.rotation.z = -s * ang; }
});
for (let z = -4.6; z <= 4.2; z += 1.4) box(12, 0.18, 0.14, beam, 0, EH + 0.2, z, scene, 0.02);
box(0.2, 0.2, Z_FRONT - Z_BACK + 0.3, beam, 0, RH - 0.1, Z_MID);

// the woven strip along the lower walls
const stripTex = canvasTexture(144, 36, (g, w, h) => {
  g.fillStyle = "#5b1f11"; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 36) {
    g.fillStyle = "#b36633"; g.beginPath(); g.moveTo(x + 18, 4); g.lineTo(x + 28, 18); g.lineTo(x + 18, 32); g.lineTo(x + 8, 18); g.fill();
    g.fillStyle = "#5474a1"; g.fillRect(x, 15, 5, 6);
  }
});
function trim(len, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(len, 0.9, 0.06, dark, 0, 0.45, 0.03, g, 0.01);
  const rail = box(len, 0.05, 0.09, wood, 0, 0.92, 0.04, g, 0.01);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.12), std(0xffffff, { map: retile(stripTex, len / 1.2, 1) })); strip.position.set(0, 1.0, 0.065); g.add(strip);
  box(len, 0.12, 0.08, wood, 0, 0.06, 0.04, g, 0.01);   // skirting board
  scene.add(g);
}
trim(12, 0, Z_BACK, 0); trim(9.5, -6, Z_MID, Math.PI / 2); trim(9.5, 6, Z_MID, -Math.PI / 2);

// the big window: slate-blue frame with mullions, and a forest outside
[-1.9, -0.95, 0.95, 1.9].forEach((x) => box(0.07, 3.5, 0.12, beam, x, 2.65, Z_BACK + 0.04, scene, 0.015));
box(0.07, 4.6, 0.12, beam, 0, 3.2, Z_BACK + 0.04, scene, 0.015);
[0.9, 2.05, 3.2].forEach((y) => box(3.8, 0.07, 0.12, beam, 0, y, Z_BACK + 0.04, scene, 0.015));
box(4.3, 0.1, 0.32, beam, 0, 0.88, Z_BACK + 0.1);
[[-1, 0.52], [1, -0.52]].forEach(([s, a]) => { const b = box(0.07, 2.2, 0.12, beam, s * 0.95, 4.95, Z_BACK + 0.04, scene, 0.015); b.rotation.z = a; });
const forest = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshBasicMaterial({ fog: false, toneMapped: true, map: canvasTexture(512, 256, (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#bcd9ea"); sky.addColorStop(0.55, "#e9f1ea"); sky.addColorStop(1, "#fbf3d6");
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  for (let layer = 0; layer < 3; layer++) {                       // far, middle and near trees, each hazier than the next
    for (let i = 0; i < 46; i++) {
      const cx = (i * 83 + layer * 41) % w, cy = h * (0.5 + layer * 0.14) + ((i * 37) % (h * 0.35)), r = 14 + (i % 6) * 8 + layer * 5;
      const gr = g.createRadialGradient(cx, cy, 2, cx, cy, r), k = 0.5 + layer * 0.2;
      gr.addColorStop(0, `rgba(${Math.round(90 - layer * 25 + (i * 7) % 25)},${Math.round(130 - layer * 20 + (i * 13) % 30)},${Math.round(95 - layer * 20 + (i * 5) % 20)},${k})`);
      gr.addColorStop(1, "rgba(90,130,95,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    }
    const haze = g.createLinearGradient(0, 0, 0, h); haze.addColorStop(0, "rgba(255,250,235,0)"); haze.addColorStop(1, "rgba(255,250,235,.28)");
    g.fillStyle = haze; g.fillRect(0, 0, w, h);
  }
}) }));
forest.position.set(0, 6, -13); scene.add(forest);

// light: warm sun through the window (soft shadows of the frame on the floor), a little fill, warm lamps
scene.add(new THREE.HemisphereLight(0xfff0d6, 0x7a5a40, 0.45));
const sun = new THREE.DirectionalLight(0xffd9a0, 3.4);
sun.position.set(1.5, 6.5, -11); sun.target.position.set(0, 0, -1);
sun.castShadow = true; sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.radius = 3.5;
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 7, bottom: -7, near: 1, far: 30 });
scene.add(sun, sun.target);
const lamp = new THREE.PointLight(0xffb468, 14, 9, 2); lamp.position.set(3.1, 2.7, -2.0); scene.add(lamp);

// soft shafts of light coming through the window
const rayTex = canvasTexture(64, 256, (g, w, h) => {
  const a = g.createLinearGradient(0, 0, 0, h); a.addColorStop(0, "rgba(255,230,170,0)"); a.addColorStop(0.15, "rgba(255,230,170,.8)"); a.addColorStop(1, "rgba(255,230,170,0)");
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  const b = g.createLinearGradient(0, 0, w, 0); b.addColorStop(0, "rgba(0,0,0,1)"); b.addColorStop(0.5, "rgba(0,0,0,0)"); b.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out"; g.fillStyle = b; g.fillRect(0, 0, w, h);
});
[-1.1, 0, 1.1].forEach((dx, i) => {
  const shaft = new THREE.Group();
  [0, Math.PI / 2].forEach((ry) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 5.2), new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, opacity: 0.16 - i * 0.02, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    p.rotation.y = ry; shaft.add(p);
  });
  shaft.rotation.x = -1.0; shaft.position.set(dx * 0.9, 1.5, -3.0); scene.add(shaft);
});

// ---------- 4. PROPS: the things that make it a workshop ----------
// leaf texture: the outline comes from the geometry; the texture paints colour, midrib, veins (and the slits of a monstera)
function leafTexture(kind) {
  return canvasTexture(128, 256, (g, w, h) => {
    const P = { ficus: ["#3d6a2c", "#1f4a24"], snake: ["#2c5230", "#16331d"], spider: ["#5d9a3c", "#3b7a2c"], monstera: ["#2b6b34", "#154a27"] }[kind];
    const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, P[0]); gr.addColorStop(1, P[1]);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {                                               // fine mottling
      g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,200,.05)" : "rgba(0,20,0,.07)";
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 6);
    }
    if (kind === "snake") {                                                       // wavy dark bands + yellow-green margins
      for (let y = 0; y < h; y += 7) { g.strokeStyle = `rgba(10,35,18,${0.15 + 0.25 * hash(y, 3)})`; g.lineWidth = 2 + 3 * hash(y, 4);
        g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.15 + y) * 3); g.stroke(); }
      g.fillStyle = "rgba(200,190,80,.8)"; g.fillRect(0, 0, 7, h); g.fillRect(w - 7, 0, 7, h);
      return;
    }
    if (kind === "spider") {                                                      // cream margins, green centre
      g.fillStyle = "rgba(235,232,190,.92)"; g.fillRect(0, 0, 30, h); g.fillRect(w - 30, 0, 30, h);
      g.strokeStyle = "rgba(60,110,40,.6)"; g.lineWidth = 1;
      for (let x = 34; x < w - 30; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      return;
    }
    g.strokeStyle = "rgba(200,230,150,.75)"; g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();   // midrib
    g.lineWidth = 1.4; g.strokeStyle = "rgba(190,225,140,.38)";                  // side veins
    for (let y = h - 14; y > 14; y -= 15) for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * w * 0.28, y - 8, w / 2 + s * w * 0.5, y - 34); g.stroke();
    }
    if (kind === "monstera") {                                                    // the signature slits (see-through)
      g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000";
      for (let y = h * 0.2; y < h * 0.9; y += 28) for (const s of [-1, 1]) {
        const ex = s < 0 ? -2 : w + 2, ix = w / 2 + s * w * 0.14;
        g.beginPath(); g.moveTo(ex, y - 5); g.lineTo(ix, y + 5); g.lineTo(ex, y + 11); g.closePath(); g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }
  });
}

// a leaf surface: length along +z, width along x, normal up. Gently folded along the midrib and drooping toward the tip.
function leafGeometry({ len, wid, droop = 0.2, fold = 0.25, profile, nu = 6, nv = 14 }) {
  const geo = new THREE.PlaneGeometry(1, 1, nu, nv), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), t = py + 0.5, x = -px * 2 * (wid / 2) * profile(t);
    pos.setXYZ(i, x, fold * Math.abs(x) - droop * len * t * t, t * len);
  }
  geo.computeVertexNormals();
  return geo;
}
function leafMaterials(kind, extra = {}) {
  const tex = leafTexture(kind), tints = [0xffffff, 0xe6f2d6, 0xd2e6c0];
  return tints.map((c) => new THREE.MeshStandardMaterial({ map: tex, color: c, roughness: kind === "snake" ? 0.4 : 0.5, metalness: 0,
    side: THREE.DoubleSide, emissive: 0x0b2a0c, emissiveIntensity: 0.35, alphaTest: kind === "monstera" ? 0.5 : 0, ...extra }));
}
function addLeaf(parent, geo, mat, pos, az, elev, roll, sc) {
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos); m.rotation.order = "YXZ"; m.rotation.set(-elev, az, roll); m.scale.setScalar(sc);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function stem(parent, pts, radius, mat) {
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, radius, 6), mat);
  m.castShadow = true; parent.add(m); return m;
}

const LEAF = {};                                                                  // built once, shared by every plant
function leafKit() {
  if (LEAF.ficus) return LEAF;
  LEAF.ficus = { geo: leafGeometry({ len: 0.30, wid: 0.17, droop: 0.18, fold: 0.3, profile: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.75) }), mats: leafMaterials("ficus", { roughness: 0.32 }) };
  LEAF.snake = { geo: leafGeometry({ len: 0.62, wid: 0.085, droop: 0.06, fold: 1.2, profile: (t) => Math.pow(1 - Math.pow(t, 2.4), 0.6) * (0.7 + 0.3 * Math.min(1, t * 8)) }), mats: leafMaterials("snake", { roughness: 0.38 }) };
  LEAF.spider = { geo: leafGeometry({ len: 0.60, wid: 0.045, droop: 0.55, fold: 0.7, nv: 18, profile: (t) => Math.pow(1 - Math.pow(t, 3), 0.5) * (0.5 + 0.5 * Math.min(1, t * 6)) }), mats: leafMaterials("spider") };
  LEAF.monstera = { geo: leafGeometry({ len: 0.34, wid: 0.34, droop: 0.12, fold: 0.18, nu: 10, nv: 14, profile: (t) => Math.pow(Math.sin(Math.PI * (t * 0.9 + 0.05)), 0.62) }), mats: leafMaterials("monstera", { roughness: 0.35 }) };
  return LEAF;
}

// kind: "ficus" | "snake" | "spider" | "monstera"; s = overall size; glazed = shiny ceramic pot instead of terracotta
function plant(x, z, s = 1, potColor = 0xb5683a, kind = "ficus") {
  const K = leafKit(), L = K[kind], g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  const glazed = potColor !== 0xb5683a, B = 0.03;
  const pm = pixelMaps(64, 64, (px, py) => {
    const n = fbm(px * 0.12, py * 0.12), c = new THREE.Color(potColor), k = (glazed ? 0.96 : 0.82) + 0.22 * n;
    return { c: [c.r * 255 * k, c.g * 255 * k, c.b * 255 * k], h: n };
  }, [3, 1]);
  const potMat = std(0xffffff, { map: pm.map, bumpMap: glazed ? null : pm.bump, bumpScale: 1.2, roughness: glazed ? 0.22 : 0.85, side: THREE.DoubleSide });
  const profile = [[0, 0], [0.09, 0], [0.097, 0.012], [0.145, 0.27], [0.158, 0.285], [0.168, 0.30], [0.168, 0.32], [0.158, 0.322], [0.15, 0.31], [0.14, 0.28], [0, 0.28]];
  const pot = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 40), potMat);
  pot.position.y = B; pot.castShadow = true; pot.receiveShadow = true; g.add(pot);
  cyl(0.2, 0.15, B, std(glazed ? 0xd8cdb8 : 0xa2552f, { roughness: glazed ? 0.3 : 0.85 }), 0, B / 2, 0, g, 36);       // saucer
  const SY = B + 0.268;                                                                                           // soil surface
  const soilTex = canvasTexture(64, 64, (c) => { c.fillStyle = "#33261a"; c.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? "90,65,40" : "10,6,3"},.5)`; c.fillRect(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 2, 1 + Math.random() * 2); } });
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.142, 28), std(0xffffff, { map: soilTex, roughness: 1 }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = SY; soil.receiveShadow = true; g.add(soil);
  for (let i = 0; i < 9; i++) { const a = hash(i, 21) * 6.28, r = 0.04 + 0.09 * hash(i, 22);                         // a few pebbles on the soil
    const p = sph(0.012 + 0.008 * hash(i, 23), std(0x8d8678, { roughness: 0.9 }), Math.cos(a) * r, SY + 0.004, Math.sin(a) * r, g); p.scale.y = 0.6; p.castShadow = false; }
  contact(x, z, 0.78 * s, 0.78 * s, 0.8);                                                                         // soft shadow on the floor

  const root = new THREE.Vector3(0, SY, 0), mat = (i) => L.mats[i % 3], bark = std(0x6b5a48, { roughness: 0.85 }), green = std(0x587f3a, { roughness: 0.6 });
  if (kind === "ficus") {                                                         // a tall rubber/fiddle-leaf tree
    const trunk = new THREE.CatmullRomCurve3([root, new THREE.Vector3(0.02, SY + 0.3, 0.01), new THREE.Vector3(-0.02, SY + 0.62, 0.02), new THREE.Vector3(0.01, SY + 0.92, -0.01)]);
    stem(g, trunk.getPoints(8), 0.016, bark);
    for (let i = 0; i < 26; i++) {
      const t = 0.22 + 0.78 * (i / 25), p = trunk.getPoint(t), az = i * 2.399 + hash(i, 1), up = 0.25 + 0.7 * t;
      p.x += Math.cos(az) * 0.02; p.z += Math.sin(az) * 0.02;
      addLeaf(g, L.geo, mat(i), p, Math.PI / 2 - az, up * 0.9, (hash(i, 2) - 0.5) * 0.5, (1.15 - 0.35 * t) * (0.85 + 0.3 * hash(i, 3)));
    }
  } else if (kind === "snake") {                                                  // stiff upright sword-shaped leaves
    for (let i = 0; i < 11; i++) {
      const az = i * 2.399, r = 0.03 + 0.05 * hash(i, 1), sc = 0.7 + 0.75 * hash(i, 2);
      addLeaf(g, L.geo, mat(i), new THREE.Vector3(Math.cos(az) * r, SY, Math.sin(az) * r), Math.PI / 2 - az, 1.25 + 0.25 * hash(i, 3), (hash(i, 4) - 0.5) * 1.2, sc);
    }
  } else if (kind === "spider") {                                                 // a fountain of arching striped leaves
    for (let i = 0; i < 24; i++) {
      const az = i * 2.399 + hash(i, 1), r = 0.015 + 0.03 * hash(i, 2);
      addLeaf(g, L.geo, mat(i), new THREE.Vector3(Math.cos(az) * r, SY, Math.sin(az) * r), Math.PI / 2 - az, 0.55 + 0.75 * hash(i, 3), (hash(i, 4) - 0.5) * 0.6, 0.8 + 0.5 * hash(i, 5));
    }
  } else if (kind === "monstera") {                                               // big split leaves on long arching stalks
    for (let i = 0; i < 9; i++) {
      const az = i * 2.399 + 0.4, hgt = 0.28 + 0.55 * hash(i, 1) + 0.06 * i, out = 0.1 + 0.28 * hash(i, 2), sc = 1.0 + 0.5 * hash(i, 3);
      const end = new THREE.Vector3(Math.cos(az) * out, SY + hgt, Math.sin(az) * out);
      const mid = new THREE.Vector3(Math.cos(az) * out * 0.25, SY + hgt * 0.75, Math.sin(az) * out * 0.25);
      stem(g, [root, mid, end], 0.0065, green);
      addLeaf(g, L.geo, mat(i), end, Math.PI / 2 - az, 0.45 - 0.5 * hash(i, 4), (hash(i, 5) - 0.5) * 0.3, sc);
    }
  }
  return g;
}
function ladder(x, z, ry, lean) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const inner = new THREE.Group(); inner.rotation.x = -lean; g.add(inner);
  box(0.05, 2.7, 0.04, wood, -0.22, 1.35, 0, inner, 0.01); box(0.05, 2.7, 0.04, wood, 0.22, 1.35, 0, inner, 0.01);
  for (let i = 0; i < 7; i++) box(0.44, 0.035, 0.04, wood, 0, 0.35 + i * 0.36, 0, inner, 0.01);
  scene.add(g);
}
function books(x, y, z, n = 4) { const c = [0x9a2106, 0x5474a1, 0xe7ba80, 0x323659, 0xb36633]; for (let i = 0; i < n; i++) box(0.26 - i * 0.01, 0.045, 0.19, std(c[i % 5], { roughness: 0.6 }), x, y + 0.0225 + i * 0.045, z).rotation.y = i * 0.25; }
function brushes(x, y, z) {
  lathe([[0, 0], [0.045, 0], [0.05, 0.13], [0.046, 0.13], [0.042, 0.01], [0, 0.01]], std(0xcfc2a8, { roughness: 0.5 }), x, y, z);
  for (let i = 0; i < 7; i++) {
    const b = cyl(0.006, 0.005, 0.28, std(0x6b3f1e, { roughness: 0.4 }), x + (i % 3 - 1) * 0.02, y + 0.21, z + (i % 2 - 0.5) * 0.03, scene, 8); b.rotation.z = (i - 3) * 0.08;
    const tip = cyl(0.007, 0.002, 0.04, std(i % 2 ? 0x9a2106 : 0x2a2a2a, { roughness: 0.9 }), b.position.x + Math.sin(-b.rotation.z) * 0.15, y + 0.21 + 0.145, b.position.z, scene, 8); tip.rotation.z = b.rotation.z;
  }
}
function bowls(x, y, z, n = 3) {
  for (let i = 0; i < n; i++) lathe([[0, 0], [0.05, 0], [0.09, 0.03], [0.12, 0.065], [0.125, 0.067], [0.117, 0.067], [0.085, 0.037], [0.045, 0.014], [0, 0.014]].map(([r, h]) => [r - i * 0.012, h]), std(i % 2 ? 0xe8dcc4 : 0xb5683a, { roughness: 0.35 }), x, y + i * 0.04, z);
}
const glassJar = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.2 });
function jar(x, y, z, c) { lathe([[0, 0], [0.04, 0], [0.047, 0.012], [0.047, 0.09], [0.04, 0.102], [0.03, 0.112], [0.03, 0.13], [0.0, 0.13]], glassJar(c), x, y, z); }
function vase(x, y, z, c) { lathe([[0, 0], [0.05, 0], [0.09, 0.08], [0.06, 0.2], [0.035, 0.27], [0.05, 0.31], [0.045, 0.31], [0.03, 0.27], [0.05, 0.2], [0.08, 0.08], [0.04, 0.012], [0, 0.012]], std(c, { roughness: 0.25 }), x, y, z); }
function stool(x, z) {
  cyl(0.18, 0.17, 0.045, wood, x, 0.62, z);
  [0, 2.1, 4.2].forEach((a) => { const l = box(0.035, 0.62, 0.035, wood, x + Math.cos(a) * 0.15, 0.31, z + Math.sin(a) * 0.15, scene, 0.01); l.rotation.z = Math.cos(a) * 0.08; l.rotation.x = -Math.sin(a) * 0.08; });
  contact(x, z, 0.7, 0.7, 0.7);
}
function tableAt(x, z, w, d, h) {
  box(w, 0.06, d, wood, x, h, z, scene, 0.02);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => box(0.07, h, 0.07, wood, x + a * (w / 2 - 0.07), h / 2, z + b * (d / 2 - 0.07), scene, 0.015));
  box(w - 0.2, 0.08, 0.04, wood, x, h - 0.09, z - d / 2 + 0.1); box(w - 0.2, 0.08, 0.04, wood, x, h - 0.09, z + d / 2 - 0.1);
  contact(x, z, w + 0.8, d + 0.9, 0.8);
}
function shelfUnit(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(0.05, 2.4, 0.35, wood, -0.6, 1.2, 0, g, 0.012); box(0.05, 2.4, 0.35, wood, 0.6, 1.2, 0, g, 0.012);
  [0.3, 0.9, 1.5, 2.1].forEach((y, i) => {
    box(1.25, 0.04, 0.35, wood, 0, y, 0, g, 0.01);
    for (let k = 0; k < 4; k++) {
      const c = [0xb36633, 0x5474a1, 0xf4e4c8, 0x9a2106, 0x323659][(i + k) % 5], px = -0.45 + k * 0.3;
      if ((i + k) % 3 === 0) box(0.2, 0.18, 0.2, std(c, { roughness: 0.6 }), px, y + 0.11, 0, g, 0.02);
      else if ((i + k) % 3 === 1) { const m = glassJar(c); const l = lathe([[0, 0], [0.06, 0], [0.075, 0.015], [0.075, 0.13], [0.06, 0.15], [0.0, 0.15]], m, 0, 0, 0, g); l.position.set(px, y + 0.02, 0); }
      else lathe([[0, 0], [0.05, 0], [0.085, 0.07], [0.05, 0.17], [0.035, 0.22], [0.05, 0.25], [0.0, 0.25]], std(c, { roughness: 0.25 }), px, y + 0.02, 0, g);
    }
  });
  scene.add(g); contact(x - Math.sin(ry) * 0.2, z - Math.cos(ry) * 0.2, 1.8, 0.9, 0.5);
}
function sofa(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const fab = std(0x7f98c0, { roughness: 1, bumpMap: retile(weave, 6, 3), bumpScale: 0.8 }), fab2 = std(0x6a85b0, { roughness: 1, bumpMap: retile(weave, 6, 3), bumpScale: 0.8 });
  box(1.95, 0.2, 0.9, wood, 0, 0.3, 0, g, 0.03); [-0.85, 0.85].forEach((a) => [-0.35, 0.35].forEach((b) => box(0.06, 0.2, 0.06, wood, a, 0.1, b, g, 0.015)));
  box(1.85, 0.2, 0.82, fab, 0, 0.49, 0.02, g, 0.08); box(1.85, 0.42, 0.2, fab2, 0, 0.78, -0.34, g, 0.08);
  box(0.2, 0.34, 0.82, fab2, -0.97, 0.66, 0.02, g, 0.07); box(0.2, 0.34, 0.82, fab2, 0.97, 0.66, 0.02, g, 0.07);
  box(0.42, 0.4, 0.13, std(0xb36633, { roughness: 1, bumpMap: retile(weave, 3, 3), bumpScale: 1 }), -0.55, 0.78, -0.16, g, 0.05).rotation.x = -0.25;
  box(0.4, 0.38, 0.13, std(0x5474a1, { roughness: 1, bumpMap: retile(weave, 3, 3), bumpScale: 1 }), 0.5, 0.76, -0.16, g, 0.05).rotation.x = -0.25;
  scene.add(g); contact(x, z, 1.4, 2.5, 0.7);
}
function cabinet(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(1.4, 0.85, 0.9, std(0xc9ae86, { roughness: 0.5 }), 0, 0.425, 0, g, 0.015);
  for (let i = 0; i < 5; i++) { box(1.3, 0.13, 0.02, std(0xa98a62, { roughness: 0.5 }), 0, 0.12 + i * 0.16, 0.46, g, 0.006); box(0.18, 0.02, 0.03, std(0x2b2e4d, { metalness: 0.8, roughness: 0.3 }), 0, 0.12 + i * 0.16, 0.48, g, 0.008); }
  scene.add(g); contact(x, z, 1.2, 2.0, 0.6);
}
function floorLamp(x, z) {
  cyl(0.15, 0.16, 0.03, std(0x2b2e4d, { metalness: 0.6, roughness: 0.4 }), x, 0.015, z); cyl(0.012, 0.012, 1.5, std(0x2b2e4d, { metalness: 0.6, roughness: 0.4 }), x, 0.78, z);
  const shade = cyl(0.12, 0.2, 0.28, std(0xf4e4c8, { emissive: 0xf4e4c8, emissiveIntensity: 0.9, side: THREE.DoubleSide }), x, 1.65, z, scene, 32); shade.castShadow = false;
  const l = new THREE.PointLight(0xffc880, 5, 6, 2); l.position.set(x, 1.6, z); scene.add(l);
}
function smallFrame(x, y, z, ry, w, h, seed) {          // painterly studies on the wall (not clickable)
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  box(w + 0.08, h + 0.08, 0.04, std(0x3a2013, { roughness: 0.5 }), 0, 0, 0, g, 0.01);
  const cols = ["#b36633", "#5474a1", "#f4e4c8", "#9a2106", "#323659", "#e7ba80", "#5b1f11"];
  const tex = canvasTexture(128, 128, (c, W, H) => {
    c.fillStyle = cols[seed % 7]; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) {
      const cx = hash(seed, i) * W, cy = hash(i, seed) * H, r = 24 + hash(i, seed + 3) * 40, gr = c.createRadialGradient(cx, cy, 2, cx, cy, r);
      gr.addColorStop(0, cols[(seed + i * 2) % 7]); gr.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr; c.globalAlpha = 0.85; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
    }
    c.globalAlpha = 1; c.lineCap = "round";
    for (let i = 0; i < 3; i++) { c.strokeStyle = cols[(seed + i * 3 + 1) % 7]; c.lineWidth = 7 + i * 3; c.beginPath(); c.moveTo(hash(seed, i + 9) * W, hash(i + 4, seed) * H); c.quadraticCurveTo(W / 2, hash(i, 9) * H, hash(seed + 2, i) * W, hash(i + 7, seed) * H); c.stroke(); }
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std(0xffffff, { map: tex, bumpMap: retile(weave, w * 14, h * 14), bumpScale: 1.2, roughness: 0.8 })); p.position.z = 0.025; g.add(p); scene.add(g);
}
function dropCloth(x, z, w, d) {                        // a paint-splattered cloth on the floor
  const tex = canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = "#e9dfc9"; g.fillRect(0, 0, W, H);
    const cols = ["#b36633", "#5474a1", "#9a2106", "#e7ba80", "#323659", "#5b1f11"];
    for (let i = 0; i < 38; i++) { g.fillStyle = cols[i % 6]; g.globalAlpha = 0.7; g.beginPath(); g.arc(hash(i, 1) * W, hash(2, i) * H, 1 + hash(i, 3) * 3.5, 0, 7); g.fill(); }
    g.lineCap = "round"; for (let i = 0; i < 7; i++) { g.strokeStyle = cols[(i * 2) % 6]; g.globalAlpha = 0.55; g.lineWidth = 2 + hash(i, 8) * 3; g.beginPath(); g.moveTo(hash(i, 5) * W, hash(5, i) * H); g.lineTo(hash(i, 5) * W + 30 + hash(i, 6) * 40, hash(5, i) * H + 10 + hash(6, i) * 30); g.stroke(); }
    g.globalAlpha = 1;
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(0xffffff, { map: tex, bumpMap: retile(weave, 14, 12), bumpScale: 1.5, roughness: 1 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = 0.15; m.position.set(x, 0.009, z); m.receiveShadow = true; scene.add(m);
}
function palette(x, y, z) {                              // a wooden palette with dabs of paint
  const s = new THREE.Shape(); s.absellipse(0, 0, 0.17, 0.12, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path(); hole.absellipse(-0.08, 0.03, 0.022, 0.016, 0, Math.PI * 2, false, 0); s.holes.push(hole);
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 24 }), std(0xc9a26a, { roughness: 0.4 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.rotation.z = 0.5; m.castShadow = true; scene.add(m);
  [0xb36633, 0x5474a1, 0x9a2106, 0xe7ba80, 0x323659].forEach((c, i) => { const d = sph(0.018, std(c, { roughness: 0.25 }), x + Math.cos(0.5 + i * 0.7) * 0.1, y + 0.012, z + Math.sin(0.5 + i * 0.7) * 0.075 * 1.1); d.scale.set(1, 0.5, 1); });
}

// easel (where the chosen painting stands) and the table with the tools
const EASEL_X = 0.5;
box(0.05, 2.0, 0.05, wood, EASEL_X - 0.36, 1.0, -2.25, scene, 0.012).rotation.x = -0.1;
box(0.05, 2.0, 0.05, wood, EASEL_X + 0.36, 1.0, -2.25, scene, 0.012).rotation.x = -0.1;
box(0.05, 2.0, 0.05, wood, EASEL_X, 1.0, -2.62, scene, 0.012).rotation.x = 0.2;
box(0.9, 0.05, 0.05, wood, EASEL_X, 1.9, -2.38); box(0.98, 0.05, 0.16, wood, EASEL_X, 0.72, -2.14);
dropCloth(EASEL_X, -1.9, 1.9, 1.5); contact(EASEL_X, -2.3, 1.2, 1.0, 0.5);
const TABLE_X = 3.1, TOP = 0.92;
tableAt(TABLE_X, -2.2, 1.9, 0.85, TOP);
palette(TABLE_X - 0.05, TOP + 0.034, -2.45);

// furnishing
tableAt(-2.4, -1.1, 2.4, 0.95, 0.9);
bowls(-3.2, 0.93, -1.2, 4); bowls(-1.5, 0.93, -0.9, 3); books(-2.4, 0.93, -1.3, 5); books(-3.0, 0.93, -0.8, 3);
brushes(-2.0, 0.93, -1.2); brushes(-3.5, 0.93, -0.9); [0xb36633, 0x5474a1, 0x9a2106, 0xe7ba80].forEach((c, i) => jar(-2.9 + i * 0.28, 0.93, -1.45, c));
vase(-1.2, 0.93, -1.3, 0xd9b58a); palette(-2.2, 0.96, -0.75);
box(0.9, 0.012, 0.6, std(0xf3ead6, { roughness: 1 }), -2.4, 0.935, -0.45, scene, 0.004).rotation.y = 0.2;
ladder(-4.6, -4.75, 0.0, 0.17); ladder(5.5, -3.8, -Math.PI / 2, 0.17);
shelfUnit(5.75, -1.4, -Math.PI / 2); shelfUnit(-5.75, -3.0, Math.PI / 2);
sofa(4.5, 2.4, -Math.PI / 2); cabinet(-4.9, 1.9, Math.PI / 2); floorLamp(5.2, 0.6); floorLamp(-5.3, -0.6);
stool(-0.9, -0.2); stool(1.8, -0.9);
<<<<<<< HEAD
plant(-5.4, 3.4, 1.35, 0xb5683a, "ficus"); plant(5.4, 4.0, 1.2, 0x6b8e8a, "snake"); plant(2.2, -4.6, 1.5, 0xb5683a, "monstera"); plant(-1.6, -4.6, 1.15, 0x436066, "spider");
books(3.9, TOP + 0.03, -2.0, 3); brushes(2.2, TOP + 0.03, -2.4); jar(3.6, TOP + 0.03, -2.5, 0xea7720); jar(3.75, TOP + 0.03, -2.45, 0x436066);
=======
plant(-5.4, 3.4, 1.5); plant(5.4, 4.0, 1.3, 0x5474a1); plant(2.2, -4.6, 1.6); plant(-1.6, -4.6, 1.2, 0x5474a1);
books(3.9, TOP + 0.03, -2.0, 3); brushes(2.2, TOP + 0.03, -2.4); jar(3.6, TOP + 0.03, -2.5, 0xb36633); jar(3.75, TOP + 0.03, -2.45, 0x5474a1);
>>>>>>> 1d36063 (now working on test folder)
for (let i = 0; i < 4; i++) { const c = box(0.8, 1.0, 0.03, std(0xf3ead6, { roughness: 0.9, bumpMap: retile(weave, 10, 12), bumpScale: 1 }), -5.3 + i * 0.07, 0.52, -3.4 - i * 0.04, scene, 0.008); c.rotation.set(-0.1, 0.4 + i * 0.03, 0.02); }
smallFrame(-5.96, 1.7, -0.2, Math.PI / 2, 0.5, 0.65, 1); smallFrame(-5.96, 2.2, 0.9, Math.PI / 2, 0.45, 0.45, 2);
smallFrame(-5.96, 1.6, 1.6, Math.PI / 2, 0.6, 0.45, 3); smallFrame(5.96, 2.3, 1.2, -Math.PI / 2, 0.5, 0.6, 4);
smallFrame(5.96, 1.8, 2.4, -Math.PI / 2, 0.55, 0.4, 5); smallFrame(5.96, 2.5, -0.4, -Math.PI / 2, 0.45, 0.45, 6);

const interactive = [];       // everything the learner can click: paintings and tools

function makeTool(key, name, x, build) {
  const g = new THREE.Group();
  build(g);
  g.position.set(x, TOP + 0.02, -2.15);
  g.userData = { type: "tool", key, name, home: g.position.clone(), homeQuat: g.quaternion.clone() };
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.26), new THREE.MeshBasicMaterial({ visible: false }));   // easy to click, even with a finger
  hit.position.y = 0.07; g.add(hit);
  scene.add(g); interactive.push(g);
  return g;
}
const spongeTex = pixelTexture(128, 128, (x, y) => { const n = fbm(x * 0.12, y * 0.12), pore = hash(x >> 2, y >> 2) < 0.1 ? 0.55 : 1, s = (0.82 + 0.3 * n) * pore; return [232 * s, 184 * s, 70 * s]; });
const spongeBump = pixelTexture(128, 128, (x, y) => { const v = (hash(x >> 2, y >> 2) < 0.1 ? 40 : 150) + fbm(x * 0.2, y * 0.2) * 60; return [v, v, v]; }, null, false);
const sponge = makeTool("sponge", "Water Sponge", TABLE_X - 0.6, (g) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.1, 0.17, 4, 0.035), std(0xffffff, { map: spongeTex, bumpMap: spongeBump, bumpScale: 3, roughness: 1 }));
  m.position.y = 0.05; g.add(m);
});
const knife = makeTool("knife", "Palette Knife", TABLE_X, (g) => {
  const handle = lathe([[0, -0.07], [0.012, -0.07], [0.017, -0.04], [0.019, 0.0], [0.016, 0.05], [0.011, 0.07], [0, 0.07]], std(0x7a4a24, { roughness: 0.35 }), 0, 0, 0, g);
  handle.rotation.z = Math.PI / 2; handle.position.set(-0.11, 0.02, 0);
  const ferrule = cyl(0.012, 0.012, 0.03, std(0xc8ced0, { metalness: 0.9, roughness: 0.25 }), -0.025, 0.02, 0, g, 16); ferrule.rotation.z = Math.PI / 2;
  const s = new THREE.Shape(); s.moveTo(0, -0.008); s.lineTo(0.13, -0.034); s.quadraticCurveTo(0.21, 0, 0.13, 0.034); s.lineTo(0, 0.008); s.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false }), std(0xd6dcde, { metalness: 0.95, roughness: 0.22, envMapIntensity: 1.4 }));
  blade.rotation.x = -Math.PI / 2; blade.position.set(0.0, 0.03, 0.0); g.add(blade);
  g.rotation.y = 0.5; g.userData.homeQuat = g.quaternion.clone();
});
const chalkTex = pixelTexture(64, 64, (x, y) => { const n = 0.9 + 0.12 * fbm(x * 0.3, y * 0.3); return [245 * n, 238 * n, 222 * n]; });
const chalk = makeTool("chalk", "Edge Chalk", TABLE_X + 0.6, (g) => {
  const stick = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.15, 6, 20), std(0xffffff, { map: chalkTex, bumpMap: chalkTex, bumpScale: 1.5, roughness: 1 }));
  stick.rotation.z = Math.PI / 2; stick.position.y = 0.024; g.add(stick);
  const band = cyl(0.0235, 0.0235, 0.05, std(ORG, { roughness: 0.8 }), -0.025, 0.024, 0, g, 24); band.rotation.z = Math.PI / 2;
  g.rotation.y = -0.4; g.userData.homeQuat = g.quaternion.clone();
});
const tools = [sponge, knife, chalk];

// name tags above the tools (drawn once the fonts are ready)
document.fonts.ready.then(() => {
  tools.forEach((t) => {
    const tex = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = "rgba(31,34,64,.85)"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#b36633"; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = "#f4e4c8"; g.font = "700 26px Kufam, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t.userData.name, w / 2, h / 2 + 1);
    });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    label.scale.set(0.46, 0.115, 1); label.position.set(0, 0.24, 0); label.renderOrder = 5;
    t.add(label); t.userData.label = label;
  });
});

// ---------- 5. THE PAINTINGS: eight mosaics to choose from ----------
// On the wall a painting looks like a real painting (smooth). In the lab it becomes tiles, because that is what the convolution works on.
function smoothTexture(key) {
  const img = Patterns[key], S = 16;
  const c = document.createElement("canvas"); c.width = img.cols * S; c.height = img.rows * S;
  const g = c.getContext("2d");
  if (img.at) {                                      // painted by code: draw it at high resolution, no tiles
    const id = g.createImageData(c.width, c.height);
    for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
      const col = img.at(Math.max(0, Math.min(img.cols - 1, (px + 0.5) / S - 0.5)), Math.max(0, Math.min(img.rows - 1, (py + 0.5) / S - 0.5)), img.cols, img.rows), n = 0.97 + 0.06 * hash(px >> 1, py >> 1), i = (py * c.width + px) * 4;
      id.data[i] = col[0] * 255 * n; id.data[i + 1] = col[1] * 255 * n; id.data[i + 2] = col[2] * 255 * n; id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  } else {                                           // a photo: soft placeholder until the picture file is loaded
    const small = document.createElement("canvas"); small.width = img.cols; small.height = img.rows;
    const sg = small.getContext("2d"), sid = sg.createImageData(img.cols, img.rows);
    img.pixels.forEach((p, i) => { sid.data[i * 4] = p[0] * 255; sid.data[i * 4 + 1] = p[1] * 255; sid.data[i * 4 + 2] = p[2] * 255; sid.data[i * 4 + 3] = 255; });
    sg.putImageData(sid, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(small, 0, 0, c.width, c.height);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.anisotropy = 8; return t;
}

function makePainting(key, w, h, x, y, z = -4.93, tilt = 0, photo = null) {
  const g = new THREE.Group();
  box(w + 0.16, h + 0.16, 0.06, std(0x3a2013, { roughness: 0.45, bumpMap: furnMaps.bump, bumpScale: 1 }), 0, 0, 0, g, 0.02);     // frame moulding
  box(w + 0.05, h + 0.05, 0.07, std(0xb8925c, { roughness: 0.4 }), 0, 0, 0.005, g, 0.01);                                            // inner gilt liner
  const canvasMat = new THREE.MeshPhysicalMaterial({ map: smoothTexture(key), roughness: 0.75, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.6,
    bumpMap: retile(weave, w * 16, h * 16), bumpScale: 1.1 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), canvasMat);
  plane.position.z = 0.045; plane.receiveShadow = true; g.add(plane);
  g.position.set(x, y, z); g.rotation.x = tilt;
  g.userData = { type: "painting", key, name: Patterns[key].name, w, h, plane, staticMap: canvasMat.map, home: g.position.clone(), homeQuat: g.quaternion.clone() };
  if (photo) new THREE.TextureLoader().load(photo, (t) => { t.colorSpace = SRGB; t.anisotropy = 8; canvasMat.map = t; canvasMat.needsUpdate = true; g.userData.staticMap = t; });
  scene.add(g); interactive.push(g);
  return g;
}
// each frame has the same proportions as its picture, so no mosaic is stretched
const A = "assets/mosaic_";
const paintings = [
  // left wall
  makePainting("garden",   0.84, 1.5,  -5.43, 2.38, -4.93, 0, A + "garden.jpg"),
  makePainting("dome",     0.99, 1.4,  -4.115, 2.38, -4.93, 0, A + "dome.jpg"),
  makePainting("cliff",    0.84, 1.5,  -2.8,  2.38, -4.93, 0, A + "cliff.jpg"),
  // right wall
  makePainting("balcony",  1.07, 1.4,   2.785, 2.38, -4.93, 0, A + "balcony.jpg"),
  makePainting("chapel",   0.84, 1.5,   4.04,  2.38, -4.93, 0, A + "chapel.jpg"),
  makePainting("medallion",1.06, 1.35,  5.29,  2.38, -4.93, 0, A + "medallion.jpg"),
  // leaning on the floor
  makePainting("sunflower",   0.65, 1.15, -4.0, 0.62, -4.84, -0.1, A + "sunflower.jpg"),
  makePainting("pomegranate", 0.65, 1.15, -0.9, 0.62, -4.84, -0.1, A + "pomegranate.jpg"),
];
contact(-4.0, -4.6, 1.3, 0.6, 0.6); contact(-0.9, -4.6, 1.2, 0.6, 0.6);

// the glowing 3x3 frame, mirrored on the painting in 3D
const kernelFrame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  map: canvasTexture(128, 128, (g, w, h) => {
    g.shadowColor = "#b36633"; g.shadowBlur = 14;
    g.strokeStyle = "#1f2240"; g.lineWidth = 14; g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = "#f4e4c8"; g.lineWidth = 7; g.strokeRect(10, 10, w - 20, h - 20);
  }), transparent: true, depthWrite: false, toneMapped: false }));
kernelFrame.visible = false; kernelFrame.renderOrder = 4;

// ---------- 6. TWEENS AND THE CAMERA ----------
const tweens = [];
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
function tween(duration, update, done) { tweens.push({ t: 0, duration, update, done }); }

const view = { pos: new THREE.Vector3(0, 1.65, 6.4), tgt: new THREE.Vector3(0, 1.55, -3) };
function goView(pos, tgt, duration, done) {
  const p0 = view.pos.clone(), t0 = view.tgt.clone();
  tween(duration, (k) => { view.pos.lerpVectors(p0, pos, k); view.tgt.lerpVectors(t0, tgt, k); }, done);
}
const V = {
  room: [new THREE.Vector3(0, 1.65, 1.6), new THREE.Vector3(0, 2.1, -4)],
  pick: [new THREE.Vector3(1.7, 1.6, 0.9), new THREE.Vector3(1.8, 1.2, -2.4)],
};
function labView() {                                  // painting on the left on wide screens, on top on phones
  const wide = window.innerWidth > 760;
  return [new THREE.Vector3(EASEL_X, 1.4, -0.3), new THREE.Vector3(EASEL_X + (wide ? 0.62 : 0), wide ? 1.3 : 0.95, -2.3)];
}

const look = { yaw: 0, pitch: 0, ty: 0, tp: 0 };      // drag to look around, always easing back to a limit

// ---------- 7. THE GAME FLOW ----------
let stage = "title";                                  // title, pickPainting, pickTool, moving, lab
let easelPainting = null, heldTool = null, liveTexture = null;
const hud = $("hud");
let hudDefault = "";
function setStage(s, text) { stage = s; hudDefault = text || ""; hud.hidden = !text; $("hudText").textContent = hudDefault; }

const EASEL_POSE = { pos: (h) => new THREE.Vector3(EASEL_X, 0.8 + h / 2, -2.1), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0, 0)) };
const holdPos = () => new THREE.Vector3(window.innerWidth > 760 ? -0.22 : 0.26, -0.27, -0.62);  // visible beside the lab panel
const HOLD_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.6, 0.1));

function flyTo(obj, pos, quat, duration, done) {      // fly an object (with a little arc) to a pose
  const p0 = obj.position.clone(), q0 = obj.quaternion.clone();
  tween(duration, (k) => {
    obj.position.lerpVectors(p0, pos, k); obj.position.y += Math.sin(k * Math.PI) * 0.25;
    obj.quaternion.slerpQuaternions(q0, quat, k);
  }, done);
}

function startGame() {
  $("intro").classList.add("off");
  goView(...V.room, 3.2, () => setStage("pickPainting", "Choose a painting to work on. Drag to look around."));
  setStage("moving");
}

function choosePainting(p) {
  setStage("moving");
  hover(null);
  easelPainting = p;
  flyTo(p, EASEL_POSE.pos(p.userData.h), EASEL_POSE.quat, 1.2);
  goView(...V.pick, 1.4, () => setStage("pickTool", "Now grab a tool from the table."));
}

function chooseTool(t) {
  setStage("moving");
  hover(null);
  heldTool = t;
  camera.attach(t);                                    // the tool now follows the camera: it is in the painter's hand
  const p0 = t.position.clone(), q0 = t.quaternion.clone(), hp = holdPos();
  if (t.userData.label) t.userData.label.visible = false;      // the name tag stays on the table
  tween(1.0, (k) => { t.position.lerpVectors(p0, hp, k); t.quaternion.slerpQuaternions(q0, HOLD_QUAT, k); });
  goView(...labView(), 1.5, openLab);
}

function openLab() {
  $("lab").hidden = false;
  Lab.open(heldTool.userData.key, easelPainting.userData.key);   // lab.js: explanation, modes, detail card
  // the painting on the easel now shows the live canvas, so the convolution plays on it in 3D
  liveTexture = new THREE.CanvasTexture(Lab.canvas);
  liveTexture.colorSpace = THREE.SRGBColorSpace; liveTexture.magFilter = THREE.NearestFilter;
  easelPainting.userData.plane.material.map = liveTexture;
  easelPainting.userData.plane.material.needsUpdate = true;
  easelPainting.add(kernelFrame);
  setStage("lab");
}

function closeLab(paintingToo) {
  setStage("moving");
  Lab.close();
  $("lab").hidden = true;
  kernelFrame.visible = false;
  const pl = easelPainting.userData.plane;
  pl.material.map = easelPainting.userData.staticMap; pl.material.needsUpdate = true;
  if (liveTexture) { liveTexture.dispose(); liveTexture = null; }

  const tool = heldTool; heldTool = null;
  if (tool.userData.label) tool.userData.label.visible = true;
  scene.attach(tool);                                  // let go of the tool: it goes back to the table
  flyTo(tool, tool.userData.home, tool.userData.homeQuat, 1.0);
  if (paintingToo) {
    const p = easelPainting; easelPainting = null;
    flyTo(p, p.userData.home, p.userData.homeQuat, 1.2);
    goView(...V.room, 1.4, () => setStage("pickPainting", "Choose a painting to work on."));
  } else {
    goView(...V.pick, 1.4, () => setStage("pickTool", "Now grab a tool from the table."));
  }
}

$("start").addEventListener("click", startGame);
$("another").addEventListener("click", () => closeLab(false));
$("otherPainting").addEventListener("click", () => closeLab(true));

// ---------- 8. POINTER: LOOK AROUND, HOVER, CLICK ----------
const raycaster = new THREE.Raycaster();
const canvasEl = $("scene");
let dragging = false, moved = 0, last = [0, 0], hovered = null;

function targets() {                                  // what can be clicked right now
  if (stage === "pickPainting") return paintings.filter((p) => p !== easelPainting);
  if (stage === "pickTool") return tools;
  return [];
}
function pick(e) {
  const r = canvasEl.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(targets(), true)[0];
  let o = hit && hit.object;
  while (o && !(o.userData && o.userData.type)) o = o.parent;
  return o || null;
}
function hover(obj) {                                 // a warm glow on whatever the pointer is over
  if (hovered === obj) return;
  const glow = (o, on) => o && o.traverse((m) => { if (m.isMesh && m.material.emissive) { m.material.emissive.setHex(on ? ORG : 0x000000); m.material.emissiveIntensity = on ? 0.35 : 0; } });
  glow(hovered, false); hovered = obj; glow(obj, true);
  if (stage === "pickPainting" || stage === "pickTool") $("hudText").textContent = obj ? obj.userData.name : hudDefault;   // show the name of what is under the pointer
  canvasEl.style.cursor = obj ? "pointer" : "grab";
}

canvasEl.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; last = [e.clientX, e.clientY]; canvasEl.setPointerCapture(e.pointerId); });
canvasEl.addEventListener("pointermove", (e) => {
  if (dragging) {
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    moved += Math.abs(dx) + Math.abs(dy); last = [e.clientX, e.clientY];
    if (stage === "lab" || stage === "moving") return;
    look.ty = Math.max(-1.3, Math.min(1.3, look.ty - dx * 0.004));
    look.tp = Math.max(-0.45, Math.min(0.45, look.tp - dy * 0.003));
  } else hover(pick(e));
});
canvasEl.addEventListener("pointerup", (e) => {
  dragging = false;
  if (moved > 6) return;                              // it was a drag, not a click
  const o = pick(e);
  if (!o) return;
  if (o.userData.type === "painting" && stage === "pickPainting") choosePainting(o);
  else if (o.userData.type === "tool" && stage === "pickTool") chooseTool(o);
});

// ---------- 9. THE LOOP ----------
const clock = new THREE.Clock();

// Keeps the game smooth on weaker devices: if frames take too long, draw at a slightly lower resolution
let frameCount = 0, frameTime = 0;
function adaptQuality(seconds) {
  frameCount++; frameTime += seconds;
  if (frameCount < 45) return;
  const average = frameTime / frameCount;
  frameCount = 0; frameTime = 0;
  if (average > 0.035 && pixelRatio > 0.55) pixelRatio = Math.max(0.55, pixelRatio - 0.2);
  else if (average < 0.018 && pixelRatio < maxPixelRatio) pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.1);
  else return;
  renderer.setPixelRatio(pixelRatio);
  resize();
}
function frame() {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05);
  adaptQuality(raw);
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    t.t += dt;
    const k = Math.min(1, t.t / t.duration);
    t.update(ease(k));
    if (k >= 1) { tweens.splice(i, 1); if (t.done) t.done(); }
  }
  if (stage === "lab" || stage === "moving") { look.ty = 0; look.tp = 0; }
  look.yaw += (look.ty - look.yaw) * 0.12; look.pitch += (look.tp - look.pitch) * 0.12;
  camera.position.copy(view.pos);
  camera.lookAt(view.tgt);
  camera.rotateY(look.yaw); camera.rotateX(look.pitch);

  if (stage === "lab" && liveTexture) {               // mirror the lab on the painting: pixels and the glowing frame
    liveTexture.needsUpdate = true;
    const f = Lab.frame, d = easelPainting.userData;
    kernelFrame.visible = !f.hidden;
    if (!f.hidden) {
      const L = parseFloat(f.style.left), T = parseFloat(f.style.top), W = parseFloat(f.style.width), H = parseFloat(f.style.height);
      kernelFrame.position.set(((L + W / 2) / 100 - 0.5) * d.w, (0.5 - (T + H / 2) / 100) * d.h, 0.05);
      kernelFrame.scale.set((W / 100) * d.w, (H / 100) * d.h, 1);
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

window.__game = { renderer, view, scene, camera, paintings, tools, choosePainting, chooseTool, get stage() { return stage; } };  // handy for testing