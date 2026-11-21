// vehicles.js — Solmar Bay (original work)
// Cars and driving: traffic, the player's car, entering / exiting cars.
// No code copied from any kit, tutorial, or existing game.
//
// Interface assumptions (see task brief):
//  - state.city is passed to the city.js helpers; this file imports
//    city.js as a namespace and resolves cityCollides / cityRoadPoint
//    from it at call time, falling back to city bounds when absent.
//  - state.input.axes() returns { x, y } exactly as input.js builds
//    it: x = steer (-1 left, +1 right), y = -1 when W / Up is held
//    (screen-style: up is negative). So forward throttle is -y and
//    reverse / brake is +y. An explicit { steer, throttle } shape is
//    also accepted and takes precedence.
//  - city.js returns headings in DEGREES (0 = east, 90 = south);
//    this file converts them to radians at the city boundary and
//    uses radians everywhere internally.
//  - city.js road / sidewalk helpers take a random.js-style rng
//    object ({ next, range, int, pick }), not a bare function; this
//    file adapts state.rng (or Math.random) into that shape.
//  - The city object carries `size` (world side length, 3200), not
//    width / height; bounds code reads size first.
//  - state.addWanted, when present, is the police module's function
//    wired onto state by main.js (this file never imports police.js).
//  - state.audio methods are optional; every call is guarded.
//  - Effects are reached via state.effects.addParticles when present,
//    else state.addParticles, else particles are pushed directly
//    into state.particles.
//  - Cars carry the shared shape { id, x, y, angle, speed, color,
//    kind, driver, health }. Extra per-car timers use underscore
//    fields (e.g. car._turnTimer) so the shared shape stays intact.

import * as city from './city.js';

// ---------------------------------------------------------------- helpers

const CAR_COLORS = [
  '#e63946', '#f4a261', '#f7c548', '#2a9d8f', '#457b9d',
  '#7b2cbf', '#ff6d9d', '#90be6d', '#f9844a', '#4cc9f0',
  '#e07a5f', '#81b29a', '#e9c46a', '#ef476f', '#06d6a0',
  '#118ab2', '#ffd166', '#c77dff', '#8ac926', '#ff9f1c',
];

const TRAFFIC_KINDS = ['sedan', 'taxi', 'sport'];
const TAXI_COLOR = '#ffd60a';

const PLAYER_MAX_SPEED = 340;
const PLAYER_REVERSE_SPEED = 130;
const PLAYER_ACCEL = 300;
const PLAYER_BRAKE = 520;
const PLAYER_TURN_RATE = 2.6; // rad/s at full steering
const CAR_RADIUS = 16;
const TRAFFIC_CRUISE_MIN = 70;
const TRAFFIC_CRUISE_MAX = 115;
const POLICE_CRUISE = 215;

function rngFn(state) {
  // Return a random.js-style rng object ({ next, range, int, pick }).
  // state.rng may already be one; a bare function is wrapped; otherwise
  // Math.random backs it. city.js helpers call rng.next()/int()/range().
  const r = state.rng;
  if (r && typeof r.next === 'function' && typeof r.range === 'function') return r;
  const next = typeof r === 'function' ? r : Math.random;
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => Math.floor(a + next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

function citySize(state) {
  const c = state.city || {};
  return typeof c.size === 'number' ? c.size
    : typeof c.width === 'number' ? c.width : 2000;
}

function nextCarId(state) {
  state._nextCarId = (state._nextCarId || 0) + 1;
  return state._nextCarId;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function collides(state, x, y, r) {
  if (typeof city.cityCollides === 'function') {
    return city.cityCollides(state.city, x, y, r);
  }
  // Fallback: stay inside the city square when one is known.
  const size = citySize(state);
  return x < r || y < r || x > size - r || y > size - r;
}

function roadPoint(state) {
  const rng = rngFn(state);
  if (typeof city.cityRoadPoint === 'function') {
    const p = city.cityRoadPoint(state.city, rng);
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      // city.js headings are degrees; convert to radians.
      return { x: p.x, y: p.y, angle: (p.angle || 0) * Math.PI / 180 };
    }
  }
  // Fallback: a random point inside the city square.
  const size = citySize(state);
  return { x: 40 + rng.next() * (size - 80), y: 40 + rng.next() * (size - 80), angle: rng.next() * Math.PI * 2 };
}

function burst(state, x, y, opts = {}) {
  const count = opts.count || 10;
  const color = opts.color || '#ffd166';
  if (state.effects && typeof state.effects.addParticles === 'function') {
    state.effects.addParticles(state, x, y, opts);
    return;
  }
  if (typeof state.addParticles === 'function') {
    state.addParticles(state, x, y, opts);
    return;
  }
  if (Array.isArray(state.particles)) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 120;
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5, maxLife: 0.5, color, size: 2 + Math.random() * 3,
      });
    }
  }
}

