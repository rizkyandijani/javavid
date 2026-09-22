const state = {
  id: null,
  meta: null,
  fileName: '',
  thumbFiles: [],
  start: 0,
  end: 0,
  scrub: 0,
  fps: 15,
  fpsCustom: null,
  resMode: 'original',
  resW: 0,
  resH: 0,
  mode: 'high',
  dither: true,
  loop: 0,
  loopCustom: null,
  resLock: true,
  saveFolder: '',
  lastFile: '',
  lastURL: '',
  previewing: false,
  playLoop: false,
  est: null,
  cropOn: false,
  crop: null,
  cropAR: 0,
  fit: 'fill',
};

let estTimer = 0;

function normDim(n) {
  if (n < 1) return 0;
  return n % 2 ? n - 1 : n;
}

function effDims() {
  if (!state.meta) return { w: 0, h: 0 };
  const src = cropSourceDims();
  let w, h;
  if (state.resMode === 'original' || (!state.resW && !state.resH)) {
    w = src.w;
    h = src.h;
  } else if (state.resMode === 'custom') {
    w = state.resW || src.w;
    h = state.resH || src.h;
  } else {
    w = state.resW;
    h = state.resH;
  }
  return { w: normDim(w), h: normDim(h) };
}

function cropSourceDims() {
  const c = toSourceCrop();
  if (c) return { w: c.W, h: c.H };
  if (!state.meta) return { w: 0, h: 0 };
  return { w: state.meta.width, h: state.meta.height };
}

function toSourceCrop() {
  if (!state.cropOn || !state.crop || !state.meta) return null;
  const sw = state.meta.width, sh = state.meta.height;
  let X = Math.round(state.crop.x * sw);
  let Y = Math.round(state.crop.y * sh);
  let W = Math.round(state.crop.w * sw);
  let H = Math.round(state.crop.h * sh);
  X = Math.max(0, Math.min(X, sw - 1));
  Y = Math.max(0, Math.min(Y, sh - 1));
  W = Math.max(1, Math.min(W, sw - X));
  H = Math.max(1, Math.min(H, sh - Y));
  if (X === 0 && Y === 0 && W === sw && H === sh) return null;
  return { X, Y, W, H };
}

function updateCropUI() {
  if (!state.crop) return;
  els.cropBox.style.left = (state.crop.x * 100) + '%';
  els.cropBox.style.top = (state.crop.y * 100) + '%';
  els.cropBox.style.width = (state.crop.w * 100) + '%';
  els.cropBox.style.height = (state.crop.h * 100) + '%';
}

function fitARBox(ar) {
  let w = 1, h = 1 / ar;
  if (h > 1) { h = 1; w = ar; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

function layerPos(ev) {
  const r = els.cropLayer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)),
  };
}

function clampCrop(b) {
  const minS = 0.04;
  b.w = Math.max(minS, Math.min(1, b.w));
  b.h = Math.max(minS, Math.min(1, b.h));
  b.x = Math.max(0, Math.min(1 - b.w, b.x));
  b.y = Math.max(0, Math.min(1 - b.h, b.y));
  return b;
}

