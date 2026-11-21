// combat.js — Solmar Bay: shooting, gang fights, and bullet hits.
// Original code written for this project. No dependencies, no imports.
//
// updateCombat(state, dt) fires the player's pistol on a mouse click,
// moves bullets and resolves their hits, and runs gang enemies: they
// chase Leo and shoot back when close enough. Killing a gang member
// pays a small cash drop straight into Leo's pocket.
//
// Interface assumptions (matching the sibling modules in this folder):
//  - state.input.mouse is { x, y, down, clicked } in canvas (screen)
//    pixels, as in input.js. The aim point is converted to world
//    coordinates with state.camera { x, y, zoom } and state.screen
//    { w, h } (or width / height); a mouse.worldX / worldY pair, if
//    main.js ever supplies one, is used as-is. A rising edge of
//    mouse.down also counts as a click, because input.takeActions()
//    consumes mouse.clicked when main.js reads the action mask.
//  - Bullets are { x, y, vx, vy, life, from, damage }; from is
//    'player' or 'enemy'. The player fires while weapon is 'pistol'.
//  - Enemies are { x, y, angle, health, state } with state 'chase'.
//    Per-enemy timers live in underscore fields (_shootTimer,
//    _meleeTimer) so the shared shape stays intact.
//  - Peds are { x, y, angle, speed, color, state }; a ped hit by a
//    bullet gets a health field (default 50) if it had none.
//  - Buildings are tested the same way as in player.js: a
//    state.city.cityCollides function when present, otherwise the
//    state.city.buildings rectangles.
//  - state.audio methods are named sounds (audio.js): 'shoot',
//    'hit', 'pickup', 'explosion', 'click'. Every call is guarded.
//  - state.addWanted(state, n) is the police module's function
//    (same (state, n) shape vehicles.js uses); killing a pedestrian
//    raises the heat by one.
//  - Player damage stamps player.lastDamagedAt with state.time, which
//    is what player.js uses to delay health regen.

// ---------------------------------------------------------------- constants

const BULLET_SPEED = 720; // px per second, player's pistol
const BULLET_LIFE = 0.9; // seconds before a bullet fades
const BULLET_DAMAGE = 20; // one pistol round
const ENEMY_BULLET_SPEED = 460;
const ENEMY_BULLET_LIFE = 1.2;
const ENEMY_BULLET_DAMAGE = 8;
const ENEMY_SPEED = 150; // px per second, chasing Leo
const ENEMY_SHOOT_RANGE = 380; // px
const ENEMY_SHOOT_COOLDOWN = 1.1; // seconds between enemy shots
const ENEMY_MELEE_RANGE = 30; // px, close-quarters shove
const ENEMY_MELEE_DAMAGE = 6;
const ENEMY_MELEE_COOLDOWN = 0.8;
const ENEMY_RADIUS = 14;
const PED_RADIUS = 12;
const PED_MAX_HEALTH = 50;
const CAR_HIT_RADIUS = 30;
const PLAYER_HIT_RADIUS = 14;
const SHOOT_COOLDOWN = 0.18; // seconds between player shots
const ENEMY_CASH_DROP = 20; // dollars paid for a defeated gang member

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

function hurtPlayer(state, damage, fromX, fromY) {
  const player = state.player;
  if (!player || player.alive === false) return;
  player.health = Math.max(0, (player.health ?? 100) - damage);
  player.lastDamagedAt = state.time || 0;
  player._lastDamageAt = state.time || 0;
  // Shove Leo a step away from whatever hit him.
  const dx = player.x - fromX;
  const dy = player.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  const nx = player.x + (dx / d) * 10;
  const ny = player.y + (dy / d) * 10;
  if (!collides(state, nx, ny, PLAYER_HIT_RADIUS)) {
    player.x = nx;
    player.y = ny;
  }
  if (player.health <= 0) player.alive = false;
}

