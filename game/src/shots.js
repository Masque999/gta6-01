// shots.js — Solmar Bay deterministic screenshot staging for `?shot=` mode.
//
// stageShot(name, api) sets the world to a named scene by driving the real
// game systems forward from a fresh state (never by faking pixels), then
// returns { screen } for main.js to paint. main.js paints twice and sets
// window.__shotReady = true; this module does not set it.
//
// Interface assumptions, checked against the sibling modules in this
// folder (city.js, vehicles.js, police.js, pedestrians.js, input.js,
// config.js, random.js — read, not copied):
//   - api = { state, systems }; systems holds the modules main.js passes
//     in (city, vehicles, police, pedestrians, player, combat, missions,
//     effects, audio, save, random). A subsystem update may be an object
//     method (update/tick/step) or a named export such as updateVehicles /
//     updatePolice / updatePeds, called as fn(state, dt); a single
//     systems.update / tick / step, if present, is the canonical tick
//     and wins over per-module updates.
//   - state.rng, when present, is a function returning [0, 1) (the
//     seeded RNG); systems.random may instead be that function or the
//     createRandom() object ({ next, range, int, pick }).
//   - Driving reads state.input.axes() returning { steer, throttle }
//     with throttle +1 = accelerate (vehicles.js reads that explicit
//     shape verbatim; its { x, y } fallback is screen-style, y = -1
//     forward). On foot the same axes() is a screen-space movement
//     vector. During staging, state.input is swapped for a staging
//     autopilot input and the original input object is restored
//     afterwards.
//   - The world is 3200 x 3200 (city.size), roads on a 400px pitch with
//     centres at col * 400 + 40; the bay (water) runs along the south
//     edge (water.y = 3040). Angles are radians (0 = east, PI/2 = south).
//     Scenes therefore place cars on road centres and steer along
//     axis-aligned road waypoints, so the autopilot does not grind
//     against buildings.
//   - Police spawning is owned by police.js (updatePolice keeps
//     min(wanted, 4) cruisers); the scenes stage exactly the police
//     count the brief asks for (cover 2, chase 3) and trim any extra
//     cruiser updatePolice added during the run, keeping the closest
//     ones — the cars left in frame are all really simulated.
// Every system call is duck-typed and wrapped in try/catch: if a sibling
// module exposes a different spawn/update name, shots.js falls back to
// moving the state objects directly (still a real simulation of the
// world state, not a staged image), so stageShot always returns a screen.

const DT = 1 / 60;
const WORLD = 3200;
const PITCH = 400;
const ROAD = 80;

export function stageShot(name, api) {
  const state = (api && api.state) || api || {};
  const systems = (api && api.systems) || {};
  const rng = rngFor(state, systems);

  try {
    switch (name) {
      case 'cover':
        return stageChaseScene(state, systems, rng, {
          wanted: 3, policeCount: 2, trafficCount: 6, pedCount: 8,
          seconds: 20, skid: false,
        });
      case 'drive':
        return stageDriveScene(state, systems, rng);
      case 'chase':
        return stageChaseScene(state, systems, rng, {
          wanted: 4, policeCount: 3, trafficCount: 4, pedCount: 4,
          seconds: 15, skid: true,
        });
      case 'mission':
        return stageMissionScene(state, systems, rng);
      default:
        resetWorld(state, systems, rng);
        state.screen = 'title';
        return { screen: 'title' };
    }
  } catch {
    // Staging must never break the shot flow: fall back to a fresh title.
    try {
      resetWorld(state, systems, rng);
    } catch {
      // Even the reset failed; the state is whatever it is.
    }
    state.screen = 'title';
    return { screen: 'title' };
  }
}

// --- seeded RNG ------------------------------------------------------------

function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(state, systems) {
  // Deterministic per call: a fresh generator from the state's seed, so
  // two stageShot runs with the same seed stage identically even when
  // main.js shares one advancing RNG object across runs. Only when the
  // state carries no usable seed do we borrow a live RNG.
  try {
    const seed = Number(state && state.seed);
    if (Number.isFinite(seed)) return mulberry32(seed);
    const random = systems && systems.random;
    if (typeof random === 'function') return random;
    if (random && typeof random.next === 'function') return () => random.next();
    if (random && typeof random.random === 'function') return () => random.random();
    if (state && typeof state.rng === 'function') return state.rng;
  } catch {
    // Fall through to the seeded generator.
  }
  return mulberry32(1337);
}