function resizeCrop(box, handle, px, py, ar) {
  const west = handle.includes('w'), north = handle.includes('n');
  const ax = west ? box.x + box.w : box.x;
  const ay = north ? box.y + box.h : box.y;
  let w = Math.abs(px - ax);
  let h = Math.abs(py - ay);
  if (ar > 0) {
    if (w / Math.max(h, 1e-6) > ar) w = h * ar; else h = w / ar;
    const maxW = west ? ax : 1 - ax;
    const maxH = north ? ay : 1 - ay;
    if (w > maxW) { w = maxW; h = w / ar; }
    if (h > maxH) { h = maxH; w = h * ar; }
  }
  w = Math.min(w, west ? ax : 1 - ax);
  h = Math.min(h, north ? ay : 1 - ay);
  const b = { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
  return clampCrop(b);
}

function bindCrop() {
  let drag = null;

  els.cropToggle.addEventListener('change', () => {
    state.cropOn = els.cropToggle.checked;
    els.cropLayer.classList.toggle('hidden', !state.cropOn);
    els.cropPresets.classList.toggle('hidden', !state.cropOn);
    if (state.cropOn && !state.crop) {
      state.crop = { x: 0, y: 0, w: 1, h: 1 };
      if (state.cropAR > 0) state.crop = fitARBox(state.cropAR);
      updateCropUI();
    }
    updateResSummary();
    scheduleEstimate();
  });

  els.cropPresets.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    markActive(els.cropPresets, b);
    const v = b.dataset.v;
    state.cropAR = v === 'free' ? 0 : v.split(':')[0] / v.split(':')[1];
    if (state.cropAR > 0) state.crop = fitARBox(state.cropAR);
    updateCropUI();
    updateResSummary();
    scheduleEstimate();
  });

  els.cropLayer.addEventListener('pointerdown', (ev) => {
    if (!state.meta) return;
    ev.preventDefault();
    els.cropLayer.setPointerCapture(ev.pointerId);
    const p = layerPos(ev);
    const h = ev.target.dataset && ev.target.dataset.h;
    if (h) {
      drag = { kind: 'resize', handle: h, box: { ...state.crop } };
    } else if (state.crop &&
      p.x >= state.crop.x && p.x <= state.crop.x + state.crop.w &&
      p.y >= state.crop.y && p.y <= state.crop.y + state.crop.h) {
      drag = { kind: 'move', dx: p.x - state.crop.x, dy: p.y - state.crop.y };
    } else {
      drag = { kind: 'create', ax: p.x, ay: p.y };
      state.crop = { x: p.x, y: p.y, w: 0, h: 0 };
    }
  });

  els.cropLayer.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = layerPos(ev);
    if (drag.kind === 'move') {
      state.crop = clampCrop({ ...state.crop, x: p.x - drag.dx, y: p.y - drag.dy });
    } else if (drag.kind === 'resize') {
      state.crop = resizeCrop(drag.box, drag.handle, p.x, p.y, state.cropAR);
    } else {
      const dir = (p.x < drag.ax ? 'w' : 'e') + (p.y < drag.ay ? 'n' : 's');
      state.crop = resizeCrop({ x: drag.ax, y: drag.ay, w: 0, h: 0 }, dir, p.x, p.y, state.cropAR);
    }
    updateCropUI();
    updateResSummary();
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    if (state.crop && (state.crop.w < 0.04 || state.crop.h < 0.04)) {
      state.crop = { x: 0, y: 0, w: 1, h: 1 };
      updateCropUI();
    }
    updateResSummary();
    scheduleEstimate();
  };
  els.cropLayer.addEventListener('pointerup', endDrag);
  els.cropLayer.addEventListener('pointercancel', endDrag);
}

function formatBytes(n) {
  if (!isFinite(n) || n < 0) return '—';
  if (n < 1024) return Math.round(n) + ' B';
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return v.toFixed(1) + ' ' + units[u];
}

function estKey() {
  const { w, h } = effDims();
  const c = toSourceCrop();
  const cs = c ? `${c.X},${c.Y},${c.W},${c.H}` : '';
  return [state.id, state.fps, w, h, state.mode, els.dither.checked, cs, state.fit].join('|');
}

function scheduleEstimate() {
  if (!state.meta) return;
  clearTimeout(estTimer);
  renderEstimate();
  const k = estKey();
  if (!state.est || state.est.key !== k) {
    estTimer = setTimeout(requestEstimate, 450);
  }
}

async function requestEstimate() {
  const k = estKey();
  const { w, h } = effDims();
  try {
    const r = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.id, fps: state.fps, width: w, height: h, mode: state.mode, dither: els.dither.checked, crop: toSourceCrop(), fit: state.fit }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'estimate failed');
    state.est = { key: k, b1: j.bytes1, b2: j.bytes2 };
  } catch (e) {
    state.est = { key: k, error: true };
  }
  if (estKey() === k) renderEstimate();
}

