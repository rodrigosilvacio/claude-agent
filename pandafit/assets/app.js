import { supabase } from './supabaseClient.js?v=11';

var DEFAULT_MONTHLY_GOAL = 12;
var RECORDS_PAGE_SIZE = 5;
var EVOLUTION_MONTHS = 6;
var MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
var MAX_WORKOUT_MINUTES = 720;
var MAX_MONTH_OFFSET = 60;
var MAX_STREAK_LOOKBACK = 240;
var WEIGHT_CHART_MAX_POINTS = 30;

var WORKOUT_TYPES = [
  { name: 'Musculação', hint: 'força' },
  { name: 'Jiu Jitsu', hint: 'tatame' },
  { name: 'Corrida', hint: 'rua' },
];

var MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

var DELETE_ICON_SVG = '<svg width="15" height="16" viewBox="0 0 15 16" fill="none"><path d="M1 4h13M5.5 4V2a1 1 0 011-1h2a1 1 0 011 1v2m2 0v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4h9zM6 7.3v4M9 7.3v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var EDIT_ICON_SVG = '<svg width="15" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.3 2.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4l-7.6 7.6-3 .7.7-3 7.5-7.7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>';

// ── state ──
var state = {
  tab: 'painel',
  registrarSection: 'treino',
  mode: 'manual',
  running: false,
  secs: 0,
  type: WORKOUT_TYPES[0].name,
  local: '',
  dateVal: todayISO(),
  minsVal: 60,
  workouts: [],
  loading: true,
  loadError: false,
  saving: false,
  recordsPage: 0,
  deletingId: null,
  editingWorkoutId: null,
  painelMonthOffset: 0,
  monthlyGoal: DEFAULT_MONTHLY_GOAL,
  savingGoal: false,
  targetWeight: null,
  savingTargetWeight: false,
  weights: [],
  weightsLoading: true,
  weightsLoadError: false,
  weightDateVal: todayISO(),
  weightVal: '',
  savingWeight: false,
  weightsPage: 0,
  deletingWeightId: null,
  editingWeightId: null,
  documents: [],
  documentsLoading: true,
  documentsLoadError: false,
  uploadingDocument: false,
  documentsPage: 0,
  deletingDocumentId: null,
};
var timerHandle = null;

// ── helpers ──
function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// Belt-and-suspenders alongside the input's max attribute: a typed (not
// picked) date can still slip past native validation in some browsers.
function clampDateToToday(iso) {
  var today = todayISO();
  return iso > today ? today : iso;
}

function fmtDuration(min) {
  var h = Math.floor(min / 60), m = min % 60;
  return h ? h + 'h ' + pad(m) : m + ' min';
}

function fmtDayLabel(iso) {
  var parts = iso.split('-');
  return parts[2] + '/' + parts[1];
}

function fmtWeight(kg) {
  return (Math.round(kg * 10) / 10).toFixed(1).replace('.', ',');
}

function fmtFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

// First day 00:00 .. last day 23:59:59 of the calendar month containing `date`.
function monthRange(date) {
  var start = new Date(date.getFullYear(), date.getMonth(), 1);
  var end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start: start, end: end };
}

// The calendar month currently shown on the Painel screen: offset 0 is the
// present month, 1 is the month before, etc.
function viewedMonthDate() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - state.painelMonthOffset, 1);
}

// Consecutive months, counting back from the current one, where the
// workout count met or exceeded the monthly goal. Breaks at the first
// (most recent) month that fell short — including the current month if
// it hasn't hit the goal yet.
function computeGoalStreak() {
  var goal = state.monthlyGoal;
  if (!goal) return 0;
  var now = new Date();
  var streak = 0;
  for (var i = 0; i < MAX_STREAK_LOOKBACK; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var range = monthRange(d);
    var count = state.workouts.filter(function (w) {
      var wd = parseISO(w.date);
      return wd >= range.start && wd <= range.end;
    }).length;
    if (count < goal) break;
    streak++;
  }
  return streak;
}