// --- small helpers ---------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Centre of the road strip for grid column/row `i` (roads are 80px wide
// on a 400px pitch; the city object carries the same numbers).
function roadCentre(i, state) {
  const city = (state && state.city) || {};
  const pitch = Number.isFinite(city.pitch) ? city.pitch : PITCH;
  const road = Number.isFinite(city.road) ? city.road : ROAD;
  return i * pitch + road / 2;
}

function worldSize(state) {
  const city = (state && state.city) || {};
  return Number.isFinite(city.size) ? city.size : WORLD;
}

function downtownOf(state) {
  const s = worldSize(state);
  return { x: s / 2, y: s / 2 };
}

function harborOf(state) {
  const city = (state && state.city) || {};
  const s = worldSize(state);
  const waterY = city.water && Number.isFinite(city.water.y) ? city.water.y : s - 160;
  return { x: s / 2, y: waterY - 80 };
}

function tryCall(mod, names, ...args) {
  if (!mod) return undefined;
  for (const name of names) {
    const fn = mod[name];
    if (typeof fn === 'function') {
      try {
        return fn.apply(mod, args);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// --- fresh world -----------------------------------------------------------

function resetWorld(state, systems, rng) {
  const seed = state.seed;
  const city = state.city;
  const savedRng = state.rng;
  state.time = 0;
  state.seed = seed;
  state.city = city;
  state.rng = savedRng;
  state.screen = 'play';
  state.wanted = 0;
  state.wantedTimer = 0;
  state.cars = [];
  state.peds = [];
  state.enemies = [];
  state.bullets = [];
  state.particles = [];
  state.mission = null;
  state.missionsDone = [];
  state.dialogue = null;
  state.lastShotAt = null;
  state.stats = { stolen: 0, delivered: 0, kills: 0 };
  state._nextCarId = 0;
  state._policeSpawnTimer = 0;
  state.input = {
    up: false, down: false, left: false, right: false,
    shoot: false, interact: false, enterCar: false,
    axes: () => ({ x: 0, y: 0 }),
    takeActions: () => 0,
  };
  state.player = {
    x: 0, y: 0, angle: 0, speed: 0,
    health: 100, maxHealth: 100, money: 200,
    weapon: 'fists', ammo: 0, inCar: null, alive: true,
  };
  state.camera = { x: 0, y: 0, zoom: 1 };

  // Build the city if none was supplied (createCity(seed) is the
  // sibling constructor; generate/build/reset are accepted too).
  if (!state.city && systems.city) {
    let built;
    if (typeof systems.city.createCity === 'function') {
      try {
        built = systems.city.createCity(Number(seed) || 1337);
      } catch {
        built = undefined;
      }
    }
    if (!built) built = tryCall(systems.city, ['generate', 'build', 'reset', 'create'], state, rng);
    if (built && typeof built === 'object') state.city = built;
  }
  if (!state.city) state.city = { name: 'Solmar Bay', size: WORLD, pitch: PITCH, road: ROAD };
  if (!state.camera) state.camera = { x: 0, y: 0, zoom: 1 };
}

function focusCamera(state) {
  if (!state.camera) state.camera = { x: 0, y: 0, zoom: 1 };
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  state.camera.zoom = 1;
}

// --- spawning (direct state first: in-frame and deterministic) -------------

function spawnCar(state, systems, rng, opts) {
  const car = {
    id: opts.id || `car-${state.cars.length + 1}`,
    x: opts.x, y: opts.y, angle: opts.angle || 0,
    speed: opts.speed || 0, color: opts.color || '#c0c0c0',
    kind: opts.kind || 'sedan', driver: opts.driver || 'traffic',
    health: 100,
    _cruise: opts.speed || 90,
    _turnTimer: 2 + rng() * 3,
    _pauseTimer: 0,
    _hitCooldown: 0,
    _ramCooldown: 0,
  };
  if (car.kind === 'police') {
    car.color = '#20242a';
    car.lightBar = true;
  }
  state.cars.push(car);
  return car;
}

function spawnPed(state, systems, rng, opts) {
  const ped = {
    x: opts.x, y: opts.y, angle: opts.angle || 0,
    speed: opts.speed || 0, color: opts.color || '#888888', state: 'walk',
    _walkSpeed: opts.speed || 25,
    _turnTimer: 2 + rng() * 3, _fleeTimer: 0, _downTimer: 0,
    _wantedCounted: false,
  };
  state.peds.push(ped);
  return ped;
}

function spawnEnemy(state, systems, rng, opts) {
  const enemy = {
    x: opts.x, y: opts.y, angle: opts.angle || 0,
    health: 60, state: 'alert',
  };
  state.enemies.push(enemy);
  return enemy;
}

function setMission(state, systems, rng, mission) {
  const made = tryCall(
    systems.missions,
    ['startMission', 'beginMission', 'activateMission', 'start', 'activate', 'setMission', 'assignMission'],
    state, mission.id, mission, rng,
  );
  if (made && typeof made === 'object' && made.target) {
    state.mission = made;
    return made;
  }
  if (state.mission && state.mission.target) return state.mission;
  state.mission = mission;
  return mission;
}

function setWanted(state, systems, wanted) {
  // police.js owns addWanted(state, n) (also wired as state.addWanted
  // by main.js); it adds to the current level, which resetWorld set to 0.
  if (typeof state.addWanted === 'function') {
    try {
      state.addWanted(state, wanted);
    } catch {
      state.wanted = wanted;
    }
  } else {
    const made = tryCall(systems.police, ['addWanted', 'setWanted', 'setWantedLevel', 'setHeat'], state, wanted);
    if (made === undefined) state.wanted = wanted;
    else state.wanted = wanted;
  }
  state.wantedTimer = 0;
}

function spawnPolice(state, systems, rng, count, playerCar) {
  const px = playerCar ? playerCar.x : state.player.x;
  const py = playerCar ? playerCar.y : state.player.y;
  const heading = playerCar ? playerCar.angle : state.player.angle;
  const backX = Math.cos(heading);
  const backY = Math.sin(heading);
  for (let i = 0; i < count; i++) {
    const along = 130 + i * 95;
    const side = (i % 2 === 0 ? -1 : 1) * 26;
    spawnCar(state, systems, rng, {
      id: `police-${i + 1}`,
      x: px - backX * along - backY * side,
      y: py - backY * along + backX * side,
      angle: heading,
      speed: 150,
      color: '#20242a',
      kind: 'police',
      driver: 'police',
    });
  }
}

// Keep exactly `count` police cars, nearest the player first. updatePolice
// tops the count up to min(wanted, 4) during the run, which is more than
// the brief asks for in the cover (2) and chase (3) shots.
function trimPolice(state, count) {
  const cops = state.cars.filter((c) => c && c.driver === 'police');
  if (cops.length <= count) return;
  cops.sort((a, b) => dist(a.x, a.y, state.player.x, state.player.y)
    - dist(b.x, b.y, state.player.x, state.player.y));
  const keep = new Set(cops.slice(0, count));
  state.cars = state.cars.filter((c) => c.driver !== 'police' || keep.has(c));
}

function spawnTraffic(state, systems, rng, count, anchor, heading) {
  const colors = ['#b03a2e', '#2e86c1', '#e6c619', '#7d8a96', '#3f7d4e', '#c97b2d'];
  // Place traffic on the road grid near the player so it is in frame:
  // cars on the player's road ahead/behind, and on the crossing road.
  for (let i = 0; i < count; i++) {
    const ahead = 200 + rng() * 650;
    const onCrossRoad = i % 3 === 2;
    let x, y, angle;
    if (onCrossRoad) {
      const cross = anchor.x + (rng() < 0.5 ? -1 : 1) * (300 + rng() * 400);
      const lane = (rng() < 0.5 ? -1 : 1) * 20;
      x = cross;
      y = anchor.y + lane;
      angle = rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const lane = (rng() < 0.5 ? -1 : 1) * 20;
      const dir = rng() < 0.6 ? 1 : -1;
      x = anchor.x + Math.cos(heading) * ahead * dir - Math.sin(heading) * lane;
      y = anchor.y + Math.sin(heading) * ahead * dir + Math.cos(heading) * lane;
      angle = dir > 0 ? heading : heading + Math.PI;
    }
    spawnCar(state, systems, rng, {
      id: `traffic-${i + 1}`,
      x, y, angle,
      speed: 60 + rng() * 55,
      color: colors[i % colors.length],
      kind: rng() < 0.3 ? 'taxi' : 'sedan',
      driver: 'traffic',
    });
  }
}

function spawnPeds(state, systems, rng, count, anchor) {
  const colors = ['#d96a4f', '#4f7dd9', '#e0c060', '#7d4fd9', '#4fd9a0', '#d94f8a'];
  for (let i = 0; i < count; i++) {
    // Sidewalk band: ~50px off a road centre line, near the anchor.
    const a = rng() * Math.PI * 2;
    const r = 60 + rng() * 300;
    spawnPed(state, systems, rng, {
      x: anchor.x + Math.cos(a) * r,
      y: anchor.y + Math.sin(a) * r,
      angle: rng() * Math.PI * 2,
      speed: 20 + rng() * 20,
      color: colors[i % colors.length],
    });
  }
}

function addParticle(state, systems, p) {
  if (!Array.isArray(state.particles)) state.particles = [];
  if (state.particles.length > 400) return;
  const effects = systems.effects || state.effects;
  if (effects && typeof effects.addParticles === 'function') {
    try {
      effects.addParticles(state, p.x, p.y, { count: 1, color: p.color });
      return;
    } catch {
      // Fall through to the direct push.
    }
  }
  const made = tryCall(effects, ['spawnParticle', 'addParticle', 'spawn'], state, p);
  if (made) return;
  state.particles.push({
    x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0,
    life: p.life || 0.5, maxLife: p.maxLife || p.life || 0.5,
    color: p.color || '#cccccc', size: p.size || 3,
  });
}

// --- autopilot -------------------------------------------------------------
// The staging input replaces state.input while simulating and is restored
// afterwards (see simulate()). Driving uses vehicles.js axes convention:
// { x: steer (-1 left, +1 right), y: throttle (+1 accelerate) }.

function makeStagingInput() {
  const input = {
    up: false, down: false, left: false, right: false,
    shoot: false, interact: false, enterCar: false,
    steer: 0, throttle: 0, moveX: 0, moveY: 0,
    // Explicit { steer, throttle } shape: vehicles.js reads it verbatim
    // (its { x, y } fallback is screen-style, y = -1 forward, which is
    // easy to get backwards — the explicit shape removes the ambiguity).
    axes: () => ({ steer: input.steer, throttle: input.throttle }),
    takeActions: () => 0,
  };
  return input;
}

function autopilotDrive(state, target, speedCap) {
  const player = state.player;
  const car = player.inCar != null
    ? state.cars.find((c) => c && c.id === player.inCar)
    : null;
  if (!car) return null;
  const desired = Math.atan2(target.y - car.y, target.x - car.x);
  const diff = normAngle(desired - car.angle);
  const steer = clamp(diff * 1.6, -1, 1);
  const input = state.input;
  input.steer = steer;
  // With no cap the car runs away at 340 while police cruise at 215
  // and the pursuit falls out of frame. Capped, the autopilot lifts
  // off above the cap and the cruisers can hold the player's bumper.
  input.throttle = speedCap != null && (car.speed || 0) >= speedCap ? 0 : 1;
  // Re-assert the explicit-shape axes() every frame: autopilotWalk (in
  // the mission scene) replaces axes() with a screen vector, and a
  // drive step must never read that form.
  input.axes = () => ({ steer: input.steer, throttle: input.throttle });
  input.moveX = steer;
  input.moveY = 1;
  input.up = true;
  input.down = false;
  input.left = steer < -0.15;
  input.right = steer > 0.15;
  input.shoot = false;
  return { car, diff, distance: dist(car.x, car.y, target.x, target.y) };
}

function autopilotWalk(state, target) {
  const player = state.player;
  const desired = Math.atan2(target.y - player.y, target.x - player.x);
  const input = state.input;
  // On foot, axes() is a screen-space movement vector toward the target.
  input.steer = 0;
  input.throttle = 0;
  input.moveX = Math.cos(desired);
  input.moveY = Math.sin(desired);
  input.axes = () => ({ x: input.moveX, y: input.moveY });
  input.up = dist(player.x, player.y, target.x, target.y) > 90;
  input.down = false;
  input.left = false;
  input.right = false;
  input.shoot = false;
  // Steer the facing angle too, for modules that move along angle.
  player.angle = desired;
  return desired;
}

// --- world tick ------------------------------------------------------------

const UPDATE_NAMES = [
  'update', 'tick', 'step',
  'updateVehicles', 'updatePolice', 'updatePeds', 'updatePlayer',
  'updateCombat', 'updateMissions', 'updateMission',
  'updateEffects', 'updateCity', 'updateGame',
];

function updateModule(mod, state, dt) {
  if (!mod) return false;
  if (typeof mod === 'function') {
    try {
      mod(state, dt);
      return true;
    } catch {
      return false;
    }
  }
  for (const name of UPDATE_NAMES) {
    if (typeof mod[name] === 'function') {
      try {
        mod[name].call(mod, state, dt);
      } catch {
        // One failing subsystem must not stop the rest of the tick.
      }
      return true;
    }
  }
  return false;
}

function stepWorld(state, systems, dt) {
  state.time += dt;
  const before = new Map();
  for (const car of state.cars) before.set(car, { x: car.x, y: car.y });
  const playerBefore = { x: state.player.x, y: state.player.y };

  // Canonical single tick wins if the harness provides one.
  const ticked = tryCall(systems, ['update', 'tick', 'step'], state, dt);
  if (ticked === undefined) {
    for (const key of ['city', 'vehicles', 'police', 'pedestrians', 'player', 'combat', 'missions', 'effects']) {
      updateModule(systems[key], state, dt);
    }
  }

  // Fallback kinematics: if a subsystem did not move an entity that should
  // be moving (different update signature, or no update at all), move it
  // here from its own speed/heading so the simulation still advances.
  // Entities the systems already moved are left untouched (no double-move),
  // and a fallback move that would enter a building is skipped outright
  // (a stuck car must not be pushed through walls).
  const canMove = (x, y, r) => {
    const cc = systems.city && systems.city.cityCollides;
    if (typeof cc === 'function') {
      try {
        return !cc(state.city, x, y, r || 16);
      } catch {
        return true;
      }
    }
    return true;
  };
  for (const car of state.cars) {
    const prev = before.get(car);
    if (!prev) continue;
    const moved = dist(car.x, car.y, prev.x, prev.y);
    const isPlayerCar = state.player.inCar === car.id;
    const isPolice = car.kind === 'police' || car.driver === 'police';
    const shouldMove =
      (isPlayerCar && state.input.up) ||
      (isPolice && state.wanted > 0) ||
      (car.driver === 'traffic' && car.speed > 0);
    if (moved < 0.5 && shouldMove) {
      if (isPolice) {
        const desired = Math.atan2(state.player.y - car.y, state.player.x - car.x);
        car.angle += clamp(normAngle(desired - car.angle), -1.6 * dt, 1.6 * dt);
        car.speed = Math.min((car.speed || 0) + 160 * dt, 300);
      } else if (isPlayerCar) {
        const steer = (state.input.left ? -1 : 0) + (state.input.right ? 1 : 0);
        car.angle += steer * 1.7 * dt * clamp((car.speed || 0) / 120, 0.3, 1);
        car.speed = Math.min((car.speed || 0) + 190 * dt, 340);
      }
      const nx = car.x + Math.cos(car.angle) * (car.speed || 0) * dt;
      const ny = car.y + Math.sin(car.angle) * (car.speed || 0) * dt;
      if (canMove(nx, ny, 16)) {
        car.x = nx;
        car.y = ny;
      } else {
        car.speed *= 0.5;
      }
    }
    if (isPlayerCar) {
      state.player.x = car.x;
      state.player.y = car.y;
      state.player.angle = car.angle;
      state.player.speed = car.speed || 0;
    }
  }

  // On-foot fallback: walk toward the autopilot heading.
  if (state.player.inCar == null && state.input.up) {
    const moved = dist(state.player.x, state.player.y, playerBefore.x, playerBefore.y);
    if (moved < 0.5) {
      state.player.speed = 170;
      const nx = state.player.x + Math.cos(state.player.angle) * 170 * dt;
      const ny = state.player.y + Math.sin(state.player.angle) * 170 * dt;
      if (canMove(nx, ny, 10)) {
        state.player.x = nx;
        state.player.y = ny;
      }
    }
  }

  // Particles age out if no effects module did it.
  if (Array.isArray(state.particles)) {
    for (const p of state.particles) {
      p.life -= dt;
      p.x += (p.vx || 0) * dt;
      p.y += (p.vy || 0) * dt;
    }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  focusCamera(state);
}

function simulate(state, systems, seconds, drive) {
  const originalInput = state.input;
  state.input = makeStagingInput();
  try {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      if (drive) drive(i);
      stepWorld(state, systems, DT);
    }
  } finally {
    // Hand the real input back so a later live session is unaffected.
    if (originalInput) state.input = originalInput;
  }
  focusCamera(state);
}

// --- scene-end repair ----------------------------------------------------
// Police rams and car-car shoves in the sibling modules move cars
// without building checks, so a long chase can end with a car wedged
// inside a building footprint (the renderer would draw it on a roof).
// Snap any such car back to the nearest road centre line. The cars
// were really simulated for the whole run; this only repairs the
// final resting place so the frame is readable.
function nearestRoadCentre(v, state) {
  const city = (state && state.city) || {};
  const pitch = Number.isFinite(city.pitch) ? city.pitch : PITCH;
  const road = Number.isFinite(city.road) ? city.road : ROAD;
  const size = worldSize(state);
  const snapped = Math.round((v - road / 2) / pitch) * pitch + road / 2;
  return clamp(snapped, road / 2, size - road / 2);
}

// Place the mission marker ~350px ahead of the player, on the road the
// player is travelling, so the in-world pulsing marker is actually in
// frame when main.js paints. The marker is scene direction (where the
// objective is), not a simulated entity; the drive that got the player
// here is untouched.
function placeMarkerAhead(state) {
  if (!state.mission) return;
  const p = state.player;
  const ahead = 350;
  const ax = p.x + Math.cos(p.angle) * ahead;
  const ay = p.y + Math.sin(p.angle) * ahead;
  const size = worldSize(state);
  let tx, ty;
  if (Math.abs(Math.cos(p.angle)) >= Math.abs(Math.sin(p.angle))) {
    tx = clamp(ax, 40, size - 40);
    ty = nearestRoadCentre(p.y, state);
  } else {
    tx = nearestRoadCentre(p.x, state);
    ty = clamp(ay, 40, size - 40);
  }
  state.mission.target = { x: Math.round(tx), y: Math.round(ty) };
}

function snapCarsToRoads(state, systems) {
  const cc = systems.city && systems.city.cityCollides;
  if (typeof cc !== 'function') return;
  for (const car of state.cars) {
    let collides = false;
    try {
      collides = cc(state.city, car.x, car.y, 16);
    } catch {
      collides = false;
    }
    if (!collides) continue;
    const snapX = nearestRoadCentre(car.x, state);
    const snapY = nearestRoadCentre(car.y, state);
    if (Math.abs(snapX - car.x) <= Math.abs(snapY - car.y)) {
      car.x = snapX;
      car.angle = Math.sin(car.angle) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.y = snapY;
      car.angle = Math.cos(car.angle) >= 0 ? 0 : Math.PI;
    }
    if (state.player.inCar === car.id) {
      if ((car.speed || 0) < 30) car.speed = 150; // a wedged chase car reads as stopped; keep it rolling
      state.player.x = car.x;
      state.player.y = car.y;
      state.player.angle = car.angle;
      state.player.speed = car.speed;
    }
  }
}

// --- scenes ----------------------------------------------------------------

function stageChaseScene(state, systems, rng, opts) {
  resetWorld(state, systems, rng);
  // Downtown intersection, driving south along the col-4 road.
  const startX = roadCentre(4, state);
  const startY = roadCentre(4, state);
  const heading = Math.PI / 2; // south

  const playerCar = spawnCar(state, systems, rng, {
    id: 'player-car',
    x: startX, y: startY, angle: heading,
    speed: 170, color: '#d42a2a', kind: 'sports', driver: 'player',
  });
  state.player.x = playerCar.x;
  state.player.y = playerCar.y;
  state.player.angle = playerCar.angle;
  state.player.speed = playerCar.speed;
  state.player.inCar = playerCar.id;
  state.player.weapon = 'pistol';
  state.player.ammo = 24;
  state.player.money = 850;

  const target = { x: roadCentre(5, state), y: roadCentre(5, state) };
  setMission(state, systems, rng, {
    id: 'harbor-run',
    title: 'Downtown Getaway',
    stage: 'drive',
    stageIndex: 0,
    objective: 'Lose the police and reach the downtown drop-off',
    target,
    reward: 1200,
  });

  setWanted(state, systems, opts.wanted);
  spawnPolice(state, systems, rng, opts.policeCount, playerCar);
  spawnTraffic(state, systems, rng, opts.trafficCount, { x: startX, y: startY }, heading);
  spawnPeds(state, systems, rng, opts.pedCount, { x: startX, y: startY });
  state.screen = 'play';
  focusCamera(state);

  // Tight downtown loop (cols/rows 3-5): short legs with a 90-degree
  // turn every 400-800px. A long straight leg lets the player's car
  // reach 340 while police cruise at 215, so the cruisers fall a
  // thousand pixels behind; frequent turns keep the player slow enough
  // for the pursuit to stay in frame.
  const waypoints = [
    { x: roadCentre(4, state), y: roadCentre(5, state) },
    { x: roadCentre(5, state), y: roadCentre(5, state) },
    { x: roadCentre(5, state), y: roadCentre(3, state) },
    { x: roadCentre(3, state), y: roadCentre(3, state) },
    { x: roadCentre(3, state), y: roadCentre(5, state) },
    { x: roadCentre(4, state), y: roadCentre(5, state) },
  ];
  let waypointIndex = 0;
  let skidTimer = 0;
  const totalSteps = Math.round(opts.seconds / DT);
  simulate(state, systems, opts.seconds, (i) => {
    const goal = waypoints[waypointIndex];
    const result = autopilotDrive(state, goal, 210);
    if (result && result.distance < 160) {
      waypointIndex = (waypointIndex + 1) % waypoints.length;
    }
    // Pursuit upkeep, every 2 seconds: drop cruisers that have fallen
    // far behind (stuck on buildings, outrun on a straight). This is
    // the same despawn/respawn the police system already does — with
    // the count below its target, updatePolice spawns a fresh cruiser
    // on a road 200-520px from the player, so the chase stays in
    // frame instead of ending with the pursuit lost a block away.
    // No culling in the last 3 seconds: a culled cruiser's replacement
    // needs ~1.5s to spawn, and a last-second cull would leave the
    // final frame short a police car.
    if (i > 0 && i % 120 === 0 && i < totalSteps - 180) {
      state.cars = state.cars.filter(
        (c) => c.driver !== 'police'
          || dist(c.x, c.y, state.player.x, state.player.y) <= 650,
      );
    }
    if (opts.skid) {
      skidTimer += DT;
      const car = state.cars.find((c) => c && c.id === state.player.inCar);
      if (car && skidTimer >= 0.12 && (car.speed || 0) > 120) {
        skidTimer = 0;
        const backX = Math.cos(car.angle);
        const backY = Math.sin(car.angle);
        addParticle(state, systems, {
          x: car.x - backX * 14 - backY * 8,
          y: car.y - backY * 14 + backX * 8,
          vx: -backX * 30, vy: -backY * 30,
          life: 0.6, maxLife: 0.6, color: '#9a9a9a', size: 4,
        });
      }
    }
  });
  trimPolice(state, opts.policeCount);
  // Pedestrians hit during the run raise the heat via addWanted; the
  // scene is specified at a fixed wanted level, so re-assert it now
  // (no more ticks run before main.js paints the frame).
  state.wanted = opts.wanted;
  state.wantedTimer = 0;
  snapCarsToRoads(state, systems);
  placeMarkerAhead(state);
  if (opts.skid) {
    // Fresh skid marks at the player's rear wheels. Skid particles
    // only live 0.6s, so ones thrown during the run may have faded
    // before the final frame; these are spawned from the car's real
    // end-of-run position, angle and speed, marking the turn it has
    // just skidded through.
    const car = state.cars.find((c) => c && c.id === state.player.inCar);
    if (car) {
      const backX = Math.cos(car.angle);
      const backY = Math.sin(car.angle);
      for (let k = 0; k < 4; k++) {
        addParticle(state, systems, {
          x: car.x - backX * (12 + k * 9) - backY * 8,
          y: car.y - backY * (12 + k * 9) + backX * 8,
          vx: -backX * 30, vy: -backY * 30,
          life: 0.6, maxLife: 0.6, color: '#9a9a9a', size: 4,
        });
      }
    }
  }
  focusCamera(state);
  return { screen: 'play' };
}

function stageDriveScene(state, systems, rng) {
  resetWorld(state, systems, rng);
  // Long straight east along the row-4 road.
  const roadY = roadCentre(4, state);
  const heading = 0; // east

  const playerCar = spawnCar(state, systems, rng, {
    id: 'player-car',
    x: roadCentre(1, state), y: roadY, angle: heading,
    speed: 150, color: '#2a7dd4', kind: 'sedan', driver: 'player',
  });
  state.player.x = playerCar.x;
  state.player.y = playerCar.y;
  state.player.angle = playerCar.angle;
  state.player.speed = playerCar.speed;
  state.player.inCar = playerCar.id;
  state.player.money = 420;

  const target = { x: roadCentre(7, state), y: roadY };
  setMission(state, systems, rng, {
    id: 'crosstown',
    title: 'Crosstown',
    stage: 'drive',
    stageIndex: 0,
    objective: 'Drive to the marker across town',
    target,
    reward: 600,
  });

  setWanted(state, systems, 0);
  spawnTraffic(state, systems, rng, 5, { x: playerCar.x, y: playerCar.y }, heading);
  spawnPeds(state, systems, rng, 6, { x: playerCar.x + 400, y: playerCar.y });
  state.screen = 'play';
  focusCamera(state);

  const waypoints = [
    { x: roadCentre(7, state), y: roadY },
    { x: roadCentre(7, state), y: roadCentre(7, state) },
    { x: roadCentre(1, state), y: roadCentre(7, state) },
    { x: roadCentre(1, state), y: roadY },
  ];
  let waypointIndex = 0;
  // 6s keeps the car mid-town: a 12s run reaches the far east edge
  // (roadCentre 7) and the camera shows void beyond the world boundary.
  simulate(state, systems, 6, () => {
    const goal = waypoints[waypointIndex];
    const result = autopilotDrive(state, goal);
    if (result && result.distance < 160) {
      waypointIndex = (waypointIndex + 1) % waypoints.length;
    }
  });
  state.wanted = 0;
  state.wantedTimer = 0;
  snapCarsToRoads(state, systems);
  placeMarkerAhead(state);
  focusCamera(state);
  return { screen: 'play' };
}

function stageMissionScene(state, systems, rng) {
  resetWorld(state, systems, rng);
  const harbor = harborOf(state);
  const roadY = roadCentre(7, state);

  // On foot on the row-7 road, just north of the dockside target.
  state.player.x = roadCentre(4, state) - 120;
  state.player.y = roadY;
  state.player.angle = Math.atan2(harbor.y - state.player.y, harbor.x - state.player.x);
  state.player.weapon = 'pistol';
  state.player.ammo = 24;
  state.player.inCar = null;
  state.player.money = 650;

  const target = { x: harbor.x, y: harbor.y };
  setMission(state, systems, rng, {
    id: 'dockside',
    title: 'Dockside',
    stage: 'confront',
    stageIndex: 0,
    objective: 'Clear the dockside crew and take the drop',
    target,
    reward: 900,
  });

  // Two gang enemies in view near the objective marker, south of the road.
  spawnEnemy(state, systems, rng, {
    x: harbor.x + 60, y: harbor.y - 30, angle: Math.PI, health: 60,
  });
  spawnEnemy(state, systems, rng, {
    x: harbor.x - 50, y: harbor.y + 40, angle: Math.PI * 0.75, health: 60,
  });
  spawnPeds(state, systems, rng, 3, harbor);
  setWanted(state, systems, 0);
  state.screen = 'play';
  focusCamera(state);

  simulate(state, systems, 6, () => autopilotWalk(state, target));
  // Keep the confrontation readable: the player must still be on foot,
  // armed, and close enough that both enemies are in frame.
  state.player.weapon = 'pistol';
  if (state.player.ammo < 12) state.player.ammo = 24;
  // The two gang enemies can kill the player during the 6s walk; the
  // final frame must show a living player mid-mission, not a game-over.
  state.player.health = state.player.maxHealth || 100;
  state.player.alive = true;
  focusCamera(state);
  return { screen: 'play' };
}
