// js/game.js
// The 3D workshop. The learner is the painter: first-person view, drag to look around.
// Flow: title -> pick a painting (it moves to the easel) -> pick a tool (it goes into the hand)
//       -> the lab opens (lab.js) and the convolution plays on the painting itself.
// Needs: Patterns (data.js) and Lab (lab.js), which are loaded before this module.

import * as THREE from "../vendor/three.module.min.js";

const $ = (id) => document.getElementById(id);
const TILE = 20;                                   // pixels per tile in the painting textures
const INK = 0x1f090b, BRN = 0x571c0a, ORG = 0xea7720, SLATE = 0x436066, CREAM = 0xf5d4a8;

// ---------- 1. RENDERER, SCENE, CAMERA ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $("scene"), antialias: true });
} catch (error) {
  $("noGL").hidden = false;            // no WebGL: point to the simple version
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // richer contrast, no more washed-out colours
renderer.toneMappingExposure = 0.95;

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

// ---------- 2. SMALL HELPERS ----------
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });

// A texture drawn with the 2D canvas API
function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// ---------- 2b. REALISM HELPERS ----------
function rand(seed) {                                 // small seeded random: same result on every reload
  let s = Math.floor(Math.abs(seed)) % 2147483647; if (s === 0) s = 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Re-maps a box's UVs so a texture keeps its REAL size on every face (no stretching),
// with the grain running along the longest side of each face.
function worldUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x, -x, +y, -y, +z, -z
  faces.forEach(([fw, fh], f) => {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      let u = (uv.getX(k) * fw) / tile, v = (uv.getY(k) * fh) / tile;
      if (fh > fw) [u, v] = [v, u];
      uv.setXY(k, u, v);
    }
  });
  uv.needsUpdate = true;
}

function woodGrainTexture(base, seed = 1) {           // long, slightly wavy grain lines, light and dark
  const R = rand(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      const x = R() * w, y = R() * h, len = 60 + R() * 196;
      const w1 = (R() - 0.5) * 7, w2 = (R() - 0.5) * 7, w3 = (R() - 0.5) * 7;
      g.strokeStyle = R() < 0.55 ? `rgba(35,18,6,${0.05 + R() * 0.1})` : `rgba(255,225,170,${0.04 + R() * 0.07})`;
      g.lineWidth = 0.6 + R() * 1.8;
      for (const ox of [0, -w]) for (const oy of [-h, 0, h]) {   // drawn 6 times so the tile repeats without a seam
        g.beginPath(); g.moveTo(x + ox, y + oy);
        g.bezierCurveTo(x + len * 0.3 + ox, y + w1 + oy, x + len * 0.7 + ox, y + w2 + oy, x + len + ox, y + w3 + oy);
        g.stroke();
      }
    }
  }, [1, 1]);
}

function plasterTexture() {                           // soft mottled patches + fine grain, like old plaster
  const R = rand(21);
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = R() * w, y = R() * h, r = 20 + R() * 70, dark = R() < 0.6;
      const c = dark ? "120,90,55" : "255,250,235", a = dark ? 0.07 : 0.1;
      for (const ox of [0, -w, w]) for (const oy of [0, -h, h]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(90,60,30,${R() * 0.12})`; g.fillRect(R() * w, R() * h, 1.5, 1.5); }
  }, [0.5, 0.5]);
}

// fake "ambient occlusion": a soft dark blob on the floor under furniture, so nothing floats
const aoTex = canvasTexture(128, 128, (g, w, h) => { 
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgba(0,0,0,.6)"); r.addColorStop(0.55, "rgba(0,0,0,.28)"); r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
function contact(x, z, w, d, ry = 0, opacity = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
    map: aoTex, transparent: true, depthWrite: false, opacity, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = ry; m.position.set(x, 0.02, z); m.renderOrder = 1;
  scene.add(m);
}

// NEW box(): same as before, but textured materials keep their real size
function box(w, h, d, material, x, y, z, parent = scene) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (material.userData.tile) worldUV(geo, w, h, d, material.userData.tile);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// ---------- 3. THE STUDIO: a tall, bright artist's workshop ----------
const EH = 3.3, RH = 6.4, Z_BACK = -5, Z_FRONT = 4.5, Z_MID = (Z_BACK + Z_FRONT) / 2;
const paleWood = std(0xffffff, { map: woodGrainTexture("#d9bd92", 7), roughness: 0.75 });
const beam     = std(0xffffff, { map: woodGrainTexture("#33474c", 5), roughness: 0.7 });
const wood     = std(0xffffff, { map: woodGrainTexture("#8a5a33", 3), roughness: 0.7 });
paleWood.userData.tile = 1.2; beam.userData.tile = 1.2; wood.userData.tile = 0.9;   // texture size in metres
const dark = std(BRN);

const plasterMap = plasterTexture();
const plaster = std(0xf1e1c4, { map: plasterMap, roughness: 1, side: THREE.DoubleSide });
const sideMap = plasterMap.clone(); sideMap.repeat.set(4.75, 1.65); sideMap.needsUpdate = true;
const plasterSide = std(0xf1e1c4, { map: sideMap, roughness: 1, side: THREE.DoubleSide });
scene.background = new THREE.Color(0xbfd8d2);

const cyl = (r1, r2, h, mat, x, y, z, parent = scene, seg = 16) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
};
const sph = (r, mat, x, y, z, parent = scene) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
};

// light wooden floor + the real Persian rug
const woodTex = canvasTexture(1024, 1024, (g, w, h) => {
  const R = rand(11), n = 12, pw = w / n;
  for (let i = 0; i < n; i++) {
    const x0 = i * pw, tone = 0.86 + R() * 0.26;
    g.fillStyle = `rgb(${Math.round(206 * tone)},${Math.round(160 * tone)},${Math.round(110 * tone)})`;
    g.fillRect(x0, 0, pw, h);
    for (let k = 0; k < 55; k++) {                                   // grain
      const gx = x0 + 4 + R() * (pw - 8);
      g.strokeStyle = R() < 0.6 ? `rgba(70,38,12,${0.05 + R() * 0.12})` : `rgba(255,232,190,${0.04 + R() * 0.08})`;
      g.lineWidth = 0.5 + R() * 1.6;
      g.beginPath(); g.moveTo(gx, 0);
      g.bezierCurveTo(gx + (R() - 0.5) * 12, h * 0.3, gx + (R() - 0.5) * 12, h * 0.65, gx, h); g.stroke();
    }
    if (R() < 0.5) {                                                 // a knot
      const kx = x0 + pw / 2 + (R() - 0.5) * 20, ky = R() * h;
      for (let r = 3; r < 14; r += 3) {
        g.strokeStyle = `rgba(60,30,10,${0.3 - r * 0.015})`; g.lineWidth = 1.2;
        g.beginPath(); g.ellipse(kx, ky, r * 0.8, r * 1.8, 0, 0, 7); g.stroke();
      }
    }
    g.fillStyle = "rgba(25,12,4,.5)"; g.fillRect(x0, R() * h, pw, 2.5);   // end joint
    g.fillStyle = "rgba(25,12,4,.55)"; g.fillRect(x0, 0, 2.5, h);         // gap between planks
    g.fillStyle = "rgba(255,240,210,.12)"; g.fillRect(x0 + 2.5, 0, 1.5, h);
  }
}, [6, 5]);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 9.5), std(0xffffff, { map: woodTex }));
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, Z_MID); floor.receiveShadow = true; scene.add(floor);
new THREE.TextureLoader().load("assets/rug.jpg", (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  const r = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.9), std(0xffffff, { map: t, roughness: 1 }));
  r.rotation.x = -Math.PI / 2; r.rotation.z = Math.PI / 2; r.position.set(0.3, 0.012, 0.9); r.receiveShadow = true; scene.add(r);
});

// gable walls (the back one has the big window), side walls, and the timber roof
function gableWall(z, hole) {
  const s = new THREE.Shape();
  s.moveTo(-6, 0); s.lineTo(6, 0); s.lineTo(6, EH); s.lineTo(0, RH); s.lineTo(-6, EH); s.closePath();
  const h = new THREE.Path(); hole.forEach(([x, y], i) => (i ? h.lineTo(x, y) : h.moveTo(x, y))); h.closePath(); s.holes.push(h);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), plaster);
  m.position.z = z; m.castShadow = true; m.receiveShadow = true; scene.add(m);
}
gableWall(Z_BACK, [[-1.9, 0.9], [1.9, 0.9], [1.9, 4.4], [0, 5.5], [-1.9, 4.4]]);
gableWall(Z_FRONT, [[-0.9, 0], [0.9, 0], [0.9, 2.3], [-0.9, 2.3]]);
[[-6, Math.PI / 2], [6, -Math.PI / 2]].forEach(([x, ry]) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Z_FRONT - Z_BACK, EH), plasterSide);
  m.position.set(x, EH / 2, Z_MID); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = true; scene.add(m);
});
const ang = Math.atan2(RH - EH, 6), slope = Math.hypot(6, RH - EH), roofY = (EH + RH) / 2;
[-1, 1].forEach((s) => {
  const slab = box(slope + 0.2, 0.12, Z_FRONT - Z_BACK + 0.3, paleWood, s * 3, roofY, Z_MID); slab.rotation.z = -s * ang;
  for (let z = -4.6; z <= 4.2; z += 1.4) { const r = box(slope + 0.3, 0.22, 0.14, beam, s * 3, roofY - 0.14, z); r.rotation.z = -s * ang; }
});
for (let z = -4.6; z <= 4.2; z += 1.4) box(12, 0.18, 0.14, beam, 0, EH + 0.2, z);          // tie beams
box(0.2, 0.2, Z_FRONT - Z_BACK + 0.3, beam, 0, RH - 0.1, Z_MID);                            // ridge beam

// the woven strip along the lower walls
const stripTex = canvasTexture(144, 36, (g, w, h) => {
  g.fillStyle = "#571c0a"; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 36) {
    g.fillStyle = "#ea7720"; g.beginPath(); g.moveTo(x + 18, 4); g.lineTo(x + 28, 18); g.lineTo(x + 18, 32); g.lineTo(x + 8, 18); g.fill();
    g.fillStyle = "#436066"; g.fillRect(x, 15, 5, 6);
  }
}, [1, 1]);
function trim(len, x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(len, 0.9, 0.06, dark, 0, 0.45, 0.03, g);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.12), std(0xffffff, { map: stripTex })); strip.position.set(0, 0.96, 0.065); g.add(strip);
  scene.add(g);
}
trim(12, 0, Z_BACK, 0); trim(9.5, -6, Z_MID, Math.PI / 2); trim(9.5, 6, Z_MID, -Math.PI / 2);

// the big window: slate-blue frame with mullions, and a forest outside
[-1.9, -0.95, 0.95, 1.9].forEach((x) => box(0.07, 3.5, 0.12, beam, x, 2.65, Z_BACK + 0.04));
box(0.07, 4.6, 0.12, beam, 0, 3.2, Z_BACK + 0.04);
[0.9, 2.05, 3.2].forEach((y) => box(3.8, 0.07, 0.12, beam, 0, y, Z_BACK + 0.04));
box(4.3, 0.1, 0.32, beam, 0, 0.88, Z_BACK + 0.1);
[[-1, 0.52], [1, -0.52]].forEach(([s, a]) => { const b = box(0.07, 2.2, 0.12, beam, s * 0.95, 4.95, Z_BACK + 0.04); b.rotation.z = a; });
const forest = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshBasicMaterial({ fog: false, map: canvasTexture(512, 256, (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#cfe6ee"); sky.addColorStop(1, "#f3ecd0");
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(${40 + (i * 7) % 40},${90 + (i * 13) % 60},${50 + (i * 5) % 30},.55)`;
    g.beginPath(); g.arc((i * 83) % w, h * 0.45 + ((i * 37) % (h * 0.55)), 18 + (i % 5) * 9, 0, 7); g.fill();
  }
}) }));
forest.position.set(0, 6, -13); scene.add(forest);

