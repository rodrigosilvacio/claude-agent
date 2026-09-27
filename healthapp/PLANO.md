# Plano: App iOS com Apple Saúde (HealthKit)

Nome provisório: **Pulso do Dia**
Owner: Rodrigo Silva · Data: 27/09/2026 · Status: planejamento

---

## 1. Resumo executivo

Um app iOS nativo que, com autorização do usuário, lê dados do Apple Saúde (passos, frequência cardíaca, FC em repouso, HRV, sono, calorias ativas e treinos) e mostra uma dashboard do dia.

**Decisões principais**

| Tema | Decisão | Por quê |
| :-- | :-- | :-- |
| Plataforma | App nativo iOS (iPhone) | HealthKit só existe em app nativo. Web, PWA, Lovable e Replit não acessam o Apple Saúde. |
| Stack | Swift 6 + SwiftUI + HealthKit (async/await) | Menor atrito, acesso completo à API, sem bridge de terceiros. |
| iOS mínimo | iOS 17 | Cobre a grande maioria dos iPhones ativos e permite APIs modernas (`HKStatisticsQueryDescriptor`, Observation). |
| Dados | 100% locais no MVP, somente leitura | Dado de saúde é dado sensível (LGPD art. 11). Sem backend = sem risco de vazamento e aprovação mais simples na App Store. |
| Arquitetura | MVVM com `HealthService` atrás de um protocolo | Permite mock para testes, preview e simulador. |

**Prazo estimado do MVP:** 4 semanas (1 dev iOS), até TestFlight.

---

## 2. Problema, usuário e objetivo

- **Problema:** o app Saúde da Apple guarda muitos dados, mas espalhados em várias telas. O usuário não tem uma leitura rápida de "como está meu dia".
- **Usuário:** pessoa com iPhone (e idealmente Apple Watch) que quer acompanhar atividade, recuperação e sono sem abrir vários gráficos.
- **Job to be done:** "Quando acordo ou termino o dia, quero ver em uma tela como foram meu movimento, meu coração e meu sono, para decidir se treino, descanso ou ajusto a rotina."

**Objetivos**
1. Explicar com transparência quais dados serão lidos e por quê.
2. Conectar ao Apple Saúde com um toque.
3. Exibir uma dashboard do dia confiável e rápida.

**Não objetivos (fora do MVP)**
- Escrever dados no Apple Saúde.
- Backend, login, sincronização em nuvem ou compartilhamento com terceiros.
- Recomendações médicas ou diagnóstico.
- Histórico semanal/mensal e gráficos de tendência (fase 2).
- Versão Android (Health Connect) e app para Apple Watch.

---

## 3. Pré requisitos e ambiente

| Item | Detalhe |
| :-- | :-- |
| Mac com Xcode 16+ | Obrigatório para compilar apps iOS (não roda em Linux/Windows). |
| Apple Developer Program | US$ 99/ano. Necessário para a capability HealthKit em dispositivo, TestFlight e App Store. |
| iPhone físico | Recomendado para validar dados reais. O Simulador tem o app Saúde e aceita dados inseridos manualmente, útil para desenvolvimento. |
| Apple Watch (opcional) | Fonte principal de FC, FC em repouso e HRV. Sem relógio, esses cards tendem a ficar vazios. |
| Política de privacidade publicada | Exigida pela App Store para qualquer app com HealthKit. |

---

## 4. Jornada e telas

```
[Abertura] -> [1. Tela inicial / Boas vindas] -> [Botão "Conectar Apple Saúde"]
                                                   |
                                   [Folha nativa de permissões do iOS]
                                                   |
                                           [2. Dashboard do dia]
                                                   |
                       (pull to refresh, estados vazios, link para Ajustes)
```

### Tela 1: Boas vindas e transparência
- Título: "Seu dia em uma tela".
- Texto curto: o app lê dados do Apple Saúde **apenas no seu iPhone**, não envia para servidores e não grava nada.
- Lista das 7 informações com ícone e o porquê de cada uma:

