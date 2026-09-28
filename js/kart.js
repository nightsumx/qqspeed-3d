import * as THREE from 'three';

export function buildKart(color, accent = 0xffffff, name = '') {
  const kart = new THREE.Group();
  const body = new THREE.Group();
  kart.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.15 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.2 });

  // side profile extruded across width
  const s = new THREE.Shape();
  s.moveTo(-1.55, 0.18);
  s.lineTo(1.35, 0.18);
  s.quadraticCurveTo(1.75, 0.22, 1.8, 0.42);
  s.quadraticCurveTo(1.5, 0.62, 0.7, 0.66);
  s.lineTo(0.25, 0.9);
  s.lineTo(-0.7, 0.92);
  s.quadraticCurveTo(-1.3, 0.9, -1.55, 0.7);
  s.closePath();
  const chassisG = new THREE.ExtrudeGeometry(s, { depth: 1.3, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3, curveSegments: 12 });
  chassisG.translate(0, 0, -0.65);
  chassisG.rotateY(-Math.PI / 2);
  const chassis = new THREE.Mesh(chassisG, paint);
  chassis.castShadow = true;
  body.add(chassis);

  // side pods
  for (const sgn of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.6, 6, 12), paint);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(sgn * 0.9, 0.38, -0.1);
    pod.castShadow = true;
    body.add(pod);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 1.6), accentMat);
    stripe.position.set(sgn * 1.13, 0.42, -0.1);
    body.add(stripe);
  }
  // front bumper
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.3), dark);
  bumper.position.set(0, 0.25, 1.85);
  body.add(bumper);
  // headlights
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xeaffff });
  for (const sgn of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hlMat);
    hl.position.set(sgn * 0.55, 0.45, 1.83);
    hl.scale.z = 0.5;
    body.add(hl);
  }
  // spoiler
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.5), paint);
  wing.position.set(0, 1.3, -1.55);
  wing.rotation.x = -0.15;
  wing.castShadow = true;
  body.add(wing);
  for (const sgn of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.3), dark);
    strut.position.set(sgn * 0.6, 1.05, -1.5);
    body.add(strut);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.6), accentMat);
    fin.position.set(sgn * 1.05, 1.3, -1.55);
    body.add(fin);
  }
  // exhausts
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const sgn of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 12, 1, true), chrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(sgn * 0.35, 0.45, -1.72);
    body.add(pipe);
    const fg = new THREE.ConeGeometry(0.2, 1.6, 12, 1, true);
    fg.translate(0, -0.8, 0);
    fg.rotateX(-Math.PI / 2);
    const f = new THREE.Mesh(fg, flameMat);
    f.position.set(sgn * 0.35, 0.45, -1.95);
    const core = new THREE.Mesh(fg, flameCore);
    core.scale.set(0.5, 0.5, 0.6);
    f.add(core);
    f.visible = false;
    body.add(f);
    flames.push(f);
  }

  // driver
  const driver = new THREE.Group();
  const suit = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.35, 6, 12), accentMat);
  suit.position.y = 1.1;
  driver.add(suit);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), new THREE.MeshStandardMaterial({ color: 0xffe0c4, roughness: 0.7 }));
  head.position.y = 1.72;
  driver.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.47, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), paint);
  helmet.position.y = 1.75;
  helmet.rotation.x = -0.35;
  driver.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 12, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.38, Math.PI * 0.2), new THREE.MeshPhysicalMaterial({ color: 0x113355, metalness: 0.9, roughness: 0.05, clearcoat: 1 }));
  visor.position.y = 1.72;
  driver.add(visor);
  const wheelS = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 20), dark);
  wheelS.position.set(0, 1.12, 0.55);
  wheelS.rotation.x = -0.9;
  driver.add(wheelS);
  driver.position.z = -0.3;
  driver.children.forEach((m) => { m.castShadow = true; });
  body.add(driver);

  // wheels
  const wheels = [];
  const tireG = new THREE.CylinderGeometry(0.42, 0.42, 0.42, 24);
  tireG.rotateZ(Math.PI / 2);
  const rimG = new THREE.CylinderGeometry(0.25, 0.25, 0.44, 6);
  rimG.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  for (const [x, z, front] of [[-1.0, 1.25, 1], [1.0, 1.25, 1], [-1.05, -1.2, 0], [1.05, -1.2, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireG, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimG, chrome);
    spin.add(tire, rim);
    if (!front) spin.scale.set(1.2, 1.08, 1.08);
    pivot.add(spin);
    kart.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  // blob shadow for readability
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  kart.add(shadow);

  if (name) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 36px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = '#000';
    g.strokeText(name, 128, 44);
    g.fillStyle = '#' + new THREE.Color(color).getHexString();
    g.fillText(name, 128, 44);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    tag.scale.set(3.2, 0.8, 1);
    tag.position.y = 3;
    kart.add(tag);
  }

  return { group: kart, body, wheels, flames };
}
