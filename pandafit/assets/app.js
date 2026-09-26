import { supabase, SUPABASE_URL, SUPABASE_KEY } from './supabaseClient.js?v=33';

// Link de "esqueci minha senha": o Supabase volta pra cá com
// "#...type=recovery" no hash. Lido aqui, no topo do módulo, porque o
// supabase-js limpa o hash assim que termina de processar a sessão.
var RECOVERY_FROM_URL = /type=recovery/.test(window.location.hash) || /type=recovery/.test(window.location.search);

var DEFAULT_MONTHLY_GOAL = 12;
var RECORDS_PAGE_SIZE = 5;
var EVOLUTION_MONTHS = 6;
var MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
var AI_ANALYZABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
var MAX_WORKOUT_MINUTES = 720;
var MAX_MONTH_OFFSET = 60;
var MAX_STREAK_LOOKBACK = 240;
var WEIGHT_CHART_MAX_POINTS = 30;
var PATIENT_RECENT_LIMIT = 20;
var PATIENT_SINCE_LIMIT = 200;
var SIGNED_URL_TTL_SECONDS = 300;
var UNDO_WINDOW_MS = 5000;
var MIN_PASSWORD_LENGTH = 8;

// Modalidades e locais eram uma lista fixa (WORKOUT_TYPES) e um histórico
// calculado na hora — agora são catálogos por usuário (pandafit_workout_types
// / pandafit_locations), carregados em loadOwnData() e geridos em
// Configurações > Modalidades / Locais.
var DEFAULT_WORKOUT_TYPES = [
  { name: 'Musculação', hint: 'força' },
  { name: 'Jiu Jitsu', hint: 'tatame' },
  { name: 'Corrida', hint: 'rua' },
];

var MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
var MONTHS_FULL_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

var DELETE_ICON_SVG = '<svg width="16" height="17" viewBox="0 0 15 16" fill="none" aria-hidden="true"><path d="M1 4h13M5.5 4V2a1 1 0 011-1h2a1 1 0 011 1v2m2 0v9a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4h9zM6 7.3v4M9 7.3v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var EDIT_ICON_SVG = '<svg width="16" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.3 2.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4l-7.6 7.6-3 .7.7-3 7.5-7.7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>';

// ── state ──
var state = {
  session: null,
  profile: null, // { id, email, nome, role }
  loginLoading: false,
  offlineMode: false,
  passwordMode: null, // null | 'recovery' | 'first' — tela de nova senha

  tab: 'painel',
  registrarSection: 'treino',
  mode: 'manual',
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
  recordsPages: 1,
  dayFilter: null, // 'YYYY-MM-DD' quando um dia do calendário está selecionado
  editingWorkoutId: null,
  painelMonthOffset: 0,
  monthlyGoal: DEFAULT_MONTHLY_GOAL,
  weeklySummaryEmail: false,
  savingGoal: false,
  targetWeight: null,
  savingTargetWeight: false,
  weights: [],
  weightsLoading: true,
  weightsLoadError: false,
  weightDateVal: todayISO(),
  weightVal: '',
  savingWeight: false,
  weightsPages: 1,
  editingWeightId: null,
  weightFilterFrom: '',
  weightFilterTo: '',

  measurements: [],
  measurementsLoading: true,
  measurementsLoadError: false,
  measurementDateVal: todayISO(),
  measurementWaistVal: '',
  measurementBodyFatVal: '',
  savingMeasurement: false,
  measurementsPages: 1,
  editingMeasurementId: null,

  documents: [],
  documentsLoading: true,
  documentsLoadError: false,
  uploadingDocument: false,
  documentsPages: 1,
  deletingDocumentId: null,
  aiSummaries: {}, // { [document_id]: { summary, generated_at } } — leitura de IA feita pelo médico

  photos: [],
  photosLoading: true,
  photosLoadError: false,
  uploadingPhoto: false,
  photosPages: 1,
  deletingPhotoId: null,

  doctors: [],
  doctorsLoading: true,
  doctorsLoadError: false,

  // admin: Usuários
  users: [],
  usersLoading: true,
  usersLoadError: false,
  creatingUser: false,
  newUserRole: 'usuario',
  userLinks: [], // [{ medico_id, usuario_id }] — vínculo paciente↔médico
  savingLinkFor: null, // "<medicoId>:<usuarioId>" da linha em salvamento, ou null

  // medico: Pacientes
  patients: [],
  patientsLoading: true,
  patientsLoadError: false,
  selectedPatient: null,
  patientDetail: null, // { workouts, weights, documents, sets, photos, measurements }
  patientPrevVisit: null, // ISO da visita anterior deste médico a este paciente
  deletingPatientDocumentId: null,
};
var timerHandle = null;

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

function fmtFullDayLabel(iso) {
  var parts = iso.split('-');
  return parts[2] + '/' + parts[1] + '/' + parts[0];
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

var CACHE_KEYS = ['workouts', 'weights', 'measurements', 'settings', 'workoutTypes', 'locations', 'exerciseCatalog', 'workoutSets'];

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
    .select('monthly_goal, target_weight_kg, weekly_summary_email')
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

async function fetchBodyMeasurements(userId, limit) {
  var { data, error } = await supabase
    .from('pandafit_body_measurements')
    .select('id, date, waist_cm, body_fat_pct')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit || 500);
  if (error) throw error;
  return data;
}

// Upsert on (user_id, date), mesmo padrão de pandafit_weights.
async function upsertBodyMeasurement(row) {
  var payload = Object.assign({ user_id: currentUserId() }, row);
  var { data, error } = await supabase
    .from('pandafit_body_measurements')
    .upsert(payload, { onConflict: 'user_id,date' })
    .select('id, date, waist_cm, body_fat_pct')
    .single();
  if (error) throw error;
  return data;
}

async function updateBodyMeasurement(id, patch) {
  var { data, error } = await supabase
    .from('pandafit_body_measurements')
    .update(patch)
    .eq('id', id)
    .select('id, date, waist_cm, body_fat_pct')
    .single();
  if (error) throw error;
  return data;
}

async function deleteBodyMeasurement(id) {
  var { error } = await supabase
    .from('pandafit_body_measurements')
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
      file_name: safeFileName(file.name),
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

// ── fotos de progresso ──
async function fetchProgressPhotos(userId, limit) {
  var { data, error } = await supabase
    .from('pandafit_progress_photos')
    .select('id, file_path, file_name, file_type, file_size, taken_at, uploaded_at')
    .eq('user_id', userId)
    .order('taken_at', { ascending: false })
    .order('uploaded_at', { ascending: false })
    .limit(limit || 200);
  if (error) throw error;
  return data;
}

async function uploadProgressPhoto(file, takenAt) {
  var userId = currentUserId();
  var path = userId + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var { error: uploadError } = await supabase.storage
    .from('pandafit-progress-photos')
    .upload(path, file);
  if (uploadError) throw uploadError;

  var { data, error } = await supabase
    .from('pandafit_progress_photos')
    .insert({
      user_id: userId,
      file_name: safeFileName(file.name),
      file_path: path,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      taken_at: takenAt,
    })
    .select('id, file_path, file_name, file_type, file_size, taken_at, uploaded_at')
    .single();
  if (error) throw error;
  return data;
}

async function deleteProgressPhoto(photo) {
  await supabase.storage.from('pandafit-progress-photos').remove([photo.file_path]);
  var { error } = await supabase
    .from('pandafit_progress_photos')
    .delete()
    .eq('id', photo.id);
  if (error) throw error;
}

// Uma chamada só pra todas as miniaturas da página atual da galeria, em vez
// de uma signed URL por foto — createSignedUrls aceita o lote inteiro.
async function progressPhotoSignedUrls(paths) {
  if (paths.length === 0) return {};
  var { data, error } = await supabase.storage
    .from('pandafit-progress-photos')
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  var map = {};
  data.forEach(function (item) { if (!item.error) map[item.path] = item.signedUrl; });
  return map;
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

// ── edge function: pandafit-analyze-document (resumo por IA, só médico) ──
async function callAnalyzeDocument(documentId, force) {
  var res = await fetch(SUPABASE_URL + '/functions/v1/pandafit-analyze-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + state.session.access_token,
    },
    body: JSON.stringify({ documentId: documentId, force: !!force }),
  });
  var body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Erro ao gerar o resumo.');
  return body;
}

// Escapa antes de inserir QUALQUER texto dinâmico via innerHTML (ver `esc`).
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Nome de arquivo vem do aparelho do usuário e aparece depois na tela do
// médico: remove caracteres de controle e de marcação e limita o tamanho
// (defesa extra; o render também escapa tudo com escapeHtml).
function safeFileName(name) {
  var cleaned = String(name || 'arquivo').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim();
  return (cleaned || 'arquivo').slice(0, 200);
}

// ── leituras de IA feitas pelo médico nos exames do próprio usuário ──
// (a RLS de pandafit_document_ai_summaries já libera o dono do documento)
async function fetchAiSummaries(documentIds) {
  if (!documentIds.length) return {};
  var { data, error } = await supabase
    .from('pandafit_document_ai_summaries')
    .select('document_id, summary, generated_at')
    .in('document_id', documentIds);
  if (error) throw error;
  var map = {};
  data.forEach(function (row) { map[row.document_id] = row; });
  return map;
}

// ── "Quem vê meus dados": médicos vinculados ao usuário logado ──
async function fetchMyDoctors() {
  var { data, error } = await supabase.rpc('pandafit_meus_medicos');
  if (error) throw error;
  return data || [];
}

async function revokeDoctor(medicoId) {
  var { error } = await supabase.rpc('pandafit_revogar_medico', { p_medico_id: medicoId });
  if (error) throw error;
}

// ── canal de feedback (pandafit_feedback; só admin lê) ──
async function insertFeedback(message) {
  var { error } = await supabase
    .from('pandafit_feedback')
    .insert({ user_id: currentUserId(), message: message });
  if (error) throw error;
}


// Atalho curto pro escape — TODO texto vindo do banco ou do usuário (nome de
// modalidade, local, exercício, arquivo, paciente, e-mail…) passa por aqui
// antes de entrar em innerHTML. Sem isso, um nome de arquivo malicioso
// enviado por um paciente executaria script na sessão do médico.
var esc = escapeHtml;

// ── DOM refs ──
var $ = function (sel) { return document.querySelector(sel); };

var els = {
  screenLogin: $('#screen-login'),
  loginViewSignin: $('#login-view-signin'),
  loginViewForgot: $('#login-view-forgot'),
  loginViewNewpass: $('#login-view-newpass'),
  loginForm: $('#login-form'),
  loginEmail: $('#login-email'),
  loginPassword: $('#login-password'),
  loginError: $('#login-error'),
  btnLogin: $('#btn-login'),
  btnLoginLabel: $('#btn-login-label'),
  btnForgot: $('#btn-forgot'),
  forgotForm: $('#forgot-form'),
  forgotEmail: $('#forgot-email'),
  forgotMsg: $('#forgot-msg'),
  btnForgotSend: $('#btn-forgot-send'),
  btnForgotBack: $('#btn-forgot-back'),
  newpassForm: $('#newpass-form'),
  newpassHelp: $('#newpass-help'),
  newpass1: $('#newpass-1'),
  newpass2: $('#newpass-2'),
  newpassError: $('#newpass-error'),
  btnNewpass: $('#btn-newpass'),

  appShell: $('#app-shell'),
  tabbar: $('#tabbar'),
  btnAccount: $('#btn-account'),
  accountInitial: $('#account-initial'),
  accountMenu: $('#account-menu'),
  menuAvatar: $('#menu-avatar'),
  menuName: $('#menu-name'),
  menuRole: $('#menu-role'),
  menuConfig: $('#menu-config'),
  menuPrivacy: $('#menu-privacy'),
  menuLogout: $('#menu-logout'),
  menuClose: $('#menu-close'),
  offlineBanner: $('#offline-banner'),
  configAccountEmail: $('#config-account-email'),
  btnLogoutConfig: $('#btn-logout-config'),
  settingsRowUsuarios: $('#settings-row-usuarios'),
  toggleWeeklySummary: $('#toggle-weekly-summary'),
  inputMyName: $('#input-my-name'),
  btnSaveMyName: $('#btn-save-my-name'),
  inputFeedback: $('#input-feedback'),
  btnSendFeedback: $('#btn-send-feedback'),

  screens: {
    painel: $('#screen-painel'),
    registrar: $('#screen-registrar'),
    progresso: $('#screen-progresso'),
    documentos: $('#screen-documentos'),
    config: $('#screen-config'),
    meta: $('#screen-meta'),
    modalidades: $('#screen-modalidades'),
    locais: $('#screen-locais'),
    exercicios: $('#screen-exercicios'),
    privacidade: $('#screen-privacidade'),
    usuarios: $('#screen-usuarios'),
    pacientes: $('#screen-pacientes'),
  },

  // Painel
  timerRunningBanner: $('#timer-running-banner'),
  timerRunningText: $('#timer-running-text'),
  btnOpenTimer: $('#btn-open-timer'),
  reminderBanners: $('#reminder-banners'),
  monthLabel: $('#month-label'),
  monthPrev: $('#month-prev'),
  monthNext: $('#month-next'),
  monthCount: $('#month-count'),
  monthGoalSuffix: $('#month-goal-suffix'),
  goalBarWrap: $('#goal-bar-wrap'),
  goalBar: $('#goal-bar'),
  goalPct: $('#goal-pct'),
  goalMeta: $('#goal-meta'),
  painelStreakNote: $('#painel-streak-note'),
  repeatCard: $('#repeat-card'),
  repeatDesc: $('#repeat-desc'),
  btnRepeatLast: $('#btn-repeat-last'),
  splitsList: $('#splits-list'),
  calendarHeatmap: $('#calendar-heatmap'),
  dayFilter: $('#day-filter'),
  dayFilterLabel: $('#day-filter-label'),
  btnClearDayFilter: $('#btn-clear-day-filter'),
  recordsList: $('#records-list'),
  sessionCountNote: $('#session-count-note'),
  recordsMore: $('#records-more'),
  painelAchievements: $('#painel-achievements'),
  painelAchievementsNote: $('#painel-achievements-note'),

  // Registrar: treino
  modeTabs: document.querySelectorAll('.mode-tab'),
  modeTabsWrap: $('#mode-tabs'),
  registrarTitle: $('#registrar-title'),
  btnCancelEdit: $('#btn-cancel-edit'),
  sectionTreino: $('#section-treino'),
  sectionPeso: $('#section-peso'),
  saveBarTreino: $('#save-bar-treino'),
  timerCard: $('#timer-card'),
  timerDot: $('#timer-dot'),
  timerRunLabel: $('#timer-run-label'),
  timerStarted: $('#timer-started'),
  clock: $('#clock'),
  btnToggleRun: $('#btn-toggle-run'),
  btnResetRun: $('#btn-reset-run'),
  inputDate: $('#input-date'),
  fieldMins: $('#field-mins'),
  inputMins: $('#input-mins'),
  typeOptions: $('#type-options'),
  inputLocal: $('#input-local'),
  localSuggestions: $('#local-suggestions'),
  exercisesList: $('#exercises-list'),
  btnAddExercise: $('#btn-add-exercise'),
  exerciseSuggestions: $('#exercise-suggestions'),
  btnSave: $('#btn-save'),
  btnSaveLabel: $('#btn-save-label'),

  // Registrar: peso e medidas
  inputWeightDate: $('#input-weight-date'),
  inputWeightValue: $('#input-weight-value'),
  btnWeightMinus: $('#btn-weight-minus'),
  btnWeightPlus: $('#btn-weight-plus'),
  weightLastHint: $('#weight-last-hint'),
  btnSaveWeight: $('#btn-save-weight'),
  btnSaveWeightLabel: $('#btn-save-weight-label'),
  inputMeasurementDate: $('#input-measurement-date'),
  inputMeasurementWaist: $('#input-measurement-waist'),
  inputMeasurementBodyFat: $('#input-measurement-body-fat'),
  btnSaveMeasurement: $('#btn-save-measurement'),
  btnSaveMeasurementLabel: $('#btn-save-measurement-label'),
  btnCancelEditMeasurement: $('#btn-cancel-edit-measurement'),
  inputPhotoFile: $('#input-photo-file'),
  btnUploadPhoto: $('#btn-upload-photo'),

  // Progresso
  targetWeightNote: $('#target-weight-note'),
  weightChartWrap: $('#weight-chart-wrap'),
  inputWeightFilterFrom: $('#input-weight-filter-from'),
  inputWeightFilterTo: $('#input-weight-filter-to'),
  btnClearWeightFilter: $('#btn-clear-weight-filter'),
  weightsList: $('#weights-list'),
  weightCountNote: $('#weight-count-note'),
  weightsMore: $('#weights-more'),
  measurementsList: $('#measurements-list'),
  measurementCountNote: $('#measurement-count-note'),
  measurementsMore: $('#measurements-more'),
  photosGallery: $('#photos-gallery'),
  photosCountNote: $('#photos-count-note'),
  photosMore: $('#photos-more'),
  btnOpenCompare: $('#btn-open-compare'),
  evolutionList: $('#evolution-list'),
  achievementsGrid: $('#achievements-grid'),
  achievementsCountNote: $('#achievements-count-note'),

  // Exames
  inputDocumentFile: $('#input-document-file'),
  btnUploadDocument: $('#btn-upload-document'),
  documentsList: $('#documents-list'),
  documentCountNote: $('#document-count-note'),
  documentsMore: $('#documents-more'),

  // Catálogos
  inputTypeName: $('#input-type-name'),
  inputTypeHint: $('#input-type-hint'),
  btnCreateType: $('#btn-create-type'),
  typesList: $('#types-list'),
  typesCountNote: $('#types-count-note'),
  inputLocationName: $('#input-location-name'),
  btnCreateLocation: $('#btn-create-location'),
  locationsList: $('#locations-list'),
  locationsCountNote: $('#locations-count-note'),
  inputExerciseCatalogName: $('#input-exercise-name'),
  btnCreateExercise: $('#btn-create-exercise'),
  exercisesCatalogList: $('#exercises-catalog-list'),
  exercisesCountNote: $('#exercises-count-note'),

  // Metas
  inputGoal: $('#input-goal'),
  btnSaveGoal: $('#btn-save-goal'),
  btnExportWorkouts: $('#btn-export-workouts'),
  btnExportWeights: $('#btn-export-weights'),
  btnPrintReport: $('#btn-print-report'),
  printReport: $('#print-report'),
  inputTargetWeight: $('#input-target-weight'),
  btnSaveTargetWeight: $('#btn-save-target-weight'),
  targetWeightCaption: $('#target-weight-caption'),
  targetWeightCurrent: $('#target-weight-current'),
  targetWeightRemaining: $('#target-weight-remaining'),

  // Privacidade
  doctorsList: $('#doctors-list'),
  doctorsCountNote: $('#doctors-count-note'),

  // Modais
  confirmModal: $('#confirm-modal'),
  confirmModalMessage: $('#confirm-modal-message'),
  confirmModalCancel: $('#confirm-modal-cancel'),
  confirmModalConfirm: $('#confirm-modal-confirm'),
  compareModal: $('#compare-modal'),
  compareBefore: $('#compare-before'),
  compareAfter: $('#compare-after'),
  compareImgBefore: $('#compare-img-before'),
  compareImgAfter: $('#compare-img-after'),
  compareAfterClip: $('#compare-after-clip'),
  compareDivider: $('#compare-divider'),
  compareRange: $('#compare-range'),
  compareClose: $('#compare-close'),
  aiSummaryModal: $('#ai-summary-modal'),
  aiSummaryBody: $('#ai-summary-body'),
  aiSummaryClose: $('#ai-summary-close'),
  onboarding: $('#onboarding'),
  obGoalOptions: $('#ob-goal-options'),
  obTypes: $('#ob-types'),
  obTypeExtra: $('#ob-type-extra'),
  obWeight: $('#ob-weight'),
  obSkip: $('#ob-skip'),
  obNext: $('#ob-next'),
  toastRegion: $('#toast-region'),
  confetti: $('#confetti'),

  // admin: Usuários
  inputUserNome: $('#input-user-nome'),
  inputUserEmail: $('#input-user-email'),
  inputUserPassword: $('#input-user-password'),
  btnGeneratePassword: $('#btn-generate-password'),
  roleOptions: $('#role-options'),
  btnCreateUser: $('#btn-create-user'),
  usersList: $('#users-list'),
  usersCountNote: $('#users-count-note'),

  // medico: Pacientes
  pacientesTitle: $('#pacientes-title'),
  pacientesSubtitle: $('#pacientes-subtitle'),
  inputPatientSearch: $('#input-patient-search'),
  pacientesListView: $('#pacientes-list-view'),
  pacientesDetailView: $('#pacientes-detail-view'),
  patientsList: $('#patients-list'),
  patientsCountNote: $('#patients-count-note'),
  btnBackToPatients: $('#btn-back-to-patients'),
  sincePeriod: $('#since-period'),
  sinceGrid: $('#since-grid'),
  patientDocsNote: $('#patient-docs-note'),
  patientDocsSummary: $('#patient-docs-summary'),
  patientDocumentsList: $('#patient-documents-list'),
  patientWeightChartWrap: $('#patient-weight-chart-wrap'),
  patientWeightsNote: $('#patient-weights-note'),
  patientWeightsList: $('#patient-weights-list'),
  patientMeasurementsNote: $('#patient-measurements-note'),
  patientMeasurementsList: $('#patient-measurements-list'),
  patientPhotosNote: $('#patient-photos-note'),
  patientPhotosGallery: $('#patient-photos-gallery'),
  patientWorkoutsNote: $('#patient-workouts-note'),
  patientWorkoutsList: $('#patient-workouts-list'),
};