function parseISO(iso) {
  var parts = iso.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// ── Supabase persistence ──
async function fetchWorkouts() {
  var { data, error } = await supabase
    .from('pandafit_workouts')
    .select('id, date, type, minutes, local')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}

async function insertWorkout(row) {
  var { data, error } = await supabase
    .from('pandafit_workouts')
    .insert(row)
    .select('id, date, type, minutes, local')
    .single();
  if (error) throw error;
  return data;
}

async function updateWorkout(id, patch) {
  var { data, error } = await supabase
    .from('pandafit_workouts')
    .update(patch)
    .eq('id', id)
    .select('id, date, type, minutes, local')
    .single();
  if (error) throw error;
  return data;
}

async function deleteWorkout(id) {
  var { error } = await supabase
    .from('pandafit_workouts')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

async function fetchSettings() {
  var { data, error } = await supabase
    .from('pandafit_settings')
    .select('monthly_goal, target_weight_kg')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return data;
}

async function updateSettings(monthlyGoal) {
  var { error } = await supabase
    .from('pandafit_settings')
    .update({ monthly_goal: monthlyGoal, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
}

async function updateTargetWeight(kg) {
  var { error } = await supabase
    .from('pandafit_settings')
    .update({ target_weight_kg: kg, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
}

async function fetchWeights() {
  var { data, error } = await supabase
    .from('pandafit_weights')
    .select('id, date, weight_kg')
    .order('date', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}

// Upsert on `date`: correcting today's weight overwrites the row instead of
// creating a second entry for the same day.
async function upsertWeight(row) {
  var { data, error } = await supabase
    .from('pandafit_weights')
    .upsert(row, { onConflict: 'date' })
    .select('id, date, weight_kg')
    .single();
  if (error) throw error;
  return data;
}

async function updateWeight(id, patch) {
  var { data, error } = await supabase
    .from('pandafit_weights')
    .update(patch)
    .eq('id', id)
    .select('id, date, weight_kg')
    .single();
  if (error) throw error;
  return data;
}

async function deleteWeight(id) {
  var { error } = await supabase
    .from('pandafit_weights')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

async function fetchDocuments() {
  var { data, error } = await supabase
    .from('pandafit_documents')
    .select('id, file_name, file_path, file_type, file_size, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

async function uploadDocument(file) {
  var path = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var { error: uploadError } = await supabase.storage
    .from('pandafit-documents')
    .upload(path, file);
  if (uploadError) throw uploadError;

  var { data, error } = await supabase
    .from('pandafit_documents')
    .insert({
      file_name: file.name,
      file_path: path,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
    })
    .select('id, file_name, file_path, file_type, file_size, uploaded_at')
    .single();
  if (error) throw error;
  return data;
}

async function deleteDocument(doc) {
  await supabase.storage.from('pandafit-documents').remove([doc.file_path]);
  var { error } = await supabase
    .from('pandafit_documents')
    .delete()
    .eq('id', doc.id);
  if (error) throw error;
}

function documentPublicUrl(path) {
  return supabase.storage.from('pandafit-documents').getPublicUrl(path).data.publicUrl;
}

// ── DOM refs ──
var $ = function (sel) { return document.querySelector(sel); };

var els = {
  screens: {
    painel: $('#screen-painel'),
    registrar: $('#screen-registrar'),
    meta: $('#screen-meta'),
    documentos: $('#screen-documentos'),
  },
  monthLabel: $('#month-label'),
  monthPrev: $('#month-prev'),
  monthNext: $('#month-next'),
  monthCount: $('#month-count'),
  monthGoalSuffix: $('#month-goal-suffix'),
  goalBar: $('#goal-bar'),
  goalPct: $('#goal-pct'),
  goalMeta: $('#goal-meta'),
  splitsList: $('#splits-list'),
  recordsList: $('#records-list'),
  sessionCountNote: $('#session-count-note'),
  recordsPager: $('#records-pager'),
  pagerPrev: $('#pager-prev'),
  pagerNext: $('#pager-next'),
  pagerNote: $('#pager-note'),

  modeTabs: document.querySelectorAll('.mode-tab'),
  modeTabsWrap: $('#mode-tabs'),
  registrarTitle: $('#registrar-title'),
  btnCancelEdit: $('#btn-cancel-edit'),
  sectionTreino: $('#section-treino'),
  sectionPeso: $('#section-peso'),
  saveBarTreino: $('#save-bar-treino'),
  timerCard: $('#timer-card'),
  manualFields: $('#manual-fields'),
  timerDot: $('#timer-dot'),
  timerRunLabel: $('#timer-run-label'),
  clock: $('#clock'),
  btnToggleRun: $('#btn-toggle-run'),
  btnResetRun: $('#btn-reset-run'),
  inputDate: $('#input-date'),
  inputMins: $('#input-mins'),
  typeOptions: $('#type-options'),
  inputLocal: $('#input-local'),
  localSuggestions: $('#local-suggestions'),
  toast: $('#toast'),
  btnSave: $('#btn-save'),
  btnSaveLabel: $('#btn-save-label'),

  inputGoal: $('#input-goal'),
  btnSaveGoal: $('#btn-save-goal'),
  goalToast: $('#goal-toast'),
  metaProgressBar: $('#meta-progress-bar'),
  metaProgressPct: $('#meta-progress-pct'),
  metaProgressCount: $('#meta-progress-count'),
  metaStreakNote: $('#meta-streak-note'),
  evolutionList: $('#evolution-list'),
  inputTargetWeight: $('#input-target-weight'),
  btnSaveTargetWeight: $('#btn-save-target-weight'),
  targetWeightToast: $('#target-weight-toast'),
  targetWeightCaption: $('#target-weight-caption'),
  targetWeightCurrent: $('#target-weight-current'),
  targetWeightRemaining: $('#target-weight-remaining'),

  inputWeightDate: $('#input-weight-date'),
  inputWeightValue: $('#input-weight-value'),
  btnSaveWeight: $('#btn-save-weight'),
  btnSaveWeightLabel: $('#btn-save-weight-label'),
  weightToast: $('#weight-toast'),
  weightChartWrap: $('#weight-chart-wrap'),
  weightsList: $('#weights-list'),
  weightCountNote: $('#weight-count-note'),
  weightsPager: $('#weights-pager'),
  weightsPagerPrev: $('#weights-pager-prev'),
  weightsPagerNext: $('#weights-pager-next'),
  weightsPagerNote: $('#weights-pager-note'),

  inputDocumentFile: $('#input-document-file'),
  btnUploadDocument: $('#btn-upload-document'),
  documentToast: $('#document-toast'),
  documentsList: $('#documents-list'),
  documentCountNote: $('#document-count-note'),
  documentsPager: $('#documents-pager'),
  documentsPagerPrev: $('#documents-pager-prev'),
  documentsPagerNext: $('#documents-pager-next'),
  documentsPagerNote: $('#documents-pager-note'),

  confirmModal: $('#confirm-modal'),
  confirmModalMessage: $('#confirm-modal-message'),
  confirmModalCancel: $('#confirm-modal-cancel'),
  confirmModalConfirm: $('#confirm-modal-confirm'),
};

// ── tab bar wiring ──
document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () { setTab(btn.dataset.tab); });
});

function setTab(tab) {
  state.tab = tab;
  Object.keys(els.screens).forEach(function (key) {
    els.screens[key].hidden = key !== tab;
  });
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'painel') renderPainel();
  if (tab === 'meta') renderMeta();
  if (tab === 'registrar') setRegistrarSection(state.registrarSection);
  if (tab === 'documentos') renderDocuments();
}

function renderActiveTab() {
  if (state.tab === 'painel') renderPainel();
  if (state.tab === 'meta') renderMeta();
  if (state.tab === 'registrar' && state.registrarSection === 'peso') renderWeights();
  if (state.tab === 'documentos') renderDocuments();
}

// ── registrar: treino / peso toggle ──
function setRegistrarSection(section) {
  state.registrarSection = section;
  document.querySelectorAll('.section-tab').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.section === section);
  });
  els.sectionTreino.hidden = section !== 'treino';
  els.sectionPeso.hidden = section !== 'peso';
  els.saveBarTreino.hidden = section !== 'treino';
  updateEditUI();
  if (section === 'peso') renderWeights();
}

// ── editing an existing workout/weight instead of only insert/delete ──
function updateEditUI() {
  var editingTreino = state.editingWorkoutId != null;
  var editingPeso = state.editingWeightId != null;
  var editingCurrent = (state.registrarSection === 'treino' && editingTreino) ||
    (state.registrarSection === 'peso' && editingPeso);

  els.btnCancelEdit.hidden = !editingCurrent;
  els.registrarTitle.textContent = state.registrarSection === 'treino'
    ? (editingTreino ? 'Editar treino' : 'Registrar treino')
    : (editingPeso ? 'Editar peso' : 'Registrar peso');
  els.modeTabsWrap.hidden = editingTreino;
  els.btnSaveLabel.textContent = editingTreino ? 'Salvar alterações' : 'Salvar treino';
  els.btnSaveWeightLabel.textContent = editingPeso ? 'Salvar alterações' : 'Salvar peso';
}

function startEditWorkout(w) {
  state.editingWorkoutId = w.id;
  state.editingWeightId = null;
  state.mode = 'manual';
  stopTimer();
  state.dateVal = w.date;
  state.minsVal = w.minutes;
  state.type = w.type;
  state.local = w.local || '';
  state.registrarSection = 'treino';
  setTab('registrar');
  renderRegistrar();
  updateEditUI();
}

function cancelEditWorkout() {
  state.editingWorkoutId = null;
  state.dateVal = todayISO();
  state.minsVal = 60;
  state.type = WORKOUT_TYPES[0].name;
  state.local = '';
  renderRegistrar();
  updateEditUI();
}

function startEditWeight(w) {
  state.editingWeightId = w.id;
  state.editingWorkoutId = null;
  state.weightDateVal = w.date;
  state.weightVal = fmtWeight(w.weight_kg);
  state.registrarSection = 'peso';
  setTab('registrar');
  renderWeights();
  updateEditUI();
}

function cancelEditWeight() {
  state.editingWeightId = null;
  state.weightDateVal = todayISO();
  state.weightVal = '';
  renderWeights();
  updateEditUI();
}

els.btnCancelEdit.addEventListener('click', function () {
  if (state.registrarSection === 'treino') cancelEditWorkout();
  else cancelEditWeight();
});

document.querySelectorAll('.section-tab').forEach(function (btn) {
  btn.addEventListener('click', function () { setRegistrarSection(btn.dataset.section); });
});

// ── painel month navigation ──
els.monthPrev.addEventListener('click', function () {
  if (state.painelMonthOffset >= MAX_MONTH_OFFSET) return;
  state.painelMonthOffset += 1;
  state.recordsPage = 0;
  renderPainel();
});
els.monthNext.addEventListener('click', function () {
  if (state.painelMonthOffset <= 0) return;
  state.painelMonthOffset -= 1;
  state.recordsPage = 0;
  renderPainel();
});

// ── records pagination ──
els.pagerPrev.addEventListener('click', function () {
  if (state.recordsPage > 0) {
    state.recordsPage -= 1;
    renderPainel();
  }
});
els.pagerNext.addEventListener('click', function () {
  state.recordsPage += 1;
  renderPainel();
});

els.weightsPagerPrev.addEventListener('click', function () {
  if (state.weightsPage > 0) {
    state.weightsPage -= 1;
    renderWeights();
  }
});
els.weightsPagerNext.addEventListener('click', function () {
  state.weightsPage += 1;
  renderWeights();
});

els.documentsPagerPrev.addEventListener('click', function () {
  if (state.documentsPage > 0) {
    state.documentsPage -= 1;
    renderDocuments();
  }
});
els.documentsPagerNext.addEventListener('click', function () {
  state.documentsPage += 1;
  renderDocuments();
});

// ── mode tabs (Cronômetro / Manual) ──
els.modeTabs.forEach(function (btn) {
  btn.addEventListener('click', function () {
    state.mode = btn.dataset.mode;
    if (state.mode === 'manual') stopTimer();
    renderRegistrar();
  });
});

// ── timer ──
function startTimerLoop() {
  if (timerHandle) return;
  timerHandle = setInterval(function () {
    if (state.running) {
      state.secs += 1;
      updateClock();
    }
  }, 1000);
}

function stopTimer() {
  state.running = false;
  updateTimerControls();
}

els.btnToggleRun.addEventListener('click', function () {
  state.running = !state.running;
  updateTimerControls();
});

els.btnResetRun.addEventListener('click', function () {
  state.running = false;
  state.secs = 0;
  updateTimerControls();
  updateClock();
});

function updateClock() {
  var mm = Math.floor(state.secs / 60), ss = state.secs % 60;
  els.clock.textContent = pad(mm) + ':' + pad(ss);
}

function updateTimerControls() {
  els.timerDot.classList.toggle('running', state.running);
  els.timerRunLabel.textContent = state.running ? 'Em andamento' : 'Pausado';
  els.btnToggleRun.textContent = state.running ? 'Pausar' : 'Iniciar';
  els.btnToggleRun.classList.toggle('is-running', state.running);
}

// ── manual fields ──
els.inputDate.addEventListener('change', function (e) {
  state.dateVal = e.target.value || todayISO();
});
els.inputMins.addEventListener('input', function (e) {
  state.minsVal = e.target.value;
});
els.inputLocal.addEventListener('input', function (e) {
  state.local = e.target.value;
});

// ── workout type picker ──
function renderTypeOptions() {
  els.typeOptions.innerHTML = WORKOUT_TYPES.map(function (t) {
    var active = t.name === state.type;
    return '<button type="button" class="type-option' + (active ? ' active' : '') + '" data-type="' + t.name + '">' +
      '<span class="type-mark"></span>' +
      '<span class="type-name">' + t.name + '</span>' +
      '<span class="type-hint">' + t.hint + '</span>' +
      '</button>';
  }).join('');
  els.typeOptions.querySelectorAll('.type-option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.type = btn.dataset.type;
      renderTypeOptions();
    });
  });
}

