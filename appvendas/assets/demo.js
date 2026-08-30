// Página pública de captura de leads para teste do ERPConnect — sem login,
// sem app-shell, roda isolada de app.js/auth.js de propósito (mesmo motivo
// de pre-cadastro.js: é aberta por gente que não é da equipe). Quem
// preenche o formulário recebe na hora um acesso real ao sistema (papel
// "caixa", nunca administrador — decidido na edge function, não aqui).

import { supabase } from "./supabaseClient.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

const form = document.getElementById("demo-form");
const errorEl = document.getElementById("demo-error");
const submitBtn = document.getElementById("demo-submit");
const successEl = document.getElementById("demo-success");

// Mesma mitigação de spam de pre-cadastro.js: campo-armadilha + tempo
// mínimo entre a página carregar e o formulário ser enviado. A edge
// function repete essa checagem do lado do servidor (ver criar-acesso-demo)
// — aqui é só a primeira linha de defesa, evitando a chamada de rede.
const formLoadedAt = Date.now();
const MIN_SUBMIT_MS = 2500;

function pareceBot() {
  return Boolean(form.elements.website.value) || Date.now() - formLoadedAt < MIN_SUBMIT_MS;
}

function urlDoErp() {
  return new URL("./index.html", window.location.href).toString();
}

async function copiar(texto, btn) {
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(texto);
    btn.textContent = "Copiado!";
  } catch {
    btn.textContent = "Não foi possível copiar";
  }
  setTimeout(() => { btn.textContent = original; }, 1800);
}

// `senha` só vem preenchida em cadastro novo (a criar-acesso-demo devolve
// direto). Num e-mail que já tinha conta, a senha é redefinida mas enviada
// só para aquele e-mail (`sentToEmail`) — nunca volta na resposta HTTP,
// senão bastaria saber o e-mail de um lead anterior pra sequestrar a conta.
function mostrarSucesso({ nome, login, senha, sentToEmail }) {
  form.hidden = true;
  successEl.hidden = false;
  const url = urlDoErp();

  if (sentToEmail) {
    successEl.innerHTML = `
      <div class="precadastro-success">
        <div class="precadastro-success__icon">
          <svg aria-hidden="true" focusable="false" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <p class="precadastro-success__title">Prontinho, ${escapeHtml(nome)}! Você já tinha um acesso de demonstração.</p>
        <p class="precadastro-success__hint">Redefinimos sua senha e enviamos os dados de acesso para <strong>${escapeHtml(sentToEmail)}</strong>. Confira sua caixa de entrada (e o spam) para continuar.</p>
      </div>
    `;
    return;
  }

  successEl.innerHTML = `
    <div class="precadastro-success">
      <div class="precadastro-success__icon">
        <svg aria-hidden="true" focusable="false" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <p class="precadastro-success__title">Parabéns, ${escapeHtml(nome)}! Você já tem acesso ao ERPConnect.</p>
      <p class="precadastro-success__hint">Use os dados abaixo para entrar. É um ambiente de demonstração compartilhado, com dados de exemplo — fique à vontade para explorar o sistema.</p>

      <div class="precadastro-credentials">
        <div class="precadastro-credentials__row">
          <span class="precadastro-credentials__label">Endereço</span>
          <a class="precadastro-credentials__value" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>
          <button type="button" class="btn btn--ghost btn--sm" data-copy="${escapeHtml(url)}">Copiar</button>
        </div>
        <div class="precadastro-credentials__row">
          <span class="precadastro-credentials__label">Usuário</span>
          <span class="precadastro-credentials__value precadastro-credentials__value--mono">${escapeHtml(login)}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-copy="${escapeHtml(login)}">Copiar</button>
        </div>
        <div class="precadastro-credentials__row">
          <span class="precadastro-credentials__label">Senha</span>
          <span class="precadastro-credentials__value precadastro-credentials__value--mono">${escapeHtml(senha)}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-copy="${escapeHtml(senha)}">Copiar</button>
        </div>
      </div>

      <a class="btn btn--primary" href="${escapeHtml(url)}" target="_blank" rel="noopener" style="width:100%; justify-content:center; margin-top: 1.25rem;">Acessar o ERPConnect agora</a>
    </div>
  `;

  successEl.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copiar(btn.dataset.copy, btn));
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.innerHTML = "";

  const nome = form.elements.nome.value.trim();

  if (pareceBot()) {
    mostrarSucesso({ nome: nome || "demo", login: "demo", senha: "••••••••" });
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Criando seu acesso…";

  const payload = {
    nome,
    email: form.elements.email.value.trim(),
    telefone: form.elements.telefone.value.trim() || null,
    cargo: form.elements.cargo.value.trim() || null,
    empresa: form.elements.empresa.value.trim() || null,
    website: form.elements.website.value,
    loaded_at: formLoadedAt,
  };

  const { data, error } = await supabase.functions.invoke("criar-acesso-demo", { body: payload });

  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch {
      // resposta não era JSON — mantém a mensagem original do erro de rede
    }
    errorEl.innerHTML = `<div class="form-error">${escapeHtml(message)}</div>`;
    submitBtn.disabled = false;
    submitBtn.textContent = "Quero testar grátis";
    return;
  }

  if (data?.error) {
    errorEl.innerHTML = `<div class="form-error">${escapeHtml(data.error)}</div>`;
    submitBtn.disabled = false;
    submitBtn.textContent = "Quero testar grátis";
    return;
  }

  mostrarSucesso(data);
});