function renderEstimate() {
  if (!state.meta) {
    els.sizeEst.textContent = '—';
    els.sizeEst.classList.remove('warn');
    return;
  }
  const e = state.est;
  if (!e || e.key !== estKey() || e.error || !(e.b1 > 0)) {
    els.sizeEst.textContent = e && !e.error ? 'estimating…' : '—';
    els.sizeEst.classList.remove('warn');
    return;
  }
  const frames = Math.max(1, Math.ceil((state.end - state.start) * state.fps));
  // 0.8 because two adjacent frames understate savings compounded over a full clip (calibrated).
  const ratio = Math.min(1, Math.max(0.4, 0.8 * e.b2 / (2 * e.b1)));
  const bytes = e.b1 * frames * ratio;
  els.sizeEst.textContent = '≈ ' + formatBytes(bytes);
  els.sizeEst.classList.toggle('warn', bytes >= 10 * 1024 * 1024);
}

const $ = (id) => document.getElementById(id);

const els = {
  health: $('health'),
  drop: $('drop'),
  file: $('file'),
  source: $('source'),
  video: $('video'),
  meta: $('meta'),
  thumbs: $('thumbs'),
  track: $('track'),
  range: $('range'),
  startRange: $('start'),
  endRange: $('end'),
  scrub: $('scrub'),
  tStart: $('t-start'),
  tScrub: $('t-scrub'),
  tEnd: $('t-end'),
  preview: $('preview'),
  selDur: $('sel-dur'),
  sizeEst: $('size-est'),
  cropBar: $('crop-bar'),
  cropToggle: $('crop-toggle'),
  cropLayer: $('crop-layer'),
  cropBox: $('crop-box'),
  cropPresets: $('crop-presets'),
  fit: $('fit'),
  controls: $('controls'),
  convert: $('convert'),
  progress: $('progress'),
  progressBar: $('progress-bar'),
  progressText: $('progress-text'),
  result: $('result'),
  resultImg: $('result-img'),
  download: $('download'),
  saveFolder: $('save-folder'),
  savePathInfo: $('save-path-info'),
  errors: $('errors'),
  errorList: $('error-list'),
  fpsPresets: $('fps-presets'),
  fpsCustom: $('fps-custom'),
  fpsCustomRow: $('fps-custom-row'),
  resPresets: $('res-presets'),
  resW: $('res-w'),
  resH: $('res-h'),
  resLock: $('res-lock'),
  resCustomRow: $('res-custom-row'),
  resSummary: $('res-summary'),
  mode: $('mode'),
  dither: $('dither'),
  ditherRow: $('dither-row'),
  loop: $('loop'),
  loopCustom: $('loop-custom'),
  loopCustomRow: $('loop-custom-row'),
  saveDialog: $('save-dialog'),
  pickFolder: $('pick-folder'),
  folderInput: $('folder-input'),
  saveOk: $('save-ok'),
};

async function init() {
  try {
    const r = await fetch('/api/health');
    const j = await r.json();
    if (!j.hasFfmpeg) {
      els.health.textContent = 'ffmpeg: not found';
      els.health.style.color = 'var(--danger)';
      showError('ffmpeg not found. Place a static ffmpeg binary next to javavid or install it on PATH.');
      els.convert.disabled = true;
    } else {
      els.health.textContent = 'ffmpeg ready';
      els.health.style.color = 'var(--good)';
    }
  } catch (e) {
    els.health.textContent = 'server unreachable';
    els.health.style.color = 'var(--danger)';
  }

  bindDrop();
  bindTimeline();
  bindCrop();
  bindControls();
  bindConvert();
  bindResult();
}

function showError(msg) {
  els.errors.classList.remove('hidden');
  const li = document.createElement('li');
  li.textContent = msg;
  els.errorList.appendChild(li);
}