// light: warm sun through the window (it casts the shadows of the frame on the floor), soft fill, warm lamps
scene.add(new THREE.HemisphereLight(0xfff0d6, 0x6a4a30, 0.75));
const sun = new THREE.DirectionalLight(0xffdca0, 3.2);
sun.position.set(1.5, 6.5, -11); sun.target.position.set(0, 0, -1);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 7, bottom: -7, near: 1, far: 30 });
scene.add(sun, sun.target);
const lamp = new THREE.PointLight(0xffb468, 16, 9, 2); lamp.position.set(3.1, 2.7, -2.0); scene.add(lamp);

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
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 5.2), new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, opacity: 0.2 - i * 0.02, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    p.rotation.y = ry; shaft.add(p);
  });
  shaft.rotation.x = -1.0; shaft.position.set(dx * 0.9, 1.5, -3.0); scene.add(shaft);
});

// ---------- 4. PROPS: the things that make it a workshop ----------
const mat = (c, o) => std(c, o);
// ---------- REAL LEAVES AND PLANTS ----------
function leafTexture() {                              // dark base -> light tip, pale midrib and side veins
  return canvasTexture(64, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, "#2b5a2a"); gr.addColorStop(0.6, "#4f8a3a"); gr.addColorStop(1, "#7fb04c");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(220,240,170,.55)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 4); g.stroke();
    g.strokeStyle = "rgba(20,50,20,.30)"; g.lineWidth = 1;
    for (let y = 14; y < h; y += 12) {
      g.beginPath();
      g.moveTo(w / 2, y + 10); g.lineTo(4, y - 4);
      g.moveTo(w / 2, y + 10); g.lineTo(w - 4, y - 4);
      g.stroke();
    }
  });
}
function leafGeo(len, wid, droop) {                   // a curved, pointed leaf (not a ball)
  const g = new THREE.PlaneGeometry(1, 1, 4, 8), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
    const half = (Math.sin(Math.PI * Math.pow(v, 0.7)) * wid) / 2;          // widest near the base, pointed tip
    p.setXYZ(i, (u - 0.5) * 2 * half, v * len, droop * v * v * len - Math.abs(u - 0.5) * wid * 0.35);
  }
  g.computeVertexNormals();
  return g;
}
const leafMap = leafTexture();
const leafMats = [0xffffff, 0xd6f0b8, 0xb9d9a0].map((c) => std(c, { map: leafMap, side: THREE.DoubleSide, roughness: 0.55 }));