// Suggests locals already used, most recent first, via the input's <datalist>.
function updateLocalSuggestions() {
  var seen = {};
  var locals = [];
  state.workouts.forEach(function (w) {
    if (w.local && !seen[w.local]) {
      seen[w.local] = true;
      locals.push(w.local);
    }
  });
  els.localSuggestions.innerHTML = locals.map(function (loc) {
    return '<option value="' + loc.replace(/"/g, '&quot;') + '"></option>';
  }).join('');
}

// ── save ──
function liveMinutes() {
  if (state.mode === 'timer') {
    return Math.min(MAX_WORKOUT_MINUTES, Math.max(1, Math.round(state.secs / 60)));
  }
  return Math.min(MAX_WORKOUT_MINUTES, Math.max(1, parseInt(state.minsVal, 10) || 0));
}

els.btnSave.addEventListener('click', function () {
  if (state.saving) return;

  var min = liveMinutes();
  var dateISO = state.mode === 'timer' ? todayISO() : clampDateToToday(state.dateVal || todayISO());
  var local = state.local.trim();
  var wasTimer = state.mode === 'timer';
  var editingId = state.editingWorkoutId;

  state.saving = true;
  els.btnSave.disabled = true;

  var patch = { date: dateISO, type: state.type, minutes: min, local: local };
  var op = editingId != null ? updateWorkout(editingId, patch) : insertWorkout(patch);

  op
    .then(function (row) {
      if (editingId != null) {
        state.workouts = state.workouts.map(function (w) { return w.id === row.id ? row : w; });
        state.editingWorkoutId = null;
        updateEditUI();
        showToast('Treino atualizado.');
      } else {
        state.workouts.unshift(row);
        state.recordsPage = 0;
        if (wasTimer) {
          state.secs = 0;
          state.running = false;
          updateTimerControls();
          updateClock();
        }
        showToast(state.type + ' de ' + fmtDuration(min) + ' registrado. Boa!');
      }
      updateLocalSuggestions();
      renderPainel();
    })
    .catch(function (err) {
      console.error('Falha ao salvar treino', err);
      showToast('Não foi possível salvar. Tente de novo.');
    })
    .finally(function () {
      state.saving = false;
      els.btnSave.disabled = false;
    });
});

// ── confirm modal (replaces window.confirm to match the app's own look) ──
function confirmModal(message) {
  return new Promise(function (resolve) {
    els.confirmModalMessage.textContent = message;
    els.confirmModal.hidden = false;

    function onCancel() { finish(false); }
    function onConfirm() { finish(true); }
    function finish(result) {
      els.confirmModal.hidden = true;
      els.confirmModalCancel.removeEventListener('click', onCancel);
      els.confirmModalConfirm.removeEventListener('click', onConfirm);
      resolve(result);
    }

    els.confirmModalCancel.addEventListener('click', onCancel);
    els.confirmModalConfirm.addEventListener('click', onConfirm);
  });
}

async function handleDeleteClick(id) {
  if (state.deletingId) return;
  var ok = await confirmModal('Excluir este treino? Essa ação não pode ser desfeita.');
  if (!ok) return;

  state.deletingId = id;
  deleteWorkout(id)
    .then(function () {
      state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
      if (state.editingWorkoutId === id) cancelEditWorkout();
    })
    .catch(function (err) {
      console.error('Falha ao excluir treino', err);
      showToast('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingId = null;
      renderPainel();
    });
}

function makeToaster(el) {
  var handle = null;
  return function (msg) {
    clearTimeout(handle);
    el.textContent = msg;
    el.hidden = false;
    handle = setTimeout(function () { el.hidden = true; }, 4000);
  };
}

var showToast = makeToaster(els.toast);
var showGoalToast = makeToaster(els.goalToast);
var showWeightToast = makeToaster(els.weightToast);
var showDocumentToast = makeToaster(els.documentToast);
var showTargetWeightToast = makeToaster(els.targetWeightToast);

// ── weight fields ──
els.inputWeightDate.addEventListener('change', function (e) {
  state.weightDateVal = e.target.value || todayISO();
});
els.inputWeightValue.addEventListener('input', function (e) {
  state.weightVal = e.target.value;
});

els.btnSaveWeight.addEventListener('click', function () {
  if (state.savingWeight) return;

  var dateISO = clampDateToToday(state.weightDateVal || todayISO());
  var weight = parseFloat(String(state.weightVal).replace(',', '.'));
  if (!weight || weight <= 0 || weight >= 500) {
    showWeightToast('Informe um peso válido (entre 0 e 500 kg).');
    return;
  }
  var editingId = state.editingWeightId;

  state.savingWeight = true;
  els.btnSaveWeight.disabled = true;

  var op = editingId != null
    ? updateWeight(editingId, { date: dateISO, weight_kg: weight })
    : upsertWeight({ date: dateISO, weight_kg: weight });

  op
    .then(function (row) {
      state.weights = state.weights.filter(function (w) { return w.id !== row.id && w.date !== row.date; });
      state.weights.push(row);
      state.weights.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      state.weightsPage = 0;
      if (editingId != null) {
        state.editingWeightId = null;
        updateEditUI();
        showWeightToast('Peso atualizado.');
      } else {
        showWeightToast('Peso de ' + fmtWeight(row.weight_kg) + ' kg registrado em ' + fmtDayLabel(row.date) + '.');
      }
      renderWeights();
    })
    .catch(function (err) {
      console.error('Falha ao salvar peso', err);
      showWeightToast('Não foi possível salvar. Tente de novo.');
    })
    .finally(function () {
      state.savingWeight = false;
      els.btnSaveWeight.disabled = false;
    });
});

async function handleDeleteWeightClick(id) {
  if (state.deletingWeightId) return;
  var ok = await confirmModal('Excluir este registro de peso? Essa ação não pode ser desfeita.');
  if (!ok) return;

  state.deletingWeightId = id;
  deleteWeight(id)
    .then(function () {
      state.weights = state.weights.filter(function (w) { return w.id !== id; });
      if (state.editingWeightId === id) cancelEditWeight();
    })
    .catch(function (err) {
      console.error('Falha ao excluir peso', err);
      showWeightToast('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingWeightId = null;
      renderWeights();
    });
}

els.btnUploadDocument.addEventListener('click', function () {
  if (state.uploadingDocument) return;

  var file = els.inputDocumentFile.files && els.inputDocumentFile.files[0];
  if (!file) {
    showDocumentToast('Escolha um arquivo primeiro.');
    return;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    showDocumentToast('Arquivo maior que 10MB. Escolha um menor.');
    return;
  }

  state.uploadingDocument = true;
  els.btnUploadDocument.disabled = true;

  uploadDocument(file)
    .then(function (doc) {
      state.documents.unshift(doc);
      state.documentsPage = 0;
      els.inputDocumentFile.value = '';
      renderDocuments();
      showDocumentToast(doc.file_name + ' enviado.');
    })
    .catch(function (err) {
      console.error('Falha ao enviar documento', err);
      showDocumentToast('Não foi possível enviar. Tente de novo.');
    })
    .finally(function () {
      state.uploadingDocument = false;
      els.btnUploadDocument.disabled = false;
    });
});

async function handleDeleteDocumentClick(doc) {
  if (state.deletingDocumentId) return;
  var ok = await confirmModal('Excluir "' + doc.file_name + '"? Essa ação não pode ser desfeita.');
  if (!ok) return;

  state.deletingDocumentId = doc.id;
  deleteDocument(doc)
    .then(function () {
      state.documents = state.documents.filter(function (d) { return d.id !== doc.id; });
    })
    .catch(function (err) {
      console.error('Falha ao excluir documento', err);
      showDocumentToast('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingDocumentId = null;
      renderDocuments();
    });
}

// ── render: Registrar screen ──
function renderRegistrar() {
  els.modeTabs.forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  });
  els.timerCard.hidden = state.mode !== 'timer';
  els.manualFields.hidden = state.mode !== 'manual';

  els.inputDate.value = state.dateVal;
  els.inputMins.value = state.minsVal;
  els.inputLocal.value = state.local;

  updateTimerControls();
  updateClock();
  renderTypeOptions();
}

// ── render: Painel screen ──
function renderPainel() {
  var viewDate = viewedMonthDate();
  els.monthLabel.textContent = MONTHS_PT[viewDate.getMonth()] + ' ' + viewDate.getFullYear();
  els.monthPrev.disabled = state.painelMonthOffset >= MAX_MONTH_OFFSET;
  els.monthNext.disabled = state.painelMonthOffset <= 0;

  if (state.loading) {
    els.recordsList.innerHTML = '<p class="empty-state">Carregando treinos…</p>';
    els.splitsList.innerHTML = '';
    return;
  }

  if (state.loadError) {
    els.recordsList.innerHTML = '<p class="empty-state">Não foi possível carregar os treinos. Recarregue a página.</p>';
    els.splitsList.innerHTML = '';
    return;
  }

  var range = monthRange(viewDate);
  var monthWorkouts = state.workouts.filter(function (w) {
    var d = parseISO(w.date);
    return d >= range.start && d <= range.end;
  });

  var goal = state.monthlyGoal;
  var count = monthWorkouts.length;
  var goalPct = goal ? Math.min(100, Math.round((count / goal) * 100)) : 0;

  els.monthCount.textContent = count;
  els.monthGoalSuffix.textContent = 'de ' + goal;
  els.goalBar.style.width = goalPct + '%';
  els.goalPct.textContent = goalPct + '% da meta';
  els.goalMeta.textContent = 'meta ' + goal + (goal === 1 ? ' treino/mês' : ' treinos/mês');
  els.sessionCountNote.textContent = count + ' neste mês';

  // breakdown by type
  var totalMinutes = monthWorkouts.reduce(function (a, w) { return a + w.minutes; }, 0);
  els.splitsList.innerHTML = WORKOUT_TYPES.map(function (t) {
    var min = monthWorkouts.filter(function (w) { return w.type === t.name; })
      .reduce(function (a, w) { return a + w.minutes; }, 0);
    var pct = totalMinutes ? Math.round((min / totalMinutes) * 100) : 0;
    return '<div class="split-row">' +
      '<div class="split-top"><span class="split-name">' + t.name + '</span>' +
      '<span class="split-value">' + fmtDuration(min) + '</span></div>' +
      '<div class="split-bar"><div class="split-bar-fill" style="width:' + pct + '%"></div>' +
      '<span class="split-pct">' + pct + '%</span></div>' +
      '</div>';
  }).join('');

  // recent records (this month, most recent first), paginated 5 at a time
  if (monthWorkouts.length === 0) {
    els.recordsList.innerHTML = '<p class="empty-state">Nenhum treino registrado neste mês ainda.</p>';
    els.recordsPager.hidden = true;
    state.recordsPage = 0;
  } else {
    var pageCount = Math.ceil(monthWorkouts.length / RECORDS_PAGE_SIZE);
    if (state.recordsPage >= pageCount) state.recordsPage = pageCount - 1;
    if (state.recordsPage < 0) state.recordsPage = 0;

    var start = state.recordsPage * RECORDS_PAGE_SIZE;
    var pageItems = monthWorkouts.slice(start, start + RECORDS_PAGE_SIZE);

    els.recordsList.innerHTML = pageItems.map(function (w) {
      return '<div class="record-row has-edit">' +
        '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
        '<span class="record-mid"><span class="record-type">' + w.type + '</span>' +
        '<span class="record-local">' + (w.local || 'Sem local') + '</span></span>' +
        '<span class="record-dur">' + fmtDuration(w.minutes) + '</span>' +
        '<button type="button" class="record-edit" data-id="' + w.id + '" aria-label="Editar treino">' +
        EDIT_ICON_SVG +
        '</button>' +
        '<button type="button" class="record-delete" data-id="' + w.id + '" aria-label="Excluir treino">' +
        DELETE_ICON_SVG +
        '</button>' +
        '</div>';
    }).join('');

    els.recordsList.querySelectorAll('.record-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var w = state.workouts.find(function (x) { return x.id === Number(btn.dataset.id); });
        if (w) startEditWorkout(w);
      });
    });
    els.recordsList.querySelectorAll('.record-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleDeleteClick(Number(btn.dataset.id));
      });
    });

    els.recordsPager.hidden = pageCount <= 1;
    els.pagerNote.textContent = 'Página ' + (state.recordsPage + 1) + ' de ' + pageCount;
    els.pagerPrev.disabled = state.recordsPage === 0;
    els.pagerNext.disabled = state.recordsPage >= pageCount - 1;
  }
}

