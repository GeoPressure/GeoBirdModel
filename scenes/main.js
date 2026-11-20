import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/OutputPass.js';
import * as S from './shaders.js';
import { PRESETS } from './presets.js';

const M_PER_UNIT = 0.6;           // bird scene units -> metres (wingspan 0.5 u ~ 0.3 m)
const LEVELS = 8, GRID = 128, S0 = 12;   // terrain clipmap: 8 nested 128x128 grids, finest 12 m

const params = new URLSearchParams(location.search);
const $id = (id) => document.getElementById(id) || document.createElement('div');   // optional UI
const canvas = document.getElementById('c');
// driven by the gallery (../index.html, gallery.js) through window.__scenes; UI elements optional
// alpha: the 'No background' scene leaves the canvas transparent over the page
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

// ------------------------------------------------------------ cameras
// Zoom changes the field of view of BOTH cameras (a telephoto zoom), not the distance:
// the bird and the world are magnified together, so ground scale and horizon stay coherent.
const CAM_DIST = 1.6, FOV_MIN = 16, FOV_MAX = 62;
let fov = 34;
const cam = new THREE.PerspectiveCamera(fov, 1, 0.05, 50);
cam.position.setFromSphericalCoords(CAM_DIST, THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(-35));
const bgCam = new THREE.PerspectiveCamera(fov, 1, 2, 300000);
const controls = new OrbitControls(cam, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.enablePan = false; controls.enableZoom = false;
controls.minDistance = controls.maxDistance = CAM_DIST;
controls.minPolarAngle = THREE.MathUtils.degToRad(12);
controls.maxPolarAngle = THREE.MathUtils.degToRad(168);
controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
controls.rotateSpeed = 0.6;
let resumeTimer = null;
controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resumeTimer); });
controls.addEventListener('end', () => {
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { controls.autoRotate = autoRotateOn; }, 4000);
});
let autoRotateOn = !params.has('still');
if (params.get('view')) {   // ?view=azimuth,polar[,fov] in degrees, e.g. view=150,78,30
  const [az, pol, f] = params.get('view').split(',').map(Number);
  cam.position.setFromSphericalCoords(CAM_DIST, THREE.MathUtils.degToRad(pol), THREE.MathUtils.degToRad(az));
  if (f) fov = THREE.MathUtils.clamp(f, FOV_MIN, FOV_MAX);
}
controls.autoRotate = autoRotateOn;
function setFov(f) {
  fov = THREE.MathUtils.clamp(f, FOV_MIN, FOV_MAX);
  cam.fov = bgCam.fov = fov;
  cam.updateProjectionMatrix(); bgCam.updateProjectionMatrix();
}
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (controls.enabled) setFov(fov * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
{ // two-finger pinch
  const pts = new Map(); let pinch0 = 0, fov0 = fov;
  const span = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); if (pts.size === 2) { pinch0 = span(); fov0 = fov; } });
  canvas.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e); if (pts.size === 2 && pinch0 > 0) setFov(fov0 * pinch0 / span()); });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

// ------------------------------------------------------------ shared uniforms
const v3 = (a) => new THREE.Vector3(...a);
const U = {
  uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(1, 1, 1) },
  uAmb: { value: new THREE.Vector3() },
  uZenith: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() }, uHorizon2: { value: new THREE.Vector3() },
  uBelow: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Vector3() }, uGlowPow: { value: 4 },
  uFogDensity: { value: 1 / 30000 }, uFogH: { value: 2000 }, uFogEnd: { value: 90000 },
  uWater: { value: -1e4 },
  uCloudH: { value: 3000 }, uCloudCov: { value: 0 }, uCloudScale: { value: 3000 },
  uWind: { value: new THREE.Vector2() }, uCloudShadow: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonCol: { value: new THREE.Vector3() },
  uLights: { value: 0 }, uDesat: { value: 0 }, uWaterCol: { value: new THREE.Vector3() }, uWave: { value: 1 }, uFoam: { value: 0 }, uShip: { value: new THREE.Vector4() }, uMist: { value: 0 }, uSeaFog: { value: 0 }, uSeaFogCol: { value: new THREE.Vector3() }, uSunDisc: { value: 0 }, uMilky: { value: 0 }, uStars: { value: 0 },
};

const bgScene = new THREE.Scene();
const fgScene = new THREE.Scene();