function playSound(state, ...names) {
  const a = state.audio;
  if (!a) return;
  for (const name of names) {
    if (typeof a[name] === 'function') {
      try { a[name](); } catch { /* audio is best-effort */ }
      return;
    }
  }
  if (typeof a.play === 'function') {
    try { a.play(names[0]); } catch { /* audio is best-effort */ }
  }
}

function readAxes(state) {
  const input = state.input;
  if (!input || typeof input.axes !== 'function') return { steer: 0, throttle: 0 };
  let a = {};
  try { a = input.axes() || {}; } catch { return { steer: 0, throttle: 0 }; }
  const steer = a.steer ?? a.x ?? 0;
  // input.js: y = -1 for W / Up, so forward throttle is -y.
  const throttle = a.throttle ?? a.accelerate ?? -(a.y ?? 0);
  return { steer: clamp(steer, -1, 1), throttle: clamp(throttle, -1, 1) };
}

// ---------------------------------------------------------------- spawning

export function spawnTraffic(state, n) {
  if (!Array.isArray(state.cars)) state.cars = [];
  const rng = rngFn(state);
  for (let i = 0; i < n; i++) {
    const p = roadPoint(state);
    const kind = TRAFFIC_KINDS[Math.floor(rng.next() * TRAFFIC_KINDS.length)];
    const color = kind === 'taxi'
      ? TAXI_COLOR
      : CAR_COLORS[Math.floor(rng.next() * CAR_COLORS.length)];
    const cruise = TRAFFIC_CRUISE_MIN + rng.next() * (TRAFFIC_CRUISE_MAX - TRAFFIC_CRUISE_MIN);
    state.cars.push({
      id: nextCarId(state),
      x: p.x,
      y: p.y,
      angle: typeof p.angle === 'number' ? p.angle : rng.next() * Math.PI * 2,
      speed: cruise * (0.7 + rng.next() * 0.3),
      color,
      kind,
      driver: 'traffic',
      health: 100,
      _cruise: cruise,
      _turnTimer: 2 + rng.next() * 4,
      _pauseTimer: 0,
      _hitCooldown: 0,
    });
  }
  return state.cars;
}

// ---------------------------------------------------------------- lookup

export function nearestCar(state, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of state.cars || []) {
    const d = dist(x, y, car.x, car.y);
    if (d <= bestD) {
      best = car;
      bestD = d;
    }
  }
  return best;
}

function playerCar(state) {
  if (!state.player || state.player.inCar == null) return null;
  return (state.cars || []).find((c) => c.id === state.player.inCar) || null;
}

// ---------------------------------------------------------------- enter / exit

export function enterCar(state) {
  const player = state.player;
  if (!player || player.inCar != null) return null;
  const car = nearestCar(state, player.x, player.y, 56);
  if (!car) return null;

  const wasPlayerCar = car.driver === 'player';
  const stolen = car.driver === 'traffic' || (car.driver === 'parked' && !!car.owner);

  car.driver = 'player';
  player.inCar = car.id;
  player.angle = car.angle;
  player.speed = car.speed || 0;
  player.x = car.x;
  player.y = car.y;

  if (!wasPlayerCar && stolen) {
    if (state.stats) state.stats.stolen = (state.stats.stolen || 0) + 1;
    if (typeof state.addWanted === 'function') state.addWanted(state, 1);
    state.dialogue = {
      speaker: 'You',
      text: 'You stole a car!',
      until: (state.time || 0) + 2.5,
    };
    playSound(state, 'pickup', 'click');
  }
  return car;
}

export function exitCar(state) {
  const player = state.player;
  if (!player || player.inCar == null) return false;
  const car = playerCar(state);
  player.inCar = null;
  player.speed = 0;
  if (!car) return true;

  car.driver = 'parked';
  car.speed = 0;
  // Place the player beside the car (perpendicular offset), trying
  // both sides so they do not end up inside a building.
  const side = Math.PI / 2;
  const spots = [
    { x: car.x + Math.cos(car.angle + side) * 28, y: car.y + Math.sin(car.angle + side) * 28 },
    { x: car.x + Math.cos(car.angle - side) * 28, y: car.y + Math.sin(car.angle - side) * 28 },
    { x: car.x - Math.cos(car.angle) * 30, y: car.y - Math.sin(car.angle) * 30 },
  ];
  let spot = spots[2];
  for (const s of spots) {
    if (!collides(state, s.x, s.y, 10)) { spot = s; break; }
  }
  player.x = spot.x;
  player.y = spot.y;
  player.angle = car.angle;
  return true;
}

