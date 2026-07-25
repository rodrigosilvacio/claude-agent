// Cowork — guarda de sessão. Supabase Auth padrão por e-mail (magic link),
// sem login fictício por usuário/senha nem multiempresa: cada pessoa autenticada
// só enxerga seus próprios projetos e documentos (RLS por owner_id).
import { supabase } from "./supabaseClient.js";

// Garante que há sessão ativa; se não houver, redireciona para o login e
// nunca resolve (a navegação já tirou o usuário da página atual).
export async function requireSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    window.location.replace("./login.html");
    return new Promise(() => {});
  }

  supabase.auth.onAuthStateChange((_event, newSession) => {
    if (!newSession) window.location.replace("./login.html");
  });

  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace("./login.html");
}
