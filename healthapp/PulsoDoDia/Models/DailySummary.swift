import Foundation

/// Resumo do dia montado a partir do Apple Saúde.
/// Campos `nil` significam "sem dados" (ou leitura não autorizada, que o iOS não diferencia).
struct DailySummary: Equatable, Sendable {
    var date: Date
    var steps: Double?
    var activeEnergy: Double?
    var heartRate: HeartRateStats?
    var restingHeartRate: Reading?
    var hrv: Double?
    var sleep: SleepSummary?
    var workouts: [WorkoutSummary] = []

    var hasAnyData: Bool {
        steps != nil || activeEnergy != nil || heartRate != nil || restingHeartRate != nil
            || hrv != nil || sleep != nil || !workouts.isEmpty
    }

    static func empty(for date: Date = .now) -> DailySummary {
        DailySummary(date: date)
    }
}

/// Frequência cardíaca do dia, em bpm.
struct HeartRateStats: Equatable, Sendable {
    let average: Double
    let min: Double
    let max: Double
}

/// Uma leitura pontual com o horário em que foi registrada.
struct Reading: Equatable, Sendable {
    let value: Double
    let date: Date
}

struct WorkoutSummary: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
    let symbolName: String
    let start: Date
    let duration: TimeInterval
    /// Calorias ativas do treino, em kcal.
    let activeEnergy: Double?
}
