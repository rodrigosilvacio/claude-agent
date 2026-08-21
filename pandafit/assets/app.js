(function () {
  'use strict';

  var STORAGE_KEY = 'pandafit.workouts';
  var WEEKLY_GOAL_HOURS = 8;

  var WORKOUT_TYPES = [
    { name: 'Musculação', hint: 'força' },
    { name: 'Jiu Jitsu', hint: 'tatame' },
    { name: 'Corrida', hint: 'rua' },
  ];

  var MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  // ── state ──
  var state = {
    tab: 'painel',
    mode: 'timer',
    running: false,
    secs: 0,
    type: WORKOUT_TYPES[0].name,
    local: '',
    dateVal: todayISO(),
    minsVal: 60,
    workouts: loadWorkouts(),
  };
  var timerHandle = null;
  var toastHandle = null;

  // ── helpers ──
  function pad(n) { return String(n).padStart(2, '0'); }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function loadWorkouts() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveWorkouts() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.workouts));
    } catch (e) { /* storage unavailable */ }
  }

  function fmtDuration(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h ' + pad(m) : m + ' min';
  }

  function fmtDayLabel(iso) {
    var parts = iso.split('-');
    return parts[2] + '/' + parts[1];
  }

  // Monday 00:00 .. Sunday 23:59:59 for the ISO week containing `date`.
  function isoWeekRange(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var dow = (d.getDay() + 6) % 7; // 0 = Monday
    var monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    var sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }

  function isoWeekNumber(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    var firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var diff = (d - firstThursday) / 86400000;
    return 1 + Math.round(diff / 7);
  }

  function parseISO(iso) {
    var parts = iso.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function cornerMarks() {
    return '<span class="corner tl">+</span><span class="corner tr">+</span>' +
      '<span class="corner bl">+</span><span class="corner br">+</span>';
  }

  // ── DOM refs ──
  var $ = function (sel) { return document.querySelector(sel); };

  var els = {
    screens: {
      painel: $('#screen-painel'),
      registrar: $('#screen-registrar'),
    },
    tabBtns: document.querySelectorAll('.tab-btn'),
    weekLabel: $('#week-label'),
    weekHours: $('#week-hours'),
    weekMins: $('#week-mins'),
    goalBar: $('#goal-bar'),
    goalPct: $('#goal-pct'),
    goalMeta: $('#goal-meta'),
    splitsList: $('#splits-list'),
    recordsList: $('#records-list'),
    sessionCountNote: $('#session-count-note'),

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
    summaryValue: $('#summary-value'),
    toast: $('#toast'),
    btnSave: $('#btn-save'),
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
  }

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
        updateSummary();
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
    updateSummary();
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
    updateSummary();
  });
  els.inputMins.addEventListener('input', function (e) {
    state.minsVal = e.target.value;
    updateSummary();
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
        updateSummary();
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

  function updateSummary() {
    els.summaryValue.textContent = state.type + ' · ' + fmtDuration(liveMinutes());
  }

  els.btnSave.addEventListener('click', function () {
    var min = liveMinutes();
    var dateISO = state.mode === 'timer' ? todayISO() : (state.dateVal || todayISO());
    var local = state.local.trim();

    state.workouts.unshift({
      id: Date.now(),
      date: dateISO,
      type: state.type,
      min: min,
      local: local,
    });
    saveWorkouts();

    if (state.mode === 'timer') {
      state.secs = 0;
      state.running = false;
      updateTimerControls();
      updateClock();
    }
    updateSummary();

    showToast(state.type + ' de ' + fmtDuration(min) + ' registrado. Boa!');
  });

  function showToast(msg) {
    clearTimeout(toastHandle);
    els.toast.textContent = msg;
    els.toast.hidden = false;
    toastHandle = setTimeout(function () { els.toast.hidden = true; }, 4000);
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
    updateSummary();
  }

  // ── render: Painel screen ──
  function renderPainel() {
    var now = new Date();
    var range = isoWeekRange(now);
    var weekNumber = isoWeekNumber(now);
    var monthLabel = MONTHS_PT[now.getMonth()] + ' ' + now.getFullYear();
    els.weekLabel.textContent = 'Semana ' + weekNumber + ' · ' + monthLabel;

    var weekWorkouts = state.workouts.filter(function (w) {
      var d = parseISO(w.date);
      return d >= range.start && d <= range.end;
    });

    var total = weekWorkouts.reduce(function (a, w) { return a + w.min; }, 0);
    var goalMinutes = WEEKLY_GOAL_HOURS * 60;
    var goalPct = goalMinutes ? Math.min(100, Math.round((total / goalMinutes) * 100)) : 0;

    els.weekHours.textContent = Math.floor(total / 60);
    els.weekMins.textContent = 'h ' + pad(total % 60);
    els.goalBar.style.width = goalPct + '%';
    els.goalPct.textContent = goalPct + '% da meta';
    els.goalMeta.textContent = 'meta ' + WEEKLY_GOAL_HOURS + 'h · ' + weekWorkouts.length + (weekWorkouts.length === 1 ? ' sessão' : ' sessões');
    els.sessionCountNote.textContent = weekWorkouts.length + (weekWorkouts.length === 1 ? ' nesta semana' : ' nesta semana');

    // breakdown by type
    els.splitsList.innerHTML = WORKOUT_TYPES.map(function (t) {
      var min = weekWorkouts.filter(function (w) { return w.type === t.name; })
        .reduce(function (a, w) { return a + w.min; }, 0);
      var pct = total ? Math.round((min / total) * 100) : 0;
      return '<div class="split-row">' +
        '<div class="split-top"><span class="split-name">' + t.name + '</span>' +
        '<span class="split-value">' + fmtDuration(min) + '</span></div>' +
        '<div class="split-bar"><div class="split-bar-fill" style="width:' + pct + '%"></div>' +
        '<span class="split-pct">' + pct + '%</span></div>' +
        '</div>';
    }).join('');

    // recent records (this week, most recent first — already unshifted on save)
    if (weekWorkouts.length === 0) {
      els.recordsList.innerHTML = '<p class="empty-state">Nenhum treino registrado nesta semana ainda.</p>';
    } else {
      els.recordsList.innerHTML = weekWorkouts.slice(0, 8).map(function (w) {
        return '<div class="record-row">' +
          '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
          '<span class="record-mid"><span class="record-type">' + w.type + '</span>' +
          '<span class="record-local">' + (w.local || 'Sem local') + '</span></span>' +
          '<span class="record-dur">' + fmtDuration(w.min) + '</span>' +
          '</div>';
      }).join('');
    }
  }

  // ── init ──
  els.inputDate.value = state.dateVal;
  startTimerLoop();
  renderPainel();
  renderRegistrar();
  setTab('painel');
})();