// Mouse position in world coordinates. Prefers a pre-converted
// worldX / worldY pair; otherwise converts canvas pixels through the
// camera (camera.x / camera.y is the centre of the view).
function mouseWorld(state) {
  const mouse = state.input && state.input.mouse;
  const player = state.player || { x: 0, y: 0 };
  if (!mouse) return { x: player.x, y: player.y };
  if (typeof mouse.worldX === 'number' && typeof mouse.worldY === 'number') {
    return { x: mouse.worldX, y: mouse.worldY };
  }
  if (typeof mouse.x !== 'number' || typeof mouse.y !== 'number') {
    return { x: player.x, y: player.y };
  }
  const cam = state.camera;
  if (!cam || typeof cam.x !== 'number' || typeof cam.y !== 'number') {
    return { x: mouse.x, y: mouse.y };
  }
  const screen = state.screen || state.viewport || state.canvas || {};
  const sw = screen.w ?? screen.width ?? 800;
  const sh = screen.h ?? screen.height ?? 600;
  const zoom = cam.zoom || 1;
  return {
    x: cam.x + (mouse.x - sw / 2) / zoom,
    y: cam.y + (mouse.y - sh / 2) / zoom,
  };
}

// ---------------------------------------------------------------- spawning

export function spawnEnemies(state, x, y, n) {
  if (!Array.isArray(state.enemies)) state.enemies = [];
  const rng = rngFn(state);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = 40 + rng() * 60;
    state.enemies.push({
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r,
      angle: rng() * Math.PI * 2,
      health: 50,
      weapon: 'pistol',
      state: 'chase',
      speed: ENEMY_SPEED,
      _shootTimer: 0.5 + rng() * 1.0,
      _meleeTimer: 0,
    });
  }
  return state.enemies;
}

export function giveWeapon(state, weapon, ammo) {
  const player = state.player;
  if (!player) return;
  player.weapon = weapon;
  if (weapon === 'fists') {
    player.ammo = 0;
  } else {
    player.ammo = ammo ?? (weapon === 'pistol' ? 24 : 0);
  }
}

// ---------------------------------------------------------------- shooting

function firePlayerBullet(state) {
  const player = state.player;
  const aim = mouseWorld(state);
  const angle = Math.atan2(aim.y - player.y, aim.x - player.x);
  if (!Array.isArray(state.bullets)) state.bullets = [];
  state.bullets.push({
    x: player.x + Math.cos(angle) * 18,
    y: player.y + Math.sin(angle) * 18,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    life: BULLET_LIFE,
    from: 'player',
    damage: BULLET_DAMAGE,
  });
  player.ammo -= 1;
  // Muzzle flash: a few bright sparks at the gun.
  burst(state, player.x + Math.cos(angle) * 20, player.y + Math.sin(angle) * 20, {
    count: 5,
    colors: ['#ffd94a', '#ffffff'],
    speed: 130,
    life: 0.22,
    size: 3,
  });
  playSound(state, 'shoot');
  state.lastShotAt = { x: aim.x, y: aim.y, time: state.time || 0 };
}

// ---------------------------------------------------------------- bullets

function destroyCar(state, car, index) {
  state.cars.splice(index, 1);
  burst(state, car.x, car.y, {
    count: 26,
    colors: ['#ff7b00', '#ffb347', '#ffd94a', '#e0483e'],
    speed: 260,
    life: 0.7,
    size: 5,
  });
  playSound(state, 'explosion');
  // Leo was driving it: he is thrown clear, hurt, and on foot again.
  const player = state.player;
  if (player && player.inCar === car.id) {
    player.inCar = null;
    player.speed = 0;
    hurtPlayer(state, 15, car.x, car.y);
  }
}

