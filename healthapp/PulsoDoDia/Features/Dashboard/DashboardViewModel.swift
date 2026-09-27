import Foundation
import Observation

@MainActor
@Observable
final class DashboardViewModel {
    private(set) var summary: DailySummary?
    private(set) var isLoading = false
    private(set) var lastUpdated: Date?

    private let service: HealthService

    init(service: HealthService) {
        self.service = service
    }

    /// Nada voltou: pode ser um dia sem registros ou leitura negada. Mostramos o atalho para revisar.
    var showPermissionHint: Bool {
        summary.map { !$0.hasAnyData } ?? false
    }

    var stepProgress: Double? {
        summary?.steps.map { min($0 / AppConfig.dailyStepGoal, 1) }
    }

    /// Na abertura: se foram adicionados novos tipos de dado desde a última permissão, pede de novo.
    func start() async {
        if !(await service.hasRequestedAuthorization()) {
            try? await service.requestAuthorization()
        }
        await refresh()
    }

    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        let now = Date.now
        summary = await service.fetchSummary(for: now)
        lastUpdated = now
    }
}
