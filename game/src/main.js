// Solmar Bay — boot and the one loop.
//
// The game moves between four screens: title, play, paused and game over.
// Input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints
// what is there. Missions run in order; finishing one banks the reward and
// the next job starts at the safehouse marker.
//
// ?seed=N fixes the city and traffic. ?shot=cover|drive|chase|mission
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.
import {
  SAVE_KEY,
  SCREEN_TITLE,
  SCREEN_PLAY,
  SCREEN_PAUSED,
  SCREEN_OVER,
} from './config.js';
import { createRandom } from './random.js';
import { createCity, cityCollides, cityRoadPoint, citySidewalkPoint } from './city.js';
import {
  createInput,
  ACTION_CONFIRM,
  ACTION_PAUSE,
  ACTION_ENTER,
  ACTION_MELEE,
  ACTION_MUTE,
} from './input.js';
import { createRenderer } from './render.js';
import { spawnTraffic, updateVehicles, enterCar, exitCar, nearestCar } from './vehicles.js';
import { addWanted, clearWanted, updatePolice } from './police.js';
import { spawnPeds, updatePeds } from './pedestrians.js';
import { updatePlayer } from './player.js';
import { updateCombat, spawnEnemies, giveWeapon } from './combat.js';
import { MISSIONS, startMission, updateMissions, missionMarker } from './missions.js';
import { addParticles, explode, updateEffects } from './effects.js';
import { createAudio } from './audio.js';
import { saveGame, loadGame, clearSave } from './save.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped, not replayed. */
const STEP = 1 / 60;
const MAX_FRAME = 0.25;
/** Where the next job starts when no mission is running. */
const SAFEHOUSE = { x: 300, y: 300 };
const MISSION_START_RADIUS = 110;
const TRAFFIC_COUNT = 10;
const PED_COUNT = 12;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();

/** The modules, as one object, for the screenshot stager. */
const systems = {
  city: { createCity, cityCollides, cityRoadPoint, citySidewalkPoint },
  random: { createRandom },
  input: { createInput },
  render: { createRenderer },
  vehicles: { spawnTraffic, updateVehicles, enterCar, exitCar, nearestCar },
  police: { addWanted, clearWanted, updatePolice },
  pedestrians: { spawnPeds, updatePeds },
  player: { updatePlayer },
  combat: { updateCombat, spawnEnemies, giveWeapon },
  missions: { MISSIONS, startMission, updateMissions, missionMarker },
  effects: { addParticles, explode, updateEffects },
  audio: { createAudio },
  save: { saveGame, loadGame, clearSave },
};

function createState(seedValue) {
  const rng = createRandom(seedValue);
  const city = createCity(seedValue);
  const start = citySidewalkPoint(city, rng);
  const state = {
    time: 0,
    seed: seedValue,
    rng,
    city,
    screen: SCREEN_TITLE,
    player: {
      x: start.x,
      y: start.y,
      angle: 0,
      speed: 0,
      health: 100,
      maxHealth: 100,
      money: 0,
      weapon: 'fists',
      ammo: 0,
      inCar: null,
      alive: true,
      lastDamagedAt: -99,
    },
    cars: [],
    peds: [],
    enemies: [],
    bullets: [],
    particles: [],
    wanted: 0,
    wantedTimer: 0,
    mission: null,
    missionsDone: [],
    missionStart: null,
    dialogue: null,
    lastShotAt: null,
    camera: { x: start.x, y: start.y, zoom: 1 },
    input,
    audio,
    stats: { stolen: 0, delivered: 0, kills: 0 },
    best: 0,
  };
  // Cross-module wiring (each module calls these on `state`, guarded).
  state.addWanted = addWanted;
  state.clearWanted = clearWanted;
  state.enterCar = enterCar;
  state.exitCar = exitCar;
  state.spawnEnemies = spawnEnemies;
  state.giveWeapon = giveWeapon;
  state.saveGame = saveGame;
  state.addParticles = addParticles;
  state.explode = explode;
  state.effects = { addParticles, explode, updateEffects };
  state.cityCollides = (x, y, r) => cityCollides(city, x, y, r);
  state.nearestCar = (x, y, d) => nearestCar(state, x, y, d);
  state.missionMarker = () => missionMarker(state);
  return state;
}

let state = createState(seed);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(SAVE_KEY + ':best') ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(SAVE_KEY + ':best', String(value));
  } catch {
    // Storage can be off (private windows): the best then lasts this visit only.
  }
}

/** Mouse position in world coordinates, for aiming. */
function updateMouseWorld() {
  const mouse = input.mouse;
  if (!mouse) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = rect.width > 0 ? canvas.width / rect.width : 1;
  const cw = canvas.width;
  const ch = canvas.height;
  const zoom = (state.camera && state.camera.zoom) || 1;
  mouse.worldX = state.camera.x + (mouse.x * dpr - cw / 2) / zoom;
  mouse.worldY = state.camera.y + (mouse.y * dpr - ch / 2) / zoom;
}

function populateWorld() {
  spawnTraffic(state, TRAFFIC_COUNT);
  spawnPeds(state, PED_COUNT);
}

