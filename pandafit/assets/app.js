import { supabase } from './supabaseClient.js';

var DEFAULT_MONTHLY_GOAL = 12;
var RECORDS_PAGE_SIZE = 5;
var EVOLUTION_MONTHS = 6;

var WORKOUT_TYPES = [
  { name: 'Musculação', hint: 'força' },
  { name: 'Jiu Jitsu', hint: 'tatame' },
  { name: 'Corrida', hint: 'rua' },
];

var MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ── state ──
var state = {
  tab: 'painel',
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
  monthlyGoal: DEFAULT_MONTHLY_GOAL,
  savingGoal: false,
};
var timerHandle = null;

// ── helpers ──
function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function fmtDuration(min) {
  var h = Math.floor(min / 60), m = min % 60;
  return h ? h + 'h ' + pad(m) : m + ' min';
}

function fmtDayLabel(iso) {
  var parts = iso.split('-');
  return parts[2] + '/' + parts[1];
}

// First day 00:00 .. last day 23:59:59 of the calendar month containing `date`.
function monthRange(date) {
  var start = new Date(date.getFullYear(), date.getMonth(), 1);
  var end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start: start, end: end };
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
    .select('monthly_goal')
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

// ── DOM refs ──
var $ = function (sel) { return document.querySelector(sel); };

var els = {
  screens: {
    painel: $('#screen-painel'),
    registrar: $('#screen-registrar'),
    meta: $('#screen-meta'),
  },
  monthLabel: $('#month-label'),
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
  toast: $('#toast'),
  btnSave: $('#btn-save'),

  inputGoal: $('#input-goal'),
  btnSaveGoal: $('#btn-save-goal'),
  goalToast: $('#goal-toast'),
  metaProgressBar: $('#meta-progress-bar'),
  metaProgressPct: $('#meta-progress-pct'),
  metaProgressCount: $('#meta-progress-count'),
  evolutionList: $('#evolution-list'),
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
}

function renderActiveTab() {
  if (state.tab === 'painel') renderPainel();
  if (state.tab === 'meta') renderMeta();
}

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

// ── save ──
function liveMinutes() {
  if (state.mode === 'timer') {
    return Math.max(1, Math.round(state.secs / 60));
  }
  return Math.max(1, parseInt(state.minsVal, 10) || 0);
}

els.btnSave.addEventListener('click', function () {
  if (state.saving) return;

  var min = liveMinutes();
  var dateISO = state.mode === 'timer' ? todayISO() : (state.dateVal || todayISO());
  var local = state.local.trim();
  var wasTimer = state.mode === 'timer';

  state.saving = true;
  els.btnSave.disabled = true;

  insertWorkout({ date: dateISO, type: state.type, minutes: min, local: local })
    .then(function (row) {
      state.workouts.unshift(row);
      state.recordsPage = 0;

      if (wasTimer) {
        state.secs = 0;
        state.running = false;
        updateTimerControls();
        updateClock();
      }
      showToast(state.type + ' de ' + fmtDuration(min) + ' registrado. Boa!');
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

function handleDeleteClick(id) {
  if (state.deletingId) return;
  if (!window.confirm('Excluir este treino? Essa ação não pode ser desfeita.')) return;

  state.deletingId = id;
  deleteWorkout(id)
    .then(function () {
      state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
    })
    .catch(function (err) {
      console.error('Falha ao excluir treino', err);
      window.alert('Não foi possível excluir. Tente de novo.');
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
  var now = new Date();
  els.monthLabel.textContent = MONTHS_PT[now.getMonth()] + ' ' + now.getFullYear();

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

  var range = monthRange(now);
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
      return '<div class="record-row">' +
        '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
        '<span class="record-mid"><span class="record-type">' + w.type + '</span>' +
        '<span class="record-local">' + (w.local || 'Sem local') + '</span></span>' +
        '<span class="record-dur">' + fmtDuration(w.minutes) + '</span>' +
        '<button type="button" class="record-delete" data-id="' + w.id + '" aria-label="Excluir treino">' +
        '<svg width="15" height="16" viewBox="0 0 15 16" fill="none"><path d="M1 4h13M5.5 4V2a1 1 0 011-1h2a1 1 0 011 1v2m2 0v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4h9zM6 7.3v4M9 7.3v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '</div>';
    }).join('');

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
startTimerLoop();
renderRegistrar();
setTab('painel');

fetchWorkouts()
  .then(function (rows) {
    state.workouts = rows;
    state.loading = false;
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
  })
  .catch(function (err) {
    console.error('Falha ao carregar meta', err);
  })
  .finally(renderActiveTab);
