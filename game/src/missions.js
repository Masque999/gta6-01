// missions.js — Solmar Bay: Leo Marsh's four story missions.
// Original code written for this project. No dependencies, no imports.
//
// The missions are data: each stage completes by walking or driving
// within its radius, by a doneWhen condition, by holding a spot, or
// by a countdown. updateMissions advances stages, pays the reward on
// the final stage, and fails a timed stage when its clock runs out.
//
// Interface assumptions (matching the sibling modules in this folder):
//  - Missions never import combat.js. The harbor ambush spawns gang
//    members through state.spawnEnemies when main.js wires it, and
//    otherwise through a small local spawner with the same shape
//    (health 50, weapon 'pistol', state 'chase').
//  - The pistol for missions 3 and 4 is handed out through
//    state.giveWeapon when wired, otherwise by setting
//    player.weapon / player.ammo directly.
//  - state.addWanted(state, n) is the police module's function; the
//    harbor fight sets the wanted level with a direct assignment
//    (wanted = 2) because the brief says "set wanted to 2".
//  - Dialogue is { speaker, text, until } with until = state.time +
//    seconds, the same shape vehicles.js and police.js use.
//  - state.saveGame(state) is the save module's function wired onto
//    state by main.js; it is called (guarded) on mission completion.
//  - state.audio methods are named sounds (audio.js); 'pickup' plays
//    on a completed mission, 'click' on a failed one.

export const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    briefing: 'Leo needs wheels. Steal any car, then drive to the parking garage.',
    reward: 200,
    stages: [
      {
        objective: 'Steal a car (walk up to one and press E)',
        target: null,
        radius: 0,
        doneWhen: (state) => state.player.inCar !== null,
      },
      {
        objective: 'Drive to the parking garage',
        target: { x: 600, y: 600 },
        radius: 90,
        reward: 200,
      },
    ],
  },
  {
    id: 'the-delivery',
    title: 'The Delivery',
    briefing: 'Pick up the package at the docks, then deliver it to the hotel before the timer runs out.',
    reward: 500,
    stages: [
      {
        objective: 'Pick up the package at the docks',
        target: { x: 2900, y: 2900 },
        radius: 90,
      },
      {
        objective: 'Deliver to the hotel (90s)',
        target: { x: 500, y: 2800 },
        radius: 90,
        timer: 90,
      },
    ],
  },
  {
    id: 'harbor-heat',
    title: 'Harbor Heat',
    briefing: 'The Vultures are waiting at the harbor. Deal with them, then lose the heat.',
    reward: 800,
    stages: [
      {
        objective: 'Go to the harbor',
        target: { x: 2900, y: 2900 },
        radius: 120,
        onArrive: (state) => {
          if (typeof state.spawnEnemies === 'function') {
            state.spawnEnemies(state, 2900, 2900, 4);
          } else {
            spawnGang(state, 2900, 2900, 4);
          }
        },
      },
      {
        objective: 'Defeat the Vultures',
        target: null,
        radius: 0,
        doneWhen: (state) => state.enemies.length === 0,
      },
      {
        objective: 'Lose the cops — get your wanted level to zero',
        target: null,
        radius: 0,
        doneWhen: (state) => state.wanted === 0,
      },
    ],
  },
  {
    id: 'the-big-score',
    title: 'The Big Score',
    briefing: 'Hit the bank, grab the cash, and get to the safehouse with the whole city after you.',
    reward: 2000,
    stages: [
      {
        objective: 'Get to the bank',
        target: { x: 1600, y: 1600 },
        radius: 100,
      },
      {
        objective: 'Grab the cash — stay by the vault 5s',
        target: { x: 1600, y: 1600 },
        radius: 100,
        hold: 5,
      },
      {
        objective: 'Escape to the safehouse',
        target: { x: 300, y: 300 },
        radius: 100,
      },
    ],
  },
];

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

function say(state, speaker, text, seconds) {
  state.dialogue = {
    speaker,
    text,
    until: (state.time || 0) + (seconds ?? 4),
  };
}

// Local gang spawner, used only when main.js has not wired
// state.spawnEnemies (combat.js's spawnEnemies). Same shape:
// health 50, pistol, state 'chase', scattered around the point.
function spawnGang(state, x, y, n) {
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
      speed: 150,
      _shootTimer: 0.5 + rng() * 1.0,
      _meleeTimer: 0,
    });
  }
  return state.enemies;
}

function handOutPistol(state) {
  const player = state.player;
  if (!player) return;
  if (typeof state.giveWeapon === 'function') {
    try {
      state.giveWeapon(state, 'pistol', 24);
      return;
    } catch {
      /* fall through to the direct set */
    }
  }
  player.weapon = 'pistol';
  player.ammo = 24;
}

