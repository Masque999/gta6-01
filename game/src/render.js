// render.js — Canvas 2D renderer for Solmar Bay.
// Original code written for this project. Imports config only.
// No images, no network — every visual is drawn with canvas primitives.
//
// Usage:
//   const renderer = createRenderer(canvas);
//   renderer.draw(state, state.screen);
//
// Camera convention: state.camera { x, y, zoom } is the world point
// shown at the centre of the screen. If camera is missing, the view
// centres on the player (or the world centre if there is no player).

import { COLORS, CAR_COLORS, SCREEN_TITLE, SCREEN_PAUSED, SCREEN_OVER, SAVE_KEY } from './config.js';

export { SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED, SCREEN_OVER } from './config.js';
export const SCREEN_TITLE_ALIAS = SCREEN_TITLE;

const MINIMAP_SIZE = 170;
const MINIMAP_MARGIN = 12;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hasSave() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

function shade(hex, factor) {
  // Darken (factor < 1) or lighten (factor > 1) a #rrggbb colour.
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * factor), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * factor), 0, 255);
  const b = clamp(Math.round((n & 255) * factor), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return { w: canvas.width, h: canvas.height, dpr };
  }

  function draw(state, screen) {
    const { w: cw, h: ch } = fitCanvas();
    const current = screen || state.screen || SCREEN_TITLE;
    const city = state.city;
    const player = state.player || { x: 1600, y: 1600, angle: 0, health: 100, maxHealth: 100, money: 0 };
    const camera = state.camera || { x: player.x, y: player.y, zoom: 1 };
    const zoom = camera.zoom || 1;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#10181f';
    ctx.fillRect(0, 0, cw, ch);

    // ---- World pass (camera transform) ----
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camera.x, -camera.y);

    if (city) drawWorld(state, city, camera, zoom, cw, ch);
    drawCars(state);
    drawPeds(state);
    drawEnemies(state);
    drawPlayer(state);
    drawBullets(state);
    drawParticles(state);

    ctx.restore();

    // ---- Screen-space pass ----
    if (current !== SCREEN_TITLE) {
      drawHud(state, cw, ch);
      drawMinimap(state, cw, ch);
    }

    if (current === SCREEN_TITLE) drawTitle(state, cw, ch);
    else if (current === SCREEN_PAUSED) drawPaused(cw, ch);
    else if (current === SCREEN_OVER) drawGameOver(state, cw, ch);
  }

  // ---------- World ----------

  function viewBounds(camera, zoom, cw, ch) {
    const hw = cw / 2 / zoom;
    const hh = ch / 2 / zoom;
    return {
      x0: camera.x - hw - 60,
      y0: camera.y - hh - 60,
      x1: camera.x + hw + 60,
      y1: camera.y + hh + 60,
    };
  }

  function drawWorld(state, city, camera, zoom, cw, ch) {
    const view = viewBounds(camera, zoom, cw, ch);
    const size = city.size;

    // Background: warm grass with a sandy southern shore.
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = COLORS.grassLight;
    for (let i = 0; i < 40; i++) {
      // Deterministic tufts from block position — cheap texture.
      const tx = ((i * 977) % size) + 20;
      const ty = ((i * 571) % (size - 200)) + 20;
      if (tx < view.x0 || tx > view.x1 || ty < view.y0 || ty > view.y1) continue;
      ctx.fillRect(tx, ty, 26, 10);
    }

    // Water bay along the south edge + sand shore above it.
    const water = city.water;
    ctx.fillStyle = COLORS.sand;
    ctx.fillRect(0, water.y - 46, size, 46);
    ctx.fillStyle = COLORS.water;
    ctx.fillRect(water.x, water.y, water.w, water.h);
    ctx.fillStyle = COLORS.waterDeep;
    ctx.fillRect(water.x, water.y + water.h * 0.45, water.w, water.h * 0.55);
    ctx.fillStyle = COLORS.waterEdge;
    ctx.fillRect(water.x, water.y, water.w, 5);
    // Gentle wave lines.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const wy = water.y + 24 + i * 11;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 80) {
        const yy = wy + Math.sin((x + i * 130) * 0.01) * 3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    // Roads: dark asphalt strips across the whole grid.
    ctx.fillStyle = COLORS.road;
    for (let i = 0; i < city.grid; i++) {
      ctx.fillRect(i * city.pitch, 0, city.road, size);
      ctx.fillRect(0, i * city.pitch, size, city.road);
    }
    // Dashed centre lines.
    ctx.strokeStyle = COLORS.roadLine;
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 22]);
    ctx.beginPath();
    for (let i = 0; i < city.grid; i++) {
      const c = i * city.pitch + city.road / 2;
      ctx.moveTo(c, 0);
      ctx.lineTo(c, size);
      ctx.moveTo(0, c);
      ctx.lineTo(size, c);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Sidewalks: pale pavement slabs filling each block.
    ctx.fillStyle = COLORS.sidewalk;
    for (let row = 0; row < city.grid; row++) {
      for (let col = 0; col < city.grid; col++) {
        const bx = col * city.pitch + city.road;
        const by = row * city.pitch + city.road;
        if (bx > view.x1 || by > view.y1 || bx + city.block < view.x0 || by + city.block < view.y0) continue;
        ctx.fillRect(bx, by, city.block, city.block);
      }
    }

    // Parks: green lawns with trees.
    for (const park of city.parks || []) {
      if (park.x > view.x1 || park.y > view.y1 || park.x + park.w < view.x0 || park.y + park.h < view.y0) continue;
      ctx.fillStyle = COLORS.park;
      ctx.fillRect(park.x, park.y, park.w, park.h);
      ctx.fillStyle = COLORS.parkDark;
      ctx.fillRect(park.x + 8, park.y + 8, park.w - 16, park.h - 16);
      // Trees in a loose grid, deterministic per park.
      ctx.fillStyle = COLORS.tree;
      const cols = Math.max(1, Math.floor(park.w / 90));
      const rows = Math.max(1, Math.floor(park.h / 90));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tx = park.x + 45 + c * 90 + ((r * 37 + c * 53) % 30);
          const ty = park.y + 45 + r * 90 + ((c * 29 + r * 41) % 30);
          ctx.beginPath();
          ctx.arc(tx, ty, 16, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = COLORS.treeLight;
          ctx.beginPath();
          ctx.arc(tx - 4, ty - 4, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = COLORS.tree;
        }
      }
    }

    // Buildings: wall colour + darker roof inset + one-sided height shade.
    for (const b of city.buildings || []) {
      if (b.x > view.x1 || b.y > view.y1 || b.x + b.w < view.x0 || b.y + b.h < view.y0) continue;
      const drop = b.height || 14;
      // South-east "wall" gives a slight 3D extrusion feel.
      ctx.fillStyle = shade(b.color, 0.62);
      ctx.fillRect(b.x + 5, b.y + drop * 0.45, b.w, b.h);
      ctx.fillRect(b.x + b.w, b.y + 5, drop * 0.45, b.h);
      // Wall.
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Roof inset.
      ctx.fillStyle = b.roof || COLORS.buildingRoof;
      const inset = Math.min(12, Math.floor(Math.min(b.w, b.h) * 0.12));
      ctx.fillRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
      // Roof detail: a small vent / skylight.
      ctx.fillStyle = shade(b.roof || COLORS.buildingRoof, 1.25);
      ctx.fillRect(b.x + b.w / 2 - 8, b.y + b.h / 2 - 8, 16, 16);
    }

    // Mission target marker on the ground (pulsing ring).
    const mission = state.mission;
    if (mission && mission.target) {
      const pulse = 1 + Math.sin((state.time || 0) * 4) * 0.15;
      ctx.strokeStyle = COLORS.hudAccent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(mission.target.x, mission.target.y, 30 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = COLORS.hudAccent;
      ctx.beginPath();
      ctx.arc(mission.target.x, mission.target.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- Entities ----------

  function drawCars(state) {
    for (const car of state.cars || []) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle || 0);
      const len = 56;
      const wid = 28;
      // Body.
      ctx.fillStyle = car.color || CAR_COLORS[0];
      roundRect(ctx, -len / 2, -wid / 2, len, wid, 8);
      ctx.fill();
      // Cabin / windshield.
      ctx.fillStyle = 'rgba(20, 30, 40, 0.85)';
      roundRect(ctx, -8, -wid / 2 + 4, 16, wid - 8, 4);
      ctx.fill();
      // Headlights.
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(len / 2 - 3, -wid / 2 + 3, 3, 5);
      ctx.fillRect(len / 2 - 3, wid / 2 - 8, 3, 5);
      if (car.kind === 'police' || car.driver === 'police') {
        // Light bar.
        ctx.fillStyle = '#e0483e';
        ctx.fillRect(-4, -wid / 2 + 2, 8, 6);
        ctx.fillStyle = '#3d6fb4';
        ctx.fillRect(-4, wid / 2 - 8, 8, 6);
      }
      if (car.driver === 'player') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        roundRect(ctx, -len / 2 - 2, -wid / 2 - 2, len + 4, wid + 4, 9);
        ctx.stroke();
      }
      ctx.restore();

      // Damage smoke for battered cars.
      if (car.health !== undefined && car.health < 35) {
        ctx.fillStyle = 'rgba(60, 60, 60, 0.5)';
        ctx.beginPath();
        ctx.arc(car.x - 10, car.y - 8, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPeds(state) {
    for (const ped of state.peds || []) {
      ctx.fillStyle = ped.color || '#e07856';
      ctx.beginPath();
      ctx.arc(ped.x, ped.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.pedSkin;
      ctx.beginPath();
      ctx.arc(ped.x, ped.y, 6, 0, Math.PI * 2);
      ctx.fill();
      // Fleeing peds get a small "!" above them.
      if (ped.state === 'flee') {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', ped.x, ped.y - 16);
      }
    }
  }

  function drawEnemies(state) {
    for (const e of state.enemies || []) {
      ctx.fillStyle = COLORS.enemy;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7c1f16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 13, 0, Math.PI * 2);
      ctx.stroke();
      // Facing tick.
      const a = e.angle || 0;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18);
      ctx.stroke();
      // Health bar.
      if (e.health !== undefined) {
        const max = e.maxHealth || 60;
        const frac = clamp(e.health / max, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(e.x - 14, e.y - 24, 28, 5);
        ctx.fillStyle = frac > 0.5 ? '#7ed957' : '#e0483e';
        ctx.fillRect(e.x - 14, e.y - 24, 28 * frac, 5);
      }
    }
  }

  function drawPlayer(state) {
    const player = state.player;
    if (!player || !player.alive) return;
    if (player.inCar) return; // driver is inside the car, drawn with it
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle || 0);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 15, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body.
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.playerDark;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    // Facing wedge / nose.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(2, -6);
    ctx.lineTo(2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBullets(state) {
    for (const b of state.bullets || []) {
      ctx.strokeStyle = COLORS.bullet;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x - (b.vx || 0) * 0.02, b.y - (b.vy || 0) * 0.02);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles(state) {
    for (const p of state.particles || []) {
      const frac = p.maxLife > 0 ? clamp(p.life / p.maxLife, 0, 1) : 0;
      ctx.globalAlpha = frac;
      ctx.fillStyle = p.color || COLORS.particle;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (p.size || 4) * (0.5 + frac * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD ----------

  function panel(ctx2, x, y, w, h) {
    ctx2.fillStyle = COLORS.hudBg;
    roundRect(ctx2, x, y, w, h, 10);
    ctx2.fill();
  }

  function drawHud(state, cw, ch) {
    const player = state.player || {};
    const health = player.health !== undefined ? player.health : 100;
    const maxHealth = player.maxHealth || 100;
    const money = player.money || 0;
    const wanted = state.wanted || 0;

    // Top-left status panel.
    panel(ctx, 12, 12, 250, 92);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Health bar.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, 24, 26, 150, 14, 7);
    ctx.fill();
    const hfrac = clamp(health / maxHealth, 0, 1);
    ctx.fillStyle = hfrac > 0.5 ? '#7ed957' : hfrac > 0.25 ? '#ffb347' : '#e0483e';
    if (hfrac > 0) {
      roundRect(ctx, 24, 26, 150 * hfrac, 14, 7);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.hudText;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`HP ${Math.ceil(health)}`, 182, 38);
    // Money.
    ctx.fillStyle = COLORS.hudAccent;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`$${money.toLocaleString('en-US')}`, 24, 68);
    // Weapon + ammo.
    ctx.fillStyle = COLORS.hudText;
    ctx.font = '13px sans-serif';
    const weapon = player.weapon || 'fists';
    const ammo = player.ammo !== undefined ? player.ammo : 0;
    ctx.fillText(weapon === 'fists' ? 'Fists' : `${weapon}  •  ${ammo} ammo`, 24, 90);

    // Wanted stars, top-left under the panel.
    ctx.font = '26px sans-serif';
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < wanted ? '★' : '☆';
    ctx.fillStyle = wanted > 0 ? COLORS.star : COLORS.starEmpty;
    ctx.fillText(stars, 14, 140);

    // Mission objective, top-centre.
    const mission = state.mission;
    if (mission) {
      ctx.font = 'bold 15px sans-serif';
      const title = mission.title || mission.id || 'Mission';
      const objective = mission.objective || '';
      const tw = Math.max(
        ctx.measureText(title).width,
        ctx.measureText(objective).width,
      );
      const bw = tw + 32;
      panel(ctx, cw / 2 - bw / 2, 12, bw, 52);
      ctx.fillStyle = COLORS.hudAccent;
      ctx.textAlign = 'center';
      ctx.fillText(title, cw / 2, 32);
      ctx.fillStyle = COLORS.hudText;
      ctx.font = '13px sans-serif';
      ctx.fillText(objective, cw / 2, 52);
      ctx.textAlign = 'left';
    }

    // Dialogue box, bottom-centre.
    const dialogue = state.dialogue;
    if (dialogue && dialogue.text && (state.time || 0) < (dialogue.until || 0)) {
      const bw = Math.min(cw - 80, 560);
      const bh = 64;
      panel(ctx, cw / 2 - bw / 2, ch - bh - 56, bw, bh);
      ctx.fillStyle = COLORS.hudAccent;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(dialogue.speaker || '', cw / 2 - bw / 2 + 16, ch - bh - 56 + 22);
      ctx.fillStyle = COLORS.hudText;
      ctx.font = '14px sans-serif';
      wrapText(dialogue.text, cw / 2 - bw / 2 + 16, ch - bh - 56 + 44, bw - 32, 18);
    }

    // Controls hint, bottom-left.
    ctx.fillStyle = 'rgba(245, 239, 224, 0.75)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    const inCar = player.inCar ? 'WASD drive • E exit • Space handbrake' : 'WASD move • Shift run • E enter car • F punch • Space shoot';
    ctx.fillText(`${inCar}  •  P pause  •  M mute`, 14, ch - 14);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }

  // ---------- Minimap ----------

  function drawMinimap(state, cw, ch) {
    const city = state.city;
    if (!city) return;
    const s = MINIMAP_SIZE;
    const mx = cw - s - MINIMAP_MARGIN;
    const my = MINIMAP_MARGIN;
    const scale = s / city.size;

    ctx.save();
    panel(ctx, mx - 6, my - 6, s + 12, s + 12);
    ctx.beginPath();
    ctx.rect(mx, my, s, s);
    ctx.clip();

    // Base + water.
    ctx.fillStyle = '#6d8a4a';
    ctx.fillRect(mx, my, s, s);
    ctx.fillStyle = COLORS.water;
    ctx.fillRect(mx, my + city.water.y * scale, s, city.water.h * scale + 2);

    // Roads.
    ctx.strokeStyle = 'rgba(40, 36, 33, 0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i < city.grid; i++) {
      const c = (i * city.pitch + city.road / 2) * scale;
      ctx.beginPath();
      ctx.moveTo(mx + c, my);
      ctx.lineTo(mx + c, my + s);
      ctx.moveTo(mx, my + c);
      ctx.lineTo(mx + s, my + c);
      ctx.stroke();
    }
    // Parks.
    ctx.fillStyle = COLORS.park;
    for (const park of city.parks || []) {
      ctx.fillRect(mx + park.x * scale, my + park.y * scale, Math.max(2, park.w * scale), Math.max(2, park.h * scale));
    }

    // Mission marker (pulsing gold diamond).
    const mission = state.mission;
    if (mission && mission.target) {
      const pulse = 3 + Math.sin((state.time || 0) * 5) * 1.5;
      ctx.fillStyle = COLORS.hudAccent;
      const tx = mx + mission.target.x * scale;
      const ty = my + mission.target.y * scale;
      ctx.beginPath();
      ctx.moveTo(tx, ty - pulse - 2);
      ctx.lineTo(tx + pulse + 2, ty);
      ctx.lineTo(tx, ty + pulse + 2);
      ctx.lineTo(tx - pulse - 2, ty);
      ctx.closePath();
      ctx.fill();
    }

    // Cars (police in blue, others white-grey).
    for (const car of state.cars || []) {
      const isPolice = car.kind === 'police' || car.driver === 'police';
      ctx.fillStyle = isPolice ? '#5aa2ff' : '#f5efe0';
      ctx.beginPath();
      ctx.arc(mx + car.x * scale, my + car.y * scale, isPolice ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player dot (white ring, accent centre).
    const player = state.player;
    if (player) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(mx + player.x * scale, my + player.y * scale, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.player;
      ctx.beginPath();
      ctx.arc(mx + player.x * scale, my + player.y * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    ctx.strokeStyle = 'rgba(245, 239, 224, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 6, my - 6, s + 12, s + 12);
  }

  // ---------- Overlays ----------

  function dim(cw, ch, alpha) {
    ctx.fillStyle = `rgba(8, 14, 20, ${alpha})`;
    ctx.fillRect(0, 0, cw, ch);
  }

  function drawTitle(state, cw, ch) {
    // Sun-soaked title backdrop: warm gradient sky over a teal bay.
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, '#ffcf6e');
    grad.addColorStop(0.45, '#ff9e5e');
    grad.addColorStop(0.72, '#2fa8a0');
    grad.addColorStop(1, '#17384f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
    // Sun.
    ctx.fillStyle = 'rgba(255, 244, 200, 0.95)';
    ctx.beginPath();
    ctx.arc(cw / 2, ch * 0.3, 54, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.title;
    ctx.font = `bold ${Math.min(84, cw / 8)}px sans-serif`;
    ctx.shadowColor = COLORS.titleShadow;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillText('SOLMAR BAY', cw / 2, ch * 0.32);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px sans-serif';
    ctx.fillText('A sun-soaked open-world crime story — an original game', cw / 2, ch * 0.32 + 38);

    const save = hasSave();
    const blink = Math.sin((state.time || 0) * 3) > -0.2;
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#ffffff';
    if (blink) {
      ctx.fillText(save ? '▶  Continue' : '▶  Start', cw / 2, ch * 0.58);
      if (save) {
        ctx.font = '18px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText('New Game  (hold nothing — press Space for Continue)', cw / 2, ch * 0.58 + 30);
      }
    }
    ctx.font = '15px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('WASD / Arrows — move & drive      E — enter / exit car      F — punch      Space — shoot', cw / 2, ch * 0.72);
    ctx.fillText('P / Esc — pause      M — mute      Steal cars, dodge the law, finish the job.', cw / 2, ch * 0.72 + 26);
    ctx.fillText('Press Space or click to play', cw / 2, ch * 0.82);
    ctx.textAlign = 'left';
  }

  function drawPaused(cw, ch) {
    dim(cw, ch, 0.6);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('PAUSED', cw / 2, ch / 2 - 10);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('Press P / Esc or Space to resume', cw / 2, ch / 2 + 30);
    ctx.textAlign = 'left';
  }

  function drawGameOver(state, cw, ch) {
    dim(cw, ch, 0.72);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.danger;
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('GAME OVER', cw / 2, ch / 2 - 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px sans-serif';
    const stats = state.stats || {};
    const missions = (state.missionsDone || []).length;
    ctx.fillText(
      `Missions finished: ${missions}    Cars stolen: ${stats.stolen || 0}    Deliveries: ${stats.delivered || 0}    Kills: ${stats.kills || 0}`,
      cw / 2,
      ch / 2 + 8,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('Press Space to try again', cw / 2, ch / 2 + 48);
    ctx.textAlign = 'left';
  }

  return { draw };
}