// ---------------------------------------------------------------- movement

function carAhead(state, car, lookAhead) {
  // Nearest other car roughly in front of `car`, within lookAhead px.
  let closest = null;
  let closestD = lookAhead;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  for (const other of state.cars || []) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const d = Math.hypot(dx, dy);
    if (d > lookAhead || d < 1) continue;
    // In front? Dot product with facing direction must be positive
    // and the lateral offset small relative to distance.
    const forward = (dx * fx + dy * fy) / d;
    if (forward < 0.6) continue;
    if (d < closestD) {
      closest = other;
      closestD = d;
    }
  }
  return closest;
}

function moveWithBuildingCollision(state, car, dt) {
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  if (!collides(state, nx, ny, CAR_RADIUS)) {
    car.x = nx;
    car.y = ny;
    return false;
  }
  // Slide along one axis if possible, otherwise stop.
  if (!collides(state, nx, car.y, CAR_RADIUS)) {
    car.x = nx;
    return true;
  }
  if (!collides(state, car.x, ny, CAR_RADIUS)) {
    car.y = ny;
    return true;
  }
  return true;
}

function drivePlayerCar(state, car, dt) {
  const { steer, throttle } = readAxes(state);
  const speedAbs = Math.abs(car.speed);
  // A small steering floor so a stopped car can still turn away from a wall
  // instead of sitting pinned against it.
  const speedFactor = Math.max(0.15, clamp(speedAbs / 120, 0, 1));

  if (throttle > 0) {
    car.speed += PLAYER_ACCEL * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 5) {
      // Braking while moving forward.
      car.speed += PLAYER_BRAKE * throttle * dt;
    } else {
      // Reversing.
      car.speed += PLAYER_ACCEL * 0.6 * throttle * dt;
    }
  } else {
    // Coast / drag.
    car.speed -= car.speed * 0.9 * dt;
    if (Math.abs(car.speed) < 2) car.speed = 0;
  }

  car.speed = clamp(car.speed, -PLAYER_REVERSE_SPEED, PLAYER_MAX_SPEED);

  // Steering: stronger at moderate speed, none when stationary, and
  // reversed when reversing. A little drift: at high speed the car
  // turns slightly less sharply, so it feels like it slides.
  const direction = car.speed >= 0 ? 1 : -1;
  const drift = isHighSpeed(speedAbs) ? 0.75 : 1;
  car.angle += steer * PLAYER_TURN_RATE * speedFactor * direction * drift * dt;

  const hitWall = moveWithBuildingCollision(state, car, dt);
  if (hitWall) {
    if (speedAbs > 90) {
      // Hard hit: small damage, sparks, sound.
      car.health = Math.max(0, (car.health ?? 100) - 5);
      burst(state, car.x, car.y, { count: 12, color: '#ffd166' });
      playSound(state, 'hit', 'explosion');
    }
    car.speed *= -0.15;
    if (Math.abs(car.speed) < 5) car.speed = 0;
  }
  return hitWall;
}

// High speed is where drift shows.
function isHighSpeed(speedAbs) {
  return speedAbs > 220;
}

function driveTrafficCar(state, car, dt) {
  const rng = rngFn(state);
  car._turnTimer = (car._turnTimer ?? 3) - dt;
  car._pauseTimer = Math.max(0, (car._pauseTimer ?? 0) - dt);

  if (car._turnTimer <= 0) {
    car._turnTimer = 2 + rng.next() * 4;
    // Turn at an intersection: left, right, or straight.
    const roll = rng.next();
    if (roll < 0.25) car.angle += Math.PI / 2;
    else if (roll < 0.5) car.angle -= Math.PI / 2;
    // Otherwise keep going straight.
    if (rng.next() < 0.12) car._pauseTimer = 0.8 + rng.next() * 1.6; // brief stop
  }

  let target = car._cruise ?? 90;
  if (car._pauseTimer > 0) target = 0;
  const ahead = carAhead(state, car, 70);
  if (ahead) {
    // Slow down for the car in front; stop if it is very close.
    const gap = dist(car.x, car.y, ahead.x, ahead.y);
    target = gap < 38 ? 0 : Math.min(target, ahead.speed * 0.9);
  }

  // Ease toward the target speed.
  if (car.speed < target) car.speed = Math.min(target, car.speed + 120 * dt);
  else if (car.speed > target) car.speed = Math.max(target, car.speed - 220 * dt);

  const hitWall = moveWithBuildingCollision(state, car, dt);
  if (hitWall) {
    // Blocked by a building: stop and turn around / aside.
    car.speed = 0;
    car.angle += (rng.next() < 0.5 ? 1 : -1) * (Math.PI / 2);
    car._turnTimer = 1 + rng.next() * 2;
  }
}