| Dado | Para que usamos |
| :-- | :-- |
| Passos | Medir seu nível de movimento no dia |
| Frequência cardíaca | Mostrar média, mínima e máxima do dia |
| FC em repouso | Indicador de recuperação e condicionamento |
| HRV (variabilidade da FC) | Indicador de estresse e recuperação |
| Sono | Quanto você dormiu na última noite, por fase |
| Calorias ativas | Energia gasta com atividade |
| Treinos | Quais atividades você fez hoje, duração e calorias |

- Botão primário: **Conectar Apple Saúde**.
- Link: "Política de privacidade".
- Rodapé: "Este app não substitui orientação médica."

### Tela 2: Dashboard do dia
- Cabeçalho: data de hoje e horário da última atualização.
- Grade de cards:
  - **Passos**: total do dia (meta visual de 8.000, configurável na fase 2).
  - **Calorias ativas**: total do dia em kcal.
  - **Frequência cardíaca**: média, mín. e máx. do dia em bpm.
  - **FC em repouso**: valor mais recente em bpm.
  - **HRV**: média do dia (ou última leitura) em ms.
  - **Sono**: total dormido na última noite em "7h 32min", com barra por fase (Profundo, Essencial, REM, Acordado).
- Lista **Treinos de hoje**: ícone do tipo, nome em português, duração, kcal e horário.
- Pull to refresh e atualização automática ao voltar para o app.
- **Estado vazio por card:** "Sem dados hoje" + dica ("Use o Apple Watch para registrar FC e HRV").
- **Banner de permissão:** se nenhum dado vier, mostrar "Não encontramos dados. Verifique as permissões em Ajustes > Saúde > Acesso a Dados" com botão que abre o app Saúde/Ajustes.

---

## 5. Especificação técnica (HealthKit)

### 5.1 Configuração do projeto
1. Target iOS > *Signing & Capabilities* > adicionar **HealthKit** (gera o entitlement `com.apple.developer.healthkit`).
2. `Info.plist`:
   - `NSHealthShareUsageDescription`: "Usamos seus dados do Apple Saúde (passos, frequência cardíaca, HRV, sono, calorias e treinos) para montar sua dashboard diária. Os dados ficam somente no seu iPhone."
   - `NSHealthUpdateUsageDescription`: **não incluir** (o app não escreve dados).
3. Checar `HKHealthStore.isHealthDataAvailable()` antes de qualquer chamada (iPad antigo, por exemplo, retorna falso).

### 5.2 Tipos de dados solicitados (somente leitura)

| Dado | Tipo HealthKit | Unidade | Consulta |
| :-- | :-- | :-- | :-- |
| Passos | `HKQuantityType(.stepCount)` | `count` | `HKStatisticsQueryDescriptor` com `.cumulativeSum` (deduplica iPhone + Watch) |
| Frequência cardíaca | `HKQuantityType(.heartRate)` | `count/min` | Estatística `.discreteAverage`, `.discreteMin`, `.discreteMax` |
| FC em repouso | `HKQuantityType(.restingHeartRate)` | `count/min` | `HKSampleQueryDescriptor`, mais recente (limit 1) |
| HRV | `HKQuantityType(.heartRateVariabilitySDNN)` | `ms` | `.discreteAverage` do dia + última leitura |
| Sono | `HKCategoryType(.sleepAnalysis)` | categoria | Amostras da janela "ontem 18h até hoje 12h", somando `asleepCore`, `asleepDeep`, `asleepREM` e `asleepUnspecified` (ignorar `inBed`; `awake` só para a barra) |
| Calorias ativas | `HKQuantityType(.activeEnergyBurned)` | `kcal` | `.cumulativeSum` |
| Treinos | `HKObjectType.workoutType()` | n/a | `HKSampleQueryDescriptor` de `HKWorkout` no dia, ordenado por início; kcal via `workout.statistics(for: .activeEnergyBurned)` |

