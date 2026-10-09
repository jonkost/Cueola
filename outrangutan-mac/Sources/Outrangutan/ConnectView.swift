import SwiftUI

extension Notification.Name {
    /// Opens "Connect to a show" (File menu, Command-K).
    static let showCheck = Notification.Name("outrangutan.showCheck")
    static let goToCue = Notification.Name("outrangutan.goToCue")
    static let showConnect = Notification.Name("OutrangutanShowConnect")
    /// Shows or hides the Inspector (View menu, Command-I).
    static let toggleInspector = Notification.Name("OutrangutanToggleInspector")
}

/// "Connect to a show": sign in like the web front door, then type the
/// show code. The username and code are remembered; the PIN or password
/// never is.
struct ConnectView: View {
    @ObservedObject var link: ShowLink
    @Environment(\.dismiss) private var dismiss

    @AppStorage("connect.username") private var username = ""
    @AppStorage("connect.code") private var code = ""
    @AppStorage("connect.instructor") private var instructor = false
    @State private var secret = ""
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Connect to a show").font(.title2.bold())
            Text("The director's TAKE and the KeyWi Bird playback keys reach this Mac through the show. Playback keeps going if the internet drops.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Picker("", selection: $instructor) {
                Text("Student").tag(false)
                Text("Instructor").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Form {
                TextField("Username", text: $username)
                SecureField(instructor ? "Password" : "4 digit PIN", text: $secret)
                TextField("Show code", text: $code)
            }
            .textFieldStyle(.roundedBorder)

            if link.phase == .trouble {
                Label(link.message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                if link.phase == .linked || link.phase == .connecting {
                    Button("Disconnect") { link.leave(); dismiss() }
                }
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(working ? "Connecting" : "Connect") {
                    working = true
                    Task {
                        await link.connect(username: username, secret: secret, instructor: instructor, code: code)
                        working = false
                        secret = ""
                        if link.phase != .trouble { dismiss() }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(ActionStyle(prominent: true))
                .disabled(working || username.isEmpty || code.isEmpty || (secret.isEmpty && !link.cloud.isSignedIn))
            }
            .buttonWidth(110)
        }
        .padding(20)
        .frame(width: 420)
        .buttonStyle(ActionStyle())
    }
}

