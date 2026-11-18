import NotesKit
import SwiftUI

@main
struct NotesApp: App {
    @AppStorage("server") private var server = ""

    var body: some Scene {
        WindowGroup {
            if let base = URL(string: server), base.scheme != nil, base.host() != nil {
                Connected(base: base).id(base)
            } else {
                ServerSettings(server: $server)
            }
        }
    }
}

/// The notes of one server, each kept apart on this iPad so changing server never sends one's notes to another.
private struct Connected: View {
    let base: URL
    @State private var model: NotesModel?
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if let model {
                NotesView(model: model)
            } else {
                ProgressView()
            }
        }
        .task {
            let directory = URL.applicationSupportDirectory.appending(path: "notes/\(base.host() ?? "server")")
            let engine = await SyncEngine.open(api: HTTPNotesAPI(base: base), store: FileNotesStore(directory: directory))
            let model = NotesModel(engine: engine, snapshot: await engine.snapshot(), renderer: renderPNG)
            self.model = model
            while !Task.isCancelled {
                await model.sync()
                try? await Task.sleep(for: .seconds(20))
            }
        }
        .onChange(of: phase) { _, phase in
            guard let model else { return }
            Task {
                if phase == .active { await model.sync() } else { await model.save() }
            }
        }
    }
}

struct ServerSettings: View {
    @Binding var server: String
    @State private var draft = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://nas.example.ts.net", text: $draft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                } header: {
                    Text("Server")
                } footer: {
                    Text("The address of the apps server on your tailnet. Tailscale must be connected on this iPad.")
                }
            }
            .navigationTitle("Notes")
            .toolbar {
                Button("Connect") {
                    server = draft.trimmingCharacters(in: .whitespaces)
                    dismiss()
                }
                .disabled(URL(string: draft)?.host() == nil)
            }
            .onAppear { draft = server }
        }
    }
}
