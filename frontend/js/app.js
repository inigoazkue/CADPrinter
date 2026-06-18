/* ── State ─────────────────────────────────────────────────────────────── */
const state = {
  jobs: [],
  selectedJobId: null,
  selectedJob: null,   // full job with sheets + prints
  currentJobId: null,  // is_current = 1
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

  getJobs:       ()           => API.request('GET', '/jobs'),
  getJob:        (id)         => API.request('GET', `/jobs/${id}`),
  createJob:     (name, fmt)  => API.request('POST', '/jobs', { name, format: fmt }),
  updateJob:     (id, data)   => API.request('PATCH', `/jobs/${id}`, data),
  deleteJob:     (id)         => API.request('DELETE', `/jobs/${id}`),
  activateJob:   (id)         => API.request('POST', `/jobs/${id}/activate`),
  exportJobUrl:  (id)         => `/api/jobs/${id}/export`,

  addSheet:      (jobId)      => API.request('POST', `/jobs/${jobId}/sheets`),
  updateSheet:   (id, data)   => API.request('PATCH', `/sheets/${id}`, data),
  deleteSheet:   (id)         => API.request('DELETE', `/sheets/${id}`),
  sheetPreviewUrl: (id)       => `/api/sheets/${id}/preview?t=${Date.now()}`,

  deletePrint:   (id)         => API.request('DELETE', `/prints/${id}`),
  updatePrint:   (id, data)   => API.request('PATCH', `/prints/${id}`, data),
  printPreviewUrl: (id)       => `/api/prints/${id}/preview`,

  async uploadPrint(sheetId, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/sheets/${sheetId}/prints`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

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
  catch (e) { showToast(e.message || 'Error', true); }
}

/* ── Load & refresh ────────────────────────────────────────────────────── */
async function loadJobs() {
  state.jobs = await API.getJobs();
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
function renderSidebar() {
  const list = document.getElementById('job-list');
  if (!state.jobs.length) {
    list.innerHTML = '<p class="empty-hint">Sin trabajos</p>';
    return;
  }
  list.innerHTML = '';
  for (const job of state.jobs) {
    const card = el('div', 'job-card');
    if (job.id === state.selectedJobId) card.classList.add('selected');
    if (job.is_current) card.classList.add('active-job');

    card.innerHTML = `
      <div class="job-card-indicator" title="Trabajo activo"></div>
      <div class="job-card-body">
        <div class="job-card-name">${escHtml(job.name)}</div>
        <div class="job-card-meta">${job.sheet_count} hojas · ${job.print_count} capas</div>
        <span class="format-pill">${job.format}</span>
      </div>`;
    card.addEventListener('click', () => selectJob(job.id));
    list.appendChild(card);
  }
}

async function selectJob(id) {
  state.selectedJobId = id;
  renderSidebar();
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('job-detail').classList.remove('hidden');
  await safeCall(() => loadJob(id));
}

/* ── Job detail ─────────────────────────────────────────────────────────── */
function renderJobDetail() {
  const job = state.selectedJob;
  if (!job) return;

  // Header
  document.getElementById('job-name').textContent = job.name;
  document.getElementById('job-format-badge').textContent = job.format;

  const isActive = job.is_current;
  const activateBtn = document.getElementById('btn-activate-job');
  if (isActive) {
    activateBtn.textContent = '● Activo';
    activateBtn.style.color = 'var(--success)';
  } else {
    activateBtn.textContent = 'Activar';
    activateBtn.style.color = '';
  }

  // Sheets
  const container = document.getElementById('sheets-container');
  container.innerHTML = '';
  for (const sheet of job.sheets) {
    container.appendChild(renderSheet(sheet, job.format));
  }
}

function renderSheet(sheet, fmt) {
  const card = el('div', 'sheet-card');
  card.dataset.sheetId = sheet.id;

  // Header
  const header = el('div', 'sheet-header');
  const nameEl = el('span', 'sheet-name', escHtml(sheet.name || `Hoja ${sheet.order_num}`));
  nameEl.contentEditable = 'true';
  nameEl.spellcheck = false;
  nameEl.addEventListener('blur', () => {
    const newName = nameEl.textContent.trim();
    if (newName && newName !== sheet.name) {
      safeCall(() => API.updateSheet(sheet.id, { name: newName }).then(() => loadJobs()));
    }
  });
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });

  const actions = el('div', 'sheet-actions');

  // Upload button (hidden file input)
  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = '.pdf,application/pdf';
  uploadInput.style.display = 'none';
  uploadInput.addEventListener('change', () => {
    if (uploadInput.files[0]) uploadToSheet(sheet.id, uploadInput.files[0]);
    uploadInput.value = '';
  });

  const uploadBtn = el('button', 'btn-upload-here', '⬆ Añadir capa');
  uploadBtn.addEventListener('click', () => uploadInput.click());

  const deleteBtn = el('button', 'btn btn-ghost', '🗑 Hoja');
  deleteBtn.style.fontSize = '12px';
  deleteBtn.style.padding = '4px 8px';
  deleteBtn.addEventListener('click', () => confirmDeleteSheet(sheet.id));

  actions.appendChild(uploadInput);
  actions.appendChild(uploadBtn);
  actions.appendChild(deleteBtn);
  header.appendChild(nameEl);
  header.appendChild(actions);

  // Body: prints grid
  const body = el('div', 'sheet-body');
  const grid = el('div', 'prints-grid');
  grid.dataset.sheetId = sheet.id;

  // Setup drop target
  setupSheetDropTarget(grid, sheet.id);

  for (const p of sheet.prints) {
    grid.appendChild(renderPrint(p, sheet.id));
  }

  if (!sheet.prints.length) {
    const hint = el('p', '', '<span style="color:var(--text-muted);font-size:13px">Sin capas. Arrastra un PDF aquí o usa ⬆ Añadir capa.</span>');
    grid.appendChild(hint);
  }

  body.appendChild(grid);

  // Combined preview
  if (sheet.prints.some(p => p.enabled)) {
    const previewSec = el('div', 'sheet-preview-section');
    previewSec.innerHTML = '<div class="sheet-preview-label">Vista previa combinada</div>';
    const img = el('img', 'sheet-preview-img');
    img.alt = 'Vista previa';
    img.src = API.sheetPreviewUrl(sheet.id);
    img.onerror = () => img.style.display = 'none';
    previewSec.appendChild(img);
    body.appendChild(previewSec);
  }

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function renderPrint(p, sheetId) {
  const thumb = el('div', 'print-thumb' + (p.enabled ? '' : ' disabled'));
  thumb.dataset.printId = p.id;
  thumb.draggable = true;

  const img = el('img');
  img.src = API.printPreviewUrl(p.id);
  img.alt = p.original_name || p.filename;
  img.onerror = () => { img.style.background = '#f1f5f9'; img.alt = ''; };

  const footer = el('div', 'print-thumb-footer', escHtml((p.original_name || p.filename).replace(/\.\w+$/, '')));
  footer.title = p.original_name || p.filename;

  const controls = el('div', 'print-thumb-controls');

  const toggleBtn = el('button', 'ctrl-btn toggle' + (p.enabled ? ' on' : ''), p.enabled ? '✓' : '○');
  toggleBtn.title = p.enabled ? 'Deshabilitar' : 'Habilitar';
  toggleBtn.addEventListener('click', e => {
    e.stopPropagation();
    safeCall(() => API.updatePrint(p.id, { enabled: !p.enabled }).then(() => loadJob(state.selectedJobId)));
  });

  const delBtn = el('button', 'ctrl-btn del', '✕');
  delBtn.title = 'Eliminar capa';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    confirmDeletePrint(p.id);
  });

  controls.appendChild(toggleBtn);
  controls.appendChild(delBtn);
  thumb.appendChild(img);
  thumb.appendChild(footer);
  thumb.appendChild(controls);

  // Drag from print
  thumb.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ printId: p.id, fromSheetId: sheetId }));
    thumb.classList.add('dragging');
    setTimeout(() => thumb.classList.add('dragging'), 0);
  });
  thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'));

  return thumb;
}

/* ── Drag & drop (move prints between sheets) ──────────────────────────── */
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
    showToast('Solo se admiten archivos PDF', true);
    return;
  }
  showToast('Subiendo capa…');
  await safeCall(async () => {
    await API.uploadPrint(sheetId, file);
    await loadJob(state.selectedJobId);
    await loadJobs();
    showToast('Capa añadida');
  });
}

/* ── Job actions ────────────────────────────────────────────────────────── */
async function confirmDeleteSheet(sheetId) {
  if (!confirm('¿Borrar esta hoja? Sus capas pasarán a la primera hoja.')) return;
  await safeCall(async () => {
    await API.deleteSheet(sheetId);
    await refresh();
    showToast('Hoja eliminada');
  });
}

async function confirmDeletePrint(printId) {
  if (!confirm('¿Eliminar esta capa?')) return;
  await safeCall(async () => {
    await API.deletePrint(printId);
    await loadJob(state.selectedJobId);
    await loadJobs();
    showToast('Capa eliminada');
  });
}

/* ── Modal: New job ─────────────────────────────────────────────────────── */
function openNewJobModal() {
  document.getElementById('new-job-name').value = '';
  document.getElementById('new-job-format').value = 'A3';
  document.getElementById('new-job-activate').checked = true;
  document.getElementById('modal-new-job').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-job-name').focus(), 50);
}

function closeNewJobModal() {
  document.getElementById('modal-new-job').classList.add('hidden');
}

async function submitNewJob() {
  const name = document.getElementById('new-job-name').value.trim();
  const fmt  = document.getElementById('new-job-format').value;
  const activate = document.getElementById('new-job-activate').checked;
  if (!name) { document.getElementById('new-job-name').focus(); return; }

  await safeCall(async () => {
    const job = await API.createJob(name, fmt);
    if (!activate) {
      // creation already activates; de-activate if not wanted by restoring previous
      // (for MVP, creation always activates — checkbox is informational)
    }
    closeNewJobModal();
    await loadJobs();
    await selectJob(job.id);
    showToast('Trabajo creado');
  });
}

/* ── Modal: Format ──────────────────────────────────────────────────────── */
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
    showToast('Formato actualizado');
  });
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
      await API.activateJob(state.selectedJobId);
      await loadJobs();
      await loadJob(state.selectedJobId);
      showToast('Trabajo activado — las nuevas impresiones irán aquí');
    });
  });

  document.getElementById('btn-change-format').addEventListener('click', openFormatModal);

  document.getElementById('btn-delete-job').addEventListener('click', async () => {
    if (!confirm(`¿Borrar el trabajo "${state.selectedJob?.name}"? Se eliminarán todas sus capas.`)) return;
    await safeCall(async () => {
      await API.deleteJob(state.selectedJobId);
      state.selectedJobId = null;
      state.selectedJob = null;
      document.getElementById('job-detail').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      await loadJobs();
      showToast('Trabajo eliminado');
    });
  });

  document.getElementById('btn-export-job').addEventListener('click', () => {
    if (!state.selectedJobId) return;
    const a = document.createElement('a');
    a.href = API.exportJobUrl(state.selectedJobId);
    a.download = '';
    a.click();
  });

  // Job name inline edit
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

  // Modal close on backdrop click
  document.getElementById('modal-new-job').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewJobModal();
  });
  document.getElementById('modal-format').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFormatModal();
  });

  // New job modal Enter key
  document.getElementById('new-job-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitNewJob();
  });
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
  es.onerror = () => {
    // reconnect automatically (browser does this by default for EventSource)
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

/* ── Expose globals for inline onclick ──────────────────────────────────── */
window.openNewJobModal  = openNewJobModal;
window.closeNewJobModal = closeNewJobModal;
window.submitNewJob     = submitNewJob;
window.closeFormatModal = closeFormatModal;
window.submitFormat     = submitFormat;

/* ── Init ───────────────────────────────────────────────────────────────── */
async function init() {
  wireButtons();
  await loadJobs();
  setupSSE();
}

init();
