// police.js — Solmar Bay (original work)
// Wanted level and police: heat, chase, ramming, busting, cooldown.
// No code copied from any kit, tutorial, or existing game.
//
// Interface assumptions (see task brief):
//  - main.js wires state.addWanted = addWanted (from this file), so
//    other modules call it via state.addWanted when present.
//  - Police cars are created here (kind 'police', driver 'police');
//    their movement is owned by vehicles.js updateVehicles, which
//    steers driver 'police' cars toward the player while wanted > 0.
//    This file owns spawning, despawning, ramming / bust damage, and
//    the siren — it does not move police cars itself, so the two
//    modules cannot fight over a car's angle.
//  - Spawning uses city.js cityRoadPoint via a namespace import,
//    with a city-bounds fallback when the helper is absent.
//    city.js headings are degrees (0 = east, 90 = south) and its
//    helpers take a random.js-style rng object ({ next, range, int,
//    pick }); both are converted / adapted at the boundary here.
//    The city object carries `size`, not width / height.
//  - state.audio.siren(true/false) is optional and guarded; note
//    audio.js update() also drives the siren from state.wanted, so
//    the calls here are idempotent with that driver.
//  - state.lastShotAt is not used here; wanted decay is driven by
//    wantedTimer, which addWanted resets on every crime.
//  - "Busted" is expressed as player.alive = false with health 0,
//    the same game-over signal the shared state shape implies;
//    main.js decides what screen that produces.

import * as city from './city.js';

// ---------------------------------------------------------------- constants

const MAX_WANTED = 5;
const MAX_POLICE_CARS = 4;
// Seconds of no new crime, with the player far from any police car,
// before heat drops by one star.
const WANTED_DECAY_SECONDS = 25;
const POLICE_FAR_DISTANCE = 420;
const POLICE_DESPAWN_DISTANCE = 500;
const POLICE_SPAWN_MIN_DIST = 200;
const POLICE_SPAWN_MAX_DIST = 520;
const POLICE_SPAWN_INTERVAL = 1.5;
const RAM_DISTANCE_CAR = 38;
const RAM_DISTANCE_FOOT = 30;
const RAM_COOLDOWN = 0.8;
const RAM_DAMAGE_CAR = 8;
const RAM_DAMAGE_FOOT = 12;

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

function nextCarId(state) {
  state._nextCarId = (state._nextCarId || 0) + 1;
  return state._nextCarId;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
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
  const size = citySize(state);
  return { x: 40 + rng.next() * (size - 80), y: 40 + rng.next() * (size - 80), angle: rng.next() * Math.PI * 2 };
}

