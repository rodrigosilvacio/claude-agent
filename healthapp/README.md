# Pulso do Dia (iOS + Apple Saúde)

App iOS nativo em SwiftUI que lê dados do Apple Saúde (HealthKit) e mostra uma dashboard do dia.
Plano completo, backlog e critérios de aceite em [`PLANO.md`](PLANO.md).

## O que já está implementado (MVP)

| Requisito | Onde |
| :-- | :-- |
| Tela inicial explicando os 7 dados e o porquê de cada um | `Features/Onboarding/OnboardingView.swift` |
| Botão "Conectar Apple Saúde" | mesma tela, barra inferior |
| Autorização de leitura: passos, FC, FC em repouso, HRV, sono, calorias ativas, treinos | `Core/HealthKitService.swift` (`readTypes`) |
| Dashboard do dia com cards, sono por fase e lista de treinos | `Features/Dashboard/` |
| Estados vazios e atalho para revisar permissões | `PermissionHintCard`, `MetricCard` |
| Modo demonstração sem dados reais | `Core/MockHealthService.swift` (argumento `-demo`) |
| Testes de sono (deduplicação entre fontes), formatação e ViewModel | `PulsoDoDiaTests/` |

Tudo roda no aparelho: sem backend, sem analytics, somente leitura.

## Como rodar (Mac)

Pré requisitos: Mac com **Xcode 16+**, conta **Apple Developer** e, de preferência, um iPhone com iOS 17+.

```bash
brew install xcodegen          # uma vez
cd healthapp
xcodegen                       # gera PulsoDoDia.xcodeproj a partir do project.yml
open PulsoDoDia.xcodeproj
```

No Xcode:

1. Selecione o target **PulsoDoDia** > **Signing & Capabilities** > escolha seu **Team**.
   (Ou preencha `DEVELOPMENT_TEAM` no `project.yml` para não repetir isso a cada `xcodegen`.)
2. Se o bundle id `com.rodrigosilva.pulsododia` já estiver em uso, troque em `project.yml` e rode `xcodegen` de novo.
3. Confirme que a capability **HealthKit** aparece na lista (vem do arquivo `.entitlements`).
4. Rode no iPhone (Cmd+R). Na primeira abertura, toque em **Conectar Apple Saúde** e libere as categorias.
5. Testes: Cmd+U.

### Sem iPhone ou para apresentar

- **Simulador:** o HealthKit funciona no Simulador. Abra o app Saúde do Simulador e adicione dados manualmente (Procurar > Atividade > Passos > Adicionar Dados).
- **Modo demo:** Product > Scheme > Edit Scheme > Run > Arguments > adicione `-demo`. O app mostra dados fictícios, bom para workshops sem expor dados pessoais.

## Estrutura

```
healthapp/
├── project.yml                 # definição do projeto (XcodeGen)
├── privacidade.html            # política de privacidade (exigida pela App Store)
├── PulsoDoDia/
│   ├── App/                    # entrada do app, roteamento e configurações
│   ├── Core/                   # HealthService (protocolo), HealthKitService, Mock
│   ├── Models/                 # DailySummary, SleepSummary, HealthMetric, formatação
│   ├── Features/Onboarding/    # tela inicial
│   ├── Features/Dashboard/     # dashboard, cards, sono, treinos
│   ├── Resources/              # ícone, cor de destaque, manifesto de privacidade
│   ├── Info.plist              # inclui NSHealthShareUsageDescription
│   └── PulsoDoDia.entitlements # com.apple.developer.healthkit
└── PulsoDoDiaTests/
```

## Regras do HealthKit que o código respeita

- **Leitura negada não é detectável.** O iOS devolve vazio tanto para "negado" quanto para "sem dados". O app mostra "Sem dados hoje" e, se nada voltar, um cartão com atalho para o app Saúde.
- **A folha de permissões aparece uma única vez.** Depois disso o usuário ajusta no app Saúde > foto > Apps > Pulso do Dia.
- **Com o iPhone bloqueado os dados ficam inacessíveis.** O app atualiza ao voltar para o primeiro plano e no gesto de puxar para atualizar.
- **Sono de várias fontes** (Watch + iPhone ou outro app) é consolidado sem contar o mesmo minuto duas vezes; o estágio mais específico vence (`SleepSummary.aggregate`).
- **Passos e calorias** usam `cumulativeSum`, que já deduplica iPhone e Apple Watch.

## Antes de publicar na App Store

- [ ] Publicar `privacidade.html` (GitHub Pages ou site próprio) e conferir `AppConfig.privacyPolicyURL`.
- [ ] Preencher o e-mail de contato na política.
- [ ] Em App Store Connect > Privacidade do app: declarar **"Dados não coletados"** (nada sai do aparelho).
- [ ] Na descrição do app, mencionar a integração com o app Saúde (exigência da revisão da Apple).
- [ ] TestFlight com 10 a 20 usuários piloto.