function plant(x, z, s = 1, pot = 0xb5683a) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  const potMat = mat(pot, { roughness: 0.8 });
  cyl(0.15, 0.1, 0.26, potMat, 0, 0.13, 0, g, 24);                           // pot
  cyl(0.17, 0.17, 0.04, potMat, 0, 0.28, 0, g, 24);                          // rim
  cyl(0.145, 0.145, 0.012, mat(0x3a2415, { roughness: 1 }), 0, 0.296, 0, g, 24);   // soil
  const R = rand(x * 97 + z * 31 + 3), n = 15;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.5, up = i % 3 === 0;           // every 3rd leaf stands more upright
    const len = (up ? 0.5 : 0.38) + R() * 0.28;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 0.025, 0.3, Math.sin(a) * 0.025);
    pivot.rotation.y = Math.PI / 2 - a;                                       // which way the leaf points
    const leaf = new THREE.Mesh(leafGeo(len, 0.15 + R() * 0.07, 0.25 + R() * 0.45), leafMats[i % 3]);
    leaf.rotation.x = up ? 0.15 + R() * 0.2 : 0.55 + R() * 0.55;              // how far it leans out
    leaf.castShadow = true; leaf.receiveShadow = true;
    pivot.add(leaf); g.add(pivot);
  }
  contact(x, z, 0.55 * s, 0.55 * s);                                          // shadow under the pot
}
function ladder(x, z, ry, lean) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const inner = new THREE.Group(); inner.rotation.x = -lean; g.add(inner);
  box(0.05, 2.7, 0.04, wood, -0.22, 1.35, 0, inner); box(0.05, 2.7, 0.04, wood, 0.22, 1.35, 0, inner);
  for (let i = 0; i < 7; i++) box(0.44, 0.035, 0.04, wood, 0, 0.35 + i * 0.36, 0, inner);
  scene.add(g);
}
function books(x, y, z, n = 4) { const c = [0xc23b3b, 0x436066, 0xeeb04a, 0x2a8fa8, 0xea7720]; for (let i = 0; i < n; i++) box(0.26 - i * 0.01, 0.045, 0.19, mat(c[i % 5]), x, y + 0.0225 + i * 0.045, z).rotation.y = i * 0.25; }
function brushes(x, y, z) {
  cyl(0.05, 0.045, 0.13, mat(0xcfc2a8), x, y + 0.065, z);
  for (let i = 0; i < 6; i++) { const b = cyl(0.006, 0.006, 0.26, mat(0x6b3f1e), x + (i % 3 - 1) * 0.02, y + 0.2, z + (i % 2 - 0.5) * 0.03, scene, 6); b.rotation.z = (i - 2.5) * 0.09; }
}
function bowls(x, y, z, n = 3) { for (let i = 0; i < n; i++) cyl(0.12 - i * 0.012, 0.07, 0.045, mat(i % 2 ? 0xe8dcc4 : 0xb5683a), x, y + 0.0225 + i * 0.045, z); }
function jar(x, y, z, c) { cyl(0.045, 0.045, 0.11, mat(c, { roughness: 0.4 }), x, y + 0.055, z); }
function stool(x, z) { cyl(0.18, 0.18, 0.04, wood, x, 0.62, z); [0, 2.1, 4.2].forEach((a) => box(0.035, 0.62, 0.035, wood, x + Math.cos(a) * 0.13, 0.31, z + Math.sin(a) * 0.13)); }
function tableAt(x, z, w, d, h) {
  box(w, 0.06, d, wood, x, h, z);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => box(0.07, h, 0.07, wood, x + a * (w / 2 - 0.07), h / 2, z + b * (d / 2 - 0.07)));
}

function sofa(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(1.9, 0.22, 0.85, wood, 0, 0.3, 0, g); [-0.8, 0.8].forEach((a) => [-0.35, 0.35].forEach((b) => box(0.06, 0.2, 0.06, wood, a, 0.1, b, g)));
  box(1.8, 0.22, 0.8, mat(0x8fa593, { roughness: 1 }), 0, 0.5, 0, g); box(1.8, 0.4, 0.18, mat(0x7d9484, { roughness: 1 }), 0, 0.78, -0.33, g);
  box(0.4, 0.4, 0.12, mat(0xea7720, { roughness: 1 }), -0.55, 0.78, -0.18, g).rotation.x = -0.2;
  box(0.4, 0.4, 0.12, mat(0x436066, { roughness: 1 }), 0.5, 0.78, -0.18, g).rotation.x = -0.2;
  scene.add(g);
}
function cabinet(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(1.4, 0.85, 0.9, mat(0xc9ae86), 0, 0.425, 0, g);
  for (let i = 0; i < 5; i++) { box(1.3, 0.13, 0.02, mat(0xa98a62), 0, 0.12 + i * 0.16, 0.46, g); box(0.18, 0.02, 0.03, mat(0x2c3e42), 0, 0.12 + i * 0.16, 0.48, g); }
  scene.add(g); return g;
}
function floorLamp(x, z) {
  cyl(0.15, 0.15, 0.03, mat(0x2c3e42), x, 0.015, z); cyl(0.015, 0.015, 1.5, mat(0x2c3e42), x, 0.78, z);
  const shade = cyl(0.12, 0.2, 0.28, mat(0xf5d4a8, { emissive: 0xf5d4a8, emissiveIntensity: 0.9 }), x, 1.65, z, scene, 20); shade.castShadow = false;
  const l = new THREE.PointLight(0xffc880, 5, 6, 2); l.position.set(x, 1.6, z); scene.add(l);
}
function smallFrame(x, y, z, ry, w, h, seed) {          // decorative studies on the wall (not clickable)
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  box(w + 0.08, h + 0.08, 0.04, mat(0x3a2013), 0, 0, 0, g);
  const cols = ["#ea7720", "#436066", "#f5d4a8", "#c23b3b", "#2a8fa8", "#eeb04a", "#571c0a"];
  const tex = canvasTexture(64, 64, (c) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { c.fillStyle = cols[(i * 3 + j * 5 + seed * (i % 3) + ((i * j) % 4)) % 7]; c.fillRect(i * 4, j * 4, 4, 4); } });
  tex.magFilter = THREE.NearestFilter;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(0xffffff, { map: tex })); p.position.z = 0.025; g.add(p); scene.add(g);
}

// ================= 4b. REALISTIC TOOLS AND THE ARTISAN'S HAND =================

// A rounded tube between two points (fingers, rods, shanks)
function limb(a, b, r, material, parent) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), len = dir.length();
  if (len < 1e-6) return null;
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
// A tapered tube between two points (forearm, sleeve)
function tube(a, b, r1, r2, material, parent) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, dir.length(), 24), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m); return m;
}

