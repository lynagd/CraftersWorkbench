// js/hand.js
// The crafter's hand: a right hand that grips a tool, with a bare wrist, a rolled cuff and a copper sleeve.
// It is built from tapered finger segments, round joints, knuckles, nails and a shaped palm.
// Everything is in the TOOL's own coordinates: X along the tool, Y up from its flat side, Z across it.

import * as THREE from "three";

// Where the fingers wrap around each tool (an ellipse in the Y-Z plane around the handle),
// where the tool touches the painting (pivot) and how much it is tilted while it works.
export const GRIP = {
  sponge: { gx: 0,     cy: 0.05,  cz: 0, Ry: 0.061, Rz: 0.094, start: 112, fs: 1.3, pivot: [0, 0, 0], tilt: 0 },
  knife:  { gx: -0.11, cy: 0.02,  cz: 0, Ry: 0.031, Rz: 0.031, start: 98, pivot: [0.12, 0.03, 0], tilt: 0.3 },
  chalk:  { gx: -0.03, cy: 0.024, cz: 0, Ry: 0.034, Rz: 0.034, start: 98, pivot: [0.085, 0, 0],   tilt: 0.5 },
};

// the pose of a tool that works on the painting: flat side on the canvas, turned so the arm comes from below
const SPIN = THREE.MathUtils.degToRad(200);
const Q_SPIN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), SPIN);
const Q_FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
export const toolQuat = (key) =>
  new THREE.Quaternion().copy(Q_SPIN).multiply(Q_FLAT).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -GRIP[key].tilt));