function bindDrop() {
  els.drop.addEventListener('click', (e) => {
    if (e.target.tagName !== 'LABEL' && e.target.tagName !== 'INPUT') {
      els.file.click();
    }
  });
  els.file.addEventListener('change', () => {
    if (els.file.files && els.file.files[0]) {
      uploadFile(els.file.files[0]);
    }
  });
  ['dragenter', 'dragover'].forEach(evt =>
    els.drop.addEventListener(evt, (e) => { e.preventDefault(); els.drop.classList.add('over'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    els.drop.addEventListener(evt, (e) => { e.preventDefault(); els.drop.classList.remove('over'); })
  );
  els.drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) uploadFile(f);
  });
}

async function uploadFile(file) {
  els.errorList.innerHTML = '';
  els.errors.classList.add('hidden');
  els.health.textContent = 'uploading...';
  els.health.style.color = 'var(--muted)';

  const fd = new FormData();
  fd.append('file', file);
  let res, j;
  try {
    res = await fetch('/api/upload', { method: 'POST', body: fd });
    j = await res.json();
  } catch (e) {
    showError('upload failed: ' + e.message);
    els.health.textContent = 'upload failed';
    els.health.style.color = 'var(--danger)';
    return;
  }
  if (!res.ok) {
    showError(j.error || 'upload failed');
    els.health.textContent = 'upload failed';
    els.health.style.color = 'var(--danger)';
    return;
  }

  state.id = j.id;
  state.meta = j;
  state.fileName = file.name;
  state.start = 0;
  state.end = j.duration;
  state.scrub = 0;
  state.thumbFiles = [];
  state.lastFile = '';
  state.lastURL = '';

  els.video.src = URL.createObjectURL(file);
  els.video.style.aspectRatio = j.width + ' / ' + j.height;
  els.video.removeAttribute('poster');
  state.previewing = false;
  state.playLoop = false;
  setPreviewUI();
  state.cropOn = false;
  state.crop = null;
  els.cropToggle.checked = false;
  els.cropLayer.classList.add('hidden');
  els.cropPresets.classList.add('hidden');
  els.cropBar.classList.remove('hidden');
  els.meta.innerHTML =
    `<div><strong>${j.duration.toFixed(2)}s</strong> &middot; ${j.width}&times;${j.height} &middot; ${j.fps.toFixed(2)} fps &middot; ${j.codec}</div>` +
    `<div class="muted small">${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)</div>`;

  els.source.classList.remove('hidden');
  els.controls.classList.remove('hidden');
  els.startRange.max = j.duration;
  els.endRange.max = j.duration;
  els.startRange.value = 0;
  els.endRange.value = j.duration;
  updateTimeline();
  updateResSummary();
  state.est = null;
  scheduleEstimate();
  els.health.textContent = 'ready';

  loadThumbnails();
}

async function loadThumbnails() {
  els.thumbs.innerHTML = '<span class="muted">generating thumbnails...</span>';
  try {
    const r = await fetch('/api/thumbnails?id=' + encodeURIComponent(state.id));
    const j = await r.json();
    if (!r.ok) {
      showError(j.error || 'thumbnail generation failed');
      return;
    }
    state.thumbFiles = j.files || [];
    els.thumbs.innerHTML = '';
    if (state.thumbFiles.length === 0) {
      els.thumbs.innerHTML = '<span class="muted">no thumbnails</span>';
      return;
    }
    for (const url of state.thumbFiles) {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      els.thumbs.appendChild(img);
    }
  } catch (e) {
    showError('thumbnail request failed: ' + e.message);
  }
}