// ------------------------------------------------------------ sky dome
const skyGeo = new THREE.SphereGeometry(1000, 48, 24);
const skyMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uEnv: { value: 0 }, uEnvGround: { value: new THREE.Vector3() } },
  vertexShader: S.SKY_VS, fragmentShader: S.SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false,
});
const sky = new THREE.Mesh(skyGeo, skyMat);
sky.renderOrder = -10; sky.frustumCulled = false;
bgScene.add(sky);

// stars
{
  const N = 4500, pos = new Float32Array(N * 3), mag = new Float32Array(N), col = new Float32Array(N * 3);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos.set([r * Math.cos(th), u, r * Math.sin(th)], i * 3);
    mag[i] = 6.5 - Math.pow(rnd(), 0.35) * 7.5;          // few bright, many faint
    const t = rnd();
    col.set(t < 0.15 ? [1.0, 0.8, 0.6] : t < 0.35 ? [0.75, 0.85, 1.0] : [1, 1, 1], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  var starMat = new THREE.ShaderMaterial({
    uniforms: { uStars: U.uStars, uTime: U.uTime, uPx: { value: 1 } },
    vertexShader: S.STAR_VS, fragmentShader: S.STAR_FS,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  var stars = new THREE.Points(g, starMat);
  stars.frustumCulled = false; stars.renderOrder = -5;
  bgScene.add(stars);
}

// ------------------------------------------------------------ terrain clipmap
const gridGeo = new THREE.PlaneGeometry(GRID, GRID, GRID, GRID);
gridGeo.rotateX(-Math.PI / 2);
const levels = [];
for (let k = 0; k < LEVELS; k++) {
  const s = S0 * 2 ** k;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uSpacing: { value: s }, uHalf: { value: GRID / 2 }, uInner: { value: new THREE.Vector4() } },
    vertexShader: S.TERRAIN_VS, fragmentShader: S.TERRAIN_FS, defines: { HABITAT: 0 },
    extensions: { derivatives: true },
  });
  const mesh = new THREE.Mesh(gridGeo, mat);
  mesh.scale.set(s, 1, s); mesh.frustumCulled = false; mesh.renderOrder = 0;
  bgScene.add(mesh);
  levels.push({ mesh, mat, s });
}
function updateTerrain() {
  const c = U.uCam.value;
  let prev = null;
  for (const L of levels) {
    const step = 2 * L.s;
    const cx = Math.round(c.x / step) * step, cz = Math.round(c.z / step) * step;
    L.mesh.position.set(cx, 0, cz);
    if (prev) L.mat.uniforms.uInner.value.set(prev.mesh.position.x, prev.mesh.position.z, prev.s * GRID / 2, 1);
    else L.mat.uniforms.uInner.value.set(0, 0, 0, 0);
    prev = L;
  }
}

// ------------------------------------------------------------ cloud layers
const cloudGeo = new THREE.PlaneGeometry(240000, 240000, 1, 1).rotateX(-Math.PI / 2);
const cloudLayers = [];
function makeCloud(cfg) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U, uCov: { value: cfg.cov }, uScale: { value: cfg.scale }, uWindC: { value: new THREE.Vector2(...cfg.wind) },
      uStretch: { value: new THREE.Vector2(...cfg.stretch) }, uLit: { value: v3(cfg.lit) }, uShade: { value: v3(cfg.shade) },
      uUnder: { value: v3(cfg.under) }, uOpacity: { value: cfg.opacity }, uThick: { value: cfg.thick },
    },
    vertexShader: S.CLOUD_VS, fragmentShader: S.CLOUD_FS, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, extensions: { derivatives: true },
  });
  const m = new THREE.Mesh(cloudGeo, mat);
  m.frustumCulled = false; m.renderOrder = 5;
  m.userData.h = cfg.h;
  bgScene.add(m);
  return m;
}

