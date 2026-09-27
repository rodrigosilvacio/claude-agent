import Foundation

/// Dados de demonstração. Usado em Previews, testes e quando o app abre com o argumento `-demo`
/// (útil para apresentações sem expor dados reais).
struct MockHealthService: HealthService {
    var summary: DailySummary? = nil
    var alreadyRequested = true
    var delay: Duration = .milliseconds(400)

    func requestAuthorization() async throws {}

    func hasRequestedAuthorization() async -> Bool { alreadyRequested }

    func fetchSummary(for date: Date) async -> DailySummary {
        try? await Task.sleep(for: delay)
        return summary ?? Self.sample(for: date)
    }

    static func sample(for date: Date = .now) -> DailySummary {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: date)
        func at(_ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(byAdding: .minute, value: hour * 60 + minute, to: startOfDay)!
        }

        let night = DateInterval(start: at(-6), end: at(12))
        let sleep = SleepSummary.aggregate([
            SleepSegment(stage: .core, start: at(-1, -10), end: at(0, 40)),
            SleepSegment(stage: .deep, start: at(0, 40), end: at(1, 45)),
            SleepSegment(stage: .core, start: at(1, 45), end: at(3, 0)),
            SleepSegment(stage: .rem, start: at(3, 0), end: at(3, 50)),
            SleepSegment(stage: .awake, start: at(3, 50), end: at(4, 5)),
            SleepSegment(stage: .core, start: at(4, 5), end: at(5, 30)),
            SleepSegment(stage: .rem, start: at(5, 30), end: at(6, 42)),
        ], in: night)

        return DailySummary(
            date: date,
            steps: 8_432,
            activeEnergy: 512,
            heartRate: HeartRateStats(average: 74, min: 52, max: 158),
            restingHeartRate: Reading(value: 56, date: at(7, 10)),
            hrv: 48,
            sleep: sleep,
            workouts: [
                WorkoutSummary(id: UUID(), name: "Artes marciais", symbolName: "figure.martial.arts",
                               start: at(19), duration: 5_400, activeEnergy: 640),
                WorkoutSummary(id: UUID(), name: "Corrida", symbolName: "figure.run",
                               start: at(6, 50), duration: 2_280, activeEnergy: 318),
            ]
        )
    }
}