function setSiren(state, on) {
  const a = state.audio;
  if (a && typeof a.siren === 'function') {
    try { a.siren(on); } catch { /* audio is best-effort */ }
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

function policeCars(state) {
  return (state.cars || []).filter((c) => c.driver === 'police');
}

function wantedPoliceCount(wanted) {
  // 1 star = 1 car, 2 = 2, 3 = 3, 4 = 4, 5 = 4 (capped).
  if (wanted <= 0) return 0;
  return Math.min(wanted, MAX_POLICE_CARS);
}

// ---------------------------------------------------------------- wanted level

export function addWanted(state, n) {
  state.wanted = Math.min(MAX_WANTED, Math.max(0, (state.wanted || 0) + (n || 0)));
  // Any new crime restarts the decay clock.
  state.wantedTimer = 0;
  return state.wanted;
}

export function clearWanted(state) {
  state.wanted = 0;
  state.wantedTimer = 0;
  if (Array.isArray(state.cars)) {
    state.cars = state.cars.filter((c) => c.driver !== 'police');
  }
  setSiren(state, false);
}

// ---------------------------------------------------------------- spawning

function spawnPoliceCar(state) {
  const player = state.player;
  if (!player) return null;
  const rng = rngFn(state);

  // Try to place the car on a road near the player: close enough to
  // join the chase quickly, far enough not to appear on top of them.
  let spot = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const p = roadPoint(state);
    const d = dist(p.x, p.y, player.x, player.y);
    if (d >= POLICE_SPAWN_MIN_DIST && d <= POLICE_SPAWN_MAX_DIST) {
      spot = p;
      break;
    }
    spot = p; // keep the last candidate as a fallback
  }
  if (!spot) return null;

  const car = {
    id: nextCarId(state),
    x: spot.x,
    y: spot.y,
    angle: typeof spot.angle === 'number'
      ? spot.angle
      : Math.atan2(player.y - spot.y, player.x - spot.x),
    speed: 120,
    // Black-and-white cruiser; the light bar is a separate flag so
    // the renderer can draw it without parsing the color.
    color: '#20242a',
    trimColor: '#f8f8f8',
    lightBar: true,
    kind: 'police',
    driver: 'police',
    health: 100,
    _cruise: 215,
    _turnTimer: 2 + rng.next() * 2,
    _pauseTimer: 0,
    _hitCooldown: 0,
    _ramCooldown: 0,
  };
  state.cars.push(car);
  return car;
}

// ---------------------------------------------------------------- update

export function updatePolice(state, dt) {
  const step = Math.min(Math.max(dt || 0, 0), 0.05);
  if (step <= 0) return;
  if (!Array.isArray(state.cars)) state.cars = [];
  const player = state.player;
  const wanted = state.wanted || 0;

  // --- Wanted decay -------------------------------------------------
  // wantedTimer counts seconds since the last crime (addWanted resets
  // it to 0). Only decay when the clock has run long enough AND the
  // player is far from every police car (or there are none left).
  if (wanted > 0) {
    state.wantedTimer = (state.wantedTimer || 0) + step;
    const cops = policeCars(state);
    const nearestCop = player && cops.length
      ? Math.min(...cops.map((c) => dist(c.x, c.y, player.x, player.y)))
      : Infinity;
    if (state.wantedTimer >= WANTED_DECAY_SECONDS && nearestCop > POLICE_FAR_DISTANCE) {
      state.wanted = wanted - 1;
      state.wantedTimer = 0;
    }
  } else {
    state.wantedTimer = 0;
  }

  // --- Spawning -----------------------------------------------------
  const desired = wantedPoliceCount(state.wanted || 0);
  const cops = policeCars(state);
  state._policeSpawnTimer = Math.max(0, (state._policeSpawnTimer || 0) - step);
  if (cops.length < desired && state._policeSpawnTimer <= 0 && player) {
    spawnPoliceCar(state);
    state._policeSpawnTimer = POLICE_SPAWN_INTERVAL;
  }

  // --- Despawn when the heat is gone --------------------------------
  // Only cars far from the player are removed, per the brief: a
  // cruiser right next to the player does not vanish mid-chase.
  if ((state.wanted || 0) <= 0 && player) {
    state.cars = state.cars.filter((c) => {
      if (c.driver !== 'police') return true;
      return dist(c.x, c.y, player.x, player.y) <= POLICE_DESPAWN_DISTANCE;
    });
  }

  // --- Chase contact: ram / bust ------------------------------------
  if (player && player.alive !== false) {
    const inCar = player.inCar != null
      ? (state.cars || []).find((c) => c.id === player.inCar)
      : null;
    for (const cop of policeCars(state)) {
      cop._ramCooldown = Math.max(0, (cop._ramCooldown || 0) - step);
      if (cop._ramCooldown > 0) continue;

      if (inCar) {
        const d = dist(cop.x, cop.y, inCar.x, inCar.y);
        if (d < RAM_DISTANCE_CAR) {
          cop._ramCooldown = RAM_COOLDOWN;
          // Ram: damage the player's car and shove it away from the
          // cruiser, plus a jolt to its speed.
          inCar.health = Math.max(0, (inCar.health ?? 100) - RAM_DAMAGE_CAR);
          const pushAngle = Math.atan2(inCar.y - cop.y, inCar.x - cop.x);
          const push = 90;
          inCar.x += Math.cos(pushAngle) * push * step * 4;
          inCar.y += Math.sin(pushAngle) * push * step * 4;
          inCar.speed = (inCar.speed || 0) * 0.7;
          cop.speed = (cop.speed || 0) * 0.6;
          playSound(state, 'hit', 'explosion');
        }
      } else {
        const d = dist(cop.x, cop.y, player.x, player.y);
        if (d < RAM_DISTANCE_FOOT) {
          cop._ramCooldown = RAM_COOLDOWN;
          // On foot, a cruiser pulling alongside hurts the player and
          // knocks them back. At 0 health the player is busted.
          player.health = Math.max(0, (player.health ?? 100) - RAM_DAMAGE_FOOT);
          const pushAngle = Math.atan2(player.y - cop.y, player.x - cop.x);
          player.x += Math.cos(pushAngle) * 36;
          player.y += Math.sin(pushAngle) * 36;
          playSound(state, 'hit', 'explosion');
          if (player.health <= 0) {
            player.alive = false;
            state.dialogue = {
              speaker: 'Solmar Police',
              text: 'Busted!',
              until: (state.time || 0) + 3,
            };
          }
        }
      }
    }
  }

  // --- Siren --------------------------------------------------------
  const anyCops = policeCars(state).length > 0;
  setSiren(state, (state.wanted || 0) > 0 && anyCops);
}