// ------------------------------------------------------------ distant birds
const flockGeo = new THREE.BufferGeometry();
flockGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
  -0.5, 0, -0.02, 0, 0, 0.12, 0, 0, -0.10,   0, 0, 0.12, 0.5, 0, -0.02, 0, 0, -0.10,
  -0.04, 0, 0.0, 0, 0, 0.22, 0.04, 0, 0.0,   -0.05, 0, -0.08, 0.05, 0, -0.08, 0, 0, -0.26,
]), 3));
const flockMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uFlap: { value: 10 }, uGlide: { value: 0 }, uBirdCol: { value: new THREE.Vector3() } },
  vertexShader: S.FLOCK_VS, fragmentShader: S.FLOCK_FS, side: THREE.DoubleSide,
});
let flock = null, flockData = [];
function makeFlock(cfg) {
  if (flock) { bgScene.remove(flock); flock.dispose(); flock = null; }
  flockData = [];
  if (!cfg) return;
  const g = flockGeo.clone();
  const ph = new Float32Array(cfg.n);
  for (let i = 0; i < cfg.n; i++) ph[i] = Math.random();
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  flock = new THREE.InstancedMesh(g, flockMat, cfg.n);
  flock.frustumCulled = false;
  // a loose group off to one side, a few far ones scattered
  const centre = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * cfg.rmax * 0.5, -cfg.rmax * 0.12, cfg.rmax * 0.3);
  for (let i = 0; i < cfg.n; i++) {
    let p;
    do {
      p = centre.clone().add(new THREE.Vector3((Math.random() - 0.5) * cfg.rmax * 0.6, (Math.random() - 0.5) * cfg.rmax * 0.12, (Math.random() - 0.5) * cfg.rmax * 0.6));
      if (i % 4 === 3) p.set((Math.random() - 0.5) * 2 * cfg.rmax, (Math.random() - 0.6) * cfg.rmax * 0.3, (Math.random() - 0.5) * 2 * cfg.rmax);
    } while (p.length() < cfg.rmin);
    flockData.push({ p, s: cfg.size * (0.85 + 0.3 * Math.random()), yaw: (Math.random() - 0.5) * 0.15, w: Math.random() * 10 });
  }
  flockMat.uniforms.uFlap.value = cfg.flap;
  flockMat.uniforms.uGlide.value = cfg.glide;
  flockMat.uniforms.uBirdCol.value.set(...cfg.col);
  bgScene.add(flock);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function updateFlock(t, origin) {
  if (!flock) return;
  flockData.forEach((b, i) => {
    _p.copy(b.p).add(origin);
    _p.x += Math.sin(t * 0.05 + b.w) * 15; _p.y += Math.sin(t * 0.11 + b.w * 2) * 4; _p.z += Math.sin(t * 0.07 + b.w * 3) * 10;
    _e.set(0.0, b.yaw + Math.sin(t * 0.05 + b.w) * 0.05, Math.sin(t * 0.2 + b.w) * 0.1);
    _q.setFromEuler(_e); _s.setScalar(b.s);
    _m.compose(_p, _q, _s); flock.setMatrixAt(i, _m);
  });
  flock.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------ cumulus towers
const cuMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uCuLit: { value: new THREE.Vector3() }, uCuShade: { value: new THREE.Vector3() }, uCuOpacity: { value: 1 } },
  vertexShader: S.CUMULUS_VS, fragmentShader: S.CUMULUS_FS, transparent: true, depthWrite: false, premultipliedAlpha: true,
});
let cumulus = null, puffs = [];
const CU_WRAP = 100000;
function makeCumulus(cfg) {
  if (cumulus) { bgScene.remove(cumulus); cumulus.geometry.dispose(); cumulus = null; }
  puffs = [];
  if (!cfg) return;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < cfg.n; k++) {
    const ang = rnd() * Math.PI * 2, dist = cfg.dist[0] + rnd() * (cfg.dist[1] - cfg.dist[0]);
    const tx = Math.cos(ang) * dist, tz = Math.sin(ang) * dist;
    const W = cfg.w[0] + rnd() * (cfg.w[1] - cfg.w[0]), H = cfg.h[0] + rnd() * (cfg.h[1] - cfg.h[0]);
    const base = cfg.base * (0.95 + 0.1 * rnd());
    const n = Math.round(10 + 22 * Math.min(1, H / 4000));
    for (let i = 0; i < n; i++) {
      const f = i < 5 ? 0.08 * rnd() : Math.pow(rnd(), 0.8);             // a wide base row, then the tower
      const spread = W * 0.5 * (1 - 0.55 * f);
      const r = Math.sqrt(rnd()) * spread, a2 = rnd() * Math.PI * 2;
      const size = W * (0.22 + 0.14 * rnd()) * (1 - 0.45 * f) * (i < 5 ? 1.25 : 1);
      puffs.push({ tx, tz, x: Math.cos(a2) * r, y: base + f * H + size * 0.35, z: Math.sin(a2) * r, size, base, top: base + H, seed: rnd() });
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs.length * 4), 4));
  g.setAttribute('aTower', new THREE.InstancedBufferAttribute(new Float32Array(puffs.length * 4), 4));
  g.instanceCount = puffs.length;
  cumulus = new THREE.Mesh(g, cuMat);
  cumulus.frustumCulled = false; cumulus.renderOrder = 6;
  bgScene.add(cumulus);
}
function updateCumulus() {
  if (!cumulus) return;
  const c = U.uCam.value;
  for (const p of puffs) {
    // towers are fixed in the world; once far behind they reappear far ahead
    const relZ = ((p.tz - origin.z) % CU_WRAP + CU_WRAP * 1.5) % CU_WRAP - CU_WRAP / 2;
    p.wx = p.tx + p.x; p.wy = p.y; p.wz = origin.z + relZ + p.z;
    p.d2 = (p.wx - c.x) ** 2 + (p.wy - c.y) ** 2 + (p.wz - c.z) ** 2;
  }
  puffs.sort((a, b) => b.d2 - a.d2);                     // back to front
  const A = cumulus.geometry.getAttribute('aPuff'), T = cumulus.geometry.getAttribute('aTower');
  puffs.forEach((p, i) => { A.setXYZW(i, p.wx, p.wy, p.wz, p.size); T.setXYZW(i, p.base, p.top, p.seed, 0); });
  A.needsUpdate = T.needsUpdate = true;
}

