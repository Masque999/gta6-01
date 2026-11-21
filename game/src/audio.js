// audio.js — Solmar Bay synthesized sound.
// Every sound is built from oscillators and noise buffers created in code.
// No audio files, no network. All calls before unlock() are safe no-ops.

const MASTER_VOLUME = 0.9;
const MUSIC_VOLUME = 0.12;

// Original bassline pattern (A-minor flavour), one bar of eighth notes.
// Frequencies in Hz; 0 means rest.
const BASS_PATTERN = [55, 0, 55, 65.41, 0, 55, 49, 61.74];
const BASS_STEP_SECONDS = 0.24; // ~125 bpm eighth notes

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let sirenNodes = null;
  let engineNodes = null;
  let musicTimer = null;
  let musicStep = 0;
  let nextMusicTime = 0;

  const api = {
    muted: false,
    unlock,
    setMuted,
    shoot,
    hit,
    pickup,
    explosion,
    click,
    siren,
    engine,
    startMusic,
    update,
  };
  return api;

  // --- lifecycle -----------------------------------------------------------

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const AudioContextClass =
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext);
    if (!AudioContextClass) return;
    try {
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = api.muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);
      // One shared 1-second white-noise buffer, reused by every noise sound.
      const length = ctx.sampleRate;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {
      ctx = null;
      master = null;
    }
  }

  function setMuted(m) {
    api.muted = !!m;
    if (master && ctx) {
      master.gain.setTargetAtTime(api.muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
    }
  }

  // --- small builders ------------------------------------------------------

  function tone({ type = 'sine', from = 440, to = null, duration = 0.15, volume = 0.2, when = 0 }) {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, from), t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function noise({ duration = 0.2, volume = 0.3, filterType = 'lowpass', filterFrom = 3000, filterTo = null, when = 0 }) {
    if (!ctx || !master || !noiseBuffer) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrom, t0);
    if (filterTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(10, filterTo), t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  // --- one-shot effects ----------------------------------------------------

  function shoot() {
    if (!ctx) return;
    // Sharp crack: short noise burst plus a fast falling square blip.
    noise({ duration: 0.09, volume: 0.35, filterType: 'highpass', filterFrom: 1200 });
    tone({ type: 'square', from: 880, to: 180, duration: 0.08, volume: 0.12 });
  }

  function hit() {
    if (!ctx) return;
    // Dull thud when a shot (or fist) lands.
    tone({ type: 'sine', from: 170, to: 55, duration: 0.13, volume: 0.3 });
    noise({ duration: 0.07, volume: 0.15, filterFrom: 500 });
  }

  function pickup() {
    if (!ctx) return;
    // Two rising blips, like coins / cash collected.
    tone({ type: 'sine', from: 660, duration: 0.07, volume: 0.18 });
    tone({ type: 'sine', from: 990, duration: 0.1, volume: 0.18, when: 0.07 });
  }

  function explosion() {
    if (!ctx) return;
    // Long low rumble: filtered noise sweeping down plus a deep sine drop.
    noise({ duration: 0.7, volume: 0.5, filterFrom: 2400, filterTo: 120 });
    tone({ type: 'sine', from: 130, to: 28, duration: 0.65, volume: 0.45 });
    noise({ duration: 0.25, volume: 0.25, filterType: 'highpass', filterFrom: 2000, when: 0.02 });
  }

  function click() {
    if (!ctx) return;
    tone({ type: 'square', from: 1250, duration: 0.035, volume: 0.08 });
  }

  // --- looping sounds ------------------------------------------------------

  function siren(on) {
    if (!ctx) return;
    if (on) {
      if (sirenNodes) return;
      const toneOsc = ctx.createOscillator();
      toneOsc.type = 'triangle';
      toneOsc.frequency.value = 800;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 0.55; // flips between the two tones ~every 0.9s
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 160; // 800 +/- 160 Hz
      lfo.connect(lfoGain);
      lfoGain.connect(toneOsc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0.045; // quiet: sirens must not drown the game
      toneOsc.connect(gain);
      gain.connect(master);
      toneOsc.start();
      lfo.start();
      sirenNodes = { toneOsc, lfo, gain };
    } else if (sirenNodes) {
      const { toneOsc, lfo, gain } = sirenNodes;
      sirenNodes = null;
      try {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        toneOsc.stop(ctx.currentTime + 0.3);
        lfo.stop(ctx.currentTime + 0.3);
      } catch {
        // Already stopped; nothing to clean up.
      }
    }
  }

  function engine(speed01) {
    if (!ctx) return;
    const speed = Math.max(0, Math.min(1, Number(speed01) || 0));
    if (speed <= 0.02) {
      if (engineNodes) {
        const { osc, gain } = engineNodes;
        engineNodes = null;
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
          osc.stop(ctx.currentTime + 0.4);
        } catch {
          // Already stopped.
        }
      }
      return;
    }
    if (!engineNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start();
      engineNodes = { osc, filter, gain };
    }
    const t = ctx.currentTime;
    engineNodes.osc.frequency.setTargetAtTime(55 + speed * 95, t, 0.08);
    engineNodes.filter.frequency.setTargetAtTime(300 + speed * 900, t, 0.08);
    engineNodes.gain.gain.setTargetAtTime(0.02 + speed * 0.055, t, 0.08);
  }

  // --- music ---------------------------------------------------------------

  function startMusic() {
    if (!ctx || musicTimer !== null) return;
    musicStep = 0;
    nextMusicTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(() => {
      if (!ctx) return;
      // Schedule a little ahead so timing stays steady if the tab stutters.
      while (nextMusicTime < ctx.currentTime + 0.35) {
        scheduleMusicStep(nextMusicTime);
        musicStep += 1;
        nextMusicTime += BASS_STEP_SECONDS;
      }
    }, 120);
  }

  function scheduleMusicStep(when) {
    if (!ctx || !master) return;
    const delay = Math.max(0, when - ctx.currentTime);
    const bass = BASS_PATTERN[musicStep % BASS_PATTERN.length];
    if (bass > 0) {
      // Soft triangle bass note, kept deliberately quiet.
      tone({ type: 'triangle', from: bass, duration: BASS_STEP_SECONDS * 0.95, volume: MUSIC_VOLUME, when: delay });
    }
    // Hats: a faint high noise tick on every off-beat step.
    if (musicStep % 2 === 1) {
      noise({ duration: 0.03, volume: 0.018, filterType: 'highpass', filterFrom: 6000, when: delay });
    }
  }

  // --- per-frame driver ----------------------------------------------------

  function update(state) {
    if (!ctx || !state) return;
    const wanted = Number(state.wanted) || 0;
    siren(wanted >= 1);

    const player = state.player || {};
    let speed01 = 0;
    if (player.inCar != null) {
      const car = Array.isArray(state.cars)
        ? state.cars.find((c) => c && c.id === player.inCar)
        : null;
      const rawSpeed = Math.abs((car && car.speed) ?? player.speed ?? 0);
      // Car speed is in world units/second; ~340 is a fast cruise.
      speed01 = Math.max(0, Math.min(1, rawSpeed / 340));
    }
    engine(speed01);
  }
}
