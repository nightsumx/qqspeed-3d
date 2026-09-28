import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTrack, WALL } from './track.js';
import { buildKart } from './kart.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const LAPS = 3;
const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 5000);
scene.add(camera);

const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(210));
const sky = new Sky();
sky.scale.setScalar(4500);
const su = sky.material.uniforms;
su.turbidity.value = 3;
su.rayleigh.value = 1.2;
su.mieCoefficient.value = 0.004;
su.mieDirectionalG.value = 0.85;
su.sunPosition.value.copy(sun);
scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const s2 = new Sky();
  s2.scale.setScalar(100);
  Object.assign(s2.material.uniforms.sunPosition.value, sun);
  s2.material.uniforms.turbidity.value = 3;
  s2.material.uniforms.rayleigh.value = 1.2;
  envScene.add(s2);
  scene.environment = pm.fromScene(envScene).texture;
  scene.environmentIntensity = 0.35;
}
scene.fog = new THREE.Fog(0xa8d4f5, 600, 2600);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a8a4a, 1.1);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff1d6, 3.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.04;
scene.add(sunLight, sunLight.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.4, 0.97);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const track = buildTrack(scene);
const { query, at, L } = track;

// ---------- karts ----------
const player = {
  kart: buildKart(0xff2d6f, 0xffffff),
  x: 0, z: 0, y: 0, th: 0, phi: 0, v: 0, idx: 0, s: 0, lat: 0,
  drifting: false, recovering: false, dDir: 0, charge: 0, nitros: 0,
  boostT: 0, boostKind: '', jetWin: 0, dblWin: 0, dblDelay: 0,
  progress: 0, maxLap: 0, lapStart: 0, best: Infinity, finished: false, finishTime: 0,
  stats: { drifts: 0, jets: 0, doubles: 0, nitros: 0 },
};
scene.add(player.kart.group);

const botDefs = [
  { name: '小橘子', color: 0xff9a1f, accent: 0x222222, vmax: 55, off: -3 },
  { name: '阿飞', color: 0x2f8cff, accent: 0xffe14a, vmax: 53.5, off: 3.5 },
  { name: '宝宝', color: 0x33d17a, accent: 0xffffff, vmax: 52, off: 0 },
];
const bots = botDefs.map((d) => {
  const kart = buildKart(d.color, d.accent, d.name);
  scene.add(kart.group);
  return { ...d, kart, s: 0, lat: 0, v: 0, x: 0, z: 0, progress: 0, boostT: 0, nitroCD: 8 + Math.random() * 10, yawOff: 0, finished: false, finishTime: 0, lastLapS: 0 };
});
const racers = [player, ...bots];
$('rankTotal').textContent = racers.length;
$('lapTotal').textContent = LAPS;

// ---------- effects ----------
const SKID = 900;
const skidMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.36, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8 }), SKID);
skidMesh.frustumCulled = false;
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < SKID; i++) skidMesh.setMatrixAt(i, hidden);
scene.add(skidMesh);
let skidI = 0;
const skidDummy = new THREE.Object3D();
const lastSkid = [null, null];

const SPARKS = 500;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3), sparkCol = new Float32Array(SPARKS * 3);
const sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
const sparkTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.45, map: sparkTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
sparks.frustumCulled = false;
scene.add(sparks);
let sparkI = 0;
const emitSpark = (p, vx, vy, vz, c, life = 0.5) => {
  const i = sparkI++ % SPARKS;
  sparkPos.set([p.x, p.y, p.z], i * 3);
  sparkVel.set([vx, vy, vz], i * 3);
  sparkCol.set([c.r, c.g, c.b], i * 3);
  sparkLife[i] = life;
};

const SMOKE = 120;
const smokeMat = new THREE.SpriteMaterial({ map: sparkTex, color: 0xdddddd, transparent: true, opacity: 0.35, depthWrite: false });
const smoke = [];
for (let i = 0; i < SMOKE; i++) {
  const s = new THREE.Sprite(smokeMat.clone());
  s.visible = false;
  scene.add(s);
  smoke.push({ s, life: 0 });
}
let smokeI = 0;
const emitSmoke = (p) => {
  const o = smoke[smokeI++ % SMOKE];
  o.s.position.copy(p);
  o.s.visible = true;
  o.life = 1;
  o.s.scale.setScalar(0.8);
};

