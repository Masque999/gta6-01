// player.js — Solmar Bay: Leo Marsh on foot.
// Original code written for this project. No dependencies, no imports.
//
// updatePlayer(state, dt) moves Leo when he is on foot, lets him step
// into / out of cars with E, throw a punch with F, and slowly recover
// health when he has not been hurt recently.
//
// Interface assumptions (matching the sibling modules in this folder):
//  - state.input.axes() returns a normalised { x, y } movement vector
//    (y = -1 is up, as in input.js). A driving-style { steer, throttle }
//    shape is also accepted, mapping throttle to -y.
//  - E / F arrive as live keys in state.input.keys (a Set of
//    KeyboardEvent.code values, 'KeyE' / 'KeyF'), and/or as a bitmask
//    in state.actions using input.ENTER / input.MELEE. This module
//    never calls input.takeActions() itself, so it cannot consume
//    actions other modules still need; it edge-detects on its own.
//  - state.enterCar / state.exitCar are the vehicles module's
//    functions wired onto state by main.js (both take state). They are
//    called when present; a local nearest-car check is the fallback.
//  - Buildings are tested with state.city.cityCollides when the city
//    object carries it, otherwise against state.city.buildings
//    rectangles directly. City bounds come from state.city.size
//    (3200) or width / height.
//  - state.audio methods are named sounds (audio.js): 'hit' for a
//    punch landing, 'click' for a car door, 'pickup' for cash.
//    Every call is guarded.
//  - state.addWanted(state, n) is the police module's function
//    (same (state, n) shape vehicles.js uses).
//  - Damage stamps player.lastDamagedAt with state.time; combat.js
//    and police.js write the same stamp, which drives regen here.

// ---------------------------------------------------------------- constants

const WALK_SPEED = 220; // px per second, on foot
const PLAYER_RADIUS = 14;
const MELEE_RANGE = 40; // px, in front of the player
const MELEE_DAMAGE = 25;
const MELEE_COOLDOWN = 0.35; // seconds between punches
const MELEE_KNOCKBACK = 18; // px shoved away from Leo
const REGEN_DELAY = 5; // seconds after last damage before healing
const REGEN_RATE = 4; // health per second while recovering
const ENTER_RANGE_FALLBACK = 70; // px, local nearest-car check

// ---------------------------------------------------------------- helpers

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function rngFn(state) {
  if (typeof state.rng === 'function') return state.rng;
  return Math.random;
}

// True when a circle at (x, y) with radius r overlaps a building.
function collides(state, x, y, r) {
  const city = state.city;
  if (!city) return false;
  if (typeof city.cityCollides === 'function') {
    try {
      return !!city.cityCollides(city, x, y, r);
    } catch {
      return false;
    }
  }
  const buildings = city.buildings;
  if (Array.isArray(buildings)) {
    for (const b of buildings) {
      const closestX = Math.max(b.x, Math.min(x, b.x + b.w));
      const closestY = Math.max(b.y, Math.min(y, b.y + b.h));
      const dx = x - closestX;
      const dy = y - closestY;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

function cityBounds(state) {
  const city = state.city || {};
  const size = city.size || city.width || 3200;
  const w = city.width || size;
  const h = city.height || size;
  return { w, h };
}

function playSound(state, ...names) {
  const a = state.audio;
  if (!a) return;
  for (const name of names) {
    if (typeof a[name] === 'function') {
      try {
        a[name]();
      } catch {
        /* audio is best-effort */
      }
      return;
    }
  }
  if (typeof a.play === 'function') {
    try {
      a.play(names[0]);
    } catch {
      /* audio is best-effort */
    }
  }
}

// Small particle burst. Prefers the effects module when main.js wired
// it (state.effects.addParticles / state.addParticles), else pushes
// directly into state.particles.
function burst(state, x, y, opts = {}) {
  const count = opts.count || 8;
  const colors = opts.colors || (opts.color ? [opts.color] : ['#ffd166']);
  if (state.effects && typeof state.effects.addParticles === 'function') {
    try {
      state.effects.addParticles(state, x, y, opts);
      return;
    } catch {
      /* fall through to the direct push */
    }
  }
  if (typeof state.addParticles === 'function') {
    try {
      state.addParticles(state, x, y, opts);
      return;
    } catch {
      /* fall through to the direct push */
    }
  }
  if (!Array.isArray(state.particles)) return;
  const rng = rngFn(state);
  const speed = opts.speed || 120;
  const life = opts.life || 0.5;
  const size = opts.size || 3;
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const s = speed * (0.4 + rng() * 0.8);
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life,
      maxLife: life,
      color: colors[Math.floor(rng() * colors.length)],
      size: size * (0.7 + rng() * 0.6),
    });
  }
}

