import SwiftUI

struct WorkoutsSection: View {
    let workouts: [WorkoutSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Treinos de hoje", systemImage: HealthMetric.workouts.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(HealthMetric.workouts.color)

            if workouts.isEmpty {
                Text("Nenhum treino registrado hoje")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(workouts) { workout in
                    WorkoutRow(workout: workout)
                    if workout.id != workouts.last?.id {
                        Divider()
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct WorkoutRow: View {
    let workout: WorkoutSummary

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: workout.symbolName)
                .font(.title3)
                .foregroundStyle(HealthMetric.workouts.color)
                .frame(width: 40, height: 40)
                .background(HealthMetric.workouts.color.opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(workout.name).font(.subheadline.weight(.semibold))
                Text("\(Format.time(workout.start)) · \(Format.duration(workout.duration))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let energy = workout.activeEnergy {
                Text("\(Format.integer(energy)) kcal")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }
}