const LINES = 160;
const lineGeo = new THREE.BufferGeometry();
const linePos = new Float32Array(LINES * 6);
lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
const speedLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
speedLines.frustumCulled = false;
camera.add(speedLines);
const lineSeed = [];
for (let i = 0; i < LINES; i++) {
  const a = Math.random() * TAU, r = 2.2 + Math.random() * 5;
  lineSeed.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, z: -Math.random() * 60 });
}

// ---------- input ----------
const keys = { up: false, down: false, left: false, right: false, drift: false, nitro: false };
const edges = { up: false, nitro: false };
const codeMap = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'drift', ShiftRight: 'drift', ControlLeft: 'nitro', ControlRight: 'nitro', Space: 'nitro',
};
const press = (k, down) => {
  if (down && !keys[k] && k in edges) edges[k] = true;
  keys[k] = down;
};
addEventListener('keydown', (e) => {
  const k = codeMap[e.code];
  if (k) { e.preventDefault(); press(k, true); }
  if (e.repeat) return;
  if (e.code === 'KeyR' && state === 'race') resetPlayer();
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') toast(audio.toggleMute() ? '已静音' : '声音开启', 0.8);
  if (e.code === 'Escape' && (state === 'race' || state === 'count')) setPaused(!paused);
});
addEventListener('keyup', (e) => {
  const k = codeMap[e.code];
  if (k) { e.preventDefault(); press(k, false); }
});
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (state === 'race') setPaused(true);
});
for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(k, true); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => press(k, false));
}

// ---------- ui ----------
const audio = createAudio();
let toastT = 0;
const toast = (msg, dur = 1.1, color = '#ffe14a') => {
  const el = $('toast');
  el.textContent = msg;
  el.style.color = color;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  toastT = dur;
};
const fmt = (t) => {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

// ---------- race state ----------
let state = 'menu', paused = false, raceT = 0, countT = 0, camMode = 0, shake = 0, lastCount = -1, startBoostTried = false;

const placeGrid = () => {
  const grid = [[-14, 4.5], [-14, -4.5], [-24, 4.5], [-24, -4.5]];
  racers.forEach((r, k) => {
    const [ds, lat] = grid[k];
    const g = at(L + ds, lat);
    r.s = L + ds;
    r.lat = lat;
    r.x = g.p.x;
    r.z = g.p.z;
    r.y = g.p.y;
    r.v = 0;
    r.progress = ds;
    r.lastS = r.s % L;
    r.finished = false;
    r.boostT = 0;
    if (r === player) {
      r.th = r.phi = Math.atan2(g.T.x, g.T.z);
      r.idx = g.i;
      Object.assign(r, { drifting: false, recovering: false, charge: 0, nitros: 0, jetWin: 0, dblWin: 0, maxLap: 0, lapStart: 0, best: Infinity, stats: { drifts: 0, jets: 0, doubles: 0, nitros: 0 } });
    }
  });
};

const resetPlayer = () => {
  const q = query(player.x, player.z, player.idx);
  const g = at(q.s, clamp(q.lat, -5, 5));
  player.x = g.p.x;
  player.z = g.p.z;
  player.th = player.phi = Math.atan2(g.T.x, g.T.z);
  player.v = 0;
  player.drifting = false;
  toast('复位', 0.6, '#fff');
};

const setPaused = (p) => {
  paused = p;
  $('pause').classList.toggle('hidden', !p);
};

const startRace = () => {
  audio.init();
  audio.startBgm();
  placeGrid();
  raceT = 0;
  countT = 0;
  lastCount = -1;
  startBoostTried = false;
  state = 'count';
  setPaused(false);
  $('menu').classList.add('hidden');
  $('result').classList.add('hidden');
  $('hud').classList.remove('hidden');
  for (let i = 0; i < SKID; i++) skidMesh.setMatrixAt(i, hidden);
  skidMesh.instanceMatrix.needsUpdate = true;
};
$('start').onclick = startRace;
$('again').onclick = startRace;
$('restart').onclick = startRace;
$('resume').onclick = () => setPaused(false);
$('loading').textContent = '赛道载入完成 · 按 Enter 或点击开始';
addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && (state === 'menu' || state === 'done')) startRace();
});