function addWanted(state, n) {
  if (typeof state.addWanted === 'function') {
    try {
      state.addWanted(state, n);
      return;
    } catch {
      /* fall through to the direct set */
    }
  }
  state.wanted = clamp((state.wanted || 0) + n, 0, 5);
  state.wantedTimer = 0;
}

// Edge-triggered action check. Returns true only on the frame the
// action first goes down, so holding E or F does not re-trigger.
// Sources, in order: a bitmask in state.actions (from
// input.takeActions()), the live input.keys set, and any pressed-style
// helper the input object offers. Previous state lives on the player
// object under _edgePrev so a reload cannot double-fire.
function actionEdge(state, key, codes, names) {
  const input = state.input;
  const player = state.player;
  if (!player) return false;
  player._edgePrev = player._edgePrev || {};
  let raw = false;

  const mask =
    typeof state.actions === 'number'
      ? state.actions
      : typeof state.actionMask === 'number'
        ? state.actionMask
        : null;
  if (mask !== null && input) {
    const bit =
      key === 'ENTER' ? (input.ENTER ?? 4) : key === 'MELEE' ? (input.MELEE ?? 8) : 0;
    if (bit && mask & bit) raw = true;
  }

  if (!raw && input && input.keys) {
    try {
      for (const code of codes) {
        if (typeof input.keys.has === 'function' && input.keys.has(code)) {
          raw = true;
          break;
        }
        if (Array.isArray(input.keys) && input.keys.includes(code)) {
          raw = true;
          break;
        }
      }
    } catch {
      /* key set unreadable; try the next source */
    }
  }

  if (!raw && input) {
    for (const fn of ['pressed', 'justPressed', 'wasPressed', 'actionPressed']) {
      if (typeof input[fn] !== 'function') continue;
      for (const name of names) {
        try {
          if (input[fn](name)) {
            raw = true;
            break;
          }
        } catch {
          /* ignore a helper that rejects the name */
        }
      }
      if (raw) break;
    }
  }

  const was = !!player._edgePrev[key];
  player._edgePrev[key] = raw;
  return raw && !was;
}

// Movement axes: { x, y } normalised, y = -1 up. A driving-style
// { steer, throttle } object maps throttle (+1 = forward) to -y.
function readAxes(state) {
  const input = state.input;
  if (!input || typeof input.axes !== 'function') return { x: 0, y: 0 };
  let a = {};
  try {
    a = input.axes() || {};
  } catch {
    return { x: 0, y: 0 };
  }
  const x = a.x ?? a.steer ?? 0;
  const y = a.y ?? (a.throttle != null ? -a.throttle : 0);
  const len = Math.hypot(x, y);
  if (len > 1) return { x: x / len, y: y / len };
  return { x, y };
}

// ---------------------------------------------------------------- enter / exit