// ------------------------------------------------------------ a ferry with its wake (sea scene)
const ship = new THREE.Group();
{
  const mk = (geo, col, y) => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { ...U, uColor: { value: new THREE.Vector3(...col) } }, vertexShader: S.SOLID_VS, fragmentShader: S.SOLID_FS }));
    m.position.y = y; ship.add(m); return m;
  };
  const hull = new THREE.CylinderGeometry(11, 11, 130, 8, 1); hull.rotateX(Math.PI / 2); hull.scale(1, 0.6, 1);
  mk(hull, [0.05, 0.06, 0.08], 2);
  mk(new THREE.BoxGeometry(19, 6, 100), [0.75, 0.75, 0.73], 8).position.z = -8;
  mk(new THREE.BoxGeometry(16, 7, 55), [0.80, 0.80, 0.78], 14).position.z = -18;
  mk(new THREE.BoxGeometry(5, 7, 5), [0.55, 0.12, 0.08], 21).position.z = -30;
  ship.visible = false;
  bgScene.add(ship);
}
let shipRel = 7000;
function updateShip(dt) {
  if (!ship.visible) { U.uShip.value.w = 0; return; }
  shipRel -= (preset.speed - 9) * dt;                    // the ferry steams at 9 m/s, slower than the bird
  if (shipRel < -6000) shipRel += 16000;
  ship.position.set(origin.x - 1300, 0, origin.z + shipRel);
  U.uShip.value.set(ship.position.x, ship.position.z, 0, 1);
}

// ------------------------------------------------------------ city lights near the camera (point sprites)
// two lattices: 12 m spacing out to 3 km, 36 m spacing from 3 to 9 km; beyond, the terrain shader
const CP_N = 512;
function makeCityPts(step, fade) {
  const g = new THREE.BufferGeometry(), grid = new Float32Array(CP_N * CP_N * 2);
  for (let j = 0; j < CP_N; j++) for (let i = 0; i < CP_N; i++) grid.set([i - CP_N / 2, j - CP_N / 2], (j * CP_N + i) * 2);
  g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CP_N * CP_N * 3), 3));
  const m = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { ...U, uSnap: { value: new THREE.Vector2() }, uStep: { value: step }, uPx: { value: 1 }, uFade: { value: new THREE.Vector4(...fade) } },
    vertexShader: S.CITYPTS_VS, fragmentShader: S.CITYPTS_FS,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  m.frustumCulled = false; m.renderOrder = 4; m.visible = false;
  bgScene.add(m);
  return m;
}
const cityPtsList = [makeCityPts(12, [-1, 0, 2500, 3050]), makeCityPts(36, [2500, 3050, 8000, 9100])];

