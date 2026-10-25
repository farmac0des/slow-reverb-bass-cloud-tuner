// Popup: sliders write settings to storage; levels come from the page via runtime messages.
const $ = (id) => document.getElementById(id);
const fmt = { speed: (v) => Number(v).toFixed(2) + 'x', reverb: (v) => v + '%', bass: (v) => v + '%' };
const defaults = { speed: 1, reverb: 0, bass: 0 };
let settings = { ...defaults };
let bins = new Array(32).fill(0);
let shown = new Array(32).fill(0);
const root = document.documentElement.style;

// Speed colour: slowed = bordeaux, normal = orange, sped up = amber, blended continuously.
const C_SLOW = [122, 28, 58], C_NORM = [255, 85, 0], C_FAST = [255, 176, 0];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function targetAccent(speed) {
  const t = Math.max(-1, Math.min(1, (speed - 1) / 0.5));
  return t < 0 ? mix(C_NORM, C_SLOW, -t) : mix(C_NORM, C_FAST, t);
}
let accentNow = [...C_NORM];
let revNow = 0, bassNow = 0, bassPxNow = 0;

function render(key, value) {
  settings[key] = value;
  $(key + '-slider').value = value;
  $(key + '-value').textContent = fmt[key](value);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ae-level' && Array.isArray(msg.bins)) bins = msg.bins;
});

const canvas = $('viz');
const g = canvas.getContext('2d');

function frame(now) {
  // Bars: fast rise, slow fall.
  for (let i = 0; i < 32; i++) {
    const target = Math.min(1, bins[i]);
    shown[i] += (target - shown[i]) * (target > shown[i] ? 0.45 : 0.12);
  }

  // Accent colour eases toward the target speed colour.
  const aT = targetAccent(settings.speed);
  accentNow = accentNow.map((v, i) => v + (aT[i] - v) * 0.06);
  const rgb = accentNow.map(Math.round);
  const accent = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  root.setProperty('--accent', accent);

  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);

  // Bars
  const bw = W / 32;
  g.fillStyle = accent;
  g.shadowColor = accent;
  g.shadowBlur = 6;
  for (let i = 0; i < 32; i++) {
    const h = Math.max(2, shown[i] * H * 0.9);
    g.fillRect(i * bw + 1, H - h, bw - 2, h);
  }
  g.shadowBlur = 0;

  // Faint wave along the bottom; amplitude follows the bass.
  const bass = (shown[0] + shown[1] + shown[2] + shown[3]) / 4;
  const amp = 1.5 + bassNow * 6;
  g.beginPath();
  for (let x = 0; x <= W; x += 4) {
    const y = H - 2 + Math.sin(x * 0.06 + now * 0.004) * amp * 0.5;
    x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.strokeStyle = accent;
  g.globalAlpha = 0.6;
  g.lineWidth = 1.5;
  g.stroke();
  g.globalAlpha = 1;

  // Glows, eased so nothing jumps.
  const mid = shown.slice(8, 17).reduce((a, b) => a + b, 0) / 9;
  bassNow += ((bass * settings.bass / 100) - bassNow) * 0.15;
  root.setProperty('--bass-h', (bassNow * 100).toFixed(1) + '%');

  const revTarget = settings.reverb / 100 * 0.35 * (0.35 + 0.65 * mid);
  revNow += (revTarget - revNow) * 0.1;
  root.setProperty('--rev', revNow.toFixed(3));

  const pxTarget = settings.bass / 100 * 3;
  bassPxNow += (pxTarget - bassPxNow) * 0.1;
  root.setProperty('--bass-px', bassPxNow.toFixed(2) + 'px');

  requestAnimationFrame(frame);
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(Object.keys(defaults), (result) => {
    for (const key of Object.keys(defaults)) {
      render(key, result[key] !== undefined ? result[key] : defaults[key]);
    }
  });

  for (const key of Object.keys(defaults)) {
    $(key + '-slider').addEventListener('input', (e) => {
      const value = key === 'speed' ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
      render(key, value);
      chrome.storage.local.set({ [key]: value });
    });
  }

  $('reset-btn').addEventListener('click', () => {
    for (const key of Object.keys(defaults)) render(key, defaults[key]);
    chrome.storage.local.set(defaults);
  });

  requestAnimationFrame(frame);
});