Janela padrão "hoje": `Calendar.current.startOfDay(for: .now)` até `.now`, fuso do aparelho.

### 5.3 Regras importantes da API
- **Privacidade de leitura:** o iOS **não informa** se o usuário negou leitura. Negado e "sem dados" parecem iguais (consulta volta vazia). Por isso o app trata vazio com mensagem neutra e orienta revisar permissões.
- `getRequestStatusForAuthorization` indica apenas se a folha de permissões já foi exibida. Usar para decidir entre mostrar a Tela 1 ou ir direto à Dashboard.
- A folha de permissões aparece **uma única vez**. Depois disso, mudanças só em Ajustes > Saúde > Acesso a Dados e Dispositivos.
- Dados do HealthKit ficam inacessíveis com o **aparelho bloqueado**. Buscar sempre com o app em primeiro plano (`scenePhase == .active`).
- Sono dividido por fases existe a partir do iOS 16; dados antigos vêm como `asleepUnspecified`.
- Evitar contar sono duplicado quando há mais de uma fonte (Watch + app de terceiro): priorizar a fonte Apple Watch ou fazer união de intervalos.

### 5.4 Arquitetura

```
PulsoDoDia/
├── App/
│   └── PulsoDoDiaApp.swift            // entrada, decide Onboarding x Dashboard
├── Core/
│   ├── HealthService.swift            // protocolo: requestAuthorization(), fetchToday()
│   ├── HealthKitService.swift         // implementação real com HKHealthStore
│   ├── MockHealthService.swift        // dados falsos para Preview, testes e demo
│   └── HealthTypes.swift              // conjunto de HKObjectType solicitados
├── Models/
│   └── DailySummary.swift             // struct com os 7 indicadores (opcionais)
├── Features/
│   ├── Onboarding/OnboardingView.swift
│   └── Dashboard/
│       ├── DashboardView.swift
│       ├── DashboardViewModel.swift   // @Observable, estados: loading, loaded, empty, error
│       ├── MetricCard.swift
│       ├── SleepCard.swift
│       └── WorkoutRow.swift
├── Resources/
│   ├── Localizable.xcstrings          // pt-BR (en na fase 2)
│   └── PrivacyInfo.xcprivacy          // manifesto de privacidade exigido pela Apple
└── Tests/
    ├── DashboardViewModelTests.swift
    └── SleepAggregationTests.swift
```

Pontos de design:
- `fetchToday()` dispara as 7 consultas **em paralelo** (`async let` / `TaskGroup`); um card falhando não derruba os outros.
- `DailySummary` usa campos opcionais: `nil` = sem dados, exibido como estado vazio.
- Formatação com `MeasurementFormatter` / `Duration.formatted` em pt-BR.
- Nenhum dado de saúde é persistido em disco, UserDefaults, logs ou analytics.

### 5.5 Esboço do núcleo (referência)

```swift
final class HealthKitService: HealthService {
    private let store = HKHealthStore()

    static let readTypes: Set<HKObjectType> = [
        HKQuantityType(.stepCount),
        HKQuantityType(.heartRate),
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.activeEnergyBurned),
        HKCategoryType(.sleepAnalysis),
        HKObjectType.workoutType()
    ]

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw HealthError.unavailable }
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    func sum(_ id: HKQuantityTypeIdentifier, unit: HKUnit) async throws -> Double? {
        let today = HKQuery.predicateForSamples(withStart: Calendar.current.startOfDay(for: .now), end: .now)
        let descriptor = HKStatisticsQueryDescriptor(
            predicate: .quantitySample(type: HKQuantityType(id), predicate: today),
            options: .cumulativeSum)
        return try await descriptor.result(for: store)?.sumQuantity()?.doubleValue(for: unit)
    }
}
```

