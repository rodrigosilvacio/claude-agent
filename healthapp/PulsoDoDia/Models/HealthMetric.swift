import SwiftUI

/// Os dados lidos do Apple Saúde, com o texto que explica ao usuário por que cada um é usado.
enum HealthMetric: CaseIterable, Identifiable {
    case steps, heartRate, restingHeartRate, hrv, sleep, activeEnergy, workouts

    var id: Self { self }

    var title: String {
        switch self {
        case .steps: "Passos"
        case .heartRate: "Frequência cardíaca"
        case .restingHeartRate: "FC em repouso"
        case .hrv: "HRV"
        case .sleep: "Sono"
        case .activeEnergy: "Calorias ativas"
        case .workouts: "Treinos"
        }
    }

    var reason: String {
        switch self {
        case .steps: "Medir seu nível de movimento no dia."
        case .heartRate: "Mostrar a média, a mínima e a máxima do dia."
        case .restingHeartRate: "Indicador de recuperação e condicionamento."
        case .hrv: "Variabilidade da frequência cardíaca, sinal de estresse e recuperação."
        case .sleep: "Quanto você dormiu na última noite, por fase."
        case .activeEnergy: "Energia gasta com atividade física."
        case .workouts: "Quais atividades você fez hoje, duração e calorias."
        }
    }

    var emptyHint: String {
        switch self {
        case .heartRate, .restingHeartRate, .hrv: "Registrado pelo Apple Watch."
        case .sleep: "Use o Apple Watch ou ative o Sono no app Saúde."
        default: "Nenhum registro ainda."
        }
    }

    var symbol: String {
        switch self {
        case .steps: "figure.walk"
        case .heartRate: "heart.fill"
        case .restingHeartRate: "bed.double.fill"
        case .hrv: "waveform.path.ecg"
        case .sleep: "moon.zzz.fill"
        case .activeEnergy: "flame.fill"
        case .workouts: "figure.run"
        }
    }

    var color: Color {
        switch self {
        case .steps: .orange
        case .heartRate: .red
        case .restingHeartRate: .pink
        case .hrv: .teal
        case .sleep: .indigo
        case .activeEnergy: Color(red: 1, green: 0.22, blue: 0.37)
        case .workouts: .green
        }
    }
}

extension SleepStage {
    var color: Color {
        switch self {
        case .deep: Color(red: 0.23, green: 0.20, blue: 0.62)
        case .rem: Color(red: 0.36, green: 0.67, blue: 0.98)
        case .core: Color(red: 0.24, green: 0.45, blue: 0.93)
        case .awake: Color(red: 1.0, green: 0.52, blue: 0.40)
        case .unspecified: .indigo
        }
    }
}