function updateBullets(state, dt) {
  const player = state.player;
  const bullets = state.bullets || [];
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.x += (b.vx || 0) * dt;
    b.y += (b.vy || 0) * dt;
    let dead = b.life <= 0;

    if (!dead && collides(state, b.x, b.y, 2)) {
      // Smacked a building: sparks, no damage.
      burst(state, b.x, b.y, { count: 5, color: '#e0e0e0', speed: 110, life: 0.3, size: 2 });
      dead = true;
    }

    if (!dead && b.from === 'player') {
      // --- vs gang enemies ---
      for (let j = (state.enemies || []).length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (dist(b.x, b.y, e.x, e.y) > ENEMY_RADIUS + 4) continue;
        e.health -= b.damage ?? BULLET_DAMAGE;
        e.x += (b.vx || 0) * 0.004;
        e.y += (b.vy || 0) * 0.004;
        burst(state, e.x, e.y, { count: 7, color: '#e0483e', speed: 130, life: 0.35, size: 3 });
        playSound(state, 'hit');
        if (e.health <= 0) {
          state.enemies.splice(j, 1);
          if (state.stats) state.stats.kills = (state.stats.kills || 0) + 1;
          if (player) {
            player.money = (player.money || 0) + ENEMY_CASH_DROP;
            burst(state, e.x, e.y, {
              count: 12,
              colors: ['#ffd94a', '#ffb347'],
              speed: 170,
              life: 0.6,
              size: 3,
            });
            playSound(state, 'pickup');
          }
        }
        dead = true;
        break;
      }
      // --- vs pedestrians ---
      if (!dead) {
        for (let j = (state.peds || []).length - 1; j >= 0; j--) {
          const p = state.peds[j];
          if (dist(b.x, b.y, p.x, p.y) > PED_RADIUS + 4) continue;
          p.health = (p.health ?? PED_MAX_HEALTH) - (b.damage ?? BULLET_DAMAGE);
          burst(state, p.x, p.y, { count: 7, color: '#e0483e', speed: 130, life: 0.35, size: 3 });
          playSound(state, 'hit');
          if (p.health <= 0) {
            state.peds.splice(j, 1);
            addWanted(state, 1);
          }
          dead = true;
          break;
        }
      }
      // --- vs cars ---
      if (!dead) {
        for (let j = (state.cars || []).length - 1; j >= 0; j--) {
          const c = state.cars[j];
          if (dist(b.x, b.y, c.x, c.y) > CAR_HIT_RADIUS) continue;
          c.health = (c.health ?? 100) - (b.damage ?? BULLET_DAMAGE);
          burst(state, b.x, b.y, { count: 6, color: '#ffd166', speed: 140, life: 0.3, size: 2 });
          playSound(state, 'hit');
          if (c.health <= 0) destroyCar(state, c, j);
          dead = true;
          break;
        }
      }
    }

    if (!dead && b.from === 'enemy' && player && player.alive !== false) {
      if (player.inCar != null) {
        // Leo is driving: gang bullets hit his car, not him.
        const car = (state.cars || []).find((c) => c.id === player.inCar);
        if (car && dist(b.x, b.y, car.x, car.y) <= CAR_HIT_RADIUS) {
          car.health = (car.health ?? 100) - (b.damage ?? ENEMY_BULLET_DAMAGE);
          burst(state, b.x, b.y, { count: 6, color: '#ffd166', speed: 140, life: 0.3, size: 2 });
          playSound(state, 'hit');
          if (car.health <= 0) {
            const index = state.cars.indexOf(car);
            if (index >= 0) destroyCar(state, car, index);
          }
          dead = true;
        }
      } else if (dist(b.x, b.y, player.x, player.y) <= PLAYER_HIT_RADIUS) {
        hurtPlayer(state, b.damage ?? ENEMY_BULLET_DAMAGE, b.x - (b.vx || 0) * 0.05, b.y - (b.vy || 0) * 0.05);
        burst(state, player.x, player.y, { count: 6, color: '#e0483e', speed: 120, life: 0.35, size: 3 });
        playSound(state, 'hit');
        dead = true;
      }
    }

    if (dead) bullets.splice(i, 1);
  }
}

// ---------------------------------------------------------------- enemies