// A tiny fake "studio" reflected in the metal, so steel does not look black
let metalEnvMap = null;
function metalEnv() {
  if (metalEnvMap) return metalEnvMap;
  const s = new THREE.Scene();
  const sky = canvasTexture(256, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#fff6e2"); gr.addColorStop(0.5, "#c9d6d2"); gr.addColorStop(1, "#4a3a2a");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,.95)"; g.fillRect(40, 18, 60, 30); g.fillRect(170, 22, 40, 26);   // bright window-like patches
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  metalEnvMap = pm.fromScene(s).texture;
  pm.dispose();
  return metalEnvMap;
}
const steelMat = (o = {}) => std(0xaab3b8, { metalness: 0.9, roughness: 0.3, envMap: metalEnv(), envMapIntensity: 0.9, ...o });

// ---------- THE SPONGE: rounded, lumpy, full of pores ----------
function spongeMaps() {
  const R = rand(5), pores = [];
  for (let i = 0; i < 150; i++) pores.push([R() * 256, R() * 256, 3 + R() * 9]);
  const color = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#e4b95a"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {                                    // soft light and dark patches
      const x = R() * w, y = R() * h, r = 20 + R() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, R() < 0.5 ? "rgba(140,90,20,.22)" : "rgba(255,228,140,.28)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    pores.forEach(([x, y, r]) => {                                    // the holes: dark inside, pale rim
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(70,40,5,.85)"); gr.addColorStop(0.7, "rgba(110,70,15,.55)"); gr.addColorStop(1, "rgba(255,235,170,.35)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    });
  }, [1, 1]);
  const bump = canvasTexture(256, 256, (g, w, h) => {               // same holes as a height map (dark = deep)
    g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, w, h);
    pores.forEach(([x, y, r]) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "#000000"); gr.addColorStop(0.75, "#707070"); gr.addColorStop(1, "#c8c8c8");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    });
  }, [1, 1]);
  bump.colorSpace = THREE.NoColorSpace;
  return { color, bump };
}
function buildSponge(g) {
  const W = 0.24, H = 0.1, D = 0.17, rad = 0.03, tile = 0.2;
  const geo = new THREE.BoxGeometry(W, H, D, 16, 8, 12);
  const p = geo.attributes.position, nr = geo.attributes.normal, uv = geo.attributes.uv, R = rand(9);
  const ph = [R() * 6, R() * 6, R() * 6, R() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i));
    if (ax > ay && ax > az) uv.setXY(i, z / tile, y / tile); else if (ay > az) uv.setXY(i, x / tile, z / tile); else uv.setXY(i, x / tile, y / tile);
    const cx = Math.max(-(W / 2 - rad), Math.min(W / 2 - rad, x));          // round every edge and corner
    const cy = Math.max(-(H / 2 - rad), Math.min(H / 2 - rad, y));
    const cz = Math.max(-(D / 2 - rad), Math.min(D / 2 - rad, z));
    let dx = x - cx, dy = y - cy, dz = z - cz; const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const lump = 0.0035 * Math.sin(x * 38 + ph[0]) * Math.sin(y * 41 + ph[1]) * Math.sin(z * 35 + ph[2]) + 0.004 * Math.sin(x * 17 + ph[3]) * Math.cos(z * 14 + ph[0]);
    p.setXYZ(i, cx + dx * (rad + lump), cy + dy * (rad + lump), cz + dz * (rad + lump));
    nr.setXYZ(i, dx, dy, dz);
  }
  p.needsUpdate = true; nr.needsUpdate = true; uv.needsUpdate = true;
  const { color, bump } = spongeMaps();
  const body = new THREE.Mesh(geo, std(0xffffff, { map: color, bumpMap: bump, bumpScale: 1.5, roughness: 1 }));
  body.position.y = 0.055; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const water = std(0xcfe9f2, { roughness: 0.05, transparent: true, opacity: 0.55 });   // a few water drops on top
  [[-0.06, 0.04], [0.02, -0.03], [0.07, 0.05], [-0.02, 0.06]].forEach(([x, z], i) => {
    const d = sph(0.008 + 0.002 * (i % 2), water, x, 0.106, z, g); d.scale.set(1, 0.55, 1); d.castShadow = false;
  });
}

// ---------- THE PALETTE KNIFE: turned wooden handle, steel crank, trowel blade ----------
function buildKnife(g) {
  const grain = woodGrainTexture("#7d4a22", 12); grain.rotation = Math.PI / 2; grain.center.set(0.5, 0.5);
  const handleMat = std(0xffffff, { map: grain, roughness: 0.5 }), steel = steelMat();
  const Y0 = 0.031;                                                    // height of the handle's axis above the table
  const prof = new THREE.SplineCurve([[0, 0], [0.011, 0.004], [0.017, 0.02], [0.0205, 0.05], [0.0195, 0.075], [0.0155, 0.105], [0.0115, 0.13], [0.0105, 0.14]]
    .map(([r, h]) => new THREE.Vector2(r, h))).getPoints(30);
  const hg = new THREE.LatheGeometry(prof, 28); hg.rotateZ(-Math.PI / 2); hg.translate(-0.17, 0, 0);
  const handle = new THREE.Mesh(hg, handleMat); handle.position.y = Y0; handle.castShadow = true; handle.receiveShadow = true; g.add(handle);
  cyl(0.0108, 0.0098, 0.032, steel, -0.016, Y0, 0, g, 20).rotation.z = Math.PI / 2;          // ferrule
  cyl(0.0128, 0.0128, 0.006, steel, -0.031, Y0, 0, g, 20).rotation.z = Math.PI / 2;          // collar
  limb([0, Y0, 0], [0.034, Y0, 0], 0.0034, steel, g);                                         // cranked shank: straight, then a step down
  limb([0.034, Y0, 0], [0.062, Y0 - 0.0185, 0], 0.0034, steel, g);
  const L = 0.115, n = 28, top = [], bot = [];                                                // trowel-shaped blade, pointed at the tip
  for (let i = 0; i <= n; i++) { const t = i / n, half = 0.0035 * (1 - t) + 0.0245 * Math.sin(Math.PI * Math.pow(t, 0.6)); top.push([L * t, half]); bot.push([L * t, -half]); }
  const sh = new THREE.Shape(); sh.moveTo(top[0][0], top[0][1]);
  top.forEach(([x, y]) => sh.lineTo(x, y)); bot.reverse().slice(1).forEach(([x, y]) => sh.lineTo(x, y));
  const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.0016, bevelEnabled: false }); bg.rotateX(-Math.PI / 2);   // lay it flat
  const blade = new THREE.Mesh(bg, steel); blade.position.set(0.058, Y0 - 0.0185, 0); blade.castShadow = true; blade.receiveShadow = true; g.add(blade);
  const smear = sph(0.012, std(ORG, { roughness: 0.35 }), 0.145, Y0 - 0.0185 + 0.002, 0.004, g);   // a smear of orange paint on the blade
  smear.scale.set(1.3, 0.12, 0.8); smear.castShadow = false;
  g.rotation.y = 0.5;
}

// ---------- THE CHALK: crumbly stick, paper wrapper with a torn edge ----------
function buildChalk(g) {
  const R = rand(31);
  const stickTex = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = "#efe9db"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { c.fillStyle = R() < 0.5 ? `rgba(150,145,130,${R() * 0.25})` : `rgba(255,255,250,${R() * 0.5})`; c.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); }
    for (let i = 0; i < 12; i++) { c.fillStyle = `rgba(120,115,100,${0.05 + R() * 0.07})`; c.fillRect(R() * w, 0, 1.5, h); }
  }, [1, 1]);
  const prof = [[0, 0], [0.012, 0.0008], [0.0215, 0.006], [0.0238, 0.02], [0.0238, 0.17], [0.0225, 0.184], [0.0165, 0.1895], [0, 0.19]].map(([r, h]) => new THREE.Vector2(r, h));
  const sg = new THREE.LatheGeometry(prof, 28), sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) {                                 // crumbly, slightly uneven surface
    const x = sp.getX(i), z = sp.getZ(i), r = Math.hypot(x, z);
    if (r > 0.001) { const k = 1 + 0.035 * Math.sin(sp.getY(i) * 90 + Math.atan2(z, x) * 5) + 0.02 * (R() - 0.5); sp.setX(i, x * k); sp.setZ(i, z * k); }
  }
  sg.computeVertexNormals(); sg.rotateZ(-Math.PI / 2); sg.translate(-0.095, 0, 0);
  const stick = new THREE.Mesh(sg, std(0xffffff, { map: stickTex, roughness: 1 }));
  stick.position.y = 0.0338; stick.castShadow = true; stick.receiveShadow = true; g.add(stick);
  const wrapTex = canvasTexture(128, 64, (c, w, h) => {
    c.fillStyle = "#ea7720"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#f5d4a8"; c.fillRect(0, 6, w, 3); c.fillRect(0, h - 9, w, 3);
    for (let x = 8; x < w; x += 16) { c.beginPath(); c.moveTo(x, h / 2 - 9); c.lineTo(x + 7, h / 2); c.lineTo(x, h / 2 + 9); c.lineTo(x - 7, h / 2); c.fill(); }
  }, [1, 1]);
  const wg = new THREE.CylinderGeometry(0.0246, 0.0246, 0.085, 28, 1, true), wp = wg.attributes.position;
  for (let i = 0; i <= 28; i++) wp.setY(i, wp.getY(i) + (R() - 0.2) * 0.012);                 // torn upper edge
  wg.rotateZ(-Math.PI / 2);
  const wrap = new THREE.Mesh(wg, std(0xffffff, { map: wrapTex, roughness: 0.9, side: THREE.DoubleSide }));
  wrap.position.set(-0.052, 0.0338, 0); wrap.castShadow = true; g.add(wrap);
  g.rotation.y = -0.4;
}

