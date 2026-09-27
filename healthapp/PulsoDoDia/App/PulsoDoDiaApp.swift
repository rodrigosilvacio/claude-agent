import SwiftUI

@main
struct PulsoDoDiaApp: App {
    private let service: HealthService = ProcessInfo.processInfo.arguments.contains("-demo")
        ? MockHealthService()
        : HealthKitService()

    var body: some Scene {
        WindowGroup {
            RootView(service: service)
        }
    }
}

/// Primeira abertura: tela de boas vindas. Depois de conectar: dashboard direto.
struct RootView: View {
    let service: HealthService
    @AppStorage("didConnectHealth") private var didConnect = false

    var body: some View {
        Group {
            if didConnect {
                DashboardView(service: service)
            } else {
                OnboardingView(service: service) { didConnect = true }
            }
        }
        .task {
            // Reinstalação ou restauração de backup: a permissão já foi respondida antes.
            if !didConnect, await service.hasRequestedAuthorization() {
                didConnect = true
            }
        }
    }
}