// ── render: Meta screen ──
function renderMeta() {
  els.inputGoal.value = state.monthlyGoal;
  els.inputTargetWeight.value = state.targetWeight != null ? fmtWeight(state.targetWeight) : '';
  renderTargetWeightProgress();

  if (state.loading || state.loadError) {
    els.evolutionList.innerHTML = '';
    return;
  }

  var now = new Date();
  var goal = state.monthlyGoal;
  var range = monthRange(now);
  var monthCount = state.workouts.filter(function (w) {
    var d = parseISO(w.date);
    return d >= range.start && d <= range.end;
  }).length;
  var pct = goal ? Math.min(100, Math.round((monthCount / goal) * 100)) : 0;

  els.metaProgressBar.style.width = pct + '%';
  els.metaProgressPct.textContent = pct + '% da meta';
  els.metaProgressCount.textContent = monthCount + ' de ' + goal + (goal === 1 ? ' treino' : ' treinos');

  var streak = computeGoalStreak();
  els.metaStreakNote.classList.toggle('is-active', streak > 0);
  els.metaStreakNote.textContent = streak > 0
    ? streak + (streak === 1 ? ' mês seguido batendo a meta' : ' meses seguidos batendo a meta')
    : 'Ainda sem sequência — bata a meta este mês para começar.';

  var months = [];
  for (var i = EVOLUTION_MONTHS - 1; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTHS_PT[d.getMonth()] + '/' + String(d.getFullYear()).slice(2) });
  }

  els.evolutionList.innerHTML = months.map(function (m) {
    var mCount = state.workouts.filter(function (w) {
      var d = parseISO(w.date);
      return d.getFullYear() === m.year && d.getMonth() === m.month;
    }).length;
    var barPct = goal ? Math.min(100, Math.round((mCount / goal) * 100)) : 0;
    var isCurrent = m.year === now.getFullYear() && m.month === now.getMonth();
    return '<div class="evolution-row' + (isCurrent ? ' is-current' : '') + '">' +
      '<span class="evolution-label">' + m.label + '</span>' +
      '<div class="evolution-bar"><div class="evolution-bar-fill" style="width:' + barPct + '%"></div></div>' +
      '<span class="evolution-count">' + mCount + '</span>' +
      '</div>';
  }).join('');
}