// ---------- THE ARTISAN'S HAND ----------
// grip.at = [x, y, z] where the hand holds the tool (tool space), grip.r = how thick the tool is there, grip.yaw = turn of the hand
function makeHand(grip) {
  const holder = new THREE.Group(), h = new THREE.Group(); holder.add(h);
  holder.position.set(...grip.at); holder.rotation.y = grip.yaw || 0;
  const skin = std(0xd9a578, { roughness: 0.62 }), sleeve = std(0x436066, { roughness: 1 }), cuff = std(0xf5d4a8, { roughness: 0.9 });
  const R = grip.r + 0.013;                                            // fingers follow a circle of this radius around the tool
  const P = (dx, a) => [dx, R * Math.cos(a), -R * Math.sin(a)];       // a = 0: over the top, a > 0: down the far side, a < 0: down the near side
  const palm = sph(0.047, skin, 0, R + 0.004, 0.032, h); palm.scale.set(0.95, 0.36, 1.05);
  [[-0.031, 0.088, 0.0118], [-0.0105, 0.097, 0.0122], [0.0105, 0.09, 0.0116], [0.031, 0.072, 0.0104]].forEach(([dx, len, r]) => {
    const a1 = (len * 0.42) / R, a2 = (len * 0.74) / R, a3 = len / R;
    sph(r * 1.12, skin, dx, R, -0.004, h);                             // knuckle
    limb(P(dx, 0), P(dx, a1), r, skin, h); limb(P(dx, a1), P(dx, a2), r * 0.94, skin, h); limb(P(dx, a2), P(dx, a3), r * 0.86, skin, h);
  });
  const tl = 0.075 / R;                                                // thumb, on the near side
  limb(P(-0.05, -0.4), P(-0.044, -(0.4 + 0.45 * tl)), 0.0135, skin, h);
  limb(P(-0.044, -(0.4 + 0.45 * tl)), P(-0.036, -(0.4 + tl)), 0.0122, skin, h);
  const dir = new THREE.Vector3(0, -0.4, 1).normalize();               // the arm leaves backwards (towards the painter) and a little down
  const W = [0, R + 0.002, 0.07], E = dir.clone().multiplyScalar(0.16).add(new THREE.Vector3(...W)), E2 = dir.clone().multiplyScalar(0.19).add(new THREE.Vector3(...W)), S = dir.clone().multiplyScalar(0.7).add(new THREE.Vector3(...W));
  tube(W, E.toArray(), 0.027, 0.034, skin, h);                          // wrist and forearm
  tube(E.toArray(), E2.toArray(), 0.05, 0.05, cuff, h);                 // cream cuff
  tube(E2.toArray(), S.toArray(), 0.05, 0.066, sleeve, h);              // slate-blue sleeve (same colours as the palette)
  h.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.raycast = () => {}; } });   // never blocks clicks
  holder.userData.rest = holder.position.clone();
  holder.userData.away = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), grip.yaw || 0).multiplyScalar(0.5);
  return holder;
}
function showHand(t) {                                                // the hand slides in from the painter's side
  const h = t.userData.hand; if (!h) return;
  h.visible = true; h.position.copy(h.userData.rest).add(h.userData.away);   // start off-screen straight away
  tween(0.9, (k) => h.position.copy(h.userData.rest).addScaledVector(h.userData.away, 1 - k));
}
function hideHand(t) {
  const h = t.userData.hand; if (!h) return;
  tween(0.35, (k) => h.position.copy(h.userData.rest).addScaledVector(h.userData.away, k), () => { h.visible = false; });
}


// ================= 4c. SHELF AND TABLE DECOR =================
const BOOKCOL = [0xc23b3b, 0x436066, 0xeeb04a, 0x2a8fa8, 0xea7720, 0x7a4a2a, 0x8fa593, 0x571c0a, 0xf5d4a8];

// standing books with a paper label and a gold band on each spine; returns where the row ended
function bookRow(parent, x0, x1, y, seed) {
  const R = rand(seed); let x = x0;
  while (x < x1 - 0.05) {
    const t = 0.022 + R() * 0.03, h = 0.17 + R() * 0.1, d = 0.2 + R() * 0.06;
    box(t, h, d, mat(BOOKCOL[Math.floor(R() * BOOKCOL.length)], { roughness: 0.85 }), x + t / 2, y + h / 2, -0.01, parent);
    box(t + 0.002, 0.03, 0.004, mat(0xf5d4a8, { roughness: 1 }), x + t / 2, y + h * 0.72, d / 2 - 0.008, parent).castShadow = false;
    box(t + 0.002, 0.007, 0.004, mat(0xeeb04a, { roughness: 0.4 }), x + t / 2, y + h * 0.3, d / 2 - 0.008, parent).castShadow = false;
    x += t + 0.002;
    if (R() < 0.12 && x < x1 - 0.15) x += 0.05;
  }
  return x;
}

// a glazed ceramic vase (3 shapes), optionally with dried grass
function vase(parent, x, y, z, kind, color, s = 1, grass = false) {
  const profiles = [
    [[0, 0], [0.04, 0], [0.06, 0.05], [0.07, 0.11], [0.05, 0.19], [0.03, 0.24], [0.034, 0.27], [0.042, 0.285]],
    [[0, 0], [0.035, 0], [0.04, 0.05], [0.032, 0.14], [0.02, 0.2], [0.018, 0.27], [0.028, 0.3]],
    [[0, 0], [0.05, 0], [0.075, 0.04], [0.07, 0.09], [0.055, 0.12]]
  ];
  const pts = new THREE.SplineCurve(profiles[kind].map(([r, h]) => new THREE.Vector2(r * s, h * s))).getPoints(28);
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mat(color, { roughness: 0.28, metalness: 0.05, side: THREE.DoubleSide }));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
  if (grass) {
    const top = pts[pts.length - 1].y, R = rand(Math.floor(Math.abs(x * 100 + z * 10)) + 3), stem = mat(0xb89a5a, { roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const a = R() * 6.28, lean = 0.1 + R() * 0.25, h = (0.12 + R() * 0.1) * s;
      const tip = [x + Math.cos(a) * lean * h, y + top + h, z + Math.sin(a) * lean * h];
      limb([x, y + top - 0.02, z], tip, 0.0018, stem, parent);
      const head = sph(0.006, mat(0xd8b46a, { roughness: 1 }), tip[0], tip[1], tip[2], parent); head.scale.set(0.8, 2.2, 0.8);
    }
  }
}

// a glass jar with water and brushes (bristles in colour, metal ferrules, wooden handles)
function brushJar(parent, x, y, z, water = 0x8fb5b0) {
  const glass = std(0xa9cfc8, { roughness: 0.08, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  cyl(0.05, 0.047, 0.12, glass, x, y + 0.06, z, parent, 24).castShadow = false;
  cyl(0.044, 0.042, 0.07, std(water, { roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false }), x, y + 0.04, z, parent, 24).castShadow = false;
  const handle = mat(0x6b3f1e, { roughness: 0.5 }), fer = steelMat({ roughness: 0.35 }), cols = [0xea7720, 0x436066, 0xc23b3b, 0xf5d4a8, 0x2a8fa8, 0xeeb04a];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.283 + 0.4, lean = 0.1 + (i % 3) * 0.05;
    const pv = new THREE.Group(); pv.position.set(x + Math.cos(a) * 0.012, y + 0.02, z + Math.sin(a) * 0.012);
    pv.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean); parent.add(pv);
    limb([0, 0, 0], [0, 0.2, 0], 0.0045, handle, pv);
    cyl(0.0058, 0.0058, 0.035, fer, 0, 0.2175, 0, pv, 10);
    cyl(0.0012, 0.0056, 0.04, mat(cols[i], { roughness: 0.9 }), 0, 0.255, 0, pv, 10);
  }
}

