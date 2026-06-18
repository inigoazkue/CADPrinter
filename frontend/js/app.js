/* ── State ─────────────────────────────────────────────────────────────── */
const state = {
  jobs: [],
  selectedJobId: null,
  selectedJob: null,
  currentJobId: null,
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
  getJob:          (id)         => API.request('GET', `/jobs/${id}`),
  createJob:       (name, fmt)  => API.request('POST', '/jobs', { name, format: fmt }),
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

function iconPrinter(size = 13) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
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
    const card = el('div', 'job-card' +
      (job.id === state.selectedJobId ? ' selected' : '') +
      (job.is_current ? ' active-job' : ''));

    // Clickable main area
    const main = el('div', 'job-card-main');
    main.innerHTML = `
      <div class="job-card-indicator" title="Trabajo activo"></div>
      <div class="job-card-info">
        <div class="job-card-name">${escHtml(job.name)}</div>
        <div class="job-card-meta">${job.sheet_count} hojas · ${job.print_count} capas</div>
        <span class="format-pill">${job.format}</span>
      </div>`;
    main.addEventListener('click', () => selectJob(job.id));

    // Action buttons (appear on hover)
    const btns = el('div', 'job-card-btns');

    const printBtn = el('button', 'jc-btn', iconPrinter());
    printBtn.title = 'Imprimir trabajo';
    printBtn.addEventListener('click', e => { e.stopPropagation(); printJob(job.id); });

    const renameBtn = el('button', 'jc-btn', iconPencil());
    renameBtn.title = 'Renombrar';
    renameBtn.addEventListener('click', e => { e.stopPropagation(); renameJob(job.id, job.name); });

    const deleteBtn = el('button', 'jc-btn jc-btn-danger', iconTrash());
    deleteBtn.title = 'Borrar trabajo';
    deleteBtn.addEventListener('click', e => { e.stopPropagation(); deleteJobSidebar(job.id, job.name); });

    btns.appendChild(printBtn);
    btns.appendChild(renameBtn);
    btns.appendChild(deleteBtn);
    card.appendChild(main);
    card.appendChild(btns);
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

/* ── Job actions from sidebar ───────────────────────────────────────────── */
function printJob(id) {
  window.open('/api/jobs/' + id + '/export', '_blank');
}

async function renameJob(id, currentName) {
  const newName = prompt('Nuevo nombre:', currentName);
  if (!newName || newName.trim() === currentName) return;
  await safeCall(async () => {
    await API.updateJob(id, { name: newName.trim() });
    await loadJobs();
    if (state.selectedJobId === id) await loadJob(id);
    showToast('Trabajo renombrado');
  });
}

async function deleteJobSidebar(id, name) {
  if (!confirm(`¿Borrar "${name}"?\nSe eliminarán todos sus PDFs.`)) return;
  await safeCall(async () => {
    await API.deleteJob(id);
    if (state.selectedJobId === id) {
      state.selectedJobId = null;
      state.selectedJob = null;
      document.getElementById('job-detail').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
    }
    await loadJobs();
    showToast('Trabajo eliminado');
  });
}

/* ── Job detail ─────────────────────────────────────────────────────────── */
function renderJobDetail() {
  const job = state.selectedJob;
  if (!job) return;

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

  const container = document.getElementById('sheets-container');
  container.innerHTML = '';
  for (const sheet of job.sheets) {
    container.appendChild(renderSheet(sheet, job.format));
  }
}

function renderSheet(sheet, fmt) {
  const card = el('div', 'sheet-card');
  card.dataset.sheetId = sheet.id;

  const header = el('div', 'sheet-header');

  // Sheet name (editable)
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

  // Large trash icon right next to sheet name
  const deleteSheetBtn = el('button', 'btn-delete-sheet', iconTrash(17));
  deleteSheetBtn.title = 'Borrar hoja';
  deleteSheetBtn.addEventListener('click', () => confirmDeleteSheet(sheet.id));

  // Upload PDF manually
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

  // Body: prints grid
  const body = el('div', 'sheet-body');
  const grid = el('div', 'prints-grid');
  grid.dataset.sheetId = sheet.id;

  setupSheetDropTarget(grid, sheet.id);

  for (const p of sheet.prints) {
    grid.appendChild(renderPrint(p, sheet.id, fmt));
  }

  if (!sheet.prints.length) {
    const hint = el('p', '', '<span style="color:var(--text-muted);font-size:13px">Sin capas. Arrastra un PDF aquí o usa ⬆ PDF bat igo eskuz.</span>');
    grid.appendChild(hint);
  }

  const printsCol = el('div', 'sheet-prints-col');
  printsCol.appendChild(grid);
  body.appendChild(printsCol);

  // Preview column (right side)
  const previewCol = el('div', 'sheet-preview-col');
  const previewLabel = el('div', 'sheet-preview-label', 'Vista previa');
  previewCol.appendChild(previewLabel);

  if (sheet.prints.some(p => p.enabled)) {
    const img = el('img', 'sheet-preview-img');
    img.alt = 'Vista previa';
    img.src = API.sheetPreviewUrl(sheet.id);
    img.onerror = () => img.style.display = 'none';
    previewCol.appendChild(img);
  } else {
    previewCol.appendChild(el('div', 'sheet-preview-empty', 'Sin capas activas'));
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

  // Format mismatch warning badge
  if (p.format && jobFmt && p.format !== jobFmt) {
    const warn = el('div', 'format-warn', `⚠ ${p.format}`);
    warn.title = `Este PDF es ${p.format} pero el trabajo es ${jobFmt}`;
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
    showToast('Solo se admiten archivos PDF', true);
    return;
  }
  showToast('Subiendo…');
  await safeCall(async () => {
    await API.uploadPrint(sheetId, file);
    await loadJob(state.selectedJobId);
    await loadJobs();
    showToast('PDF añadido');
  });
}

/* ── Sheet / print actions ──────────────────────────────────────────────── */
async function confirmDeleteSheet(sheetId) {
  if (!confirm('¿Borrar esta hoja?\nSus capas pasarán a la primera hoja.')) return;
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
  if (!name) { document.getElementById('new-job-name').focus(); return; }

  await safeCall(async () => {
    const job = await API.createJob(name, fmt);
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
      showToast('Trabajo activado');
    });
  });

  document.getElementById('btn-change-format').addEventListener('click', openFormatModal);

  document.getElementById('btn-delete-job').addEventListener('click', async () => {
    if (!confirm(`¿Borrar el trabajo "${state.selectedJob?.name}"?\nSe eliminarán todos sus PDFs.`)) return;
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

  // Open PDF in new tab → Chrome PDF viewer → Ctrl+P to print
  document.getElementById('btn-export-job').addEventListener('click', () => {
    if (!state.selectedJobId) return;
    window.open(API.exportJobUrl(state.selectedJobId), '_blank');
  });

  // Job name inline edit (main panel)
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