function renderTargetWeightProgress() {
  var target = state.targetWeight;
  if (!target || state.weightsLoading || state.weightsLoadError || state.weights.length === 0) {
    els.targetWeightCaption.hidden = true;
    return;
  }
  var latest = state.weights[0]; // sorted date desc
  var diff = latest.weight_kg - target;
  els.targetWeightCaption.hidden = false;
  els.targetWeightCurrent.textContent = 'atual ' + fmtWeight(latest.weight_kg) + ' kg';
  els.targetWeightRemaining.textContent = Math.abs(diff) < 0.05
    ? 'meta batida!'
    : 'faltam ' + fmtWeight(Math.abs(diff)) + ' kg para ' + fmtWeight(target) + ' kg';
}

els.btnSaveTargetWeight.addEventListener('click', function () {
  if (state.savingTargetWeight) return;

  var raw = String(els.inputTargetWeight.value).trim();
  var kg = raw === '' ? null : parseFloat(raw.replace(',', '.'));
  if (raw !== '' && (!kg || kg <= 0 || kg >= 500)) {
    showTargetWeightToast('Informe um peso válido (entre 0 e 500 kg), ou deixe em branco para remover a meta.');
    return;
  }

  state.savingTargetWeight = true;
  els.btnSaveTargetWeight.disabled = true;

  updateTargetWeight(kg)
    .then(function () {
      state.targetWeight = kg;
      renderTargetWeightProgress();
      showTargetWeightToast(kg ? 'Meta de peso atualizada para ' + fmtWeight(kg) + ' kg.' : 'Meta de peso removida.');
    })
    .catch(function (err) {
      console.error('Falha ao salvar meta de peso', err);
      showTargetWeightToast('Não foi possível salvar. Tente de novo.');
    })
    .finally(function () {
      state.savingTargetWeight = false;
      els.btnSaveTargetWeight.disabled = false;
    });
});

