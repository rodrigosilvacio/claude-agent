// Gera a edição diária de notícias de IA (chamando a function
// ninanews-buscar) e envia por e-mail via Resend. Não tem cron embutido —
// é disparada às 05:00 America/Sao_Paulo, com um segundo disparo de
// segurança às 05:35 caso o primeiro falhe, por jobs do pg_cron/pg_net
// criados em supabase/migrations (ver log_e_retry_email_diario_noticias_ia.sql).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const RESEND_FROM = "Notícias de IA <onboarding@resend.dev>";
const DESTINATARIO = "rodrigosilvapmp@hotmail.com";

function hojeBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// Cada geração de edição agora leva ~100-120s (resumos de até 700 palavras
// por notícia), então não cabe tentar de novo dentro da mesma execução sem
// estourar o teto de ~150s de uma Edge Function — por isso o retry é um
// segundo disparo do cron 35min depois (ver migration), e esta function
// precisa ser idempotente: só reenvia se ainda não tiver enviado hoje.
async function jaEnviadoHoje(): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/noticias_ia_email_envios?data_brasilia=eq.${hojeBrasilia()}&select=data_brasilia`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) {
    console.error("Falha ao checar se o e-mail de hoje já foi enviado:", res.status, await res.text());
    return false;
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function registrarEnvioDeHoje(): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/noticias_ia_email_envios`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      // Não falha se o registro de hoje já existir (ex.: corrida entre o
      // disparo principal e o de segurança).
      "Prefer": "resolution=ignore-duplicates",
    },
    body: JSON.stringify({ data_brasilia: hojeBrasilia() }),
  });
  if (!res.ok) {
    console.error("Falha ao registrar o envio de hoje:", res.status, await res.text());
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Noticia {
  titulo: string;
  resumo: string;
  fonte: string;
  url: string;
}

interface EdicaoResposta {
  noticias: Noticia[];
  post_final: string;
  post_final_length: number;
  buscado_em: string;
}

// Reaproveita a lógica já testada de busca/seleção/resumo em vez de
// duplicá-la aqui — chama a function ninanews-buscar internamente.
async function buscarEdicao(): Promise<EdicaoResposta> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ninanews-buscar`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: "{}",
    // Uma execução normal (resumos de até 700 palavras por notícia, gerados
    // em paralelo) leva ~100-120s. 140s dá folga sobre isso mas ainda
    // aborta a tempo de devolver um erro limpo antes do teto de ~150s de
    // execução da própria noticias-ia-email-diario matar o processo.
    signal: AbortSignal.timeout(140_000),
  });

  const data = await res.json();
  if (!res.ok || !Array.isArray(data?.noticias) || typeof data?.post_final !== "string") {
    throw new Error(data?.error || "Falha ao gerar a edição de notícias.");
  }
  return data as EdicaoResposta;
}

function montarHtml(edicao: EdicaoResposta): string {
  const dataFormatada = new Date(edicao.buscado_em).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const itens = edicao.noticias
    .map(
      (n, i) => `
    <li style="margin:0 0 20px;padding:16px 0 0;border-top:${i === 0 ? "none" : "1px solid #ded2b0"};">
      <div style="font-family:monospace;font-size:12px;font-weight:bold;letter-spacing:0.05em;color:#9a2f1f;margin-bottom:6px;">
        DESPACHO ${String(i + 1).padStart(2, "0")}
      </div>
      <div style="font-weight:bold;font-size:16px;line-height:1.35;margin-bottom:6px;color:#211c15;">
        ${escapeHtml(n.titulo)}
      </div>
      <div style="font-size:14px;line-height:1.6;color:#211c15;margin-bottom:8px;">
        ${escapeHtml(n.resumo)}
      </div>
      <a href="${n.url}" style="font-family:monospace;font-size:12px;color:#2f5c53;text-decoration:none;">
        ${escapeHtml(n.fonte)} ↗
      </a>
    </li>`,
    )
    .join("");

  const postFinalHtml = escapeHtml(edicao.post_final).replace(/\n/g, "<br>");

  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;color:#211c15;background:#f2ecdc;padding:28px;">
    <p style="font-family:monospace;font-size:12px;letter-spacing:0.05em;color:#6e6656;margin:0 0 4px;">
      NOTÍCIAS DE IA · WIRE DIÁRIO
    </p>
    <p style="font-family:monospace;font-size:12px;color:#6e6656;margin:0 0 20px;">
      Edição de ${dataFormatada}
    </p>
    <h1 style="font-family:'Courier New',monospace;font-size:20px;margin:0 0 20px;">
      As 5 notícias de IA de hoje
    </h1>
    <ol style="list-style:none;padding:0;margin:0;">${itens}</ol>
    <hr style="border:none;border-top:1px dashed #ded2b0;margin:24px 0;">
    <p style="font-family:monospace;font-size:13px;font-weight:bold;margin:0 0 10px;">
      Texto pronto para o LinkedIn
    </p>
    <div style="background:#fbf8ee;border:1px solid #ded2b0;border-radius:3px;padding:16px;white-space:pre-wrap;font-family:Georgia,serif;font-size:14px;line-height:1.6;">${postFinalHtml}</div>
  </div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // O disparo de segurança (05:35) chama a mesma function que o disparo
    // principal (05:00) — se o principal já deu certo hoje, não refaz o
    // trabalho nem manda um segundo e-mail.
    if (await jaEnviadoHoje()) {
      return json({ ok: true, skipped: true, motivo: "E-mail de hoje já foi enviado." });
    }

    const edicao = await buscarEdicao();
    const html = montarHtml(edicao);
    const dataAssunto = new Date(edicao.buscado_em).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [DESTINATARIO],
        subject: `Notícias de IA — ${dataAssunto}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("Resend error:", resendRes.status, errText);
      return json({ error: "Falha ao enviar o e-mail." }, 502);
    }

    await registrarEnvioDeHoje();

    return json({ ok: true, enviado_para: DESTINATARIO, noticias: edicao.noticias.length });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