// ------------------------------------------------------------ rain
let rain;
{
  const N = 2500, off = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * 60, y = (Math.random() - 0.5) * 60, z = (Math.random() - 0.5) * 60;
    off.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  g.setAttribute('aOff', new THREE.BufferAttribute(off, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCam: U.uCam, uBox: { value: 60 }, uFall: { value: new THREE.Vector3(2, -9, -14) }, uRainCol: { value: new THREE.Vector3(0.75, 0.78, 0.82) } },
    vertexShader: S.RAIN_VS, fragmentShader: S.RAIN_FS, transparent: true, depthWrite: false,
  }));
  rain.frustumCulled = false; rain.renderOrder = 8; rain.visible = false;
  bgScene.add(rain);
}

// ------------------------------------------------------------ bird + lights
const sunLight = new THREE.DirectionalLight(0xffffff, 2);
const fillLight = new THREE.DirectionalLight(0xffffff, 0);   // from the camera side, follows the orbit
const rimLight = new THREE.DirectionalLight(0xffffff, 0);    // from behind the bird, outlines it
fgScene.add(sunLight, fillLight, rimLight);
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envMat = skyMat.clone();
envMat.uniforms = { ...U, uEnv: { value: 1 }, uEnvGround: { value: new THREE.Vector3() } };
envMat.depthTest = false;
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat));
let envRT = null;

const loader = new GLTFLoader();
let bird = null, mixer = null, birdToken = 0;
async function loadBird(path) {
  const token = ++birdToken;
  if (!path) { if (bird) { fgScene.remove(bird); bird = null; mixer = null; } return; }
  setStatus('Loading bird…');
  try {
    const gltf = await loader.loadAsync(path);
    if (token !== birdToken) return;
    if (bird) { fgScene.remove(bird); bird.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } }); }
    bird = gltf.scene;
    bird.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
    fgScene.add(bird);
    mixer = new THREE.AnimationMixer(bird);
    const clip = gltf.animations.find((a) => a.name === 'Fly') || gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
    setStatus('');
    canvas.dispatchEvent(new CustomEvent('birdload', { detail: path }));
  } catch (e) { setStatus('Could not load ' + path); console.error(e); }
}

// ------------------------------------------------------------ post-processing: HDR, bloom, tone mapping
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
const bgPass = new RenderPass(bgScene, bgCam);
const emptyScene = new THREE.Scene();   // 'No background': only the bird, on a transparent canvas
const fgPass = new RenderPass(fgScene, cam); fgPass.clear = false; fgPass.clearDepth = true;
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.4, 2);
composer.addPass(bgPass); composer.addPass(fgPass); composer.addPass(bloom); composer.addPass(new OutputPass());

