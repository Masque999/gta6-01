// pedestrians.js — Solmar Bay (original work)
// Pedestrians: sidewalk walking, fleeing from danger, getting hit.
// No code copied from any kit, tutorial, or existing game.
//
// Interface assumptions (see task brief):
//  - Sidewalk points come from city.js citySidewalkPoint via a
//    namespace import, with a city-bounds fallback when absent;
//    building checks use city.cityCollides the same way.
//    city.js headings are degrees (0 = east, 90 = south) and its
//    helpers take a random.js-style rng object ({ next, range, int,
//    pick }); both are converted / adapted at the boundary here.
//    The city object carries `size`, not width / height.
//  - state.lastShotAt, when present, is { x, y, time } (or { x, y, at })
//    in the same world coordinates and clock as state.time; a shot
//    is "nearby" if it is within SHOT_FLEE_RADIUS px and happened
//    within SHOT_FLEE_WINDOW seconds.
//  - state.addWanted, when present, is the police module's function
//    wired onto state by main.js; it is called exactly once per
//    pedestrian hit (guarded by ped._wantedCounted).
//  - Effects are reached via state.effects.addParticles when present,
//    else state.addParticles, else particles are pushed directly
//    into state.particles.
//  - Peds carry the shared shape { x, y, angle, speed, color, state }
//    where state is 'walk' | 'flee' | 'down'. Extra timers use
//    underscore fields (e.g. ped._fleeTimer) so the shape stays intact.
//  - A 'down' pedestrian fades out after DOWN_FADE_SECONDS and then
//    respawns on another sidewalk, so the streets stay populated.

import * as city from './city.js';

// ---------------------------------------------------------------- constants

const PED_COLORS = [
  '#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#7b2cbf',
  '#ff6d9d', '#90be6d', '#f9844a', '#4cc9f0', '#e9c46a',
  '#ef476f', '#06d6a0', '#118ab2', '#ffd166', '#c77dff',
  '#8ac926', '#ff9f1c', '#adb5bd', '#6c757d', '#dee2e6',
];

const WALK_SPEED_MIN = 18;
const WALK_SPEED_MAX = 34;
const FLEE_SPEED = 95;
const FLEE_DURATION = 3;
const FLEE_RADIUS_CAR = 70;   // a fast car this close spooks a ped
const FLEE_RADIUS_PLAYER = 46; // a fast-moving player on foot, ditto
const FAST_SPEED = 60;         // "fast" threshold for cars / player
const SHOT_FLEE_RADIUS = 240;
const SHOT_FLEE_WINDOW = 3;    // seconds after the shot
const HIT_DISTANCE = 24;       // car close enough to knock a ped down
const HIT_MIN_CAR_SPEED = 40;
const DOWN_FADE_SECONDS = 4;
const PED_RADIUS = 10;

// ---------------------------------------------------------------- helpers

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

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function collides(state, x, y, r) {
  if (typeof city.cityCollides === 'function') {
    return city.cityCollides(state.city, x, y, r);
  }
  const size = citySize(state);
  return x < r || y < r || x > size - r || y > size - r;
}

function sidewalkPoint(state) {
  const rng = rngFn(state);
  if (typeof city.citySidewalkPoint === 'function') {
    const p = city.citySidewalkPoint(state.city, rng);
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      // city.js headings are degrees; convert to radians.
      return { x: p.x, y: p.y, angle: (p.angle || 0) * Math.PI / 180 };
    }
  }
  const size = citySize(state);
  return { x: 40 + rng.next() * (size - 80), y: 40 + rng.next() * (size - 80), angle: rng.next() * Math.PI * 2 };
}

function burst(state, x, y, opts = {}) {
  const count = opts.count || 10;
  const color = opts.color || '#ff4d4d';
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
      const s = 30 + Math.random() * 90;
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5, maxLife: 0.5, color, size: 2 + Math.random() * 3,
      });
    }
  }
}

function makePed(state) {
  const rng = rngFn(state);
  const p = sidewalkPoint(state);
  return {
    x: p.x,
    y: p.y,
    angle: typeof p.angle === 'number' ? p.angle : rng.next() * Math.PI * 2,
    speed: WALK_SPEED_MIN + rng.next() * (WALK_SPEED_MAX - WALK_SPEED_MIN),
    color: PED_COLORS[Math.floor(rng.next() * PED_COLORS.length)],
    state: 'walk',
    _walkSpeed: 0, // filled in below from speed, kept for resume after flee
    _turnTimer: 2 + rng.next() * 4,
    _fleeTimer: 0,
    _downTimer: 0,
    _wantedCounted: false,
  };
}

// ---------------------------------------------------------------- spawning

export function spawnPeds(state, n) {
  if (!Array.isArray(state.peds)) state.peds = [];
  for (let i = 0; i < n; i++) {
    const ped = makePed(state);
    ped._walkSpeed = ped.speed;
    state.peds.push(ped);
  }
  return state.peds;
}

// ---------------------------------------------------------------- threats

function shotThreat(state, ped) {
  const shot = state.lastShotAt;
  if (!shot || typeof shot.x !== 'number' || typeof shot.y !== 'number') return null;
  const when = shot.time ?? shot.at ?? state.time;
  if (typeof when === 'number' && typeof state.time === 'number') {
    if (state.time - when > SHOT_FLEE_WINDOW) return null;
  }
  if (dist(ped.x, ped.y, shot.x, shot.y) > SHOT_FLEE_RADIUS) return null;
  return shot;
}

