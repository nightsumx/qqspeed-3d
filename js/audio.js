export function createAudio() {
  let ctx = null, master, engine, engine2, engGain, squeal, squealGain, boostGain, boostSrc, bgmGain, muted = false, bgmTimer = 0;

  const noiseBuffer = () => {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  };

  const init = () => {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);

    engGain = ctx.createGain();
    engGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    engGain.connect(lp).connect(master);
    engine = ctx.createOscillator();
    engine.type = 'sawtooth';
    engine2 = ctx.createOscillator();
    engine2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    engine.connect(engGain);
    engine2.connect(g2).connect(engGain);
    engine.start();
    engine2.start();

    const nb = noiseBuffer();
    squeal = ctx.createBufferSource();
    squeal.buffer = nb;
    squeal.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 6;
    squealGain = ctx.createGain();
    squealGain.gain.value = 0;
    squeal.connect(bp).connect(squealGain).connect(master);
    squeal.start();

    boostSrc = ctx.createBufferSource();
    boostSrc.buffer = nb;
    boostSrc.loop = true;
    const blp = ctx.createBiquadFilter();
    blp.type = 'lowpass';
    blp.frequency.value = 700;
    boostGain = ctx.createGain();
    boostGain.gain.value = 0;
    boostSrc.connect(blp).connect(boostGain).connect(master);
    boostSrc.start();

    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.12;
    bgmGain.connect(master);
  };

  const tone = (freq, dur, type = 'square', vol = 0.3, when = 0, dest = master) => {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  // C major pop loop: bass + arpeggio
  const prog = [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let bar = 0;
  const bgmStep = () => {
    if (!ctx) return;
    const chord = prog[bar % 4];
    const beat = 0.2;
    tone(mtof(chord[0] - 12), beat * 7.5, 'triangle', 0.5, 0, bgmGain);
    for (let k = 0; k < 16; k++) {
      const n = chord[[0, 1, 2, 3, 2, 1, 3, 2][k % 8]] + (k >= 8 ? 12 : 0);
      tone(mtof(n), beat * 0.9, 'square', 0.12, k * beat * 0.5, bgmGain);
    }
    for (let k = 0; k < 8; k++) {
      if (k % 2 === 0) tone(60, 0.12, 'sine', 0.6, k * beat, bgmGain);
      else tone(8000, 0.03, 'square', 0.05, k * beat, bgmGain);
    }
    bar++;
  };

  return {
    init,
    get ready() { return !!ctx; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.6;
      return muted;
    },
    startBgm() {
      if (!ctx || bgmTimer) return;
      bgmStep();
      bgmTimer = setInterval(bgmStep, 1600);
    },
    stopBgm() { clearInterval(bgmTimer); bgmTimer = 0; },
    update(speed, throttle, drifting, boosting) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const rpm = 60 + Math.abs(speed) * 3.2 + (throttle ? 20 : 0);
      engine.frequency.setTargetAtTime(rpm, t, 0.05);
      engine2.frequency.setTargetAtTime(rpm * 0.5, t, 0.05);
      engGain.gain.setTargetAtTime(0.08 + (throttle ? 0.08 : 0.03), t, 0.1);
      squealGain.gain.setTargetAtTime(drifting ? 0.12 : 0, t, 0.05);
      boostGain.gain.setTargetAtTime(boosting ? 0.4 : 0, t, 0.08);
    },
    beep(high) { tone(high ? 1320 : 660, high ? 0.6 : 0.25, 'square', 0.25); },
    boost() { tone(220, 0.35, 'sawtooth', 0.25); tone(440, 0.3, 'sawtooth', 0.2, 0.05); },
    ding() { tone(1568, 0.15, 'triangle', 0.3); tone(2093, 0.25, 'triangle', 0.3, 0.08); },
    crash() { tone(90, 0.25, 'sawtooth', 0.4); },
    fanfare() { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.4, 'triangle', 0.3, k * 0.15)); },
  };
}