// ---------- physics ----------
const trackProgress = (r, s) => {
  let d = s - r.lastS;
  if (d > L / 2) d -= L;
  if (d < -L / 2) d += L;
  r.lastS = s;
  r.progress += d;
};

const stepPlayer = (dt) => {
  const P = player;
  const canDrive = state === 'race' && !P.finished;
  const up = canDrive && keys.up, down = canDrive && keys.down;
  const steer = canDrive ? (keys.left ? 1 : 0) - (keys.right ? 1 : 0) : 0;
  const upEdge = canDrive && edges.up;
  const nitroEdge = canDrive && edges.nitro;

  if (nitroEdge && P.nitros > 0 && !(P.boostKind === 'nitro' && P.boostT > 0)) {
    P.nitros--;
    P.boostT = 2.6;
    P.boostKind = 'nitro';
    P.stats.nitros++;
    audio.boost();
    toast('氮 气 加 速', 1, '#6ff');
  }

  const boosting = P.boostT > 0;
  const vmax = boosting ? (P.boostKind === 'nitro' ? 70 : 61) : 50;
  if (boosting) {
    P.boostT -= dt;
    P.v += (P.boostKind === 'nitro' ? 34 : 26) * dt;
  }
  if (up) P.v += 24 * Math.max(0, 1 - P.v / vmax) * dt + (P.v < 8 ? 8 * dt : 0);
  else if (down) P.v = P.v > 0.5 ? P.v - 38 * dt : Math.max(-14, P.v - 12 * dt);
  else P.v -= Math.sign(P.v) * Math.min(Math.abs(P.v), 5 * dt);
  if (P.v > vmax) P.v -= (P.v - vmax) * 1.6 * dt;

  // drift state machine: grip → drifting → recovering → grip (+ jet window)
  if (canDrive && keys.drift && steer !== 0 && P.v > 12 && !P.drifting) {
    P.drifting = true;
    P.recovering = false;
    P.dDir = steer;
    P.jetArmed = true;
    P.stats.drifts++;
  }
  let yaw, grip;
  const slip = wrap(P.th - P.phi);
  if (P.drifting) {
    if (!keys.drift) P.recovering = true;
    if (!P.recovering) {
      yaw = P.dDir * (1.25 + 0.8 * steer * P.dDir);
      grip = 2.3;
    } else {
      yaw = steer * 1.3 - slip * 2.2;
      grip = 6;
    }
    P.v -= P.v * 0.1 * dt;
    P.charge += (P.v / 50) * Math.min(Math.abs(slip), 0.9) * 0.55 * dt;
    if (P.recovering && P.jetArmed && Math.abs(slip) < 0.3) {
      P.jetArmed = false;
      P.jetWin = 0.4;
    }
    if ((P.recovering && Math.abs(slip) < 0.07) || P.v < 8) {
      P.drifting = false;
      P.recovering = false;
    }
  } else {
    yaw = steer * (1.9 * clamp(Math.abs(P.v) / 10, 0, 1)) / (1 + Math.abs(P.v) / 42) * Math.sign(P.v || 1);
    grip = 14;
    P.v -= Math.abs(yaw) * P.v * 0.04 * dt;
  }
  if (P.jetWin > 0) {
    P.jetWin -= dt;
    if (upEdge) {
      P.jetWin = 0;
      P.boostT = Math.max(P.boostT, 0.75);
      if (P.boostKind !== 'nitro' || P.boostT <= 0.75) P.boostKind = 'jet';
      P.v += 4;
      P.charge += 0.06;
      P.dblDelay = 0.1;
      P.dblWin = 0.55;
      P.stats.jets++;
      audio.boost();
      toast('小 喷 !', 0.8);
    }
  } else if (P.dblWin > 0) {
    P.dblDelay -= dt;
    P.dblWin -= dt;
    if (upEdge && P.dblDelay <= 0) {
      P.dblWin = 0;
      P.boostT = Math.max(P.boostT, 0) + 0.7;
      P.v += 4;
      P.charge += 0.06;
      P.stats.doubles++;
      audio.boost();
      toast('双 喷 !!', 0.9, '#ff7ad9');
    }
  }
  if (P.charge >= 1) {
    if (P.nitros < 2) {
      P.nitros++;
      audio.ding();
      toast('获得氮气', 0.7, '#6ff');
    }
    P.charge = P.nitros < 2 ? P.charge - 1 : 1;
  }

  P.th += yaw * dt;
  if (P.v < 0) P.phi = P.th;
  else P.phi += wrap(P.th - P.phi) * Math.min(1, grip * dt);
  P.x += Math.sin(P.phi) * P.v * dt;
  P.z += Math.cos(P.phi) * P.v * dt;

  // walls
  const q = query(P.x, P.z, P.idx);
  P.idx = q.i;
  const lim = WALL - 1.25;
  if (Math.abs(q.lat) > lim) {
    const sg = Math.sign(q.lat), over = q.lat - sg * lim;
    P.x -= q.R.x * over;
    P.z -= q.R.z * over;
    let vx = Math.sin(P.phi) * P.v, vz = Math.cos(P.phi) * P.v;
    const vn = (vx * q.R.x + vz * q.R.z) * sg;
    if (vn > 0) {
      vx -= q.R.x * sg * vn * 1.3;
      vz -= q.R.z * sg * vn * 1.3;
      const sp = Math.hypot(vx, vz) * (1 - Math.min(0.35, vn / 60));
      if (P.v > 0) {
        P.phi = Math.atan2(vx, vz);
        P.v = sp;
        P.th += wrap(P.phi - P.th) * 0.35;
      } else P.v *= 0.5;
      if (vn > 7) {
        shake = Math.min(1, vn / 25);
        audio.crash();
        P.drifting = false;
      }
    }
  }
  const q2 = query(P.x, P.z, P.idx);
  P.s = q2.s;
  P.lat = q2.lat;
  P.y = q2.y;
  P.slope = q2.T.y;
  P.trackTh = Math.atan2(q2.T.x, q2.T.z);

  for (const pad of track.pads) {
    let d = P.s - pad.s;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    if (Math.abs(d) < pad.len / 2 && Math.abs(P.lat - pad.lat) < pad.wid / 2 + 0.6 && !(P.boostT > 0.4 && P.boostKind === 'pad')) {
      P.boostT = Math.max(P.boostT, 1.1);
      if (P.boostKind !== 'nitro') P.boostKind = 'pad';
      P.v = Math.max(P.v, 52);
      audio.boost();
      toast('加 速 带', 0.6, '#7ff');
    }
  }

  edges.up = edges.nitro = false;
};

