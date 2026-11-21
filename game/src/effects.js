// effects.js — Solmar Bay: particles, explosions, and skid marks.
// Original code written for this project. No dependencies, no imports.
//
// Particles are plain objects { x, y, vx, vy, life, maxLife, color,
// size } pushed into state.particles. updateEffects moves them, ages
// them, and drops the dead ones; it also throws up skid smoke when
// Leo's car is turning hard at speed.
//
// Interface assumptions (matching the sibling modules in this folder):
//  - state.audio methods are named sounds (audio.js); explode() plays
//    'explosion'. Every call is guarded.
//  - The player's car is found by player.inCar (a car id) in
//    state.cars. The previous steering angle is kept on the car as
//    _prevAngle and the skid throttle as _skidAccum, both underscore
//    fields so the shared car shape stays intact.

const DEFAULT_COUNT = 10;
const DEFAULT_COLORS = ['#ffb347'];
const DEFAULT_SPEED = 120;
const DEFAULT_LIFE = 0.6;
const DEFAULT_SIZE = 3;

// ---------------------------------------------------------------- helpers

function rngFn(state) {
  if (typeof state.rng === 'function') return state.rng;
  return Math.random;
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

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------- exports

export function addParticles(state, x, y, opts = {}) {
  if (!Array.isArray(state.particles)) state.particles = [];
  const rng = rngFn(state);
  const count = opts.count ?? DEFAULT_COUNT;
  let colors = DEFAULT_COLORS;
  if (Array.isArray(opts.colors) && opts.colors.length) colors = opts.colors;
  else if (typeof opts.color === 'string') colors = [opts.color];
  const speed = opts.speed ?? DEFAULT_SPEED;
  const life = opts.life ?? DEFAULT_LIFE;
  const size = opts.size ?? DEFAULT_SIZE;
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
  return state.particles;
}

export function explode(state, x, y) {
  // Fireball: orange / yellow / red burst, plus a fast-expanding
  // shockwave ring (a particle with a large size and a short life).
  addParticles(state, x, y, {
    count: 26,
    colors: ['#ff7b00', '#ffb347', '#ffd94a', '#e0483e'],
    speed: 280,
    life: 0.7,
    size: 5,
  });
  if (Array.isArray(state.particles)) {
    state.particles.push({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.35,
      maxLife: 0.35,
      color: '#ffe9a8',
      size: 70,
      ring: true,
    });
  }
  playSound(state, 'explosion');
}

export function updateEffects(state, dt) {
  const step = clamp(dt || 0, 0, 0.05);
  if (step <= 0) return;

  // --- Skid smoke: hard turn at speed in the player's car ------------
  const player = state.player;
  if (player && player.inCar != null) {
    const car = (state.cars || []).find((c) => c.id === player.inCar) || null;
    if (car && typeof car.angle === 'number') {
      const prevAngle = car._prevAngle ?? car.angle;
      const turnRate = angleDiff(car.angle, prevAngle) / step;
      car._prevAngle = car.angle;
      const speed = Math.abs(car.speed || 0);
      if (speed > 200 && Math.abs(turnRate) > 1.0) {
        car._skidAccum = (car._skidAccum ?? 0) + step;
        while (car._skidAccum >= 0.06) {
          car._skidAccum -= 0.06;
          // Rear of the car, either side, so the smoke trails
          // from the back wheels as the car slides.
          const rng = rngFn(state);
          const side = rng() < 0.5 ? 1 : -1;
          const rearX = car.x - Math.cos(car.angle) * 20;
          const rearY = car.y - Math.sin(car.angle) * 20;
          const px = rearX + Math.cos(car.angle + Math.PI / 2) * side * 10;
          const py = rearY + Math.sin(car.angle + Math.PI / 2) * side * 10;
          addParticles(state, px, py, {
            count: 1,
            colors: ['#8a8a8a', '#6f6f6f'],
            speed: 25,
            life: 0.5,
            size: 4,
          });
        }
      } else {
        car._skidAccum = 0;
      }
    }
  }

  // --- Move, age, and drop dead particles ---------------------------
  const particles = state.particles || [];
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += (p.vx || 0) * step;
    p.y += (p.vy || 0) * step;
    // Drag: sparks slow down; the ring does not move.
    const drag = p.ring ? 1 : Math.max(0, 1 - 2 * step);
    p.vx = (p.vx || 0) * drag;
    p.vy = (p.vy || 0) * drag;
    if (p.ring) p.size = (p.size || 0) + 260 * step;
    p.life -= step;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
