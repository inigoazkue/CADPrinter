/* ── Thumbnail long-side length in px (keeps portrait/landscape equally big) ── */
const THUMB_LONG = 170;

/* ── Paper sizes in mm (portrait) ──────────────────────────────────────── */
const PAGE_SIZES_MM = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594],
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
};

/* ── State ─────────────────────────────────────────────────────────────── */
const state = {
  jobs: [],
  selectedJobId: null,
  selectedJob: null,
  currentJobId: null,
  userActiveJobs: {},  // { source_user: job_id }
};

/* ── API ───────────────────────────────────────────────────────────────── */
const API = {
  async request(method, path, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, opts);
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  },

  getJobs:         ()           => API.request('GET', '/jobs'),
  activateUserJob: (user, id)  => API.request('POST', `/users/${encodeURIComponent(user)}/jobs/${id}/activate`),
  getJob:          (id)         => API.request('GET', `/jobs/${id}`),
  createJob:       (name, fmt, sourceUser, activate) => API.request('POST', '/jobs', {
    name, format: fmt,
    ...(sourceUser ? { source_user: sourceUser } : {}),
    activate: activate !== false,
  }),
  updateJob:       (id, data)   => API.request('PATCH', `/jobs/${id}`, data),
  deleteJob:       (id)         => API.request('DELETE', `/jobs/${id}`),
  activateJob:     (id)         => API.request('POST', `/jobs/${id}/activate`),
  exportJobUrl:    (id)         => `/api/jobs/${id}/export`,

  addSheet:        (jobId)      => API.request('POST', `/jobs/${jobId}/sheets`),
  updateSheet:     (id, data)   => API.request('PATCH', `/sheets/${id}`, data),
  deleteSheet:     (id)         => API.request('DELETE', `/sheets/${id}`),
  sheetPreviewUrl: (id)         => `/api/sheets/${id}/preview?t=${Date.now()}`,
  sheetGhostUrl:   (id, excl)   => `/api/sheets/${id}/ghost?exclude=${excl}&t=${Date.now()}`,

  deletePrint:     (id)         => API.request('DELETE', `/prints/${id}`),
  updatePrint:     (id, data)   => API.request('PATCH', `/prints/${id}`, data),
  splitPrint:      (id, params) => API.request('POST', `/prints/${id}/split`, params),
  editPrint:       (id, params) => API.request('POST', `/prints/${id}/edit`, params),
  reusePrint:      (id, data)   => API.request('POST', `/prints/${id}/reuse`, data || {}),
  printPreviewUrl: (id)         => `/api/prints/${id}/preview`,

  async uploadPrint(sheetId, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/sheets/${sheetId}/prints`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

/* ── SVG icons ──────────────────────────────────────────────────────────── */
function iconTrash(size = 13) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;
}

function iconPencil(size = 13) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
}

function iconSplit(size = 13) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`;
}

function iconPrinter(size = 13) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
}