const UP = new THREE.Vector3(0, 1, 0);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function makeHand(tool, std, skinNormal) {
  const c = GRIP[tool.userData.key];
  const hand = new THREE.Group();
  // skin: a little shiny, with a soft reddish glow in the shadows (light scattering under the skin) and fine pores
  const pores = skinNormal ? skinNormal.clone() : null; if (pores) { pores.repeat.set(3, 3); pores.needsUpdate = true; }
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xd3a07c, roughness: 0.52, envMapIntensity: 0.7, emissive: 0x4a1a0e, emissiveIntensity: 0.18,
    sheen: 1, sheenColor: new THREE.Color(0xffb7a0), sheenRoughness: 0.5, normalMap: pores, normalScale: new THREE.Vector2(0.35, 0.35) });
  const nailMat = std(0xf0cbbd, { roughness: 0.28 });
  const sleeveMat = std(0xb36633, { roughness: 0.85 });
  const rollMat = std(0x9a5528, { roughness: 0.85 });
  const add = (m) => { m.castShadow = true; hand.add(m); return m; };

  // a round joint, optionally squashed
  const ball = (p, r, sx = 1, sy = 1, sz = 1, mat = skin) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
    m.position.copy(p); m.scale.set(sx, sy, sz); return add(m);
  };
  // a segment that gets thinner from a to b, with a round joint at each end
  const limb = (a, b, ra, rb, mat = skin) => {
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, 16, 1, true), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UP, dir.normalize()); add(m);
    ball(a, ra, 1, 1, 1, mat); ball(b, rb, 1, 1, 1, mat);
  };

  // ----- the curve the fingers follow around the tool (an ellipse in Y-Z), measured by arc length -----
  function curve(th0, th1) {
    const pts = [], n = Math.abs(th1 - th0), dir = Math.sign(th1 - th0);
    let s = 0, prev = null;
    for (let i = 0; i <= n; i++) {
      const th = THREE.MathUtils.degToRad(th0 + dir * i);
      const y = c.cy + c.Ry * Math.sin(th), z = c.cz + c.Rz * Math.cos(th);
      if (prev) s += Math.hypot(y - prev.y, z - prev.z);
      const ny = Math.sin(th) / c.Ry, nz = Math.cos(th) / c.Rz, nl = Math.hypot(ny, nz);
      pts.push({ y, z, s, ny: ny / nl, nz: nz / nl }); prev = pts[pts.length - 1];
    }
    return (len) => {                                   // the point `len` metres along the curve
      let k = 0; while (k < pts.length - 2 && pts[k + 1].s < len) k++;
      const a = pts[k], b = pts[k + 1], t = Math.min(1, Math.max(0, (len - a.s) / Math.max(1e-6, b.s - a.s)));
      const l = (u, v) => u + (v - u) * t;
      return { y: l(a.y, b.y), z: l(a.z, b.z), ny: l(a.ny, b.ny), nz: l(a.nz, b.nz) };
    };
  }
  const over = curve(c.start, c.start - 160);           // fingers go over the far side
  const around = curve(c.start + 52, c.start + 190);    // the thumb goes round the near side

  // ----- the four fingers: index (next to the thumb), middle, ring, little -----
  const FINGERS = [
    { x:  0.033, L: 0.074, r: 0.0096, dz:  0.001, dy:  0.000 },
    { x:  0.011, L: 0.083, r: 0.0100, dz:  0.005, dy:  0.002 },
    { x: -0.011, L: 0.077, r: 0.0093, dz:  0.002, dy:  0.000 },
    { x: -0.033, L: 0.060, r: 0.0083, dz: -0.006, dy: -0.004 },
  ];
  const tip0 = over(0);
  FINGERS.forEach((f) => {
    const L = f.L * (c.fs || 1);                          // some tools need a longer reach
    const k = [0, 0.46, 0.76, 1].map((u) => over(u * L));
    const P = k.map((q) => V3(c.gx + f.x, q.y + f.dy, q.z + f.dz));
    const R = [1.0, 0.94, 0.86, 0.8].map((u) => f.r * u);
    for (let i = 0; i < 3; i++) limb(P[i], P[i + 1], R[i], R[i + 1]);
    ball(P[0], f.r * 1.16, 1, 0.95, 1.05);              // the knuckle
    ball(P[1], R[1] * 1.1);                             // the middle joint
    // the nail, on the outside of the fingertip
    const q = k[3], n = V3(0, q.ny, q.nz), t = V3(0, -q.nz, q.ny);
    const basis = new THREE.Matrix4().makeBasis(V3(1, 0, 0), n, t);
    const nail = ball(V3(P[3].x, P[3].y + q.ny * R[3] * 0.62, P[3].z + q.nz * R[3] * 0.62).addScaledVector(t, -0.0045), 1, R[3] * 0.78, R[3] * 0.2, 0.0085, nailMat);
    nail.setRotationFromMatrix(basis);
  });

  // ----- the back of the hand -----
  const yK = tip0.y + 0.0035, zK = tip0.z - 0.003;      // the row of knuckles
  const palmLen = 0.098, zW = zK - palmLen, yW = yK + 0.002;   // the wrist end of the hand
  FINGERS.forEach((f) => limb(V3(c.gx + f.x, yK + f.dy, zK + f.dz), V3(c.gx + f.x * 0.6, yW, zW), 0.0098, 0.0128));
  ball(V3(c.gx + 0.002, (yK + yW) / 2 - 0.003, (zK + zW) / 2 + 0.004), 1, 0.045, 0.0128, 0.052);        // the palm
  ball(V3(c.gx + 0.036, yW - 0.006, zW + 0.03), 1, 0.02, 0.0145, 0.03);                                   // the base of the thumb

  // ----- the thumb -----
  const th = [0, 0.036, 0.066].map((u) => around(u));
  const T = th.map((q) => V3(c.gx + 0.058, q.y, q.z));
  const cmc = V3(c.gx + 0.03, yW - 0.004, zW + 0.012);
  limb(cmc, T[0], 0.0135, 0.0118);
  limb(T[0], T[1], 0.0118, 0.0108);
  limb(T[1], T[2], 0.0108, 0.0098);
  ball(T[0], 0.0128); ball(T[1], 0.0112);
  const q2 = th[2], n2 = V3(0, q2.ny, q2.nz), t2 = V3(0, -q2.nz, q2.ny);
  const thumbNail = ball(V3(T[2].x, T[2].y + q2.ny * 0.0078, T[2].z + q2.nz * 0.0078).addScaledVector(t2, 0.003), 1, 0.0075, 0.002, 0.0095, nailMat);
  thumbNail.setRotationFromMatrix(new THREE.Matrix4().makeBasis(V3(1, 0, 0), n2, t2));

  // ----- wrist, forearm, rolled cuff and sleeve -----
  const W = V3(c.gx + 0.002, yW, zW - 0.003), ad = V3(0, 0.55, -0.835).normalize();
  const along = (a, b, r0, r1, mat, flat = 0.8) => {                          // a tapered tube, a little flatter than round
    const len = b - a, m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 24, 1, true), mat);
    m.position.copy(W).addScaledVector(ad, a + len / 2); m.quaternion.setFromUnitVectors(UP, ad); m.scale.set(1, 1, flat); add(m);
  };
  ball(W, 0.0265, 1, 0.74, 1);
  along(0, 0.15, 0.0265, 0.036, skin, 0.78);
  const roll = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.0125, 14, 28), rollMat);   // the rolled-up cuff
  roll.position.copy(W).addScaledVector(ad, 0.152); roll.quaternion.setFromUnitVectors(V3(0, 0, 1), ad); roll.scale.set(1, 1, 1); add(roll);
  along(0.152, 1.7, 0.047, 0.085, sleeveMat, 0.9);      // long enough to leave the screen: the body is out of view

  hand.visible = false;
  tool.add(hand); tool.userData.hand = hand;
  return hand;
}
