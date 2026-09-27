import SwiftUI

struct SleepCard: View {
    let sleep: SleepSummary?

    /// Ordem da barra e da legenda. `unspecified` só aparece quando a fonte não registra fases.
    private let stages: [SleepStage] = [.deep, .core, .rem, .unspecified, .awake]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Sono da última noite", systemImage: HealthMetric.sleep.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(HealthMetric.sleep.color)

            if let sleep {
                HStack(alignment: .firstTextBaseline) {
                    Text(Format.duration(sleep.asleep))
                        .font(.title.bold())
                        .monospacedDigit()
                    Spacer()
                    if let bedtime = sleep.bedtime, let wake = sleep.wakeTime {
                        Text("\(Format.time(bedtime)) às \(Format.time(wake))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                stageBar(sleep)
                legend(sleep)
            } else {
                Text("Sem dados de sono")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(HealthMetric.sleep.emptyHint)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func visibleStages(_ sleep: SleepSummary) -> [SleepStage] {
        stages.filter { sleep.duration(of: $0) > 0 }
    }

    private func stageBar(_ sleep: SleepSummary) -> some View {
        let visible = visibleStages(sleep)
        let total = visible.map { sleep.duration(of: $0) }.reduce(0, +)
        return GeometryReader { proxy in
            HStack(spacing: 2) {
                ForEach(visible, id: \.self) { stage in
                    stage.color
                        .frame(width: max(2, (proxy.size.width - CGFloat(visible.count - 1) * 2) * sleep.duration(of: stage) / total))
                }
            }
        }
        .frame(height: 12)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }

    private func legend(_ sleep: SleepSummary) -> some View {
        HStack(spacing: 14) {
            ForEach(visibleStages(sleep), id: \.self) { stage in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Circle().fill(stage.color).frame(width: 8, height: 8)
                        Text(stage.title).font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(Format.duration(sleep.duration(of: stage)))
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                }
            }
        }
    }
}
