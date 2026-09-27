import Foundation

enum AppConfig {
    /// Página publicada a partir de `healthapp/privacidade.html`. Troque se hospedar em outro endereço.
    static let privacyPolicyURL = URL(string: "https://rodrigosilvacio.github.io/claude-agent/healthapp/privacidade.html")!

    /// Abre o app Saúde, onde o usuário revisa as permissões em Compartilhamento > Apps.
    static let healthAppURL = URL(string: "x-apple-health://")!

    static let dailyStepGoal: Double = 8_000
}