// Nome de exibição: o nome cadastrado, ou null quando está vazio (aí a tela
// decide como mostrar a falta dele, em vez de repetir o e-mail duas vezes).
function displayName(u) {
  var n = u && typeof u.nome === 'string' ? u.nome.trim() : '';
  return n || null;
}

// ── preferências locais por usuário (conveniência; nunca fonte de verdade) ──
function prefKey(name) { return 'pandafit_' + name + '_' + (currentUserId() || 'anon'); }
function prefGet(name) {
  try { var raw = localStorage.getItem(prefKey(name)); return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
}
function prefSet(name, value) {
  try { localStorage.setItem(prefKey(name), JSON.stringify(value)); } catch (err) { /* ignorado */ }
}
function prefRemove(name) {
  try { localStorage.removeItem(prefKey(name)); } catch (err) { /* ignorado */ }
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ── toasts globais ──
// Um só lugar na tela (fixo acima da tab bar, sempre visível mesmo depois
// de rolar), lido por leitor de tela (role=status no container) e com
// variação visual pra sucesso / erro / info. `action` vira um botão no
// próprio toast — usado pelo "Desfazer" das exclusões.
var toastTimer = null;
function notify(message, opts) {
  opts = opts || {};
  var type = opts.type || 'info';
  clearTimeout(toastTimer);
  var region = els.toastRegion;
  region.innerHTML = '';
  var toast = document.createElement('div');
  toast.className = 'app-toast app-toast-' + type;
  if (type === 'error') toast.setAttribute('role', 'alert');
  var text = document.createElement('span');
  text.className = 'app-toast-text';
  text.textContent = message;
  toast.appendChild(text);
  if (opts.action) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-toast-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', function () {
      clearTimeout(toastTimer);
      region.innerHTML = '';
      opts.action.onClick();
    });
    toast.appendChild(btn);
  }
  region.appendChild(toast);
  toastTimer = setTimeout(function () { region.innerHTML = ''; }, opts.duration || (type === 'error' ? 6000 : 4000));
}
function notifyError(message) { notify(message, { type: 'error' }); }
function notifySuccess(message) { notify(message, { type: 'success' }); }

// ── validação inline (mensagem junto do campo, não num toast distante) ──
function setFieldError(input, message) {
  var err = document.getElementById('err-' + input.id);
  input.setAttribute('aria-invalid', 'true');
  input.classList.add('is-invalid');
  if (err) { err.textContent = message; err.hidden = false; }
  input.focus();
}
function clearFieldError(input) {
  var err = document.getElementById('err-' + input.id);
  input.removeAttribute('aria-invalid');
  input.classList.remove('is-invalid');
  if (err) { err.textContent = ''; err.hidden = true; }
}
document.addEventListener('input', function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('is-invalid')) clearFieldError(e.target);
});

function parseDecimal(raw) {
  var s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (s === '') return null;
  var n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

// ── estados de carregamento / erro ──
function skeletonRows(n) {
  var rows = [];
  for (var i = 0; i < (n || 3); i++) {
    rows.push('<div class="skeleton-row" aria-hidden="true"><span class="sk sk-day"></span><span class="sk sk-mid"></span><span class="sk sk-end"></span></div>');
  }
  return '<div class="skeleton" role="status" aria-label="Carregando">' + rows.join('') + '</div>';
}

// Erro com ação, não "recarregue a página": data-retry é tratado pelo
// listener delegado abaixo (ver RETRY_HANDLERS).
function errorStateHTML(message, retryKey) {
  return '<div class="error-state"><p>' + esc(message) + '</p>' +
    (retryKey ? '<button type="button" class="retry-btn" data-retry="' + retryKey + '">Tentar de novo</button>' : '') +
    '</div>';
}
var RETRY_HANDLERS = {};
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('[data-retry]');
  if (!btn) return;
  var handler = RETRY_HANDLERS[btn.dataset.retry];
  if (handler) handler();
});

// ── "Ver mais" no lugar de paginação ──
function renderMoreButton(btn, shown, total) {
  btn.hidden = shown >= total;
  btn.textContent = 'Ver mais (' + (total - shown) + ')';
}

// ── diálogos acessíveis: Esc fecha, clique fora fecha, foco preso dentro
// e devolvido ao elemento de origem ao fechar ──
var openDialogs = [];
function openDialog(overlay, opts) {
  opts = opts || {};
  var previous = document.activeElement;
  overlay.hidden = false;
  function focusables() {
    return Array.prototype.filter.call(
      overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && !el.hidden && el.offsetParent !== null; }
    );
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close('escape'); }
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function onOverlayClick(e) { if (e.target === overlay && !opts.persistent) close('overlay'); }
  function close(reason) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKey);
    overlay.removeEventListener('click', onOverlayClick);
    openDialogs = openDialogs.filter(function (d) { return d !== handle; });
    if (previous && previous.focus) previous.focus();
    if (opts.onClose) opts.onClose(reason);
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', onOverlayClick);
  var handle = { close: close };
  openDialogs.push(handle);
  var initial = opts.initialFocus || focusables()[0];
  if (initial) setTimeout(function () { initial.focus(); }, 0);
  return handle;
}

// ── confirm modal (substitui window.confirm, no visual do app) ──
function confirmModal(message, confirmLabel) {
  return new Promise(function (resolve) {
    els.confirmModalMessage.textContent = message;
    els.confirmModalConfirm.textContent = confirmLabel || 'Excluir';
    var settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      els.confirmModalCancel.removeEventListener('click', onCancel);
      els.confirmModalConfirm.removeEventListener('click', onConfirm);
      dialog.close('done');
      resolve(result);
    }
    function onCancel() { finish(false); }
    function onConfirm() { finish(true); }
    var dialog = openDialog(els.confirmModal, {
      initialFocus: els.confirmModalCancel,
      onClose: function () { if (!settled) { settled = true; resolve(false); } },
    });
    els.confirmModalCancel.addEventListener('click', onCancel);
    els.confirmModalConfirm.addEventListener('click', onConfirm);
  });
}

// ── exclusão com "Desfazer" ──
// Tira o item da tela na hora e só apaga no banco depois da janela de
// desfazer. Se a pessoa sair do app nesse meio tempo, as exclusões
// pendentes são confirmadas (pagehide / aba oculta) — ninguém perde o
// "excluir" que pediu, e quem tocou em Desfazer não perde o dado.
var pendingDeletes = [];
function deleteWithUndo(opts) {
  opts.removeLocal();
  opts.render();
  var entry = { committed: false, timer: null, commit: null };
  entry.commit = function () {
    if (entry.committed) return;
    entry.committed = true;
    clearTimeout(entry.timer);
    pendingDeletes = pendingDeletes.filter(function (p) { return p !== entry; });
    opts.commit().catch(function (err) {
      console.error('Falha ao excluir', err);
      opts.restoreLocal();
      opts.render();
      notifyError('Não foi possível excluir. O registro voltou para a lista.');
    });
  };
  entry.timer = setTimeout(entry.commit, UNDO_WINDOW_MS);
  pendingDeletes.push(entry);
  notify(opts.message, {
    duration: UNDO_WINDOW_MS,
    action: {
      label: 'Desfazer',
      onClick: function () {
        if (entry.committed) return;
        entry.committed = true;
        clearTimeout(entry.timer);
        pendingDeletes = pendingDeletes.filter(function (p) { return p !== entry; });
        opts.restoreLocal();
        opts.render();
        notify('Exclusão desfeita.');
      },
    },
  });
}
function flushPendingDeletes() {
  pendingDeletes.slice().forEach(function (p) { p.commit(); });
}
window.addEventListener('pagehide', flushPendingDeletes);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flushPendingDeletes();
});

// ── deslizar pra esquerda = excluir (com Desfazer) ──
function attachSwipeToDelete(listEl, onDelete) {
  var startX = 0, startY = 0, row = null, dx = 0, tracking = false;
  listEl.addEventListener('touchstart', function (e) {
    var r = e.target.closest('[data-swipe-id]');
    if (!r || e.target.closest('button, a, input')) { row = null; return; }
    row = r; tracking = false; dx = 0;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
  }, { passive: true });
  listEl.addEventListener('touchmove', function (e) {
    if (!row) return;
    var mx = e.touches[0].clientX - startX;
    var my = e.touches[0].clientY - startY;
    if (!tracking) {
      if (Math.abs(mx) < 8) return;
      if (Math.abs(my) > Math.abs(mx)) { row = null; return; }
      tracking = true;
    }
    dx = Math.min(0, mx);
    row.style.transform = 'translateX(' + dx + 'px)';
    row.classList.toggle('swipe-armed', dx < -80);
  }, { passive: true });
  listEl.addEventListener('touchend', function () {
    if (!row) return;
    var r = row;
    row = null;
    r.style.transform = '';
    r.classList.remove('swipe-armed');
    if (tracking && dx < -80) onDelete(r.dataset.swipeId);
  });
}

// ── celebração (meta batida / conquista nova) ──
function celebrate(message) {
  notify(message, { type: 'success', duration: 5000 });
  if (prefersReducedMotion()) return;
  var colors = ['#2563eb', '#16a34a', '#f59e0b', '#ec4899', '#8b5cf6'];
  var pieces = [];
  for (var i = 0; i < 40; i++) {
    pieces.push('<span style="left:' + Math.round(Math.random() * 100) + '%;background:' + colors[i % colors.length] +
      ';animation-delay:' + (Math.random() * 0.4).toFixed(2) + 's;transform:rotate(' + Math.round(Math.random() * 360) + 'deg)"></span>');
  }
  els.confetti.innerHTML = pieces.join('');
  els.confetti.classList.add('is-on');
  setTimeout(function () { els.confetti.classList.remove('is-on'); els.confetti.innerHTML = ''; }, 2200);
}

// Mostrar/ocultar senha em qualquer campo com [data-toggle-password].
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('[data-toggle-password]');
  if (!btn) return;
  var input = document.getElementById(btn.dataset.togglePassword);
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Ocultar' : 'Mostrar';
  btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
});


// ── auth: login, esqueci a senha, nova senha, logout, roteamento por papel ──
async function doLogout() {
  flushPendingDeletes();
  var userId = currentUserId();
  await supabase.auth.signOut();
  if (userId) clearUserCache(userId);
}

async function confirmLogout() {
  var ok = await confirmModal('Sair da conta?', 'Sair');
  if (ok) doLogout();
}

els.btnLogoutConfig.addEventListener('click', confirmLogout);

function showLoginView(view) {
  els.loginViewSignin.hidden = view !== 'signin';
  els.loginViewForgot.hidden = view !== 'forgot';
  els.loginViewNewpass.hidden = view !== 'newpass';
}

function showLoginScreen(errorMessage) {
  els.appShell.hidden = true;
  els.screenLogin.hidden = false;
  showLoginView('signin');
  if (errorMessage) {
    els.loginError.textContent = errorMessage;
    els.loginError.hidden = false;
  }
}

// Tela de nova senha: usada no link de recuperação ("esqueci minha senha")
// e no primeiro acesso de quem recebeu uma senha provisória do admin.
function showNewPasswordScreen(mode) {
  state.passwordMode = mode;
  els.appShell.hidden = true;
  els.screenLogin.hidden = false;
  els.newpassHelp.textContent = mode === 'first'
    ? 'Sua senha atual é provisória, definida pelo administrador. Crie uma senha só sua para continuar.'
    : 'Crie uma nova senha para a sua conta.';
  els.newpass1.value = '';
  els.newpass2.value = '';
  els.newpassError.hidden = true;
  showLoginView('newpass');
  els.newpass1.focus();
}

function resetAppState() {
  state.session = null;
  state.profile = null;
  state.offlineMode = false;
  state.passwordMode = null;
  offlineResources = {};
  state.workouts = [];
  state.loading = true;
  state.loadError = false;
  state.weights = [];
  state.weightsLoading = true;
  state.weightsLoadError = false;
  state.weightFilterFrom = '';
  state.weightFilterTo = '';
  state.weightVal = '';
  state.measurements = [];
  state.measurementsLoading = true;
  state.measurementsLoadError = false;
  state.measurementsPages = 1;
  state.editingMeasurementId = null;
  state.documents = [];
  state.documentsLoading = true;
  state.documentsLoadError = false;
  state.aiSummaries = {};
  state.photos = [];
  state.photosLoading = true;
  state.photosLoadError = false;
  state.photosPages = 1;
  state.doctors = [];
  state.doctorsLoading = true;
  state.monthlyGoal = DEFAULT_MONTHLY_GOAL;
  state.weeklySummaryEmail = false;
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
  state.dayFilter = null;
  state.users = [];
  state.usersLoading = true;
  state.userLinks = [];
  state.savingLinkFor = null;
  state.patients = [];
  state.patientsLoading = true;
  state.selectedPatient = null;
  state.patientDetail = null;
  timerStateCache = null;
  els.loginEmail.value = '';
  els.loginPassword.value = '';
}

els.loginForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (state.loginLoading) return;

  var email = els.loginEmail.value.trim();
  var password = els.loginPassword.value;
  if (!email || !password) {
    els.loginError.textContent = 'Preencha e-mail e senha.';
    els.loginError.hidden = false;
    return;
  }
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

els.btnForgot.addEventListener('click', function () {
  els.forgotEmail.value = els.loginEmail.value.trim();
  els.forgotMsg.hidden = true;
  showLoginView('forgot');
  els.forgotEmail.focus();
});
els.btnForgotBack.addEventListener('click', function () { showLoginView('signin'); });

els.forgotForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var email = els.forgotEmail.value.trim();
  if (!email || email.indexOf('@') === -1) {
    els.forgotMsg.className = 'toast toast-error';
    els.forgotMsg.textContent = 'Informe um e-mail válido.';
    els.forgotMsg.hidden = false;
    return;
  }
  els.btnForgotSend.disabled = true;
  var redirectTo = window.location.origin + '/pandafit/';
  supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo })
    .catch(function (err) { console.error('Falha ao pedir recuperação de senha', err); })
    .finally(function () {
      // Mensagem neutra de propósito: não confirma se o e-mail existe.
      els.forgotMsg.className = 'toast';
      els.forgotMsg.textContent = 'Se esse e-mail tiver acesso, o link chega em alguns minutos. Confira também o spam.';
      els.forgotMsg.hidden = false;
      els.btnForgotSend.disabled = false;
    });
});

els.newpassForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var p1 = els.newpass1.value;
  var p2 = els.newpass2.value;
  function fail(msg) { els.newpassError.textContent = msg; els.newpassError.hidden = false; }
  if (p1.length < MIN_PASSWORD_LENGTH) return fail('A senha precisa ter pelo menos ' + MIN_PASSWORD_LENGTH + ' caracteres.');
  if (p1 !== p2) return fail('As duas senhas não são iguais.');
  els.btnNewpass.disabled = true;
  els.newpassError.hidden = true;
  supabase.auth.updateUser({ password: p1, data: { pandafit_trocar_senha: false } })
    .then(function (res) {
      if (res.error) throw res.error;
      state.passwordMode = null;
      return supabase.auth.getSession();
    })
    .then(function (res) {
      notifySuccess('Senha atualizada.');
      if (res && res.data && res.data.session) return handleSignedIn(res.data.session);
      showLoginScreen();
    })
    .catch(function (err) {
      console.error('Falha ao trocar senha', err);
      fail(err && /different|same/i.test(err.message || '') ? 'Use uma senha diferente da atual.' : 'Não foi possível salvar a senha. Tente de novo.');
    })
    .finally(function () { els.btnNewpass.disabled = false; });
});

function requiresPasswordChange(session) {
  var meta = session && session.user && session.user.user_metadata;
  return !!(meta && meta.pandafit_trocar_senha);
}

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
  if (state.passwordMode === 'recovery' || RECOVERY_FROM_URL) {
    RECOVERY_FROM_URL = false;
    showNewPasswordScreen('recovery');
    return;
  }
  if (requiresPasswordChange(session)) {
    showNewPasswordScreen('first');
    return;
  }
  showAppShell();
}

function renderAccountIdentity() {
  var label = displayName(state.profile) || state.profile.email || '?';
  els.accountInitial.textContent = label.charAt(0).toUpperCase();
  els.menuAvatar.textContent = label.charAt(0).toUpperCase();
  els.menuName.textContent = label;
}

var appStarted = false;
function showAppShell() {
  els.screenLogin.hidden = true;
  els.appShell.hidden = false;
  renderAccountIdentity();
  els.menuRole.textContent = state.profile.email + ' · ' + roleLabel(state.profile.role);
  els.configAccountEmail.textContent = state.profile.email + ' · ' + roleLabel(state.profile.role);

  var role = state.profile.role;
  els.settingsRowUsuarios.hidden = role !== 'admin';
  els.tabbar.hidden = role === 'medico';
  els.menuConfig.hidden = role === 'medico';
  els.menuPrivacy.hidden = role === 'medico';

  if (appStarted) return;
  appStarted = true;
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

// ── menu da conta (avatar do topo) ──
var accountMenuDialog = null;
els.btnAccount.addEventListener('click', function () {
  els.btnAccount.setAttribute('aria-expanded', 'true');
  accountMenuDialog = openDialog(els.accountMenu, {
    onClose: function () { els.btnAccount.setAttribute('aria-expanded', 'false'); },
  });
});
function closeAccountMenu() { if (accountMenuDialog) accountMenuDialog.close('done'); }
els.menuClose.addEventListener('click', closeAccountMenu);
els.menuConfig.addEventListener('click', function () { closeAccountMenu(); setTab('config'); });
els.menuPrivacy.addEventListener('click', function () { closeAccountMenu(); setTab('privacidade'); });
els.menuLogout.addEventListener('click', function () { closeAccountMenu(); confirmLogout(); });

// ── tab bar ──
document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () { setTab(btn.dataset.tab); });
});

// Configurações e suas sub-telas são abertas pelo menu da conta (avatar),
// não pela tab bar — nenhuma aba fica marcada enquanto uma delas está aberta.
var TAB_KEYS = ['painel', 'registrar', 'progresso', 'documentos'];

function setTab(tab) {
  state.tab = tab;
  // Usado pelo CSS pra subir os toasts acima da barra "Salvar treino".
  document.querySelector('.app').dataset.tab = tab;
  Object.keys(els.screens).forEach(function (key) {
    els.screens[key].hidden = key !== tab;
  });
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    var active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (tab === 'painel') renderPainel();
  if (tab === 'registrar') setRegistrarSection(state.registrarSection);
  if (tab === 'progresso') renderProgresso();
  if (tab === 'documentos') renderDocuments();
  if (tab === 'meta') renderMeta();
  if (tab === 'config') renderConfig();
  if (tab === 'modalidades') renderWorkoutTypes();
  if (tab === 'locais') renderLocations();
  if (tab === 'exercicios') renderExerciseCatalog();
  if (tab === 'privacidade') loadDoctors();
  if (tab === 'usuarios') { renderUsers(); loadUsers(); }
}

document.querySelectorAll('.settings-row').forEach(function (btn) {
  btn.addEventListener('click', function () { setTab(btn.dataset.open); });
});
document.querySelectorAll('[data-back]').forEach(function (btn) {
  btn.addEventListener('click', function () { setTab(btn.dataset.back); });
});
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('[data-goto]');
  if (btn) setTab(btn.dataset.goto);
});

function renderOfflineBanner() {
  els.offlineBanner.hidden = !state.offlineMode;
}

function renderActiveTab() {
  renderOfflineBanner();
  if (state.tab === 'painel') renderPainel();
  if (state.tab === 'progresso') renderProgresso();
  if (state.tab === 'documentos') renderDocuments();
  if (state.tab === 'meta') renderMeta();
  if (state.tab === 'config') renderConfig();
  if (state.tab === 'modalidades') renderWorkoutTypes();
  if (state.tab === 'locais') renderLocations();
  if (state.tab === 'exercicios') renderExerciseCatalog();
  if (state.tab === 'registrar' && state.registrarSection === 'peso') renderWeightForm();
}