// a small potted plant, same leaves as the big ones
function miniPlant(parent, x, y, z, s = 1, potColor = 0xb5683a) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); parent.add(g);
  const pm = mat(potColor, { roughness: 0.8 });
  cyl(0.06, 0.045, 0.08, pm, 0, 0.04, 0, g, 20); cyl(0.065, 0.065, 0.015, pm, 0, 0.087, 0, g, 20);
  cyl(0.054, 0.054, 0.006, mat(0x3a2415, { roughness: 1 }), 0, 0.094, 0, g, 20);
  const R = rand(Math.floor(Math.abs(x * 100 + y * 50 + z * 10)) + 7);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * 6.283 + R() * 0.6, pv = new THREE.Group();
    pv.position.set(Math.cos(a) * 0.01, 0.095, Math.sin(a) * 0.01); pv.rotation.y = Math.PI / 2 - a;
    const lf = new THREE.Mesh(leafGeo(0.11 + R() * 0.08, 0.06, 0.2 + R() * 0.2), leafMats[i % 3]);
    lf.rotation.x = 0.5 + R() * 0.7; lf.castShadow = true; pv.add(lf); g.add(pv);
  }
}

// a paint tin: steel body, paper label, coloured stripe, paint under the rim
function paintCan(parent, x, y, z, color) {
  const tin = steelMat({ color: 0xb9bec2, roughness: 0.4 });
  cyl(0.055, 0.055, 0.11, tin, x, y + 0.055, z, parent, 28);
  cyl(0.058, 0.058, 0.008, tin, x, y + 0.108, z, parent, 28);
  cyl(0.0556, 0.0556, 0.05, mat(0xf3ead6, { roughness: 0.9 }), x, y + 0.052, z, parent, 28).castShadow = false;
  cyl(0.0559, 0.0559, 0.012, mat(color, { roughness: 0.6 }), x, y + 0.068, z, parent, 28).castShadow = false;
  cyl(0.05, 0.05, 0.004, std(color, { roughness: 0.25 }), x, y + 0.107, z, parent, 28).castShadow = false;
  limb([x + 0.05, y + 0.106, z], [x + 0.054, y + 0.075, z + 0.008], 0.004, std(color, { roughness: 0.3 }), parent);   // a drip
}

// rolled sheets of paper tied with an orange band
function rolledPapers(parent, x, y, z) {
  const paper = mat(0xf3ead6, { roughness: 1 }), band = mat(ORG, { roughness: 0.8 });
  [[0, 0.022, 0, 0], [0.01, 0.022, 0.048, 0.08], [0.0, 0.065, 0.024, -0.05]].forEach(([dx, dy, dz, ry]) => {
    const r = new THREE.Group(); r.position.set(x + dx, y + dy, z + dz); r.rotation.y = ry; parent.add(r);
    const c = cyl(0.022, 0.022, 0.3, paper, 0, 0, 0, r, 20); c.rotation.z = Math.PI / 2;
    [-0.08, 0.08].forEach((bx) => { const b = cyl(0.0235, 0.0235, 0.014, band, bx, 0, 0, r, 20); b.rotation.z = Math.PI / 2; b.castShadow = false; });
  });
}

// tubes of paint lying around (steel body, colour band, crimped end, screw cap)
function paintTubes(parent, x, y, z, n, seed) {
  const R = rand(seed), cols = [0xc23b3b, 0xeeb04a, 0x2a8fa8, 0xea7720, 0x436066, 0xf3ead6];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Group(); t.position.set(x + (R() - 0.5) * 0.28, y + 0.012, z + (R() - 0.5) * 0.14); t.rotation.y = R() * 3.14; parent.add(t);
    const c = cols[i % cols.length];
    const body = cyl(0.011, 0.011, 0.085, steelMat({ roughness: 0.4 }), 0, 0, 0, t, 14); body.rotation.z = Math.PI / 2;
    const band = cyl(0.0114, 0.0114, 0.04, mat(c, { roughness: 0.5 }), 0.008, 0, 0, t, 14); band.rotation.z = Math.PI / 2; band.castShadow = false;
    box(0.008, 0.003, 0.022, steelMat({ roughness: 0.4 }), -0.0465, 0, 0, t);                   // flat crimped end
    const cap = cyl(0.0085, 0.009, 0.016, mat(i % 2 ? 0x1f090b : 0xf3ead6, { roughness: 0.4 }), 0.05, 0, 0, t, 14); cap.rotation.z = Math.PI / 2;
  }
}

// a little pixel painting in a dark frame (same style as the big ones)
function shelfPicture(parent, x, y, z, w, h, seed, tilt = 0, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(tilt, ry, 0); parent.add(g);
  box(w + 0.03, h + 0.03, 0.02, mat(0x3a2013), 0, 0, 0, g);
  const cols = ["#ea7720", "#436066", "#f5d4a8", "#c23b3b", "#2a8fa8", "#eeb04a", "#571c0a"];
  const tex = canvasTexture(64, 64, (c) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { c.fillStyle = cols[(i * 3 + j * 5 + seed * (i % 3) + ((i * j) % 4)) % 7]; c.fillRect(i * 4, j * 4, 4, 4); } });
  tex.magFilter = THREE.NearestFilter;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(0xffffff, { map: tex })); p.position.z = 0.0105; g.add(p);
}

// the shelf unit: back panel, four boards, and a different arrangement on each board
function shelfUnit(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(0.05, 2.4, 0.35, wood, -0.6, 1.2, 0, g); box(0.05, 2.4, 0.35, wood, 0.6, 1.2, 0, g);
  box(1.2, 2.4, 0.015, mat(0xc9ae86), 0, 1.2, -0.17, g);
  [0.3, 0.9, 1.5, 2.1].forEach((y) => box(1.25, 0.04, 0.35, wood, 0, y, 0, g));
  box(1.25, 0.04, 0.35, wood, 0, 2.4, 0, g);
  const s = Math.floor(Math.abs(x * 7 + z * 13));                      // each unit gets its own arrangement
  const B = (y) => y + 0.02;                                           // top surface of a board
  // board 1: a row of books and a tall vase with dried grass
  bookRow(g, -0.55, 0.2, B(0.3), 11 + s); vase(g, 0.4, B(0.3), 0.02, 0, 0xc9633a, 1, true);
  // board 2: paint tins, a brush jar, a leaning book pile
  paintCan(g, -0.42, B(0.9), 0.02, 0xea7720); paintCan(g, -0.28, B(0.9), 0.0, 0x436066);
  brushJar(g, 0.0, B(0.9), 0.02); box(0.3, 0.035, 0.22, mat(0x7a4a2a), 0.36, B(0.9) + 0.0175, 0, g).rotation.y = 0.1;
  box(0.28, 0.035, 0.2, mat(0xc23b3b), 0.36, B(0.9) + 0.0525, 0, g).rotation.y = -0.08; miniPlant(g, 0.36, B(0.9) + 0.07, 0, 1);
  // board 3: three vases of different shapes, a small picture
  vase(g, -0.4, B(1.5), 0.0, 1, 0x436066, 1); vase(g, -0.15, B(1.5), 0.02, 2, 0xf5d4a8, 1); vase(g, 0.1, B(1.5), 0.0, 0, 0xea7720, 0.85);
  shelfPicture(g, 0.4, B(1.5) + 0.11, -0.1, 0.18, 0.22, 3 + s, -0.12);
  // board 4: rolled papers, leaning pictures, a little plant
  rolledPapers(g, -0.4, B(2.1), 0.0); shelfPicture(g, 0.0, B(2.1) + 0.14, -0.13, 0.24, 0.28, 5 + s, -0.1);
  shelfPicture(g, 0.22, B(2.1) + 0.1, -0.12, 0.2, 0.2, 2 + s, -0.1); miniPlant(g, 0.46, B(2.1), 0.0, 1.1, 0x6b8e8a);
  scene.add(g);
}

