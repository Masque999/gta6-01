// input.js — Keyboard + mouse input for Solmar Bay.
// Original code written for this project. No dependencies.
//
// Usage:
//   const input = createInput(canvas);
//   // every fixed step:
//   const v = input.axes();          // { x, y } normalised movement vector
//   const actions = input.takeActions(); // bitmask, consumed on read
//   if (actions & ACTION_PAUSE) { ... }
//
// Action bits are edge-triggered: a bit is set when the key is first
// pressed down and cleared once takeActions() has read it, so holding a
// key does not re-trigger pause / enter-car / mute every frame.

export const ACTION_CONFIRM = 1 << 0; // Space / Enter
export const ACTION_PAUSE = 1 << 1; // P / Escape
export const ACTION_ENTER = 1 << 2; // E (enter / exit car)
export const ACTION_MELEE = 1 << 3; // F
export const ACTION_MUTE = 1 << 4; // M

const CONFIRM_KEYS = new Set(['Space', 'Enter']);
const PAUSE_KEYS = new Set(['KeyP', 'Escape']);
const ENTER_KEYS = new Set(['KeyE']);
const MELEE_KEYS = new Set(['KeyF']);
const MUTE_KEYS = new Set(['KeyM']);

// Keys whose browser default behaviour (page scroll on arrows/space)
// must be suppressed while the game has focus.
const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

const MOVE_KEYS = {
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

/**
 * Attach keyboard/mouse listeners and return the input state object.
 * @param {HTMLCanvasElement} canvas - the game canvas (mouse target)
 */
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered presses since last takeActions()
  const mouse = { x: 0, y: 0, down: false, clicked: false };

  function actionBitFor(code) {
    if (CONFIRM_KEYS.has(code)) return ACTION_CONFIRM;
    if (PAUSE_KEYS.has(code)) return ACTION_PAUSE;
    if (ENTER_KEYS.has(code)) return ACTION_ENTER;
    if (MELEE_KEYS.has(code)) return ACTION_MELEE;
    if (MUTE_KEYS.has(code)) return ACTION_MUTE;
    return 0;
  }

  function onKeyDown(event) {
    if (PREVENT_DEFAULT_KEYS.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    keys.add(event.code);
    const bit = actionBitFor(event.code);
    if (bit) pressed.add(bit);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onBlur() {
    // Don't leave a key stuck down when the window loses focus.
    keys.clear();
    mouse.down = false;
  }

  function updateMousePosition(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  }

  function onMouseMove(event) {
    updateMousePosition(event);
  }

  function onMouseDown(event) {
    updateMousePosition(event);
    mouse.down = true;
    mouse.clicked = true; // latched until takeActions() consumes it
  }

  function onMouseUp(event) {
    updateMousePosition(event);
    mouse.down = false;
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);

  function axes() {
    let x = 0;
    let y = 0;
    for (const code of keys) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir.x;
        y += dir.y;
      }
    }
    if (x !== 0 || y !== 0) {
      const len = Math.hypot(x, y);
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  function takeActions() {
    let mask = 0;
    for (const bit of pressed) mask |= bit;
    pressed.clear();
    // A mouse click also counts as CONFIRM (e.g. clicking Start).
    // Consume the latched click here so one click fires exactly once.
    if (mouse.clicked) {
      mask |= ACTION_CONFIRM;
      mouse.clicked = false;
    }
    return mask;
  }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
  }

  return {
    keys,
    mouse,
    axes,
    takeActions,
    destroy,
    // Bit constants, handy for callers that only hold the input object.
    CONFIRM: ACTION_CONFIRM,
    PAUSE: ACTION_PAUSE,
    ENTER: ACTION_ENTER,
    MELEE: ACTION_MELEE,
    MUTE: ACTION_MUTE,
  };
}