function updateEnemies(state, dt) {
  const player = state.player;
  const rng = rngFn(state);
  if (!player || player.alive === false) return;
  const enemies = state.enemies || [];
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e._shootTimer = Math.max(0, (e._shootTimer ?? 0) - dt);
    e._meleeTimer = Math.max(0, (e._meleeTimer ?? 0) - dt);
    const d = dist(e.x, e.y, player.x, player.y);
    e.angle = Math.atan2(player.y - e.y, player.x - e.x);

    // Chase until close enough to fight.
    if (d > ENEMY_MELEE_RANGE) {
      const speed = e.speed ?? ENEMY_SPEED;
      const nx = e.x + Math.cos(e.angle) * speed * dt;
      const ny = e.y + Math.sin(e.angle) * speed * dt;
      if (!collides(state, nx, e.y, ENEMY_RADIUS)) e.x = nx;
      if (!collides(state, e.x, ny, ENEMY_RADIUS)) e.y = ny;
    }

    // Close quarters: a shove that hurts.
    if (d <= ENEMY_MELEE_RANGE && e._meleeTimer <= 0) {
      e._meleeTimer = ENEMY_MELEE_COOLDOWN;
      hurtPlayer(state, ENEMY_MELEE_DAMAGE, e.x, e.y);
      burst(state, player.x, player.y, { count: 5, color: '#e0483e', speed: 110, life: 0.3, size: 3 });
      playSound(state, 'hit');
      continue;
    }

    // Shoot when in range, on a staggered timer so a group does not
    // fire in perfect unison.
    if (d <= ENEMY_SHOOT_RANGE && e._shootTimer <= 0) {
      e._shootTimer = ENEMY_SHOOT_COOLDOWN + rng() * 0.6;
      const aim = Math.atan2(player.y - e.y, player.x - e.x) + (rng() - 0.5) * 0.16;
      if (!Array.isArray(state.bullets)) state.bullets = [];
      state.bullets.push({
        x: e.x + Math.cos(aim) * 16,
        y: e.y + Math.sin(aim) * 16,
        vx: Math.cos(aim) * ENEMY_BULLET_SPEED,
        vy: Math.sin(aim) * ENEMY_BULLET_SPEED,
        life: ENEMY_BULLET_LIFE,
        from: 'enemy',
        damage: ENEMY_BULLET_DAMAGE,
      });
      burst(state, e.x + Math.cos(aim) * 18, e.y + Math.sin(aim) * 18, {
        count: 4,
        colors: ['#ffd94a', '#ffffff'],
        speed: 110,
        life: 0.2,
        size: 2,
      });
      playSound(state, 'shoot');
    }
  }
}

// ---------------------------------------------------------------- update

export function updateCombat(state, dt) {
  const step = clamp(dt || 0, 0, 0.05);
  const player = state.player;
  if (!player || step <= 0) return;
  if (!Array.isArray(state.bullets)) state.bullets = [];
  if (!Array.isArray(state.enemies)) state.enemies = [];

  player._shootTimer = Math.max(0, (player._shootTimer ?? 0) - step);

  // --- Player shooting: one click, one shot (while armed) --------------
  const mouse = state.input && state.input.mouse;
  const mouseDown = !!(mouse && mouse.down);
  const clicked =
    !!(mouse && mouse.clicked) || (mouseDown && !state._combatMouseWasDown);
  state._combatMouseWasDown = mouseDown;
  if (clicked && player.alive !== false && player.weapon === 'pistol') {
    if (player._shootTimer <= 0) {
      if ((player.ammo || 0) > 0) {
        player._shootTimer = SHOOT_COOLDOWN;
        firePlayerBullet(state);
      } else {
        player._shootTimer = SHOOT_COOLDOWN;
        playSound(state, 'click');
      }
    }
  }

  updateBullets(state, step);
  updateEnemies(state, step);

  // A bullet or a fist elsewhere may have finished Leo off.
  if (player.health <= 0) {
    player.health = 0;
    player.alive = false;
  }
}
