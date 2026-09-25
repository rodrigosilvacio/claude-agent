import { supabase, SUPABASE_URL, SUPABASE_KEY } from './supabaseClient.js?v=21';

var DEFAULT_MONTHLY_GOAL = 12;
var RECORDS_PAGE_SIZE = 5;
var EVOLUTION_MONTHS = 6;
var MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
var MAX_WORKOUT_MINUTES = 720;
var MAX_MONTH_OFFSET = 60;
var MAX_STREAK_LOOKBACK = 240;
var WEIGHT_CHART_MAX_POINTS = 30;
var PATIENT_RECENT_LIMIT = 20;
var SIGNED_URL_TTL_SECONDS = 300;

// Modalidades e locais eram uma lista fixa (WORKOUT_TYPES) e um histórico
// calculado na hora — agora são catálogos por usuário (pandafit_workout_types
// / pandafit_locations), carregados em startOwnData() e geridos em
// Configurações > Modalidades / Locais.
var DEFAULT_WORKOUT_TYPES = [
  { name: 'Musculação', hint: 'força' },
  { name: 'Jiu Jitsu', hint: 'tatame' },
  { name: 'Corrida', hint: 'rua' },
];

var MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

var DELETE_ICON_SVG = '<svg width="15" height="16" viewBox="0 0 15 16" fill="none"><path d="M1 4h13M5.5 4V2a1 1 0 011-1h2a1 1 0 011 1v2m2 0v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4h9zM6 7.3v4M9 7.3v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var EDIT_ICON_SVG = '<svg width="15" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.3 2.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4l-7.6 7.6-3 .7.7-3 7.5-7.7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>';

