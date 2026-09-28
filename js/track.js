import * as THREE from 'three';

export const W = 20;
const HALF = W / 2;
const CURB = 1.6;
export const WALL = HALF + CURB;

const CP = [
  [0, 0, 0], [0, -120, 0], [5, -230, 1], [40, -330, 3], [110, -395, 6], [210, -410, 9], [290, -395, 11],
  [330, -345, 11], [320, -290, 9], [270, -265, 7], [230, -215, 6], [245, -160, 5], [285, -110, 5], [270, -50, 4],
  [250, 25, 6], [330, 75, 10], [430, 70, 14], [520, 110, 15], [565, 220, 14], [520, 320, 12], [420, 365, 8],
  [330, 330, 5], [285, 280, 4], [230, 290, 3], [200, 350, 2], [140, 395, 1], [60, 395, 1],
  [-20, 365, 0], [-85, 285, 0], [-95, 200, 0], [-55, 120, 0], [-10, 60, 0],
];

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function textTexture(text, { w = 1024, h = 256, bg = '#0a3a8a', fg = '#fff', font = 'italic 900 150px "PingFang SC","Microsoft YaHei",sans-serif', stroke = '#ffcc00' } = {}) {
  return canvasTex(w, h, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, bg);
    grd.addColorStop(1, '#021a44');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = stroke;
    g.lineWidth = 12;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 14;
    g.strokeStyle = '#012';
    g.strokeText(text, w / 2, h / 2 + 6);
    g.fillStyle = fg;
    g.fillText(text, w / 2, h / 2 + 6);
  }, false);
}