function bindTimeline() {
  const updateFromRanges = (moved) => {
    let s = parseFloat(els.startRange.value);
    let e = parseFloat(els.endRange.value);
    if (e < s) {
      if (moved === els.startRange) e = s; else s = e;
      els.startRange.value = s;
      els.endRange.value = e;
    }
    state.start = s;
    state.end = e;
    playSelection(false);
    scheduleEstimate();
  };
  els.startRange.addEventListener('input', () => updateFromRanges(els.startRange));
  els.endRange.addEventListener('input', () => updateFromRanges(els.endRange));

  els.track.addEventListener('click', (ev) => {
    if (ev.target.tagName === 'INPUT') return;
    const rect = els.track.getBoundingClientRect();
    const ratio = (ev.clientX - rect.left) / rect.width;
    seekVideo(ratio * state.meta.duration);
  });

  els.video.addEventListener('timeupdate', () => {
    state.scrub = els.video.currentTime;
    if (state.previewing) {
      if (els.video.currentTime >= state.end) {
        if (state.playLoop) {
          els.video.currentTime = state.start;
        } else {
          els.video.pause();
        }
      } else if (els.video.currentTime < state.start - 0.25) {
        els.video.currentTime = state.start;
      }
    }
    updateTimeline();
  });
  els.video.addEventListener('seeked', () => {
    state.scrub = els.video.currentTime;
    updateTimeline();
  });
  els.video.addEventListener('pause', () => {
    if (state.previewing) {
      state.previewing = false;
      setPreviewUI();
    }
  });

  els.preview.addEventListener('click', () => {
    if (!state.meta) return;
    if (state.previewing) {
      stopPreview();
      return;
    }
    if (state.end - state.start <= 0.01) {
      showError('selection is empty — pick a start and end time');
      return;
    }
    playSelection(true);
  });
}

function playSelection(loop) {
  if (!state.meta || state.end - state.start <= 0.01) return;
  state.playLoop = !!loop;
  state.previewing = true;
  try {
    els.video.currentTime = state.start;
  } catch (e) {
  }
  els.video.play().catch(() => {
    state.previewing = false;
    setPreviewUI();
  });
  setPreviewUI();
}

function setPreviewUI() {
  els.preview.textContent = state.previewing ? 'Pause preview' : 'Preview selection';
  els.preview.setAttribute('aria-pressed', String(state.previewing));
}

function stopPreview() {
  state.previewing = false;
  els.video.pause();
  setPreviewUI();
}

function seekVideo(t) {
  if (!state.meta) return;
  if (t < 0) t = 0;
  if (t > state.meta.duration) t = state.meta.duration;
  stopPreview();
  els.video.removeAttribute('poster');
  if (els.video.dataset.frameUrl) {
    URL.revokeObjectURL(els.video.dataset.frameUrl);
    delete els.video.dataset.frameUrl;
  }
  try {
    els.video.currentTime = t;
  } catch (e) {
  }
  state.scrub = t;
  updateTimeline();
}

function updateTimeline() {
  const dur = state.meta ? state.meta.duration : 1;
  const sPct = (state.start / dur) * 100;
  const ePct = (state.end / dur) * 100;
  els.range.style.left = sPct + '%';
  els.range.style.width = Math.max(0, ePct - sPct) + '%';
  const scPct = (state.scrub / dur) * 100;
  els.scrub.style.left = scPct + '%';
  els.scrub.style.display = state.meta ? 'block' : 'none';
  els.tStart.textContent = state.start.toFixed(2) + 's';
  els.tEnd.textContent = state.end.toFixed(2) + 's';
  els.tScrub.textContent = state.scrub.toFixed(2) + 's';
  els.selDur.textContent = state.meta ? (state.end - state.start).toFixed(2) + 's selected' : '';
}

function markActive(container, btn) {
  [...container.querySelectorAll('button')].forEach(c => {
    const on = c === btn;
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', String(on));
  });
}