// ------------------------------------------------------------ apply a scene preset
const origin = new THREE.Vector3();
let preset = null;
const dirFrom = (elev, az) => {
  const e = THREE.MathUtils.degToRad(elev), a = THREE.MathUtils.degToRad(az);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
};
function applyPreset(key) {
  const P = PRESETS[key]; preset = P;
  bgPass.scene = P.plain ? emptyScene : bgScene;
  for (const L of levels) { L.mat.defines.HABITAT = P.habitat; L.mat.needsUpdate = true; }
  const d = dirFrom(P.sun.elev, P.sun.az);
  U.uSunDir.value.copy(d);
  U.uSunCol.value.set(...P.sunCol); U.uAmb.value.set(...P.amb);
  U.uZenith.value.set(...P.zenith); U.uHorizon.value.set(...P.horizon); U.uHorizon2.value.set(...(P.horizon2 || P.horizon)); U.uBelow.value.set(...P.below);
  U.uGlow.value.set(...P.glow); U.uGlowPow.value = P.glowPow; U.uSunDisc.value = P.sunDisc;
  U.uFogDensity.value = P.fog.density; U.uFogH.value = P.fog.height; U.uFogEnd.value = P.fog.end;
  U.uWater.value = P.water; U.uLights.value = P.lights || 0; U.uDesat.value = P.desat || 0;
  U.uWaterCol.value.set(...(P.waterCol || [0.02, 0.05, 0.07])); U.uWave.value = P.wave ?? 0.6; U.uFoam.value = P.foam || 0; U.uMist.value = P.mist || 0;
  bloom.strength = P.bloom.strength; bloom.radius = P.bloom.radius; bloom.threshold = P.bloom.threshold; bloom.enabled = P.bloom.strength > 0 && !P.plain;
  ship.visible = !!P.ship; shipRel = 7000;
  cityPtsList.forEach((m) => { m.visible = P.habitat === 4 && !!P.lights; });
  U.uMoonDir.value.copy(d); U.uMoonCol.value.set(...(P.moon || [0, 0, 0]));
  U.uStars.value = P.stars; U.uMilky.value = P.milky;
  renderer.toneMappingExposure = P.exposure * 0.6;   // three's ACES pre-scales by 1/0.6
  // clouds
  cloudLayers.splice(0).forEach((m) => { bgScene.remove(m); m.material.dispose(); });
  P.clouds.forEach((c) => { if (c.opacity > 0) cloudLayers.push(makeCloud(c)); });
  const c0 = P.clouds[0];
  U.uCloudShadow.value = c0 ? P.cloudShadow : 0;
  if (c0) { U.uCloudH.value = c0.h; U.uCloudCov.value = c0.cov; U.uCloudScale.value = c0.scale; U.uWind.value.set(...c0.wind); }
  rain.visible = !!P.rain;
  U.uSeaFog.value = P.seaFog ? 0.85 : 0; if (c0) U.uSeaFogCol.value.set(...c0.lit);
  makeFlock(P.flock);
  makeCumulus(P.cumulus);
  { const sc = P.sunCol, am = P.amb;
    cuMat.uniforms.uCuLit.value.set(sc[0] * 0.78 + am[0] * 0.7, sc[1] * 0.78 + am[1] * 0.7, sc[2] * 0.78 + am[2] * 0.7);
    cuMat.uniforms.uCuShade.value.set(sc[0] * 0.16 + am[0] * 0.95, sc[1] * 0.16 + am[1] * 0.95, sc[2] * 0.16 + am[2] * 0.95); }
  origin.set(0, P.altitude, 0);
  // bird lighting from the same sky
  const sc = new THREE.Vector3(...P.sunCol); const mx = Math.max(sc.x, sc.y, sc.z);
  sunLight.color.setRGB(sc.x / mx, sc.y / mx, sc.z / mx, THREE.LinearSRGBColorSpace);
  sunLight.intensity = P.bird.sun * mx;
  sunLight.position.copy(d).multiplyScalar(5);
  // ground radiance seen from above, for the environment map's lower hemisphere
  const g = P.ground || groundAlbedo[P.habitat];
  envMat.uniforms.uEnvGround.value.set(
    g[0] * (sc.x * Math.max(d.y, 0) + P.amb[0]) + (P.lights ? 0.06 : 0),
    g[1] * (sc.y * Math.max(d.y, 0) + P.amb[1]) + (P.lights ? 0.035 : 0),
    g[2] * (sc.z * Math.max(d.y, 0) + P.amb[2]) + (P.lights ? 0.01 : 0));
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
  fgScene.environment = envRT.texture;
  fgScene.environmentIntensity = P.bird.env;
  // fill: sky-coloured, rim: sun/moon-coloured
  const z = new THREE.Vector3(...P.zenith).add(new THREE.Vector3(...P.horizon)); const zm = Math.max(z.x, z.y, z.z);
  fillLight.color.setRGB(0.5 + 0.5 * z.x / zm, 0.5 + 0.5 * z.y / zm, 0.5 + 0.5 * z.z / zm, THREE.LinearSRGBColorSpace);
  fillLight.intensity = P.bird.fill * Math.max(mx, 0.6);
  rimLight.color.copy(sunLight.color);
  rimLight.intensity = P.bird.rim * mx;
}
const groundAlbedo = [[0.55, 0.38, 0.22], [0.40, 0.33, 0.18], [0.18, 0.2, 0.15], [0.2, 0.26, 0.12], [0.06, 0.06, 0.06], [0.03, 0.06, 0.10], [0.06, 0.12, 0.04], [0.45, 0.36, 0.22],
  [0.40, 0.34, 0.22], [0.48, 0.42, 0.28], [0.10, 0.13, 0.09], [0.32, 0.30, 0.24], [0.18, 0.22, 0.12]];

