import Foundation
import HealthKit

final class HealthKitService: HealthService, @unchecked Sendable {
    private let store = HKHealthStore()
    private let calendar = Calendar.current

    /// Somente leitura: o app nunca grava no Apple Saúde.
    static let readTypes: Set<HKObjectType> = [
        HKQuantityType(.stepCount),
        HKQuantityType(.heartRate),
        HKQuantityType(.restingHeartRate),
        HKQuantityType(.heartRateVariabilitySDNN),
        HKQuantityType(.activeEnergyBurned),
        HKCategoryType(.sleepAnalysis),
        HKObjectType.workoutType(),
    ]

    private static let bpm = HKUnit.count().unitDivided(by: .minute())

    // MARK: Autorização

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw HealthError.unavailable }
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    func hasRequestedAuthorization() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        let status = try? await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes)
        return status == .unnecessary
    }

    // MARK: Resumo do dia

    func fetchSummary(for date: Date) async -> DailySummary {
        let startOfDay = calendar.startOfDay(for: date)
        let today = DateInterval(start: startOfDay, end: max(startOfDay, min(date, .now)))

        // As consultas rodam em paralelo; uma falha não derruba as outras.
        async let steps = sum(.stepCount, unit: .count(), in: today)
        async let energy = sum(.activeEnergyBurned, unit: .kilocalorie(), in: today)
        async let heartRate = heartRateStats(in: today)
        async let resting = latestReading(.restingHeartRate, unit: Self.bpm, since: startOfDay.addingTimeInterval(-86_400))
        async let hrv = average(.heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), in: today)
        async let sleep = sleepSummary(for: date)
        async let workouts = workouts(in: today)

        return DailySummary(
            date: date,
            steps: await steps,
            activeEnergy: await energy,
            heartRate: await heartRate,
            restingHeartRate: await resting,
            hrv: await hrv,
            sleep: await sleep,
            workouts: await workouts
        )
    }

    // MARK: Consultas

    private func statistics(
        _ identifier: HKQuantityTypeIdentifier,
        options: HKStatisticsOptions,
        in interval: DateInterval
    ) async -> HKStatistics? {
        let predicate = HKQuery.predicateForSamples(withStart: interval.start, end: interval.end, options: .strictStartDate)
        let descriptor = HKStatisticsQueryDescriptor(
            predicate: .quantitySample(type: HKQuantityType(identifier), predicate: predicate),
            options: options
        )
        do {
            return try await descriptor.result(for: store)
        } catch {
            return nil // sem dados ou sem permissão: o iOS não diferencia
        }
    }

    /// Soma do dia com deduplicação automática entre iPhone e Apple Watch.
    private func sum(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, in interval: DateInterval) async -> Double? {
        await statistics(identifier, options: .cumulativeSum, in: interval)?
            .sumQuantity()?
            .doubleValue(for: unit)
    }

    private func average(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, in interval: DateInterval) async -> Double? {
        await statistics(identifier, options: .discreteAverage, in: interval)?
            .averageQuantity()?
            .doubleValue(for: unit)
    }

    private func heartRateStats(in interval: DateInterval) async -> HeartRateStats? {
        let stats = await statistics(.heartRate, options: [.discreteAverage, .discreteMin, .discreteMax], in: interval)
        guard
            let average = stats?.averageQuantity()?.doubleValue(for: Self.bpm),
            let min = stats?.minimumQuantity()?.doubleValue(for: Self.bpm),
            let max = stats?.maximumQuantity()?.doubleValue(for: Self.bpm)
        else { return nil }
        return HeartRateStats(average: average, min: min, max: max)
    }

    /// A FC em repouso é calculada pelo Watch uma vez ao dia, às vezes só à tarde.
    /// Por isso buscamos a leitura mais recente das últimas 24h a 48h.
    private func latestReading(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, since start: Date) async -> Reading? {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: .now)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.quantitySample(type: HKQuantityType(identifier), predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)],
            limit: 1
        )
        guard let sample = try? await descriptor.result(for: store).first else { return nil }
        return Reading(value: sample.quantity.doubleValue(for: unit), date: sample.endDate)
    }

    private func sleepSummary(for date: Date) async -> SleepSummary? {
        let window = SleepSummary.nightWindow(for: date, calendar: calendar)
        // Sem opções: traz também amostras que começaram antes da janela e a cruzam.
        let predicate = HKQuery.predicateForSamples(withStart: window.start, end: window.end)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        guard let samples = try? await descriptor.result(for: store) else { return nil }

        let segments = samples.compactMap { sample -> SleepSegment? in
            guard
                let value = HKCategoryValueSleepAnalysis(rawValue: sample.value),
                let stage = SleepStage(value)
            else { return nil }
            return SleepSegment(stage: stage, start: sample.startDate, end: sample.endDate)
        }
        return SleepSummary.aggregate(segments, in: window)
    }

    private func workouts(in interval: DateInterval) async -> [WorkoutSummary] {
        let predicate = HKQuery.predicateForSamples(withStart: interval.start, end: interval.end)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(predicate)],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)]
        )
        guard let workouts = try? await descriptor.result(for: store) else { return [] }

        return workouts.map { workout in
            let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?
                .sumQuantity()?
                .doubleValue(for: .kilocalorie())
            return WorkoutSummary(
                id: workout.uuid,
                name: workout.workoutActivityType.displayName,
                symbolName: workout.workoutActivityType.symbolName,
                start: workout.startDate,
                duration: workout.duration,
                activeEnergy: energy
            )
        }
    }
}

private extension SleepStage {
    /// `inBed` fica de fora: estar na cama não é dormir.
    init?(_ value: HKCategoryValueSleepAnalysis) {
        switch value {
        case .asleepDeep: self = .deep
        case .asleepREM: self = .rem
        case .asleepCore: self = .core
        case .asleepUnspecified: self = .unspecified
        case .awake: self = .awake
        case .inBed: return nil
        @unknown default: return nil
        }
    }
}
