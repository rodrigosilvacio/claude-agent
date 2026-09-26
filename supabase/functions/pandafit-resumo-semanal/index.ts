// Resumo semanal do PandaFit por e-mail (Resend): treinos da semana
// anterior, último peso e distância da meta do mês. Só vai pra quem ligou o
// opt-in em Configurações (pandafit_settings.weekly_summary_email).
//
// Disparado toda segunda às 08:00 (Brasília) por um job do pg_cron/pg_net
// criado em supabase/migrations/0059_pandafit_ux_cx_transparencia_feedback_resumo.sql.
// verify_jwt fica desligado no deploy porque o cron chama só com a
// publishable key; por isso a function é idempotente por (usuário, semana)
// via pandafit_resumo_semanal_envios: chamá-la de novo não reenvia nada.
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!

const RESEND_FROM = "PandaFit <onboarding@resend.dev>"
const APP_URL = "https://erpconnect.vercel.app/pandafit/"
const DEFAULT_MONTHLY_GOAL = 12

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function isoBrasilia(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
}

// Segunda-feira da semana ANTERIOR (a que o resumo cobre) e o domingo
// seguinte, ambos em data de Brasília.
function semanaAnterior(): { inicio: string; fim: string } {
  const hoje = new Date(isoBrasilia(new Date()) + "T12:00:00Z")
  const diaSemana = hoje.getUTCDay() // 0 = domingo
  const diasDesdeSegunda = (diaSemana + 6) % 7
  const segundaAtual = new Date(hoje)
  segundaAtual.setUTCDate(hoje.getUTCDate() - diasDesdeSegunda)
  const inicio = new Date(segundaAtual)
  inicio.setUTCDate(segundaAtual.getUTCDate() - 7)
  const fim = new Date(segundaAtual)
  fim.setUTCDate(segundaAtual.getUTCDate() - 1)
  return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }
}

function fmtDia(iso: string): string {
  const [, m, d] = iso.split("-")
  return `${d}/${m}`
}

function fmtKg(kg: number): string {
  return (Math.round(kg * 10) / 10).toFixed(1).replace(".", ",")
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { inicio, fim } = semanaAnterior()
  const hojeIso = isoBrasilia(new Date())
  const inicioMes = hojeIso.slice(0, 8) + "01"

  const { data: optIns, error: optError } = await admin
    .from("pandafit_settings")
    .select("user_id, monthly_goal, target_weight_kg")
    .eq("weekly_summary_email", true)
  if (optError) return json({ error: optError.message }, 500)

  const resultado: { enviados: number; pulados: number; falhas: number } = { enviados: 0, pulados: 0, falhas: 0 }

  for (const s of optIns ?? []) {
    try {
      const { data: jaEnviado } = await admin
        .from("pandafit_resumo_semanal_envios")
        .select("user_id")
        .eq("user_id", s.user_id)
        .eq("semana", inicio)
        .maybeSingle()
      if (jaEnviado) { resultado.pulados++; continue }

      const { data: usuario } = await admin
        .from("pandafit_usuarios")
        .select("email, nome")
        .eq("id", s.user_id)
        .maybeSingle()
      if (!usuario?.email) { resultado.pulados++; continue }

      const [{ data: treinosSemana }, { data: treinosMes }, { data: pesos }] = await Promise.all([
        admin.from("pandafit_workouts").select("date, type, minutes")
          .eq("user_id", s.user_id).gte("date", inicio).lte("date", fim).order("date"),
        admin.from("pandafit_workouts").select("id", { count: "exact" })
          .eq("user_id", s.user_id).gte("date", inicioMes).lte("date", hojeIso),
        admin.from("pandafit_weights").select("date, weight_kg")
          .eq("user_id", s.user_id).order("date", { ascending: false }).limit(8),
      ])

      const treinos = treinosSemana ?? []
      const minutos = treinos.reduce((a, t) => a + (t.minutes ?? 0), 0)
      const meta = s.monthly_goal ?? DEFAULT_MONTHLY_GOAL
      const noMes = treinosMes?.length ?? 0
      const faltam = Math.max(0, meta - noMes)
      const ultimoPeso = pesos?.[0]
      const pesoSemanaAnterior = pesos?.find((p) => p.date < inicio)

      const linhasTreino = treinos.length
        ? treinos.map((t) => `<li>${fmtDia(t.date)} · ${escapeHtml(t.type)} · ${t.minutes} min</li>`).join("")
        : "<li>Nenhum treino registrado nesta semana.</li>"

      let blocoPeso = "<p>Nenhum peso registrado ainda.</p>"
      if (ultimoPeso) {
        blocoPeso = `<p>Último peso: <strong>${fmtKg(Number(ultimoPeso.weight_kg))} kg</strong> em ${fmtDia(ultimoPeso.date)}`
        if (pesoSemanaAnterior) {
          const diff = Number(ultimoPeso.weight_kg) - Number(pesoSemanaAnterior.weight_kg)
          blocoPeso += ` (${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${fmtKg(Math.abs(diff))} kg desde ${fmtDia(pesoSemanaAnterior.date)})`
        }
        if (s.target_weight_kg) {
          blocoPeso += `. Meta: ${fmtKg(Number(s.target_weight_kg))} kg`
        }
        blocoPeso += ".</p>"
      }

      const primeiroNome = (usuario.nome || "").split(" ")[0] || "Olá"
      const html = `
        <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
          <h2 style="margin:0 0 4px">🐼 Seu resumo da semana</h2>
          <p style="color:#475569;margin:0 0 16px">${fmtDia(inicio)} a ${fmtDia(fim)}</p>
          <p>${escapeHtml(primeiroNome)}, você treinou <strong>${treinos.length} ${treinos.length === 1 ? "vez" : "vezes"}</strong>
          (${Math.floor(minutos / 60)}h ${String(minutos % 60).padStart(2, "0")}).</p>
          <ul>${linhasTreino}</ul>
          <p>No mês: <strong>${noMes} de ${meta}</strong> treinos.
          ${faltam === 0 ? "Meta do mês batida! 🎉" : `Faltam ${faltam} para bater a meta.`}</p>
          ${blocoPeso}
          <p><a href="${APP_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir o PandaFit</a></p>
          <p style="color:#94a3b8;font-size:12px">Você recebe este e-mail porque ativou o resumo semanal em Configurações. Desative lá quando quiser.</p>
        </div>`

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [usuario.email],
          subject: `PandaFit · ${treinos.length} ${treinos.length === 1 ? "treino" : "treinos"} na semana`,
          html,
        }),
      })
      if (!resendRes.ok) {
        console.error("Resend error:", s.user_id, resendRes.status, await resendRes.text())
        resultado.falhas++
        continue
      }

      await admin.from("pandafit_resumo_semanal_envios")
        .upsert({ user_id: s.user_id, semana: inicio }, { onConflict: "user_id,semana", ignoreDuplicates: true })
      resultado.enviados++
    } catch (err) {
      console.error("Falha no resumo semanal de", s.user_id, err)
      resultado.falhas++
    }
  }

  return json({ semana: { inicio, fim }, ...resultado })
})