export function buildTrack(scene) {
  const curve = new THREE.CatmullRomCurve3(CP.map(([x, z, y]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  const N = 2400;
  const pts = curve.getSpacedPoints(N).slice(0, N);
  const L = curve.getLength();
  const ds = L / N;
  const T = [], R = [], K = new Float32Array(N), bridge = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const t = pts[(i + 1) % N].clone().sub(pts[(i - 1 + N) % N]).normalize();
    T.push(t);
    R.push(new THREE.Vector3(-t.z, 0, t.x).normalize());
    bridge[i] = pts[i].x > 468 ? 1 : 0;
  }
  for (let i = 0; i < N; i++) {
    const a = T[(i - 3 + N) % N], b = T[(i + 3) % N];
    const cross = a.x * b.z - a.z * b.x;
    K[i] = Math.asin(Math.max(-1, Math.min(1, cross))) / (6 * ds);
  }

  const idxNear = (x, z) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = pts[i].x - x, dz = pts[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const tunnelA = idxNear(-60, 320), tunnelB = idxNear(-92, 215);

  const query = (x, z, hint = -1) => {
    let best = 0, bd = Infinity;
    const from = hint < 0 ? 0 : hint - 40, to = hint < 0 ? N : hint + 40;
    for (let j = from; j < to; j++) {
      const i = (j + N) % N;
      const dx = pts[i].x - x, dz = pts[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    const p = pts[best], t = T[best];
    const along = (x - p.x) * t.x + (z - p.z) * t.z;
    const i0 = along >= 0 ? best : (best - 1 + N) % N;
    const i1 = (i0 + 1) % N;
    const a = pts[i0], b = pts[i1];
    const sx = b.x - a.x, sz = b.z - a.z;
    const f = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / (sx * sx + sz * sz)));
    const r = R[i0];
    return {
      i: best,
      s: (i0 + f) * ds,
      lat: (x - a.x - sx * f) * r.x + (z - a.z - sz * f) * r.z,
      y: a.y + (b.y - a.y) * f,
      T: t,
      R: r,
      k: K[best],
    };
  };

  const at = (s, lat = 0) => {
    const u = (((s / ds) % N) + N) % N;
    const i0 = Math.floor(u), i1 = (i0 + 1) % N, f = u - i0;
    const p = pts[i0].clone().lerp(pts[i1], f);
    const t = T[i0].clone().lerp(T[i1], f).normalize();
    const r = new THREE.Vector3(-t.z, 0, t.x).normalize();
    p.addScaledVector(r, lat);
    return { p, T: t, R: r, k: K[i0], i: i0 };
  };

  // ---------- road surface ----------
  const roadTex = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = '#4a4d55';
    g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let n = 0; n < 26000; n++) {
      const v = 55 + r() * 45 | 0;
      g.fillStyle = `rgba(${v},${v},${v + 6},${0.35 + r() * 0.4})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    g.fillStyle = '#f2f2f2';
    g.fillRect(14, 0, 10, h);
    g.fillRect(w - 24, 0, 10, h);
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let y = 0; y < h; y += 256) g.fillRect(w / 2 - 5, y, 10, 140);
    g.fillStyle = 'rgba(0,0,0,.07)';
    g.fillRect(w * 0.22, 0, 60, h);
    g.fillRect(w * 0.66, 0, 60, h);
  });
  const curbTex = canvasTex(64, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 64) {
      g.fillStyle = (y / 64) % 2 ? '#fff' : '#e8262b';
      g.fillRect(0, y, w, 64);
    }
    g.fillStyle = 'rgba(0,0,0,.15)';
    g.fillRect(0, 0, 6, h);
  });
  const wallTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#1b5fd9';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, 10);
    g.fillRect(0, h - 10, w, 10);
    g.font = 'italic 900 34px sans-serif';
    g.textBaseline = 'middle';
    g.fillText('QQ SPEED', 22, h / 2 + 1);
    g.fillStyle = '#ffd400';
    g.fillRect(200, 14, 40, h - 28);
  });

  const ribbon = (lat0, lat1, y0, y1, vScale, filter) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N, p = pts[k], r = R[k];
      pos.push(p.x + r.x * lat0, p.y + y0, p.z + r.z * lat0, p.x + r.x * lat1, p.y + y1, p.z + r.z * lat1);
      uv.push(0, (i * ds) / vScale, 1, (i * ds) / vScale);
      if (i < N && (!filter || filter(k))) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  const road = new THREE.Mesh(ribbon(-HALF, HALF, 0.02, 0.02, 20), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }));
  road.receiveShadow = true;
  scene.add(road);
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sgn of [-1, 1]) {
    const c = new THREE.Mesh(ribbon(sgn > 0 ? HALF : -WALL, sgn > 0 ? WALL : -HALF, sgn > 0 ? 0.02 : 0.12, sgn > 0 ? 0.12 : 0.02, 8), curbMat);
    c.receiveShadow = true;
    scene.add(c);
  }
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.5, side: THREE.DoubleSide });
  wallTex.repeat.set(1, 1);
  for (const sgn of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    const pos = [], uv = [], idx = [];
    const lat = sgn * (WALL + 0.2);
    for (let i = 0; i <= N; i++) {
      const k = i % N, p = pts[k], r = R[k];
      const x = p.x + r.x * lat, z = p.z + r.z * lat;
      pos.push(x, p.y - (bridge[k] ? 1.8 : 0.6), z, x, p.y + 1.1, z);
      uv.push((i * ds) / 8, 0, (i * ds) / 8, 1);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, wallMat);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  // bridge deck underside + pillars
  const deck = new THREE.Mesh(ribbon(WALL + 0.2, -WALL - 0.2, -1.8, -1.8, 20, (k) => bridge[k]), new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.9, side: THREE.DoubleSide }));
  scene.add(deck);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.6 });
  for (let i = 0; i < N; i += 14) {
    if (!bridge[i]) continue;
    const p = pts[i];
    const h = p.y + 10;
    for (const sgn of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, h, 12), pillarMat);
      col.position.set(p.x + R[i].x * sgn * 7, p.y - 1.8 - h / 2, p.z + R[i].z * sgn * 7);
      col.castShadow = true;
      scene.add(col);
    }
  }
  // suspension arches on bridge
  const cableMat = new THREE.MeshStandardMaterial({ color: 0xff4d2e, roughness: 0.4, metalness: 0.3 });
  for (let i = 0; i < N; i += 56) {
    if (!bridge[i]) continue;
    const p = pts[i], r = R[i];
    const arch = new THREE.Mesh(new THREE.TorusGeometry(WALL + 0.6, 0.45, 8, 32, Math.PI), cableMat);
    arch.position.copy(p);
    arch.rotation.y = Math.atan2(-r.z, r.x);
    arch.scale.set(1, 0.8, 1);
    arch.castShadow = true;
    scene.add(arch);
  }

  // start line checker
  const checker = canvasTex(256, 32, (g, w, h) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }, false);
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4), new THREE.MeshStandardMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -4 }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = -Math.atan2(T[0].x, -T[0].z);
  startLine.position.copy(pts[0]).add(new THREE.Vector3(0, 0.04, 0));
  scene.add(startLine);

  // start gate
  const gate = new THREE.Group();
  const pillarG = new THREE.BoxGeometry(1.6, 11, 1.6);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x1149b8, roughness: 0.4, metalness: 0.4 });
  for (const sgn of [-1, 1]) {
    const p = new THREE.Mesh(pillarG, gateMat);
    p.position.set(sgn * (WALL + 1.5), 5.5, 0);
    p.castShadow = true;
    gate.add(p);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(2 * WALL + 4.6, 3.2, 1), [gateMat, gateMat, gateMat, gateMat,
    new THREE.MeshBasicMaterial({ map: textTexture('QQ飞车 START', { font: 'italic 900 120px "PingFang SC","Microsoft YaHei",sans-serif' }) }), new THREE.MeshBasicMaterial({ map: textTexture('海滨小镇') })]);
  banner.position.y = 10;
  banner.castShadow = true;
  gate.add(banner);
  gate.position.copy(pts[0]);
  gate.rotation.y = Math.atan2(-T[0].x, -T[0].z);
  scene.add(gate);

  // boost pads
  const padTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#063';
    g.globalAlpha = 0;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    for (let k = 0; k < 3; k++) {
      const y = 30 + k * 75;
      const grd = g.createLinearGradient(0, y, 0, y + 70);
      grd.addColorStop(0, '#fff');
      grd.addColorStop(1, '#2ef');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(w / 2, y);
      g.lineTo(w - 8, y + 55);
      g.lineTo(w - 36, y + 70);
      g.lineTo(w / 2, y + 30);
      g.lineTo(36, y + 70);
      g.lineTo(8, y + 55);
      g.closePath();
      g.fill();
    }
  }, true);
  const pads = [];
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, color: 0x88ffff, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 });
  for (const [frac, lat] of [[0.08, 0], [0.33, -4], [0.47, 4], [0.7, 0], [0.86, -3]]) {
    const s = frac * L;
    const { p, T: t } = at(s, lat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 9), padMat);
    m.rotation.order = 'YXZ';
    m.rotation.y = Math.atan2(-t.x, -t.z);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(p).add(new THREE.Vector3(0, 0.06, 0));
    scene.add(m);
    pads.push({ s, lat, len: 9, wid: 5 });
  }

  // tunnel
  const tunnel = new THREE.Group();
  {
    const rockTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#5b5148';
      g.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let y = 0; y < h; y += 32) for (let x = -32; x < w; x += 64) {
        const v = 120 + r() * 50 | 0;
        g.fillStyle = `rgb(${v},${v - 12},${v - 26})`;
        g.fillRect(x + ((y / 32) % 2) * 32 + 2, y + 2, 60, 28);
      }
      for (let n = 0; n < 3000; n++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
    });
    const inner = [], outer = [], iuv = [], idx = [];
    const SEG = 18, rIn = WALL + 1.2, r2 = rng(11);
    const a0 = tunnelA - 8, a1 = tunnelB + 8, span = a1 - a0;
    for (let j = 0; j <= span; j += 2) {
      const i = (a0 + j + N) % N, p = pts[i], r = R[i];
      for (let q = 0; q <= SEG; q++) {
        const ang = (q / SEG) * Math.PI;
        const c = Math.cos(ang), s = Math.sin(ang);
        inner.push(p.x + r.x * c * rIn, p.y - 0.6 + s * 10, p.z + r.z * c * rIn);
        const bump = 5 + r2() * 4 + Math.sin(j * 0.13) * 3;
        const ro = rIn + bump;
        outer.push(p.x + r.x * c * ro, p.y - 1 + s * (10 + bump * 1.4), p.z + r.z * c * ro);
        iuv.push(q / 4, j / 10);
      }
    }
    const rows = inner.length / 3 / (SEG + 1);
    for (let j = 0; j < rows - 1; j++) for (let q = 0; q < SEG; q++) {
      const a = j * (SEG + 1) + q, b = a + SEG + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const mk = (arr, side) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(iuv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: rockTex, color: side === THREE.BackSide ? 0x9a9aa8 : 0xffffff, roughness: 1, side }));
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    tunnel.add(mk(inner, THREE.DoubleSide), mk(outer, THREE.DoubleSide));
    // portals: fill between inner and outer at ends
    for (const end of [0, rows - 1]) {
      const pos = [], id = [];
      for (let q = 0; q <= SEG; q++) {
        const k = (end * (SEG + 1) + q) * 3;
        pos.push(inner[k], inner[k + 1], inner[k + 2], outer[k], outer[k + 1], outer[k + 2]);
        if (q < SEG) id.push(q * 2, q * 2 + 1, q * 2 + 2, q * 2 + 1, q * 2 + 3, q * 2 + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(id);
      g.computeVertexNormals();
      tunnel.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.6, side: THREE.DoubleSide })));
    }
    // ceiling lights
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    const lampG = new THREE.BoxGeometry(0.5, 0.2, 3);
    for (let j = 0; j <= span; j += 6) {
      const i = (a0 + j + N) % N, p = pts[i];
      for (const sgn of [-1, 1]) {
        const lamp = new THREE.Mesh(lampG, lampMat);
        lamp.position.set(p.x + R[i].x * sgn * 5, p.y + 8.6, p.z + R[i].z * sgn * 5);
        lamp.lookAt(lamp.position.clone().add(T[i]));
        tunnel.add(lamp);
      }
    }
  }
  scene.add(tunnel);

  // ---------- terrain ----------
  const coarse = [];
  for (let i = 0; i < N; i += 4) coarse.push(i);
  const nearest = (x, z) => {
    let bd = Infinity, bi = 0;
    for (const i of coarse) {
      const dx = pts[i].x - x, dz = pts[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    return { d: Math.sqrt(bd), i: bi };
  };
  const shoreX = (z) => 470 + 40 * Math.sin(z / 95) + 20 * Math.sin(z / 37 + 1);
  const baseH = (x, z) => {
    const sea = x - shoreX(z);
    const hills = Math.max(0, Math.hypot(x - 180, z) - 520) * 0.18 * (0.6 + 0.4 * Math.sin(x / 70) * Math.cos(z / 60));
    const bumps = Math.sin(x / 41) * Math.cos(z / 53) * 1.5;
    const land = hills + bumps + 1;
    if (sea > 0) return Math.max(-9, land - sea * 0.18 - 1.5);
    return land;
  };
  const SIZE = 1800, SEGS = 280;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  tg.rotateX(-Math.PI / 2);
  tg.translate(230, 0, 0);
  const tp = tg.attributes.position;
  const colors = new Float32Array(tp.count * 3);
  const cGrass = new THREE.Color(0x6fbf45), cGrass2 = new THREE.Color(0x4f9a36), cSand = new THREE.Color(0xf0d9a0), cRock = new THREE.Color(0x8d8a78), cTmp = new THREE.Color();
  const groundAt = (x, z) => {
    const { d, i } = nearest(x, z);
    const h = baseH(x, z), ry = pts[i].y;
    if (bridge[i]) return d < WALL + 6 ? Math.min(h, ry - 4) : h;
    return THREE.MathUtils.lerp(ry - 0.6, h, THREE.MathUtils.smoothstep(d, WALL + 3, WALL + 60));
  };
  for (let v = 0; v < tp.count; v++) {
    const x = tp.getX(v), z = tp.getZ(v);
    const h = groundAt(x, z);
    tp.setY(v, h);
    const sea = x - shoreX(z);
    if (sea > -25 && h < 2.5) cTmp.copy(cSand);
    else if (h > 25) cTmp.copy(cRock).lerp(cGrass2, 0.3);
    else cTmp.copy(cGrass).lerp(cGrass2, 0.5 + 0.5 * Math.sin(x / 23) * Math.cos(z / 29));
    colors[v * 3] = cTmp.r;
    colors[v * 3 + 1] = cTmp.g;
    colors[v * 3 + 2] = cTmp.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  const grassTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ddd';
    g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let n = 0; n < 5000; n++) {
      const v = 190 + r() * 65 | 0;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * w, r() * h, 2, 2 + r() * 3);
    }
  });
  grassTex.repeat.set(160, 160);
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, map: grassTex, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- sea ----------
  const waterNormal = canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = (x / w) * Math.PI * 2, b = (y / h) * Math.PI * 2;
      const nx = Math.cos(a * 3 + b * 2) * 0.5 + Math.cos(a * 7 - b * 5) * 0.25;
      const ny = Math.cos(b * 4 - a) * 0.5 + Math.sin(b * 9 + a * 3) * 0.25;
      const k = (y * w + x) * 4;
      img.data[k] = 128 + nx * 90;
      img.data[k + 1] = 128 + ny * 90;
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  waterNormal.colorSpace = THREE.NoColorSpace;
  waterNormal.repeat.set(60, 60);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x1e8fd0, roughness: 0.08, metalness: 0.35, normalMap: waterNormal, normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.9 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.2;
  water.receiveShadow = true;
  scene.add(water);

  // ---------- scenery ----------
  const r = rng(2024);
  const onLand = (x, z) => x < shoreX(z) - 20;
  const dummy = new THREE.Object3D();

  // palms
  const palmSpots = [];
  for (let n = 0; n < 5000 && palmSpots.length < 420; n++) {
    const i = Math.floor(r() * N), side = r() < 0.5 ? -1 : 1, off = WALL + 6 + r() * 30;
    const x = pts[i].x + R[i].x * side * off, z = pts[i].z + R[i].z * side * off;
    if (!onLand(x, z) || nearest(x, z).d < WALL + 5) continue;
    palmSpots.push([x, z]);
  }
  for (let n = 0; n < 250; n++) {
    const x = -500 + r() * 1100, z = -700 + r() * 1400;
    if (onLand(x, z) && nearest(x, z).d > WALL + 10) palmSpots.push([x, z]);
  }
  const trunkG = new THREE.CylinderGeometry(0.28, 0.5, 9, 7);
  trunkG.translate(0, 4.5, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 1 }), palmSpots.length);
  const leafG = new THREE.ConeGeometry(0.9, 6, 4, 1, true);
  leafG.rotateZ(Math.PI / 2);
  leafG.translate(3, 0, 0);
  leafG.scale(1, 0.25, 1);
  const LEAVES = 7;
  const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0x2fa845, roughness: 0.8, side: THREE.DoubleSide }), palmSpots.length * LEAVES);
  palmSpots.forEach(([x, z], k) => {
    const y = groundAt(x, z), s = 0.8 + r() * 0.6, lean = (r() - 0.5) * 0.3;
    dummy.position.set(x, y, z);
    dummy.rotation.set(lean, r() * 6, lean * 0.5);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    trunks.setMatrixAt(k, dummy.matrix);
    const top = new THREE.Vector3(0, 9, 0).applyMatrix4(dummy.matrix);
    for (let q = 0; q < LEAVES; q++) {
      dummy.position.copy(top);
      dummy.rotation.set(0, (q / LEAVES) * Math.PI * 2 + r(), -0.35 - r() * 0.3, 'YXZ');
      dummy.rotation.order = 'YZX';
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      leaves.setMatrixAt(k * LEAVES + q, dummy.matrix);
    }
  });
  trunks.castShadow = leaves.castShadow = true;
  scene.add(trunks, leaves);

  // houses
  const houseSpots = [];
  for (let n = 0; n < 4000 && houseSpots.length < 140; n++) {
    const i = Math.floor(r() * N), side = r() < 0.5 ? -1 : 1, off = WALL + 22 + r() * 60;
    const x = pts[i].x + R[i].x * side * off, z = pts[i].z + R[i].z * side * off;
    if (!onLand(x, z) || nearest(x, z).d < WALL + 18) continue;
    if (houseSpots.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < 20)) continue;
    houseSpots.push([x, z, Math.atan2(R[i].x, R[i].z) + (side > 0 ? Math.PI : 0)]);
  }
  const wallsTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#6ec6ff';
    for (let y = 18; y < h; y += 44) for (let x = 14; x < w; x += 40) {
      g.fillRect(x, y, 22, 24);
      g.fillStyle = '#fff';
      g.fillRect(x + 10, y, 2, 24);
      g.fillStyle = '#6ec6ff';
    }
  });
  const houseG = new THREE.BoxGeometry(1, 1, 1);
  houseG.translate(0, 0.5, 0);
  const roofG = new THREE.ConeGeometry(0.78, 0.6, 4);
  roofG.rotateY(Math.PI / 4);
  roofG.translate(0, 0.3, 0);
  const houses = new THREE.InstancedMesh(houseG, new THREE.MeshStandardMaterial({ map: wallsTex, roughness: 0.8 }), houseSpots.length);
  const roofs = new THREE.InstancedMesh(roofG, new THREE.MeshStandardMaterial({ roughness: 0.6 }), houseSpots.length);
  const wallColors = [0xfff4e0, 0xffe0e8, 0xe0f4ff, 0xfffbd0, 0xe8ffe0];
  const roofColors = [0xe8452c, 0x2f7de1, 0xf28c1c, 0x1fa37a, 0xc23a8a];
  houseSpots.forEach(([x, z, ry], k) => {
    const w = 8 + r() * 8, d = 8 + r() * 6, h = 6 + r() * 10;
    const y = groundAt(x, z) - 0.5;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    houses.setMatrixAt(k, dummy.matrix);
    houses.setColorAt(k, new THREE.Color(wallColors[k % wallColors.length]));
    dummy.position.y = y + h;
    dummy.scale.set(w * 1.15, 3 + r() * 3, d * 1.15);
    dummy.updateMatrix();
    roofs.setMatrixAt(k, dummy.matrix);
    roofs.setColorAt(k, new THREE.Color(roofColors[(k * 7) % roofColors.length]));
  });
  houses.castShadow = houses.receiveShadow = roofs.castShadow = true;
  scene.add(houses, roofs);

  // lighthouse
  const lh = new THREE.Group();
  const stripe = canvasTex(64, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 64) { g.fillStyle = (y / 64) % 2 ? '#fff' : '#e12a2a'; g.fillRect(0, y, w, 64); }
  }, false);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 34, 20), new THREE.MeshStandardMaterial({ map: stripe }));
  tower.position.y = 17;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6a0 }));
  lamp.position.y = 36;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(4, 4, 20), new THREE.MeshStandardMaterial({ color: 0x223355 }));
  cap.position.y = 40;
  tower.castShadow = true;
  lh.add(tower, lamp, cap);
  lh.position.set(shoreX(-150) + 10, 0, -150);
  lh.position.y = groundAt(lh.position.x, lh.position.z);
  scene.add(lh);

  // sailboats
  const boats = [];
  for (let k = 0; k < 9; k++) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 9), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    const sail = new THREE.Mesh(new THREE.ConeGeometry(3, 10, 3), new THREE.MeshStandardMaterial({ color: [0xff5a5a, 0xffd23a, 0x5ab4ff][k % 3], side: THREE.DoubleSide }));
    sail.scale.z = 0.08;
    sail.position.y = 6;
    b.add(hull, sail);
    b.position.set(640 + r() * 700, -1, -500 + r() * 1000);
    b.rotation.y = r() * 6;
    scene.add(b);
    boats.push(b);
  }

  // hot air balloons
  const balloons = [];
  for (let k = 0; k < 6; k++) {
    const b = new THREE.Group();
    const env = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 16), new THREE.MeshStandardMaterial({ color: [0xff4f8b, 0x3ad0ff, 0xffc93a, 0x7cff5a, 0xb07cff, 0xff8a3a][k], roughness: 0.5 }));
    env.scale.y = 1.2;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.4), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
    basket.position.y = -11;
    b.add(env, basket);
    b.position.set(-300 + r() * 900, 70 + r() * 60, -500 + r() * 1000);
    scene.add(b);
    balloons.push(b);
  }

  // chevron signs on sharp corners
  const chevTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#ffd400';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    for (let k = 0; k < 3; k++) {
      const x = 30 + k * 72;
      g.beginPath();
      g.moveTo(x, 14); g.lineTo(x + 44, h / 2); g.lineTo(x, h - 14); g.lineTo(x + 20, h - 14); g.lineTo(x + 64, h / 2); g.lineTo(x + 20, 14);
      g.closePath();
      g.fill();
    }
  }, false);
  const chevMat = new THREE.MeshStandardMaterial({ map: chevTex, emissive: 0x332200, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x777777 });
  for (let i = 0; i < N; i += 18) {
    if (Math.abs(K[i]) < 1 / 90 || bridge[i] || (i > tunnelA - 12 && i < tunnelB + 12)) continue;
    const side = K[i] > 0 ? -1 : 1;
    const p = pts[i], rr = R[i];
    const sign = new THREE.Group();
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), chevMat);
    board.position.y = 2.6;
    board.scale.x = -side;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), postMat);
    post.position.y = 1.3;
    sign.add(board, post);
    sign.position.set(p.x + rr.x * side * (WALL + 2.2), p.y, p.z + rr.z * side * (WALL + 2.2));
    sign.lookAt(sign.position.clone().sub(T[i]));
    scene.add(sign);
  }

  // billboards
  const ads = ['漂移之王', '集气小喷', '双喷起飞', '海滨小镇', '氮气加速', 'QQ飞车'];
  for (let k = 0; k < 10; k++) {
    const i = Math.floor((k / 10) * N + 60) % N;
    if (bridge[i]) continue;
    const side = k % 2 ? 1 : -1, rr = R[i], p = pts[i];
    const bb = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 0.5), new THREE.MeshBasicMaterial({ map: textTexture(ads[k % ads.length], { bg: ['#d92b6c', '#0a3a8a', '#16a34a', '#f59e0b'][k % 4] }) }));
    board.position.y = 8;
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), postMat);
    leg1.position.set(-6, 3, 0);
    const leg2 = leg1.clone();
    leg2.position.x = 6;
    bb.add(board, leg1, leg2);
    bb.position.set(p.x + rr.x * side * (WALL + 9), p.y, p.z + rr.z * side * (WALL + 9));
    bb.lookAt(p.x, p.y, p.z);
    board.castShadow = true;
    scene.add(bb);
  }

  const update = (t) => {
    waterNormal.offset.set(t * 0.01, t * 0.006);
    balloons.forEach((b, k) => { b.position.y += Math.sin(t * 0.5 + k) * 0.02; });
    boats.forEach((b, k) => { b.rotation.z = Math.sin(t + k) * 0.06; });
    lamp.material.color.setHSL(0.14, 1, 0.6 + 0.3 * Math.sin(t * 3));
  };

  return { pts, T, R, K, N, L, ds, query, at, pads, bridge, update };
}