const stepBot = (b, dt) => {
  const go = state === 'race';
  const ahead = at(b.s + 22 + b.v * 0.5);
  const near = at(b.s + 8);
  const k = Math.abs(ahead.k) > Math.abs(near.k) ? ahead.k : near.k;
  const rubber = 1 + clamp((player.progress - b.progress) / 400, -0.12, 0.14);
  if (b.boostT > 0) b.boostT -= dt;
  if (go) b.nitroCD -= dt;
  if (b.nitroCD < 0 && Math.abs(k) < 1 / 200) {
    b.boostT = 2.2;
    b.nitroCD = 12 + Math.random() * 14;
  }
  const vmax = b.finished ? 25 : b.vmax * rubber * (b.boostT > 0 ? 1.3 : 1);
  const vt = go ? Math.min(vmax, Math.sqrt(52 / Math.max(Math.abs(k), 1e-4))) : 0;
  b.v += clamp(vt - b.v, -30 * dt, (b.v < 20 ? 16 : 11) * dt);
  const latT = clamp(k * 650, -6.5, 6.5) + b.off * (1 - Math.min(1, Math.abs(k) * 80));
  b.lat += clamp(latT - b.lat, -4 * dt, 4 * dt);
  b.s = (b.s + b.v * dt) % L;
  const g = at(b.s, b.lat);
  b.x = g.p.x;
  b.z = g.p.z;
  b.y = g.p.y;
  b.T = g.T;
  const driftTarget = Math.abs(k) > 1 / 75 && b.v > 25 ? -Math.sign(k) * 0.5 : 0;
  b.yawOff += (driftTarget - b.yawOff) * Math.min(1, 4 * dt);
};