// ── state ──
var state = {
  session: null,
  profile: null, // { id, email, nome, role }
  loginLoading: false,
  offlineMode: false,

  tab: 'painel',
  registrarSection: 'treino',
  mode: 'manual',
  running: false,
  secs: 0,
  type: '',
  local: '',
  workoutTypes: [],
  workoutTypesLoading: true,
  creatingWorkoutType: false,
  deletingWorkoutTypeId: null,
  locations: [],
  locationsLoading: true,
  creatingLocation: false,
  deletingLocationId: null,
  exerciseCatalog: [],
  exerciseCatalogLoading: true,
  creatingExercise: false,
  deletingExerciseId: null,
  workoutExercises: [], // rascunho de exercícios/séries do treino em edição/registro
  workoutSets: {}, // { [workout_id]: [{ name, sets: [{reps, weight}] }] }
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
  dismissedReminders: {},
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

  // admin: Usuários
  users: [],
  usersLoading: true,
  usersLoadError: false,
  creatingUser: false,
  newUserRole: 'usuario',

  // medico: Pacientes
  patients: [],
  patientsLoading: true,
  patientsLoadError: false,
  selectedPatient: null,
  patientDetail: null, // { workouts, weights, documents, loading, loadError }
  deletingPatientDocumentId: null,
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

// Resumo compacto pra caber numa linha do record-row: "Supino 3×10 @ 40kg"
// quando é 1 exercício, ou os nomes quando são vários.
function fmtExercisesSummary(exercises) {
  if (!exercises || exercises.length === 0) return '';
  if (exercises.length === 1) {
    return exercises[0].name + ' ' + fmtSetsSummary(exercises[0].sets);
  }
  var names = exercises.map(function (e) { return e.name; });
  return names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(', ');
}

function fmtSetsSummary(sets) {
  var first = sets[0];
  var allSame = sets.every(function (s) { return s.reps === first.reps && s.weight === first.weight; });
  if (allSame) {
    return sets.length + '×' + first.reps + (first.weight != null ? ' @ ' + fmtWeight(first.weight) + 'kg' : '');
  }
  return sets.length + (sets.length === 1 ? ' série' : ' séries');
}

function csvEscape(value) {
  var s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// A leading BOM helps Excel auto-detect UTF-8, so accented characters in
// tipo/local (Musculação, Jiu Jitsu…) don't come out garbled.
function downloadCSV(filename, header, rows) {
  var lines = [header.map(csvEscape).join(',')];
  rows.forEach(function (row) { lines.push(row.map(csvEscape).join(',')); });
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

function currentUserId() {
  return state.session && state.session.user && state.session.user.id;
}

// ── cache de leitura offline (localStorage, por usuário) ──
// Só pra treinos/pesos/meta/catálogos — nunca documentos, cujo nome do
// arquivo pode ser sensível (ex: resultado de exame) e não deveria ficar
// gravado fora do Supabase. Falha de storage (modo privado, cota cheia)
// degrada em silêncio: é só uma conveniência, não a fonte de verdade.
var CACHE_PREFIX = 'pandafit_cache_';

function cacheGet(userId, key) {
  try {
    var raw = localStorage.getItem(CACHE_PREFIX + userId + '_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function cacheSet(userId, key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + userId + '_' + key, JSON.stringify(value));
  } catch (err) {
    // ignorado de propósito — ver comentário acima
  }
}

var CACHE_KEYS = ['workouts', 'weights', 'settings', 'workoutTypes', 'locations', 'exerciseCatalog', 'workoutSets'];

function clearUserCache(userId) {
  CACHE_KEYS.forEach(function (key) {
    try { localStorage.removeItem(CACHE_PREFIX + userId + '_' + key); } catch (err) { /* ignorado */ }
  });
}

// ── Supabase persistence (all scoped to a user_id — either the caller's own,
// via currentUserId(), or a selected patient's, when a médico is viewing) ──
async function fetchWorkouts(userId, limit) {
  var { data, error } = await supabase
    .from('pandafit_workouts')
    .select('id, date, type, minutes, local')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit || 500);
  if (error) throw error;
  return data;
}

async function insertWorkout(row) {
  var payload = Object.assign({ user_id: currentUserId() }, row);
  var { data, error } = await supabase
    .from('pandafit_workouts')
    .insert(payload)
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

async function fetchSettings(userId) {
  var { data, error } = await supabase
    .from('pandafit_settings')
    .select('monthly_goal, target_weight_kg')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data; // null for a brand-new account that never saved settings
}

// Upsert-by-user_id: only the keys in `patch` are written, so saving the
// goal alone never clobbers an already-saved target_weight_kg (and vice
// versa) — Postgres' ON CONFLICT DO UPDATE only touches the columns given.
async function upsertSettings(patch) {
  var payload = Object.assign({ user_id: currentUserId(), updated_at: new Date().toISOString() }, patch);
  var { error } = await supabase
    .from('pandafit_settings')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}

async function fetchWeights(userId, limit) {
  var { data, error } = await supabase
    .from('pandafit_weights')
    .select('id, date, weight_kg')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit || 500);
  if (error) throw error;
  return data;
}

// Upsert on (user_id, date): correcting today's weight overwrites the row
// instead of creating a second entry for the same day.
async function upsertWeight(row) {
  var payload = Object.assign({ user_id: currentUserId() }, row);
  var { data, error } = await supabase
    .from('pandafit_weights')
    .upsert(payload, { onConflict: 'user_id,date' })
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

async function fetchDocuments(userId, limit) {
  var { data, error } = await supabase
    .from('pandafit_documents')
    .select('id, file_name, file_path, file_type, file_size, uploaded_at')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })
    .limit(limit || 200);
  if (error) throw error;
  return data;
}

// Arquivos vivem em "<user_id>/<arquivo>" — é essa pasta que a policy de
// Storage usa pra restringir cada usuário à própria pasta (ver migration
// 0048). O bucket não é mais público: ver documentPublicUrl() abaixo.
async function uploadDocument(file) {
  var userId = currentUserId();
  var path = userId + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var { error: uploadError } = await supabase.storage
    .from('pandafit-documents')
    .upload(path, file);
  if (uploadError) throw uploadError;

  var { data, error } = await supabase
    .from('pandafit_documents')
    .insert({
      user_id: userId,
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

// Link temporário (o bucket é privado) — gerado só quando alguém clica em
// "Ver", em vez de pré-gerar um por documento renderizado.
async function documentSignedUrl(path) {
  var { data, error } = await supabase.storage
    .from('pandafit-documents')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

// Como o "Ver" acima, mas força o download (Content-Disposition: attachment)
// em vez de abrir o arquivo numa aba — usado no resumo de documentos do
// médico, onde baixar é o caso de uso principal.
async function documentDownloadUrl(path, fileName) {
  var { data, error } = await supabase.storage
    .from('pandafit-documents')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: fileName });
  if (error) throw error;
  return data.signedUrl;
}

// ── modalidades (catálogo por usuário) ──
async function fetchWorkoutTypes(userId) {
  var { data, error } = await supabase
    .from('pandafit_workout_types')
    .select('id, name, hint')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function insertWorkoutType(name, hint) {
  var { data, error } = await supabase
    .from('pandafit_workout_types')
    .insert({ user_id: currentUserId(), name: name, hint: hint || '' })
    .select('id, name, hint')
    .single();
  if (error) throw error;
  return data;
}

async function deleteWorkoutType(id) {
  var { error } = await supabase
    .from('pandafit_workout_types')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// Conta nova (catálogo vazio) parte das 3 modalidades clássicas em vez de
// uma tela em branco — quem preferir troca/apaga em Configurações.
async function seedDefaultWorkoutTypes(userId) {
  var payload = DEFAULT_WORKOUT_TYPES.map(function (t) {
    return { user_id: userId, name: t.name, hint: t.hint };
  });
  var { data, error } = await supabase
    .from('pandafit_workout_types')
    .insert(payload)
    .select('id, name, hint');
  if (error) throw error;
  return data;
}

// ── locais (catálogo por usuário) ──
async function fetchLocations(userId) {
  var { data, error } = await supabase
    .from('pandafit_locations')
    .select('id, name')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function insertLocation(name) {
  var { data, error } = await supabase
    .from('pandafit_locations')
    .insert({ user_id: currentUserId(), name: name })
    .select('id, name')
    .single();
  if (error) throw error;
  return data;
}

async function deleteLocation(id) {
  var { error } = await supabase
    .from('pandafit_locations')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// Registrar um treino num local ainda não catalogado o adiciona sozinho ao
// catálogo (conveniência) — ignoreDuplicates faz isso não falhar quando o
// local já existe.
async function ensureLocationExists(name) {
  var { error } = await supabase
    .from('pandafit_locations')
    .upsert({ user_id: currentUserId(), name: name }, { onConflict: 'user_id,name', ignoreDuplicates: true });
  if (error) throw error;
}

// ── exercícios (catálogo por usuário) ──
async function fetchExercises(userId) {
  var { data, error } = await supabase
    .from('pandafit_exercises')
    .select('id, name')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function insertExercise(name) {
  var { data, error } = await supabase
    .from('pandafit_exercises')
    .insert({ user_id: currentUserId(), name: name })
    .select('id, name')
    .single();
  if (error) throw error;
  return data;
}

async function deleteExercise(id) {
  var { error } = await supabase
    .from('pandafit_exercises')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// Mesma conveniência do local: usar um exercício novo direto em Registrar
// já cadastra ele no catálogo, sem precisar passar por Configurações antes.
async function ensureExerciseExists(name) {
  var { error } = await supabase
    .from('pandafit_exercises')
    .upsert({ user_id: currentUserId(), name: name }, { onConflict: 'user_id,name', ignoreDuplicates: true });
  if (error) throw error;
}

// ── séries por treino ──
// Uma linha por série (workout_id, exercise_name, set_number, reps,
// weight_kg). Buscadas em lote pra todos os treinos do usuário de uma vez
// (como fetchWorkouts) e agrupadas aqui em { [workout_id]: [exercícios] },
// cada exercício já com suas séries na ordem certa.
async function fetchWorkoutSets(userId) {
  var { data, error } = await supabase
    .from('pandafit_workout_sets')
    .select('id, workout_id, exercise_name, set_number, reps, weight_kg')
    .eq('user_id', userId)
    .order('workout_id', { ascending: true })
    .order('exercise_name', { ascending: true })
    .order('set_number', { ascending: true });
  if (error) throw error;
  return groupSetsByWorkout(data);
}

function groupSetsByWorkout(rows) {
  var byWorkout = {};
  rows.forEach(function (row) {
    var exercises = byWorkout[row.workout_id] || (byWorkout[row.workout_id] = []);
    var exercise = exercises[exercises.length - 1];
    if (!exercise || exercise.name !== row.exercise_name) {
      exercise = { name: row.exercise_name, sets: [] };
      exercises.push(exercise);
    }
    exercise.sets.push({ reps: row.reps, weight: row.weight_kg });
  });
  return byWorkout;
}

// Substitui todas as séries de um treino pelas atuais — mais simples do que
// diferenciar quais séries mudaram, e o volume de linhas por treino é
// pequeno o bastante pra isso não pesar.
async function saveWorkoutSets(workoutId, exercises) {
  var { error: deleteError } = await supabase
    .from('pandafit_workout_sets')
    .delete()
    .eq('workout_id', workoutId);
  if (deleteError) throw deleteError;

  var rows = [];
  var userId = currentUserId();
  exercises.forEach(function (exercise) {
    exercise.sets.forEach(function (set, i) {
      rows.push({
        workout_id: workoutId,
        user_id: userId,
        exercise_name: exercise.name,
        set_number: i + 1,
        reps: set.reps,
        weight_kg: set.weight == null || set.weight === '' ? null : set.weight,
      });
    });
  });
  if (rows.length === 0) return;

  var { error: insertError } = await supabase.from('pandafit_workout_sets').insert(rows);
  if (insertError) throw insertError;
}

// ── edge function: pandafit-admin-users (cadastro/gestão, só admin) ──
async function callAdminUsers(action, payload) {
  var res = await fetch(SUPABASE_URL + '/functions/v1/pandafit-admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + state.session.access_token,
    },
    body: JSON.stringify(Object.assign({ action: action }, payload)),
  });
  var body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Erro ao processar a solicitação.');
  return body;
}

// ── DOM refs ──
var $ = function (sel) { return document.querySelector(sel); };

var els = {
  screenLogin: $('#screen-login'),
  loginForm: $('#login-form'),
  loginEmail: $('#login-email'),
  loginPassword: $('#login-password'),
  loginError: $('#login-error'),
  btnLogin: $('#btn-login'),
  btnLoginLabel: $('#btn-login-label'),

  appShell: $('#app-shell'),
  tabbar: $('#tabbar'),
  btnAccount: $('#btn-account'),
  accountInitial: $('#account-initial'),
  offlineBanner: $('#offline-banner'),
  configAccountEmail: $('#config-account-email'),
  btnLogoutConfig: $('#btn-logout-config'),
  settingsRowUsuarios: $('#settings-row-usuarios'),

  screens: {
    painel: $('#screen-painel'),
    registrar: $('#screen-registrar'),
    config: $('#screen-config'),
    meta: $('#screen-meta'),
    modalidades: $('#screen-modalidades'),
    locais: $('#screen-locais'),
    exercicios: $('#screen-exercicios'),
    documentos: $('#screen-documentos'),
    usuarios: $('#screen-usuarios'),
    pacientes: $('#screen-pacientes'),
  },
  reminderBanners: $('#reminder-banners'),
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
  exercisesList: $('#exercises-list'),
  btnAddExercise: $('#btn-add-exercise'),
  exerciseSuggestions: $('#exercise-suggestions'),
  toast: $('#toast'),
  btnSave: $('#btn-save'),
  btnSaveLabel: $('#btn-save-label'),

  // Modalidades (catálogo)
  inputTypeName: $('#input-type-name'),
  inputTypeHint: $('#input-type-hint'),
  typeFormToast: $('#type-form-toast'),
  btnCreateType: $('#btn-create-type'),
  typesList: $('#types-list'),
  typesCountNote: $('#types-count-note'),

  // Locais (catálogo)
  inputLocationName: $('#input-location-name'),
  locationFormToast: $('#location-form-toast'),
  btnCreateLocation: $('#btn-create-location'),
  locationsList: $('#locations-list'),
  locationsCountNote: $('#locations-count-note'),

  inputExerciseCatalogName: $('#input-exercise-name'),
  exerciseFormToast: $('#exercise-form-toast'),
  btnCreateExercise: $('#btn-create-exercise'),
  exercisesCatalogList: $('#exercises-catalog-list'),
  exercisesCountNote: $('#exercises-count-note'),

  inputGoal: $('#input-goal'),
  btnSaveGoal: $('#btn-save-goal'),
  goalToast: $('#goal-toast'),
  metaProgressBar: $('#meta-progress-bar'),
  metaProgressPct: $('#meta-progress-pct'),
  metaProgressCount: $('#meta-progress-count'),
  metaStreakNote: $('#meta-streak-note'),
  evolutionList: $('#evolution-list'),
  btnExportWorkouts: $('#btn-export-workouts'),
  btnExportWeights: $('#btn-export-weights'),
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

  // admin: Usuários
  inputUserNome: $('#input-user-nome'),
  inputUserEmail: $('#input-user-email'),
  inputUserPassword: $('#input-user-password'),
  roleOptions: $('#role-options'),
  userFormToast: $('#user-form-toast'),
  btnCreateUser: $('#btn-create-user'),
  usersList: $('#users-list'),
  usersCountNote: $('#users-count-note'),

  // medico: Pacientes
  pacientesTitle: $('#pacientes-title'),
  pacientesListView: $('#pacientes-list-view'),
  pacientesDetailView: $('#pacientes-detail-view'),
  patientsList: $('#patients-list'),
  patientsCountNote: $('#patients-count-note'),
  btnBackToPatients: $('#btn-back-to-patients'),
  patientDocsNote: $('#patient-docs-note'),
  patientDocsSummary: $('#patient-docs-summary'),
  patientDocumentsList: $('#patient-documents-list'),
  patientWeightChartWrap: $('#patient-weight-chart-wrap'),
  patientWeightsNote: $('#patient-weights-note'),
  patientWeightsList: $('#patient-weights-list'),
  patientWorkoutsNote: $('#patient-workouts-note'),
  patientWorkoutsList: $('#patient-workouts-list'),
};

// ── confirm modal (replaces window.confirm to match the app's own look) ──
function confirmModal(message, confirmLabel) {
  return new Promise(function (resolve) {
    els.confirmModalMessage.textContent = message;
    els.confirmModalConfirm.textContent = confirmLabel || 'Excluir';
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
var showUserFormToast = makeToaster(els.userFormToast);
var showTypeFormToast = makeToaster(els.typeFormToast);
var showLocationFormToast = makeToaster(els.locationFormToast);
var showExerciseFormToast = makeToaster(els.exerciseFormToast);

// ── auth: login, logout, role-based routing ──
async function doLogout() {
  var userId = currentUserId();
  await supabase.auth.signOut();
  if (userId) clearUserCache(userId);
}

async function confirmLogout() {
  var ok = await confirmModal('Sair da conta?', 'Sair');
  if (ok) doLogout();
}

els.btnAccount.addEventListener('click', confirmLogout);
els.btnLogoutConfig.addEventListener('click', confirmLogout);

function showLoginScreen(errorMessage) {
  els.appShell.hidden = true;
  els.btnAccount.hidden = true;
  els.screenLogin.hidden = false;
  if (errorMessage) {
    els.loginError.textContent = errorMessage;
    els.loginError.hidden = false;
  }
}

function resetAppState() {
  state.session = null;
  state.profile = null;
  state.offlineMode = false;
  offlineResources = {};
  state.workouts = [];
  state.loading = true;
  state.loadError = false;
  state.weights = [];
  state.weightsLoading = true;
  state.weightsLoadError = false;
  state.documents = [];
  state.documentsLoading = true;
  state.documentsLoadError = false;
  state.monthlyGoal = DEFAULT_MONTHLY_GOAL;
  state.targetWeight = null;
  state.workoutTypes = [];
  state.workoutTypesLoading = true;
  state.type = '';
  state.locations = [];
  state.locationsLoading = true;
  state.local = '';
  state.exerciseCatalog = [];
  state.exerciseCatalogLoading = true;
  state.workoutExercises = [];
  state.workoutSets = {};
  state.users = [];
  state.usersLoading = true;
  state.patients = [];
  state.patientsLoading = true;
  state.selectedPatient = null;
  state.patientDetail = null;
  els.loginEmail.value = '';
  els.loginPassword.value = '';
}

els.loginForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (state.loginLoading) return;

  var email = els.loginEmail.value.trim();
  var password = els.loginPassword.value;
  state.loginLoading = true;
  els.btnLogin.disabled = true;
  els.btnLoginLabel.textContent = 'Entrando…';
  els.loginError.hidden = true;

  supabase.auth.signInWithPassword({ email: email, password: password })
    .then(function (res) {
      if (res.error) throw res.error;
      return handleSignedIn(res.data.session);
    })
    .catch(function (err) {
      console.error('Falha no login', err);
      els.loginError.textContent = 'E-mail ou senha inválidos.';
      els.loginError.hidden = false;
    })
    .finally(function () {
      state.loginLoading = false;
      els.btnLogin.disabled = false;
      els.btnLoginLabel.textContent = 'Entrar';
    });
});

async function handleSignedIn(session) {
  state.session = session;
  var { data, error } = await supabase
    .from('pandafit_usuarios')
    .select('id, email, nome, role')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('Falha ao carregar perfil PandaFit', error);
    await supabase.auth.signOut();
    showLoginScreen('Esta conta não tem acesso ao PandaFit.');
    return;
  }

  state.profile = data;
  showAppShell();
}

function showAppShell() {
  els.screenLogin.hidden = true;
  els.appShell.hidden = false;
  els.btnAccount.hidden = false;
  var label = (state.profile.nome || state.profile.email || '?').trim();
  els.accountInitial.textContent = label.charAt(0).toUpperCase();
  els.configAccountEmail.textContent = state.profile.email + ' · ' + roleLabel(state.profile.role);

  var role = state.profile.role;
  els.settingsRowUsuarios.hidden = role !== 'admin';
  els.tabbar.hidden = role === 'medico';

  if (role === 'medico') {
    setTab('pacientes');
    loadPatients();
  } else {
    setTab('painel');
    startOwnData();
  }
}

function roleLabel(role) {
  if (role === 'admin') return 'admin';
  if (role === 'medico') return 'médico';
  return 'usuário';
}

// ── tab bar wiring ──
document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () { setTab(btn.dataset.tab); });
});

// Meta/Documentos/Usuários são sub-telas de Configurações (abertas por um
// settings-row, não por um botão próprio na tabbar) — a aba "Config."
// continua marcada como ativa enquanto qualquer uma delas está aberta.
var CONFIG_SUB_SCREENS = ['config', 'meta', 'modalidades', 'locais', 'exercicios', 'documentos', 'usuarios'];

function setTab(tab) {
  state.tab = tab;
  Object.keys(els.screens).forEach(function (key) {
    els.screens[key].hidden = key !== tab;
  });
  var tabbarKey = CONFIG_SUB_SCREENS.indexOf(tab) >= 0 ? 'config' : tab;
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.tab === tabbarKey);
  });
  if (tab === 'painel') renderPainel();
  if (tab === 'meta') renderMeta();
  if (tab === 'modalidades') renderWorkoutTypes();
  if (tab === 'locais') renderLocations();
  if (tab === 'exercicios') renderExerciseCatalog();
  if (tab === 'registrar') setRegistrarSection(state.registrarSection);
  if (tab === 'documentos') renderDocuments();
  if (tab === 'usuarios') { renderUsers(); loadUsers(); }
}

document.querySelectorAll('.settings-row').forEach(function (btn) {
  btn.addEventListener('click', function () { setTab(btn.dataset.open); });
});
document.querySelectorAll('[data-back]').forEach(function (btn) {
  btn.addEventListener('click', function () { setTab(btn.dataset.back); });
});

function renderOfflineBanner() {
  els.offlineBanner.hidden = !state.offlineMode;
}

function renderActiveTab() {
  renderOfflineBanner();
  if (state.tab === 'painel') renderPainel();
  if (state.tab === 'meta') renderMeta();
  if (state.tab === 'modalidades') renderWorkoutTypes();
  if (state.tab === 'locais') renderLocations();
  if (state.tab === 'exercicios') renderExerciseCatalog();
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
  state.workoutExercises = cloneWorkoutExercises(state.workoutSets[w.id] || []);
  state.registrarSection = 'treino';
  setTab('registrar');
  renderRegistrar();
  updateEditUI();
}

function cancelEditWorkout() {
  state.editingWorkoutId = null;
  state.dateVal = todayISO();
  state.minsVal = 60;
  state.type = state.workoutTypes.length ? state.workoutTypes[0].name : '';
  state.local = '';
  state.workoutExercises = [];
  renderRegistrar();
  updateEditUI();
}

// Cópia profunda pra editar sem mutar o cache de state.workoutSets até salvar.
function cloneWorkoutExercises(exercises) {
  return exercises.map(function (ex) {
    return { name: ex.name, sets: ex.sets.map(function (s) { return { reps: s.reps, weight: s.weight }; }) };
  });
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
  if (state.workoutTypes.length === 0) {
    els.typeOptions.innerHTML = '<p class="empty-state">' +
      (state.workoutTypesLoading ? 'Carregando modalidades…' : 'Nenhuma modalidade cadastrada. Adicione em Configurações › Modalidades.') +
      '</p>';
    return;
  }
  els.typeOptions.innerHTML = state.workoutTypes.map(function (t) {
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

// Sugestões de local via <datalist>, alimentadas pelo catálogo em
// Configurações > Locais (não mais calculadas a partir do histórico).
function updateLocalSuggestions() {
  els.localSuggestions.innerHTML = state.locations.map(function (loc) {
    return '<option value="' + loc.name.replace(/"/g, '&quot;') + '"></option>';
  }).join('');
}

// ── exercícios/séries do treino em edição (rascunho em state.workoutExercises) ──
function updateExerciseSuggestions() {
  els.exerciseSuggestions.innerHTML = state.exerciseCatalog.map(function (ex) {
    return '<option value="' + ex.name.replace(/"/g, '&quot;') + '"></option>';
  }).join('');
}

function addExercise() {
  state.workoutExercises.push({ name: '', sets: [{ reps: '', weight: '' }] });
  renderExercisesEditor();
}

function removeExercise(exerciseIndex) {
  state.workoutExercises.splice(exerciseIndex, 1);
  renderExercisesEditor();
}

function addSet(exerciseIndex) {
  state.workoutExercises[exerciseIndex].sets.push({ reps: '', weight: '' });
  renderExercisesEditor();
}

function removeSet(exerciseIndex, setIndex) {
  var exercise = state.workoutExercises[exerciseIndex];
  exercise.sets.splice(setIndex, 1);
  if (exercise.sets.length === 0) state.workoutExercises.splice(exerciseIndex, 1);
  renderExercisesEditor();
}

// Reconstrói o HTML só quando a estrutura muda (adicionar/remover exercício
// ou série) — digitar num campo não passa por aqui (ver o listener de
// "input" abaixo), senão o cursor pularia do campo a cada tecla.
function renderExercisesEditor() {
  if (state.workoutExercises.length === 0) {
    els.exercisesList.innerHTML = '<p class="empty-state">Nenhum exercício adicionado — a duração já é suficiente pra registrar o treino.</p>';
    return;
  }
  els.exercisesList.innerHTML = state.workoutExercises.map(function (exercise, ei) {
    var setsHtml = exercise.sets.map(function (set, si) {
      return '<div class="set-row">' +
        '<span class="set-num">' + (si + 1) + '</span>' +
        '<input type="number" inputmode="numeric" min="1" class="set-reps" placeholder="Reps" value="' +
        (set.reps === '' || set.reps == null ? '' : set.reps) + '" data-exercise="' + ei + '" data-set="' + si + '" data-field="reps" />' +
        '<span class="set-x">×</span>' +
        '<input type="text" inputmode="decimal" class="set-weight" placeholder="kg" value="' +
        (set.weight === '' || set.weight == null ? '' : set.weight) + '" data-exercise="' + ei + '" data-set="' + si + '" data-field="weight" />' +
        '<button type="button" class="set-remove" data-exercise="' + ei + '" data-set="' + si + '" aria-label="Remover série">' + DELETE_ICON_SVG + '</button>' +
        '</div>';
    }).join('');
    return '<div class="exercise-card">' +
      '<div class="exercise-card-head">' +
      '<input type="text" class="exercise-name-input" placeholder="Nome do exercício" list="exercise-suggestions" value="' +
      (exercise.name || '').replace(/"/g, '&quot;') + '" data-exercise="' + ei + '" data-field="name" />' +
      '<button type="button" class="record-delete exercise-remove" data-exercise="' + ei + '" aria-label="Remover exercício">' + DELETE_ICON_SVG + '</button>' +
      '</div>' +
      setsHtml +
      '<button type="button" class="add-set-btn" data-exercise="' + ei + '">+ Série</button>' +
      '</div>';
  }).join('');
}

els.exercisesList.addEventListener('input', function (e) {
  var t = e.target;
  if (t.dataset.exercise == null) return;
  var ei = Number(t.dataset.exercise);
  if (t.dataset.field === 'name') {
    state.workoutExercises[ei].name = t.value;
  } else if (t.dataset.field === 'reps' || t.dataset.field === 'weight') {
    state.workoutExercises[ei].sets[Number(t.dataset.set)][t.dataset.field] = t.value;
  }
});

els.exercisesList.addEventListener('click', function (e) {
  var btn = e.target.closest('button');
  if (!btn || btn.dataset.exercise == null) return;
  var ei = Number(btn.dataset.exercise);
  if (btn.classList.contains('exercise-remove')) removeExercise(ei);
  else if (btn.classList.contains('add-set-btn')) addSet(ei);
  else if (btn.classList.contains('set-remove')) removeSet(ei, Number(btn.dataset.set));
});

els.btnAddExercise.addEventListener('click', addExercise);

// Monta o payload pro saveWorkoutSets: descarta exercícios sem nome e
// séries sem repetições válidas — não bloqueia o salvamento do treino,
// só ignora o que ficou incompleto no rascunho.
function collectValidExercises() {
  return state.workoutExercises
    .map(function (ex) {
      var name = (ex.name || '').trim();
      var sets = ex.sets
        .map(function (s) {
          var reps = parseInt(s.reps, 10);
          var weight = s.weight === '' || s.weight == null ? null : parseFloat(String(s.weight).replace(',', '.'));
          if (!reps || reps < 1) return null;
          return { reps: reps, weight: weight != null && !isNaN(weight) && weight >= 0 ? weight : null };
        })
        .filter(Boolean);
      if (!name || sets.length === 0) return null;
      return { name: name, sets: sets };
    })
    .filter(Boolean);
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

  if (!state.type) {
    showToast('Cadastre uma modalidade em Configurações › Modalidades antes de registrar.');
    return;
  }

  var min = liveMinutes();
  var dateISO = state.mode === 'timer' ? todayISO() : clampDateToToday(state.dateVal || todayISO());
  var local = state.local.trim();
  var isNewLocal = local && !state.locations.some(function (l) { return l.name === local; });
  var exercisesToSave = collectValidExercises();
  var newExerciseNames = exercisesToSave
    .map(function (ex) { return ex.name; })
    .filter(function (name) { return !state.exerciseCatalog.some(function (e) { return e.name === name; }); });
  var wasTimer = state.mode === 'timer';
  var editingId = state.editingWorkoutId;

  state.saving = true;
  els.btnSave.disabled = true;

  var patch = { date: dateISO, type: state.type, minutes: min, local: local };
  var op = (editingId != null ? updateWorkout(editingId, patch) : insertWorkout(patch))
    .then(function (row) {
      return saveWorkoutSets(row.id, exercisesToSave).then(function () { return row; });
    });

  op
    .then(function (row) {
      state.workoutSets[row.id] = exercisesToSave;
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

      // Local digitado que ainda não estava no catálogo entra sozinho —
      // conveniência: quem só digita continua funcionando, e o catálogo em
      // Configurações fica sempre em dia pra quem quiser revisar/apagar.
      if (isNewLocal) {
        ensureLocationExists(local)
          .then(function () { return fetchLocations(currentUserId()); })
          .then(function (rows) {
            state.locations = rows;
            updateLocalSuggestions();
            renderLocations();
          })
          .catch(function (err) { console.error('Falha ao salvar local no catálogo', err); });
      }

      // Mesma conveniência pros nomes de exercício digitados nesse treino.
      newExerciseNames.forEach(function (name) {
        ensureExerciseExists(name)
          .then(function () { return fetchExercises(currentUserId()); })
          .then(function (rows) {
            state.exerciseCatalog = rows;
            updateExerciseSuggestions();
          })
          .catch(function (err) { console.error('Falha ao salvar exercício no catálogo', err); });
      });
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

async function handleDeleteClick(id) {
  if (state.deletingId) return;
  var ok = await confirmModal('Excluir este treino? Essa ação não pode ser desfeita.');
  if (!ok) return;

  state.deletingId = id;
  deleteWorkout(id)
    .then(function () {
      state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
      delete state.workoutSets[id];
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

async function handleViewDocumentClick(path, linkEl) {
  var original = linkEl.textContent;
  linkEl.textContent = '…';
  try {
    var url = await documentSignedUrl(path);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    console.error('Falha ao gerar link do documento', err);
    showDocumentToast('Não foi possível abrir o documento.');
  } finally {
    linkEl.textContent = original;
  }
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
  renderExercisesEditor();
}

// ── reminder banners (shown on Painel when the app opens) ──
function computeReminders() {
  var reminders = [];

  if (state.painelMonthOffset === 0 && !state.loading && !state.loadError) {
    var range = monthRange(new Date());
    var goal = state.monthlyGoal;
    var count = state.workouts.filter(function (w) {
      var d = parseISO(w.date);
      return d >= range.start && d <= range.end;
    }).length;
    if (goal && count < goal) {
      var missing = goal - count;
      reminders.push({
        id: 'goal',
        text: 'Faltam ' + missing + (missing === 1 ? ' treino' : ' treinos') + ' para bater a meta deste mês.',
      });
    }
  }

  if (!state.weightsLoading && !state.weightsLoadError) {
    var today = todayISO();
    var hasToday = state.weights.some(function (w) { return w.date === today; });
    if (!hasToday) {
      reminders.push({ id: 'weight', text: 'Você ainda não registrou seu peso hoje.' });
    }
  }

  return reminders.filter(function (r) { return !state.dismissedReminders[r.id]; });
}

function renderReminders() {
  var reminders = computeReminders();
  els.reminderBanners.hidden = reminders.length === 0;
  els.reminderBanners.innerHTML = reminders.map(function (r) {
    return '<div class="reminder-banner">' +
      '<span>' + r.text + '</span>' +
      '<button type="button" class="reminder-banner-dismiss" data-id="' + r.id + '" aria-label="Dispensar">×</button>' +
      '</div>';
  }).join('');
  els.reminderBanners.querySelectorAll('.reminder-banner-dismiss').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.dismissedReminders[btn.dataset.id] = true;
      renderReminders();
    });
  });
}

// ── render: Painel screen ──
function renderPainel() {
  renderReminders();
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

  // breakdown by type — só as modalidades usadas no mês (não o catálogo
  // inteiro, que pode crescer bastante e não teria nada a mostrar aqui).
  var totalMinutes = monthWorkouts.reduce(function (a, w) { return a + w.minutes; }, 0);
  var typesInMonth = [];
  var seenTypes = {};
  monthWorkouts.forEach(function (w) {
    if (!seenTypes[w.type]) { seenTypes[w.type] = true; typesInMonth.push(w.type); }
  });
  var catalogOrder = state.workoutTypes.map(function (t) { return t.name; });
  typesInMonth.sort(function (a, b) { return catalogOrder.indexOf(a) - catalogOrder.indexOf(b); });

  if (typesInMonth.length === 0) {
    els.splitsList.innerHTML = '<p class="empty-state">Nenhum treino neste mês ainda.</p>';
  } else {
    els.splitsList.innerHTML = typesInMonth.map(function (typeName) {
      var min = monthWorkouts.filter(function (w) { return w.type === typeName; })
        .reduce(function (a, w) { return a + w.minutes; }, 0);
      var pct = totalMinutes ? Math.round((min / totalMinutes) * 100) : 0;
      return '<div class="split-row">' +
        '<div class="split-top"><span class="split-name">' + typeName + '</span>' +
        '<span class="split-value">' + fmtDuration(min) + '</span></div>' +
        '<div class="split-bar"><div class="split-bar-fill" style="width:' + pct + '%"></div>' +
        '<span class="split-pct">' + pct + '%</span></div>' +
        '</div>';
    }).join('');
  }

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
      var exercisesSummary = fmtExercisesSummary(state.workoutSets[w.id]);
      return '<div class="record-row has-edit">' +
        '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
        '<span class="record-mid"><span class="record-type">' + w.type + '</span>' +
        '<span class="record-local">' + (w.local || 'Sem local') + '</span>' +
        (exercisesSummary ? '<span class="record-exercises">' + exercisesSummary + '</span>' : '') +
        '</span>' +
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

  upsertSettings({ target_weight_kg: kg })
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
function buildWeightChartHTML(weights) {
  var asc = weights.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  if (asc.length < 2) {
    return '<p class="empty-state">Registre pelo menos 2 pesos para ver o gráfico.</p>';
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

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="weight-chart">' +
    '<path d="' + pathD + '" fill="none" style="stroke:var(--accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round" />' +
    '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3.5" style="fill:var(--accent)" />' +
    '</svg>' +
    '<div class="chart-caption">' +
    '<span>' + fmtDayLabel(first.date) + ' · ' + fmtWeight(first.weight_kg) + ' kg</span>' +
    '<span class="chart-caption-current">' + fmtDayLabel(lastWeight.date) + ' · ' + fmtWeight(lastWeight.weight_kg) + ' kg</span>' +
    '</div>';
}

function renderWeightChart() {
  var wrap = els.weightChartWrap;
  if (state.weightsLoading || state.weightsLoadError) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = buildWeightChartHTML(state.weights);
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
      '<a class="record-dur doc-view-link" href="#" data-path="' + doc.file_path + '">Ver</a>' +
      '<button type="button" class="record-delete" data-id="' + doc.id + '" aria-label="Excluir documento">' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');

  els.documentsList.querySelectorAll('.doc-view-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      handleViewDocumentClick(link.dataset.path, link);
    });
  });
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

  upsertSettings({ monthly_goal: val })
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

// ── export CSV ──
els.btnExportWorkouts.addEventListener('click', function () {
  var sorted = state.workouts.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  var rows = sorted.map(function (w) { return [w.date, w.type, w.minutes, w.local || '']; });
  downloadCSV('pandafit-treinos.csv', ['Data', 'Tipo', 'Duração (min)', 'Local'], rows);
});

els.btnExportWeights.addEventListener('click', function () {
  var sorted = state.weights.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  var rows = sorted.map(function (w) { return [w.date, w.weight_kg]; });
  downloadCSV('pandafit-pesos.csv', ['Data', 'Peso (kg)'], rows);
});

// ── Modalidades (catálogo) ──
els.btnCreateType.addEventListener('click', function () {
  if (state.creatingWorkoutType) return;

  var name = els.inputTypeName.value.trim();
  var hint = els.inputTypeHint.value.trim();
  if (!name) {
    showTypeFormToast('Informe um nome para a modalidade.');
    return;
  }
  if (state.workoutTypes.some(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })) {
    showTypeFormToast('Essa modalidade já está cadastrada.');
    return;
  }

  state.creatingWorkoutType = true;
  els.btnCreateType.disabled = true;

  insertWorkoutType(name, hint)
    .then(function (row) {
      state.workoutTypes.push(row);
      if (!state.type) state.type = row.name;
      els.inputTypeName.value = '';
      els.inputTypeHint.value = '';
      showTypeFormToast('Modalidade cadastrada.');
      renderWorkoutTypes();
      renderTypeOptions();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar modalidade', err);
      showTypeFormToast('Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingWorkoutType = false;
      els.btnCreateType.disabled = false;
    });
});

function renderWorkoutTypes() {
  els.typesCountNote.textContent = state.workoutTypes.length + (state.workoutTypes.length === 1 ? ' modalidade' : ' modalidades');

  if (state.workoutTypesLoading) {
    els.typesList.innerHTML = '<p class="empty-state">Carregando modalidades…</p>';
    return;
  }
  if (state.workoutTypes.length === 0) {
    els.typesList.innerHTML = '<p class="empty-state">Nenhuma modalidade cadastrada ainda.</p>';
    return;
  }

  els.typesList.innerHTML = state.workoutTypes.map(function (t) {
    return '<div class="user-row">' +
      '<div class="user-info">' +
      '<span class="user-name">' + t.name + '</span>' +
      (t.hint ? '<span class="user-email">' + t.hint + '</span>' : '') +
      '</div>' +
      '<button type="button" class="record-delete" data-id="' + t.id + '" aria-label="Excluir modalidade">' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');

  els.typesList.querySelectorAll('.record-delete').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var t = state.workoutTypes.find(function (x) { return x.id === Number(btn.dataset.id); });
      if (t) handleDeleteWorkoutTypeClick(t);
    });
  });
}

async function handleDeleteWorkoutTypeClick(t) {
  if (state.deletingWorkoutTypeId) return;
  var ok = await confirmModal('Excluir a modalidade "' + t.name + '"? Treinos já registrados com ela não são afetados.');
  if (!ok) return;

  state.deletingWorkoutTypeId = t.id;
  deleteWorkoutType(t.id)
    .then(function () {
      state.workoutTypes = state.workoutTypes.filter(function (x) { return x.id !== t.id; });
      if (state.type === t.name) state.type = state.workoutTypes.length ? state.workoutTypes[0].name : '';
      renderTypeOptions();
    })
    .catch(function (err) {
      console.error('Falha ao excluir modalidade', err);
      showTypeFormToast('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingWorkoutTypeId = null;
      renderWorkoutTypes();
    });
}

// ── Locais (catálogo) ──
els.btnCreateLocation.addEventListener('click', function () {
  if (state.creatingLocation) return;

  var name = els.inputLocationName.value.trim();
  if (!name) {
    showLocationFormToast('Informe um nome para o local.');
    return;
  }
  if (state.locations.some(function (l) { return l.name.toLowerCase() === name.toLowerCase(); })) {
    showLocationFormToast('Esse local já está cadastrado.');
    return;
  }

  state.creatingLocation = true;
  els.btnCreateLocation.disabled = true;

  insertLocation(name)
    .then(function (row) {
      state.locations.push(row);
      els.inputLocationName.value = '';
      showLocationFormToast('Local cadastrado.');
      renderLocations();
      updateLocalSuggestions();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar local', err);
      showLocationFormToast('Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingLocation = false;
      els.btnCreateLocation.disabled = false;
    });
});

function renderLocations() {
  els.locationsCountNote.textContent = state.locations.length + (state.locations.length === 1 ? ' local' : ' locais');

  if (state.locationsLoading) {
    els.locationsList.innerHTML = '<p class="empty-state">Carregando locais…</p>';
    return;
  }
  if (state.locations.length === 0) {
    els.locationsList.innerHTML = '<p class="empty-state">Nenhum local cadastrado ainda.</p>';
    return;
  }

  els.locationsList.innerHTML = state.locations.map(function (l) {
    return '<div class="user-row">' +
      '<div class="user-info">' +
      '<span class="user-name">' + l.name + '</span>' +
      '</div>' +
      '<button type="button" class="record-delete" data-id="' + l.id + '" aria-label="Excluir local">' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');

  els.locationsList.querySelectorAll('.record-delete').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var l = state.locations.find(function (x) { return x.id === Number(btn.dataset.id); });
      if (l) handleDeleteLocationClick(l);
    });
  });
}

async function handleDeleteLocationClick(l) {
  if (state.deletingLocationId) return;
  var ok = await confirmModal('Excluir o local "' + l.name + '"? Treinos já registrados com ele não são afetados.');
  if (!ok) return;

  state.deletingLocationId = l.id;
  deleteLocation(l.id)
    .then(function () {
      state.locations = state.locations.filter(function (x) { return x.id !== l.id; });
      updateLocalSuggestions();
    })
    .catch(function (err) {
      console.error('Falha ao excluir local', err);
      showLocationFormToast('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingLocationId = null;
      renderLocations();
    });
}

els.btnCreateExercise.addEventListener('click', function () {
  if (state.creatingExercise) return;

  var name = els.inputExerciseCatalogName.value.trim();
  if (!name) {
    showExerciseFormToast('Informe um nome para o exercício.');
    return;
  }
  if (state.exerciseCatalog.some(function (e) { return e.name.toLowerCase() === name.toLowerCase(); })) {
    showExerciseFormToast('Esse exercício já está cadastrado.');
    return;
  }

  state.creatingExercise = true;
  els.btnCreateExercise.disabled = true;

  insertExercise(name)
    .then(function (row) {
      state.exerciseCatalog.push(row);
      els.inputExerciseCatalogName.value = '';
      showExerciseFormToast('Exercício cadastrado.');
      renderExerciseCatalog();
      updateExerciseSuggestions();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar exercício', err);
      showExerciseFormToast('Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingExercise = false;
      els.btnCreateExercise.disabled = false;
    });
});

function renderExerciseCatalog() {
  els.exercisesCountNote.textContent = state.exerciseCatalog.length + (state.exerciseCatalog.length === 1 ? ' exercício' : ' exercícios');

  if (state.exerciseCatalogLoading) {
    els.exercisesCatalogList.innerHTML = '<p class="empty-state">Carregando exercícios…</p>';
    return;
  }
  if (state.exerciseCatalog.length === 0) {
    els.exercisesCatalogList.innerHTML = '<p class="empty-state">Nenhum exercício cadastrado ainda.</p>';
    return;
  }

  els.exercisesCatalogList.innerHTML = state.exerciseCatalog.map(function (ex) {
    return '<div class="user-row">' +
      '<div class="user-info">' +
      '<span class="user-name">' + ex.name + '</span>' +
      '</div>' +
      '<button type="button" class="record-delete" data-id="' + ex.id + '" aria-label="Excluir exercício">' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');

  els.exercisesCatalogList.querySelectorAll('.record-delete').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var ex = state.exerciseCatalog.find(function (x) { return x.id === Number(btn.dataset.id); });
      if (ex) handleDeleteExerciseClick(ex);
    });
  });
}

async function handleDeleteExerciseClick(ex) {
  if (state.deletingExerciseId) return;
  var ok = await confirmModal('Excluir o exercício "' + ex.name + '"? Séries já registradas com ele não são afetadas.');
  if (!ok) return;

  state.deletingExerciseId = ex.id;
  deleteExercise(ex.id)
    .then(function () {
      state.exerciseCatalog = state.exerciseCatalog.filter(function (x) { return x.id !== ex.id; });
      updateExerciseSuggestions();
    })
    .catch(function (err) {
      console.error('Falha ao excluir exercício', err);
      showExerciseFormToast('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingExerciseId = null;
      renderExerciseCatalog();
    });
}

// ── admin: Usuários ──
els.roleOptions.querySelectorAll('.role-option').forEach(function (btn) {
  btn.addEventListener('click', function () {
    state.newUserRole = btn.dataset.role;
    els.roleOptions.querySelectorAll('.role-option').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
  });
});

function loadUsers() {
  state.usersLoading = true;
  state.usersLoadError = false;
  renderUsers();
  callAdminUsers('list', {})
    .then(function (body) {
      state.users = body.usuarios;
      state.usersLoading = false;
    })
    .catch(function (err) {
      console.error('Falha ao carregar usuários', err);
      state.usersLoading = false;
      state.usersLoadError = true;
    })
    .finally(renderUsers);
}

els.btnCreateUser.addEventListener('click', function () {
  if (state.creatingUser) return;

  var nome = els.inputUserNome.value.trim();
  var email = els.inputUserEmail.value.trim();
  var password = els.inputUserPassword.value;
  var role = state.newUserRole;

  if (!email || !email.includes('@')) {
    showUserFormToast('Informe um e-mail válido.');
    return;
  }
  if (!password || password.length < 6) {
    showUserFormToast('A senha precisa ter pelo menos 6 caracteres.');
    return;
  }

  state.creatingUser = true;
  els.btnCreateUser.disabled = true;

  callAdminUsers('invite', { nome: nome, email: email, password: password, role: role })
    .then(function (body) {
      showUserFormToast(
        (body.contaExistente ? 'Conta existente vinculada ao PandaFit como ' : 'Usuário cadastrado como ')
        + roleLabel(role) + '.'
      );
      els.inputUserNome.value = '';
      els.inputUserEmail.value = '';
      els.inputUserPassword.value = '';
      loadUsers();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar usuário', err);
      showUserFormToast(err.message || 'Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingUser = false;
      els.btnCreateUser.disabled = false;
    });
});

function renderUsers() {
  els.usersCountNote.textContent = state.users.length + (state.users.length === 1 ? ' usuário' : ' usuários');

  if (state.usersLoading) {
    els.usersList.innerHTML = '<p class="empty-state">Carregando usuários…</p>';
    return;
  }
  if (state.usersLoadError) {
    els.usersList.innerHTML = '<p class="empty-state">Não foi possível carregar os usuários. Recarregue a página.</p>';
    return;
  }
  if (state.users.length === 0) {
    els.usersList.innerHTML = '<p class="empty-state">Nenhum usuário cadastrado ainda.</p>';
    return;
  }

  els.usersList.innerHTML = state.users.map(function (u) {
    var isSelf = u.id === currentUserId();
    return '<div class="user-row">' +
      '<div class="user-info">' +
      '<span class="user-name">' + (u.nome || u.email) + (isSelf ? ' (você)' : '') + '</span>' +
      '<span class="user-email">' + u.email + '</span>' +
      '</div>' +
      '<select class="user-role-select" data-id="' + u.id + '" ' + (isSelf ? 'disabled' : '') + '>' +
      '<option value="usuario"' + (u.role === 'usuario' ? ' selected' : '') + '>Usuário</option>' +
      '<option value="medico"' + (u.role === 'medico' ? ' selected' : '') + '>Médico</option>' +
      '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
      '</select>' +
      '<button type="button" class="record-delete" data-id="' + u.id + '" aria-label="Revogar acesso" ' + (isSelf ? 'disabled' : '') + '>' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');

  els.usersList.querySelectorAll('.user-role-select').forEach(function (select) {
    select.addEventListener('change', function () {
      var userId = select.dataset.id;
      var role = select.value;
      select.disabled = true;
      callAdminUsers('update_role', { userId: userId, role: role })
        .then(function () {
          showUserFormToast('Papel atualizado.');
          loadUsers();
        })
        .catch(function (err) {
          console.error('Falha ao atualizar papel', err);
          showUserFormToast(err.message || 'Não foi possível atualizar. Tente de novo.');
          loadUsers();
        });
    });
  });

  els.usersList.querySelectorAll('.record-delete').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var userId = btn.dataset.id;
      var u = state.users.find(function (x) { return x.id === userId; });
      confirmModal('Revogar o acesso de ' + (u ? (u.nome || u.email) : 'este usuário') + ' ao PandaFit?')
        .then(function (ok) {
          if (!ok) return;
          return callAdminUsers('revoke', { userId: userId });
        })
        .then(function (result) {
          if (result) loadUsers();
        })
        .catch(function (err) {
          console.error('Falha ao revogar acesso', err);
          showUserFormToast(err.message || 'Não foi possível revogar. Tente de novo.');
        });
    });
  });
}

// ── medico: Pacientes ──
function loadPatients() {
  state.patientsLoading = true;
  state.patientsLoadError = false;
  renderPatientsList();
  supabase
    .from('pandafit_usuarios')
    .select('id, email, nome')
    .eq('role', 'usuario')
    .then(function (res) {
      if (res.error) throw res.error;
      state.patients = res.data;
      state.patientsLoading = false;
    })
    .catch(function (err) {
      console.error('Falha ao carregar pacientes', err);
      state.patientsLoading = false;
      state.patientsLoadError = true;
    })
    .finally(renderPatientsList);
}

function renderPatientsList() {
  els.patientsCountNote.textContent = state.patients.length + (state.patients.length === 1 ? ' paciente' : ' pacientes');

  if (state.patientsLoading) {
    els.patientsList.innerHTML = '<p class="empty-state">Carregando pacientes…</p>';
    return;
  }
  if (state.patientsLoadError) {
    els.patientsList.innerHTML = '<p class="empty-state">Não foi possível carregar os pacientes. Recarregue a página.</p>';
    return;
  }
  if (state.patients.length === 0) {
    els.patientsList.innerHTML = '<p class="empty-state">Nenhum paciente cadastrado ainda.</p>';
    return;
  }

  els.patientsList.innerHTML = state.patients.map(function (p) {
    return '<button type="button" class="patient-row" data-id="' + p.id + '">' +
      '<span class="user-info"><span class="user-name">' + (p.nome || p.email) + '</span>' +
      '<span class="user-email">' + p.email + '</span></span>' +
      '<span class="patient-row-arrow">›</span>' +
      '</button>';
  }).join('');

  els.patientsList.querySelectorAll('.patient-row').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var patient = state.patients.find(function (p) { return p.id === btn.dataset.id; });
      if (patient) openPatientDetail(patient);
    });
  });
}

function openPatientDetail(patient) {
  state.selectedPatient = patient;
  els.pacientesTitle.textContent = patient.nome || patient.email;
  els.pacientesListView.hidden = true;
  els.pacientesDetailView.hidden = false;
  loadPatientDetail(patient.id);
}

els.btnBackToPatients.addEventListener('click', function () {
  state.selectedPatient = null;
  els.pacientesListView.hidden = false;
  els.pacientesDetailView.hidden = true;
});

function loadPatientDetail(patientId) {
  els.patientDocumentsList.innerHTML = '<p class="empty-state">Carregando…</p>';
  els.patientWeightsList.innerHTML = '<p class="empty-state">Carregando…</p>';
  els.patientWorkoutsList.innerHTML = '<p class="empty-state">Carregando…</p>';
  els.patientWeightChartWrap.innerHTML = '';
  els.patientDocsNote.textContent = '';
  els.patientWeightsNote.textContent = '';
  els.patientWorkoutsNote.textContent = '';

  Promise.all([
    fetchDocuments(patientId).catch(function () { return null; }),
    fetchWeights(patientId, PATIENT_RECENT_LIMIT).catch(function () { return null; }),
    fetchWorkouts(patientId, PATIENT_RECENT_LIMIT).catch(function () { return null; }),
    fetchWorkoutSets(patientId).catch(function () { return {}; }),
  ]).then(function (results) {
    state.patientDetail = { documents: results[0], weights: results[1], workouts: results[2], sets: results[3] };
    renderPatientDocuments(results[0]);
    renderPatientWeights(results[1]);
    renderPatientWorkouts(results[2], results[3]);
  });
}

function renderPatientDocuments(documents) {
  if (documents == null) {
    els.patientDocsSummary.hidden = true;
    els.patientDocumentsList.innerHTML = '<p class="empty-state">Não foi possível carregar os documentos.</p>';
    return;
  }
  els.patientDocsNote.textContent = documents.length + (documents.length === 1 ? ' documento' : ' documentos');
  if (documents.length === 0) {
    els.patientDocsSummary.hidden = true;
    els.patientDocumentsList.innerHTML = '<p class="empty-state">Nenhum documento enviado.</p>';
    return;
  }

  // Resumo: total de espaço ocupado + data do envio mais recente (a lista
  // já vem ordenada por uploaded_at desc — ver fetchDocuments).
  var totalBytes = documents.reduce(function (a, d) { return a + d.file_size; }, 0);
  els.patientDocsSummary.hidden = false;
  els.patientDocsSummary.textContent = fmtFileSize(totalBytes) + ' ao todo · último envio em ' + fmtDayLabel(documents[0].uploaded_at.slice(0, 10));

  els.patientDocumentsList.innerHTML = documents.map(function (doc) {
    return '<div class="record-row has-edit">' +
      '<span class="record-day">' + fmtDayLabel(doc.uploaded_at.slice(0, 10)) + '</span>' +
      '<span class="record-mid"><span class="record-type">' + doc.file_name + '</span>' +
      '<span class="record-local">' + fmtFileSize(doc.file_size) + '</span></span>' +
      '<a class="record-dur doc-view-link" href="#" data-path="' + doc.file_path + '">Ver</a>' +
      '<a class="record-dur doc-download-link" href="#" data-path="' + doc.file_path + '" data-name="' + doc.file_name.replace(/"/g, '&quot;') + '">Baixar</a>' +
      '<button type="button" class="record-delete" data-id="' + doc.id + '" aria-label="Excluir documento">' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';
  }).join('');
  els.patientDocumentsList.querySelectorAll('.doc-view-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      handleViewDocumentClick(link.dataset.path, link);
    });
  });
  els.patientDocumentsList.querySelectorAll('.doc-download-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      handleDownloadDocumentClick(link.dataset.path, link.dataset.name, link);
    });
  });
  els.patientDocumentsList.querySelectorAll('.record-delete').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var doc = documents.find(function (d) { return d.id === Number(btn.dataset.id); });
      if (doc) handleDeletePatientDocumentClick(doc);
    });
  });
}