function updateResSummary() {
  if (!state.meta) {
    els.resSummary.textContent = '';
    return;
  }
  const src = cropSourceDims();
  const { w, h } = effDims();
  let txt = `output: ${w}\u00d7${h}`;
  if (state.resMode === 'original' || (!state.resW && !state.resH)) txt += ' (original)';
  const c = toSourceCrop();
  if (c) txt += ` \u00b7 crop ${c.W}\u00d7${c.H}`;
  else if (src.w !== state.meta.width || src.h !== state.meta.height) txt += ` \u00b7 from ${src.w}\u00d7${src.h}`;
  els.resSummary.textContent = txt;
}

function bindControls() {
  els.fpsPresets.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    markActive(els.fpsPresets, b);
    const v = b.dataset.v;
    const custom = v === 'custom';
    els.fpsCustomRow.classList.toggle('hidden', !custom);
    if (custom) {
      els.fpsCustom.focus();
      state.fps = parseInt(els.fpsCustom.value, 10) || 15;
    } else {
      state.fps = parseInt(v, 10);
    }
    scheduleEstimate();
  });
  els.fpsCustom.addEventListener('input', () => {
    const v = parseInt(els.fpsCustom.value, 10);
    if (v > 0) state.fps = v;
    scheduleEstimate();
  });

  els.resPresets.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    markActive(els.resPresets, b);
    const v = b.dataset.v;
    state.resMode = v;
    els.resCustomRow.classList.toggle('hidden', v !== 'custom');
    if (v === 'custom') {
      const src = cropSourceDims();
      if (!els.resW.value) els.resW.value = src.w;
      if (!els.resH.value) els.resH.value = src.h;
      state.resW = parseInt(els.resW.value, 10) || 0;
      state.resH = parseInt(els.resH.value, 10) || 0;
    } else if (v === 'original') {
      state.resW = 0;
      state.resH = 0;
    } else {
      const targetH = parseInt(v, 10);
      const src = cropSourceDims();
      const ratio = src.w / src.h;
      state.resH = targetH;
      state.resW = Math.round(targetH * ratio / 2) * 2;
    }
    updateResSummary();
    scheduleEstimate();
  });
  els.resW.addEventListener('input', () => {
    if (!state.meta) return;
    let w = parseInt(els.resW.value, 10) || 0;
    state.resW = w;
    if (els.resLock.checked) {
      const src = cropSourceDims();
      const h = Math.round(w / (src.w / src.h) / 2) * 2;
      els.resH.value = h;
      state.resH = h;
    }
    updateResSummary();
    scheduleEstimate();
  });
  els.resH.addEventListener('input', () => {
    if (!state.meta) return;
    let h = parseInt(els.resH.value, 10) || 0;
    state.resH = h;
    if (els.resLock.checked) {
      const src = cropSourceDims();
      const w = Math.round(h * (src.w / src.h) / 2) * 2;
      els.resW.value = w;
      state.resW = w;
    }
    updateResSummary();
    scheduleEstimate();
  });
  els.resLock.addEventListener('change', () => state.resLock = els.resLock.checked);
  els.mode.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    markActive(els.mode, b);
    state.mode = b.dataset.v;
    els.ditherRow.classList.toggle('hidden', state.mode !== 'high');
    scheduleEstimate();
  });
  els.dither.addEventListener('change', () => {
    state.dither = els.dither.checked;
    scheduleEstimate();
  });
  els.loop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    markActive(els.loop, b);
    const v = b.dataset.v;
    const custom = v === 'custom';
    els.loopCustomRow.classList.toggle('hidden', !custom);
    if (custom) {
      els.loopCustom.focus();
      state.loop = parseInt(els.loopCustom.value, 10) || 0;
    } else {
      state.loop = parseInt(v, 10);
    }
  });
  els.loopCustom.addEventListener('input', () => {
    const v = parseInt(els.loopCustom.value, 10);
    if (v >= 0) state.loop = v;
  });
  els.fit.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    markActive(els.fit, b);
    state.fit = b.dataset.v;
    scheduleEstimate();
  });
}