function saveGame(state) {
  if (typeof state.saveGame === 'function') {
    try {
      state.saveGame(state);
    } catch {
      try {
        state.saveGame();
      } catch {
        /* saving is best-effort */
      }
    }
  }
}

function currentStage(mission) {
  if (!mission || !Array.isArray(mission.stages)) return null;
  return mission.stages[mission.stageIndex] || null;
}

function armStage(state, mission) {
  const stage = currentStage(mission);
  if (!stage) return;
  mission.stage = stage;
  mission.objective = stage.objective;
  mission.target = stage.target || null;
  mission.stageTimer = stage.timer != null ? stage.timer : null;
  mission.holdTime = 0;
}

function completeMission(state, mission) {
  const player = state.player;
  const reward = mission.reward || 0;
  if (player) player.money = (player.money || 0) + reward;
  if (!Array.isArray(state.missionsDone)) state.missionsDone = [];
  if (!state.missionsDone.includes(mission.id)) {
    state.missionsDone.push(mission.id);
  }
  state.mission = null;
  say(state, 'Leo', `Mission complete — $${reward} earned.`, 4);
  playSound(state, 'pickup');
  saveGame(state);
}

function failMission(state) {
  state.mission = null;
  say(state, 'Leo', 'Mission failed — drive back to the marker to retry.', 4);
  playSound(state, 'click');
}

function advanceStage(state, mission) {
  mission.stageIndex += 1;
  if (mission.stageIndex >= mission.stages.length) {
    completeMission(state, mission);
    return;
  }
  armStage(state, mission);
  say(state, 'Leo', `New objective: ${mission.objective}`, 3);
}

// ---------------------------------------------------------------- exports

export function startMission(state, id) {
  const def = MISSIONS.find((m) => m.id === id);
  if (!def || !state.player) return null;
  // Live copy: stage objects are copied so per-run timers never leak
  // into the definitions; doneWhen / onArrive stay shared functions.
  const mission = {
    id: def.id,
    title: def.title,
    reward: def.reward,
    stages: def.stages.map((s) => ({ ...s })),
    stageIndex: 0,
    stage: null,
    objective: '',
    target: null,
    stageTimer: null,
    holdTime: 0,
  };
  armStage(state, mission);
  state.mission = mission;
  say(state, 'Contact', def.briefing, 5);
  // Leo goes into the harbor fight and the bank job armed.
  if (id === 'harbor-heat' || id === 'the-big-score') {
    handOutPistol(state);
  }
  return mission;
}

export function updateMissions(state, dt) {
  const step = clamp(dt || 0, 0, 0.05);
  const mission = state.mission;
  const player = state.player;
  if (!mission || !player || step <= 0) return;
  const stage = currentStage(mission);
  if (!stage) {
    completeMission(state, mission);
    return;
  }

  // --- Stage completion, checked before the clock -------------------
  // 1. A condition, e.g. sitting in a car or clearing every enemy.
  if (typeof stage.doneWhen === 'function') {
    let done = false;
    try {
      done = !!stage.doneWhen(state);
    } catch {
      done = false;
    }
    if (done) {
      advanceStage(state, mission);
      return;
    }
  }

  // 2. Reaching the target, with an optional hold-to-finish.
  if (stage.target) {
    const d = dist(player.x, player.y, stage.target.x, stage.target.y);
    if (d <= (stage.radius || 60)) {
      if (stage.hold != null) {
        mission.holdTime = (mission.holdTime || 0) + step;
        if (mission.holdTime >= stage.hold) {
          if (typeof stage.onArrive === 'function') {
            try {
              stage.onArrive(state);
            } catch {
              /* a stage hook must not stall the mission */
            }
          }
          advanceStage(state, mission);
          return;
        }
      } else {
        if (typeof stage.onArrive === 'function') {
          try {
            stage.onArrive(state);
          } catch {
            /* a stage hook must not stall the mission */
          }
        }
        // The harbor ambush brings the heat with it.
        if (mission.id === 'harbor-heat' && mission.stageIndex === 0) {
          state.wanted = 2;
          state.wantedTimer = 0;
        }
        advanceStage(state, mission);
        return;
      }
    } else {
      mission.holdTime = 0;
    }
  }

  // --- Timed stage: the clock runs out only after arrival failed ----
  if (stage.timer != null) {
    if (mission.stageTimer == null) mission.stageTimer = stage.timer;
    mission.stageTimer -= step;
    if (mission.stageTimer <= 0) {
      failMission(state);
    }
  }
}

// The active mission's target for the minimap / HUD, or null when no
// mission is running.
export function missionMarker(state) {
  const target = state.mission && state.mission.target;
  if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
    return null;
  }
  return { x: target.x, y: target.y };
}