function iconMove(size = 11) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`;
}

/* ── Render helpers ────────────────────────────────────────────────────── */
// Basque count style: singular → word after the number ("geruza 1"); plural →
// number before the word ("2 geruza", "3 geruza").
function countLabel(n, word) {
  return n === 1 ? `${word} 1` : `${n} ${word}`;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function showToast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

async function safeCall(fn) {
  try { return await fn(); }
  catch (e) { showToast(e.message || 'Errorea', true); }
}

/* ── Load & refresh ────────────────────────────────────────────────────── */
async function loadJobs() {
  const resp = await API.getJobs();
  state.jobs = resp.jobs;
  state.userActiveJobs = resp.userActiveJobs || {};
  state.currentJobId = state.jobs.find(j => j.is_current)?.id ?? null;
  renderSidebar();
}

async function loadJob(id) {
  state.selectedJob = await API.getJob(id);
  state.selectedJobId = id;
  renderJobDetail();
}

async function refresh() {
  await loadJobs();
  if (state.selectedJobId) await loadJob(state.selectedJobId);
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
function isJobActive(job) {
  if (job.source_user) return state.userActiveJobs[job.source_user] === job.id;
  return !!job.is_current;
}

function renderJobCard(job) {
  const active = isJobActive(job);
  const card = el('div', 'job-card' +
    (job.id === state.selectedJobId ? ' selected' : '') +
    (active ? ' active-job' : ''));

  const main = el('div', 'job-card-main');
  main.innerHTML = `
    <div class="job-card-indicator" title="Lan aktiboa"></div>
    <div class="job-card-info">
      <div class="job-card-name">${escHtml(job.name)}</div>
      <div class="job-card-meta">${countLabel(job.sheet_count, 'orri')} · ${countLabel(job.print_count, 'geruza')}</div>
      <span class="format-pill">${job.format}</span>
    </div>`;
  main.addEventListener('click', () => selectJob(job.id));

  const btns = el('div', 'job-card-btns');

  const printBtn = el('button', 'jc-btn', iconPrinter());
  printBtn.title = 'Lana inprimatu';
  printBtn.addEventListener('click', e => { e.stopPropagation(); printJob(job.id); });

  const renameBtn = el('button', 'jc-btn', iconPencil());
  renameBtn.title = 'Berrizendatu';
  renameBtn.addEventListener('click', e => { e.stopPropagation(); renameJob(job.id, job.name); });

  const deleteBtn = el('button', 'jc-btn jc-btn-danger', iconTrash());
  deleteBtn.title = 'Lana ezabatu';
  deleteBtn.addEventListener('click', e => { e.stopPropagation(); deleteJobSidebar(job.id, job.name); });

  btns.appendChild(printBtn);
  btns.appendChild(renameBtn);
  btns.appendChild(deleteBtn);
  card.appendChild(main);
  card.appendChild(btns);
  return card;
}

function renderSidebar() {
  const list = document.getElementById('job-list');
  if (!state.jobs.length) {
    list.innerHTML = '<p class="empty-hint">Lanik ez</p>';
    return;
  }
  list.innerHTML = '';

  // Group by source_user
  const userGroups = {};
  const noUserJobs = [];
  for (const job of state.jobs) {
    if (job.source_user) {
      if (!userGroups[job.source_user]) userGroups[job.source_user] = [];
      userGroups[job.source_user].push(job);
    } else {
      noUserJobs.push(job);
    }
  }

  const hasUsers = Object.keys(userGroups).length > 0;

  for (const [user, jobs] of Object.entries(userGroups)) {
    const header = el('div', 'user-group-header');
    header.innerHTML = `<span class="user-group-icon">◎</span><span class="user-group-name">${escHtml(user)}</span>`;
    list.appendChild(header);
    for (const job of jobs) list.appendChild(renderJobCard(job));
  }

  if (noUserJobs.length) {
    if (hasUsers) {
      const header = el('div', 'user-group-header');
      header.innerHTML = `<span class="user-group-name">Beste lanak</span>`;
      list.appendChild(header);
    }
    for (const job of noUserJobs) list.appendChild(renderJobCard(job));
  }
}

async function selectJob(id) {
  state.selectedJobId = id;
  renderSidebar();
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('job-detail').classList.remove('hidden');
  await safeCall(() => loadJob(id));
}

/* ── Print / export with 1:1 reminder ───────────────────────────────────── */
const PRINT_REMINDER_KEY = 'cadprinter_hide_print_reminder';
let _pendingExportJobId = null;

function requestExport(jobId) {
  if (jobId == null) return;
  if (localStorage.getItem(PRINT_REMINDER_KEY) === '1') {
    doExport(jobId);
    return;
  }
  _pendingExportJobId = jobId;
  const cb = document.getElementById('print-reminder-hide');
  if (cb) cb.checked = false;
  document.getElementById('modal-print-reminder').classList.remove('hidden');
}

function doExport(jobId) {
  window.open('/api/jobs/' + jobId + '/export', '_blank');
}

function closePrintReminder() {
  document.getElementById('modal-print-reminder').classList.add('hidden');
  _pendingExportJobId = null;
}

function confirmPrintReminder() {
  if (document.getElementById('print-reminder-hide').checked) {
    localStorage.setItem(PRINT_REMINDER_KEY, '1');
  }
  const id = _pendingExportJobId;
  document.getElementById('modal-print-reminder').classList.add('hidden');
  _pendingExportJobId = null;
  if (id != null) doExport(id);
}

function openHelp()  { document.getElementById('modal-help').classList.remove('hidden'); }
function closeHelp() { document.getElementById('modal-help').classList.add('hidden'); }

/* ── Job actions from sidebar ───────────────────────────────────────────── */
function printJob(id) {
  requestExport(id);
}

async function renameJob(id, currentName) {
  const newName = prompt('Izen berria:', currentName);
  if (!newName || newName.trim() === currentName) return;
  await safeCall(async () => {
    await API.updateJob(id, { name: newName.trim() });
    await loadJobs();
    if (state.selectedJobId === id) await loadJob(id);
    showToast('Lana berrizendatuta');
  });
}

async function deleteJobSidebar(id, name) {
  if (!confirm(`"${name}" ezabatu?\nBere PDF guztiak ezabatuko dira.`)) return;
  await safeCall(async () => {
    await API.deleteJob(id);
    if (state.selectedJobId === id) {
      state.selectedJobId = null;
      state.selectedJob = null;
      document.getElementById('job-detail').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
    }
    await loadJobs();
    showToast('Lana ezabatuta');
  });
}

/* ── Job detail ─────────────────────────────────────────────────────────── */
function renderJobDetail() {
  const job = state.selectedJob;
  if (!job) return;

  document.getElementById('job-name').textContent = job.name;
  document.getElementById('job-format-badge').textContent = job.format;

  const isActive = isJobActive(job);
  const activateBtn = document.getElementById('btn-activate-job');
  if (isActive) {
    activateBtn.textContent = '● Aktibo';
    activateBtn.style.color = 'var(--success)';
  } else {
    activateBtn.textContent = 'Aktibatu';
    activateBtn.style.color = '';
  }

  const container = document.getElementById('sheets-container');
  container.innerHTML = '';
  // Default (unnamed) sheets get a sequential Euskera ordinal "N. orria";
  // named sheets (user-renamed) keep their name. Iturriak sheets are NOT shown
  // inline — they live in the "Iturriak" dropdown in the job header.
  let orriN = 0;
  for (const sheet of job.sheets) {
    if (sheet.name === 'Iturriak') continue;
    const hasName = sheet.name && sheet.name.trim();
    const label = hasName ? sheet.name : `${++orriN}. orria`;
    container.appendChild(renderSheet(sheet, job.format, label));
  }

  renderIturriakDropdown(job);
}

// The Iturriak (split sources, kept for reference) live in a dropdown next to
// the Formatua/Aktibatu buttons. Each source shows its preview and a button to
// re-insert it as a PDF layer into the first sheet, so it can be reused.
function renderIturriakDropdown(job) {
  const dd = document.getElementById('iturriak-dd');
  const btn = document.getElementById('btn-iturriak');
  const panel = document.getElementById('iturriak-panel');
  const countEl = document.getElementById('iturriak-count');
  if (!dd) return;

  const sources = [];
  for (const sheet of job.sheets) {
    if (sheet.name === 'Iturriak') sources.push(...sheet.prints);
  }

  if (!sources.length) {
    dd.classList.add('hidden');
    panel.classList.add('hidden');
    return;
  }
  dd.classList.remove('hidden');
  countEl.textContent = sources.length;

  panel.innerHTML = '';
  for (const p of sources) {
    const item = el('div', 'iturriak-item');
    const img = el('img', 'iturriak-item-img');
    img.src = API.printPreviewUrl(p.id);
    img.alt = p.original_name || p.filename;
    img.onerror = () => { img.style.visibility = 'hidden'; };
    const name = el('div', 'iturriak-item-name', escHtml((p.original_name || p.filename).replace(/\.\w+$/, '')));
    const useBtn = el('button', 'btn btn-primary iturriak-use-btn', '⬇ Txertatu 1. orrian');
    useBtn.title = 'PDF hau lehen orrian geruza gisa txertatu (berrerabili)';
    useBtn.addEventListener('click', () => {
      safeCall(async () => {
        await API.reusePrint(p.id);
        panel.classList.add('hidden');
        await loadJob(state.selectedJobId);
        await loadJobs();
        showToast('Iturria txertatuta ✓');
      });
    });
    item.appendChild(img);
    item.appendChild(name);
    item.appendChild(useBtn);
    panel.appendChild(item);
  }
}

function renderSheet(sheet, fmt, label) {
  const card = el('div', 'sheet-card');
  card.dataset.sheetId = sheet.id;

  const header = el('div', 'sheet-header');

  const nameEl = el('span', 'sheet-name', escHtml(label || `${sheet.order_num}. orria`));
  nameEl.contentEditable = 'true';
  nameEl.spellcheck = false;
  nameEl.addEventListener('blur', () => {
    const newName = nameEl.textContent.trim();
    if (newName === label) return;   // unchanged default/custom label
    safeCall(() => API.updateSheet(sheet.id, { name: newName }).then(async () => {
      await loadJob(state.selectedJobId);
      await loadJobs();
    }));
  });
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });

  const deleteSheetBtn = el('button', 'btn-delete-sheet', iconTrash(17));
  deleteSheetBtn.title = 'Orria ezabatu';
  deleteSheetBtn.addEventListener('click', () => confirmDeleteSheet(sheet.id));

  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = '.pdf,application/pdf';
  uploadInput.style.display = 'none';
  uploadInput.addEventListener('change', () => {
    if (uploadInput.files[0]) uploadToSheet(sheet.id, uploadInput.files[0]);
    uploadInput.value = '';
  });

  const uploadBtn = el('button', 'btn-upload-here', '⬆ PDF bat igo eskuz');
  uploadBtn.addEventListener('click', () => uploadInput.click());

  const actions = el('div', 'sheet-actions');
  actions.appendChild(uploadInput);
  actions.appendChild(uploadBtn);

  header.appendChild(nameEl);
  header.appendChild(deleteSheetBtn);
  header.appendChild(actions);

  const body = el('div', 'sheet-body');

  const printsCol = el('div', 'sheet-prints-col');
  const grid = el('div', 'prints-grid');
  grid.dataset.sheetId = sheet.id;
  setupSheetDropTarget(grid, sheet.id);

  for (const p of sheet.prints) {
    grid.appendChild(renderPrint(p, sheet.id, fmt));
  }

  if (!sheet.prints.length) {
    const hint = el('p', '', '<span style="color:var(--text-muted);font-size:13px">Geruza gabe. Arrastatu PDF bat hona edo erabili ⬆ PDF bat igo eskuz.</span>');
    grid.appendChild(hint);
  }

  printsCol.appendChild(grid);
  body.appendChild(printsCol);

  const previewCol = el('div', 'sheet-preview-col');
  const headRow = el('div', 'sheet-preview-head');
  headRow.appendChild(el('span', 'sheet-preview-label', 'Aurrebista'));

  const rotBtn = el('button', 'sheet-rotate-btn', '↻');
  rotBtn.title = 'Aurrebista biratu 90° (irteera)';
  rotBtn.addEventListener('click', async () => {
    const newRot = ((sheet.rotation || 0) + 90) % 360;
    await safeCall(async () => {
      await API.updateSheet(sheet.id, { rotation: newRot });
      sheet.rotation = newRot;
      const im = document.querySelector(`img[data-sheet-preview="${sheet.id}"]`);
      if (im) { im.style.display = ''; im.src = API.sheetPreviewUrl(sheet.id); }
    });
  });
  headRow.appendChild(rotBtn);
  previewCol.appendChild(headRow);

  if (sheet.prints.some(p => p.enabled)) {
    const img = el('img', 'sheet-preview-img');
    img.alt = 'Aurrebista';
    img.dataset.sheetPreview = sheet.id;
    img.src = API.sheetPreviewUrl(sheet.id);
    img.onerror = () => img.style.display = 'none';
    previewCol.appendChild(img);
  } else {
    previewCol.appendChild(el('div', 'sheet-preview-empty', 'Geruza aktiborik ez'));
  }

  body.appendChild(previewCol);
  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function renderPrint(p, sheetId, jobFmt) {
  const thumb = el('div', 'print-thumb' + (p.enabled ? '' : ' disabled'));
  thumb.dataset.printId = p.id;
  thumb.draggable = true;

  const img = el('img');
  // Thumbnail shows the layer placed on its folio: rotated + at its offset.
  // The ?t= token defeats browser/proxy caching so a rotation/offset change is
  // reflected immediately on the next render.
  // Size the card so the LONG side is constant (THUMB_LONG): portrait and
  // landscape layers then look equally big, and the card reshapes on rotate.
  const sizeThumb = () => {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) return;
    thumb.style.width = (nw >= nh ? THUMB_LONG : Math.round(THUMB_LONG * nw / nh)) + 'px';
  };
  img.addEventListener('load', sizeThumb);
  img.src = API.printPreviewUrl(p.id) + '?placed=1&t=' + Date.now();
  if (img.complete) sizeThumb();
  img.alt = p.original_name || p.filename;
  img.onerror = () => { img.style.background = '#f1f5f9'; img.alt = ''; };
  img.style.cursor = 'pointer';
  img.title = 'Editatu (biratu / zatitu / kokatu)';
  // For split tiles the sheet preview is rendered at the tile format, so the
  // drag-to-position conversion must use that format, not the job format.
  const isTile = p.tile_col !== null && p.tile_col !== undefined;
  const refFmt = isTile ? (p.format || jobFmt) : jobFmt;
  img.addEventListener('click', e => {
    e.stopPropagation();
    openEditModal(p, refFmt);
  });

  const footer = el('div', 'print-thumb-footer', escHtml((p.original_name || p.filename).replace(/\.\w+$/, '')));
  footer.title = p.original_name || p.filename;

  const controls = el('div', 'print-thumb-controls');

  const toggleBtn = el('button', 'ctrl-btn toggle' + (p.enabled ? ' on' : ''), p.enabled ? '✓' : '○');
  toggleBtn.title = p.enabled ? 'Desgaitu' : 'Gaitu';
  toggleBtn.addEventListener('click', e => {
    e.stopPropagation();
    safeCall(() => API.updatePrint(p.id, { enabled: !p.enabled }).then(() => loadJob(state.selectedJobId)));
  });

  const rotateBtn = el('button', 'ctrl-btn rotate', '↻');
  rotateBtn.title = 'Biratu 90°';
  rotateBtn.addEventListener('click', e => {
    e.stopPropagation();
    safeCall(async () => {
      await API.editPrint(p.id, {
        rotation: 90,
        offset_x_mm: p.offset_x_mm || 0,
        offset_y_mm: p.offset_y_mm || 0,
        scale: p.scale || 1,
      });
      await loadJob(state.selectedJobId);
      showToast('90° biratuta');
    });
  });

  const delBtn = el('button', 'ctrl-btn del', '✕');
  delBtn.title = 'Geruza ezabatu';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    confirmDeletePrint(p.id);
  });

  controls.appendChild(toggleBtn);
  controls.appendChild(rotateBtn);
  controls.appendChild(delBtn);

  thumb.appendChild(img);
  thumb.appendChild(footer);
  thumb.appendChild(controls);

  if (p.format && jobFmt && p.format !== jobFmt) {
    const warn = el('div', 'format-warn', `⚠ ${p.format}`);
    warn.title = `PDF hau ${p.format} da baina lana ${jobFmt} da`;
    thumb.appendChild(warn);
  }

  thumb.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ printId: p.id, fromSheetId: sheetId }));
    thumb.classList.add('dragging');
  });
  thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'));

  return thumb;
}

/* ── Drag & drop ────────────────────────────────────────────────────────── */
function setupSheetDropTarget(grid, sheetId) {
  grid.addEventListener('dragover', e => {
    e.preventDefault();
    grid.classList.add('drag-over');
  });
  grid.addEventListener('dragleave', () => grid.classList.remove('drag-over'));
  grid.addEventListener('drop', async e => {
    e.preventDefault();
    grid.classList.remove('drag-over');
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.printId && data.fromSheetId !== sheetId) {
        await safeCall(() => API.updatePrint(data.printId, { sheet_id: sheetId }));
        await loadJob(state.selectedJobId);
      }
    } catch (_) {}
  });
}

/* ── Upload print ──────────────────────────────────────────────────────── */
async function uploadToSheet(sheetId, file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showToast('PDF fitxategiak soilik onartzen dira', true);
    return;
  }
  showToast('Igotzen...');
  await safeCall(async () => {
    await API.uploadPrint(sheetId, file);
    await loadJob(state.selectedJobId);
    await loadJobs();
    showToast('PDFa gehitu da');
  });
}

/* ── Sheet / print actions ──────────────────────────────────────────────── */
async function confirmDeleteSheet(sheetId) {
  if (!confirm('Orria ezabatu?\nBere geruzak lehen orrira pasatuko dira.')) return;
  await safeCall(async () => {
    await API.deleteSheet(sheetId);
    await refresh();
    showToast('Orria ezabatuta');
  });
}

async function confirmDeletePrint(printId) {
  if (!confirm('Geruza ezabatu?')) return;
  await safeCall(async () => {
    await API.deletePrint(printId);
    await loadJob(state.selectedJobId);
    await loadJobs();
    showToast('Geruza ezabatuta');
  });
}

/* ── Modal: Lan berria ──────────────────────────────────────────────────── */
function openNewJobModal() {
  document.getElementById('new-job-name').value = '';
  document.getElementById('new-job-format').value = 'A3';
  document.getElementById('new-job-activate').checked = true;

  const userSelect = document.getElementById('new-job-user');
  userSelect.innerHTML = '<option value="">— Ez (lan generikoa) —</option>';
  const users = [...new Set(state.jobs.map(j => j.source_user).filter(Boolean))].sort();
  for (const user of users) {
    const opt = document.createElement('option');
    opt.value = user;
    opt.textContent = user;
    userSelect.appendChild(opt);
  }

  document.getElementById('modal-new-job').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-job-name').focus(), 50);
}

function closeNewJobModal() {
  document.getElementById('modal-new-job').classList.add('hidden');
}

async function submitNewJob() {
  const name     = document.getElementById('new-job-name').value.trim();
  const fmt      = document.getElementById('new-job-format').value;
  const user     = document.getElementById('new-job-user').value || null;
  const activate = document.getElementById('new-job-activate').checked;
  if (!name) { document.getElementById('new-job-name').focus(); return; }

  await safeCall(async () => {
    const job = await API.createJob(name, fmt, user, activate);
    closeNewJobModal();
    await loadJobs();
    await selectJob(job.id);
    showToast('Lana sortuta');
  });
}

/* ── Modal: Formatua aldatu ─────────────────────────────────────────────── */
function openFormatModal() {
  document.getElementById('format-select').value = state.selectedJob?.format || 'A3';
  document.getElementById('modal-format').classList.remove('hidden');
}

function closeFormatModal() {
  document.getElementById('modal-format').classList.add('hidden');
}

async function submitFormat() {
  const fmt = document.getElementById('format-select').value;
  await safeCall(async () => {
    await API.updateJob(state.selectedJobId, { format: fmt });
    closeFormatModal();
    await loadJob(state.selectedJobId);
    await loadJobs();
    showToast('Formatua eguneratuta');
  });
}


/* ── Split modal ─────────────────────────────────────────────────────────── */
const splitState = {
  printId: null,
  jobFmt: 'A3',
  cols: 2,
  rows: 1,
  colPositions: [0.5],
  rowPositions: [],
  overlapMm: 5,
  tileFormat: 'A3',
  rotation: 0,
  offsetX: 0,   // position offset in mm (position mode)
  offsetY: 0,
  tx: 0,        // current translate in px (position mode)
  ty: 0,
  layerScale: 1, // REAL layer scale (persisted, affects output) — set by +/−/▢
  zoom: 1,      // preview-only zoom factor (mouse wheel)
  panX: 0,      // preview pan in px
  panY: 0,
  _baseW: 0,    // zoom box base size (unscaled)
  _baseH: 0,
};

function autoTiles(fmt) {
  if (fmt === 'A2') return { cols: 2, rows: 1 };
  if (fmt === 'A1') return { cols: 2, rows: 2 };
  if (fmt === 'A0') return { cols: 4, rows: 2 };
  return { cols: 2, rows: 1 };
}

function isSplitMode() {
  return splitState.cols > 1 || splitState.rows > 1;
}

function openEditModal(p, jobFmt) {
  splitState.printId = p.id;
  splitState.jobFmt = jobFmt || p.format || 'A3';
  splitState.layerFmt = p.format || splitState.jobFmt;
  splitState.rotation = 0;
  splitState.overlapMm = 5;
  splitState.tileFormat = 'A3';
  splitState.offsetX = p.offset_x_mm || 0;
  splitState.offsetY = p.offset_y_mm || 0;
  splitState.layerScale = (p.scale && p.scale > 0) ? p.scale : 1;
  splitState.tx = 0;
  splitState.ty = 0;
  splitState.zoom = 1;
  splitState.panX = 0;
  splitState.panY = 0;
  splitState.sheetId = p.sheet_id;
  // Are there other enabled layers on this sheet? (for the ghost background)
  const _sh = ((state.selectedJob && state.selectedJob.sheets) || []).find(s => s.id === p.sheet_id);
  splitState.hasGhost = !!(_sh && _sh.prints.some(x => x.enabled && x.id !== p.id));

  // Large formats default to split intent; others to position intent.
  const big = ['A0', 'A1', 'A2'].includes(p.format);
  const { cols, rows } = big ? autoTiles(p.format) : { cols: 1, rows: 1 };
  splitState.cols = cols;
  splitState.rows = rows;
  splitState.colPositions = Array.from({length: cols - 1}, (_, i) => (i + 1) / cols);
  splitState.rowPositions = Array.from({length: rows - 1}, (_, i) => (i + 1) / rows);

  document.getElementById('split-cols').value = cols;
  document.getElementById('split-rows').value = rows;
  document.getElementById('split-overlap').value = 5;
  document.getElementById('split-overlap-val').textContent = '5 mm';
  document.getElementById('split-tile-format').value = 'A3';
  document.getElementById('btn-split-rotate').textContent = '↻ Biratu · 0°';
  document.getElementById('btn-submit-split').disabled = false;

  const img = document.getElementById('split-preview-img');
  resetImgStyles(img);
  img.src = '';
  img.onload = () => refreshModalMode();
  img.src = API.printPreviewUrl(p.id) + '?hires=1&_=' + Date.now();

  document.getElementById('modal-split').classList.remove('hidden');
  syncModalControls();
}

// Backwards-compatible alias (kept in case of external callers)
function openSplitModal(printId, fmt) {
  openEditModal({ id: printId, format: fmt }, fmt);
}

function closeSplitModal() {
  document.getElementById('modal-split').classList.add('hidden');
}

function syncModalControls() {
  const split = isSplitMode();
  const submitBtn = document.getElementById('btn-submit-split');
  submitBtn.textContent = split ? 'Zatitu' : 'Gorde';
  const hint = document.querySelector('#modal-split .split-hint');
  if (hint) {
    hint.textContent = split
      ? 'Arrastatu lerro beltzak zatiketa-puntua aldatzeko · gurpilarekin ikuspegi-zooma'
      : 'Arrastatu irudia kokatzeko · −/+ tamaina erreala · gurpilarekin ikuspegi-zooma';
  }
  const h2 = document.querySelector('#modal-split h2');
  if (h2) h2.textContent = split ? 'PDF zatitu tilesetan' : 'Geruza editatu';
}

function resetImgStyles(img) {
  ['position', 'left', 'top', 'width', 'height', 'maxWidth', 'maxHeight', 'transform', 'zIndex']
    .forEach(prop => { img.style[prop] = ''; });
}

// Paper size in mm, flipped to landscape when `landscape` is true. Base is portrait.
function orientMM(fmt, landscape) {
  const mm = PAGE_SIZES_MM[fmt] || PAGE_SIZES_MM.A3;
  return landscape ? [mm[1], mm[0]] : [mm[0], mm[1]];
}

// Fit aspect (aw:ah) inside maxW×maxH (contain), centered.
function fitRect(aw, ah, maxW, maxH) {
  let w = maxW, h = maxW * ah / aw;
  if (h > maxH) { h = maxH; w = maxH * aw / ah; }
  return { w, h, left: (maxW - w) / 2, top: (maxH - h) / 2 };
}

function getZoomEl() { return document.getElementById('split-zoom'); }

function applyZoom() {
  getZoomEl().style.transform =
    `translate(${splitState.panX}px, ${splitState.panY}px) scale(${splitState.zoom})`;
}

function resetZoom() {
  splitState.zoom = 1;
  // Pan carries the centering offset so the box sits centered in the viewport.
  splitState.panX = splitState._baseLeft || 0;
  splitState.panY = splitState._baseTop || 0;
  applyZoom();
}

// ── REAL layer scale (position mode) ──
// The +/−/▢ buttons change the layer's ACTUAL size (persisted, affects the
// output), unlike the mouse wheel which only zooms the view.
function updateScaleLabel() {
  const lbl = document.getElementById('zoom-scale-label');
  if (!lbl) return;
  if (isSplitMode()) { lbl.textContent = ''; lbl.style.visibility = 'hidden'; return; }
  lbl.style.visibility = 'visible';
  lbl.textContent = Math.round((splitState.layerScale || 1) * 100) + '%';
}

function applyLayerScale() {
  const img = document.getElementById('split-preview-img');
  const sc = splitState.layerScale || 1;
  img.style.width = (splitState._layerBaseW * sc) + 'px';
  img.style.height = (splitState._layerBaseH * sc) + 'px';
  updateScaleLabel();
}

function scaleStep(factor) {
  // In split mode there is no single element to resize → fall back to view zoom.
  if (isSplitMode()) { zoomAt(factor > 1 ? 1.25 : 1 / 1.25, null, null); return; }
  splitState.layerScale = Math.max(0.1, Math.min(10, (splitState.layerScale || 1) * factor));
  applyLayerScale();
}

// ▢ button: reset the REAL scale to 100% (position mode) AND recenter the view.
function resetScaleAndView() {
  if (!isSplitMode()) { splitState.layerScale = 1; applyLayerScale(); }
  resetZoom();
}

// (Re)build the preview content (image, folio box, cut lines) and lay out the
// zoom container. Resets zoom/pan to the fitted view.
function refreshModalMode() {
  const wrap = document.getElementById('split-preview-wrap');
  const zoom = getZoomEl();
  const img = document.getElementById('split-preview-img');
  zoom.querySelectorAll('.split-divider-v, .split-divider-h, .split-tile-overlay, .folio-outline, .folio-ghost').forEach(e => e.remove());

  const vpW = wrap.clientWidth, vpH = wrap.clientHeight;
  const landscape = img.naturalWidth > img.naturalHeight;

  if (isSplitMode()) {
    // Split mode: the zoom box fits the source image; cut lines overlay it.
    zoom.classList.remove('folio-box');
    const r = fitRect(img.naturalWidth || 1, img.naturalHeight || 1, vpW, vpH);
    splitState._baseW = r.w; splitState._baseH = r.h;
    splitState._baseLeft = r.left; splitState._baseTop = r.top;
    Object.assign(zoom.style, { left: '0', top: '0', width: r.w + 'px', height: r.h + 'px' });
    Object.assign(img.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', transform: '', cursor: 'grab' });
    renderSplitDividers();
  } else {
    // Position mode: the zoom box is the base folio (PORTRAIT, like the actual
    // sheet composition) so offsets match the aurrebista. The layer image is
    // sized relative to the folio (its own orientation) and dragged to set its
    // offset.
    zoom.classList.add('folio-box');
    const folio = orientMM(splitState.jobFmt, false);
    const layer = orientMM(splitState.layerFmt, landscape);
    const r = fitRect(folio[0], folio[1], vpW, vpH);
    splitState._baseW = r.w; splitState._baseH = r.h; splitState._folioMM = folio;
    splitState._baseLeft = r.left; splitState._baseTop = r.top;
    Object.assign(zoom.style, { left: '0', top: '0', width: r.w + 'px', height: r.h + 'px' });

    // Ghost: the other layers of this sheet, faint, so you can avoid overlapping.
    if (splitState.hasGhost && splitState.sheetId) {
      const ghost = document.createElement('img');
      ghost.className = 'folio-ghost';
      Object.assign(ghost.style, { position: 'absolute', left: '0', top: '0',
        width: r.w + 'px', height: r.h + 'px', zIndex: '1' });
      ghost.src = API.sheetGhostUrl(splitState.sheetId, splitState.printId);
      ghost.onerror = () => ghost.remove();
      zoom.appendChild(ghost);
    }

    splitState.tx = (splitState.offsetX / folio[0]) * r.w;
    splitState.ty = (splitState.offsetY / folio[1]) * r.h;
    // The layer renders at its native size on the folio, times the REAL scale
    // (anchored top-left, like the backend composition). Store the unscaled px
    // dims so the +/− buttons can rescale live.
    splitState._layerBaseW = r.w * (layer[0] / folio[0]);
    splitState._layerBaseH = r.h * (layer[1] / folio[1]);
    const sc = splitState.layerScale || 1;
    Object.assign(img.style, {
      position: 'absolute', left: '0', top: '0', maxWidth: 'none', maxHeight: 'none',
      width: (splitState._layerBaseW * sc) + 'px',
      height: (splitState._layerBaseH * sc) + 'px',
      transform: `translate(${splitState.tx}px, ${splitState.ty}px)`,
      cursor: 'move', zIndex: '2',
    });
    // Page outline drawn ON TOP of the image (dashed) so you can see whether the
    // content goes outside the sheet while dragging. Doesn't block the drag.
    const outline = document.createElement('div');
    outline.className = 'folio-outline';
    zoom.appendChild(outline);
  }
  resetZoom();
  syncModalControls();
  updateScaleLabel();
}

function renderSplitDividers() {
  const zoom = getZoomEl();
  zoom.querySelectorAll('.split-divider-v, .split-divider-h, .split-tile-overlay').forEach(e => e.remove());

  const W = splitState._baseW, H = splitState._baseH;
  const colEdges = [0, ...splitState.colPositions.map(p => p * W), W];
  const rowEdges = [0, ...splitState.rowPositions.map(p => p * H), H];

  for (let r = 0; r < splitState.rows; r++) {
    for (let c = 0; c < splitState.cols; c++) {
      const ov = document.createElement('div');
      ov.className = 'split-tile-overlay';
      ov.style.left  = colEdges[c] + 'px';
      ov.style.top   = rowEdges[r] + 'px';
      ov.style.width  = (colEdges[c + 1] - colEdges[c]) + 'px';
      ov.style.height = (rowEdges[r + 1] - rowEdges[r]) + 'px';
      const lbl = document.createElement('div');
      lbl.className = 'split-tile-label';
      lbl.textContent = `T${r + 1}.${c + 1}`;
      ov.appendChild(lbl);
      zoom.appendChild(ov);
    }
  }

  splitState.colPositions.forEach((pos, i) => {
    const div = document.createElement('div');
    div.className = 'split-divider-v';
    div.style.left = (pos * 100) + '%';
    makeDraggable(div, 'col', i);
    zoom.appendChild(div);
  });

  splitState.rowPositions.forEach((pos, i) => {
    const div = document.createElement('div');
    div.className = 'split-divider-h';
    div.style.top = (pos * 100) + '%';
    makeDraggable(div, 'row', i);
    zoom.appendChild(div);
  });
}

function updateTileOverlays() {
  const zoom = getZoomEl();
  const W = splitState._baseW, H = splitState._baseH;
  const colEdges = [0, ...splitState.colPositions.map(p => p * W), W];
  const rowEdges = [0, ...splitState.rowPositions.map(p => p * H), H];
  zoom.querySelectorAll('.split-tile-overlay').forEach((ov, i) => {
    const c = i % splitState.cols;
    const r = Math.floor(i / splitState.cols);
    ov.style.left   = colEdges[c] + 'px';
    ov.style.top    = rowEdges[r] + 'px';
    ov.style.width  = (colEdges[c + 1] - colEdges[c]) + 'px';
    ov.style.height = (rowEdges[r + 1] - rowEdges[r]) + 'px';
  });
}

function makeDraggable(divider, axis, idx) {
  const zoom = getZoomEl();
  divider.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();   // don't trigger pan
    divider.setPointerCapture(e.pointerId);

    function onMove(me) {
      // Fraction from the zoom box's on-screen (transformed) rect → zoom/pan-safe.
      const rect = zoom.getBoundingClientRect();
      const pos = axis === 'col'
        ? Math.max(0.02, Math.min(0.98, (me.clientX - rect.left) / rect.width))
        : Math.max(0.02, Math.min(0.98, (me.clientY - rect.top) / rect.height));
      if (axis === 'col') {
        splitState.colPositions[idx] = pos;
        divider.style.left = (pos * 100) + '%';
      } else {
        splitState.rowPositions[idx] = pos;
        divider.style.top = (pos * 100) + '%';
      }
      updateTileOverlays();
    }

    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', () => {
      divider.removeEventListener('pointermove', onMove);
    }, { once: true });
  });
}

/* ── Zoom & pan ──────────────────────────────────────────────────────────── */
function zoomAt(factor, clientX, clientY) {
  const wrap = document.getElementById('split-preview-wrap');
  const rect = wrap.getBoundingClientRect();
  const cx = clientX == null ? rect.width / 2 : clientX - rect.left;
  const cy = clientY == null ? rect.height / 2 : clientY - rect.top;
  const newZoom = Math.max(1, Math.min(8, splitState.zoom * factor));
  // Keep the point under the cursor fixed while zooming.
  splitState.panX = cx - (cx - splitState.panX) / splitState.zoom * newZoom;
  splitState.panY = cy - (cy - splitState.panY) / splitState.zoom * newZoom;
  splitState.zoom = newZoom;
  if (newZoom === 1) {   // snap back to the centered fitted view
    splitState.panX = splitState._baseLeft || 0;
    splitState.panY = splitState._baseTop || 0;
  }
  applyZoom();
}

function startPan(e) {
  const wrap = document.getElementById('split-preview-wrap');
  e.preventDefault();
  wrap.setPointerCapture(e.pointerId);
  wrap.style.cursor = 'grabbing';
  const sx = e.clientX, sy = e.clientY;
  const bpx = splitState.panX, bpy = splitState.panY;
  function onMove(me) {
    splitState.panX = bpx + (me.clientX - sx);
    splitState.panY = bpy + (me.clientY - sy);
    applyZoom();
  }
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerup', () => {
    wrap.removeEventListener('pointermove', onMove);
    wrap.style.cursor = '';
  }, { once: true });
}

function startLayerDrag(e) {
  const img = document.getElementById('split-preview-img');
  e.preventDefault();
  img.setPointerCapture(e.pointerId);
  const sx = e.clientX, sy = e.clientY;
  const baseTx = splitState.tx, baseTy = splitState.ty;
  function onMove(me) {
    // Pointer delta is in screen px → divide by zoom to get base px.
    splitState.tx = baseTx + (me.clientX - sx) / splitState.zoom;
    splitState.ty = baseTy + (me.clientY - sy) / splitState.zoom;
    img.style.transform = `translate(${splitState.tx}px, ${splitState.ty}px)`;
    splitState.offsetX = (splitState.tx / splitState._baseW) * splitState._folioMM[0];
    splitState.offsetY = (splitState.ty / splitState._baseH) * splitState._folioMM[1];
  }
  img.addEventListener('pointermove', onMove);
  img.addEventListener('pointerup', () => img.removeEventListener('pointermove', onMove), { once: true });
}

function setupZoomPan() {
  const wrap = document.getElementById('split-preview-wrap');

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.split-divider-v, .split-divider-h')) return;  // divider handles it
    const img = document.getElementById('split-preview-img');
    if (!isSplitMode() && e.target === img) startLayerDrag(e);
    else startPan(e);
  });

  // Buttons resize the element for REAL (position mode); wheel = view-only zoom.
  document.getElementById('zoom-in').addEventListener('click', () => scaleStep(1.05));
  document.getElementById('zoom-out').addEventListener('click', () => scaleStep(1 / 1.05));
  document.getElementById('zoom-reset').addEventListener('click', resetScaleAndView);
}

function wireSplitControls() {
  document.getElementById('split-cols').addEventListener('change', () => {
    splitState.cols = Math.max(1, parseInt(document.getElementById('split-cols').value) || 1);
    splitState.colPositions = Array.from({length: splitState.cols - 1}, (_, i) => (i + 1) / splitState.cols);
    refreshModalMode();
  });

  document.getElementById('split-rows').addEventListener('change', () => {
    splitState.rows = Math.max(1, parseInt(document.getElementById('split-rows').value) || 1);
    splitState.rowPositions = Array.from({length: splitState.rows - 1}, (_, i) => (i + 1) / splitState.rows);
    refreshModalMode();
  });

  document.getElementById('split-overlap').addEventListener('input', () => {
    splitState.overlapMm = parseFloat(document.getElementById('split-overlap').value);
    document.getElementById('split-overlap-val').textContent = splitState.overlapMm + ' mm';
  });

  document.getElementById('split-tile-format').addEventListener('change', () => {
    splitState.tileFormat = document.getElementById('split-tile-format').value;
  });

  document.getElementById('btn-split-rotate').addEventListener('click', () => {
    splitState.rotation = (splitState.rotation + 90) % 360;
    const labels = ['↻ Biratu · 0°', '↻ Biratu · 90°', '↻ Biratu · 180°', '↻ Biratu · 270°'];
    document.getElementById('btn-split-rotate').textContent = labels[splitState.rotation / 90];
    // Reload preview from server with rotation applied
    const img = document.getElementById('split-preview-img');
    img.style.transform = '';
    img.src = '';
    img.onload = () => refreshModalMode();
    const rotParam = splitState.rotation ? `&rotation=${splitState.rotation}` : '';
    img.src = `/api/prints/${splitState.printId}/preview?hires=1${rotParam}&_=${Date.now()}`;
  });

  document.getElementById('modal-split').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSplitModal();
  });

  setupZoomPan();
}

async function submitSplit() {
  const btn = document.getElementById('btn-submit-split');
  btn.disabled = true;

  if (isSplitMode()) {
    btn.textContent = 'Zatitzen...';
    await safeCall(async () => {
      const result = await API.splitPrint(splitState.printId, {
        cols: splitState.cols,
        rows: splitState.rows,
        tile_format: splitState.tileFormat,
        overlap_mm: splitState.overlapMm,
        col_positions: splitState.colPositions.length ? splitState.colPositions : null,
        row_positions: splitState.rowPositions.length ? splitState.rowPositions : null,
        rotation: splitState.rotation,
      });
      closeSplitModal();
      await loadJob(state.selectedJobId);
      await loadJobs();
      showToast(`${result.tile_print_ids.length} tile sortuta ✓`);
    });
    btn.textContent = 'Zatitu';
  } else {
    btn.textContent = 'Gordetzen...';
    await safeCall(async () => {
      await API.editPrint(splitState.printId, {
        rotation: splitState.rotation,
        offset_x_mm: splitState.offsetX,
        offset_y_mm: splitState.offsetY,
        scale: splitState.layerScale || 1,
      });
      closeSplitModal();
      await loadJob(state.selectedJobId);
      await loadJobs();
      showToast('Geruza eguneratuta ✓');
    });
    btn.textContent = 'Gorde';
  }

  btn.disabled = false;
}

/* ── Wire up static buttons ─────────────────────────────────────────────── */
function wireButtons() {
  document.getElementById('btn-new-job').addEventListener('click', openNewJobModal);

  document.getElementById('btn-add-sheet').addEventListener('click', async () => {
    await safeCall(async () => {
      await API.addSheet(state.selectedJobId);
      await loadJob(state.selectedJobId);
      await loadJobs();
    });
  });

  document.getElementById('btn-activate-job').addEventListener('click', async () => {
    await safeCall(async () => {
      const job = state.selectedJob;
      if (job && job.source_user) {
        await API.activateUserJob(job.source_user, state.selectedJobId);
      } else {
        await API.activateJob(state.selectedJobId);
      }
      await loadJobs();
      await loadJob(state.selectedJobId);
      showToast('Lana aktibatuta');
    });
  });

  document.getElementById('btn-change-format').addEventListener('click', openFormatModal);

  // Iturriak dropdown: toggle on button click, close on outside click.
  document.getElementById('btn-iturriak').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('iturriak-panel').classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    const dd = document.getElementById('iturriak-dd');
    if (dd && !dd.contains(e.target)) {
      document.getElementById('iturriak-panel').classList.add('hidden');
    }
  });

  document.getElementById('btn-delete-job').addEventListener('click', async () => {
    if (!confirm(`"${state.selectedJob?.name}" lana ezabatu?\nBere PDF guztiak ezabatuko dira.`)) return;
    await safeCall(async () => {
      await API.deleteJob(state.selectedJobId);
      state.selectedJobId = null;
      state.selectedJob = null;
      document.getElementById('job-detail').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      await loadJobs();
      showToast('Lana ezabatuta');
    });
  });

  document.getElementById('btn-export-job').addEventListener('click', () => {
    if (!state.selectedJobId) return;
    requestExport(state.selectedJobId);
  });

  document.getElementById('modal-print-reminder').addEventListener('click', e => {
    if (e.target === e.currentTarget) closePrintReminder();
  });
  document.getElementById('modal-help').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeHelp();
  });

  const nameEl = document.getElementById('job-name');
  nameEl.addEventListener('blur', async () => {
    const newName = nameEl.textContent.trim();
    if (newName && state.selectedJob && newName !== state.selectedJob.name) {
      await safeCall(async () => {
        await API.updateJob(state.selectedJobId, { name: newName });
        await loadJobs();
        state.selectedJob.name = newName;
      });
    }
  });
  nameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
  });

  document.getElementById('modal-new-job').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewJobModal();
  });
  document.getElementById('modal-format').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFormatModal();
  });
  document.getElementById('new-job-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitNewJob();
  });
  wireSplitControls();
}

/* ── SSE ────────────────────────────────────────────────────────────────── */
function setupSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      await handleSSEEvent(msg);
    } catch (_) {}
  };
}

async function handleSSEEvent(msg) {
  const { type, data } = msg;
  switch (type) {
    case 'print_added':
    case 'print_deleted':
    case 'print_updated':
      await loadJobs();
      if (state.selectedJobId === data.job_id) await loadJob(data.job_id);
      break;
    case 'job_created':
    case 'job_updated':
    case 'job_activated':
      await loadJobs();
      if (state.selectedJobId === data.job_id) await loadJob(data.job_id);
      break;
    case 'job_deleted':
      if (state.selectedJobId === data.job_id) {
        state.selectedJobId = null;
        state.selectedJob = null;
        document.getElementById('job-detail').classList.add('hidden');
        document.getElementById('empty-state').classList.remove('hidden');
      }
      await loadJobs();
      break;
    case 'sheet_added':
    case 'sheet_updated':
    case 'sheet_deleted':
      await loadJobs();
      if (state.selectedJobId === data.job_id) await loadJob(data.job_id);
      break;
  }
}

/* ── Utility ────────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Expose globals ─────────────────────────────────────────────────────── */
window.openNewJobModal  = openNewJobModal;
window.closeNewJobModal = closeNewJobModal;
window.submitNewJob     = submitNewJob;
window.closeFormatModal = closeFormatModal;
window.submitFormat     = submitFormat;
window.closeSplitModal  = closeSplitModal;
window.submitSplit      = submitSplit;
window.openHelp         = openHelp;
window.closeHelp        = closeHelp;
window.closePrintReminder   = closePrintReminder;
window.confirmPrintReminder = confirmPrintReminder;

/* ── Init ───────────────────────────────────────────────────────────────── */
async function init() {
  wireButtons();
  await loadJobs();
  setupSSE();
}

init();
