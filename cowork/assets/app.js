// Cowork — bootstrap e orquestração da UI (estado da app, render, eventos).
import { requireSession, signOut } from "./auth.js";
import * as Projects from "./projects.js";
import * as Docs from "./generate.js";
import { extractReferenceFile, UnsupportedFileError } from "./fileExtract.js";

const DOC_TYPE_LABELS = {
  spreadsheet: "Planilha",
  document: "Documento",
  presentation: "Apresentação",
};

const state = {
  user: null,
  projects: [],
  activeProjectId: null,
  referenceFiles: [],
  documents: [],
  selectedDocType: "spreadsheet",
};

const els = {
  projectList: document.getElementById("project-list"),
  newProjectBtn: document.getElementById("new-project-btn"),
  emptyNewProjectBtn: document.getElementById("empty-new-project-btn"),
  emptyState: document.getElementById("empty-state"),
  projectView: document.getElementById("project-view"),
  projectNameInput: document.getElementById("project-name-input"),
  deleteProjectBtn: document.getElementById("delete-project-btn"),
  instructionsTextarea: document.getElementById("instructions-textarea"),
  saveInstructionsBtn: document.getElementById("save-instructions-btn"),
  instructionsSavedMsg: document.getElementById("instructions-saved-msg"),
  referenceList: document.getElementById("reference-list"),
  referenceCount: document.getElementById("reference-count"),
  referenceInput: document.getElementById("reference-input"),
  doctypeRow: document.getElementById("doctype-row"),
  promptInput: document.getElementById("prompt-input"),
  composerHint: document.getElementById("composer-hint"),
  generateBtn: document.getElementById("generate-btn"),
  documentsFeed: document.getElementById("documents-feed"),
  docCardTemplate: document.getElementById("doc-card-template"),
  userEmail: document.getElementById("user-email"),
  logoutBtn: document.getElementById("logout-btn"),
  toast: document.getElementById("toast"),
};

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

let toastTimer = null;
function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.className = isError ? "toast error" : "toast";
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4000);
}

// ---- Projetos ----

function renderProjectList() {
  els.projectList.innerHTML = "";
  for (const project of state.projects) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab" + (project.id === state.activeProjectId ? " active" : "");
    btn.textContent = project.name || "Sem nome";
    btn.addEventListener("click", () => selectProject(project.id));
    els.projectList.appendChild(btn);
  }
}

async function selectProject(id) {
  state.activeProjectId = id;
  renderProjectList();
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;

  els.emptyState.hidden = true;
  els.projectView.hidden = false;
  els.projectNameInput.value = project.name;
  els.instructionsTextarea.value = project.instructions || "";
  els.instructionsSavedMsg.textContent = "";
  els.promptInput.value = "";
  setDocType("spreadsheet");

  await Promise.all([refreshReferenceFiles(), refreshDocuments()]);
}

async function refreshReferenceFiles() {
  state.referenceFiles = await Projects.listReferenceFiles(state.activeProjectId);
  renderReferenceFiles();
}