const collide = () => {
  for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
    const a = racers[i], b = racers[j];
    const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
    if (d > 2.6 || d < 1e-3) continue;
    const nx = dx / d, nz = dz / d, pen = 2.6 - d;
    if (a === player) {
      a.x += nx * pen * 0.7;
      a.z += nz * pen * 0.7;
      const vn = Math.sin(a.phi) * a.v * nx + Math.cos(a.phi) * a.v * nz;
      if (vn < -2) { a.v *= 0.9; shake = 0.3; audio.crash(); }
      const rr = at(b.s).R;
      b.lat = clamp(b.lat - (nx * rr.x + nz * rr.z) * pen * 0.3, -WALL + 1.3, WALL - 1.3);
    } else {
      const ra = at(a.s).R;
      const side = (nx * ra.x + nz * ra.z) * pen * 0.5;
      a.lat = clamp(a.lat + side, -WALL + 1.3, WALL - 1.3);
      b.lat = clamp(b.lat - side, -WALL + 1.3, WALL - 1.3);
    }
  }
};

// ---------- visuals ----------
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const colJet = new THREE.Color(0xffc23a), colNitro = new THREE.Color(0x66ddff), colDrift = [new THREE.Color(0x5fd3ff), new THREE.Color(0xffe14a), new THREE.Color(0xff5ad0)];

const poseKart = (r, th, dt, steerVis, roll, pitch) => {
  const k = r.kart;
  k.group.position.set(r.x, r.y, r.z);
  k.group.rotation.set(0, th, 0);
  k.body.rotation.set(pitch, 0, roll);
  const spin = (r.v * dt) / 0.42;
  for (const w of k.wheels) {
    w.spin.rotation.x += spin;
    if (w.front) w.pivot.rotation.y = steerVis;
  }
  const on = r.boostT > 0;
  k.flames.forEach((f) => {
    f.visible = on;
    if (on) {
      const nitro = r === player ? r.boostKind === 'nitro' : true;
      f.material.color.copy(nitro ? colNitro : colJet);
      f.scale.set(1, 1, (nitro ? 1.3 : 0.9) * (0.8 + Math.random() * 0.5));
    }
  });
};

const addSkid = (p, ang) => {
  skidDummy.position.set(p.x, p.y + 0.05, p.z);
  skidDummy.rotation.set(0, ang, 0);
  skidDummy.updateMatrix();
  skidMesh.setMatrixAt(skidI++ % SKID, skidDummy.matrix);
  skidMesh.instanceMatrix.needsUpdate = true;
};

let camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camYaw = 0, camInit = false, fov = 68;