// Simple SVG line chart of the weight trend. `var()` colors are set via the
// `style` attribute (not presentation attributes) so they resolve like any
// other CSS and repaint automatically when the dark-mode media query flips.
function renderWeightChart() {
  var wrap = els.weightChartWrap;
  if (state.weightsLoading || state.weightsLoadError) {
    wrap.innerHTML = '';
    return;
  }

  var asc = state.weights.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  if (asc.length < 2) {
    wrap.innerHTML = '<p class="empty-state">Registre pelo menos 2 pesos para ver o gráfico.</p>';
    return;
  }

  var recent = asc.slice(-WEIGHT_CHART_MAX_POINTS);
  var values = recent.map(function (w) { return w.weight_kg; });
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (min === max) { min -= 1; max += 1; }

  var W = 300, H = 100, PAD = 6;
  var n = recent.length;
  var pts = recent.map(function (w, i) {
    var x = n === 1 ? W / 2 : (i / (n - 1)) * (W - PAD * 2) + PAD;
    var y = H - PAD - ((w.weight_kg - min) / (max - min)) * (H - PAD * 2);
    return { x: x, y: y };
  });
  var pathD = pts.map(function (p, i) {
    return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
  }).join(' ');
  var last = pts[pts.length - 1];
  var first = recent[0];
  var lastWeight = recent[n - 1];

  wrap.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="weight-chart">' +
    '<path d="' + pathD + '" fill="none" style="stroke:var(--accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round" />' +
    '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3.5" style="fill:var(--accent)" />' +
    '</svg>' +
    '<div class="chart-caption">' +
    '<span>' + fmtDayLabel(first.date) + ' · ' + fmtWeight(first.weight_kg) + ' kg</span>' +
    '<span class="chart-caption-current">' + fmtDayLabel(lastWeight.date) + ' · ' + fmtWeight(lastWeight.weight_kg) + ' kg</span>' +
    '</div>';
}