// ---------- TABLE PIECES ----------
function palette(x, y, z, ry, s = 1) {                                // a wooden palette with a thumb hole and wet dollops of paint
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(s); scene.add(g);
  const sh = new THREE.Shape(); sh.absellipse(0, 0, 0.19, 0.125, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path(); hole.absellipse(-0.115, -0.02, 0.022, 0.015, 0, Math.PI * 2, true, 0); sh.holes.push(hole);
  const pg = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 }); pg.rotateX(-Math.PI / 2);
  const board = new THREE.Mesh(pg, std(0xffffff, { map: woodGrainTexture("#caa56f", 8), roughness: 0.55 })); board.castShadow = true; board.receiveShadow = true; g.add(board);
  const cols = [0xc23b3b, 0xeeb04a, 0xea7720, 0x2a8fa8, 0x436066, 0xf3ead6, 0x571c0a];
  cols.forEach((c, i) => {
    const a = 0.35 + i * 0.62, d = sph(0.017 + (i % 3) * 0.003, std(c, { roughness: 0.25 }), Math.cos(a) * 0.14, 0.013, -Math.sin(a) * 0.082, g);
    d.scale.set(1.1, 0.45, 1); d.castShadow = false;
  });
  [[0.0, 0.0, 0xd9803a, 0.03], [0.04, 0.025, 0x5f8a86, 0.022]].forEach(([dx, dz, c, r]) => { const m = sph(r, std(c, { roughness: 0.3 }), dx, 0.011, dz, g); m.scale.set(1.5, 0.22, 1); m.castShadow = false; });
}
function mug(x, y, z, c) {
  cyl(0.04, 0.036, 0.09, mat(c, { roughness: 0.3 }), x, y + 0.045, z, scene, 24);
  cyl(0.034, 0.034, 0.004, mat(0x3a2013, { roughness: 0.2 }), x, y + 0.087, z, scene, 24).castShadow = false;    // coffee
  const hd = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 16, Math.PI), mat(c, { roughness: 0.3 })); hd.rotation.z = -Math.PI / 2;
  hd.position.set(x + 0.038, y + 0.048, z); hd.castShadow = true; scene.add(hd);
}
function sketchbook(x, y, z, ry) {                                    // an open sketchbook with a pencil
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
  const page = canvasTexture(128, 160, (c, w, h) => {
    c.fillStyle = "#f3ead6"; c.fillRect(0, 0, w, h); c.strokeStyle = "rgba(60,50,40,.55)"; c.lineWidth = 1.2;
    c.beginPath(); c.arc(w * 0.45, h * 0.4, 22, 0, 7); c.stroke(); c.beginPath(); c.moveTo(20, 100); c.lineTo(60, 80); c.lineTo(100, 110); c.stroke();
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(24, 125 + i * 5); c.lineTo(24 + 40 + (i % 3) * 14, 125 + i * 5); c.stroke(); }
  });
  box(0.37, 0.008, 0.25, mat(0x3a2013), 0, 0.004, 0, g);                                                   // cover
  [-1, 1].forEach((s) => { const p = box(0.17, 0.006, 0.23, mat(0xffffff, { map: page, roughness: 1 }), s * 0.087, 0.012, 0, g); p.rotation.z = -s * 0.05; p.castShadow = false; });
  limb([0.06, 0.02, 0.16], [-0.04, 0.012, 0.13], 0.0045, mat(0xeeb04a, { roughness: 0.5 }), g);              // pencil
  limb([-0.04, 0.012, 0.13], [-0.062, 0.0105, 0.123], 0.0036, mat(0xd9b98a, { roughness: 0.9 }), g);
}
function rag(x, y, z, ry) {                                           // a folded cloth with paint stains
  const tex = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = "#e9dcc2"; c.fillRect(0, 0, w, h);
    [["#ea7720", 30, 40], ["#436066", 90, 80], ["#c23b3b", 60, 100], ["#eeb04a", 100, 30]].forEach(([col, px, py]) => {
      const gr = c.createRadialGradient(px, py, 0, px, py, 26); gr.addColorStop(0, col); gr.addColorStop(1, "rgba(233,220,194,0)"); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    });
  });
  const m = mat(0xffffff, { map: tex, roughness: 1 });
  box(0.22, 0.012, 0.16, m, x, y + 0.006, z).rotation.y = ry;
  box(0.2, 0.012, 0.14, m, x + 0.005, y + 0.018, z + 0.005).rotation.y = ry + 0.15;
}
function runner(x, y, z, w, d) {                                      // a woven linen runner under the tools
  const tex = canvasTexture(256, 96, (c, W, H) => {
    c.fillStyle = "#cdb487"; c.fillRect(0, 0, W, H);
    for (let i = 0; i < H; i += 3) { c.fillStyle = "rgba(90,65,35,.12)"; c.fillRect(0, i, W, 1); }
    [0, W - 28].forEach((x0) => {
      c.fillStyle = "#571c0a"; c.fillRect(x0, 0, 28, H); c.fillStyle = "#ea7720";
      for (let yy = 8; yy < H; yy += 16) { c.beginPath(); c.moveTo(x0 + 14, yy); c.lineTo(x0 + 22, yy + 8); c.lineTo(x0 + 14, yy + 16); c.lineTo(x0 + 6, yy + 8); c.fill(); }
    });
  });
  const m = box(w, 0.004, d, mat(0xffffff, { map: tex, roughness: 1 }), x, y + 0.002, z); m.castShadow = false;
}

// ---------- WHAT GOES ON THE TWO TABLES ----------
function workTableDecor() {                                           // the big table: top surface is at y = 0.93
  const Y = 0.93;
  bowls(-3.3, Y, -1.3, 4); bowls(-1.45, Y, -0.95, 3); books(-3.1, Y, -0.85, 3);
  paintCan(scene, -2.95, Y, -1.42, 0xea7720); paintCan(scene, -2.78, Y, -1.32, 0x436066);
  brushJar(scene, -2.5, Y, -1.4); brushJar(scene, -2.2, Y, -1.42, 0xb7a26a);
  paintTubes(scene, -2.0, Y, -1.15, 5, 3); mug(-1.5, Y, -1.38, 0xc23b3b); rag(-1.38, Y, -1.12, 0.4);
  sketchbook(-2.5, Y, -0.85, 0.15); palette(-1.9, Y, -0.8, 0.5);
}
function toolTableDecor() {                                           // the table with the three tools: top surface is at y = TOP + 0.03
  const Y = TOP + 0.03;
  runner(TABLE_X, Y, -2.15, 1.7, 0.46);
  brushJar(scene, 2.3, Y, -2.48); paintTubes(scene, 2.4, Y, -1.92, 4, 5);
  palette(3.82, Y, -1.93, -0.4, 0.8); paintCan(scene, 3.95, Y, -2.5, 0x2a8fa8); mug(2.95, Y, -2.52, 0xf5d4a8);
}