const updateVisuals = (dt, t) => {
  const P = player;
  const slip = wrap(P.th - P.phi);
  const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  const slopeFwd = P.slope * Math.cos(P.th - P.trackTh);
  poseKart(P, P.th, dt, steer * 0.4 + (P.drifting ? -slip * 0.6 : 0), -slip * 0.22 - steer * 0.03 * Math.min(1, P.v / 30), -Math.asin(clamp(slopeFwd, -1, 1)));

  for (const b of bots) {
    const th = Math.atan2(b.T.x, b.T.z) + b.yawOff;
    poseKart(b, th, dt, -b.yawOff * 0.6, b.yawOff * 0.2, 0);
    if (Math.abs(b.yawOff) > 0.3 && Math.random() < 0.5) {
      tmpV.set(0, 0.3, -1.3).applyAxisAngle(THREE.Object3D.DEFAULT_UP, th).add(b.kart.group.position);
      emitSpark(tmpV, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, colDrift[0], 0.3);
    }
  }

  // drift fx
  if (P.drifting && P.v > 10) {
    const lvl = P.charge > 0.66 ? 2 : P.charge > 0.33 ? 1 : 0;
    for (let w = 0; w < 2; w++) {
      tmpV.set(w ? 1.05 : -1.05, 0.05, -1.2).applyAxisAngle(THREE.Object3D.DEFAULT_UP, P.th).add(P.kart.group.position);
      const last = lastSkid[w];
      if (!last || last.distanceTo(tmpV) > 0.7) {
        addSkid(tmpV, P.phi);
        lastSkid[w] = tmpV.clone();
      }
      for (let n = 0; n < 3; n++) {
        emitSpark(tmpV, (Math.random() - 0.5) * 5 - Math.sin(P.phi) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 5 - Math.cos(P.phi) * 4, colDrift[lvl], 0.35 + Math.random() * 0.25);
      }
      if (Math.random() < 0.35) emitSmoke(tmpV);
    }
  } else {
    lastSkid[0] = lastSkid[1] = null;
  }
  if (P.boostT > 0) {
    for (let n = 0; n < 2; n++) {
      tmpV.set((Math.random() - 0.5) * 0.8, 0.45, -2.2).applyAxisAngle(THREE.Object3D.DEFAULT_UP, P.th).add(P.kart.group.position);
      emitSpark(tmpV, -Math.sin(P.th) * 10, Math.random(), -Math.cos(P.th) * 10, P.boostKind === 'nitro' ? colNitro : colJet, 0.25);
    }
  }
  for (let i = 0; i < SPARKS; i++) {
    if (sparkLife[i] <= 0) continue;
    sparkLife[i] -= dt;
    sparkVel[i * 3 + 1] -= 9 * dt;
    for (let a = 0; a < 3; a++) sparkPos[i * 3 + a] += sparkVel[i * 3 + a] * dt;
    if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -999;
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.color.needsUpdate = true;
  for (const o of smoke) {
    if (o.life <= 0) continue;
    o.life -= dt * 1.4;
    o.s.position.y += dt * 1.2;
    o.s.scale.setScalar(0.8 + (1 - o.life) * 3.5);
    o.s.material.opacity = Math.max(0, o.life) * 0.35;
    if (o.life <= 0) o.s.visible = false;
  }

  // camera: follows velocity direction so drifts show the kart sideways
  const targetYaw = P.v < -1 ? P.th : P.phi + slip * 0.25;
  if (!camInit) { camYaw = targetYaw; camInit = true; }
  camYaw += wrap(targetYaw - camYaw) * Math.min(1, 5 * dt);
  const [dist, h, lookH] = [[6.8, 2.6, 1.3], [4.6, 1.7, 1.0], [0.2, 1.55, 1.4]][camMode];
  const fwd = tmpV.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  const desired = tmpV2.copy(P.kart.group.position).addScaledVector(fwd, -dist - Math.min(P.v, 70) * 0.02).add(new THREE.Vector3(0, h, 0));
  if (camMode === 2) desired.copy(P.kart.group.position).addScaledVector(new THREE.Vector3(Math.sin(P.th), 0, Math.cos(P.th)), 0.2).setY(P.y + h);
  if (camPos.lengthSq() === 0 || camMode === 2) camPos.copy(desired);
  else camPos.lerp(desired, Math.min(1, 10 * dt));
  const groundQ = query(camPos.x, camPos.z, P.idx);
  if (Math.abs(groundQ.lat) < WALL + 1) camPos.y = Math.max(camPos.y, groundQ.y + 0.8);
  camera.position.copy(camPos);
  const lookFwd = camMode === 2 ? new THREE.Vector3(Math.sin(P.th), 0, Math.cos(P.th)) : fwd;
  camLook.copy(P.kart.group.position).addScaledVector(lookFwd, camMode === 2 ? 20 : 4).add(new THREE.Vector3(0, lookH, 0));
  camera.lookAt(camLook);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    shake = Math.max(0, shake - dt * 2.5);
  }
  const boostF = P.boostT > 0 ? (P.boostKind === 'nitro' ? 20 : 12) : 0;
  fov += (68 + Math.max(0, P.v) * 0.18 + boostF - fov) * Math.min(1, 4 * dt);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  P.kart.body.visible = camMode !== 2;

  // speed lines
  const intensity = P.boostT > 0 ? 0.35 : clamp((P.v - 48) / 30, 0, 0.15);
  speedLines.material.opacity += (intensity - speedLines.material.opacity) * Math.min(1, 6 * dt);
  if (speedLines.material.opacity > 0.01) {
    lineSeed.forEach((l, i) => {
      l.z += (P.v + 40) * dt;
      if (l.z > -2) l.z = -60 - Math.random() * 10;
      linePos.set([l.x, l.y, l.z, l.x, l.y, l.z - 3 - P.v * 0.08], i * 6);
    });
    lineGeo.attributes.position.needsUpdate = true;
  }

  sunLight.position.copy(P.kart.group.position).addScaledVector(sun, 200);
  sunLight.target.position.copy(P.kart.group.position);
  bloom.strength = 0.2 + (P.boostT > 0 ? 0.25 : 0);
  track.update(t);
};