function drivePoliceCar(state, car, dt) {
  const player = state.player;
  const rng = rngFn(state);
  if (!player || (state.wanted || 0) <= 0) {
    // No heat: cruise like ordinary traffic.
    driveTrafficCar(state, car, dt);
    return;
  }

  // Chase: steer toward the player, faster than traffic.
  const desired = Math.atan2(player.y - car.y, player.x - car.x);
  const diff = angleDiff(desired, car.angle);
  const turn = clamp(diff, -1, 1) * 3.2 * dt;
  car.angle += turn;

  const ahead = carAhead(state, car, 60);
  let target = POLICE_CRUISE;
  if (ahead && ahead.driver !== 'player') target = Math.min(target, ahead.speed);
  if (car.speed < target) car.speed = Math.min(target, car.speed + 200 * dt);
  else if (car.speed > target) car.speed = Math.max(target, car.speed - 200 * dt);

  const hitWall = moveWithBuildingCollision(state, car, dt);
  if (hitWall) {
    car.speed *= 0.3;
    car.angle += (rng.next() < 0.5 ? 1 : -1) * (Math.PI / 3);
  }
}

function resolveCarCollisions(state, dt) {
  const cars = state.cars || [];
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    a._hitCooldown = Math.max(0, (a._hitCooldown ?? 0) - dt);
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = CAR_RADIUS * 2 - 4;
      if (d >= minD || d < 0.01) continue;

      // Push apart along the line between them.
      const push = (minD - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      const aParked = a.driver === 'parked';
      const bParked = b.driver === 'parked';
      if (!aParked) { a.x -= nx * push; a.y -= ny * push; }
      if (!bParked) { b.x += nx * push; b.y += ny * push; }
      if (aParked && bParked) continue;

      // Damage on a hard impact, rate-limited per car.
      const impact = Math.abs(a.speed - b.speed);
      if (impact > 60 && (a._hitCooldown <= 0 || b._hitCooldown <= 0)) {
        const dmg = Math.min(12, Math.round(impact / 25));
        if (!aParked) { a.health = Math.max(0, (a.health ?? 100) - dmg); a._hitCooldown = 0.5; }
        if (!bParked) { b.health = Math.max(0, (b.health ?? 100) - dmg); b._hitCooldown = 0.5; }
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        burst(state, mx, my, { count: 8, color: '#e0e0e0' });
        if (a.driver === 'player' || b.driver === 'player') {
          playSound(state, 'hit', 'explosion');
        }
      }

      // Exchange a little speed so the shove reads as a collision.
      if (!aParked && !bParked) {
        const avg = (a.speed + b.speed) / 2;
        a.speed = avg * 0.7;
        b.speed = avg * 0.7;
      } else if (aParked && !bParked) {
        b.speed *= 0.4;
      } else if (bParked && !aParked) {
        a.speed *= 0.4;
      }
    }
  }
}

function keepInCity(state, car) {
  const c = state.city;
  if (!c) return;
  const size = citySize(state);
  const m = 24;
  // Keep cars out of the southern bay as well as off the map edge.
  const maxY = c.water && typeof c.water.y === 'number' ? c.water.y - m : size - m;
  if (car.x < m || car.x > size - m || car.y < m || car.y > maxY) {
    car.x = clamp(car.x, m, size - m);
    car.y = clamp(car.y, m, maxY);
    // Turn back into the city instead of grinding along the edge.
    if (car.driver === 'traffic' || car.driver === 'police') {
      car.angle = Math.atan2(size / 2 - car.y, size / 2 - car.x);
    } else if (car.driver === 'player') {
      car.speed *= 0.5;
    }
  }
}

export function updateVehicles(state, dt) {
  const step = clamp(dt || 0, 0, 0.05);
  if (step <= 0) return;
  const cars = state.cars || [];

  for (const car of cars) {
    if (car.driver === 'parked') {
      car.speed = 0;
      continue;
    }
    if (car.driver === 'player') {
      drivePlayerCar(state, car, step);
    } else if (car.driver === 'police') {
      drivePoliceCar(state, car, step);
    } else {
      // 'traffic' and any unknown driver: drive like traffic.
      driveTrafficCar(state, car, step);
    }
    keepInCity(state, car);
  }

  resolveCarCollisions(state, step);

  // Keep the on-foot player glued to the car they are driving.
  const pc = playerCar(state);
  if (pc && state.player) {
    state.player.x = pc.x;
    state.player.y = pc.y;
    state.player.angle = pc.angle;
    state.player.speed = pc.speed;
  }
}