function bindConvert() {
  els.convert.addEventListener('click', async () => {
    if (!state.id) return;
    if (state.end - state.start <= 0.01) {
      showError('selection is empty — pick a start and end time');
      return;
    }
    let width = 0, height = 0;
    if (state.resMode === 'original' || (!state.resW && !state.resH)) {
      width = 0;
      height = 0;
    } else if (state.resMode === 'custom') {
      width = state.resW || state.meta.width;
      height = state.resH || state.meta.height;
    } else {
      width = state.resW;
      height = state.resH;
    }

    els.convert.disabled = true;
    els.progress.classList.remove('hidden');
    els.progressBar.style.width = '0%';
    els.progressText.textContent = 'starting...';
    els.result.classList.add('hidden');

    const base = (state.fileName || 'output').replace(/\.[^.]*$/, '') || 'output';
    const body = {
      id: state.id,
      start: state.start,
      end: state.end,
      fps: state.fps,
      width: width,
      height: height,
      mode: state.mode,
      dither: els.dither.checked,
      loop: state.loop,
      crop: toSourceCrop(),
      fit: state.fit,
      saveToFolder: !!state.saveFolder,
      filename: base + '.gif',
    };

    try {
      const r = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        showError(j.error || 'convert failed');
        els.progressText.textContent = 'failed';
        els.convert.disabled = false;
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let final = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (typeof ev.percent === 'number') {
              els.progressBar.style.width = ev.percent.toFixed(1) + '%';
              els.progressText.textContent = ev.percent.toFixed(0) + '%';
            } else if (ev.done) {
              final = ev;
            } else if (ev.error) {
              showError(ev.error);
              els.progressText.textContent = 'failed';
            } else if (ev.warning) {
              els.savePathInfo.textContent = ev.warning;
            }
          } catch (e) {
          }
        }
      }
      if (final) {
        els.progressBar.style.width = '100%';
        els.progressText.textContent = 'done';
        state.lastFile = final.file;
        state.lastURL = final.url;
        els.resultImg.src = final.url + '?t=' + Date.now();
        els.download.href = final.url;
        els.download.download = final.file;
        els.result.classList.remove('hidden');
        let info = '';
        if (final.width && final.height) {
          info = `${final.width}\u00d7${final.height}`;
        }
        if (final.savedTo) {
          info += (info ? ' \u00b7 ' : '') + 'saved to: ' + final.savedTo;
        }
        els.savePathInfo.textContent = info;
      }
    } catch (e) {
      showError('convert request failed: ' + e.message);
      els.progressText.textContent = 'failed';
    } finally {
      els.convert.disabled = false;
    }
  });
}

function bindResult() {
  els.saveFolder.addEventListener('click', () => {
    els.folderInput.value = '';
    els.saveDialog.showModal();
  });
  els.pickFolder.addEventListener('click', async () => {
    if (window.showSaveFilePicker && state.lastURL) {
      try {
        const res = await fetch(state.lastURL);
        const blob = await res.blob();
        const handle = await window.showSaveFilePicker({
          suggestedName: state.lastFile || 'output.gif',
          types: [{ description: 'GIF image', accept: { 'image/gif': ['.gif'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        els.savePathInfo.textContent = 'saved via picker: ' + handle.name;
        els.saveDialog.close();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    els.folderInput.focus();
  });
  els.saveOk.addEventListener('click', async (e) => {
    e.preventDefault();
    const folder = els.folderInput.value.trim();
    if (!folder) {
      els.folderInput.focus();
      return;
    }
    try {
      const r = await fetch('/api/save-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, file: state.lastFile }),
      });
      const j = await r.json();
      if (!r.ok) {
        showError(j.error || 'invalid folder');
        return;
      }
      state.saveFolder = j.folder || folder;
      els.savePathInfo.textContent = j.savedTo ? 'saved to: ' + j.savedTo : 'save folder: ' + state.saveFolder;
      els.saveDialog.close();
    } catch (e) {
      showError('save-path failed: ' + e.message);
    }
  });
}

init();