// ---------- minimap ----------
const mm = $('minimap'), mg = mm.getContext('2d');
const bounds = track.pts.reduce((b, p) => [Math.min(b[0], p.x), Math.max(b[1], p.x), Math.min(b[2], p.z), Math.max(b[3], p.z)], [Infinity, -Infinity, Infinity, -Infinity]);
const mmScale = 170 / Math.max(bounds[1] - bounds[0], bounds[3] - bounds[2]);
const mmX = (x) => 110 + (x - (bounds[0] + bounds[1]) / 2) * mmScale;
const mmY = (z) => 110 + (z - (bounds[2] + bounds[3]) / 2) * mmScale;
const drawMinimap = () => {
  mg.clearRect(0, 0, 220, 220);
  mg.lineJoin = 'round';
  for (const [w, c] of [[9, 'rgba(0,0,0,.5)'], [6, '#e8f6ff']]) {
    mg.beginPath();
    track.pts.forEach((p, i) => (i % 6 ? mg.lineTo(mmX(p.x), mmY(p.z)) : i ? mg.lineTo(mmX(p.x), mmY(p.z)) : mg.moveTo(mmX(p.x), mmY(p.z))));
    mg.closePath();
    mg.lineWidth = w;
    mg.strokeStyle = c;
    mg.stroke();
  }
  const s0 = track.pts[0];
  mg.fillStyle = '#111';
  mg.fillRect(mmX(s0.x) - 6, mmY(s0.z) - 1.5, 12, 3);
  for (const b of bots) {
    mg.fillStyle = '#' + b.kart.body.children[0].material.color.getHexString();
    mg.beginPath();
    mg.arc(mmX(b.x), mmY(b.z), 4.5, 0, TAU);
    mg.fill();
  }
  const px = mmX(player.x), py = mmY(player.z);
  mg.save();
  mg.translate(px, py);
  mg.rotate(-player.th + Math.PI);
  mg.fillStyle = '#ff2d6f';
  mg.strokeStyle = '#fff';
  mg.lineWidth = 2;
  mg.beginPath();
  mg.moveTo(0, -8);
  mg.lineTo(6, 6);
  mg.lineTo(0, 3);
  mg.lineTo(-6, 6);
  mg.closePath();
  mg.fill();
  mg.stroke();
  mg.restore();
};

// ---------- hud ----------
const updateHud = (dt) => {
  const P = player;
  $('speed').textContent = Math.round(Math.abs(P.v) * 3.6);
  $('gear').textContent = P.boostT > 0 ? (P.boostKind === 'nitro' ? 'NITRO' : 'BOOST') : P.drifting ? 'DRIFT' : '';
  const lap = clamp(Math.floor(P.progress / L) + 1, 1, LAPS);
  $('lap').textContent = lap;
  $('time').textContent = fmt(P.finished ? P.finishTime : raceT);
  $('best').textContent = fmt(P.best);
  $('nitroFill').style.width = `${clamp(P.charge, 0, 1) * 100}%`;
  $('n0').classList.toggle('on', P.nitros > 0);
  $('n1').classList.toggle('on', P.nitros > 1);
  const order = [...racers].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
  $('rank').textContent = order.indexOf(P) + 1;
  const trackDir = Math.atan2(at(P.s).T.x, at(P.s).T.z);
  $('wrongway').style.display = state === 'race' && P.v > 5 && Math.abs(wrap(P.th - trackDir)) > 2 ? 'block' : 'none';
  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) $('toast').classList.remove('show');
  }
  drawMinimap();
};