// easel (where the chosen painting stands) and the table with the tools
const EASEL_X = 0.5;
box(0.05, 2.0, 0.05, wood, EASEL_X - 0.36, 1.0, -2.25).rotation.x = -0.1;
box(0.05, 2.0, 0.05, wood, EASEL_X + 0.36, 1.0, -2.25).rotation.x = -0.1;
box(0.05, 2.0, 0.05, wood, EASEL_X, 1.0, -2.62).rotation.x = 0.2;
box(0.9, 0.05, 0.05, wood, EASEL_X, 1.9, -2.38);
box(0.98, 0.05, 0.16, wood, EASEL_X, 0.72, -2.14);
const TABLE_X = 3.1, TOP = 0.92;
tableAt(TABLE_X, -2.2, 1.9, 0.85, TOP);

// furnishing
tableAt(-2.4, -1.1, 2.4, 0.95, 0.9);  
workTableDecor();
toolTableDecor();                                     
ladder(-4.6, -4.75, 0.0, 0.17); ladder(5.5, -3.8, -Math.PI / 2, 0.17);
shelfUnit(5.75, -1.4, -Math.PI / 2); shelfUnit(-5.75, -3.0, Math.PI / 2);
sofa(4.5, 2.4, -Math.PI / 2); cabinet(-4.9, 1.9, Math.PI / 2); floorLamp(5.2, 0.6); floorLamp(-5.3, -0.6);
stool(-0.9, -0.2); stool(1.8, -0.9); plant(-5.4, 3.4, 1.4); plant(5.4, 4.0, 1.2, 0x6b8e8a); plant(2.2, -4.6, 1.5); plant(-1.6, -4.6, 1.1, 0x436066);
for (let i = 0; i < 4; i++) { const c = box(0.8, 1.0, 0.03, mat(0xf3ead6), -5.3 + i * 0.07, 0.52, -3.4 - i * 0.04); c.rotation.set(-0.1, 0.4 + i * 0.03, 0.02); }   // blank canvases
smallFrame(-5.96, 1.7, -0.2, Math.PI / 2, 0.5, 0.65, 1); smallFrame(-5.96, 2.2, 0.9, Math.PI / 2, 0.45, 0.45, 2);
smallFrame(-5.96, 1.6, 1.6, Math.PI / 2, 0.6, 0.45, 3); smallFrame(5.96, 2.3, 1.2, -Math.PI / 2, 0.5, 0.6, 4);
smallFrame(5.96, 1.8, 2.4, -Math.PI / 2, 0.55, 0.4, 5); smallFrame(5.96, 2.5, -0.4, -Math.PI / 2, 0.45, 0.45, 6);
// soft contact shadows under the big pieces
contact(-2.4, -1.1, 3.0, 1.5);            // big work table
contact(3.1, -2.2, 2.4, 1.4);             // tool table
contact(0.5, -2.3, 1.3, 1.0);             // easel
contact(4.5, 2.4, 1.3, 2.4);              // sofa
contact(-4.9, 1.9, 1.4, 1.9);             // cabinet
contact(5.75, -1.4, 0.8, 1.9); contact(-5.75, -3.0, 0.8, 1.9);   // shelves
contact(-0.9, -0.2, 0.6, 0.6); contact(1.8, -0.9, 0.6, 0.6);     // stools

const interactive = [];       // everything the learner can click: paintings and tools

function makeTool(key, name, x, build, grip) {
  const g = new THREE.Group();
  build(g);
  g.position.set(x, TOP + 0.02, -2.15);
  g.userData = { type: "tool", key, name, home: g.position.clone(), homeQuat: g.quaternion.clone() };
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  // an invisible, slightly bigger box makes the tool easy to click, especially with a finger
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.26), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.07; g.add(hit);
  if (grip) { const hand = makeHand(grip); hand.visible = false; g.add(hand); g.userData.hand = hand; }   // the hand is built hidden
  scene.add(g); interactive.push(g);
  return g;
}

const sponge = makeTool("sponge", "Water Sponge", TABLE_X - 0.6, buildSponge, { at: [0, 0.055, 0], r: 0.075, yaw: 0.6 });
const knife  = makeTool("knife", "Palette Knife", TABLE_X, buildKnife, { at: [-0.1, 0.031, 0], r: 0.022, yaw: 0.6 });
const chalk  = makeTool("chalk", "Edge Chalk", TABLE_X + 0.6, buildChalk, { at: [0.03, 0.0338, 0], r: 0.0238, yaw: 0.6 });
const tools = [sponge, knife, chalk];

// name tags above the tools (drawn once the fonts are ready)
document.fonts.ready.then(() => {
  tools.forEach((t) => {
    const tex = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = "rgba(31,9,11,.85)"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#ea7720"; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = "#f5d4a8"; g.font = "700 26px Kufam, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t.userData.name, w / 2, h / 2 + 1);
    });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    label.scale.set(0.46, 0.115, 1); label.position.set(0, 0.24, 0); label.renderOrder = 5;
    t.add(label); t.userData.label = label;
  });
});

// ---------- 5. THE PAINTINGS: six canvases to choose from ----------
function patternTexture(key) {                       // a painting = the pattern drawn tile by tile
  const img = Patterns[key];
  const t = canvasTexture(img.cols * TILE, img.rows * TILE, (g) => {
    img.pixels.forEach((p, i) => {
      g.fillStyle = "rgb(" + p.map((v) => Math.round(v * 255)).join(",") + ")";
      g.fillRect((i % img.cols) * TILE, Math.floor(i / img.cols) * TILE, TILE, TILE);
    });
  });
  t.magFilter = THREE.NearestFilter;
  return t;
}

function makePainting(key, w, h, x, y, z = -4.93, tilt = 0) {
  const g = new THREE.Group();
  box(w + 0.14, h + 0.14, 0.05, std(0x3a2013), 0, 0, 0, g);              // wooden frame
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std(0xffffff, { map: patternTexture(key), roughness: 0.9 }));
  plane.position.z = 0.03; plane.receiveShadow = true; g.add(plane);
  g.position.set(x, y, z); g.rotation.x = tilt;
  g.userData = { type: "painting", key, name: Patterns[key].name, w, h, plane, staticMap: plane.material.map,
    home: g.position.clone(), homeQuat: g.quaternion.clone() };
  scene.add(g); interactive.push(g);
  return g;
}
const paintings = [
  makePainting("mosaic", 1.3, 1.3, -4.7, 2.45),
  makePainting("rug", 0.9, 1.35, -3.1, 2.4),
  makePainting("swirl", 1.4, 1.4, 3.0, 2.45),
  makePainting("sunrise", 1.6, 1.14, 4.9, 2.4),
  makePainting("waves", 0.95, 0.95, -4.0, 0.62, -4.84, -0.1),     // leaning on the floor
  makePainting("zigzag", 0.8, 1.2, 5.1, 0.72, -4.84, -0.1),
];

// the glowing 3x3 frame, mirrored on the painting in 3D
const kernelFrame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  map: canvasTexture(128, 128, (g, w, h) => {
    g.shadowColor = "#ea7720"; g.shadowBlur = 14;
    g.strokeStyle = "#1f090b"; g.lineWidth = 14; g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = "#f5d4a8"; g.lineWidth = 7; g.strokeRect(10, 10, w - 20, h - 20);
  }), transparent: true, depthWrite: false }));
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
  camera.attach(t);
  showHand(t);                                      // the tool now follows the camera: it is in the painter's hand
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
  hideHand(tool);    
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
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
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

window.__game = { scene, camera, paintings, tools, choosePainting, chooseTool, get stage() { return stage; } };  // handy for testing