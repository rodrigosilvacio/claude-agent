import Foundation

/// Fonte dos dados de saúde. A implementação real usa o HealthKit;
/// a de demonstração alimenta Previews, testes e apresentações.
protocol HealthService: Sendable {
    /// Abre a folha nativa de permissões do iOS (só aparece na primeira vez).
    func requestAuthorization() async throws

    /// `true` quando a folha de permissões já foi respondida para todos os tipos pedidos.
    /// O iOS não revela se a leitura foi permitida ou negada, só se a pergunta já foi feita.
    func hasRequestedAuthorization() async -> Bool

    /// Busca o resumo do dia. Nunca falha como um todo: cada dado sem resposta vira `nil`.
    func fetchSummary(for date: Date) async -> DailySummary
}

enum HealthError: LocalizedError {
    case unavailable

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "O Apple Saúde não está disponível neste aparelho."
        }
    }
}