function nearestCar(state, x, y, maxDist) {
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

// Local fallback when state.enterCar is absent (or found nothing):
// step into the nearest car, counting a traffic car as stolen.
function enterCarLocal(state) {
  const player = state.player;
  const car = nearestCar(state, player.x, player.y, ENTER_RANGE_FALLBACK);
  if (!car) return null;
  const stolen =
    car.driver === 'traffic' || (car.driver === 'parked' && !!car.owner);
  car.driver = 'player';
  player.inCar = car.id;
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speed = car.speed || 0;
  if (stolen) {
    if (state.stats) state.stats.stolen = (state.stats.stolen || 0) + 1;
    addWanted(state, 1);
  }
  playSound(state, 'click');
  return car;
}

function exitCarLocal(state) {
  const player = state.player;
  const car = (state.cars || []).find((c) => c.id === player.inCar) || null;
  player.inCar = null;
  player.speed = 0;
  if (!car) return true;
  car.driver = 'parked';
  car.speed = 0;
  // Step out to the side of the car; try both sides, then behind,
  // so Leo never ends up inside a building.
  const side = Math.PI / 2;
  const spots = [
    { x: car.x + Math.cos(car.angle + side) * 28, y: car.y + Math.sin(car.angle + side) * 28 },
    { x: car.x + Math.cos(car.angle - side) * 28, y: car.y + Math.sin(car.angle - side) * 28 },
    { x: car.x - Math.cos(car.angle) * 30, y: car.y - Math.sin(car.angle) * 30 },
  ];
  let spot = spots[2];
  for (const s of spots) {
    if (!collides(state, s.x, s.y, PLAYER_RADIUS)) {
      spot = s;
      break;
    }
  }
  player.x = spot.x;
  player.y = spot.y;
  player.angle = car.angle;
  playSound(state, 'click');
  return true;
}

function tryEnterCar(state) {
  if (typeof state.enterCar === 'function') {
    try {
      state.enterCar(state);
    } catch {
      try {
        state.enterCar();
      } catch {
        /* fall through to the local check */
      }
    }
  }
  if (state.player.inCar == null) enterCarLocal(state);
}

function tryExitCar(state) {
  if (typeof state.exitCar === 'function') {
    try {
      state.exitCar(state);
    } catch {
      try {
        state.exitCar();
      } catch {
        /* fall through to the local check */
      }
    }
  }
  if (state.player.inCar != null) exitCarLocal(state);
}

// ---------------------------------------------------------------- melee

function knockback(state, target, fromX, fromY) {
  const dx = target.x - fromX;
  const dy = target.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  const nx = target.x + (dx / d) * MELEE_KNOCKBACK;
  const ny = target.y + (dy / d) * MELEE_KNOCKBACK;
  // Do not shove the target through a wall.
  if (!collides(state, nx, ny, PLAYER_RADIUS)) {
    target.x = nx;
    target.y = ny;
  } else if (!collides(state, target.x + (dx / d) * 8, target.y + (dy / d) * 8, PLAYER_RADIUS)) {
    target.x += (dx / d) * 8;
    target.y += (dy / d) * 8;
  }
}

function punch(state) {
  const player = state.player;
  const fx = Math.cos(player.angle);
  const fy = Math.sin(player.angle);
  let best = null;
  let bestKind = null;
  let bestD = MELEE_RANGE;
  let bestIndex = -1;

  // Nearest enemy or pedestrian within range and in front of Leo.
  for (let i = 0; i < (state.enemies || []).length; i++) {
    const e = state.enemies[i];
    const d = dist(player.x, player.y, e.x, e.y);
    if (d > bestD) continue;
    const dot = ((e.x - player.x) * fx + (e.y - player.y) * fy) / (d || 1);
    if (dot < 0) continue; // behind Leo
    best = e;
    bestKind = 'enemy';
    bestD = d;
    bestIndex = i;
  }
  for (let i = 0; i < (state.peds || []).length; i++) {
    const p = state.peds[i];
    const d = dist(player.x, player.y, p.x, p.y);
    if (d > bestD) continue;
    const dot = ((p.x - player.x) * fx + (p.y - player.y) * fy) / (d || 1);
    if (dot < 0) continue;
    best = p;
    bestKind = 'ped';
    bestD = d;
    bestIndex = i;
  }

  // Swing in the air: a short puff at the fist, no damage.
  const fistX = player.x + fx * 22;
  const fistY = player.y + fy * 22;
  if (!best) {
    burst(state, fistX, fistY, { count: 3, color: '#e8e8e8', speed: 50, life: 0.2, size: 2 });
    return;
  }

  best.health = (best.health ?? 50) - MELEE_DAMAGE;
  knockback(state, best, player.x, player.y);
  burst(state, best.x, best.y, {
    count: 8,
    colors: ['#ffd166', '#ffffff'],
    speed: 140,
    life: 0.35,
    size: 3,
  });
  playSound(state, 'hit');

  if (best.health > 0) return;
  if (bestKind === 'enemy') {
    state.enemies.splice(bestIndex, 1);
    if (state.stats) state.stats.kills = (state.stats.kills || 0) + 1;
    player.money = (player.money || 0) + 20;
    burst(state, best.x, best.y, {
      count: 12,
      colors: ['#ffd94a', '#ffb347'],
      speed: 160,
      life: 0.6,
      size: 3,
    });
    playSound(state, 'pickup');
  } else {
    state.peds.splice(bestIndex, 1);
    // Knocking out a bystander is a crime, same as shooting one.
    addWanted(state, 1);
  }
}

// ---------------------------------------------------------------- update

export function updatePlayer(state, dt) {
  const step = clamp(dt || 0, 0, 0.05);
  const player = state.player;
  if (!player || step <= 0) return;

  player._meleeTimer = Math.max(0, (player._meleeTimer ?? 0) - step);
  player._shootTimer = Math.max(0, (player._shootTimer ?? 0) - step);

  // --- E: enter / exit a car (works on foot and behind the wheel) ---
  if (actionEdge(state, 'ENTER', ['KeyE'], ['ENTER', 'ENTER_CAR', 'enter', 'interact'])) {
    if (player.inCar != null) tryExitCar(state);
    else if (player.alive !== false) tryEnterCar(state);
  }

  // --- Health: slow recovery when not recently damaged ---------------
  const lastHurt = player.lastDamagedAt ?? player._lastDamageAt ?? -Infinity;
  if (
    player.alive !== false &&
    player.health > 0 &&
    player.health < (player.maxHealth ?? 100) &&
    (state.time || 0) - lastHurt > REGEN_DELAY
  ) {
    player.health = Math.min(
      player.maxHealth ?? 100,
      player.health + REGEN_RATE * step,
    );
  }

  // --- Death ---------------------------------------------------------
  if (player.health <= 0) {
    player.health = 0;
    player.alive = false;
    return;
  }

  // Behind the wheel the vehicles module drives; Leo just rides along.
  if (player.inCar != null) return;

  // --- F: punch ------------------------------------------------------
  if (
    player.alive !== false &&
    player._meleeTimer <= 0 &&
    actionEdge(state, 'MELEE', ['KeyF'], ['MELEE', 'melee', 'attack'])
  ) {
    player._meleeTimer = MELEE_COOLDOWN;
    punch(state);
  }

  // --- On-foot movement ----------------------------------------------
  const axes = readAxes(state);
  const moving = axes.x !== 0 || axes.y !== 0;
  if (moving) {
    player.angle = Math.atan2(axes.y, axes.x);
    const nx = player.x + axes.x * WALK_SPEED * step;
    const ny = player.y + axes.y * WALK_SPEED * step;
    // Axis-separated movement: slide along a wall instead of sticking.
    if (!collides(state, nx, player.y, PLAYER_RADIUS)) player.x = nx;
    if (!collides(state, player.x, ny, PLAYER_RADIUS)) player.y = ny;
    player.speed = WALK_SPEED;
  } else {
    player.speed = 0;
  }

  // --- Stay inside the city ------------------------------------------
  const { w, h } = cityBounds(state);
  player.x = clamp(player.x, PLAYER_RADIUS, w - PLAYER_RADIUS);
  player.y = clamp(player.y, PLAYER_RADIUS, h - PLAYER_RADIUS);
}