// ── registrar: treino / peso ──
function setRegistrarSection(section) {
  state.registrarSection = section;
  document.querySelectorAll('.section-tab').forEach(function (btn) {
    var active = btn.dataset.section === section;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  els.sectionTreino.hidden = section !== 'treino';
  els.sectionPeso.hidden = section !== 'peso';
  els.saveBarTreino.hidden = section !== 'treino';
  updateEditUI();
  if (section === 'peso') renderWeightForm();
  else renderRegistrar();
}

// ── editar um treino/peso existente ──
function updateEditUI() {
  var editingTreino = state.editingWorkoutId != null;
  var editingPeso = state.editingWeightId != null;
  var editingCurrent = (state.registrarSection === 'treino' && editingTreino) ||
    (state.registrarSection === 'peso' && editingPeso);

  els.btnCancelEdit.hidden = !editingCurrent;
  els.registrarTitle.textContent = state.registrarSection === 'treino'
    ? (editingTreino ? 'Editar treino' : 'Registrar treino')
    : (editingPeso ? 'Editar peso' : 'Peso e medidas');
  els.modeTabsWrap.hidden = editingTreino;
  els.btnSaveLabel.textContent = editingTreino ? 'Salvar alterações' : 'Salvar treino';
  els.btnSaveWeightLabel.textContent = editingPeso ? 'Salvar alterações' : 'Salvar peso';
}

function startEditWorkout(w) {
  state.editingWorkoutId = w.id;
  state.editingWeightId = null;
  state.mode = 'manual';
  state.dateVal = w.date;
  state.minsVal = w.minutes;
  state.type = w.type;
  state.local = w.local || '';
  state.workoutExercises = cloneWorkoutExercises(state.workoutSets[w.id] || []);
  state.registrarSection = 'treino';
  setTab('registrar');
  updateEditUI();
}

function resetWorkoutForm() {
  state.dateVal = todayISO();
  state.minsVal = 60;
  state.type = state.workoutTypes.length ? state.workoutTypes[0].name : '';
  state.local = '';
  state.workoutExercises = [];
}

function cancelEditWorkout() {
  state.editingWorkoutId = null;
  resetWorkoutForm();
  renderRegistrar();
  updateEditUI();
}

// Cópia profunda pra editar sem mutar o cache de state.workoutSets até salvar.
function cloneWorkoutExercises(exercises) {
  return exercises.map(function (ex) {
    return { name: ex.name, sets: ex.sets.map(function (s) { return { reps: s.reps, weight: s.weight == null ? '' : s.weight }; }) };
  });
}

function startEditWeight(w) {
  state.editingWeightId = w.id;
  state.editingWorkoutId = null;
  state.weightDateVal = w.date;
  state.weightVal = fmtWeight(w.weight_kg);
  state.registrarSection = 'peso';
  setTab('registrar');
  updateEditUI();
}

function cancelEditWeight() {
  state.editingWeightId = null;
  state.weightDateVal = todayISO();
  state.weightVal = '';
  renderWeightForm();
  updateEditUI();
}

els.btnCancelEdit.addEventListener('click', function () {
  if (state.registrarSection === 'treino') cancelEditWorkout();
  else cancelEditWeight();
});

document.querySelectorAll('.section-tab').forEach(function (btn) {
  btn.addEventListener('click', function () { setRegistrarSection(btn.dataset.section); });
});

// ── repetir o último treino (prefill + 1 toque pra salvar) ──
function lastWorkout() {
  return state.workouts.length ? state.workouts[0] : null; // já vem data desc, created_at desc
}

els.btnRepeatLast.addEventListener('click', function () {
  var w = lastWorkout();
  if (!w) return;
  state.editingWorkoutId = null;
  state.mode = 'manual';
  state.dateVal = todayISO();
  state.minsVal = w.minutes;
  state.type = state.workoutTypes.some(function (t) { return t.name === w.type; }) ? w.type : state.type;
  state.local = w.local || '';
  state.workoutExercises = cloneWorkoutExercises(state.workoutSets[w.id] || []);
  state.registrarSection = 'treino';
  setTab('registrar');
  notify('Treino copiado para hoje. Confira e toque em Salvar.');
});

// ── mode tabs (Cronômetro / Manual) ──
els.modeTabs.forEach(function (btn) {
  btn.addEventListener('click', function () {
    state.mode = btn.dataset.mode;
    renderRegistrar();
  });
});

// ── cronômetro persistente ──
// O tempo não é mais um contador em memória (que zerava ao fechar o app e
// atrasava quando o sistema suspendia o PWA): guarda o instante de início
// no aparelho e calcula "agora − início". Fechar, trocar de app ou
// recarregar não perde o treino.
//   { startedAt: ms | null (null = pausado), accumulatedMs, startDate: 'YYYY-MM-DD' }
var timerStateCache = null;
function timerState() {
  if (!timerStateCache) timerStateCache = prefGet('timer') || { startedAt: null, accumulatedMs: 0, startDate: null };
  return timerStateCache;
}
function saveTimerState(t) {
  timerStateCache = t;
  if (!t.startedAt && !t.accumulatedMs) prefRemove('timer');
  else prefSet('timer', t);
}
function timerRunning() { return !!timerState().startedAt; }
function timerElapsedSecs() {
  var t = timerState();
  var ms = t.accumulatedMs + (t.startedAt ? Date.now() - t.startedAt : 0);
  return Math.max(0, Math.floor(ms / 1000));
}
function timerActive() { return timerRunning() || timerState().accumulatedMs > 0; }

function startTimerLoop() {
  if (timerHandle) return;
  timerHandle = setInterval(function () {
    if (timerRunning()) {
      updateClock();
      if (state.tab === 'painel') renderTimerBanner();
    }
  }, 1000);
}

els.btnToggleRun.addEventListener('click', function () {
  var t = timerState();
  if (t.startedAt) {
    saveTimerState({ startedAt: null, accumulatedMs: t.accumulatedMs + (Date.now() - t.startedAt), startDate: t.startDate });
  } else {
    var startDate = t.startDate || todayISO();
    saveTimerState({ startedAt: Date.now(), accumulatedMs: t.accumulatedMs, startDate: startDate });
    // O treino "pertence" ao dia em que começou (um treino que passa da
    // meia-noite não pula de dia) — a data continua editável antes de salvar.
    if (state.editingWorkoutId == null) { state.dateVal = startDate; els.inputDate.value = startDate; }
  }
  updateTimerControls();
  updateClock();
});

els.btnResetRun.addEventListener('click', async function () {
  if (timerElapsedSecs() > 60) {
    var ok = await confirmModal('Zerar o cronômetro? O tempo marcado até agora será descartado.', 'Zerar');
    if (!ok) return;
  }
  saveTimerState({ startedAt: null, accumulatedMs: 0, startDate: null });
  updateTimerControls();
  updateClock();
  renderTimerBanner();
});

function fmtClock(secs) {
  var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
}

function updateClock() {
  els.clock.textContent = fmtClock(timerElapsedSecs());
}

function fmtTime(ms) {
  var d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function updateTimerControls() {
  var running = timerRunning();
  var t = timerState();
  els.timerDot.classList.toggle('running', running);
  els.timerRunLabel.textContent = running ? 'Em andamento' : (t.accumulatedMs > 0 ? 'Pausado' : 'Pronto para começar');
  els.btnToggleRun.textContent = running ? 'Pausar' : (t.accumulatedMs > 0 ? 'Continuar' : 'Iniciar');
  els.btnToggleRun.classList.toggle('is-running', running);
  els.timerStarted.hidden = !t.startDate;
  if (t.startDate) {
    els.timerStarted.textContent = 'Treino de ' + fmtDayLabel(t.startDate) + (running ? ' · rodando desde ' + fmtTime(t.startedAt) : '');
  }
}

function renderTimerBanner() {
  var active = timerActive() && state.editingWorkoutId == null;
  els.timerRunningBanner.hidden = !active;
  if (!active) return;
  els.timerRunningText.textContent = (timerRunning() ? 'Treino em andamento · ' : 'Treino pausado · ') + fmtClock(timerElapsedSecs());
}

els.btnOpenTimer.addEventListener('click', function () {
  state.mode = 'timer';
  state.registrarSection = 'treino';
  setTab('registrar');
});

// ── campos ──
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
    els.typeOptions.innerHTML = state.workoutTypesLoading
      ? skeletonRows(1)
      : '<p class="empty-state">Nenhuma modalidade cadastrada. <button type="button" class="link-btn inline" data-goto="modalidades">Cadastrar agora</button></p>';
    return;
  }
  els.typeOptions.innerHTML = state.workoutTypes.map(function (t, i) {
    var active = t.name === state.type;
    return '<button type="button" class="type-option' + (active ? ' active' : '') + '" data-index="' + i + '" aria-pressed="' + active + '">' +
      '<span class="type-mark"></span>' +
      '<span class="type-name">' + esc(t.name) + '</span>' +
      '<span class="type-hint">' + esc(t.hint || '') + '</span>' +
      '</button>';
  }).join('');
  els.typeOptions.querySelectorAll('.type-option').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.type = state.workoutTypes[Number(btn.dataset.index)].name;
      renderTypeOptions();
    });
  });
}

// Sugestões de local via <datalist>, alimentadas pelo catálogo em
// Configurações > Locais.
function updateLocalSuggestions() {
  els.localSuggestions.innerHTML = state.locations.map(function (loc) {
    return '<option value="' + esc(loc.name) + '"></option>';
  }).join('');
}

// ── exercícios/séries do treino em edição (rascunho em state.workoutExercises) ──
function updateExerciseSuggestions() {
  els.exerciseSuggestions.innerHTML = state.exerciseCatalog.map(function (ex) {
    return '<option value="' + esc(ex.name) + '"></option>';
  }).join('');
}

// Última execução de um exercício (pelo nome, sem diferenciar maiúsculas)
// em qualquer treino anterior — base do "pré-preencher com a última vez".
function lastExecution(name) {
  var key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  for (var i = 0; i < state.workouts.length; i++) {
    var w = state.workouts[i];
    if (w.id === state.editingWorkoutId) continue;
    var exs = state.workoutSets[w.id] || [];
    for (var j = 0; j < exs.length; j++) {
      if (exs[j].name.toLowerCase() === key) return { date: w.date, sets: exs[j].sets };
    }
  }
  return null;
}

function addExercise() {
  state.workoutExercises.push({ name: '', sets: [{ reps: '', weight: '' }] });
  renderExercisesEditor();
  var inputs = els.exercisesList.querySelectorAll('.exercise-name-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeExercise(exerciseIndex) {
  state.workoutExercises.splice(exerciseIndex, 1);
  renderExercisesEditor();
}

// "+ Série" copia a série anterior (reps e carga) — no meio do treino, o
// normal é repetir a mesma série, e digitar de novo com a mão suada é a
// maior fricção do registro detalhado.
function addSet(exerciseIndex) {
  var sets = state.workoutExercises[exerciseIndex].sets;
  var prev = sets[sets.length - 1];
  sets.push(prev ? { reps: prev.reps, weight: prev.weight } : { reps: '', weight: '' });
  renderExercisesEditor();
}

function removeSet(exerciseIndex, setIndex) {
  var exercise = state.workoutExercises[exerciseIndex];
  exercise.sets.splice(setIndex, 1);
  if (exercise.sets.length === 0) state.workoutExercises.splice(exerciseIndex, 1);
  renderExercisesEditor();
}

function setsAreBlank(sets) {
  return sets.every(function (s) { return (s.reps === '' || s.reps == null) && (s.weight === '' || s.weight == null); });
}

// Reconstrói o HTML só quando a estrutura muda (adicionar/remover exercício
// ou série) — digitar num campo não passa por aqui (ver o listener de
// "input" abaixo), senão o cursor pularia do campo a cada tecla.
function renderExercisesEditor() {
  if (state.workoutExercises.length === 0) {
    els.exercisesList.innerHTML = '<p class="empty-state">Nenhum exercício adicionado. A duração já basta pra registrar o treino.</p>';
    return;
  }
  els.exercisesList.innerHTML = state.workoutExercises.map(function (exercise, ei) {
    var setsHtml = exercise.sets.map(function (set, si) {
      return '<div class="set-row">' +
        '<span class="set-num">' + (si + 1) + '</span>' +
        '<input type="number" inputmode="numeric" min="1" class="set-reps" placeholder="Reps" aria-label="Repetições da série ' + (si + 1) + '" value="' +
        esc(set.reps === '' || set.reps == null ? '' : set.reps) + '" data-exercise="' + ei + '" data-set="' + si + '" data-field="reps" />' +
        '<span class="set-x">×</span>' +
        '<input type="text" inputmode="decimal" class="set-weight" placeholder="kg" aria-label="Carga da série ' + (si + 1) + '" value="' +
        esc(set.weight === '' || set.weight == null ? '' : set.weight) + '" data-exercise="' + ei + '" data-set="' + si + '" data-field="weight" />' +
        '<button type="button" class="set-remove" data-exercise="' + ei + '" data-set="' + si + '" aria-label="Remover série ' + (si + 1) + '">' + DELETE_ICON_SVG + '</button>' +
        '</div>';
    }).join('');
    var last = lastExecution(exercise.name);
    var hint = last ? '<div class="exercise-last">Última vez (' + fmtDayLabel(last.date) + '): ' + esc(fmtSetsSummary(last.sets)) + '</div>' : '';
    return '<div class="exercise-card">' +
      '<div class="exercise-card-head">' +
      '<input type="text" class="exercise-name-input" placeholder="Nome do exercício" aria-label="Nome do exercício" list="exercise-suggestions" value="' +
      esc(exercise.name || '') + '" data-exercise="' + ei + '" data-field="name" />' +
      '<button type="button" class="record-delete exercise-remove" data-exercise="' + ei + '" aria-label="Remover exercício">' + DELETE_ICON_SVG + '</button>' +
      '</div>' +
      hint +
      setsHtml +
      '<button type="button" class="add-set-btn" data-exercise="' + ei + '">+ Série (copia a anterior)</button>' +
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

// Ao escolher o nome do exercício, se as séries ainda estão em branco,
// pré-preenche com o que foi feito da última vez.
els.exercisesList.addEventListener('change', function (e) {
  var t = e.target;
  if (t.dataset.field !== 'name') return;
  var ex = state.workoutExercises[Number(t.dataset.exercise)];
  var last = lastExecution(ex.name);
  if (last && setsAreBlank(ex.sets)) {
    ex.sets = last.sets.map(function (s) { return { reps: s.reps, weight: s.weight == null ? '' : fmtWeight(s.weight) }; });
  }
  renderExercisesEditor();
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
          var weight = parseDecimal(s.weight);
          if (!reps || reps < 1) return null;
          return { reps: reps, weight: weight != null && !isNaN(weight) && weight >= 0 ? weight : null };
        })
        .filter(Boolean);
      if (!name || sets.length === 0) return null;
      return { name: name, sets: sets };
    })
    .filter(Boolean);
}

// ── conquistas: badges calculados na hora a partir dos dados carregados ──
var ACHIEVEMENTS = [
  { title: 'Primeiro treino', desc: 'Registre seu primeiro treino.', check: function () { return state.workouts.length >= 1; } },
  { title: '10 treinos', desc: 'Registre 10 treinos.', check: function () { return state.workouts.length >= 10; } },
  { title: '50 treinos', desc: 'Registre 50 treinos.', check: function () { return state.workouts.length >= 50; } },
  { title: '100 treinos', desc: 'Registre 100 treinos.', check: function () { return state.workouts.length >= 100; } },
  { title: 'Primeiro peso', desc: 'Registre seu primeiro peso.', check: function () { return state.weights.length >= 1; } },
  { title: '30 registros de peso', desc: 'Registre seu peso 30 vezes.', check: function () { return state.weights.length >= 30; } },
  { title: 'Sequência de 3 meses', desc: 'Bata a meta mensal 3 meses seguidos.', check: function () { return computeGoalStreak() >= 3; } },
  { title: 'Sequência de 6 meses', desc: 'Bata a meta mensal 6 meses seguidos.', check: function () { return computeGoalStreak() >= 6; } },
  { title: 'Primeira foto', desc: 'Envie sua primeira foto de progresso.', check: function () { return state.photos.length >= 1; } },
];

function unlockedAchievements() {
  return ACHIEVEMENTS.filter(function (a) { return a.check(); }).map(function (a) { return a.title; });
}

function currentMonthCount() {
  var range = monthRange(new Date());
  return state.workouts.filter(function (w) {
    var d = parseISO(w.date);
    return d >= range.start && d <= range.end;
  }).length;
}

// Compara antes/depois de uma ação (salvar treino, peso, foto) e comemora
// o que mudou: meta do mês batida agora ou conquista nova.
function celebrateChanges(before) {
  var goalNow = currentMonthCount();
  if (before.monthCount < state.monthlyGoal && goalNow >= state.monthlyGoal) {
    celebrate('Meta do mês batida! ' + goalNow + ' de ' + state.monthlyGoal + ' treinos.');
    return;
  }
  var now = unlockedAchievements();
  var fresh = now.filter(function (t) { return before.achievements.indexOf(t) === -1; });
  if (fresh.length) celebrate('Conquista desbloqueada: ' + fresh[0] + '!');
}
function snapshotProgress() {
  return { monthCount: currentMonthCount(), achievements: unlockedAchievements() };
}

// ── save ──
function liveMinutes() {
  if (state.mode === 'timer' && state.editingWorkoutId == null) {
    return Math.min(MAX_WORKOUT_MINUTES, Math.max(1, Math.round(timerElapsedSecs() / 60)));
  }
  return parseInt(state.minsVal, 10);
}

els.btnSave.addEventListener('click', function () {
  if (state.saving) return;

  if (!state.type) {
    notifyError('Escolha uma modalidade (ou cadastre uma em Configurações › Modalidades).');
    return;
  }

  var usingTimer = state.mode === 'timer' && state.editingWorkoutId == null;
  if (usingTimer && timerElapsedSecs() < 1) {
    notifyError('Inicie o cronômetro ou use o modo Manual.');
    return;
  }
  var min = liveMinutes();
  if (!usingTimer && (!min || min < 1 || min > MAX_WORKOUT_MINUTES)) {
    setFieldError(els.inputMins, 'Informe a duração em minutos (1 a ' + MAX_WORKOUT_MINUTES + ').');
    return;
  }

  var dateISO = clampDateToToday(state.dateVal || todayISO());
  var local = state.local.trim();
  var isNewLocal = local && !state.locations.some(function (l) { return l.name === local; });
  var exercisesToSave = collectValidExercises();
  var newExerciseNames = exercisesToSave
    .map(function (ex) { return ex.name; })
    .filter(function (name) { return !state.exerciseCatalog.some(function (e) { return e.name === name; }); });
  var editingId = state.editingWorkoutId;
  var before = snapshotProgress();

  state.saving = true;
  els.btnSave.disabled = true;
  els.btnSaveLabel.textContent = 'Salvando…';

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
        sortWorkouts();
        state.editingWorkoutId = null;
        resetWorkoutForm();
        notifySuccess('Treino atualizado.');
      } else {
        state.workouts.unshift(row);
        sortWorkouts();
        state.recordsPages = 1;
        if (usingTimer) saveTimerState({ startedAt: null, accumulatedMs: 0, startDate: null });
        resetWorkoutForm();
        notifySuccess(row.type + ' de ' + fmtDuration(min) + ' registrado. Boa!');
      }
      cacheSet(currentUserId(), 'workouts', state.workouts);
      cacheSet(currentUserId(), 'workoutSets', state.workoutSets);
      updateEditUI();
      renderRegistrar();
      updateLocalSuggestions();
      celebrateChanges(before);

      // Local digitado que ainda não estava no catálogo entra sozinho.
      if (isNewLocal) {
        ensureLocationExists(local)
          .then(function () { return fetchLocations(currentUserId()); })
          .then(function (rows) {
            state.locations = rows;
            updateLocalSuggestions();
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
      notifyError('Não foi possível salvar. Confira a conexão e tente de novo.');
    })
    .finally(function () {
      state.saving = false;
      els.btnSave.disabled = false;
      updateEditUI();
    });
});

function sortWorkouts() {
  state.workouts.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.id || 0) - (a.id || 0);
  });
}

function handleDeleteWorkout(id) {
  var idx = state.workouts.findIndex(function (w) { return w.id === id; });
  if (idx === -1) return;
  var removed = state.workouts[idx];
  var removedSets = state.workoutSets[id];
  if (state.editingWorkoutId === id) cancelEditWorkout();
  deleteWithUndo({
    message: 'Treino de ' + fmtDayLabel(removed.date) + ' excluído.',
    removeLocal: function () {
      state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
      delete state.workoutSets[id];
    },
    restoreLocal: function () {
      if (!state.workouts.some(function (w) { return w.id === id; })) state.workouts.push(removed);
      sortWorkouts();
      if (removedSets) state.workoutSets[id] = removedSets;
    },
    commit: function () {
      return deleteWorkout(id).then(function () {
        cacheSet(currentUserId(), 'workouts', state.workouts);
      });
    },
    render: renderPainel,
  });
}