---

## 6. Backlog do MVP

| # | Épico | História | Prioridade | Estimativa |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Fundação | Criar projeto SwiftUI, capability HealthKit, Info.plist, manifesto de privacidade | Alta | 0,5 d |
| 2 | Fundação | `HealthService` (protocolo), `MockHealthService` e modelo `DailySummary` | Alta | 1 d |
| 3 | Onboarding | Tela de boas vindas com os 7 dados e justificativas | Alta | 1 d |
| 4 | Permissão | Botão "Conectar Apple Saúde" e solicitação de autorização | Alta | 0,5 d |
| 5 | Permissão | Roteamento: onboarding na 1ª vez, dashboard nas seguintes | Alta | 0,5 d |
| 6 | Dados | Passos e calorias ativas (soma do dia) | Alta | 0,5 d |
| 7 | Dados | FC (média/mín/máx), FC em repouso e HRV | Alta | 1 d |
| 8 | Dados | Sono da última noite com fases e deduplicação | Alta | 1,5 d |
| 9 | Dados | Treinos de hoje com tipo em português, duração e kcal | Alta | 1 d |
| 10 | Dashboard | Grade de cards, lista de treinos, pull to refresh, refresh ao voltar ao app | Alta | 2 d |
| 11 | Dashboard | Estados vazios, loading, erro e banner de permissão com atalho para Ajustes | Alta | 1 d |
| 12 | Qualidade | Testes unitários (ViewModel, agregação de sono) e acessibilidade (VoiceOver, Dynamic Type, modo escuro) | Média | 1,5 d |
| 13 | Lançamento | Política de privacidade, ícone, screenshots, TestFlight | Média | 1,5 d |

**Total:** cerca de 14 dias úteis de desenvolvimento.

---

## 7. Critérios de aceite (Given / When / Then)

1. **Tela inicial**
   Dado que é a primeira abertura do app, quando o app inicia, então vejo a lista dos 7 dados com a finalidade de cada um e o botão "Conectar Apple Saúde".
2. **Autorização**
   Dado que estou na tela inicial, quando toco em "Conectar Apple Saúde", então a folha nativa do iOS abre listando exatamente: Passos, Frequência Cardíaca, FC em Repouso, Variabilidade da FC, Sono, Energia Ativa e Treinos, somente para leitura.
3. **Pós autorização**
   Dado que concluí a folha de permissões (permitindo ou não), quando ela fecha, então sou levado à dashboard e não vejo mais a tela inicial nas próximas aberturas.
4. **Dashboard com dados**
   Dado que tenho dados de hoje no Apple Saúde, quando abro a dashboard, então vejo os valores de passos e calorias iguais (tolerância de 1%) aos exibidos no app Saúde.
5. **Sono**
   Dado que dormi das 23h às 7h com 30 min acordado, quando abro a dashboard, então o card de sono mostra 7h 30min e a barra de fases.
6. **Treinos**
   Dado que registrei uma corrida hoje, quando abro a dashboard, então a lista mostra "Corrida", duração e kcal.
7. **Sem dados / permissão negada**
   Dado que nenhum dado foi retornado, quando a dashboard carrega, então cada card mostra "Sem dados hoje" e aparece o banner com atalho para revisar permissões, sem travar ou mostrar erro técnico.
8. **Desempenho**
   Dado um iPhone com dados reais, quando abro a dashboard, então todos os cards carregam em até 2 segundos.
9. **Dispositivo sem HealthKit**
   Dado um aparelho sem suporte, quando toco em conectar, então vejo mensagem clara de indisponibilidade.

---

## 8. Requisitos não funcionais, segurança e LGPD