function nearestFastThreat(state, ped) {
  // Returns { x, y } of the closest fast car / fast player, or null.
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars || []) {
    if (Math.abs(car.speed || 0) < FAST_SPEED) continue;
    const d = dist(ped.x, ped.y, car.x, car.y);
    if (d < FLEE_RADIUS_CAR && d < bestD) {
      best = { x: car.x, y: car.y };
      bestD = d;
    }
  }
  const player = state.player;
  if (player && player.inCar == null && Math.abs(player.speed || 0) >= FAST_SPEED) {
    const d = dist(ped.x, ped.y, player.x, player.y);
    if (d < FLEE_RADIUS_PLAYER && d < bestD) {
      best = { x: player.x, y: player.y };
      bestD = d;
    }
  }
  return best;
}

function fleeFrom(ped, threat) {
  ped.state = 'flee';
  ped._fleeTimer = FLEE_DURATION;
  ped.angle = Math.atan2(ped.y - threat.y, ped.x - threat.x);
  ped.speed = FLEE_SPEED;
}

// ---------------------------------------------------------------- update

function stepPed(state, ped, dt) {
  const rng = rngFn(state);

  // --- Down: lie still, then fade out and respawn elsewhere. -------
  if (ped.state === 'down') {
    ped.speed = 0;
    ped._downTimer = (ped._downTimer || 0) + dt;
    if (ped._downTimer >= DOWN_FADE_SECONDS) {
      const fresh = makePed(state);
      ped.x = fresh.x;
      ped.y = fresh.y;
      ped.angle = fresh.angle;
      ped.speed = fresh.speed;
      ped._walkSpeed = fresh.speed;
      ped.color = fresh.color;
      ped.state = 'walk';
      ped._downTimer = 0;
      ped._fleeTimer = 0;
      ped._wantedCounted = false;
      ped._turnTimer = 2 + rng.next() * 3;
    }
    return;
  }

  // --- Fleeing: run away from the threat for a few seconds. --------
  if (ped.state === 'flee') {
    ped._fleeTimer = (ped._fleeTimer || 0) - dt;
    ped.speed = FLEE_SPEED;
    if (ped._fleeTimer <= 0) {
      ped.state = 'walk';
      ped.speed = ped._walkSpeed || WALK_SPEED_MIN;
    }
  } else {
    // --- Walking: amble along, turning at random. ------------------
    ped._turnTimer = (ped._turnTimer || 0) - dt;
    if (ped._turnTimer <= 0) {
      ped._turnTimer = 2 + rng.next() * 4;
      const roll = rng.next();
      if (roll < 0.3) ped.angle += (rng.next() < 0.5 ? 1 : -1) * (Math.PI / 2);
      else if (roll < 0.4) ped.angle += Math.PI; // turn back
    }
    ped.speed = ped._walkSpeed || WALK_SPEED_MIN;

    // Check for something worth fleeing from.
    const shot = shotThreat(state, ped);
    if (shot) {
      fleeFrom(ped, shot);
    } else {
      const threat = nearestFastThreat(state, ped);
      if (threat) fleeFrom(ped, threat);
    }
  }

  // --- Move, turning away from buildings. ---------------------------
  const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
  const ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
  if (!collides(state, nx, ny, PED_RADIUS)) {
    ped.x = nx;
    ped.y = ny;
  } else if (!collides(state, nx, ped.y, PED_RADIUS)) {
    ped.x = nx;
  } else if (!collides(state, ped.x, ny, PED_RADIUS)) {
    ped.y = ny;
  } else {
    ped.angle += Math.PI / 2;
  }

  // Stay inside the city square (and out of the southern bay) when
  // one is known.
  const c = state.city;
  if (c && typeof c.size === 'number') {
    const maxY = c.water && typeof c.water.y === 'number' ? c.water.y - 16 : c.size - 16;
    if (ped.x < 16 || ped.x > c.size - 16 || ped.y < 16 || ped.y > maxY) {
      ped.x = clamp(ped.x, 16, c.size - 16);
      ped.y = clamp(ped.y, 16, maxY);
      ped.angle = Math.atan2(c.size / 2 - ped.y, c.size / 2 - ped.x);
    }
  }

  // --- Hit by a car? -------------------------------------------------
  if (ped.state !== 'down') {
    for (const car of state.cars || []) {
      if (Math.abs(car.speed || 0) < HIT_MIN_CAR_SPEED) continue;
      if (dist(ped.x, ped.y, car.x, car.y) >= HIT_DISTANCE) continue;
      ped.state = 'down';
      ped.speed = 0;
      ped._downTimer = 0;
      burst(state, ped.x, ped.y, { count: 10, color: '#ff4d4d' });
      if (!ped._wantedCounted) {
        ped._wantedCounted = true;
        if (typeof state.addWanted === 'function') state.addWanted(state, 1);
      }
      break;
    }
  }
}

export function updatePeds(state, dt) {
  const step = Math.min(Math.max(dt || 0, 0), 0.05);
  if (step <= 0) return;
  for (const ped of state.peds || []) {
    stepPed(state, ped, step);
  }
}