function renderReferenceFiles() {
  els.referenceCount.textContent = String(state.referenceFiles.length);
  els.referenceList.innerHTML = "";
  for (const file of state.referenceFiles) {
    const chip = document.createElement("span");
    chip.className = "reference-chip";
    chip.innerHTML = `<span title="${escapeHtml(file.file_name)}">${escapeHtml(file.file_name)} · ${formatSize(file.file_size)}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remover ${file.file_name}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      try {
        await Projects.deleteReferenceFile(file);
        await refreshReferenceFiles();
      } catch (err) {
        showToast(err.message, true);
      }
    });
    chip.appendChild(removeBtn);
    els.referenceList.appendChild(chip);
  }
}

async function refreshDocuments() {
  state.documents = await Docs.listDocuments(state.activeProjectId);
  renderDocuments();
}

// ---- Composer ----

function setDocType(docType) {
  state.selectedDocType = docType;
  for (const btn of els.doctypeRow.querySelectorAll(".doctype-btn")) {
    btn.classList.toggle("active", btn.dataset.doctype === docType);
  }
}

els.doctypeRow.addEventListener("click", (e) => {
  const btn = e.target.closest(".doctype-btn");
  if (btn) setDocType(btn.dataset.doctype);
});

els.generateBtn.addEventListener("click", async () => {
  const prompt = els.promptInput.value.trim();
  if (!prompt) {
    showToast("Descreva o que você precisa antes de gerar.", true);
    return;
  }

  const project = state.projects.find((p) => p.id === state.activeProjectId);
  els.generateBtn.disabled = true;
  els.composerHint.textContent = "Gerando com a Claude…";

  // Placeholder otimista na tela enquanto a geração roda.
  renderDocuments({ generatingLabel: "Gerando…" });

  try {
    await Docs.generateDocument({
      ownerId: state.user.id,
      projectId: state.activeProjectId,
      docType: state.selectedDocType,
      prompt,
      instructions: project?.instructions || "",
      referenceFiles: state.referenceFiles,
    });
    els.promptInput.value = "";
    showToast("Documento gerado.");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    els.generateBtn.disabled = false;
    els.composerHint.textContent = "";
    await refreshDocuments();
  }
});

// ---- Feed de documentos ----

function renderDocuments({ generatingLabel } = {}) {
  els.documentsFeed.innerHTML = "";

  if (generatingLabel && !state.documents.some((d) => d.status === "generating")) {
    els.documentsFeed.appendChild(buildGeneratingCard(generatingLabel));
  }

  if (state.documents.length === 0 && !generatingLabel) {
    const empty = document.createElement("p");
    empty.className = "feed-empty";
    empty.textContent = "Nenhum documento gerado neste projeto ainda.";
    els.documentsFeed.appendChild(empty);
    return;
  }

  for (const doc of state.documents) {
    els.documentsFeed.appendChild(buildDocCard(doc));
  }
}

function buildGeneratingCard(label) {
  const node = els.docCardTemplate.content.cloneNode(true);
  const card = node.querySelector(".doc-card");
  card.dataset.doctype = state.selectedDocType;
  node.querySelector(".doc-card-title").textContent = label;
  node.querySelector(".doc-card-prompt").remove();
  const meta = node.querySelector(".doc-card-meta");
  meta.innerHTML = "";
  const body = node.querySelector(".doc-card-body");
  body.innerHTML = `<div class="doc-card-status"><span class="spinner"></span> Gerando com a Claude…</div>`;
  return node;
}

function buildDocCard(doc) {
  const node = els.docCardTemplate.content.cloneNode(true);
  const card = node.querySelector(".doc-card");
  card.dataset.doctype = doc.doc_type;
  node.querySelector(".doc-card-title").textContent = doc.title;
  node.querySelector(".doc-card-prompt").textContent = doc.prompt;

  const typeLabel = node.querySelector(".doc-type-label");
  typeLabel.textContent = DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type;
  node.querySelector("time").textContent = formatDate(doc.created_at);

  const body = node.querySelector(".doc-card-body");

  if (doc.status === "generating") {
    body.innerHTML = `<div class="doc-card-status"><span class="spinner"></span> Gerando com a Claude…</div>`;
    return node;
  }

  if (doc.status === "error") {
    const errorBox = document.createElement("div");
    errorBox.className = "doc-card-error";
    errorBox.textContent = doc.error_message || "Não consegui gerar o documento. Tente novamente.";
    body.appendChild(errorBox);

    const actions = document.createElement("div");
    actions.className = "doc-card-actions";
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn btn-sm btn-primary";
    retryBtn.textContent = "Tentar novamente";
    retryBtn.addEventListener("click", () => retryDocument(doc, retryBtn));
    actions.appendChild(retryBtn);
    body.appendChild(actions);
    return node;
  }

  const actions = document.createElement("div");
  actions.className = "doc-card-actions";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "btn btn-sm btn-primary";
  downloadBtn.textContent = "Baixar";
  downloadBtn.addEventListener("click", () => downloadDocument(doc));
  actions.appendChild(downloadBtn);

  const adjustBtn = document.createElement("button");
  adjustBtn.type = "button";
  adjustBtn.className = "btn btn-sm btn-ghost";
  adjustBtn.textContent = "Pedir ajuste";
  actions.appendChild(adjustBtn);

  body.appendChild(actions);

  const feedbackBox = document.createElement("div");
  feedbackBox.className = "feedback-box";
  feedbackBox.hidden = true;
  feedbackBox.innerHTML = `
    <textarea placeholder="O que você quer ajustar nesse documento?"></textarea>
    <button type="button" class="btn btn-sm btn-primary">Gerar ajuste</button>
  `;
  body.appendChild(feedbackBox);

  adjustBtn.addEventListener("click", () => {
    feedbackBox.hidden = !feedbackBox.hidden;
    if (!feedbackBox.hidden) feedbackBox.querySelector("textarea").focus();
  });

  feedbackBox.querySelector("button").addEventListener("click", () => submitFeedback(doc, feedbackBox));

  return node;
}

async function downloadDocument(doc) {
  try {
    const url = await Docs.getDownloadUrl(doc.file_path);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function retryDocument(doc, button) {
  if (button) button.disabled = true;
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  try {
    await Docs.generateDocument({
      ownerId: state.user.id,
      projectId: state.activeProjectId,
      docType: doc.doc_type,
      prompt: doc.prompt,
      instructions: project?.instructions || "",
      referenceFiles: state.referenceFiles,
    });
    showToast("Documento gerado.");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    await refreshDocuments();
  }
}

async function submitFeedback(doc, feedbackBox) {
  const textarea = feedbackBox.querySelector("textarea");
  const feedback = textarea.value.trim();
  if (!feedback) {
    showToast("Descreva o ajuste que você quer.", true);
    return;
  }
  const button = feedbackBox.querySelector("button");
  button.disabled = true;

  const project = state.projects.find((p) => p.id === state.activeProjectId);
  try {
    await Docs.regenerateWithFeedback({
      ownerId: state.user.id,
      projectId: state.activeProjectId,
      docType: doc.doc_type,
      prompt: doc.prompt,
      instructions: project?.instructions || "",
      referenceFiles: state.referenceFiles,
      feedback,
      previousSpec: doc.spec,
    });
    showToast("Ajuste gerado.");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    button.disabled = false;
    await refreshDocuments();
  }
}

// ---- Ações de projeto ----

async function handleCreateProject() {
  const name = window.prompt("Nome do projeto:", "");
  if (!name || !name.trim()) return;
  try {
    const project = await Projects.createProject(state.user.id, name.trim());
    state.projects.push(project);
    renderProjectList();
    await selectProject(project.id);
  } catch (err) {
    showToast(err.message, true);
  }
}

els.newProjectBtn.addEventListener("click", handleCreateProject);
els.emptyNewProjectBtn.addEventListener("click", handleCreateProject);

els.projectNameInput.addEventListener("change", async () => {
  const name = els.projectNameInput.value.trim() || "Sem nome";
  els.projectNameInput.value = name;
  try {
    await Projects.renameProject(state.activeProjectId, name);
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (project) project.name = name;
    renderProjectList();
  } catch (err) {
    showToast(err.message, true);
  }
});

els.saveInstructionsBtn.addEventListener("click", async () => {
  try {
    const instructions = els.instructionsTextarea.value;
    await Projects.updateInstructions(state.activeProjectId, instructions);
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (project) project.instructions = instructions;
    els.instructionsSavedMsg.textContent = "Salvo.";
    setTimeout(() => (els.instructionsSavedMsg.textContent = ""), 2500);
  } catch (err) {
    showToast(err.message, true);
  }
});

els.deleteProjectBtn.addEventListener("click", async () => {
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  if (!project) return;
  if (!window.confirm(`Excluir o projeto "${project.name}" e todos os seus documentos? Essa ação não pode ser desfeita.`)) {
    return;
  }
  try {
    await Projects.deleteProject(project.id);
    state.projects = state.projects.filter((p) => p.id !== project.id);
    state.activeProjectId = null;
    renderProjectList();
    if (state.projects.length > 0) {
      await selectProject(state.projects[0].id);
    } else {
      els.projectView.hidden = true;
      els.emptyState.hidden = false;
    }
  } catch (err) {
    showToast(err.message, true);
  }
});

els.referenceInput.addEventListener("change", async () => {
  const files = Array.from(els.referenceInput.files || []);
  els.referenceInput.value = "";
  for (const file of files) {
    try {
      const extraction = await extractReferenceFile(file);
      await Projects.uploadReferenceFile(state.user.id, state.activeProjectId, file, extraction);
    } catch (err) {
      if (err instanceof UnsupportedFileError) {
        showToast(err.message, true);
      } else {
        showToast(`Falha ao anexar "${file.name}": ${err.message}`, true);
      }
    }
  }
  await refreshReferenceFiles();
});

els.logoutBtn.addEventListener("click", signOut);

// ---- Bootstrap ----

async function init() {
  const session = await requireSession();
  state.user = session.user;
  els.userEmail.textContent = state.user.email;

  state.projects = await Projects.listProjects();
  renderProjectList();

  if (state.projects.length > 0) {
    await selectProject(state.projects[0].id);
  } else {
    els.emptyState.hidden = false;
    els.projectView.hidden = true;
  }
}

init().catch((err) => {
  console.error(err);
  showToast("Falha ao carregar o Cowork. Recarregue a página.", true);
});
