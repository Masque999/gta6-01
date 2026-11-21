// config.js — Solmar Bay: all tuning constants in one place.
// Original code written for this project. No external dependencies.

export const WORLD_SIZE = 3200;
export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 3200;
export const BLOCK = 320; // building block side (px)
export const ROAD = 80; // road width (px)
export const PITCH = 400; // BLOCK + ROAD
export const GRID = 8; // 8 x 8 blocks

export const SAVE_KEY = 'solmar-save-v1';

// --- Screens (also re-exported from render.js) ---
export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

// --- Player ---
export const PLAYER_RADIUS = 14;
export const PLAYER_WALK_SPEED = 170; // px per second
export const PLAYER_RUN_SPEED = 260; // px per second (hold Shift)
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MELEE_RANGE = 34;
export const PLAYER_MELEE_DAMAGE = 25;
export const PLAYER_MELEE_COOLDOWN = 0.35; // seconds
export const PLAYER_SHOOT_COOLDOWN = 0.18;
export const BULLET_SPEED = 720;
export const BULLET_LIFE = 0.9; // seconds
export const BULLET_DAMAGE = 20;

// --- Cars ---
export const CAR_LENGTH = 56;
export const CAR_WIDTH = 28;
export const CAR_ACCEL = 420;
export const CAR_BRAKE = 700;
export const CAR_MAX_SPEED = 520; // player-driven top speed
export const CAR_TRAFFIC_SPEED = 170;
export const CAR_POLICE_SPEED = 430;
export const CAR_MAX_HEALTH = 100;
export const CAR_ENTER_RANGE = 70;

// --- Pedestrians / enemies ---
export const PED_RADIUS = 10;
export const PED_WALK_SPEED = 55;
export const PED_FLEE_SPEED = 130;
export const ENEMY_RADIUS = 13;
export const ENEMY_SPEED = 150;
export const ENEMY_MAX_HEALTH = 60;
export const ENEMY_SHOOT_RANGE = 380;
export const ENEMY_SHOOT_COOLDOWN = 1.1;

// --- Wanted ---
export const WANTED_MAX = 5;
export const WANTED_LEVELS = [0, 1, 2, 3, 4, 5];
// Seconds of staying out of sight before the wanted level drops by one.
export const WANTED_COOLDOWN = [0, 25, 30, 35, 40, 50];
// How many police cars actively chase at each wanted level.
export const WANTED_POLICE_CARS = [0, 1, 1, 2, 3, 4];

// --- Camera ---
export const CAMERA_ZOOM = 1.0;
export const CAMERA_MIN_ZOOM = 0.6;
export const CAMERA_MAX_ZOOM = 1.6;

// --- Missions ---
export const MISSION_IDS = {
  FIRST_WHEELS: 'first-wheels',
  THE_DELIVERY: 'the-delivery',
  HARBOR_HEAT: 'harbor-heat',
  THE_BIG_SCORE: 'the-big-score',
};
export const MISSION_LIST = Object.values(MISSION_IDS);

// --- Key bindings (KeyboardEvent.code values) ---
export const KEYS = {
  UP: ['KeyW', 'ArrowUp'],
  DOWN: ['KeyS', 'ArrowDown'],
  LEFT: ['KeyA', 'ArrowLeft'],
  RIGHT: ['KeyD', 'ArrowRight'],
  RUN: ['ShiftLeft', 'ShiftRight'],
  CONFIRM: ['Space', 'Enter'],
  PAUSE: ['KeyP', 'Escape'],
  ENTER_CAR: ['KeyE'],
  MELEE: ['KeyF'],
  MUTE: ['KeyM'],
  SHOOT: ['Mouse0'], // mouse button, handled via input.mouse
};

// Keys whose browser default (scrolling) must be suppressed while playing.
export const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

// --- Sun-soaked coastal palette ---
export const COLORS = {
  grass: '#8fae5a',
  grassLight: '#a2bd6b',
  sand: '#e8d5a2',
  sandDark: '#dcc78d',
  water: '#2fa8a0',
  waterDeep: '#1e7f8c',
  waterEdge: '#bfe8d8',
  road: '#4a4642',
  roadDark: '#3c3835',
  roadLine: '#e8d96a',
  sidewalk: '#b9b2a4',
  sidewalkEdge: '#a39c8c',
  park: '#5d9b4a',
  parkDark: '#4c8440',
  tree: '#2f6b2a',
  treeLight: '#4a8a3a',
  buildingRoof: '#6b5a4e',
  // Varied building wall colours (warm stucco, pastel coastal).
  buildings: [
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
  ],
  roofs: ['#7a5c44', '#5d4a3a', '#8a6a52', '#4a3f38', '#96684a'],
  player: '#2f7fd0',
  playerDark: '#1d5a96',
  pedSkin: '#e8b98a',
  enemy: '#c0392b',
  police: '#2c3e50',
  policeLight: '#3d6fb4',
  bullet: '#ffd94a',
  particle: '#ffb347',
  hudBg: 'rgba(12, 18, 24, 0.72)',
  hudText: '#f5efe0',
  hudAccent: '#ffd94a',
  danger: '#e0483e',
  star: '#ffd94a',
  starEmpty: 'rgba(245, 239, 224, 0.35)',
  title: '#ffd94a',
  titleShadow: '#17384f',
};

// Car paint colours (traffic + player-stealable).
export const CAR_COLORS = [
  '#c0392b',
  '#2f7fd0',
  '#e8b04b',
  '#7fae8a',
  '#e6d6b8',
  '#5b8fb0',
  '#8a6a52',
  '#9b7bb0',
  '#dfe3e6',
  '#3c3835',
];

// Pedestrian shirt colours.
export const PED_COLORS = [
  '#e07856',
  '#5b8fb0',
  '#7fae8a',
  '#e8b04b',
  '#9b7bb0',
  '#d97b4f',
  '#6aa99e',
  '#c65b5b',
];
