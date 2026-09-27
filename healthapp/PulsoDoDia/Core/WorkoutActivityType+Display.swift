import HealthKit

extension HKWorkoutActivityType {
    var displayName: String {
        switch self {
        case .running: "Corrida"
        case .walking: "Caminhada"
        case .cycling: "Ciclismo"
        case .swimming: "Natação"
        case .hiking: "Trilha"
        case .traditionalStrengthTraining: "Musculação"
        case .functionalStrengthTraining: "Treino funcional"
        case .highIntensityIntervalTraining: "HIIT"
        case .coreTraining: "Core"
        case .crossTraining: "Cross training"
        case .mixedCardio: "Cardio"
        case .elliptical: "Elíptico"
        case .rowing: "Remo"
        case .stairClimbing: "Escada"
        case .yoga: "Yoga"
        case .pilates: "Pilates"
        case .martialArts: "Artes marciais"
        case .boxing: "Boxe"
        case .soccer: "Futebol"
        case .tennis: "Tênis"
        case .socialDance, .cardioDance: "Dança"
        case .cooldown: "Desaquecimento"
        default: "Treino"
        }
    }

    var symbolName: String {
        switch self {
        case .running: "figure.run"
        case .walking: "figure.walk"
        case .cycling: "figure.outdoor.cycle"
        case .swimming: "figure.pool.swim"
        case .hiking: "figure.hiking"
        case .traditionalStrengthTraining: "figure.strengthtraining.traditional"
        case .functionalStrengthTraining: "figure.strengthtraining.functional"
        case .highIntensityIntervalTraining: "figure.highintensity.intervaltraining"
        case .coreTraining: "figure.core.training"
        case .crossTraining: "figure.cross.training"
        case .elliptical: "figure.elliptical"
        case .rowing: "figure.rower"
        case .stairClimbing: "figure.stairs"
        case .yoga: "figure.yoga"
        case .pilates: "figure.pilates"
        case .martialArts: "figure.martial.arts"
        case .boxing: "figure.boxing"
        case .soccer: "figure.soccer"
        case .tennis: "figure.tennis"
        case .socialDance, .cardioDance: "figure.dance"
        case .cooldown: "figure.cooldown"
        default: "figure.mixed.cardio"
        }
    }
}
