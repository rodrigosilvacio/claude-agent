// ERPConnect — Administração > Demo: quem se cadastrou na página pública de
// captura de leads (appvendas/demo.html) e ganhou acesso automático ao ERP.
// Somente leitura + as mesmas ações de conta que já existem em Usuários
// (redefinir senha / excluir) — gerenciar papel/empresa continua em
// Usuários, já que essas contas são usuários "caixa" como qualquer outro.

import { supabase } from "./supabaseClient.js";
import { callManageUsuarios } from "./auth.js";
import { showToast, openModal, closeModal, confirmDialog, escapeHtml, skeletonTable, registerAutoRefresh, friendlyPgError, formatDateTime, exportCsv } from "./app.js";

const SEARCH_ICON = '<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

let ultimosLeads = [];

export async function render(view, actionsEl) {
  actionsEl.innerHTML = `<button type="button" class="btn btn--ghost" id="btn-exportar-csv">Exportar CSV</button>`;
  actionsEl.querySelector("#btn-exportar-csv").addEventListener("click", () => {
    if (ultimosLeads.length === 0) return;
    exportCsv(
      `leads-demo-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Nome", "E-mail", "Telefone", "Cargo", "Empresa do lead", "Usuário no ERP", "Conta ativa", "Cadastrado em"],
      ultimosLeads.map((l) => [
        l.nome, l.email, l.telefone || "", l.cargo || "", l.empresa_lead || "",
        l.usuario?.login || "", l.usuario?.ativo ? "Sim" : "Não", formatDateTime(l.created_at),
      ]),
    );
  });

  view.innerHTML = `
    <div class="toolbar">
      <div class="search-input-wrap">
        ${SEARCH_ICON}
        <input type="search" class="input" id="search-input" placeholder="Buscar por nome, e-mail ou empresa…" />
      </div>
      <p class="record-count" id="record-count"></p>
    </div>
    ${skeletonTable()}
  `;

  const searchInput = view.querySelector("#search-input");
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadRows(view, searchInput.value.trim()), 250);
  });

  await loadRows(view, "");
  registerAutoRefresh(() => loadRows(view, searchInput.value.trim()), 15000);
}

function normalize(str) {
  return String(str ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function loadRows(view, term) {
  const countEl = view.querySelector("#record-count");
  const existingCard = view.querySelector(".card");

  if (!existingCard) {
    view.insertAdjacentHTML("beforeend", skeletonTable());
    if (countEl) countEl.textContent = "";
  }

  const { data, error } = await supabase
    .from("leads_demo")
    .select("id, nome, email, telefone, cargo, empresa_lead, created_at, usuario:usuarios(id, login, ativo)")
    .order("created_at", { ascending: false });

  const card = view.querySelector(".card");

  if (error) {
    card.innerHTML = `<div class="empty-state"><p class="empty-state__title">Erro ao carregar</p><p class="empty-state__hint">${escapeHtml(friendlyPgError(error))}</p></div>`;
    return;
  }

  const normalizedTerm = normalize(term);
  const filtered = normalizedTerm
    ? (data || []).filter((l) => normalize(l.nome).includes(normalizedTerm) || normalize(l.email).includes(normalizedTerm) || normalize(l.empresa_lead).includes(normalizedTerm))
    : (data || []);

  ultimosLeads = filtered;

  if (filtered.length === 0) {
    card.innerHTML = `<div class="empty-state"><p class="empty-state__title">Nenhum lead ainda</p><p class="empty-state__hint">Assim que alguém se cadastrar em demo.html, aparece aqui.</p></div>`;
    return;
  }

  if (countEl) countEl.textContent = `${filtered.length} lead${filtered.length === 1 ? "" : "s"}`;

  renderTable(view, card, filtered);
}

function renderTable(view, card, data) {
  const rows = data.map((l) => {
    const conta = l.usuario;
    return `
    <tr>
      <td class="cell-rail" style="--rail-color: var(${conta?.ativo ? "--success" : "--text-muted"})">${escapeHtml(l.nome)}</td>
      <td>${escapeHtml(l.email)}</td>
      <td>${escapeHtml(l.telefone || "—")}</td>
      <td>${escapeHtml(l.cargo || "—")}</td>
      <td>${escapeHtml(l.empresa_lead || "—")}</td>
      <td>${escapeHtml(conta?.login || "—")}</td>
      <td><span class="status status--${conta?.ativo ? "ativo" : "inativo"}">${conta?.ativo ? "Ativa" : "Inativa"}</span></td>
      <td class="cell-muted">${formatDateTime(l.created_at)}</td>
      <td class="cell-actions">
        ${conta ? `<button type="button" class="btn btn--ghost btn--sm" data-reset="${conta.id}">Redefinir senha</button>` : ""}
        ${conta ? `<button type="button" class="btn btn--danger btn--sm" data-delete="${conta.id}" data-nome="${escapeHtml(l.nome)}">Excluir</button>` : ""}
      </td>
    </tr>
  `;
  }).join("");

  card.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Cargo</th><th>Empresa</th><th>Usuário</th><th>Conta</th><th>Cadastrado em</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  card.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => openResetForm(btn.dataset.reset));
  });

  card.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog(`Excluir o acesso de "${btn.dataset.nome}"? Esta ação não pode ser desfeita.`, { confirmLabel: "Excluir" });
      if (!ok) return;
      try {
        await callManageUsuarios("delete", { id: btn.dataset.delete });
        showToast("Acesso excluído.");
        loadRows(view, view.querySelector("#search-input").value.trim());
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

function openResetForm(id) {
  const body = openModal("Redefinir senha");
  body.innerHTML = `
    <form id="reset-form">
      <div id="form-error"></div>
      <div class="field field--full">
        <label for="f-nova-senha">Nova senha<span class="field-required">*</span></label>
        <input class="input" type="password" id="f-nova-senha" minlength="6" required />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="btn-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">Redefinir</button>
      </div>
    </form>
  `;

  body.querySelector("#btn-cancel").addEventListener("click", closeModal);

  body.querySelector("#reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = body.querySelector("#form-error");
    errorEl.innerHTML = "";
    const senha = body.querySelector("#f-nova-senha").value;

    try {
      await callManageUsuarios("reset_password", { id, senha });
      showToast("Senha redefinida.");
      closeModal();
    } catch (err) {
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
    }
  });
}
