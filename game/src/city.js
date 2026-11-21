// city.js — Procedural Solmar Bay city layout.
// Original code written for this project. Depends only on random.js.
//
// Layout: an 8x8 grid of blocks. Each cell of the grid is PITCH (400px):
// an 80px road strip on its north/west edges plus a 320px block.
//   road strip:  x in [col*400, col*400+80)
//   block:       x in [col*400+80, col*400+400)
// The same holds for y. The world is 8*400 = 3200px on a side.
// A bay (water) runs along the south edge; buildings in the last row
// are kept clear of it.

import { createRandom } from './random.js';

export const WORLD_SIZE = 3200;
export const GRID = 8;
export const BLOCK = 320;
export const ROAD = 80;
export const PITCH = 400;

// Bay along the south edge: 160px tall, full width.
export const WATER_Y = WORLD_SIZE - 160;
export const WATER_HEIGHT = 160;

// Sun-soaked coastal building colours (walls + roofs).
const WALL_COLORS = [
  '#e8b04b',
  '#d97b4f',
  '#c65b5b',
  '#7fae8a',
  '#5b8fb0',
  '#e6d6b8',
  '#b08968',
  '#9b7bb0',
  '#e07856',
  '#6aa99e',
];
const ROOF_COLORS = ['#7a5c44', '#5d4a3a', '#8a6a52', '#4a3f38', '#96684a'];

function blockOrigin(col, row) {
  return { x: col * PITCH + ROAD, y: row * PITCH + ROAD };
}

/**
 * Build the city deterministically from a seed.
 * @param {number} seed
 * @returns {{ size: number, grid: number, block: number, road: number,
 *   pitch: number, buildings: Array, parks: Array,
 *   water: { x: number, y: number, w: number, h: number }, seed: number }}
 *
 * Building entries: { x, y, w, h, color, roof, height }
 *   x, y, w, h — footprint rectangle in world coordinates.
 *   color      — wall colour; roof — roof colour.
 *   height     — pseudo-3D extrusion height in px (used by the renderer
 *                for side shading); footprint height stays in `h`.
 * Park entries: { x, y, w, h }.
 */
export function createCity(seed) {
  const rng = createRandom(seed);
  const buildings = [];
  const parks = [];

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const origin = blockOrigin(col, row);
      // The bay eats the bottom of the last row of blocks.
      const usableHeight =
        row === GRID - 1 ? WATER_Y - 16 - origin.y : BLOCK;

      // ~18% of blocks are parks (green space, no buildings).
      if (rng.next() < 0.18) {
        parks.push({ x: origin.x, y: origin.y, w: BLOCK, h: usableHeight });
        continue;
      }

      const inset = 26;
      const innerX = origin.x + inset;
      const innerY = origin.y + inset;
      const innerW = BLOCK - inset * 2;
      const innerH = usableHeight - inset * 2;
      if (innerW <= 40 || innerH <= 40) continue;

      const twoBuildings = rng.next() < 0.45;
      if (!twoBuildings) {
        // One large building filling most of the block.
        const w = Math.round(rng.range(innerW * 0.55, innerW));
        const h = Math.round(rng.range(innerH * 0.55, innerH));
        const x = Math.round(innerX + rng.range(0, innerW - w));
        const y = Math.round(innerY + rng.range(0, innerH - h));
        buildings.push({
          x,
          y,
          w,
          h,
          color: rng.pick(WALL_COLORS),
          roof: rng.pick(ROOF_COLORS),
          height: rng.int(14, 46),
        });
      } else if (rng.next() < 0.5) {
        // Two buildings side by side (split vertically).
        const gap = 18;
        const wEach = Math.floor((innerW - gap) / 2);
        for (let i = 0; i < 2; i++) {
          const h = Math.round(rng.range(innerH * 0.5, innerH));
          const x = Math.round(innerX + i * (wEach + gap));
          const y = Math.round(innerY + rng.range(0, innerH - h));
          buildings.push({
            x,
            y,
            w: wEach,
            h,
            color: rng.pick(WALL_COLORS),
            roof: rng.pick(ROOF_COLORS),
            height: rng.int(12, 40),
          });
        }
      } else {
        // Two buildings stacked (split horizontally).
        const gap = 18;
        const hEach = Math.floor((innerH - gap) / 2);
        for (let i = 0; i < 2; i++) {
          const w = Math.round(rng.range(innerW * 0.5, innerW));
          const x = Math.round(innerX + rng.range(0, innerW - w));
          const y = Math.round(innerY + i * (hEach + gap));
          buildings.push({
            x,
            y,
            w,
            h: hEach,
            color: rng.pick(WALL_COLORS),
            roof: rng.pick(ROOF_COLORS),
            height: rng.int(12, 40),
          });
        }
      }
    }
  }

  return {
    size: WORLD_SIZE,
    grid: GRID,
    block: BLOCK,
    road: ROAD,
    pitch: PITCH,
    buildings,
    parks,
    water: { x: 0, y: WATER_Y, w: WORLD_SIZE, h: WATER_HEIGHT },
    seed,
  };
}

/** True if a circle at (x, y) with radius r overlaps any building. */
export function cityCollides(city, x, y, r) {
  for (const b of city.buildings) {
    const closestX = Math.max(b.x, Math.min(x, b.x + b.w));
    const closestY = Math.max(b.y, Math.min(y, b.y + b.h));
    const dx = x - closestX;
    const dy = y - closestY;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/**
 * Random point in the middle of a road, with the heading of traffic
 * along that road (0 = east, 90 = south, 180 = west, 270 = north).
 * Points are kept clear of the southern bay.
 */
export function cityRoadPoint(city, rng) {
  const size = city.size;
  const vertical = rng.next() < 0.5;
  if (vertical) {
    const col = rng.int(0, city.grid - 1);
    const x = col * city.pitch + city.road / 2;
    const y = rng.range(40, city.water.y - 60);
    const angle = rng.next() < 0.5 ? 90 : 270;
    return { x, y, angle };
  }
  const row = rng.int(0, city.grid - 1);
  const y = row * city.pitch + city.road / 2;
  const x = rng.range(40, size - 40);
  const angle = rng.next() < 0.5 ? 0 : 180;
  return { x, y, angle };
}

/**
 * Random point on a sidewalk: just off a road edge, on the pavement
 * strip between the asphalt and the building blocks. The returned
 * angle runs along the road (same convention as cityRoadPoint).
 */
export function citySidewalkPoint(city, rng) {
  const size = city.size;
  const vertical = rng.next() < 0.5;
  // Sidewalk band: 6..16px past the road edge (road half-width is 40).
  const off = rng.range(46, 56);
  const side = rng.next() < 0.5 ? -1 : 1;
  if (vertical) {
    const col = rng.int(0, city.grid - 1);
    const centre = col * city.pitch + city.road / 2;
    const x = centre + side * off;
    const y = rng.range(40, city.water.y - 60);
    const angle = rng.next() < 0.5 ? 90 : 270;
    return { x: Math.max(8, Math.min(size - 8, x)), y, angle };
  }
  const row = rng.int(0, city.grid - 1);
  const centre = row * city.pitch + city.road / 2;
  const y = centre + side * off;
  const x = rng.range(40, size - 40);
  const angle = rng.next() < 0.5 ? 0 : 180;
  return { x, y: Math.max(8, Math.min(size - 8, y)), angle };
}