function startNewGame() {
  state = createState(seed);
  state.best = readBest();
  populateWorld();
  startMission(state, MISSIONS[0].id);
  state.screen = SCREEN_PLAY;
  announce('Playing. First job: steal a car.');
  audio.unlock();
  audio.startMusic();
}

function continueGame(saved) {
  state = createState(seed);
  state.best = readBest();
  state.player.money = saved.money || 0;
  state.missionsDone = Array.isArray(saved.missionsDone) ? saved.missionsDone.slice() : [];
  if (typeof saved.playerX === 'number' && typeof saved.playerY === 'number') {
    state.player.x = saved.playerX;
    state.player.y = saved.playerY;
    state.camera.x = saved.playerX;
    state.camera.y = saved.playerY;
  }
  populateWorld();
  state.screen = SCREEN_PLAY;
  announce('Continuing. Money $' + state.player.money + '.');
  audio.unlock();
  audio.startMusic();
}

function endGame(reason) {
  state.screen = SCREEN_OVER;
  const money = state.player.money;
  if (money > state.best) {
    state.best = money;
    saveBest(money);
  }
  announce((reason === 'busted' ? 'Busted. ' : 'Game over. ') + 'Money $' + money + '. Best $' + state.best + '.');
  audio.siren(false);
}

function announce(message) {
  if (status) status.textContent = message;
}

/** The next job id, or null when the story is done. */
function nextMissionId() {
  if (state.missionsDone.length >= MISSIONS.length) return null;
  return MISSIONS[state.missionsDone.length].id;
}

/** Keep a job available: start the first at once, later ones at the safehouse marker. */
function updateMissionFlow() {
  if (state.mission) {
    state.missionStart = null;
    return;
  }
  const id = nextMissionId();
  if (!id) {
    state.missionStart = null;
    if (state.missionsDone.length >= MISSIONS.length && !state.storyDone) {
      state.storyDone = true;
      state.dialogue = { speaker: 'Leo', text: 'That is the whole story. You own Solmar Bay.', until: state.time + 8 };
    }
    return;
  }
  state.missionStart = { x: SAFEHOUSE.x, y: SAFEHOUSE.y, missionId: id };
  const dx = state.player.x - SAFEHOUSE.x;
  const dy = state.player.y - SAFEHOUSE.y;
  if (dx * dx + dy * dy < MISSION_START_RADIUS * MISSION_START_RADIUS) {
    startMission(state, id);
    state.missionStart = null;
  }
}

function updateCamera(dt) {
  const focus = state.player.inCar
    ? state.cars.find((c) => c.id === state.player.inCar)
    : state.player;
  const fx = focus ? focus.x : state.player.x;
  const fy = focus ? focus.y : state.player.y;
  const targetZoom = state.player.inCar ? 0.85 : 1;
  const k = Math.min(1, dt * 5);
  state.camera.x += (fx - state.camera.x) * k;
  state.camera.y += (fy - state.camera.y) * k;
  state.camera.zoom += (targetZoom - state.camera.zoom) * k;
}

function stepWorld(dt) {
  state.time += dt;
  updateMouseWorld();
  updatePlayer(state, dt);
  updateVehicles(state, dt);
  updatePolice(state, dt);
  updatePeds(state, dt);
  updateCombat(state, dt);
  updateMissions(state, dt);
  updateEffects(state, dt);
  updateMissionFlow();
  updateCamera(dt);
  if (audio && typeof audio.update === 'function') audio.update(state);
  if (!state.player.alive) endGame(state.player.busted ? 'busted' : 'dead');
}

function runShot(name) {
  const scene = stageShot(name, { state, systems });
  const screen = scene.screen || SCREEN_TITLE;
  let painted = 0;
  function paint() {
    renderer.draw(state, screen);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  state.best = readBest();
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.muted);
      announce(audio.muted ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_OVER)) {
      const saved = loadGame();
      if (screen === SCREEN_TITLE && saved && saved.missionsDone && saved.missionsDone.length > 0) {
        continueGame(saved);
      } else {
        startNewGame();
      }
      screen = SCREEN_PLAY;
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      state.screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      state.screen = SCREEN_PLAY;
      announce('Playing.');
    }
    // Keep the renderer's screen in step.
    if (screen === SCREEN_PLAY) state.screen = SCREEN_PLAY;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        if (screen === SCREEN_PLAY) stepWorld(STEP);
        else {
          // Title screen idles the world behind the menu.
          state.time += STEP;
          updatePeds(state, STEP);
          updateVehicles(state, STEP);
          updateCamera(STEP);
        }
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    // The state screen is what the renderer draws.
    if (screen === SCREEN_OVER) state.screen = SCREEN_OVER;
    renderer.draw(state, screen);
  }

  // Leaving the tab pauses a running game rather than letting it run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      state.screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  // First gesture unlocks audio.
  window.addEventListener('keydown', () => audio.unlock(), { once: true });
  canvas.addEventListener('mousedown', () => audio.unlock(), { once: true });

  announce('Solmar Bay. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
