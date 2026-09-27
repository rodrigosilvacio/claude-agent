import Foundation

enum Format {
    /// 27000 s -> "7h 30min"; 2700 s -> "45min".
    static func duration(_ interval: TimeInterval) -> String {
        let totalMinutes = Int((interval / 60).rounded())
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours == 0 { return "\(minutes)min" }
        if minutes == 0 { return "\(hours)h" }
        return "\(hours)h \(minutes)min"
    }

    static func integer(_ value: Double) -> String {
        Int(value.rounded()).formatted(.number.locale(Locale(identifier: "pt_BR")))
    }

    static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }
}
