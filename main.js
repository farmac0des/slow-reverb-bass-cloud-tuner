// Page (MAIN) world: applies speed, routes Web Audio through reverb/echo/bass, and reports levels.
(function () {
  if (window.__aeInstalled) return;
  window.__aeInstalled = true;

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.AudioNode || !window.HTMLMediaElement) return;

  const state = { speed: 1, reverb: 0, bass: 0 };
  const chains = new WeakMap();
  const chainList = new Set();
  const mediaEls = new Set();

  function makeRoomIR(ctx) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * 2.4);
    const ir = ctx.createBuffer(2, len, rate);
    const pre = Math.floor(rate * 0.02);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / rate;
        const env = Math.exp(-3.45 * t);
        const coef = Math.max(0.02, 0.6 - t * 0.25);
        lp += ((Math.random() * 2 - 1) - lp) * coef;
        d[i] = lp * env;
      }
      [0.011, 0.023, 0.037, 0.051].forEach((s, k) => {
        const idx = Math.floor((s + c * 0.003) * rate);
        if (idx < len) d[idx] += (k % 2 ? -0.6 : 0.8) * Math.pow(0.8, k);
      });
    }
    return ir;
  }

  const origConnect = AudioNode.prototype.connect;
  const o = (a, b) => origConnect.call(a, b);

  function getChain(ctx) {
    let ch = chains.get(ctx);
    if (ch) return ch;

    const input = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = makeRoomIR(ctx);

    const echoIn = ctx.createGain();
    const echoDelay = ctx.createDelay(1.0);
    echoDelay.delayTime.value = 0.32;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 3000;
    const echoFb = ctx.createGain();
    echoFb.gain.value = 0.35;
    const echoOut = ctx.createGain();

    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 150;
    const limiter = ctx.createDynamicsCompressor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;

    o(input, dry);
    o(input, convolver);
    o(convolver, wet);
    o(input, echoIn);
    o(echoIn, echoDelay);
    o(echoDelay, echoTone);
    o(echoTone, echoFb);
    o(echoFb, echoDelay);
    o(echoTone, echoOut);
    o(dry, bass);
    o(wet, bass);
    o(echoOut, bass);
    o(bass, limiter);
    o(limiter, analyser);
    origConnect.call(analyser, ctx.destination);

    ch = { ctx, input, dry, wet, echoOut, bass, analyser };
    chains.set(ctx, ch);
    chainList.add(ch);
    applyToChain(ch);
    return ch;
  }

  function applyToChain(ch) {
    const t = ch.ctx.currentTime;
    const amt = state.reverb / 100;
    ch.dry.gain.setTargetAtTime(1, t, 0.05);
    ch.wet.gain.setTargetAtTime(amt * 0.9, t, 0.05);
    ch.echoOut.gain.setTargetAtTime(amt * 0.45, t, 0.05);
    ch.bass.gain.setTargetAtTime((state.bass / 100) * 12, t, 0.05);
  }

  AudioNode.prototype.connect = function (dest, ...rest) {
    if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
      const ch = getChain(dest.context);
      return origConnect.call(this, ch.input, ...rest);
    }
    if (typeof MediaElementAudioSourceNode !== 'undefined' && this instanceof MediaElementAudioSourceNode) {
      track(this.mediaElement);
    }
    return origConnect.call(this, dest, ...rest);
  };

  function applySpeed(el) {
    if (!el) return;
    if (Math.abs(el.playbackRate - state.speed) > 0.001) {
      el.preservesPitch = false;
      el.playbackRate = state.speed;
    }
  }

  function track(el) {
    if (el instanceof HTMLMediaElement) {
      mediaEls.add(el);
      applySpeed(el);
    }
  }

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    track(this);
    return origPlay.apply(this, args);
  };

  ['play', 'playing', 'loadedmetadata', 'ratechange'].forEach((type) => {
    document.addEventListener(type, (e) => track(e.target), true);
  });

  setInterval(() => mediaEls.forEach(applySpeed), 250);

  // Live levels: 32 log-spaced bands, 0..1, sent to the extension about 20 times a second.
  // Float dB data is used (byte data hides quiet highs). Highs get a small tilt boost
  // because music energy above ~12 kHz is naturally much lower.
  const floatBuf = new Float32Array(512);
  setInterval(() => {
    if (!chainList.size) return;
    const bins = new Array(32).fill(0);
    chainList.forEach((ch) => {
      ch.analyser.getFloatFrequencyData(floatBuf);
      for (let i = 0; i < 32; i++) {
        const lo = Math.floor(Math.pow(512, i / 32));
        const hi = Math.max(lo + 1, Math.floor(Math.pow(512, (i + 1) / 32)));
        let m = -200;
        for (let k = lo; k < hi && k < 512; k++) if (floatBuf[k] > m) m = floatBuf[k];
        const tilt = 1 + (i / 31) * 0.9;
        const v = Math.min(1, Math.max(0, (m + 100) / 75) * tilt);
        if (v > bins[i]) bins[i] = v;
      }
    });
    window.postMessage({ source: 'ae-level', bins: bins.map((v) => Math.round(v * 1000) / 1000) }, '*');
  }, 50);

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'ae-bridge') return;
    const s = e.data.settings || {};
    if (typeof s.speed === 'number') state.speed = s.speed;
    if (typeof s.reverb === 'number') state.reverb = s.reverb;
    if (typeof s.bass === 'number') state.bass = s.bass;
    mediaEls.forEach(applySpeed);
    chainList.forEach(applyToChain);
  });
})();
