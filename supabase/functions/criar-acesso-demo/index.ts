// Versão exata pinada, mesmo motivo do manage-usuarios: uma release nova do
// supabase-js não deve entrar em produção sem passar por commit e revisão.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

// ERPConnect — captura de leads da página pública de demonstração
// (appvendas/demo.html). Quem preenche o formulário ali ganha na hora um
// usuário real do ERP para testar o sistema.
//
// Regras de segurança que NÃO podem ser afrouxadas nesta função:
//   1. role é SEMPRE 'caixa' — nunca lido do corpo da requisição, nunca
//      vira admin. É a exigência explícita do dono do produto.
//   2. empresa_id é SEMPRE a Empresa Matriz de demonstração abaixo — nunca
//      lido do corpo da requisição, para não deixar alguém plantar contas
//      dentro de uma empresa real de cliente.
// `verify_jwt` fica desligado no deploy porque é uma rota pública: quem
// preenche o formulário nunca está logado.
const DEMO_EMPRESA_ID = "de70ccdb-98f1-4901-bb65-445648805ce8"; // Empresa Matriz
const DEMO_ROLE = "caixa";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const DIACRITICS_RE = new RegExp("[̀-ͯ]", "g");

// Mesma normalização de manage-usuarios (não importada de lá de propósito:
// funções edge não compartilham módulo entre si neste projeto).
function sanitizeLogin(raw: string) {
  return String(raw || "")
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "");
}

function baseLoginFromNome(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const escolhidas = partes.length > 1 ? [partes[0], partes[partes.length - 1]] : partes;
  const base = sanitizeLogin(escolhidas.join(" "));
  return base || "lead";
}

const SENHA_ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789"; // sem letras/números ambíguos (i, l, o, 0, 1)

function gerarSenha(tamanho = 10) {
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SENHA_ALFABETO[b % SENHA_ALFABETO.length]).join("");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mesma mitigação de spam de pre-cadastro.js, agora também validada aqui no
// servidor (o front chama esta função direto via fetch/RPC — checar só no
// JS do navegador não impede alguém de pular a UI). `p_loaded_at` é o
// timestamp (ms) de quando o formulário carregou, enviado pelo cliente.
const MIN_SUBMIT_MS = 2500;

function pareceBot(body: Record<string, unknown>) {
  if (String(body.website || "").trim()) return true;
  const loadedAt = Number(body.loaded_at);
  if (!Number.isFinite(loadedAt)) return true;
  return Date.now() - loadedAt < MIN_SUBMIT_MS;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const nome = String(body.nome || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const telefone = String(body.telefone || "").trim() || null;
  const cargo = String(body.cargo || "").trim() || null;
  const empresaLead = String(body.empresa || "").trim() || null;

  // Bot detectado: finge sucesso (mesmo formato de resposta de um cadastro
  // de verdade) em vez de avisar o que foi pego — sem criar nada de fato.
  if (pareceBot(body)) {
    return json({ nome: nome || "demo", login: "demo", senha: gerarSenha() });
  }

  if (nome.length < 2) return json({ error: "Informe seu nome." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Informe um e-mail válido." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Idempotência por e-mail: quem preenche de novo com o mesmo e-mail não
  // ganha uma conta duplicada — recebe a mesma conta de volta, com a senha
  // redefinida na hora (nunca guardamos a senha em texto puro em lugar
  // nenhum, então "reenviar a mesma senha" não é uma opção).
  const { data: leadExistente } = await admin
    .from("leads_demo")
    .select("usuario_id")
    .eq("email", email)
    .maybeSingle();

  if (leadExistente) {
    const { data: usuarioRow, error: usuarioError } = await admin
      .from("usuarios")
      .select("id, nome, login")
      .eq("id", leadExistente.usuario_id)
      .maybeSingle();

    if (usuarioError || !usuarioRow) {
      return json({ error: "Não foi possível localizar seu acesso. Tente novamente em instantes." }, 500);
    }

    const novaSenha = gerarSenha();
    const { error: resetError } = await admin.auth.admin.updateUserById(usuarioRow.id, { password: novaSenha });
    if (resetError) return json({ error: "Não foi possível gerar seu acesso. Tente novamente em instantes." }, 500);

    // Reativa e mantém role/empresa travados nos valores de demonstração,
    // caso a conta tenha sido desativada manualmente por um admin.
    await admin.from("usuarios").update({ ativo: true, role: DEMO_ROLE, empresa_id: DEMO_EMPRESA_ID }).eq("id", usuarioRow.id);
    await admin.from("leads_demo").update({ nome, telefone, cargo, empresa_lead: empresaLead }).eq("usuario_id", usuarioRow.id);

    return json({ nome: usuarioRow.nome, login: usuarioRow.login, senha: novaSenha });
  }

  // Login único: base a partir do nome, com sufixo numérico se já existir.
  const base = baseLoginFromNome(nome);
  let login = base;
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const { data: existente } = await admin.from("usuarios").select("id").eq("login", login).maybeSingle();
    if (!existente) break;
    login = `${base}${Math.floor(100 + Math.random() * 900)}`;
  }

  const senha = gerarSenha();
  const authEmail = `${login}@appvendas.local`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, login, origem: "demo" },
  });

  if (createError || !created.user) {
    return json({ error: "Não foi possível criar seu acesso. Tente novamente em instantes." }, 500);
  }

  const { error: insertUsuarioError } = await admin
    .from("usuarios")
    .insert({ id: created.user.id, nome, login, role: DEMO_ROLE, ativo: true, empresa_id: DEMO_EMPRESA_ID });

  if (insertUsuarioError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "Não foi possível criar seu acesso. Tente novamente em instantes." }, 500);
  }

  const { error: insertLeadError } = await admin
    .from("leads_demo")
    .insert({ usuario_id: created.user.id, nome, email, telefone, cargo, empresa_lead: empresaLead });

  if (insertLeadError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("usuarios").delete().eq("id", created.user.id);
    const msg = insertLeadError.code === "23505" ? "Já existe um cadastro com este e-mail." : "Não foi possível concluir seu cadastro. Tente novamente em instantes.";
    return json({ error: msg }, 400);
  }

  return json({ nome, login, senha });
});