// ── render: Registrar (treino) ──
function renderRegistrar() {
  var editing = state.editingWorkoutId != null;
  var timerMode = state.mode === 'timer' && !editing;
  els.modeTabs.forEach(function (btn) {
    var active = btn.dataset.mode === state.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  els.timerCard.hidden = !timerMode;
  els.fieldMins.hidden = timerMode;

  // No cronômetro, a data sugerida é o dia em que o treino começou.
  if (timerMode && timerState().startDate && !editing) state.dateVal = timerState().startDate;
  els.inputDate.value = state.dateVal;
  els.inputDate.max = todayISO();
  els.inputMins.value = state.minsVal;
  els.inputLocal.value = state.local;

  updateTimerControls();
  updateClock();
  renderTypeOptions();
  renderExercisesEditor();
}


// ── peso: formulário com stepper, pré-preenchido com o último valor ──
els.inputWeightDate.addEventListener('change', function (e) {
  state.weightDateVal = e.target.value || todayISO();
});
els.inputWeightValue.addEventListener('input', function (e) {
  state.weightVal = e.target.value;
});

function stepWeight(delta) {
  var current = parseDecimal(state.weightVal);
  if (current == null || isNaN(current)) current = state.weights.length ? Number(state.weights[0].weight_kg) : 70;
  var next = Math.max(0.1, Math.round((current + delta) * 10) / 10);
  state.weightVal = fmtWeight(next);
  els.inputWeightValue.value = state.weightVal;
  clearFieldError(els.inputWeightValue);
}
els.btnWeightMinus.addEventListener('click', function () { stepWeight(-0.1); });
els.btnWeightPlus.addEventListener('click', function () { stepWeight(0.1); });

function renderWeightForm() {
  // Pesar todo dia vira: abrir, ajustar ±0,1 e salvar.
  if (!state.weightVal && state.editingWeightId == null && state.weights.length) {
    state.weightVal = fmtWeight(state.weights[0].weight_kg);
  }
  els.inputWeightDate.value = state.weightDateVal;
  els.inputWeightDate.max = todayISO();
  els.inputWeightValue.value = state.weightVal;
  var last = state.weights[0];
  els.weightLastHint.textContent = last ? 'Último: ' + fmtWeight(last.weight_kg) + ' kg em ' + fmtDayLabel(last.date) : '';
  renderMeasurementForm();
}

els.btnSaveWeight.addEventListener('click', function () {
  if (state.savingWeight) return;

  var dateISO = clampDateToToday(state.weightDateVal || todayISO());
  var weight = parseDecimal(state.weightVal);
  if (weight == null || isNaN(weight) || weight <= 0 || weight >= 500) {
    setFieldError(els.inputWeightValue, 'Informe um peso válido, entre 0 e 500 kg.');
    return;
  }
  var editingId = state.editingWeightId;
  var before = snapshotProgress();

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
      state.weightsPages = 1;
      cacheSet(currentUserId(), 'weights', state.weights);
      var target = state.targetWeight;
      var extra = target ? ' Faltam ' + fmtWeight(Math.abs(row.weight_kg - target)) + ' kg para a meta.' : '';
      if (editingId != null) {
        state.editingWeightId = null;
        state.weightDateVal = todayISO();
        updateEditUI();
        notifySuccess('Peso atualizado.');
      } else {
        notifySuccess('Peso de ' + fmtWeight(row.weight_kg) + ' kg registrado em ' + fmtDayLabel(row.date) + '.' + extra);
      }
      renderWeightForm();
      celebrateChanges(before);
    })
    .catch(function (err) {
      console.error('Falha ao salvar peso', err);
      notifyError('Não foi possível salvar o peso. Tente de novo.');
    })
    .finally(function () {
      state.savingWeight = false;
      els.btnSaveWeight.disabled = false;
    });
});

function handleDeleteWeight(id) {
  var removed = state.weights.find(function (w) { return w.id === id; });
  if (!removed) return;
  if (state.editingWeightId === id) cancelEditWeight();
  deleteWithUndo({
    message: 'Peso de ' + fmtDayLabel(removed.date) + ' excluído.',
    removeLocal: function () { state.weights = state.weights.filter(function (w) { return w.id !== id; }); },
    restoreLocal: function () {
      if (!state.weights.some(function (w) { return w.id === id; })) state.weights.push(removed);
      state.weights.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    },
    commit: function () {
      return deleteWeight(id).then(function () { cacheSet(currentUserId(), 'weights', state.weights); });
    },
    render: renderWeights,
  });
}

// ── medidas corporais (cintura / % gordura) ──
els.inputMeasurementDate.addEventListener('change', function (e) {
  state.measurementDateVal = e.target.value || todayISO();
});
els.inputMeasurementWaist.addEventListener('input', function (e) {
  state.measurementWaistVal = e.target.value;
});
els.inputMeasurementBodyFat.addEventListener('input', function (e) {
  state.measurementBodyFatVal = e.target.value;
});

function renderMeasurementForm() {
  els.inputMeasurementDate.value = state.measurementDateVal;
  els.inputMeasurementDate.max = todayISO();
  els.inputMeasurementWaist.value = state.measurementWaistVal;
  els.inputMeasurementBodyFat.value = state.measurementBodyFatVal;
  var editing = state.editingMeasurementId != null;
  els.btnCancelEditMeasurement.hidden = !editing;
  els.btnSaveMeasurementLabel.textContent = editing ? 'Salvar alterações' : 'Salvar medidas';
}

els.btnSaveMeasurement.addEventListener('click', function () {
  if (state.savingMeasurement) return;

  var dateISO = clampDateToToday(state.measurementDateVal || todayISO());
  var waist = parseDecimal(state.measurementWaistVal);
  var bodyFat = parseDecimal(state.measurementBodyFatVal);

  if (waist != null && (isNaN(waist) || waist <= 0 || waist >= 300)) {
    setFieldError(els.inputMeasurementWaist, 'Informe uma cintura entre 0 e 300 cm.');
    return;
  }
  if (bodyFat != null && (isNaN(bodyFat) || bodyFat <= 0 || bodyFat >= 100)) {
    setFieldError(els.inputMeasurementBodyFat, 'Informe um % de gordura entre 0 e 100.');
    return;
  }
  if (waist == null && bodyFat == null) {
    setFieldError(els.inputMeasurementWaist, 'Preencha a cintura, o % de gordura ou os dois.');
    return;
  }

  var editingId = state.editingMeasurementId;
  state.savingMeasurement = true;
  els.btnSaveMeasurement.disabled = true;

  var op = editingId != null
    ? updateBodyMeasurement(editingId, { date: dateISO, waist_cm: waist, body_fat_pct: bodyFat })
    : upsertBodyMeasurement({ date: dateISO, waist_cm: waist, body_fat_pct: bodyFat });

  op
    .then(function (row) {
      state.measurements = state.measurements.filter(function (m) { return m.id !== row.id && m.date !== row.date; });
      state.measurements.push(row);
      state.measurements.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      state.measurementsPages = 1;
      cacheSet(currentUserId(), 'measurements', state.measurements);
      if (editingId != null) {
        cancelEditMeasurement();
        notifySuccess('Medidas atualizadas.');
      } else {
        state.measurementWaistVal = '';
        state.measurementBodyFatVal = '';
        renderMeasurementForm();
        notifySuccess('Medidas registradas em ' + fmtDayLabel(row.date) + '.');
      }
    })
    .catch(function (err) {
      console.error('Falha ao salvar medidas', err);
      notifyError('Não foi possível salvar as medidas. Tente de novo.');
    })
    .finally(function () {
      state.savingMeasurement = false;
      els.btnSaveMeasurement.disabled = false;
    });
});

function startEditMeasurement(m) {
  state.editingMeasurementId = m.id;
  state.measurementDateVal = m.date;
  state.measurementWaistVal = m.waist_cm != null ? fmtWeight(m.waist_cm) : '';
  state.measurementBodyFatVal = m.body_fat_pct != null ? fmtWeight(m.body_fat_pct) : '';
  state.registrarSection = 'peso';
  setTab('registrar');
  els.inputMeasurementWaist.focus();
}

function cancelEditMeasurement() {
  state.editingMeasurementId = null;
  state.measurementDateVal = todayISO();
  state.measurementWaistVal = '';
  state.measurementBodyFatVal = '';
  renderMeasurementForm();
}

els.btnCancelEditMeasurement.addEventListener('click', cancelEditMeasurement);

function handleDeleteMeasurement(id) {
  var removed = state.measurements.find(function (m) { return m.id === id; });
  if (!removed) return;
  if (state.editingMeasurementId === id) cancelEditMeasurement();
  deleteWithUndo({
    message: 'Medidas de ' + fmtDayLabel(removed.date) + ' excluídas.',
    removeLocal: function () { state.measurements = state.measurements.filter(function (m) { return m.id !== id; }); },
    restoreLocal: function () {
      if (!state.measurements.some(function (m) { return m.id === id; })) state.measurements.push(removed);
      state.measurements.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    },
    commit: function () {
      return deleteBodyMeasurement(id).then(function () { cacheSet(currentUserId(), 'measurements', state.measurements); });
    },
    render: renderMeasurements,
  });
}

// Procura pra trás (registros mais antigos) o valor anterior desse campo —
// cintura e %gordura podem não estar preenchidos em todo registro.
function findPrevMeasurementValue(sortedList, fromIndex, field) {
  for (var j = fromIndex + 1; j < sortedList.length; j++) {
    if (sortedList[j][field] != null) return sortedList[j][field];
  }
  return null;
}

function measurementDelta(current, previous) {
  if (previous == null) return { trendClass: '', label: '·' };
  var diff = current - previous;
  if (diff > 0.05) return { trendClass: 'weight-up', label: '▲ ' + fmtWeight(diff) };
  if (diff < -0.05) return { trendClass: 'weight-down', label: '▼ ' + fmtWeight(Math.abs(diff)) };
  return { trendClass: '', label: '= 0,0' };
}

function measurementRowHTML(m, prevWaist, prevFat, withActions) {
  var waistDelta = m.waist_cm != null ? measurementDelta(m.waist_cm, prevWaist) : null;
  var bodyFatDelta = m.body_fat_pct != null ? measurementDelta(m.body_fat_pct, prevFat) : null;
  return '<div class="record-row' + (withActions ? ' has-edit" data-swipe-id="' + m.id : '') + '">' +
    '<span class="record-day">' + fmtDayLabel(m.date) + '</span>' +
    '<span class="record-mid">' +
    (m.waist_cm != null ? '<span class="record-type">Cintura ' + fmtWeight(m.waist_cm) + ' cm</span>' : '') +
    (m.body_fat_pct != null ? '<span class="record-local">Gordura ' + fmtWeight(m.body_fat_pct) + '%</span>' : '') +
    '</span>' +
    '<span class="measurement-delta-col">' +
    (waistDelta ? '<span class="weight-delta ' + waistDelta.trendClass + '">' + waistDelta.label + '</span>' : '') +
    (bodyFatDelta ? '<span class="weight-delta ' + bodyFatDelta.trendClass + '">' + bodyFatDelta.label + '</span>' : '') +
    '</span>' +
    (withActions
      ? '<button type="button" class="record-edit" data-id="' + m.id + '" aria-label="Editar medidas de ' + fmtDayLabel(m.date) + '">' + EDIT_ICON_SVG + '</button>' +
        '<button type="button" class="record-delete" data-id="' + m.id + '" aria-label="Excluir medidas de ' + fmtDayLabel(m.date) + '">' + DELETE_ICON_SVG + '</button>'
      : '') +
    '</div>';
}

function renderMeasurements() {
  if (state.measurementsLoading) {
    els.measurementsList.innerHTML = skeletonRows(2);
    els.measurementsMore.hidden = true;
    return;
  }
  if (state.measurementsLoadError) {
    els.measurementsList.innerHTML = errorStateHTML('Não foi possível carregar as medidas.', 'own');
    els.measurementsMore.hidden = true;
    return;
  }

  var sorted = state.measurements; // já ordenado por data desc
  els.measurementCountNote.textContent = sorted.length + (sorted.length === 1 ? ' registro' : ' registros');

  if (sorted.length === 0) {
    els.measurementsList.innerHTML = '<p class="empty-state">Nenhuma medida registrada ainda. <button type="button" class="link-btn inline" data-goto-peso>Registrar agora</button></p>';
    els.measurementsMore.hidden = true;
    return;
  }

  var shown = Math.min(sorted.length, state.measurementsPages * RECORDS_PAGE_SIZE);
  els.measurementsList.innerHTML = sorted.slice(0, shown).map(function (m, i) {
    return measurementRowHTML(m, findPrevMeasurementValue(sorted, i, 'waist_cm'), findPrevMeasurementValue(sorted, i, 'body_fat_pct'), true);
  }).join('');
  renderMoreButton(els.measurementsMore, shown, sorted.length);
}

els.measurementsList.addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-id]');
  if (!btn) return;
  var id = Number(btn.dataset.id);
  if (btn.classList.contains('record-edit')) {
    var m = state.measurements.find(function (x) { return x.id === id; });
    if (m) startEditMeasurement(m);
  } else if (btn.classList.contains('record-delete')) {
    handleDeleteMeasurement(id);
  }
});
attachSwipeToDelete(els.measurementsList, function (id) { handleDeleteMeasurement(Number(id)); });
els.measurementsMore.addEventListener('click', function () { state.measurementsPages += 1; renderMeasurements(); });

document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('[data-goto-peso]')) {
    state.registrarSection = 'peso';
    setTab('registrar');
  }
});

// ── fotos de progresso ──
var PHOTOS_PAGE_SIZE = 6;

els.btnUploadPhoto.addEventListener('click', function () {
  if (state.uploadingPhoto) return;

  var file = els.inputPhotoFile.files && els.inputPhotoFile.files[0];
  if (!file) {
    notifyError('Escolha uma foto primeiro.');
    return;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    notifyError('Arquivo maior que 10MB. Escolha um menor.');
    return;
  }
  var before = snapshotProgress();

  state.uploadingPhoto = true;
  els.btnUploadPhoto.disabled = true;
  els.btnUploadPhoto.textContent = 'Enviando…';

  uploadProgressPhoto(file, todayISO())
    .then(function (photo) {
      state.photos.unshift(photo);
      state.photosPages = 1;
      els.inputPhotoFile.value = '';
      notifySuccess('Foto enviada. Veja em Progresso › Galeria.');
      celebrateChanges(before);
    })
    .catch(function (err) {
      console.error('Falha ao enviar foto', err);
      notifyError('Não foi possível enviar a foto. Tente de novo.');
    })
    .finally(function () {
      state.uploadingPhoto = false;
      els.btnUploadPhoto.disabled = false;
      els.btnUploadPhoto.textContent = 'Enviar foto';
    });
});

async function handleDeletePhotoClick(photo) {
  if (state.deletingPhotoId) return;
  var ok = await confirmModal('Excluir esta foto de progresso? Essa ação não pode ser desfeita.');
  if (!ok) return;

  state.deletingPhotoId = photo.id;
  deleteProgressPhoto(photo)
    .then(function () {
      state.photos = state.photos.filter(function (p) { return p.id !== photo.id; });
      notify('Foto excluída.');
    })
    .catch(function (err) {
      console.error('Falha ao excluir foto', err);
      notifyError('Não foi possível excluir a foto. Tente de novo.');
    })
    .finally(function () {
      state.deletingPhotoId = null;
      renderPhotosGallery();
    });
}

// Renderiza os tiles na hora (sem esperar a imagem) e busca as URLs
// assinadas de todas as miniaturas visíveis numa chamada só.
function renderPhotosGallery() {
  els.photosCountNote.textContent = state.photos.length + (state.photos.length === 1 ? ' foto' : ' fotos');
  els.btnOpenCompare.hidden = state.photos.length < 2;

  if (state.photosLoading) {
    els.photosGallery.innerHTML = skeletonRows(1);
    els.photosMore.hidden = true;
    return;
  }
  if (state.photosLoadError) {
    els.photosGallery.innerHTML = errorStateHTML('Não foi possível carregar as fotos.', 'own');
    els.photosMore.hidden = true;
    return;
  }
  if (state.photos.length === 0) {
    els.photosGallery.innerHTML = '<p class="empty-state">Nenhuma foto enviada ainda. <button type="button" class="link-btn inline" data-goto-peso>Enviar a primeira</button></p>';
    els.photosMore.hidden = true;
    return;
  }

  var shown = Math.min(state.photos.length, state.photosPages * PHOTOS_PAGE_SIZE);
  var pageItems = state.photos.slice(0, shown);

  els.photosGallery.innerHTML = pageItems.map(function (p) {
    return '<div class="photo-tile">' +
      '<button type="button" class="photo-thumb-wrap" data-path="' + esc(p.file_path) + '" aria-label="Abrir foto de ' + fmtDayLabel(p.taken_at) + '"><img class="photo-thumb" data-path="' + esc(p.file_path) + '" alt="Foto de ' + fmtDayLabel(p.taken_at) + '" /></button>' +
      '<div class="photo-tile-foot">' +
      '<span class="photo-date">' + fmtDayLabel(p.taken_at) + '</span>' +
      '<button type="button" class="photo-delete" data-id="' + p.id + '" aria-label="Excluir foto de ' + fmtDayLabel(p.taken_at) + '">' + DELETE_ICON_SVG + '</button>' +
      '</div>' +
      '</div>';
  }).join('');

  var paths = pageItems.map(function (p) { return p.file_path; });
  progressPhotoSignedUrls(paths)
    .then(function (map) {
      els.photosGallery.querySelectorAll('.photo-thumb').forEach(function (img) {
        var url = map[img.dataset.path];
        if (url) img.src = url;
      });
    })
    .catch(function (err) { console.error('Falha ao gerar URLs das fotos', err); });

  renderMoreButton(els.photosMore, shown, state.photos.length);
}

els.photosGallery.addEventListener('click', function (e) {
  var del = e.target.closest('.photo-delete');
  if (del) {
    var photo = state.photos.find(function (p) { return p.id === Number(del.dataset.id); });
    if (photo) handleDeletePhotoClick(photo);
    return;
  }
  var open = e.target.closest('.photo-thumb-wrap');
  if (open) {
    var img = open.querySelector('img');
    if (img && img.src) window.open(img.src, '_blank', 'noopener');
  }
});
els.photosMore.addEventListener('click', function () { state.photosPages += 1; renderPhotosGallery(); });

// ── comparador antes/depois ──
function photoOptionLabel(p) { return fmtFullDayLabel(p.taken_at); }

els.btnOpenCompare.addEventListener('click', function () {
  var asc = state.photos.slice().sort(function (a, b) { return a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : 0; });
  var options = asc.map(function (p, i) { return '<option value="' + i + '">' + photoOptionLabel(p) + '</option>'; }).join('');
  els.compareBefore.innerHTML = options;
  els.compareAfter.innerHTML = options;
  els.compareBefore.value = '0';
  els.compareAfter.value = String(asc.length - 1);
  els.compareRange.value = 50;
  compareState.photos = asc;
  updateCompareImages();
  applyCompareSplit();
  openDialog(els.compareModal);
});
var compareState = { photos: [] };

function updateCompareImages() {
  var before = compareState.photos[Number(els.compareBefore.value)];
  var after = compareState.photos[Number(els.compareAfter.value)];
  if (!before || !after) return;
  els.compareImgBefore.removeAttribute('src');
  els.compareImgAfter.removeAttribute('src');
  progressPhotoSignedUrls([before.file_path, after.file_path])
    .then(function (map) {
      els.compareImgBefore.src = map[before.file_path] || '';
      els.compareImgAfter.src = map[after.file_path] || '';
    })
    .catch(function (err) {
      console.error('Falha ao carregar fotos do comparador', err);
      notifyError('Não foi possível carregar as fotos.');
    });
}
function applyCompareSplit() {
  var pct = Number(els.compareRange.value);
  els.compareAfterClip.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
  els.compareDivider.style.left = pct + '%';
}
els.compareBefore.addEventListener('change', updateCompareImages);
els.compareAfter.addEventListener('change', updateCompareImages);
els.compareRange.addEventListener('input', applyCompareSplit);
els.compareClose.addEventListener('click', function () {
  openDialogs.forEach(function (d) { d.close('done'); });
});

// ── render: Progresso ──
function renderProgresso() {
  renderOfflineBanner();
  renderTargetWeightNote();
  renderWeights();
  renderMeasurements();
  renderPhotosGallery();
  renderEvolution();
  renderAchievements();
}

function renderTargetWeightNote() {
  var target = state.targetWeight;
  if (!target || !state.weights.length) { els.targetWeightNote.textContent = ''; return; }
  var diff = state.weights[0].weight_kg - target;
  els.targetWeightNote.textContent = Math.abs(diff) < 0.05
    ? 'Meta de ' + fmtWeight(target) + ' kg batida!'
    : 'Meta ' + fmtWeight(target) + ' kg · faltam ' + fmtWeight(Math.abs(diff)) + ' kg';
}

function renderAchievements() {
  var unlockedCount = 0;
  els.achievementsGrid.innerHTML = ACHIEVEMENTS.map(function (a) {
    var unlocked = a.check();
    if (unlocked) unlockedCount++;
    return '<div class="achievement-tile' + (unlocked ? ' unlocked' : '') + '">' +
      '<div class="achievement-title">' + (unlocked ? '★ ' : '') + a.title + '</div>' +
      '<div class="achievement-desc">' + a.desc + '</div>' +
      '</div>';
  }).join('');
  els.achievementsCountNote.textContent = unlockedCount + ' de ' + ACHIEVEMENTS.length;
}

function renderEvolution() {
  if (state.loading || state.loadError) {
    els.evolutionList.innerHTML = state.loading ? skeletonRows(2) : '';
    return;
  }
  var now = new Date();
  var goal = state.monthlyGoal;
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
    return '<div class="evolution-row' + (isCurrent ? ' is-current' : '') + (mCount >= goal ? ' hit-goal' : '') + '">' +
      '<span class="evolution-label">' + m.label + '</span>' +
      '<div class="evolution-bar"><div class="evolution-bar-fill" style="width:' + barPct + '%"></div></div>' +
      '<span class="evolution-count">' + mCount + '</span>' +
      '</div>';
  }).join('');
}