async function handleDownloadDocumentClick(path, fileName, linkEl) {
  var original = linkEl.textContent;
  linkEl.textContent = '…';
  try {
    var url = await documentDownloadUrl(path, fileName);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    console.error('Falha ao gerar link de download', err);
    showDocumentToast('Não foi possível baixar o documento.');
  } finally {
    linkEl.textContent = original;
  }
}

async function handleDeletePatientDocumentClick(doc) {
  if (state.deletingPatientDocumentId) return;
  var ok = await confirmModal('Excluir "' + doc.file_name + '" do paciente? Essa ação não pode ser desfeita.');
  if (!ok) return;

  state.deletingPatientDocumentId = doc.id;
  deleteDocument(doc)
    .then(function () {
      var remaining = state.patientDetail.documents.filter(function (d) { return d.id !== doc.id; });
      state.patientDetail.documents = remaining;
      renderPatientDocuments(remaining);
    })
    .catch(function (err) {
      console.error('Falha ao excluir documento do paciente', err);
      showDocumentToast('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingPatientDocumentId = null;
    });
}

function renderPatientWeights(weights) {
  if (weights == null) {
    els.patientWeightsList.innerHTML = '<p class="empty-state">Não foi possível carregar o peso.</p>';
    els.patientWeightChartWrap.innerHTML = '';
    return;
  }
  els.patientWeightChartWrap.innerHTML = buildWeightChartHTML(weights);
  els.patientWeightsNote.textContent = weights.length + (weights.length === 1 ? ' registro' : ' registros');
  if (weights.length === 0) {
    els.patientWeightsList.innerHTML = '<p class="empty-state">Nenhum peso registrado.</p>';
    return;
  }
  els.patientWeightsList.innerHTML = weights.map(function (w, i) {
    var prev = weights[i + 1];
    var trendClass = '';
    var deltaLabel = '—';
    if (prev) {
      var diff = w.weight_kg - prev.weight_kg;
      if (diff > 0.05) { trendClass = 'weight-up'; deltaLabel = '▲ ' + fmtWeight(diff); }
      else if (diff < -0.05) { trendClass = 'weight-down'; deltaLabel = '▼ ' + fmtWeight(Math.abs(diff)); }
      else { deltaLabel = '= 0,0'; }
    }
    return '<div class="record-row">' +
      '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
      '<span class="weight-value">' + fmtWeight(w.weight_kg) + ' kg</span>' +
      '<span class="weight-delta ' + trendClass + '">' + deltaLabel + '</span>' +
      '</div>';
  }).join('');
}

function renderPatientWorkouts(workouts, sets) {
  if (workouts == null) {
    els.patientWorkoutsList.innerHTML = '<p class="empty-state">Não foi possível carregar os treinos.</p>';
    return;
  }
  els.patientWorkoutsNote.textContent = workouts.length + (workouts.length === 1 ? ' treino' : ' treinos');
  if (workouts.length === 0) {
    els.patientWorkoutsList.innerHTML = '<p class="empty-state">Nenhum treino registrado.</p>';
    return;
  }
  els.patientWorkoutsList.innerHTML = workouts.map(function (w) {
    var exercisesSummary = fmtExercisesSummary(sets && sets[w.id]);
    return '<div class="record-row">' +
      '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
      '<span class="record-mid"><span class="record-type">' + w.type + '</span>' +
      '<span class="record-local">' + (w.local || 'Sem local') + '</span>' +
      (exercisesSummary ? '<span class="record-exercises">' + exercisesSummary + '</span>' : '') +
      '</span>' +
      '<span class="record-dur">' + fmtDuration(w.minutes) + '</span>' +
      '</div>';
  }).join('');
}

// Mostra o cache local na hora (se houver) enquanto a rede responde. Se a
// rede falhar e havia cache, mantém os dados antigos na tela com um aviso
// de "offline" em vez de zerar tudo com a mensagem de erro genérica — só
// aciona onLoadError quando não havia nada em cache pra cair de volta.
//
// offlineResources rastreia QUAIS dos ~7 recursos (treinos, pesos, meta...)
// estão hoje servidos do cache por falha de rede — o banner de "offline"
// reflete se esse conjunto está vazio ou não, em vez de uma única flag
// booleana que 7 fetches concorrentes ficariam pisando um no do outro.
var offlineResources = {};

function recomputeOfflineMode() {
  state.offlineMode = Object.keys(offlineResources).length > 0;
}

function loadWithCache(userId, cacheKey, fetchPromise, applyRows, opts) {
  opts = opts || {};
  var cached = cacheGet(userId, cacheKey);
  function renderExtra() {
    renderActiveTab();
    if (opts.afterRender) opts.afterRender();
  }

  if (cached != null) {
    applyRows(cached);
    renderExtra();
  }

  return fetchPromise
    .then(function (rows) {
      delete offlineResources[cacheKey];
      recomputeOfflineMode();
      applyRows(rows);
      cacheSet(userId, cacheKey, rows);
    })
    .catch(function (err) {
      console.error('Falha ao carregar ' + cacheKey, err);
      if (cached != null) {
        offlineResources[cacheKey] = true;
        recomputeOfflineMode();
      } else if (opts.onLoadError) {
        opts.onLoadError();
      }
    })
    .finally(renderExtra);
}

// ── init (own tracking data — usuario and admin roles) ──
function startOwnData() {
  var userId = currentUserId();

  els.inputDate.value = state.dateVal;
  els.inputDate.max = todayISO();
  els.inputWeightDate.value = state.weightDateVal;
  els.inputWeightDate.max = todayISO();
  startTimerLoop();
  renderRegistrar();
  renderActiveTab();

  loadWithCache(userId, 'workouts', fetchWorkouts(userId),
    function (rows) { state.workouts = rows; state.loading = false; updateLocalSuggestions(); },
    { onLoadError: function () { state.loading = false; state.loadError = true; }, afterRender: updateLocalSuggestions });

  loadWithCache(userId, 'workoutSets', fetchWorkoutSets(userId),
    function (byWorkout) { state.workoutSets = byWorkout; });

  loadWithCache(userId, 'settings', fetchSettings(userId),
    function (row) {
      state.monthlyGoal = row ? row.monthly_goal : DEFAULT_MONTHLY_GOAL;
      state.targetWeight = row ? row.target_weight_kg : null;
    });

  loadWithCache(userId, 'weights', fetchWeights(userId),
    function (rows) { state.weights = rows; state.weightsLoading = false; },
    { onLoadError: function () { state.weightsLoading = false; state.weightsLoadError = true; } });

  fetchDocuments(userId)
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

  // Conta nova (sem nenhuma modalidade ainda) recebe as 3 clássicas de
  // largada — ver seedDefaultWorkoutTypes(). Só roda de fato quando a rede
  // responde vazio, nunca a partir do cache offline.
  loadWithCache(userId, 'workoutTypes',
    fetchWorkoutTypes(userId).then(function (rows) { return rows.length > 0 ? rows : seedDefaultWorkoutTypes(userId); }),
    function (rows) {
      state.workoutTypesLoading = false;
      state.workoutTypes = rows;
      if (!state.type && rows.length) state.type = rows[0].name;
    },
    { onLoadError: function () { state.workoutTypesLoading = false; }, afterRender: renderRegistrar });

  loadWithCache(userId, 'locations', fetchLocations(userId),
    function (rows) { state.locationsLoading = false; state.locations = rows; },
    { onLoadError: function () { state.locationsLoading = false; }, afterRender: updateLocalSuggestions });

  loadWithCache(userId, 'exerciseCatalog', fetchExercises(userId),
    function (rows) { state.exerciseCatalogLoading = false; state.exerciseCatalog = rows; },
    { onLoadError: function () { state.exerciseCatalogLoading = false; }, afterRender: updateExerciseSuggestions });
}

// ── boot: check session, show login or app shell ──
supabase.auth.getSession().then(function (res) {
  if (res.data.session) {
    handleSignedIn(res.data.session);
  } else {
    showLoginScreen();
  }
});

supabase.auth.onAuthStateChange(function (event) {
  if (event === 'SIGNED_OUT') {
    resetAppState();
    showLoginScreen();
  }
});

// ── PWA: service worker (app-shell cache for offline/instalação) ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      console.error('Falha ao registrar service worker', err);
    });
  });
}