- **Dado sensível:** saúde é dado pessoal sensível (LGPD art. 11). Base legal: consentimento específico, coletado pela tela inicial + folha nativa.
- **Minimização:** ler só os 7 tipos listados, somente leitura, somente o período necessário.
- **Sem saída de dados:** nenhum envio a servidor, nenhum SDK de analytics/ads com acesso a dados de saúde, nenhum log com valores.
- **Regras da App Store (5.1.1 e 5.1.3):** proibido usar dados do HealthKit para publicidade ou vendê-los; proibido guardá-los no iCloud; política de privacidade obrigatória; explicar claramente o uso.
- **Transparência:** texto "não substitui orientação médica" e link para a política.
- **Revogação:** instruções no app de como revogar em Ajustes > Saúde.
- **Acessibilidade:** VoiceOver em todos os cards, Dynamic Type, contraste AA, modo escuro.
- **Idioma:** pt-BR no MVP.

---

## 9. Métricas de sucesso

| Tipo | Métrica | Meta do piloto |
| :-- | :-- | :-- |
| Ativação | % de quem vê a tela inicial e toca em "Conectar" | ≥ 80% |
| Permissão | % de usuários com ao menos 5 dos 7 cards com dados | ≥ 70% |
| Engajamento | Usuários que abrem a dashboard em 4+ dias por semana | ≥ 40% |
| Qualidade | Divergência de passos/kcal vs app Saúde | ≤ 1% |
| Desempenho | Tempo de carregamento da dashboard (p90) | ≤ 2 s |
| Estabilidade | Sessões sem crash | ≥ 99,5% |

Como o MVP não tem backend, a medição no piloto vem de **App Store Connect / TestFlight** (crashes, sessões) e de **entrevistas curtas** com os testadores. Nenhum evento de analytics carrega valores de saúde.

---

## 10. Riscos e mitigação

| Risco | Impacto | Mitigação |
| :-- | :-- | :-- |
| Usuário sem Apple Watch: FC, FC repouso e HRV vazios | Médio | Estado vazio educativo; destacar passos, kcal e treinos |
| Não dá para saber se leitura foi negada | Médio | Mensagem neutra + atalho para Ajustes |
| Sono duplicado com várias fontes | Médio | União de intervalos ou prioridade à fonte Apple Watch; teste unitário dedicado |
| Rejeição na App Store por privacidade | Alto | Política publicada, textos claros, sem backend, manifesto de privacidade |
| Time sem Mac/Xcode ou sem conta de desenvolvedor | Alto | Resolver antes da Semana 1 (pré requisito) |
| Expectativa de "diagnóstico" | Médio | Aviso de que não é dispositivo médico; sem interpretação clínica no MVP |

---

## 11. Cronograma

| Semana | Entregas |
| :-- | :-- |
| 1 | Setup, capability, `HealthService` + mock, tela inicial e autorização (itens 1 a 5) |
| 2 | Consultas de todos os 7 tipos com testes (itens 6 a 9) |
| 3 | Dashboard completa, estados vazios, banner de permissão, acessibilidade (itens 10 a 12) |
| 4 | Política de privacidade, ajustes finais, TestFlight com 10 a 20 usuários piloto (item 13) |

---

## 12. Fase 2 (após validar o MVP)

1. Histórico de 7 e 30 dias com Swift Charts.
2. Metas personalizadas (passos, sono, kcal).
3. Widget na tela inicial e atualização em segundo plano (`HKObserverQuery` + background delivery).
4. "Score de prontidão" combinando HRV, FC em repouso e sono (com linguagem não clínica).
5. Resumo diário em linguagem natural com IA **no próprio aparelho** (Apple Foundation Models), mantendo os dados locais.
6. Versão Android com Health Connect, se houver demanda.

---

## 13. Próximos passos

- [ ] Confirmar nome do app e conta Apple Developer (Owner: Rodrigo)
- [ ] Garantir Mac com Xcode 16+ e iPhone de teste (Owner: dev iOS)
- [ ] Redigir política de privacidade (Owner: Rodrigo + jurídico/DPO)
- [ ] Iniciar Semana 1 do cronograma
