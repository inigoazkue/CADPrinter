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

  deletePrint:     (id)         => API.request('DELETE', `/prints/${id}`),
  updatePrint:     (id, data)   => API.request('PATCH', `/prints/${id}`, data),
  splitPrint:      (id, params) => API.request('POST', `/prints/${id}/split`, params),
  editPrint:       (id, params) => API.request('POST', `/prints/${id}/edit`, params),
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
      <div class="job-card-meta">${job.sheet_count} orri · ${job.print_count} geruza</div>
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
  for (const sheet of job.sheets) {
    container.appendChild(renderSheet(sheet, job.format));
  }
}

function renderIturriakSheet(sheet) {
  const card = el('div', 'sheet-card sheet-iturriak');
  const header = el('div', 'iturriak-header');
  header.innerHTML = `<span class="iturriak-label">📁 Iturriak</span><span class="iturriak-hint">Jatorrizko fitxategia (erreferentzia)</span>`;
  card.appendChild(header);
  const printsRow = el('div', 'iturriak-prints');
  for (const p of sheet.prints) {
    const thumb = el('div', 'iturriak-thumb');
    const img = el('img');
    img.src = API.printPreviewUrl(p.id);
    img.onerror = () => img.style.display = 'none';
    const name = el('div', 'iturriak-name', escHtml((p.original_name || p.filename).replace(/\.\w+$/, '')));
    thumb.appendChild(img);
    thumb.appendChild(name);
    printsRow.appendChild(thumb);
  }
  card.appendChild(printsRow);
  return card;
}

function renderSheet(sheet, fmt) {
  if (sheet.name === 'Iturriak') {
    return renderIturriakSheet(sheet);
  }

  const card = el('div', 'sheet-card');
  card.dataset.sheetId = sheet.id;

  const header = el('div', 'sheet-header');

  const nameEl = el('span', 'sheet-name', escHtml(sheet.name || `Orria ${sheet.order_num}`));
  nameEl.contentEditable = 'true';
  nameEl.spellcheck = false;
  nameEl.addEventListener('blur', () => {
    const newName = nameEl.textContent.trim();
    if (newName && newName !== sheet.name) {
      safeCall(() => API.updateSheet(sheet.id, { name: newName }).then(() => loadJobs()));
    }
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
  previewCol.appendChild(el('div', 'sheet-preview-label', 'Aurrebista'));

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
  img.src = API.printPreviewUrl(p.id) + '?placed=1';
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
  splitState.tx = 0;
  splitState.ty = 0;

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
  img.src = API.printPreviewUrl(p.id) + '?_=' + Date.now();

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
      ? 'Arrastatu lerro beltzak zatiketa-puntua aldatzeko'
      : 'Arrastatu irudia kokapena doitzeko';
  }
  const h2 = document.querySelector('#modal-split h2');
  if (h2) h2.textContent = split ? 'PDF zatitu tilesetan' : 'Geruza editatu';
}

function resetImgStyles(img) {
  ['position', 'left', 'top', 'width', 'height', 'maxWidth', 'maxHeight', 'transform']
    .forEach(prop => { img.style[prop] = ''; });
}

function refreshModalMode() {
  const wrap = document.getElementById('split-preview-wrap');
  const img = document.getElementById('split-preview-img');
  wrap.querySelectorAll('.split-divider-v, .split-divider-h, .split-tile-overlay').forEach(e => e.remove());

  if (isSplitMode()) {
    // Tile mode: wrap hugs the image; show draggable cut lines + overlays.
    wrap.classList.remove('folio-box');
    wrap.style.width = '';
    wrap.style.height = '';
    resetImgStyles(img);
    img.style.cursor = 'default';
    renderSplitDividers();
  } else {
    // Position mode: the wrap is a DIN-proportioned folio; drag the layer.
    img.style.cursor = 'move';
    applyPositionTransform();
  }
  syncModalControls();
}

// Paper size in mm, flipped to landscape when `landscape` is true. Base is portrait.
function orientMM(fmt, landscape) {
  const mm = PAGE_SIZES_MM[fmt] || PAGE_SIZES_MM.A3;
  return landscape ? [mm[1], mm[0]] : [mm[0], mm[1]];
}

// Position mode: the preview box takes the FOLIO (sheet) proportions so you can
// see at a glance whether the layer fits inside; the layer image is sized
// relative to the folio and dragged with its offset.
function applyPositionTransform() {
  const wrap = document.getElementById('split-preview-wrap');
  const img = document.getElementById('split-preview-img');

  const landscape = img.naturalWidth > img.naturalHeight;
  const folio = orientMM(splitState.jobFmt, landscape);
  const layer = orientMM(splitState.layerFmt, landscape);

  // The box takes the folio proportions via CSS aspect-ratio (declarative,
  // so it's reliably DIN-shaped). We just feed it the ratio and read back size.
  wrap.classList.add('folio-box');
  wrap.style.width = '';
  wrap.style.height = '';
  wrap.style.setProperty('--folio-ar', (folio[0] / folio[1]).toFixed(4));
  const boxW = wrap.clientWidth;
  const boxH = wrap.clientHeight;

  // Layer image sized relative to the folio (A-series share ratio → no distortion).
  img.style.position = 'absolute';
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  img.style.left = '0';
  img.style.top = '0';
  img.style.width = (boxW * (layer[0] / folio[0])) + 'px';
  img.style.height = (boxH * (layer[1] / folio[1])) + 'px';

  splitState._folioMM = folio;
  splitState._boxW = boxW;
  splitState._boxH = boxH;
  splitState.tx = (splitState.offsetX / folio[0]) * boxW;
  splitState.ty = (splitState.offsetY / folio[1]) * boxH;
  img.style.transform = `translate(${splitState.tx}px, ${splitState.ty}px)`;
  setupPositionDrag(wrap, img);
}

function setupPositionDrag(wrap, img) {
  if (img._posDragWired) return;
  img._posDragWired = true;
  img.addEventListener('pointerdown', e => {
    if (isSplitMode()) return;
    e.preventDefault();
    img.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const baseTx = splitState.tx, baseTy = splitState.ty;
    function onMove(me) {
      splitState.tx = baseTx + (me.clientX - startX);
      splitState.ty = baseTy + (me.clientY - startY);
      img.style.transform = `translate(${splitState.tx}px, ${splitState.ty}px)`;
      splitState.offsetX = (splitState.tx / splitState._boxW) * splitState._folioMM[0];
      splitState.offsetY = (splitState.ty / splitState._boxH) * splitState._folioMM[1];
    }
    img.addEventListener('pointermove', onMove);
    img.addEventListener('pointerup', () => img.removeEventListener('pointermove', onMove), { once: true });
  });
}

function renderSplitDividers() {
  const wrap = document.getElementById('split-preview-wrap');
  wrap.querySelectorAll('.split-divider-v, .split-divider-h, .split-tile-overlay').forEach(e => e.remove());

  const W = wrap.clientWidth;
  const H = wrap.querySelector('img').clientHeight || wrap.clientHeight;

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
      wrap.appendChild(ov);
    }
  }

  splitState.colPositions.forEach((pos, i) => {
    const div = document.createElement('div');
    div.className = 'split-divider-v';
    div.style.left = (pos * 100) + '%';
    makeDraggable(div, 'col', i, wrap);
    wrap.appendChild(div);
  });

  splitState.rowPositions.forEach((pos, i) => {
    const div = document.createElement('div');
    div.className = 'split-divider-h';
    div.style.top = (pos * 100) + '%';
    makeDraggable(div, 'row', i, wrap);
    wrap.appendChild(div);
  });
}