// ── render: Peso screen ──
function renderWeights() {
  els.inputWeightDate.value = state.weightDateVal;
  els.inputWeightValue.value = state.weightVal;
  renderWeightChart();

  if (state.weightsLoading) {
    els.weightsList.innerHTML = '<p class="empty-state">Carregando pesos…</p>';
    els.weightsPager.hidden = true;
    return;
  }

  if (state.weightsLoadError) {
    els.weightsList.innerHTML = '<p class="empty-state">Não foi possível carregar os pesos. Recarregue a página.</p>';
    els.weightsPager.hidden = true;
    return;
  }

  var sorted = state.weights; // already sorted date desc
  els.weightCountNote.textContent = sorted.length + (sorted.length === 1 ? ' registro' : ' registros');

  if (sorted.length === 0) {
    els.weightsList.innerHTML = '<p class="empty-state">Nenhum peso registrado ainda.</p>';
    els.weightsPager.hidden = true;
    state.weightsPage = 0;
    return;
  }

  var pageCount = Math.ceil(sorted.length / RECORDS_PAGE_SIZE);
  if (state.weightsPage >= pageCount) state.weightsPage = pageCount - 1;
  if (state.weightsPage < 0) state.weightsPage = 0;

  var start = state.weightsPage * RECORDS_PAGE_SIZE;
  var pageItems = sorted.slice(start, start + RECORDS_PAGE_SIZE);

  els.weightsList.innerHTML = pageItems.map(function (w, i) {
    var prev = sorted[start + i + 1]; // next-older entry, chronologically
    var trendClass = '';
    var deltaLabel = '—';
    if (prev) {
      var diff = w.weight_kg - prev.weight_kg;
      if (diff > 0.05) { trendClass = 'weight-up'; deltaLabel = '▲ ' + fmtWeight(diff); }
      else if (diff < -0.05) { trendClass = 'weight-down'; deltaLabel = '▼ ' + fmtWeight(Math.abs(diff)); }
      else { deltaLabel = '= 0,0'; }
    }
    return '<div class="record-row has-edit">' +
      '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
      '<span class="weight-value">' + fmtWeight(w.weight_kg) + ' kg</span>' +
      '<span class="weight-delta ' + trendClass + '">' + deltaLabel + '</span>' +
      '<button type="button" class="record-edit" data-id="' + w.id + '" aria-label="Editar peso">' +
      EDIT_ICON_SVG +
      '</button>' +
      '<button type="button" class="record-delete" data-id="' + w.id + '" aria-label="Excluir peso">' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');

  els.weightsList.querySelectorAll('.record-edit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var w = state.weights.find(function (x) { return x.id === Number(btn.dataset.id); });
      if (w) startEditWeight(w);
    });
  });
  els.weightsList.querySelectorAll('.record-delete').forEach(function (btn) {
    btn.addEventListener('click', function () {
      handleDeleteWeightClick(Number(btn.dataset.id));
    });
  });

  els.weightsPager.hidden = pageCount <= 1;
  els.weightsPagerNote.textContent = 'Página ' + (state.weightsPage + 1) + ' de ' + pageCount;
  els.weightsPagerPrev.disabled = state.weightsPage === 0;
  els.weightsPagerNext.disabled = state.weightsPage >= pageCount - 1;
}