// Gráfico SVG simples da tendência de peso, com a linha da meta (se houver).
// Cores via `style` (não atributos) pra resolver var() e acompanhar o dark mode.
function buildWeightChartHTML(weights, targetKg) {
  var asc = weights.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  if (asc.length < 2) {
    return '<p class="empty-state">Registre pelo menos 2 pesos para ver o gráfico.</p>';
  }

  var recent = asc.slice(-WEIGHT_CHART_MAX_POINTS);
  var values = recent.map(function (w) { return Number(w.weight_kg); });
  if (targetKg) values.push(Number(targetKg));
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (min === max) { min -= 1; max += 1; }

  var W = 300, H = 100, PAD = 6;
  var n = recent.length;
  function yOf(kg) { return H - PAD - ((kg - min) / (max - min)) * (H - PAD * 2); }
  var pts = recent.map(function (w, i) {
    var x = (i / (n - 1)) * (W - PAD * 2) + PAD;
    return { x: x, y: yOf(Number(w.weight_kg)) };
  });
  var pathD = pts.map(function (p, i) {
    return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
  }).join(' ');
  var last = pts[pts.length - 1];
  var first = recent[0];
  var lastWeight = recent[n - 1];
  var targetLine = targetKg
    ? '<line x1="0" x2="' + W + '" y1="' + yOf(Number(targetKg)).toFixed(1) + '" y2="' + yOf(Number(targetKg)).toFixed(1) + '" style="stroke:var(--good);stroke-width:1;stroke-dasharray:4 3" />'
    : '';

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="weight-chart" role="img" aria-label="Peso de ' +
    fmtWeight(first.weight_kg) + ' kg em ' + fmtDayLabel(first.date) + ' para ' + fmtWeight(lastWeight.weight_kg) + ' kg em ' + fmtDayLabel(lastWeight.date) + '">' +
    targetLine +
    '<path d="' + pathD + '" fill="none" style="stroke:var(--accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round" />' +
    '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3.5" style="fill:var(--accent)" />' +
    '</svg>' +
    '<div class="chart-caption">' +
    '<span>' + fmtDayLabel(first.date) + ' · ' + fmtWeight(first.weight_kg) + ' kg</span>' +
    (targetKg ? '<span class="chart-caption-target">meta ' + fmtWeight(targetKg) + ' kg</span>' : '') +
    '<span class="chart-caption-current">' + fmtDayLabel(lastWeight.date) + ' · ' + fmtWeight(lastWeight.weight_kg) + ' kg</span>' +
    '</div>';
}

// Filtro "De/Até" do histórico de peso — no cliente, sem consulta extra.
function filterWeightsByDate(list) {
  var from = state.weightFilterFrom;
  var to = state.weightFilterTo;
  if (!from && !to) return list;
  return list.filter(function (w) {
    return (!from || w.date >= from) && (!to || w.date <= to);
  });
}

els.inputWeightFilterFrom.addEventListener('change', function (e) {
  state.weightFilterFrom = e.target.value;
  state.weightsPages = 1;
  renderWeights();
});
els.inputWeightFilterTo.addEventListener('change', function (e) {
  state.weightFilterTo = e.target.value;
  state.weightsPages = 1;
  renderWeights();
});
els.btnClearWeightFilter.addEventListener('click', function () {
  state.weightFilterFrom = '';
  state.weightFilterTo = '';
  state.weightsPages = 1;
  renderWeights();
});

function weightDeltaLabel(w, prev) {
  if (!prev) return { trendClass: '', label: '·' };
  var diff = w.weight_kg - prev.weight_kg;
  if (diff > 0.05) return { trendClass: 'weight-up', label: '▲ ' + fmtWeight(diff) };
  if (diff < -0.05) return { trendClass: 'weight-down', label: '▼ ' + fmtWeight(Math.abs(diff)) };
  return { trendClass: '', label: '= 0,0' };
}

function renderWeights() {
  els.inputWeightFilterFrom.value = state.weightFilterFrom;
  els.inputWeightFilterTo.value = state.weightFilterTo;
  els.inputWeightFilterFrom.max = todayISO();
  els.inputWeightFilterTo.max = todayISO();
  els.btnClearWeightFilter.hidden = !state.weightFilterFrom && !state.weightFilterTo;

  if (state.weightsLoading) {
    els.weightsList.innerHTML = skeletonRows(3);
    els.weightsMore.hidden = true;
    els.weightChartWrap.innerHTML = '';
    return;
  }
  if (state.weightsLoadError) {
    els.weightsList.innerHTML = errorStateHTML('Não foi possível carregar os pesos.', 'own');
    els.weightsMore.hidden = true;
    els.weightChartWrap.innerHTML = '';
    return;
  }

  var sorted = filterWeightsByDate(state.weights); // já ordenado por data desc
  var filterActive = !!(state.weightFilterFrom || state.weightFilterTo);
  els.weightChartWrap.innerHTML = buildWeightChartHTML(sorted, state.targetWeight);
  els.weightCountNote.textContent = sorted.length + (sorted.length === 1 ? ' registro' : ' registros');
  renderTargetWeightNote();

  if (sorted.length === 0) {
    els.weightsList.innerHTML = '<p class="empty-state">' +
      (filterActive ? 'Nenhum peso registrado nesse período.' : 'Nenhum peso registrado ainda. <button type="button" class="link-btn inline" data-goto-peso>Registrar agora</button>') +
      '</p>';
    els.weightsMore.hidden = true;
    return;
  }

  var shown = Math.min(sorted.length, state.weightsPages * RECORDS_PAGE_SIZE);
  els.weightsList.innerHTML = sorted.slice(0, shown).map(function (w, i) {
    var d = weightDeltaLabel(w, sorted[i + 1]);
    return '<div class="record-row has-edit" data-swipe-id="' + w.id + '">' +
      '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
      '<span class="weight-value">' + fmtWeight(w.weight_kg) + ' kg</span>' +
      '<span class="weight-delta ' + d.trendClass + '">' + d.label + '</span>' +
      '<button type="button" class="record-edit" data-id="' + w.id + '" aria-label="Editar peso de ' + fmtDayLabel(w.date) + '">' + EDIT_ICON_SVG + '</button>' +
      '<button type="button" class="record-delete" data-id="' + w.id + '" aria-label="Excluir peso de ' + fmtDayLabel(w.date) + '">' + DELETE_ICON_SVG + '</button>' +
      '</div>';
  }).join('');
  renderMoreButton(els.weightsMore, shown, sorted.length);
}

els.weightsList.addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-id]');
  if (!btn) return;
  var id = Number(btn.dataset.id);
  if (btn.classList.contains('record-edit')) {
    var w = state.weights.find(function (x) { return x.id === id; });
    if (w) startEditWeight(w);
  } else if (btn.classList.contains('record-delete')) {
    handleDeleteWeight(id);
  }
});
attachSwipeToDelete(els.weightsList, function (id) { handleDeleteWeight(Number(id)); });
els.weightsMore.addEventListener('click', function () { state.weightsPages += 1; renderWeights(); });


// ── painel: navegação entre meses ──
els.monthPrev.addEventListener('click', function () {
  if (state.painelMonthOffset >= MAX_MONTH_OFFSET) return;
  state.painelMonthOffset += 1;
  state.recordsPages = 1;
  state.dayFilter = null;
  renderPainel();
});
els.monthNext.addEventListener('click', function () {
  if (state.painelMonthOffset <= 0) return;
  state.painelMonthOffset -= 1;
  state.recordsPages = 1;
  state.dayFilter = null;
  renderPainel();
});
els.recordsMore.addEventListener('click', function () {
  state.recordsPages += 1;
  renderPainel();
});
els.btnClearDayFilter.addEventListener('click', function () {
  state.dayFilter = null;
  renderPainel();
});

// ── lembretes no Painel ──
// Dispensar vale pro dia inteiro (salvo no aparelho), e cada lembrete tem
// uma ação direta em vez de só um aviso.
function dismissedToday() {
  var saved = prefGet('dismissed') || {};
  return saved.date === todayISO() ? saved.ids || {} : {};
}
function dismissReminder(id) {
  var ids = dismissedToday();
  ids[id] = true;
  prefSet('dismissed', { date: todayISO(), ids: ids });
}

function computeReminders() {
  var reminders = [];

  if (state.painelMonthOffset === 0 && !state.loading && !state.loadError) {
    var goal = state.monthlyGoal;
    var count = currentMonthCount();
    if (goal && count < goal) {
      var missing = goal - count;
      var now = new Date();
      var daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
      reminders.push({
        id: 'goal',
        text: 'Faltam ' + missing + (missing === 1 ? ' treino' : ' treinos') + ' para a meta, com ' + daysLeft + (daysLeft === 1 ? ' dia' : ' dias') + ' pela frente.',
        action: 'Registrar treino',
        run: function () { state.registrarSection = 'treino'; setTab('registrar'); },
      });
    }
  }

  if (!state.weightsLoading && !state.weightsLoadError) {
    var today = todayISO();
    var hasToday = state.weights.some(function (w) { return w.date === today; });
    if (!hasToday) {
      reminders.push({
        id: 'weight',
        text: 'Você ainda não registrou seu peso hoje.',
        action: 'Registrar peso',
        run: function () { state.registrarSection = 'peso'; setTab('registrar'); els.inputWeightValue.focus(); },
      });
    }
  }

  var dismissed = dismissedToday();
  return reminders.filter(function (r) { return !dismissed[r.id]; });
}

function renderReminders() {
  var reminders = computeReminders();
  els.reminderBanners.hidden = reminders.length === 0;
  els.reminderBanners.innerHTML = reminders.map(function (r) {
    return '<div class="reminder-banner">' +
      '<span class="reminder-text">' + esc(r.text) + '</span>' +
      '<button type="button" class="banner-action" data-run="' + r.id + '">' + esc(r.action) + '</button>' +
      '<button type="button" class="reminder-banner-dismiss" data-id="' + r.id + '" aria-label="Dispensar por hoje">×</button>' +
      '</div>';
  }).join('');
  els.reminderBanners.querySelectorAll('.reminder-banner-dismiss').forEach(function (btn) {
    btn.addEventListener('click', function () {
      dismissReminder(btn.dataset.id);
      renderReminders();
    });
  });
  els.reminderBanners.querySelectorAll('[data-run]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var r = reminders.find(function (x) { return x.id === btn.dataset.run; });
      if (r) r.run();
    });
  });
}

// ── calendário do mês: cada dia é um botão ──
// Dia com treino → filtra os registros daquele dia. Dia sem treino (até
// hoje) → abre o Registrar já com a data preenchida.
var WEEKDAY_LABELS_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function buildCalendarHeatmapHTML(monthWorkouts, viewDate) {
  var year = viewDate.getFullYear();
  var month = viewDate.getMonth();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var firstWeekday = new Date(year, month, 1).getDay();
  var today = todayISO();

  var countByDay = {};
  monthWorkouts.forEach(function (w) {
    var day = parseInt(w.date.slice(8, 10), 10);
    countByDay[day] = (countByDay[day] || 0) + 1;
  });

  var cells = [];
  for (var i = 0; i < firstWeekday; i++) {
    cells.push('<span class="cal-cell cal-empty" aria-hidden="true"></span>');
  }
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = year + '-' + pad(month + 1) + '-' + pad(d);
    var count = countByDay[d] || 0;
    var level = count === 0 ? 0 : count === 1 ? 1 : 2;
    var future = dateStr > today;
    var label = fmtDayLabel(dateStr) + (count ? ', ' + count + (count === 1 ? ' treino' : ' treinos') : ', sem treino') +
      (future ? '' : count ? '. Toque para ver.' : '. Toque para registrar.');
    cells.push(
      '<button type="button" class="cal-cell cal-level-' + level + (dateStr === today ? ' cal-today' : '') +
      (state.dayFilter === dateStr ? ' cal-selected' : '') + '" data-date="' + dateStr + '" data-count="' + count + '"' +
      (future ? ' disabled' : '') + ' aria-label="' + label + '">' + d + '</button>'
    );
  }

  return (
    '<div class="cal-weekdays" aria-hidden="true">' + WEEKDAY_LABELS_PT.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</div>' +
    '<div class="cal-grid">' + cells.join('') + '</div>'
  );
}

els.calendarHeatmap.addEventListener('click', function (e) {
  var cell = e.target.closest('button.cal-cell');
  if (!cell || cell.disabled) return;
  var date = cell.dataset.date;
  if (Number(cell.dataset.count) > 0) {
    state.dayFilter = state.dayFilter === date ? null : date;
    renderPainel();
    els.recordsList.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  } else {
    state.editingWorkoutId = null;
    state.mode = 'manual';
    state.dateVal = date;
    state.registrarSection = 'treino';
    setTab('registrar');
    notify('Registrando treino de ' + fmtDayLabel(date) + '.');
  }
});

function workoutRowHTML(w, withActions) {
  var exercisesSummary = fmtExercisesSummary(state.workoutSets[w.id]);
  return '<div class="record-row' + (withActions ? ' has-edit" data-swipe-id="' + w.id : '') + '">' +
    '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
    '<span class="record-mid"><span class="record-type">' + esc(w.type) + '</span>' +
    '<span class="record-local">' + esc(w.local || 'Sem local') + '</span>' +
    (exercisesSummary ? '<span class="record-exercises">' + esc(exercisesSummary) + '</span>' : '') +
    '</span>' +
    '<span class="record-dur">' + fmtDuration(w.minutes) + '</span>' +
    (withActions
      ? '<button type="button" class="record-edit" data-id="' + w.id + '" aria-label="Editar treino de ' + fmtDayLabel(w.date) + '">' + EDIT_ICON_SVG + '</button>' +
        '<button type="button" class="record-delete" data-id="' + w.id + '" aria-label="Excluir treino de ' + fmtDayLabel(w.date) + '">' + DELETE_ICON_SVG + '</button>'
      : '') +
    '</div>';
}

els.recordsList.addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-id]');
  if (!btn) return;
  var id = Number(btn.dataset.id);
  if (btn.classList.contains('record-edit')) {
    var w = state.workouts.find(function (x) { return x.id === id; });
    if (w) startEditWorkout(w);
  } else if (btn.classList.contains('record-delete')) {
    handleDeleteWorkout(id);
  }
});
attachSwipeToDelete(els.recordsList, function (id) { handleDeleteWorkout(Number(id)); });

function renderPainelAchievements() {
  var unlocked = ACHIEVEMENTS.filter(function (a) { return a.check(); });
  var next = ACHIEVEMENTS.find(function (a) { return !a.check(); });
  els.painelAchievementsNote.textContent = unlocked.length + ' de ' + ACHIEVEMENTS.length;
  var chips = unlocked.slice(-3).reverse().map(function (a) {
    return '<span class="achievement-chip unlocked">★ ' + a.title + '</span>';
  });
  if (next) chips.push('<span class="achievement-chip">Próxima: ' + next.title + '</span>');
  els.painelAchievements.innerHTML = chips.join('') +
    '<button type="button" class="link-btn inline" data-goto="progresso">Ver todas</button>';
}

function renderPainel() {
  renderOfflineBanner();
  renderTimerBanner();
  renderReminders();
  var viewDate = viewedMonthDate();
  els.monthLabel.textContent = MONTHS_FULL_PT[viewDate.getMonth()] + ' ' + viewDate.getFullYear();
  els.monthPrev.disabled = state.painelMonthOffset >= MAX_MONTH_OFFSET;
  els.monthNext.disabled = state.painelMonthOffset <= 0;

  var last = lastWorkout();
  els.repeatCard.hidden = !last || state.painelMonthOffset !== 0;
  if (last) {
    els.repeatDesc.textContent = last.type + ' · ' + fmtDuration(last.minutes) + (last.local ? ' · ' + last.local : '');
  }

  if (state.loading) {
    els.recordsList.innerHTML = skeletonRows(3);
    els.splitsList.innerHTML = skeletonRows(1);
    els.calendarHeatmap.innerHTML = '';
    els.recordsMore.hidden = true;
    return;
  }

  if (state.loadError) {
    els.recordsList.innerHTML = errorStateHTML('Não foi possível carregar os treinos.', 'own');
    els.splitsList.innerHTML = '';
    els.calendarHeatmap.innerHTML = '';
    els.recordsMore.hidden = true;
    return;
  }

  var range = monthRange(viewDate);
  var monthWorkouts = state.workouts.filter(function (w) {
    var d = parseISO(w.date);
    return d >= range.start && d <= range.end;
  });

  els.calendarHeatmap.innerHTML = buildCalendarHeatmapHTML(monthWorkouts, viewDate);

  var goal = state.monthlyGoal;
  var count = monthWorkouts.length;
  var goalPct = goal ? Math.min(100, Math.round((count / goal) * 100)) : 0;

  els.monthCount.textContent = count;
  els.monthGoalSuffix.textContent = 'de ' + goal;
  els.goalBar.style.width = goalPct + '%';
  els.goalBarWrap.setAttribute('aria-valuenow', String(goalPct));
  els.goalPct.textContent = goalPct + '% da meta';
  els.goalMeta.textContent = 'meta ' + goal + (goal === 1 ? ' treino/mês' : ' treinos/mês');
  els.sessionCountNote.textContent = count + ' neste mês';

  var streak = computeGoalStreak();
  els.painelStreakNote.classList.toggle('is-active', streak > 0);
  els.painelStreakNote.textContent = streak > 0
    ? streak + (streak === 1 ? ' mês seguido batendo a meta' : ' meses seguidos batendo a meta')
    : 'Bata a meta este mês para começar uma sequência.';

  // divisão por modalidade (só as usadas no mês)
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
        '<div class="split-top"><span class="split-name">' + esc(typeName) + '</span>' +
        '<span class="split-value">' + fmtDuration(min) + '</span></div>' +
        '<div class="split-bar"><div class="split-bar-fill" style="width:' + pct + '%"></div>' +
        '<span class="split-pct">' + pct + '%</span></div>' +
        '</div>';
    }).join('');
  }

  // registros do mês (ou do dia selecionado no calendário), mais recentes primeiro
  var list = state.dayFilter
    ? monthWorkouts.filter(function (w) { return w.date === state.dayFilter; })
    : monthWorkouts;
  els.dayFilter.hidden = !state.dayFilter;
  if (state.dayFilter) {
    els.dayFilterLabel.textContent = 'Treinos de ' + fmtFullDayLabel(state.dayFilter);
  }

  if (list.length === 0) {
    els.recordsList.innerHTML = state.painelMonthOffset === 0
      ? '<p class="empty-state">Nenhum treino neste mês ainda. <button type="button" class="link-btn inline" data-goto="registrar">Registrar o primeiro</button></p>'
      : '<p class="empty-state">Nenhum treino registrado neste mês.</p>';
    els.recordsMore.hidden = true;
  } else {
    var shown = Math.min(list.length, state.recordsPages * RECORDS_PAGE_SIZE);
    els.recordsList.innerHTML = list.slice(0, shown).map(function (w) { return workoutRowHTML(w, true); }).join('');
    renderMoreButton(els.recordsMore, shown, list.length);
  }

  renderPainelAchievements();
}