function updateTileOverlays(wrap) {
  const W = wrap.clientWidth;
  const imgEl = wrap.querySelector('img');
  const H = imgEl ? imgEl.clientHeight : wrap.clientHeight;
  const colEdges = [0, ...splitState.colPositions.map(p => p * W), W];
  const rowEdges = [0, ...splitState.rowPositions.map(p => p * H), H];
  wrap.querySelectorAll('.split-tile-overlay').forEach((ov, i) => {
    const c = i % splitState.cols;
    const r = Math.floor(i / splitState.cols);
    ov.style.left   = colEdges[c] + 'px';
    ov.style.top    = rowEdges[r] + 'px';
    ov.style.width  = (colEdges[c + 1] - colEdges[c]) + 'px';
    ov.style.height = (rowEdges[r + 1] - rowEdges[r]) + 'px';
  });
}

function makeDraggable(divider, axis, idx, wrap) {
  divider.addEventListener('pointerdown', e => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    const rect = wrap.getBoundingClientRect();

    function onMove(me) {
      const pos = axis === 'col'
        ? Math.max(0.05, Math.min(0.95, (me.clientX - rect.left) / rect.width))
        : Math.max(0.05, Math.min(0.95, (me.clientY - rect.top) / rect.height));
      if (axis === 'col') {
        splitState.colPositions[idx] = pos;
        divider.style.left = (pos * 100) + '%';
      } else {
        splitState.rowPositions[idx] = pos;
        divider.style.top = (pos * 100) + '%';
      }
      updateTileOverlays(wrap);
    }

    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', () => {
      divider.removeEventListener('pointermove', onMove);
    }, { once: true });
  });
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
    const rotParam = splitState.rotation ? `?rotation=${splitState.rotation}` : '?_=' + Date.now();
    img.src = `/api/prints/${splitState.printId}/preview${rotParam}`;
  });

  document.getElementById('modal-split').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSplitModal();
  });
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
