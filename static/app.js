const state = {
  id: null,
  meta: null,
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
};

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
  resPresets: $('res-presets'),
  resW: $('res-w'),
  resH: $('res-h'),
  resLock: $('res-lock'),
  mode: $('mode'),
  dither: $('dither'),
  loop: $('loop'),
  loopCustom: $('loop-custom'),
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
  state.start = 0;
  state.end = j.duration;
  state.scrub = 0;
  state.thumbFiles = [];

  els.video.src = URL.createObjectURL(file);
  els.meta.innerHTML =
    `<div><strong>${j.duration.toFixed(2)}s</strong> &middot; ${j.width}&times;${j.height} &middot; ${j.fps.toFixed(2)} fps &middot; ${j.codec}</div>` +
    `<div class="muted small">${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)</div>`;

  els.source.classList.remove('hidden');
  els.controls.classList.remove('hidden');
  els.startRange.value = 0;
  els.endRange.value = j.duration;
  updateTimeline();
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
  const updateFromRanges = () => {
    let s = parseFloat(els.startRange.value);
    let e = parseFloat(els.endRange.value);
    if (e < s) e = s;
    state.start = s;
    state.end = e;
    updateTimeline();
    scrubTo(s);
  };
  els.startRange.addEventListener('input', updateFromRanges);
  els.endRange.addEventListener('input', updateFromRanges);

  els.track.addEventListener('click', async (ev) => {
    if (ev.target.tagName === 'INPUT') return;
    const rect = els.track.getBoundingClientRect();
    const ratio = (ev.clientX - rect.left) / rect.width;
    const t = ratio * state.meta.duration;
    await scrubTo(t);
    state.scrub = t;
    updateTimeline();
  });
}

function updateTimeline() {
  const dur = state.meta ? state.meta.duration : 1;
  const sPct = (state.start / dur) * 100;
  const ePct = (state.end / dur) * 100;
  els.range.style.left = sPct + '%';
  els.range.style.width = (ePct - sPct) + '%';
  const scPct = (state.scrub / dur) * 100;
  els.scrub.style.left = scPct + '%';
  els.scrub.style.display = state.scrub > 0 || dur > 0 ? 'block' : 'none';
  els.tStart.textContent = state.start.toFixed(2) + 's';
  els.tEnd.textContent = state.end.toFixed(2) + 's';
  els.tScrub.textContent = state.scrub.toFixed(2) + 's';
}

async function scrubTo(t) {
  if (!state.meta) return;
  if (t < 0) t = 0;
  if (t > state.meta.duration) t = state.meta.duration;
  state.scrub = t;
  updateTimeline();
  try {
    const r = await fetch('/api/frame?id=' + encodeURIComponent(state.id) + '&t=' + t.toFixed(3));
    if (!r.ok) return;
    const blob = await r.blob();
    if (els.video.dataset.frameUrl) URL.revokeObjectURL(els.video.dataset.frameUrl);
    const url = URL.createObjectURL(blob);
    els.video.poster = url;
    els.video.dataset.frameUrl = url;
  } catch (e) {
    // ignore scrub errors
  }
}