// ── render: Documentos screen ──
function renderDocuments() {
  if (state.documentsLoading) {
    els.documentsList.innerHTML = '<p class="empty-state">Carregando documentos…</p>';
    els.documentsPager.hidden = true;
    return;
  }

  if (state.documentsLoadError) {
    els.documentsList.innerHTML = '<p class="empty-state">Não foi possível carregar os documentos. Recarregue a página.</p>';
    els.documentsPager.hidden = true;
    return;
  }

  var sorted = state.documents; // already sorted uploaded_at desc
  els.documentCountNote.textContent = sorted.length + (sorted.length === 1 ? ' documento' : ' documentos');

  if (sorted.length === 0) {
    els.documentsList.innerHTML = '<p class="empty-state">Nenhum documento enviado ainda.</p>';
    els.documentsPager.hidden = true;
    state.documentsPage = 0;
    return;
  }

  var pageCount = Math.ceil(sorted.length / RECORDS_PAGE_SIZE);
  if (state.documentsPage >= pageCount) state.documentsPage = pageCount - 1;
  if (state.documentsPage < 0) state.documentsPage = 0;

  var start = state.documentsPage * RECORDS_PAGE_SIZE;
  var pageItems = sorted.slice(start, start + RECORDS_PAGE_SIZE);

  els.documentsList.innerHTML = pageItems.map(function (doc) {
    return '<div class="record-row">' +
      '<span class="record-day">' + fmtDayLabel(doc.uploaded_at.slice(0, 10)) + '</span>' +
      '<span class="record-mid"><span class="record-type">' + doc.file_name + '</span>' +
      '<span class="record-local">' + fmtFileSize(doc.file_size) + '</span></span>' +
      '<a class="record-dur doc-view-link" href="' + documentPublicUrl(doc.file_path) + '" target="_blank" rel="noopener">Ver</a>' +
      '<button type="button" class="record-delete" data-id="' + doc.id + '" aria-label="Excluir documento">' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');

  els.documentsList.querySelectorAll('.record-delete').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var doc = state.documents.find(function (d) { return d.id === Number(btn.dataset.id); });
      if (doc) handleDeleteDocumentClick(doc);
    });
  });

  els.documentsPager.hidden = pageCount <= 1;
  els.documentsPagerNote.textContent = 'Página ' + (state.documentsPage + 1) + ' de ' + pageCount;
  els.documentsPagerPrev.disabled = state.documentsPage === 0;
  els.documentsPagerNext.disabled = state.documentsPage >= pageCount - 1;
}

els.btnSaveGoal.addEventListener('click', function () {
  if (state.savingGoal) return;

  var val = parseInt(els.inputGoal.value, 10);
  if (!val || val < 1) val = 1;
  if (val > 30) val = 30;
  els.inputGoal.value = val;

  state.savingGoal = true;
  els.btnSaveGoal.disabled = true;

  updateSettings(val)
    .then(function () {
      state.monthlyGoal = val;
      renderPainel();
      renderMeta();
      showGoalToast('Meta atualizada para ' + val + (val === 1 ? ' treino/mês.' : ' treinos/mês.'));
    })
    .catch(function (err) {
      console.error('Falha ao salvar meta', err);
      showGoalToast('Não foi possível salvar a meta. Tente de novo.');
    })
    .finally(function () {
      state.savingGoal = false;
      els.btnSaveGoal.disabled = false;
    });
});

// ── init ──
els.inputDate.value = state.dateVal;
els.inputDate.max = todayISO();
els.inputWeightDate.value = state.weightDateVal;
els.inputWeightDate.max = todayISO();
startTimerLoop();
renderRegistrar();
setTab('painel');

fetchWorkouts()
  .then(function (rows) {
    state.workouts = rows;
    state.loading = false;
    updateLocalSuggestions();
  })
  .catch(function (err) {
    console.error('Falha ao carregar treinos', err);
    state.loading = false;
    state.loadError = true;
  })
  .finally(renderActiveTab);

fetchSettings()
  .then(function (row) {
    state.monthlyGoal = row.monthly_goal;
    state.targetWeight = row.target_weight_kg;
  })
  .catch(function (err) {
    console.error('Falha ao carregar meta', err);
  })
  .finally(renderActiveTab);

fetchWeights()
  .then(function (rows) {
    state.weights = rows;
    state.weightsLoading = false;
  })
  .catch(function (err) {
    console.error('Falha ao carregar pesos', err);
    state.weightsLoading = false;
    state.weightsLoadError = true;
  })
  .finally(renderActiveTab);

fetchDocuments()
  .then(function (rows) {
    state.documents = rows;
    state.documentsLoading = false;
  })
  .catch(function (err) {
    console.error('Falha ao carregar documentos', err);
    state.documentsLoading = false;
    state.documentsLoadError = true;
  })
  .finally(renderActiveTab);
