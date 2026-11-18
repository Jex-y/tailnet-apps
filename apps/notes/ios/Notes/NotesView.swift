import NotesKit
import SwiftUI

struct NotesView: View {
    let model: NotesModel
    @State private var selection: UUID?
    @State private var naming: Naming?
    @State private var showingSettings = false
    @AppStorage("server") private var server = ""

    /// What a name is being asked for.
    private enum Naming: Identifiable {
        case newNotebook
        case notebook(Notebook)

        var id: String {
            switch self {
            case .newNotebook: "new"
            case let .notebook(notebook): notebook.id.uuidString
            }
        }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(model.notebooks) { notebook in
                    Section {
                        ForEach(model.pages(in: notebook.id)) { page in
                            Text(page.title.isEmpty ? "Untitled" : page.title)
                                .tag(page.id)
                                .contextMenu {
                                    Button("Delete Page", systemImage: "trash", role: .destructive) {
                                        model.delete(page: page.id)
                                    }
                                }
                        }
                        Button("New Page", systemImage: "plus") {
                            selection = model.newPage(in: notebook.id).id
                        }
                    } header: {
                        Text(notebook.title)
                            .contextMenu {
                                Button("Rename", systemImage: "pencil") { naming = .notebook(notebook) }
                                Button("Delete Notebook", systemImage: "trash", role: .destructive) {
                                    model.delete(notebook: notebook.id)
                                }
                            }
                    }
                }
            }
            .navigationTitle("Notebooks")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("New Notebook", systemImage: "folder.badge.plus") { naming = .newNotebook }
                }
                ToolbarItem(placement: .bottomBar) { SyncStatus(model: model) }
                ToolbarItem(placement: .bottomBar) {
                    Button("Server", systemImage: "gear") { showingSettings = true }
                }
            }
        } detail: {
            if model.openMeta != nil {
                PageView(model: model)
            } else {
                ContentUnavailableView("No page open", systemImage: "square.and.pencil")
            }
        }
        .onChange(of: selection) { _, id in
            Task { await model.open(id) }
        }
        .onChange(of: model.openPage) { _, id in
            if id == nil { selection = nil }
        }
        .sheet(item: $naming) { naming in
            NameSheet(initial: { if case let .notebook(n) = naming { n.title } else { "" } }()) { title in
                switch naming {
                case .newNotebook: model.newNotebook(title: title)
                case let .notebook(notebook): model.rename(notebook, to: title)
                }
            }
        }
        .sheet(isPresented: $showingSettings) { ServerSettings(server: $server) }
        .alert(
            "The server refused a change",
            isPresented: Binding(get: { model.snapshot.refusal != nil }, set: { if !$0 { model.dismissRefusal() } }),
            actions: { Button("OK") { model.dismissRefusal() } },
            message: { Text("\(model.snapshot.refusal ?? ""). The page now shows what the server has.") }
        )
    }
}

private struct SyncStatus: View {
    let model: NotesModel

    var body: some View {
        label.fixedSize()
    }

    @ViewBuilder private var label: some View {
        switch model.connection {
        case .syncing:
            Label("Syncing", systemImage: "arrow.triangle.2.circlepath").labelStyle(.titleAndIcon).font(.caption)
        case let .offline(reason):
            Label("Offline · \(model.snapshot.unsent) unsent", systemImage: "icloud.slash")
                .labelStyle(.titleAndIcon).font(.caption).help(reason)
        case .idle:
            Label(model.snapshot.unsent == 0 ? "Saved" : "\(model.snapshot.unsent) unsent", systemImage: "checkmark.icloud")
                .labelStyle(.titleAndIcon).font(.caption)
        }
    }
}

private struct NameSheet: View {
    let initial: String
    let done: (String) -> Void
    @State private var title = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form { TextField("Name", text: $title).onSubmit(finish) }
                .navigationTitle(initial.isEmpty ? "New Notebook" : "Rename Notebook")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: finish).disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
        }
        .onAppear { title = initial }
        .presentationDetents([.medium])
    }

    private func finish() {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        done(trimmed)
        dismiss()
    }
}