// ------------------------------------------------------------ UI
function setStatus(s) { $id('status').textContent = s; }
// the scene is chosen by the gallery (gallery.js) through window.__scenes.switchScene
let currentScene = 'kenya';
const fade = $id('fade');
function switchScene(k) {
  if (!PRESETS[k] || (k === currentScene && preset)) return;
  currentScene = k;
  fade.style.opacity = 1;
  setTimeout(() => { applyPreset(k); renderer.compile(bgScene, bgCam); setTimeout(() => { fade.style.opacity = 0; }, 60); }, 260);
}

// ------------------------------------------------------------ resize + loop
// insets (CSS px) of the panels over the canvas: the bird is centred in the free area between
// them by shifting the view window of both cameras (off-axis frustum), so the horizon stays coherent
const insets = { left: 0, right: 0, top: 0, bottom: 0 };
function applyInsets(w, h) {
  const ox = (insets.right - insets.left) / 2, oy = (insets.bottom - insets.top) / 2;
  for (const c of [cam, bgCam]) { if (ox || oy) c.setViewOffset(w, h, ox, oy, w, h); else c.clearViewOffset(); }
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  applyInsets(w, h);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  cam.aspect = bgCam.aspect = w / h; cam.fov = bgCam.fov = fov;
  cam.updateProjectionMatrix(); bgCam.updateProjectionMatrix();
  starMat.uniforms.uPx.value = renderer.getPixelRatio();
  cityPtsList.forEach((m) => { m.material.uniforms.uPx.value = renderer.getPixelRatio(); });
}
window.addEventListener('resize', resize);
new ResizeObserver(() => resize()).observe(canvas);   // the gallery resizes the stage without a window resize
resize();
applyPreset(currentScene);

const clock = new THREE.Clock();
let t = 0, frames = 0, acc = 0, slow = 0, paused = false;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (paused) return;   // e.g. the gallery's species grid covers the stage
  t += dt;
  origin.z += preset.speed * dt;
  controls.update(dt);
  // the background camera looks the same way as the bird camera, from the bird's real position
  bgCam.quaternion.copy(cam.quaternion);
  bgCam.position.copy(origin).addScaledVector(cam.position, M_PER_UNIT);
  bgCam.updateMatrixWorld();
  U.uTime.value = t; U.uCam.value.copy(bgCam.position);
  sky.position.copy(bgCam.position); stars.position.copy(bgCam.position);
  for (const m of cloudLayers) m.position.set(bgCam.position.x, m.userData.h, bgCam.position.z);
  updateTerrain();
  updateFlock(t, origin);
  updateCumulus();
  cityPtsList.forEach((m) => m.material.uniforms.uSnap.value.set(U.uCam.value.x, U.uCam.value.z));
  updateShip(dt);
  // bird lights that follow the camera
  fillLight.position.copy(cam.position).normalize().multiplyScalar(5).add(new THREE.Vector3(0, 1.5, 0));
  rimLight.position.copy(cam.position).normalize().multiplyScalar(-5).add(new THREE.Vector3(0, 2.5, 0));
  if (mixer) mixer.update(dt);
  if (bird) {
    bird.rotation.z = Math.sin(t * 0.37) * 0.05;
    bird.rotation.x = Math.sin(t * 0.23) * 0.025;
    bird.position.y = Math.sin(t * 0.9) * 0.012;
  }
  composer.render(dt);
  // fps + adaptive resolution
  frames++; acc += dt;
  if (acc > 1) {
    const fps = frames / acc;
    slow = fps < 40 && t > 5 ? slow + 1 : 0;
    if (slow >= 2 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); slow = 0; }
    frames = 0; acc = 0;
  }
}
requestAnimationFrame(frame);
window.__scenes = { loadBird,
setInsets(o) { Object.assign(insets, o); resize(); }, setPaused(p) { paused = !!p; controls.enabled = !paused; },   // no orbit/zoom behind the gallery's grid
  // back to the default view: field of view, orbit position and the slow auto-rotation
  recenter() {
    setFov(34);
    cam.position.setFromSphericalCoords(CAM_DIST, THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(-35));
    controls.target.set(0, 0, 0); controls.update(); controls.autoRotate = autoRotateOn;
  }, get scene() { return currentScene; }, THREE, renderer, composer, bloom, setFov, get fov() { return fov; }, bgScene, fgScene, cloudLayers, levels, sky, stars, cam, bgCam, controls, U, switchScene, applyPreset, PRESETS, origin, get preset() { return preset; } };