function bindControls() {
  els.fpsPresets.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...els.fpsPresets.children].forEach(c => c.classList.remove('active'));
    b.classList.add('active');
    const v = b.dataset.v;
    if (v === 'custom') {
      els.fpsCustom.disabled = false;
      els.fpsCustom.focus();
      state.fps = parseInt(els.fpsCustom.value, 10) || 15;
    } else {
      els.fpsCustom.disabled = true;
      state.fps = parseInt(v, 10);
    }
  });
  els.fpsCustom.addEventListener('input', () => {
    const v = parseInt(els.fpsCustom.value, 10);
    if (v > 0) state.fps = v;
  });
  [...els.fpsPresets.children].find(b => b.dataset.v === '15').classList.add('active');

  els.resPresets.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...els.resPresets.children].forEach(c => c.classList.remove('active'));
    b.classList.add('active');
    const v = b.dataset.v;
    state.resMode = v;
    if (v === 'custom') {
      els.resW.disabled = false;
      els.resH.disabled = false;
      if (!els.resW.value) els.resW.value = state.meta ? state.meta.width : 640;
      if (!els.resH.value) els.resH.value = state.meta ? state.meta.height : 480;
      state.resW = parseInt(els.resW.value, 10) || 0;
      state.resH = parseInt(els.resH.value, 10) || 0;
    } else if (v === 'original') {
      els.resW.disabled = true;
      els.resH.disabled = true;
      state.resW = 0;
      state.resH = 0;
    } else {
      els.resW.disabled = true;
      els.resH.disabled = true;
      const targetH = parseInt(v, 10);
      const srcW = state.meta.width;
      const srcH = state.meta.height;
      const ratio = srcW / srcH;
      state.resH = targetH;
      state.resW = Math.round(targetH * ratio);
    }
  });
  els.resW.addEventListener('input', () => {
    if (!state.meta) return;
    let w = parseInt(els.resW.value, 10) || 0;
    state.resW = w;
    if (els.resLock.checked) {
      const h = Math.round(w / (state.meta.width / state.meta.height));
      els.resH.value = h;
      state.resH = h;
    }
  });
  els.resH.addEventListener('input', () => {
    if (!state.meta) return;
    let h = parseInt(els.resH.value, 10) || 0;
    state.resH = h;
    if (els.resLock.checked) {
      const w = Math.round(h * (state.meta.width / state.meta.height));
      els.resW.value = w;
      state.resW = w;
    }
  });
  els.resLock.addEventListener('change', () => state.resLock = els.resLock.checked);
  els.mode.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...els.mode.children].forEach(c => c.classList.remove('active'));
    b.classList.add('active');
    state.mode = b.dataset.v;
    els.dither.disabled = state.mode !== 'high';
  });
  els.dither.addEventListener('change', () => state.dither = els.dither.checked);
  els.loop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...els.loop.children].forEach(c => c.classList.remove('active'));
    b.classList.add('active');
    const v = b.dataset.v;
    if (v === 'custom') {
      els.loopCustom.disabled = false;
      els.loopCustom.focus();
      state.loop = parseInt(els.loopCustom.value, 10) || 0;
    } else {
      els.loopCustom.disabled = true;
      state.loop = parseInt(v, 10);
    }
  });
  els.loopCustom.addEventListener('input', () => {
    const v = parseInt(els.loopCustom.value, 10);
    if (v >= 0) state.loop = v;
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
    if (state.mode === 'fast') {
      els.dither.disabled = true;
    } else {
      els.dither.disabled = false;
    }

    els.convert.disabled = true;
    els.progress.classList.remove('hidden');
    els.progressBar.style.width = '0%';
    els.progressText.textContent = 'starting...';
    els.result.classList.add('hidden');

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
            // ignore parse errors
          }
        }
      }
      if (final) {
        els.progressBar.style.width = '100%';
        els.progressText.textContent = 'done';
        els.resultImg.src = final.url + '?t=' + Date.now();
        els.download.href = final.url;
        els.download.download = final.file;
        els.result.classList.remove('hidden');
        if (final.savedTo) {
          els.savePathInfo.textContent = 'saved to: ' + final.savedTo;
        }
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
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker();
        els.folderInput.value = dir.name;
        els.saveDialog.dataset.dirHandle = 'true';
      } catch (e) {
        // user cancelled
      }
    } else {
      els.folderInput.focus();
    }
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
        body: JSON.stringify({ folder }),
      });
      const j = await r.json();
      if (!r.ok) {
        showError(j.error || 'invalid folder');
        return;
      }
      els.savePathInfo.textContent = 'save folder: ' + folder;
      els.saveDialog.close();
    } catch (e) {
      showError('save-path failed: ' + e.message);
    }
  });
}

init();