// ── Exames (do próprio usuário) ──
els.btnUploadDocument.addEventListener('click', function () {
  if (state.uploadingDocument) return;

  var file = els.inputDocumentFile.files && els.inputDocumentFile.files[0];
  if (!file) {
    notifyError('Escolha um arquivo primeiro.');
    return;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    notifyError('Arquivo maior que 10MB. Escolha um menor.');
    return;
  }

  state.uploadingDocument = true;
  els.btnUploadDocument.disabled = true;
  els.btnUploadDocument.textContent = 'Enviando…';

  uploadDocument(file)
    .then(function (doc) {
      state.documents.unshift(doc);
      state.documentsPages = 1;
      els.inputDocumentFile.value = '';
      renderDocuments();
      notifySuccess(doc.file_name + ' enviado.');
    })
    .catch(function (err) {
      console.error('Falha ao enviar documento', err);
      notifyError('Não foi possível enviar o exame. Tente de novo.');
    })
    .finally(function () {
      state.uploadingDocument = false;
      els.btnUploadDocument.disabled = false;
      els.btnUploadDocument.textContent = 'Enviar exame';
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
      notify('Exame excluído.');
    })
    .catch(function (err) {
      console.error('Falha ao excluir documento', err);
      notifyError('Não foi possível excluir o exame. Tente de novo.');
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
    notifyError('Não foi possível abrir o exame.');
  } finally {
    linkEl.textContent = original;
  }
}

function renderDocuments() {
  if (state.documentsLoading) {
    els.documentsList.innerHTML = skeletonRows(2);
    els.documentsMore.hidden = true;
    return;
  }
  if (state.documentsLoadError) {
    els.documentsList.innerHTML = errorStateHTML('Não foi possível carregar os exames.', 'documents');
    els.documentsMore.hidden = true;
    return;
  }

  var sorted = state.documents; // já ordenado por uploaded_at desc
  els.documentCountNote.textContent = sorted.length + (sorted.length === 1 ? ' exame' : ' exames');

  if (sorted.length === 0) {
    els.documentsList.innerHTML = '<p class="empty-state">Nenhum exame enviado ainda.</p>';
    els.documentsMore.hidden = true;
    return;
  }

  var shown = Math.min(sorted.length, state.documentsPages * RECORDS_PAGE_SIZE);
  els.documentsList.innerHTML = sorted.slice(0, shown).map(function (doc) {
    var ai = state.aiSummaries[doc.id];
    return '<div class="record-row">' +
      '<span class="record-day">' + fmtDayLabel(doc.uploaded_at.slice(0, 10)) + '</span>' +
      '<span class="record-mid"><span class="record-type">' + esc(doc.file_name) + '</span>' +
      '<span class="record-local">' + fmtFileSize(doc.file_size) +
      (ai ? ' · <button type="button" class="ai-badge ai-badge-btn" data-ai-id="' + doc.id + '">Lido por IA em ' + fmtDayLabel(ai.generated_at.slice(0, 10)) + '</button>' : '') +
      '</span></span>' +
      '<a class="record-dur doc-view-link" href="#" data-path="' + esc(doc.file_path) + '">Ver</a>' +
      '<button type="button" class="record-delete" data-id="' + doc.id + '" aria-label="Excluir exame ' + esc(doc.file_name) + '">' + DELETE_ICON_SVG + '</button>' +
      '</div>';
  }).join('');
  renderMoreButton(els.documentsMore, shown, sorted.length);
}

els.documentsList.addEventListener('click', function (e) {
  var link = e.target.closest('.doc-view-link');
  if (link) {
    e.preventDefault();
    handleViewDocumentClick(link.dataset.path, link);
    return;
  }
  var ai = e.target.closest('[data-ai-id]');
  if (ai) {
    var summary = state.aiSummaries[Number(ai.dataset.aiId)];
    if (summary) {
      els.aiSummaryBody.innerHTML = '<p class="doc-ai-meta">Gerado em ' + fmtFullDayLabel(summary.generated_at.slice(0, 10)) +
        ' a pedido do seu médico. É um apoio à leitura, não um diagnóstico.</p>' +
        '<p class="doc-ai-text">' + esc(summary.summary).replace(/\n/g, '<br>') + '</p>';
      openDialog(els.aiSummaryModal);
    }
    return;
  }
  var del = e.target.closest('.record-delete');
  if (del) {
    var doc = state.documents.find(function (d) { return d.id === Number(del.dataset.id); });
    if (doc) handleDeleteDocumentClick(doc);
  }
});
els.documentsMore.addEventListener('click', function () { state.documentsPages += 1; renderDocuments(); });
els.aiSummaryClose.addEventListener('click', function () { openDialogs.forEach(function (d) { d.close('done'); }); });

function loadDocuments() {
  var userId = currentUserId();
  state.documentsLoading = true;
  state.documentsLoadError = false;
  renderActiveTab();
  return fetchDocuments(userId)
    .then(function (rows) {
      state.documents = rows;
      state.documentsLoading = false;
      return fetchAiSummaries(rows.map(function (d) { return d.id; }))
        .then(function (map) { state.aiSummaries = map; })
        .catch(function (err) { console.error('Falha ao carregar leituras de IA', err); });
    })
    .catch(function (err) {
      console.error('Falha ao carregar documentos', err);
      state.documentsLoading = false;
      state.documentsLoadError = true;
    })
    .finally(renderActiveTab);
}
RETRY_HANDLERS.documents = loadDocuments;

// ── Configurações: resumo semanal + feedback ──
function renderConfig() {
  els.toggleWeeklySummary.checked = !!state.weeklySummaryEmail;
  if (document.activeElement !== els.inputMyName) els.inputMyName.value = displayName(state.profile) || '';
}

els.btnSaveMyName.addEventListener('click', function () {
  var nome = els.inputMyName.value.trim();
  if (nome.length > 120) {
    setFieldError(els.inputMyName, 'Use no máximo 120 caracteres.');
    return;
  }
  els.btnSaveMyName.disabled = true;
  supabase.rpc('pandafit_atualizar_meu_nome', { p_nome: nome })
    .then(function (res) {
      if (res.error) throw res.error;
      state.profile.nome = res.data || null;
      renderAccountIdentity();
      notifySuccess(nome ? 'Nome salvo. É assim que seu médico vai encontrar você.' : 'Nome removido.');
    })
    .catch(function (err) {
      console.error('Falha ao salvar nome', err);
      notifyError('Não foi possível salvar o nome. Tente de novo.');
    })
    .finally(function () { els.btnSaveMyName.disabled = false; });
});

els.toggleWeeklySummary.addEventListener('change', function () {
  var on = els.toggleWeeklySummary.checked;
  els.toggleWeeklySummary.disabled = true;
  upsertSettings({ weekly_summary_email: on })
    .then(function () {
      state.weeklySummaryEmail = on;
      notifySuccess(on ? 'Pronto: você recebe o resumo toda segunda.' : 'Resumo semanal desativado.');
    })
    .catch(function (err) {
      console.error('Falha ao salvar preferência de resumo', err);
      els.toggleWeeklySummary.checked = !on;
      notifyError('Não foi possível salvar a preferência. Tente de novo.');
    })
    .finally(function () { els.toggleWeeklySummary.disabled = false; });
});

els.btnSendFeedback.addEventListener('click', function () {
  var message = els.inputFeedback.value.trim();
  if (message.length < 3) {
    setFieldError(els.inputFeedback, 'Escreva um pouco mais pra gente entender.');
    return;
  }
  els.btnSendFeedback.disabled = true;
  insertFeedback(message)
    .then(function () {
      els.inputFeedback.value = '';
      notifySuccess('Obrigado! Sua sugestão chegou.');
    })
    .catch(function (err) {
      console.error('Falha ao enviar feedback', err);
      notifyError('Não foi possível enviar agora. Tente de novo.');
    })
    .finally(function () { els.btnSendFeedback.disabled = false; });
});

// ── Metas ──
function renderMeta() {
  els.inputGoal.value = state.monthlyGoal;
  els.inputTargetWeight.value = state.targetWeight != null ? fmtWeight(state.targetWeight) : '';
  renderTargetWeightProgress();
}

function renderTargetWeightProgress() {
  var target = state.targetWeight;
  if (!target || state.weightsLoading || state.weightsLoadError || state.weights.length === 0) {
    els.targetWeightCaption.hidden = true;
    return;
  }
  var latest = state.weights[0]; // data desc
  var diff = latest.weight_kg - target;
  els.targetWeightCaption.hidden = false;
  els.targetWeightCurrent.textContent = 'atual ' + fmtWeight(latest.weight_kg) + ' kg';
  els.targetWeightRemaining.textContent = Math.abs(diff) < 0.05
    ? 'meta batida!'
    : 'faltam ' + fmtWeight(Math.abs(diff)) + ' kg para ' + fmtWeight(target) + ' kg';
}

els.btnSaveGoal.addEventListener('click', function () {
  if (state.savingGoal) return;

  var val = parseInt(els.inputGoal.value, 10);
  if (!val || val < 1 || val > 30) {
    setFieldError(els.inputGoal, 'Escolha uma meta entre 1 e 30 treinos por mês.');
    return;
  }

  state.savingGoal = true;
  els.btnSaveGoal.disabled = true;

  upsertSettings({ monthly_goal: val })
    .then(function () {
      state.monthlyGoal = val;
      cacheSet(currentUserId(), 'settings', { monthly_goal: val, target_weight_kg: state.targetWeight, weekly_summary_email: state.weeklySummaryEmail });
      notifySuccess('Meta atualizada para ' + val + (val === 1 ? ' treino/mês.' : ' treinos/mês.'));
    })
    .catch(function (err) {
      console.error('Falha ao salvar meta', err);
      notifyError('Não foi possível salvar a meta. Tente de novo.');
    })
    .finally(function () {
      state.savingGoal = false;
      els.btnSaveGoal.disabled = false;
    });
});

els.btnSaveTargetWeight.addEventListener('click', function () {
  if (state.savingTargetWeight) return;

  var kg = parseDecimal(els.inputTargetWeight.value);
  if (kg != null && (isNaN(kg) || kg <= 0 || kg >= 500)) {
    setFieldError(els.inputTargetWeight, 'Informe um peso entre 0 e 500 kg, ou deixe em branco para remover a meta.');
    return;
  }

  state.savingTargetWeight = true;
  els.btnSaveTargetWeight.disabled = true;

  upsertSettings({ target_weight_kg: kg })
    .then(function () {
      state.targetWeight = kg;
      renderTargetWeightProgress();
      notifySuccess(kg ? 'Meta de peso atualizada para ' + fmtWeight(kg) + ' kg.' : 'Meta de peso removida.');
    })
    .catch(function (err) {
      console.error('Falha ao salvar meta de peso', err);
      notifyError('Não foi possível salvar. Tente de novo.');
    })
    .finally(function () {
      state.savingTargetWeight = false;
      els.btnSaveTargetWeight.disabled = false;
    });
});

// ── export CSV ──
els.btnExportWorkouts.addEventListener('click', function () {
  var sorted = state.workouts.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  var rows = sorted.map(function (w) { return [w.date, w.type, w.minutes, w.local || '']; });
  downloadCSV('pandafit-treinos-' + todayISO() + '.csv', ['Data', 'Tipo', 'Duração (min)', 'Local'], rows);
});

els.btnExportWeights.addEventListener('click', function () {
  var sorted = state.weights.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  var rows = sorted.map(function (w) { return [w.date, w.weight_kg]; });
  downloadCSV('pandafit-pesos-' + todayISO() + '.csv', ['Data', 'Peso (kg)'], rows);
});

// ── relatório para o médico ──
// PDF de verdade (jsPDF carregado sob demanda só quando a pessoa toca no
// botão), compartilhável pelo menu nativo do celular. window.print() fica
// como plano B (sem rede / lib indisponível), porque no PWA do iOS o
// diálogo de impressão é instável.
var REPORT_RECENT_LIMIT = 15;
var JSPDF_URL = 'https://esm.sh/jspdf@2.5.2';

function reportData() {
  var recentWeights = state.weights.slice(0, REPORT_RECENT_LIMIT);
  var recentMeasurements = state.measurements.slice(0, REPORT_RECENT_LIMIT);
  var recentWorkouts = state.workouts.slice(0, REPORT_RECENT_LIMIT);
  return {
    name: (state.profile && (state.profile.nome || state.profile.email)) || '',
    generatedAt: fmtFullDayLabel(todayISO()),
    weights: recentWeights,
    measurements: recentMeasurements,
    workouts: recentWorkouts,
  };
}

async function buildReportPdf() {
  var mod = await import(JSPDF_URL);
  var JsPDF = mod.jsPDF || (mod.default && mod.default.jsPDF) || mod.default;
  var data = reportData();
  var doc = new JsPDF({ unit: 'mm', format: 'a4' });
  var y = 18;
  var left = 16;
  var pageH = 297;

  function ensure(space) { if (y + space > pageH - 16) { doc.addPage(); y = 18; } }
  function heading(text) { ensure(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(text, left, y); y += 7; }
  function para(text) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); var lines = doc.splitTextToSize(text, 178); ensure(lines.length * 5); doc.text(lines, left, y); y += lines.length * 5 + 2; }
  function table(headers, rows, widths) {
    if (!rows.length) { para('Nenhum registro ainda.'); return; }
    ensure(8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    var x = left;
    headers.forEach(function (h, i) { doc.text(h, x, y); x += widths[i]; });
    y += 2; doc.setDrawColor(200); doc.line(left, y, left + 178, y); y += 4;
    doc.setFont('helvetica', 'normal');
    rows.forEach(function (r) {
      ensure(6);
      var cx = left;
      r.forEach(function (c, i) { doc.text(String(c).slice(0, 48), cx, y); cx += widths[i]; });
      y += 5.5;
    });
    y += 3;
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text('PandaFit - Relatório de acompanhamento', left, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text((data.name ? data.name + ' | ' : '') + 'Gerado em ' + data.generatedAt, left, y); y += 10;

  heading('Peso');
  if (data.weights.length) para('Peso mais recente: ' + fmtWeight(data.weights[0].weight_kg) + ' kg (' + fmtFullDayLabel(data.weights[0].date) + ').' +
    (state.targetWeight ? ' Meta: ' + fmtWeight(state.targetWeight) + ' kg.' : ''));
  table(['Data', 'Peso (kg)'], data.weights.map(function (w) { return [fmtFullDayLabel(w.date), fmtWeight(w.weight_kg)]; }), [40, 40]);

  heading('Medidas corporais');
  table(['Data', 'Cintura (cm)', '% de gordura'], data.measurements.map(function (m) {
    return [fmtFullDayLabel(m.date), m.waist_cm != null ? fmtWeight(m.waist_cm) : '-', m.body_fat_pct != null ? fmtWeight(m.body_fat_pct) + '%' : '-'];
  }), [40, 40, 40]);

  heading('Treinos recentes');
  para('Meta mensal: ' + state.monthlyGoal + ' treinos. Neste mês: ' + currentMonthCount() + '.');
  table(['Data', 'Tipo', 'Duração', 'Local'], data.workouts.map(function (w) {
    return [fmtFullDayLabel(w.date), w.type, fmtDuration(w.minutes), w.local || '-'];
  }), [30, 55, 30, 63]);

  return doc.output('blob');
}

els.btnPrintReport.addEventListener('click', async function () {
  var btn = els.btnPrintReport;
  btn.disabled = true;
  btn.textContent = 'Gerando…';
  try {
    var blob = await buildReportPdf();
    var fileName = 'pandafit-relatorio-' + todayISO() + '.pdf';
    var file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Relatório PandaFit' });
      } catch (shareErr) {
        if (shareErr && shareErr.name === 'AbortError') return;
        throw shareErr;
      }
    } else {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
    notifySuccess('Relatório gerado.');
  } catch (err) {
    console.error('Falha ao gerar PDF, usando impressão do navegador', err);
    els.printReport.innerHTML = buildPrintReportHTML();
    document.body.classList.add('printing-report');
    window.print();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gerar PDF';
  }
});

function buildPrintReportTable(headers, rows) {
  if (rows.length === 0) return '<p class="print-report-empty">Nenhum registro ainda.</p>';
  return '<table><thead><tr>' +
    headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
    '</tr></thead><tbody>' +
    rows.map(function (cells) {
      return '<tr>' + cells.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('') +
    '</tbody></table>';
}

function buildPrintReportHTML() {
  var data = reportData();
  return '<h1>PandaFit · Relatório de acompanhamento</h1>' +
    '<p class="print-report-meta">' + (data.name ? esc(data.name) + ' · ' : '') + 'Gerado em ' + data.generatedAt + '</p>' +
    '<section><h2>Peso</h2>' +
    buildPrintReportTable(['Data', 'Peso (kg)'], data.weights.map(function (w) { return [fmtFullDayLabel(w.date), fmtWeight(w.weight_kg)]; })) +
    '</section><section><h2>Medidas corporais</h2>' +
    buildPrintReportTable(['Data', 'Cintura (cm)', '% de gordura'], data.measurements.map(function (m) {
      return [fmtFullDayLabel(m.date), m.waist_cm != null ? fmtWeight(m.waist_cm) : '-', m.body_fat_pct != null ? fmtWeight(m.body_fat_pct) + '%' : '-'];
    })) +
    '</section><section><h2>Treinos recentes</h2>' +
    buildPrintReportTable(['Data', 'Tipo', 'Duração', 'Local'], data.workouts.map(function (w) {
      return [fmtFullDayLabel(w.date), w.type, fmtDuration(w.minutes), w.local || '-'];
    })) +
    '</section>';
}

window.addEventListener('afterprint', function () {
  document.body.classList.remove('printing-report');
});

// ── Modalidades (catálogo) ──
els.btnCreateType.addEventListener('click', function () {
  if (state.creatingWorkoutType) return;

  var name = els.inputTypeName.value.trim();
  var hint = els.inputTypeHint.value.trim();
  if (!name) {
    setFieldError(els.inputTypeName, 'Informe um nome para a modalidade.');
    return;
  }
  if (state.workoutTypes.some(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })) {
    setFieldError(els.inputTypeName, 'Essa modalidade já está cadastrada.');
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
      notifySuccess('Modalidade cadastrada.');
      renderWorkoutTypes();
      renderTypeOptions();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar modalidade', err);
      notifyError('Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingWorkoutType = false;
      els.btnCreateType.disabled = false;
    });
});

function catalogRowHTML(item, sub, label) {
  return '<div class="user-row">' +
    '<div class="user-info">' +
    '<span class="user-name">' + esc(item.name) + '</span>' +
    (sub ? '<span class="user-email">' + esc(sub) + '</span>' : '') +
    '</div>' +
    '<button type="button" class="record-delete" data-id="' + item.id + '" aria-label="Excluir ' + label + ' ' + esc(item.name) + '">' + DELETE_ICON_SVG + '</button>' +
    '</div>';
}

function renderWorkoutTypes() {
  els.typesCountNote.textContent = state.workoutTypes.length + (state.workoutTypes.length === 1 ? ' modalidade' : ' modalidades');
  if (state.workoutTypesLoading) { els.typesList.innerHTML = skeletonRows(2); return; }
  if (state.workoutTypes.length === 0) {
    els.typesList.innerHTML = '<p class="empty-state">Nenhuma modalidade cadastrada ainda.</p>';
    return;
  }
  els.typesList.innerHTML = state.workoutTypes.map(function (t) { return catalogRowHTML(t, t.hint, 'modalidade'); }).join('');
}

els.typesList.addEventListener('click', function (e) {
  var btn = e.target.closest('.record-delete');
  if (!btn) return;
  var t = state.workoutTypes.find(function (x) { return x.id === Number(btn.dataset.id); });
  if (t) handleDeleteWorkoutTypeClick(t);
});

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
      notify('Modalidade excluída.');
    })
    .catch(function (err) {
      console.error('Falha ao excluir modalidade', err);
      notifyError('Não foi possível excluir. Tente de novo.');
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
    setFieldError(els.inputLocationName, 'Informe um nome para o local.');
    return;
  }
  if (state.locations.some(function (l) { return l.name.toLowerCase() === name.toLowerCase(); })) {
    setFieldError(els.inputLocationName, 'Esse local já está cadastrado.');
    return;
  }

  state.creatingLocation = true;
  els.btnCreateLocation.disabled = true;

  insertLocation(name)
    .then(function (row) {
      state.locations.push(row);
      els.inputLocationName.value = '';
      notifySuccess('Local cadastrado.');
      renderLocations();
      updateLocalSuggestions();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar local', err);
      notifyError('Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingLocation = false;
      els.btnCreateLocation.disabled = false;
    });
});

function renderLocations() {
  els.locationsCountNote.textContent = state.locations.length + (state.locations.length === 1 ? ' local' : ' locais');
  if (state.locationsLoading) { els.locationsList.innerHTML = skeletonRows(2); return; }
  if (state.locations.length === 0) {
    els.locationsList.innerHTML = '<p class="empty-state">Nenhum local cadastrado ainda.</p>';
    return;
  }
  els.locationsList.innerHTML = state.locations.map(function (l) { return catalogRowHTML(l, '', 'local'); }).join('');
}

els.locationsList.addEventListener('click', function (e) {
  var btn = e.target.closest('.record-delete');
  if (!btn) return;
  var l = state.locations.find(function (x) { return x.id === Number(btn.dataset.id); });
  if (l) handleDeleteLocationClick(l);
});

async function handleDeleteLocationClick(l) {
  if (state.deletingLocationId) return;
  var ok = await confirmModal('Excluir o local "' + l.name + '"? Treinos já registrados com ele não são afetados.');
  if (!ok) return;

  state.deletingLocationId = l.id;
  deleteLocation(l.id)
    .then(function () {
      state.locations = state.locations.filter(function (x) { return x.id !== l.id; });
      updateLocalSuggestions();
      notify('Local excluído.');
    })
    .catch(function (err) {
      console.error('Falha ao excluir local', err);
      notifyError('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingLocationId = null;
      renderLocations();
    });
}

// ── Exercícios (catálogo) ──
els.btnCreateExercise.addEventListener('click', function () {
  if (state.creatingExercise) return;

  var name = els.inputExerciseCatalogName.value.trim();
  if (!name) {
    setFieldError(els.inputExerciseCatalogName, 'Informe um nome para o exercício.');
    return;
  }
  if (state.exerciseCatalog.some(function (e) { return e.name.toLowerCase() === name.toLowerCase(); })) {
    setFieldError(els.inputExerciseCatalogName, 'Esse exercício já está cadastrado.');
    return;
  }

  state.creatingExercise = true;
  els.btnCreateExercise.disabled = true;

  insertExercise(name)
    .then(function (row) {
      state.exerciseCatalog.push(row);
      els.inputExerciseCatalogName.value = '';
      notifySuccess('Exercício cadastrado.');
      renderExerciseCatalog();
      updateExerciseSuggestions();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar exercício', err);
      notifyError('Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingExercise = false;
      els.btnCreateExercise.disabled = false;
    });
});

function renderExerciseCatalog() {
  els.exercisesCountNote.textContent = state.exerciseCatalog.length + (state.exerciseCatalog.length === 1 ? ' exercício' : ' exercícios');
  if (state.exerciseCatalogLoading) { els.exercisesCatalogList.innerHTML = skeletonRows(2); return; }
  if (state.exerciseCatalog.length === 0) {
    els.exercisesCatalogList.innerHTML = '<p class="empty-state">Nenhum exercício cadastrado ainda.</p>';
    return;
  }
  els.exercisesCatalogList.innerHTML = state.exerciseCatalog.map(function (ex) { return catalogRowHTML(ex, '', 'exercício'); }).join('');
}

els.exercisesCatalogList.addEventListener('click', function (e) {
  var btn = e.target.closest('.record-delete');
  if (!btn) return;
  var ex = state.exerciseCatalog.find(function (x) { return x.id === Number(btn.dataset.id); });
  if (ex) handleDeleteExerciseClick(ex);
});

async function handleDeleteExerciseClick(ex) {
  if (state.deletingExerciseId) return;
  var ok = await confirmModal('Excluir o exercício "' + ex.name + '"? Séries já registradas com ele não são afetadas.');
  if (!ok) return;

  state.deletingExerciseId = ex.id;
  deleteExercise(ex.id)
    .then(function () {
      state.exerciseCatalog = state.exerciseCatalog.filter(function (x) { return x.id !== ex.id; });
      updateExerciseSuggestions();
      notify('Exercício excluído.');
    })
    .catch(function (err) {
      console.error('Falha ao excluir exercício', err);
      notifyError('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingExerciseId = null;
      renderExerciseCatalog();
    });
}

// ── Quem vê meus dados (LGPD) ──
function loadDoctors() {
  state.doctorsLoading = true;
  state.doctorsLoadError = false;
  renderDoctors();
  fetchMyDoctors()
    .then(function (rows) { state.doctors = rows; })
    .catch(function (err) {
      console.error('Falha ao carregar médicos vinculados', err);
      state.doctorsLoadError = true;
    })
    .finally(function () {
      state.doctorsLoading = false;
      renderDoctors();
    });
}
RETRY_HANDLERS.doctors = loadDoctors;

function renderDoctors() {
  if (state.doctorsLoading) { els.doctorsList.innerHTML = skeletonRows(1); els.doctorsCountNote.textContent = ''; return; }
  if (state.doctorsLoadError) { els.doctorsList.innerHTML = errorStateHTML('Não foi possível carregar os médicos.', 'doctors'); return; }
  els.doctorsCountNote.textContent = state.doctors.length + (state.doctors.length === 1 ? ' médico' : ' médicos');
  if (state.doctors.length === 0) {
    els.doctorsList.innerHTML = '<p class="empty-state">Nenhum médico conectado. Hoje só você vê seus dados.</p>';
    return;
  }
  els.doctorsList.innerHTML = state.doctors.map(function (d) {
    return '<div class="user-row">' +
      '<div class="user-info">' +
      '<span class="user-name">' + esc(d.nome || d.email) + '</span>' +
      '<span class="user-email">' + esc(d.email) + ' · conectado em ' + fmtFullDayLabel(String(d.vinculado_em).slice(0, 10)) + '</span>' +
      '</div>' +
      '<button type="button" class="export-btn revoke-btn" data-medico-id="' + esc(d.medico_id) + '">Remover acesso</button>' +
      '</div>';
  }).join('');
}

els.doctorsList.addEventListener('click', async function (e) {
  var btn = e.target.closest('[data-medico-id]');
  if (!btn) return;
  var doctor = state.doctors.find(function (d) { return d.medico_id === btn.dataset.medicoId; });
  if (!doctor) return;
  var ok = await confirmModal('Remover o acesso de ' + (doctor.nome || doctor.email) + ' aos seus dados? Para reconectar, só o administrador.', 'Remover');
  if (!ok) return;
  btn.disabled = true;
  revokeDoctor(doctor.medico_id)
    .then(function () {
      state.doctors = state.doctors.filter(function (d) { return d.medico_id !== doctor.medico_id; });
      renderDoctors();
      notifySuccess('Acesso removido.');
    })
    .catch(function (err) {
      console.error('Falha ao revogar médico', err);
      btn.disabled = false;
      notifyError('Não foi possível remover o acesso. Tente de novo.');
    });
});


// ── admin: Usuários ──
els.roleOptions.querySelectorAll('.role-option').forEach(function (btn) {
  btn.addEventListener('click', function () {
    state.newUserRole = btn.dataset.role;
    els.roleOptions.querySelectorAll('.role-option').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
  });
});

// Senha provisória forte, sem caracteres ambíguos (0/O, 1/l/I).
els.btnGeneratePassword.addEventListener('click', function () {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  var pwd = Array.prototype.map.call(bytes, function (b) { return alphabet[b % alphabet.length]; }).join('');
  els.inputUserPassword.value = pwd;
  els.inputUserPassword.type = 'text';
  var toggle = document.querySelector('[data-toggle-password="input-user-password"]');
  if (toggle) { toggle.textContent = 'Ocultar'; toggle.setAttribute('aria-label', 'Ocultar senha'); }
  clearFieldError(els.inputUserPassword);
});

function loadUsers() {
  state.usersLoading = true;
  state.usersLoadError = false;
  renderUsers();
  callAdminUsers('list', {})
    .then(function (body) {
      state.users = body.usuarios;
      state.userLinks = body.vinculos || [];
      state.usersLoading = false;
    })
    .catch(function (err) {
      console.error('Falha ao carregar usuários', err);
      state.usersLoading = false;
      state.usersLoadError = true;
    })
    .finally(renderUsers);
}
RETRY_HANDLERS.users = loadUsers;

els.btnCreateUser.addEventListener('click', function () {
  if (state.creatingUser) return;

  var nome = els.inputUserNome.value.trim();
  var email = els.inputUserEmail.value.trim();
  var password = els.inputUserPassword.value;
  var role = state.newUserRole;

  if (!email || email.indexOf('@') === -1) {
    setFieldError(els.inputUserEmail, 'Informe um e-mail válido.');
    return;
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    setFieldError(els.inputUserPassword, 'A senha provisória precisa ter pelo menos ' + MIN_PASSWORD_LENGTH + ' caracteres.');
    return;
  }

  state.creatingUser = true;
  els.btnCreateUser.disabled = true;

  callAdminUsers('invite', { nome: nome, email: email, password: password, role: role })
    .then(function (body) {
      notifySuccess(body.contaExistente
        ? 'Conta existente conectada ao PandaFit como ' + roleLabel(role) + '. A senha dela não foi alterada.'
        : 'Usuário cadastrado como ' + roleLabel(role) + '. Envie a senha provisória por um canal seguro; ela será trocada no 1º acesso.');
      els.inputUserNome.value = '';
      els.inputUserEmail.value = '';
      els.inputUserPassword.value = '';
      els.inputUserPassword.type = 'password';
      loadUsers();
    })
    .catch(function (err) {
      console.error('Falha ao cadastrar usuário', err);
      notifyError(err.message || 'Não foi possível cadastrar. Tente de novo.');
    })
    .finally(function () {
      state.creatingUser = false;
      els.btnCreateUser.disabled = false;
    });
});

function renderUsers() {
  els.usersCountNote.textContent = state.users.length + (state.users.length === 1 ? ' usuário' : ' usuários');

  if (state.usersLoading) { els.usersList.innerHTML = skeletonRows(3); return; }
  if (state.usersLoadError) { els.usersList.innerHTML = errorStateHTML('Não foi possível carregar os usuários.', 'users'); return; }
  if (state.users.length === 0) { els.usersList.innerHTML = '<p class="empty-state">Nenhum usuário cadastrado ainda.</p>'; return; }

  var medicos = state.users.filter(function (u) { return u.role === 'medico'; });
  var pacientesElegiveis = state.users.filter(function (u) { return u.role === 'usuario' || u.role === 'admin'; });

  els.usersList.innerHTML = state.users.map(function (u) {
    var isSelf = u.id === currentUserId();
    var row = '<div class="user-row">' +
      '<div class="user-info">' +
      (displayName(u)
        ? '<span class="user-name">' + esc(displayName(u)) + (isSelf ? ' (você)' : '') + '</span>'
        : '<span class="user-name is-missing">Nome não cadastrado' + (isSelf ? ' (você)' : '') + '</span>') +
      '<span class="user-email">' + esc(u.email) + '</span>' +
      '<button type="button" class="link-btn user-edit-name" data-id="' + esc(u.id) + '">' + (displayName(u) ? 'Editar nome' : 'Adicionar nome') + '</button>' +
      '</div>' +
      '<select class="user-role-select" data-id="' + esc(u.id) + '" aria-label="Papel de ' + esc(u.nome || u.email) + '" ' + (isSelf ? 'disabled' : '') + '>' +
      '<option value="usuario"' + (u.role === 'usuario' ? ' selected' : '') + '>Usuário</option>' +
      '<option value="medico"' + (u.role === 'medico' ? ' selected' : '') + '>Médico</option>' +
      '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
      '</select>' +
      '<button type="button" class="record-delete user-revoke" data-id="' + esc(u.id) + '" aria-label="Revogar acesso de ' + esc(u.nome || u.email) + '" ' + (isSelf ? 'disabled' : '') + '>' +
      DELETE_ICON_SVG +
      '</button>' +
      '</div>';

    // Vínculo paciente↔médico: cada médico é um chip que liga/desliga o
    // acesso dele aos dados deste paciente (ver pandafit_medico_pacientes).
    if (u.role === 'usuario' || u.role === 'admin') {
      var linkedIds = state.userLinks
        .filter(function (l) { return l.usuario_id === u.id; })
        .map(function (l) { return l.medico_id; });

      row += '<div class="user-links-row">' +
        '<span class="user-links-label">Médicos conectados</span>' +
        (medicos.length === 0
          ? '<span class="user-email">Cadastre um médico para conectar pacientes.</span>'
          : '<div class="link-chips">' +
            medicos.map(function (m) {
              var active = linkedIds.indexOf(m.id) !== -1;
              var busy = state.savingLinkFor === m.id + ':' + u.id;
              return '<button type="button" class="link-chip' + (active ? ' active' : '') + '" aria-pressed="' + active + '" ' +
                'data-medico-id="' + esc(m.id) + '" data-usuario-id="' + esc(u.id) + '" data-linked="' + active + '" ' +
                (busy ? 'disabled' : '') + '>' + esc(m.nome || m.email) + '</button>';
            }).join('') +
            '</div>') +
        '</div>';
    }

    // Mesma coisa na direção oposta, na linha do médico.
    if (u.role === 'medico') {
      var linkedPacienteIds = state.userLinks
        .filter(function (l) { return l.medico_id === u.id; })
        .map(function (l) { return l.usuario_id; });

      row += '<div class="user-links-row">' +
        '<span class="user-links-label">Pacientes conectados</span>' +
        (pacientesElegiveis.length === 0
          ? '<span class="user-email">Cadastre um paciente (usuário) para conectar.</span>'
          : '<div class="link-chips">' +
            pacientesElegiveis.map(function (p) {
              var active = linkedPacienteIds.indexOf(p.id) !== -1;
              var busy = state.savingLinkFor === u.id + ':' + p.id;
              var isSelfPaciente = p.id === currentUserId();
              return '<button type="button" class="link-chip' + (active ? ' active' : '') + '" aria-pressed="' + active + '" ' +
                'data-medico-id="' + esc(u.id) + '" data-usuario-id="' + esc(p.id) + '" data-linked="' + active + '" ' +
                (busy ? 'disabled' : '') + '>' + esc(p.nome || p.email) + (isSelfPaciente ? ' (você)' : '') + '</button>';
            }).join('') +
            '</div>') +
        '</div>';
    }

    return row;
  }).join('');
}

els.usersList.addEventListener('change', function (e) {
  var select = e.target.closest('.user-role-select');
  if (!select) return;
  select.disabled = true;
  callAdminUsers('update_role', { userId: select.dataset.id, role: select.value })
    .then(function () { notifySuccess('Papel atualizado.'); })
    .catch(function (err) {
      console.error('Falha ao atualizar papel', err);
      notifyError(err.message || 'Não foi possível atualizar. Tente de novo.');
    })
    .finally(loadUsers);
});

els.usersList.addEventListener('click', function (e) {
  var editName = e.target.closest('.user-edit-name');
  if (editName) {
    var target = state.users.find(function (x) { return x.id === editName.dataset.id; });
    if (!target) return;
    var info = editName.closest('.user-info');
    info.innerHTML = '<label class="field"><span class="field-label">Nome de ' + esc(target.email) + '</span>' +
      '<input type="text" class="user-name-input" maxlength="120" value="' + esc(displayName(target) || '') + '" /></label>' +
      '<span class="inline-actions"><button type="button" class="link-btn user-name-save" data-id="' + esc(target.id) + '">Salvar</button>' +
      '<button type="button" class="link-btn user-name-cancel">Cancelar</button></span>';
    info.querySelector('input').focus();
    return;
  }
  if (e.target.closest('.user-name-cancel')) { renderUsers(); return; }
  var saveName = e.target.closest('.user-name-save');
  if (saveName) {
    var input = saveName.closest('.user-info').querySelector('.user-name-input');
    saveName.disabled = true;
    callAdminUsers('update_name', { userId: saveName.dataset.id, nome: input.value })
      .then(function (body) {
        var u = state.users.find(function (x) { return x.id === saveName.dataset.id; });
        if (u) u.nome = body.nome;
        if (state.profile && state.profile.id === saveName.dataset.id) { state.profile.nome = body.nome; renderAccountIdentity(); }
        notifySuccess('Nome atualizado.');
        renderUsers();
      })
      .catch(function (err) {
        console.error('Falha ao atualizar nome', err);
        notifyError(err.message || 'Não foi possível atualizar o nome.');
        saveName.disabled = false;
      });
    return;
  }

  var revoke = e.target.closest('.user-revoke');
  if (revoke) {
    var userId = revoke.dataset.id;
    var u = state.users.find(function (x) { return x.id === userId; });
    confirmModal('Revogar o acesso de ' + (u ? (u.nome || u.email) : 'este usuário') + ' ao PandaFit?', 'Revogar')
      .then(function (ok) {
        if (!ok) return null;
        return callAdminUsers('revoke', { userId: userId });
      })
      .then(function (result) {
        if (result) { notifySuccess('Acesso revogado.'); loadUsers(); }
      })
      .catch(function (err) {
        console.error('Falha ao revogar acesso', err);
        notifyError(err.message || 'Não foi possível revogar. Tente de novo.');
      });
    return;
  }

  var chip = e.target.closest('.link-chip');
  if (!chip || state.savingLinkFor) return;
  var medicoId = chip.dataset.medicoId;
  var usuarioId = chip.dataset.usuarioId;
  var linked = chip.dataset.linked === 'true';
  state.savingLinkFor = medicoId + ':' + usuarioId;
  renderUsers();
  callAdminUsers('set_link', { medicoId: medicoId, usuarioId: usuarioId, linked: !linked })
    .then(function () {
      state.userLinks = linked
        ? state.userLinks.filter(function (l) { return !(l.medico_id === medicoId && l.usuario_id === usuarioId); })
        : state.userLinks.concat([{ medico_id: medicoId, usuario_id: usuarioId }]);
    })
    .catch(function (err) {
      console.error('Falha ao atualizar vínculo paciente/médico', err);
      notifyError(err.message || 'Não foi possível atualizar o vínculo. Tente de novo.');
    })
    .finally(function () {
      state.savingLinkFor = null;
      renderUsers();
    });
});

// ── medico: Pacientes ──
function loadPatients() {
  state.patientsLoading = true;
  state.patientsLoadError = false;
  renderPatientsList();
  // A RLS de pandafit_usuarios já restringe o que volta aqui a quem está
  // vinculado a este médico — só precisa excluir outro médico da lista.
  supabase
    .from('pandafit_usuarios')
    .select('id, email, nome, role')
    .neq('role', 'medico')
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
RETRY_HANDLERS.patients = loadPatients;

function visitKey(patientId) { return 'visita_' + patientId; }

function renderPatientsList() {
  els.patientsCountNote.textContent = state.patients.length + (state.patients.length === 1 ? ' paciente' : ' pacientes');

  if (state.patientsLoading) { els.patientsList.innerHTML = skeletonRows(3); return; }
  if (state.patientsLoadError) { els.patientsList.innerHTML = errorStateHTML('Não foi possível carregar os pacientes.', 'patients'); return; }
  if (state.patients.length === 0) {
    els.patientsList.innerHTML = '<p class="empty-state">Nenhum paciente conectado a você ainda. O administrador faz essa conexão.</p>';
    return;
  }

  var query = normalizeSearch(els.inputPatientSearch.value);
  var list = state.patients
    .filter(function (p) {
      return !query || normalizeSearch((displayName(p) || '') + ' ' + p.email).indexOf(query) !== -1;
    })
    .sort(function (a, b) {
      // Com nome primeiro, em ordem alfabética; sem nome no fim, pelo e-mail.
      var na = displayName(a), nb = displayName(b);
      if (na && !nb) return -1;
      if (!na && nb) return 1;
      return (na || a.email).localeCompare(nb || b.email, 'pt-BR', { sensitivity: 'base' });
    });

  if (list.length === 0) {
    els.patientsList.innerHTML = '<p class="empty-state">Nenhum paciente encontrado para essa busca.</p>';
    return;
  }

  els.patientsList.innerHTML = list.map(function (p) {
    var lastVisit = (prefGet(visitKey(p.id)) || {}).last;
    var nome = displayName(p);
    return '<button type="button" class="patient-row" data-id="' + esc(p.id) + '">' +
      '<span class="user-info">' +
      (nome
        ? '<span class="user-name">' + esc(nome) + '</span>'
        : '<span class="user-name is-missing">Nome não cadastrado</span>') +
      '<span class="user-email">' + esc(p.email) + (lastVisit ? ' · última visita ' + fmtDayLabel(lastVisit) : '') + '</span></span>' +
      '<span class="patient-row-arrow" aria-hidden="true">›</span>' +
      '</button>';
  }).join('');
}

// Busca sem acento e sem diferenciar maiúsculas ("joao" acha "João").
function normalizeSearch(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

els.inputPatientSearch.addEventListener('input', renderPatientsList);

els.patientsList.addEventListener('click', function (e) {
  var btn = e.target.closest('.patient-row');
  if (!btn) return;
  var patient = state.patients.find(function (p) { return p.id === btn.dataset.id; });
  if (patient) openPatientDetail(patient);
});

function openPatientDetail(patient) {
  state.selectedPatient = patient;
  // "Desde a última visita": lembra (neste aparelho) quando este médico
  // abriu este paciente; abrir de novo no mesmo dia mantém a mesma base.
  var visits = prefGet(visitKey(patient.id)) || {};
  var today = todayISO();
  if (visits.last && visits.last < today) visits.prev = visits.last;
  visits.last = today;
  prefSet(visitKey(patient.id), visits);
  state.patientPrevVisit = visits.prev || null;
  els.sincePeriod.value = state.patientPrevVisit ? 'last' : '30';
  var nome = displayName(patient);
  els.pacientesTitle.textContent = nome || 'Nome não cadastrado';
  els.pacientesSubtitle.textContent = patient.email;
  els.pacientesSubtitle.hidden = false;
  els.pacientesListView.hidden = true;
  els.pacientesDetailView.hidden = false;
  window.scrollTo(0, 0);
  loadPatientDetail(patient.id);
}
RETRY_HANDLERS.patient = function () { if (state.selectedPatient) loadPatientDetail(state.selectedPatient.id); };

els.btnBackToPatients.addEventListener('click', function () {
  state.selectedPatient = null;
  els.pacientesTitle.textContent = 'Pacientes';
  els.pacientesSubtitle.hidden = true;
  els.pacientesListView.hidden = false;
  els.pacientesDetailView.hidden = true;
  renderPatientsList();
});

function loadPatientDetail(patientId) {
  [els.patientDocumentsList, els.patientWeightsList, els.patientMeasurementsList, els.patientPhotosGallery, els.patientWorkoutsList]
    .forEach(function (el) { el.innerHTML = skeletonRows(2); });
  els.sinceGrid.innerHTML = skeletonRows(1);
  els.patientWeightChartWrap.innerHTML = '';
  els.patientDocsNote.textContent = '';
  els.patientWeightsNote.textContent = '';
  els.patientMeasurementsNote.textContent = '';
  els.patientPhotosNote.textContent = '';
  els.patientWorkoutsNote.textContent = '';

  Promise.all([
    fetchDocuments(patientId).catch(function () { return null; }),
    fetchWeights(patientId, PATIENT_SINCE_LIMIT).catch(function () { return null; }),
    fetchWorkouts(patientId, PATIENT_SINCE_LIMIT).catch(function () { return null; }),
    fetchWorkoutSets(patientId).catch(function () { return {}; }),
    fetchProgressPhotos(patientId, PATIENT_RECENT_LIMIT).catch(function () { return null; }),
    fetchBodyMeasurements(patientId, PATIENT_SINCE_LIMIT).catch(function () { return null; }),
  ]).then(function (results) {
    if (!state.selectedPatient || state.selectedPatient.id !== patientId) return;
    state.patientDetail = { documents: results[0], weights: results[1], workouts: results[2], sets: results[3], photos: results[4], measurements: results[5] };
    renderSinceCard();
    renderPatientDocuments(results[0]);
    renderPatientWeights(results[1] && results[1].slice(0, PATIENT_RECENT_LIMIT));
    renderPatientWorkouts(results[2] && results[2].slice(0, PATIENT_RECENT_LIMIT), results[3]);
    renderPatientPhotos(results[4]);
    renderPatientMeasurements(results[5] && results[5].slice(0, PATIENT_RECENT_LIMIT));
  });
}

// ── cartão "Desde a última visita" (visão do médico orientada a decisão) ──
function sinceStartDate() {
  var v = els.sincePeriod.value;
  if (v === 'last' && state.patientPrevVisit) return state.patientPrevVisit;
  var days = v === '90' ? 90 : 30;
  var d = new Date();
  d.setDate(d.getDate() - days);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function signed(n, unit) {
  if (Math.abs(n) < 0.05) return 'estável';
  return (n > 0 ? '+' : '−') + fmtWeight(Math.abs(n)) + ' ' + unit;
}

function renderSinceCard() {
  var det = state.patientDetail;
  if (!det) return;
  var since = sinceStartDate();
  var today = todayISO();
  var days = Math.max(1, Math.round((parseISO(today) - parseISO(since)) / 86400000));
  var tiles = [];

  // peso: último registro vs o último registro anterior (ou igual) ao início do período
  if (det.weights && det.weights.length) {
    var latestW = det.weights[0];
    var baseW = det.weights.find(function (w) { return w.date <= since; }) || det.weights[det.weights.length - 1];
    tiles.push({ label: 'Peso', value: fmtWeight(latestW.weight_kg) + ' kg', sub: baseW.id !== latestW.id ? signed(latestW.weight_kg - baseW.weight_kg, 'kg') + ' desde ' + fmtDayLabel(baseW.date) : 'sem comparação' });
  } else {
    tiles.push({ label: 'Peso', value: 'sem registro', sub: '' });
  }

  var waists = (det.measurements || []).filter(function (m) { return m.waist_cm != null; });
  if (waists.length) {
    var latestM = waists[0];
    var baseM = waists.find(function (m) { return m.date <= since; }) || waists[waists.length - 1];
    tiles.push({ label: 'Cintura', value: fmtWeight(latestM.waist_cm) + ' cm', sub: baseM !== latestM ? signed(latestM.waist_cm - baseM.waist_cm, 'cm') : 'sem comparação' });
  }

  var workoutsIn = (det.workouts || []).filter(function (w) { return w.date >= since; });
  var perWeek = workoutsIn.length / (days / 7);
  tiles.push({ label: 'Treinos', value: String(workoutsIn.length), sub: perWeek.toFixed(1).replace('.', ',') + ' por semana' });

  var newDocs = (det.documents || []).filter(function (d) { return d.uploaded_at.slice(0, 10) >= since; });
  tiles.push({ label: 'Exames novos', value: String(newDocs.length), sub: newDocs.length ? 'marcados como "novo" abaixo' : 'nenhum' });

  var newPhotos = (det.photos || []).filter(function (p) { return p.taken_at >= since; });
  tiles.push({ label: 'Fotos novas', value: String(newPhotos.length), sub: '' });

  var periodLabel = els.sincePeriod.value === 'last' && state.patientPrevVisit
    ? 'Desde ' + fmtFullDayLabel(state.patientPrevVisit) + ' (' + days + (days === 1 ? ' dia' : ' dias') + ')'
    : 'Últimos ' + days + ' dias';
  els.sinceGrid.innerHTML = '<p class="since-period-label">' + periodLabel + (state.patientPrevVisit ? '' : ' · primeira visita neste aparelho') + '</p>' +
    tiles.map(function (t) {
      return '<div class="since-tile"><span class="since-label">' + t.label + '</span>' +
        '<span class="since-value">' + t.value + '</span>' +
        (t.sub ? '<span class="since-sub">' + t.sub + '</span>' : '') + '</div>';
    }).join('');
}
els.sincePeriod.addEventListener('change', renderSinceCard);

function renderPatientMeasurements(measurements) {
  if (measurements == null) { els.patientMeasurementsList.innerHTML = errorStateHTML('Não foi possível carregar as medidas.', 'patient'); return; }
  els.patientMeasurementsNote.textContent = measurements.length + (measurements.length === 1 ? ' registro' : ' registros');
  if (measurements.length === 0) { els.patientMeasurementsList.innerHTML = '<p class="empty-state">Nenhuma medida registrada.</p>'; return; }
  els.patientMeasurementsList.innerHTML = measurements.map(function (m, i) {
    return measurementRowHTML(m, findPrevMeasurementValue(measurements, i, 'waist_cm'), findPrevMeasurementValue(measurements, i, 'body_fat_pct'), false);
  }).join('');
}

function renderPatientDocuments(documents) {
  if (documents == null) {
    els.patientDocsSummary.hidden = true;
    els.patientDocumentsList.innerHTML = errorStateHTML('Não foi possível carregar os exames.', 'patient');
    return;
  }
  els.patientDocsNote.textContent = documents.length + (documents.length === 1 ? ' exame' : ' exames');
  if (documents.length === 0) {
    els.patientDocsSummary.hidden = true;
    els.patientDocumentsList.innerHTML = '<p class="empty-state">Nenhum exame enviado.</p>';
    return;
  }

  var totalBytes = documents.reduce(function (a, d) { return a + d.file_size; }, 0);
  els.patientDocsSummary.hidden = false;
  els.patientDocsSummary.textContent = fmtFileSize(totalBytes) + ' ao todo · último envio em ' + fmtDayLabel(documents[0].uploaded_at.slice(0, 10));

  var since = sinceStartDate();
  els.patientDocumentsList.innerHTML = documents.map(function (doc) {
    var canAnalyze = AI_ANALYZABLE_TYPES.indexOf(doc.file_type) !== -1;
    var isNew = doc.uploaded_at.slice(0, 10) >= since;
    return '<div class="record-row has-edit">' +
      '<span class="record-day">' + fmtDayLabel(doc.uploaded_at.slice(0, 10)) + '</span>' +
      '<span class="record-mid"><span class="record-type">' + (isNew ? '<span class="new-badge">novo</span> ' : '') + esc(doc.file_name) + '</span>' +
      '<span class="record-local">' + fmtFileSize(doc.file_size) + '</span></span>' +
      '<a class="record-dur doc-view-link" href="#" data-path="' + esc(doc.file_path) + '">Ver</a>' +
      '<a class="record-dur doc-download-link" href="#" data-path="' + esc(doc.file_path) + '" data-name="' + esc(doc.file_name) + '">Baixar</a>' +
      '<button type="button" class="record-delete" data-id="' + doc.id + '" aria-label="Excluir exame ' + esc(doc.file_name) + '">' + DELETE_ICON_SVG + '</button>' +
      '</div>' +
      (canAnalyze
        ? '<div class="doc-ai-row">' +
          '<button type="button" class="doc-ai-btn" data-id="' + doc.id + '">Resumo com IA</button>' +
          '<div class="doc-ai-result" hidden></div>' +
          '</div>'
        : '');
  }).join('');
}

els.patientDocumentsList.addEventListener('click', function (e) {
  var view = e.target.closest('.doc-view-link');
  if (view) { e.preventDefault(); handleViewDocumentClick(view.dataset.path, view); return; }
  var down = e.target.closest('.doc-download-link');
  if (down) { e.preventDefault(); handleDownloadDocumentClick(down.dataset.path, down.dataset.name, down); return; }
  var ai = e.target.closest('.doc-ai-btn');
  if (ai) { handleAnalyzeDocumentClick(Number(ai.dataset.id), ai); return; }
  var del = e.target.closest('.record-delete');
  if (del && state.patientDetail) {
    var doc = state.patientDetail.documents.find(function (d) { return d.id === Number(del.dataset.id); });
    if (doc) handleDeletePatientDocumentClick(doc);
  }
});

async function handleDownloadDocumentClick(path, fileName, linkEl) {
  var original = linkEl.textContent;
  linkEl.textContent = '…';
  try {
    var url = await documentDownloadUrl(path, fileName);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    console.error('Falha ao gerar link de download', err);
    notifyError('Não foi possível baixar o exame.');
  } finally {
    linkEl.textContent = original;
  }
}

// Chama a edge function pandafit-analyze-document (Claude via API da
// Anthropic) pra gerar — ou reaproveitar do cache — um resumo do exame,
// como apoio à leitura do médico. Nunca substitui o julgamento clínico.
async function handleAnalyzeDocumentClick(documentId, btn) {
  var resultEl = btn.nextElementSibling;
  var originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Analisando…';

  try {
    var res = await callAnalyzeDocument(documentId);
    resultEl.innerHTML = '<p class="doc-ai-text">' + esc(res.summary).replace(/\n/g, '<br>') + '</p>' +
      '<p class="doc-ai-meta">O paciente vê um selo "Lido por IA" neste exame e pode abrir este resumo.</p>';
    resultEl.hidden = false;
    btn.textContent = 'Gerar de novo';
  } catch (err) {
    console.error('Falha ao gerar resumo com IA', err);
    resultEl.innerHTML = '<p class="doc-ai-error">' + esc(err.message || 'Não foi possível gerar o resumo. Tente de novo.') + '</p>';
    resultEl.hidden = false;
    btn.textContent = originalLabel;
  } finally {
    btn.disabled = false;
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
      renderSinceCard();
      notify('Exame excluído.');
    })
    .catch(function (err) {
      console.error('Falha ao excluir documento do paciente', err);
      notifyError('Não foi possível excluir. Tente de novo.');
    })
    .finally(function () {
      state.deletingPatientDocumentId = null;
    });
}

function renderPatientWeights(weights) {
  if (weights == null) {
    els.patientWeightsList.innerHTML = errorStateHTML('Não foi possível carregar o peso.', 'patient');
    els.patientWeightChartWrap.innerHTML = '';
    return;
  }
  els.patientWeightChartWrap.innerHTML = buildWeightChartHTML(weights, null);
  els.patientWeightsNote.textContent = weights.length + (weights.length === 1 ? ' registro' : ' registros');
  if (weights.length === 0) { els.patientWeightsList.innerHTML = '<p class="empty-state">Nenhum peso registrado.</p>'; return; }
  els.patientWeightsList.innerHTML = weights.map(function (w, i) {
    var d = weightDeltaLabel(w, weights[i + 1]);
    return '<div class="record-row">' +
      '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
      '<span class="weight-value">' + fmtWeight(w.weight_kg) + ' kg</span>' +
      '<span class="weight-delta ' + d.trendClass + '">' + d.label + '</span>' +
      '</div>';
  }).join('');
}

// Somente leitura — o médico acompanha a galeria, mas não exclui fotos.
function renderPatientPhotos(photos) {
  if (photos == null) { els.patientPhotosGallery.innerHTML = errorStateHTML('Não foi possível carregar as fotos.', 'patient'); return; }
  els.patientPhotosNote.textContent = photos.length + (photos.length === 1 ? ' foto' : ' fotos');
  if (photos.length === 0) { els.patientPhotosGallery.innerHTML = '<p class="empty-state">Nenhuma foto enviada.</p>'; return; }
  els.patientPhotosGallery.innerHTML = photos.map(function (p) {
    return '<div class="photo-tile">' +
      '<button type="button" class="photo-thumb-wrap" aria-label="Abrir foto de ' + fmtDayLabel(p.taken_at) + '"><img class="photo-thumb" data-path="' + esc(p.file_path) + '" alt="Foto de ' + fmtDayLabel(p.taken_at) + '" /></button>' +
      '<div class="photo-tile-foot"><span class="photo-date">' + fmtDayLabel(p.taken_at) + '</span></div>' +
      '</div>';
  }).join('');

  var paths = photos.map(function (p) { return p.file_path; });
  progressPhotoSignedUrls(paths)
    .then(function (map) {
      els.patientPhotosGallery.querySelectorAll('.photo-thumb').forEach(function (img) {
        var url = map[img.dataset.path];
        if (url) img.src = url;
      });
    })
    .catch(function (err) { console.error('Falha ao gerar URLs das fotos do paciente', err); });
}

els.patientPhotosGallery.addEventListener('click', function (e) {
  var open = e.target.closest('.photo-thumb-wrap');
  if (!open) return;
  var img = open.querySelector('img');
  if (img && img.src) window.open(img.src, '_blank', 'noopener');
});

function renderPatientWorkouts(workouts, sets) {
  if (workouts == null) { els.patientWorkoutsList.innerHTML = errorStateHTML('Não foi possível carregar os treinos.', 'patient'); return; }
  els.patientWorkoutsNote.textContent = workouts.length + (workouts.length === 1 ? ' treino' : ' treinos');
  if (workouts.length === 0) { els.patientWorkoutsList.innerHTML = '<p class="empty-state">Nenhum treino registrado.</p>'; return; }
  els.patientWorkoutsList.innerHTML = workouts.map(function (w) {
    var exercisesSummary = fmtExercisesSummary(sets && sets[w.id]);
    return '<div class="record-row">' +
      '<span class="record-day">' + fmtDayLabel(w.date) + '</span>' +
      '<span class="record-mid"><span class="record-type">' + esc(w.type) + '</span>' +
      '<span class="record-local">' + esc(w.local || 'Sem local') + '</span>' +
      (exercisesSummary ? '<span class="record-exercises">' + esc(exercisesSummary) + '</span>' : '') +
      '</span>' +
      '<span class="record-dur">' + fmtDuration(w.minutes) + '</span>' +
      '</div>';
  }).join('');
}

// ── cache offline + carregamento dos dados do próprio usuário ──
// Mostra o cache local na hora (se houver) enquanto a rede responde. Se a
// rede falhar e havia cache, mantém os dados antigos na tela com o aviso
// de "offline" — só aciona onLoadError quando não havia nada em cache.
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
    applyRows(cached, true);
    renderExtra();
  }

  return fetchPromise
    .then(function (rows) {
      delete offlineResources[cacheKey];
      recomputeOfflineMode();
      applyRows(rows, false);
      cacheSet(userId, cacheKey, rows);
      return { fromNetwork: true, rows: rows };
    })
    .catch(function (err) {
      console.error('Falha ao carregar ' + cacheKey, err);
      if (cached != null) {
        offlineResources[cacheKey] = true;
        recomputeOfflineMode();
      } else if (opts.onLoadError) {
        opts.onLoadError();
      }
      return { fromNetwork: false, rows: null };
    })
    .finally(renderExtra);
}

function startOwnData() {
  els.inputDate.max = todayISO();
  els.inputWeightDate.max = todayISO();
  els.inputMeasurementDate.max = todayISO();
  // Cronômetro que ficou rodando (app fechado no meio do treino): já abre
  // no modo cronômetro, e o Painel mostra o aviso "Treino em andamento".
  if (timerActive()) state.mode = 'timer';
  startTimerLoop();
  renderRegistrar();
  renderActiveTab();
  loadOwnData();
}

function loadOwnData() {
  var userId = currentUserId();
  state.loading = !state.workouts.length;
  state.loadError = false;
  if (state.weightsLoadError) { state.weightsLoading = true; state.weightsLoadError = false; }
  if (state.measurementsLoadError) { state.measurementsLoading = true; state.measurementsLoadError = false; }
  if (state.photosLoadError) { state.photosLoading = true; state.photosLoadError = false; }

  var pWorkouts = loadWithCache(userId, 'workouts', fetchWorkouts(userId),
    function (rows) { state.workouts = rows; state.loading = false; },
    { onLoadError: function () { state.loading = false; state.loadError = true; }, afterRender: updateLocalSuggestions });

  loadWithCache(userId, 'workoutSets', fetchWorkoutSets(userId),
    function (byWorkout) { state.workoutSets = byWorkout; });

  var pSettings = loadWithCache(userId, 'settings', fetchSettings(userId),
    function (row) {
      state.monthlyGoal = row ? row.monthly_goal : DEFAULT_MONTHLY_GOAL;
      state.targetWeight = row ? row.target_weight_kg : null;
      state.weeklySummaryEmail = !!(row && row.weekly_summary_email);
    });

  var pWeights = loadWithCache(userId, 'weights', fetchWeights(userId),
    function (rows) { state.weights = rows; state.weightsLoading = false; },
    { onLoadError: function () { state.weightsLoading = false; state.weightsLoadError = true; } });

  loadWithCache(userId, 'measurements', fetchBodyMeasurements(userId),
    function (rows) { state.measurements = rows; state.measurementsLoading = false; },
    { onLoadError: function () { state.measurementsLoading = false; state.measurementsLoadError = true; } });

  loadDocuments();

  fetchProgressPhotos(userId)
    .then(function (rows) {
      state.photos = rows;
      state.photosLoading = false;
    })
    .catch(function (err) {
      console.error('Falha ao carregar fotos de progresso', err);
      state.photosLoading = false;
      state.photosLoadError = true;
    })
    .finally(renderActiveTab);

  // Conta nova (sem nenhuma modalidade ainda) recebe as 3 clássicas de
  // largada. Só roda de fato quando a rede responde vazio, nunca do cache.
  var pTypes = loadWithCache(userId, 'workoutTypes',
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

  // Primeiro acesso de verdade (nunca salvou configurações, nenhum treino e
  // nenhum peso, confirmado pela rede): onboarding de 3 passos.
  Promise.all([pSettings, pWorkouts, pWeights, pTypes]).then(function (r) {
    var settingsRes = r[0], workoutsRes = r[1], weightsRes = r[2];
    if (!settingsRes.fromNetwork || !workoutsRes.fromNetwork || !weightsRes.fromNetwork) return;
    if (settingsRes.rows == null && state.workouts.length === 0 && state.weights.length === 0 && !prefGet('onboarded')) {
      openOnboarding();
    }
  });
}
RETRY_HANDLERS.own = loadOwnData;

// ── onboarding (primeiro acesso) ──
var onboarding = { step: 1, goal: DEFAULT_MONTHLY_GOAL, keepTypes: {}, dialog: null };

function openOnboarding() {
  onboarding.step = 1;
  onboarding.goal = DEFAULT_MONTHLY_GOAL;
  onboarding.keepTypes = {};
  state.workoutTypes.forEach(function (t) { onboarding.keepTypes[t.id] = true; });
  renderOnboarding();
  onboarding.dialog = openDialog(els.onboarding, { persistent: true, onClose: function (reason) { if (reason === 'escape') finishOnboarding(true); } });
}

function renderOnboarding() {
  els.onboarding.querySelectorAll('.ob-step').forEach(function (s) { s.hidden = Number(s.dataset.step) !== onboarding.step; });
  els.onboarding.querySelectorAll('.ob-dot').forEach(function (d) { d.classList.toggle('active', Number(d.dataset.dot) <= onboarding.step); });
  els.obGoalOptions.querySelectorAll('.ob-chip').forEach(function (c) {
    var active = Number(c.dataset.goal) === onboarding.goal;
    c.classList.toggle('active', active);
    c.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  els.obTypes.innerHTML = state.workoutTypes.map(function (t) {
    var on = !!onboarding.keepTypes[t.id];
    return '<button type="button" class="ob-chip' + (on ? ' active' : '') + '" aria-pressed="' + on + '" data-type-id="' + t.id + '">' + esc(t.name) + '</button>';
  }).join('');
  els.obNext.textContent = onboarding.step === 3 ? 'Começar' : 'Continuar';
}

els.obGoalOptions.addEventListener('click', function (e) {
  var c = e.target.closest('[data-goal]');
  if (!c) return;
  onboarding.goal = Number(c.dataset.goal);
  renderOnboarding();
});
els.obTypes.addEventListener('click', function (e) {
  var c = e.target.closest('[data-type-id]');
  if (!c) return;
  var id = Number(c.dataset.typeId);
  onboarding.keepTypes[id] = !onboarding.keepTypes[id];
  renderOnboarding();
});

els.obSkip.addEventListener('click', function () { finishOnboarding(true); });
els.obNext.addEventListener('click', function () {
  if (onboarding.step < 3) { onboarding.step += 1; renderOnboarding(); return; }
  finishOnboarding(false);
});

async function finishOnboarding(skipped) {
  var weight = skipped ? null : parseDecimal(els.obWeight.value);
  if (!skipped && weight != null && (isNaN(weight) || weight <= 0 || weight >= 500)) {
    setFieldError(els.obWeight, 'Informe um peso entre 0 e 500 kg, ou deixe em branco.');
    return;
  }
  prefSet('onboarded', true);
  if (onboarding.dialog) { var d = onboarding.dialog; onboarding.dialog = null; d.close('done'); }

  try {
    // Gravar as configurações marca a conta como "já passou pelo onboarding"
    // (a condição de abertura é não ter linha em pandafit_settings).
    await upsertSettings({ monthly_goal: skipped ? DEFAULT_MONTHLY_GOAL : onboarding.goal });
    state.monthlyGoal = skipped ? DEFAULT_MONTHLY_GOAL : onboarding.goal;
    if (skipped) { renderActiveTab(); return; }

    var removeIds = state.workoutTypes.filter(function (t) { return !onboarding.keepTypes[t.id]; }).map(function (t) { return t.id; });
    for (var i = 0; i < removeIds.length; i++) await deleteWorkoutType(removeIds[i]);
    state.workoutTypes = state.workoutTypes.filter(function (t) { return onboarding.keepTypes[t.id]; });
    var extra = els.obTypeExtra.value.trim();
    if (extra && !state.workoutTypes.some(function (t) { return t.name.toLowerCase() === extra.toLowerCase(); })) {
      state.workoutTypes.push(await insertWorkoutType(extra, ''));
    }
    state.type = state.workoutTypes.length ? state.workoutTypes[0].name : '';
    cacheSet(currentUserId(), 'workoutTypes', state.workoutTypes);

    if (weight) {
      var row = await upsertWeight({ date: todayISO(), weight_kg: weight });
      state.weights = [row];
      cacheSet(currentUserId(), 'weights', state.weights);
    }
    renderRegistrar();
    renderActiveTab();
    notifySuccess('Tudo pronto! Agora é só registrar o primeiro treino.');
  } catch (err) {
    console.error('Falha ao concluir onboarding', err);
    notifyError('Não foi possível salvar tudo. Ajuste em Configurações quando quiser.');
  }
}

// ── boot: sessão existente, login ou recuperação de senha ──
supabase.auth.getSession().then(function (res) {
  if (res.data.session) {
    handleSignedIn(res.data.session);
  } else {
    showLoginScreen();
  }
});

supabase.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT') {
    appStarted = false;
    resetAppState();
    showLoginScreen();
  }
  // Mantém o token atualizado pras chamadas às edge functions (que usam
  // state.session.access_token direto, fora do cliente supabase-js).
  if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && session && state.session) {
    state.session = session;
  }
  if (event === 'PASSWORD_RECOVERY' && session) {
    state.session = session;
    showNewPasswordScreen('recovery');
  }
});

// ── PWA: service worker (app-shell cache para offline/instalação) ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      console.error('Falha ao registrar service worker', err);
    });
  });
}
