import SwiftUI

struct DashboardView: View {
    @State private var model: DashboardViewModel
    @Environment(\.scenePhase) private var scenePhase

    init(service: HealthService) {
        _model = State(initialValue: DashboardViewModel(service: service))
    }

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                if let summary = model.summary {
                    content(summary)
                } else {
                    ProgressView("Lendo o Apple Saúde…")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 120)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Hoje")
            .refreshable { await model.refresh() }
        }
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in
            // Voltou para o app: atualiza. (Com o iPhone bloqueado o HealthKit não entrega dados.)
            if phase == .active, model.summary != nil {
                Task { await model.refresh() }
            }
        }
    }

    private func content(_ summary: DailySummary) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            header(summary)

            if model.showPermissionHint {
                PermissionHintCard()
            }

            LazyVGrid(columns: columns, spacing: 12) {
                MetricCard(
                    metric: .steps,
                    value: summary.steps.map(Format.integer),
                    detail: "Meta: \(Format.integer(AppConfig.dailyStepGoal))",
                    progress: model.stepProgress
                )
                MetricCard(
                    metric: .activeEnergy,
                    value: summary.activeEnergy.map { "\(Format.integer($0)) kcal" }
                )
                MetricCard(
                    metric: .heartRate,
                    value: summary.heartRate.map { "\(Format.integer($0.average)) bpm" },
                    detail: summary.heartRate.map { "Mín \(Format.integer($0.min)) · Máx \(Format.integer($0.max))" }
                )
                MetricCard(
                    metric: .restingHeartRate,
                    value: summary.restingHeartRate.map { "\(Format.integer($0.value)) bpm" },
                    detail: summary.restingHeartRate.map { readingDetail($0.date) }
                )
                MetricCard(
                    metric: .hrv,
                    value: summary.hrv.map { "\(Format.integer($0)) ms" },
                    detail: summary.hrv == nil ? nil : "Média do dia"
                )
            }

            SleepCard(sleep: summary.sleep)
            WorkoutsSection(workouts: summary.workouts)

            Text("Dados lidos do Apple Saúde, somente neste iPhone. Não substitui orientação médica.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
        }
        .padding()
    }

    private func header(_ summary: DailySummary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(summary.date.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized)
                .font(.subheadline.weight(.semibold))
            if let lastUpdated = model.lastUpdated {
                Text("Atualizado às \(Format.time(lastUpdated))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func readingDetail(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? "Hoje, \(Format.time(date))" : "Ontem, \(Format.time(date))"
    }
}

/// Nenhum dado voltou. Como o iOS não diz se a leitura foi negada, orientamos a revisar.
struct PermissionHintCard: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Não encontramos dados de hoje", systemImage: "exclamationmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
            Text("Pode ser só um dia sem registros ainda. Se você não liberou o acesso, abra o app Saúde, toque na sua foto, depois em Apps > Pulso do Dia, e ative as categorias.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button("Abrir app Saúde") { openURL(AppConfig.healthAppURL) }
                .font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

#Preview("Com dados") {
    DashboardView(service: MockHealthService())
}

#Preview("Sem dados") {
    DashboardView(service: MockHealthService(summary: .empty()))
}
