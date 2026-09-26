import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Não autenticado" }, 401)

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    // O gateway do Supabase já valida o JWT (verify_jwt=true nesta função);
    // isso confirma que o token corresponde a um usuário de fato.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData.user) return json({ error: "Sessão inválida" }, 401)

    const admin = createClient(supabaseUrl, serviceKey)

    // Este projeto Supabase é compartilhado com outros apps do usuário — o
    // auth.users tem contas de todos eles. pandafit_usuarios é o escopo de
    // quem pertence a ESTE app.
    const { data: callerScope, error: scopeError } = await admin
      .from("pandafit_usuarios")
      .select("id, role")
      .eq("id", callerData.user.id)
      .maybeSingle()
    if (scopeError) throw scopeError

    if (!callerScope) {
      return json({ error: "Esta conta não tem acesso ao PandaFit" }, 403)
    }
    if (callerScope.role !== "admin") {
      return json({ error: "Apenas administradores podem gerenciar usuários" }, 403)
    }

    const body = await req.json()
    const { action } = body

    if (action === "list") {
      const { data: escopo, error: escopoError } = await admin
        .from("pandafit_usuarios")
        .select("id, email, nome, role, criado_em")
      if (escopoError) throw escopoError

      const { data: authList, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
      if (listError) throw listError

      const { data: vinculos, error: vinculosError } = await admin
        .from("pandafit_medico_pacientes")
        .select("medico_id, usuario_id")
      if (vinculosError) throw vinculosError

      const authPorId = new Map(authList.users.map((u) => [u.id, u]))
      const usuarios = escopo.map((u) => {
        const a = authPorId.get(u.id)
        return {
          id: u.id,
          email: u.email,
          nome: u.nome,
          role: u.role,
          criado_em: u.criado_em,
          last_sign_in_at: a?.last_sign_in_at ?? null,
        }
      })
      return json({ usuarios, vinculos })
    }

    if (action === "invite") {
      const { nome, email, password, role } = body
      if (typeof email !== "string" || !email.includes("@")) {
        return json({ error: "Informe um e-mail válido" }, 400)
      }
      if (role !== "usuario" && role !== "medico") {
        return json({ error: "Papel inválido" }, 400)
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        return json({ error: "Defina uma senha com pelo menos 6 caracteres" }, 400)
      }
      const emailNormalizado = email.trim().toLowerCase()

      // Se já existe uma conta com esse e-mail (comum neste projeto
      // compartilhado, usado por vários outros apps), só concede acesso ao
      // PandaFit — NUNCA mexe na senha dela, já que a mesma conta pode ser
      // usada pra logar em outro app deste mesmo projeto.
      const { data: existentes, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
      if (listError) throw listError
      const existente = existentes.users.find((u) => u.email?.toLowerCase() === emailNormalizado)

      const { data: jaEscopado } = await admin
        .from("pandafit_usuarios")
        .select("id")
        .eq("id", existente?.id ?? "00000000-0000-0000-0000-000000000000")
        .maybeSingle()
      if (existente && jaEscopado) {
        return json({ error: "Esse e-mail já tem acesso ao PandaFit" }, 400)
      }

      let userId: string
      let contaExistente = false

      if (existente) {
        userId = existente.id
        contaExistente = true
      } else {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: emailNormalizado,
          password,
          email_confirm: true,
        })
        if (createError) throw createError
        userId = created.user.id
      }

      const { error: insertError } = await admin.from("pandafit_usuarios").insert({
        id: userId,
        email: emailNormalizado,
        nome: nome && typeof nome === "string" && nome.trim() ? nome.trim() : null,
        role,
      })
      if (insertError) throw insertError

      return json({ usuario: { id: userId, email: emailNormalizado, role }, contaExistente })
    }

    if (action === "update_role") {
      const { userId, role } = body
      if (!userId || typeof userId !== "string") return json({ error: "ID do usuário é obrigatório" }, 400)
      if (role !== "admin" && role !== "usuario" && role !== "medico") {
        return json({ error: "Papel inválido" }, 400)
      }
      if (userId === callerData.user.id && role !== "admin") {
        return json({ error: "Você não pode remover seu próprio acesso de admin por aqui" }, 400)
      }

      const { error } = await admin.from("pandafit_usuarios").update({ role }).eq("id", userId)
      if (error) throw error

      return json({ ok: true })
    }

    if (action === "set_password") {
      const { userId, password } = body
      if (!userId || typeof userId !== "string") return json({ error: "ID do usuário é obrigatório" }, 400)
      if (!password || typeof password !== "string" || password.length < 6) {
        return json({ error: "A senha deve ter pelo menos 6 caracteres" }, 400)
      }

      const { data: alvo } = await admin.from("pandafit_usuarios").select("id").eq("id", userId).maybeSingle()
      if (!alvo) return json({ error: "Usuário fora do escopo do PandaFit" }, 403)

      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) throw error

      return json({ ok: true })
    }

    if (action === "revoke") {
      // Remove o acesso desta pessoa ao PandaFit. NUNCA apaga a conta do
      // auth.users — ela pode ser usada por outros apps deste mesmo projeto.
      const { userId } = body
      if (!userId || typeof userId !== "string") return json({ error: "ID do usuário é obrigatório" }, 400)
      if (userId === callerData.user.id) {
        return json({ error: "Você não pode remover seu próprio acesso por aqui" }, 400)
      }

      const { error } = await admin.from("pandafit_usuarios").delete().eq("id", userId)
      if (error) throw error

      return json({ ok: true })
    }

    if (action === "set_link") {
      // Conecta (ou desconecta) um paciente a um médico — N:N, um paciente
      // pode ter vários médicos e vice-versa. Valida os papéis pra não
      // deixar vincular, por exemplo, um admin como "médico" de alguém.
      const { medicoId, usuarioId, linked } = body
      if (!medicoId || typeof medicoId !== "string" || !usuarioId || typeof usuarioId !== "string") {
        return json({ error: "medicoId e usuarioId são obrigatórios" }, 400)
      }

      const { data: medico } = await admin.from("pandafit_usuarios").select("role").eq("id", medicoId).maybeSingle()
      if (!medico || medico.role !== "medico") return json({ error: "medicoId não é um médico válido" }, 400)

      const { data: paciente } = await admin.from("pandafit_usuarios").select("role").eq("id", usuarioId).maybeSingle()
      if (!paciente || paciente.role !== "usuario") return json({ error: "usuarioId não é um paciente válido" }, 400)

      if (linked) {
        const { error } = await admin
          .from("pandafit_medico_pacientes")
          .upsert({ medico_id: medicoId, usuario_id: usuarioId }, { onConflict: "medico_id,usuario_id" })
        if (error) throw error
      } else {
        const { error } = await admin
          .from("pandafit_medico_pacientes")
          .delete()
          .eq("medico_id", medicoId)
          .eq("usuario_id", usuarioId)
        if (error) throw error
      }

      return json({ ok: true })
    }

    return json({ error: "Ação inválida" }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno"
    return json({ error: message }, 500)
  }
})