const checkLaps = () => {
  for (const r of racers) {
    const lap = Math.floor(r.progress / L);
    if (r === player && lap > r.maxLap && !r.finished) {
      const lt = raceT - r.lapStart;
      r.best = Math.min(r.best, lt);
      r.lapStart = raceT;
      r.maxLap = lap;
      if (lap >= LAPS) {
        r.finished = true;
        r.finishTime = raceT;
        finishRace();
      } else {
        audio.ding();
        toast(lap === LAPS - 1 ? '最 后 一 圈 !' : `第 ${lap + 1} 圈`, 1.4, '#fff');
      }
    } else if (r !== player && !r.finished && r.progress >= LAPS * L) {
      r.finished = true;
      r.finishTime = raceT;
    }
  }
};

const finishRace = () => {
  audio.fanfare();
  const order = [...racers].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
  const rank = order.indexOf(player) + 1;
  toast(rank === 1 ? '冠 军 !' : `第 ${rank} 名`, 3, '#ffe14a');
  setTimeout(() => {
    state = 'done';
    const s = player.stats;
    $('resTitle').textContent = rank === 1 ? '🏆 冠军！' : `完赛 · 第 ${rank} 名`;
    $('resBody').innerHTML = `总用时 <b>${fmt(player.finishTime)}</b><br>最佳单圈 <b>${fmt(player.best)}</b><br>漂移 ${s.drifts} 次 · 小喷 ${s.jets} 次 · 双喷 ${s.doubles} 次 · 氮气 ${s.nitros} 次`;
    $('result').classList.remove('hidden');
  }, 2600);
};

// ---------- loop ----------
placeGrid();
const clock = new THREE.Clock();
let acc = 0, elapsed = 0;
const FIXED = 1 / 120;

const frame = () => {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  if (state === 'menu') {
    const a = elapsed * 0.08;
    const c = at(L * 0.02).p;
    camera.position.set(c.x + Math.sin(a) * 40, c.y + 14, c.z + Math.cos(a) * 40);
    camera.lookAt(c.x, c.y + 2, c.z - 10);
    for (const r of racers) {
      if (r === player) poseKart(r, r.th, 0, 0, 0, 0);
      else { const g = at(r.s, r.lat); r.T = g.T; poseKart(r, Math.atan2(g.T.x, g.T.z), 0, 0, 0, 0); }
    }
    track.update(elapsed);
    composer.render();
    return;
  }
  if (!paused) {
    if (state === 'count') {
      countT += dt;
      const n = 3 - Math.floor(countT);
      if (n !== lastCount) {
        lastCount = n;
        $('count').textContent = n > 0 ? n : 'GO!';
        audio.beep(n <= 0);
      }
      if (edges.up) {
        if (countT > 2.55 && countT < 3 && !startBoostTried) player.startBoost = true;
        startBoostTried = true;
        edges.up = false;
      }
      if (countT >= 3) {
        state = 'race';
        if (player.startBoost) {
          player.boostT = 1.2;
          player.boostKind = 'jet';
          player.v = 20;
          toast('起 步 加 速 !', 1.1);
          audio.boost();
        }
        player.startBoost = false;
        setTimeout(() => { if (state === 'race') $('count').textContent = ''; }, 700);
      }
    }
    if (state === 'race' || state === 'done') raceT += state === 'race' ? dt : 0;
    acc += dt;
    while (acc >= FIXED) {
      stepPlayer(FIXED);
      for (const b of bots) stepBot(b, FIXED);
      collide();
      for (const r of racers) trackProgress(r, r === player ? player.s : r.s);
      acc -= FIXED;
    }
    if (state === 'race') checkLaps();
    updateVisuals(dt, elapsed);
    updateHud(dt);
    audio.update(player.v, keys.up, player.drifting, player.boostT > 0);
  }
  composer.render();
};
frame();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

window.__game = { player, bots, keys, edges, track, get state() { return state; }, startRace, camera };
