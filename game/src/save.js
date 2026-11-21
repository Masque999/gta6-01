// save.js — Solmar Bay save/load.
// Single localStorage key, plain JSON. Never throws: if storage is
// unavailable (private mode, blocked, quota) every function fails soft.

export const SAVE_KEY = 'solmar-save-v1';

export function saveGame(state) {
  try {
    if (typeof localStorage === 'undefined' || !state) return false;
    const player = state.player || {};
    const payload = {
      money: Number(player.money ?? state.money ?? 0) || 0,
      missionsDone: Array.isArray(state.missionsDone) ? [...state.missionsDone] : [],
      playerX: Number(player.x ?? 0) || 0,
      playerY: Number(player.y ?? 0) || 0,
      // Saved runs always start clean: the player reloads with no heat.
      wanted: 0,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      money: Number(parsed.money) || 0,
      missionsDone: Array.isArray(parsed.missionsDone) ? parsed.missionsDone : [],
      playerX: Number(parsed.playerX) || 0,
      playerY: Number(parsed.playerY) || 0,
      wanted: 0,
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
