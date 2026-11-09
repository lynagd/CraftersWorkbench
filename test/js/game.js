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
function shelfUnit(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(0.05, 2.4, 0.35, wood, -0.6, 1.2, 0, g); box(0.05, 2.4, 0.35, wood, 0.6, 1.2, 0, g);
  [0.3, 0.9, 1.5, 2.1].forEach((y, i) => {
    box(1.25, 0.04, 0.35, wood, 0, y, 0, g);
    for (let k = 0; k < 4; k++) {
      const c = [0xea7720, 0x436066, 0xf5d4a8, 0xc23b3b, 0x2a8fa8][(i + k) % 5], px = -0.45 + k * 0.3;
      if ((i + k) % 3 === 0) box(0.2, 0.18, 0.2, mat(c), px, y + 0.11, 0, g); else cyl(0.06, 0.06, 0.18 + (k % 2) * 0.08, mat(c, { roughness: 0.5 }), px, y + 0.11, 0, g);
    }
  });
  scene.add(g);
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
tableAt(-2.4, -1.1, 2.4, 0.95, 0.9);                                         // big work table, left of the easel
bowls(-3.2, 0.93, -1.2, 4); bowls(-1.5, 0.93, -0.9, 3); books(-2.4, 0.93, -1.3, 5); books(-3.0, 0.93, -0.8, 3);
brushes(-2.0, 0.93, -1.2); brushes(-3.5, 0.93, -0.9); [0xea7720, 0x436066, 0xc23b3b, 0xeeb04a].forEach((c, i) => jar(-2.9 + i * 0.28, 0.93, -1.45, c));
box(0.9, 0.012, 0.6, mat(0xf3ead6), -2.4, 0.935, -0.7).rotation.y = 0.2;      // a sheet of paper
ladder(-4.6, -4.75, 0.0, 0.17); ladder(5.5, -3.8, -Math.PI / 2, 0.17);
shelfUnit(5.75, -1.4, -Math.PI / 2); shelfUnit(-5.75, -3.0, Math.PI / 2);
sofa(4.5, 2.4, -Math.PI / 2); cabinet(-4.9, 1.9, Math.PI / 2); floorLamp(5.2, 0.6); floorLamp(-5.3, -0.6);
stool(-0.9, -0.2); stool(1.8, -0.9); plant(-5.4, 3.4, 1.4); plant(5.4, 4.0, 1.2, 0x6b8e8a); plant(2.2, -4.6, 1.5); plant(-1.6, -4.6, 1.1, 0x436066);
books(3.9, TOP + 0.03, -2.0, 3); brushes(2.2, TOP + 0.03, -2.4); jar(3.6, TOP + 0.03, -2.5, 0xea7720); jar(3.75, TOP + 0.03, -2.45, 0x436066);
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

function makeTool(key, name, x, build) {
  const g = new THREE.Group();
  build(g);
  g.position.set(x, TOP + 0.02, -2.15);
  g.userData = { type: "tool", key, name, home: g.position.clone(), homeQuat: g.quaternion.clone() };
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  // an invisible, slightly bigger box makes the tool easy to click, especially with a finger
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.26), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.07; g.add(hit);
  scene.add(g); interactive.push(g);
  return g;
}
const sponge = makeTool("sponge", "Water Sponge", TABLE_X - 0.6, (g) => {
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.17), std(0xe0b345, { roughness: 1 })));
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), std(0xb8862a, { roughness: 1 })); b.position.set(-0.09 + i * 0.036, 0.05, ((i % 2) - 0.5) * 0.08); g.add(b); }
});
const knife = makeTool("knife", "Palette Knife", TABLE_X, (g) => {
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.14, 12), std(0x6b3f1e));
  handle.rotation.z = Math.PI / 2; handle.position.set(-0.1, 0.014, 0); g.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.006, 0.06), std(0xd0d6d8, { metalness: 0.8, roughness: 0.3 }));
  blade.position.set(0.07, 0.022, 0); g.add(blade);
  g.rotation.y = 0.5; g.userData.homeQuat = g.quaternion.clone();
});
const chalk = makeTool("chalk", "Edge Chalk", TABLE_X + 0.6, (g) => {
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.18, 16), std(0xf3ead6, { roughness: 1 }));
  stick.rotation.z = Math.PI / 2; stick.position.y = 0.024; g.add(stick);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0255, 0.0255, 0.03, 16), std(ORG));
  band.rotation.z = Math.PI / 2; band.position.set(-0.04, 0.024, 0); g.add(band);
  g.rotation.y = -0.4; g.userData.homeQuat = g.quaternion.clone();
});
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