import Foundation

enum SleepStage: CaseIterable, Sendable {
    case deep, rem, core, awake, unspecified

    var title: String {
        switch self {
        case .deep: "Profundo"
        case .rem: "REM"
        case .core: "Essencial"
        case .awake: "Acordado"
        case .unspecified: "Dormindo"
        }
    }

    /// Quando fontes diferentes se sobrepõem (ex.: Apple Watch e iPhone), vence o estágio
    /// mais específico. `awake` fica acima de `unspecified` porque o registro por fases do
    /// relógio é mais preciso que o "dormindo" genérico de outras fontes.
    var priority: Int {
        switch self {
        case .deep: 5
        case .rem: 4
        case .core: 3
        case .awake: 2
        case .unspecified: 1
        }
    }

    var isAsleep: Bool { self != .awake }
}

struct SleepSegment: Equatable, Sendable {
    let stage: SleepStage
    let start: Date
    let end: Date
}

struct SleepSummary: Equatable, Sendable {
    private(set) var durations: [SleepStage: TimeInterval] = [:]
    private(set) var bedtime: Date?
    private(set) var wakeTime: Date?

    var asleep: TimeInterval {
        durations.filter { $0.key.isAsleep }.values.reduce(0, +)
    }

    func duration(of stage: SleepStage) -> TimeInterval {
        durations[stage] ?? 0
    }

    /// Janela da "última noite": das 18h de ontem até o meio dia de hoje (ou agora, se antes).
    static func nightWindow(for date: Date, calendar: Calendar = .current) -> DateInterval {
        let startOfDay = calendar.startOfDay(for: date)
        let start = calendar.date(byAdding: .hour, value: -6, to: startOfDay)!
        let noon = calendar.date(byAdding: .hour, value: 12, to: startOfDay)!
        return DateInterval(start: start, end: max(start, min(noon, date)))
    }

    /// Consolida segmentos de várias fontes sem contar o mesmo minuto duas vezes.
    /// Divide a noite nos pontos de corte de todos os segmentos e, em cada trecho,
    /// fica com o estágio de maior prioridade. Retorna `nil` se não houver sono.
    static func aggregate(_ segments: [SleepSegment], in window: DateInterval) -> SleepSummary? {
        let clipped = segments.compactMap { segment -> SleepSegment? in
            let start = max(segment.start, window.start)
            let end = min(segment.end, window.end)
            return end > start ? SleepSegment(stage: segment.stage, start: start, end: end) : nil
        }
        let bounds = Set(clipped.flatMap { [$0.start, $0.end] }).sorted()

        var summary = SleepSummary()
        for (from, to) in zip(bounds, bounds.dropFirst()) {
            guard let stage = clipped
                .filter({ $0.start <= from && $0.end >= to })
                .map(\.stage)
                .max(by: { $0.priority < $1.priority })
            else { continue }

            summary.durations[stage, default: 0] += to.timeIntervalSince(from)
            if stage.isAsleep {
                summary.bedtime = summary.bedtime ?? from
                summary.wakeTime = to
            }
        }
        return summary.asleep > 0 ? summary : nil
    }
}
