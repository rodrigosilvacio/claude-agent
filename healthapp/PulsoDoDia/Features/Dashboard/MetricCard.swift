import SwiftUI

struct MetricCard: View {
    let metric: HealthMetric
    let value: String?
    var detail: String? = nil
    var progress: Double? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(metric.title, systemImage: metric.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(metric.color)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            Spacer(minLength: 0)

            if let value {
                Text(value)
                    .font(.title2.bold())
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let progress {
                    ProgressView(value: progress)
                        .tint(metric.color)
                }
            } else {
                Text("Sem dados hoje")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(metric.emptyHint)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 124, alignment: .topLeading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
