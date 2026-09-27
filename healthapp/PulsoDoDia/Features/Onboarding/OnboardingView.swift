import SwiftUI

/// Tela inicial: explica quais dados serão lidos e por quê, antes de pedir a permissão.
struct OnboardingView: View {
    let service: HealthService
    let onConnected: () -> Void

    @State private var isRequesting = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                metricsList
                privacyBox
                Text("Este app não é um dispositivo médico e não substitui orientação profissional.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 24)
            .padding(.top, 32)
            .padding(.bottom, 16)
        }
        .background(Color(.systemGroupedBackground))
        .safeAreaInset(edge: .bottom) { connectBar }
        .alert("Não foi possível conectar", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "heart.text.square.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            Text("Seu dia em uma tela")
                .font(.largeTitle.bold())
            Text("O Pulso do Dia lê algumas informações do Apple Saúde para mostrar como estão seu movimento, seu coração e seu sono hoje.")
                .font(.body)
                .foregroundStyle(.secondary)
        }
    }

    private var metricsList: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Informações que vamos ler")
                .font(.headline)
            ForEach(HealthMetric.allCases) { metric in
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: metric.symbol)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(metric.color.gradient, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(metric.title).font(.subheadline.weight(.semibold))
                        Text(metric.reason).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var privacyBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Seus dados ficam no seu iPhone", systemImage: "lock.shield.fill")
                .font(.subheadline.weight(.semibold))
            Text("Somente leitura: o app não grava nada no Apple Saúde, não envia dados para servidores e não usa seus dados para publicidade. Você pode revogar o acesso quando quiser no app Saúde.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Link("Política de privacidade", destination: AppConfig.privacyPolicyURL)
                .font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var connectBar: some View {
        Button {
            Task { await connect() }
        } label: {
            HStack(spacing: 8) {
                if isRequesting {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "heart.fill")
                }
                Text("Conectar Apple Saúde")
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(isRequesting)
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(.bar)
    }

    private func connect() async {
        isRequesting = true
        defer { isRequesting = false }
        do {
            try await service.requestAuthorization()
            // O iOS não informa o que foi permitido; seguimos para a dashboard em qualquer caso.
            onConnected()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    OnboardingView(service: MockHealthService()) {}
}
