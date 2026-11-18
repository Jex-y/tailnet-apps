import Foundation

/// What this device keeps between launches: the index, the outbox, and each page it has opened.
public protocol NotesStore: Sendable {
    func loadIndex() async -> NotesIndex
    func saveIndex(_ index: NotesIndex) async throws
    func loadOutbox() async -> Outbox
    func saveOutbox(_ outbox: Outbox) async throws
    func loadPage(_ id: UUID) async -> PageState?
    func savePage(_ id: UUID, _ page: PageState) async throws
    func deletePage(_ id: UUID) async throws
}

/// JSON files in one directory, each written whole and atomically, so a crash leaves the last one written.
public actor FileNotesStore: NotesStore {
    private let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    private func file(_ name: String) -> URL { directory.appending(path: name) }

    private func read<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        guard let data = try? Data(contentsOf: file(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private func write(_ value: some Encodable, to name: String) throws {
        let url = file(name)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
    }

    public func loadIndex() -> NotesIndex { read("index.json", as: NotesIndex.self) ?? .empty }
    public func saveIndex(_ index: NotesIndex) throws { try write(index, to: "index.json") }
    public func loadOutbox() -> Outbox { read("outbox.json", as: Outbox.self) ?? .empty }
    public func saveOutbox(_ outbox: Outbox) throws { try write(outbox, to: "outbox.json") }
    public func loadPage(_ id: UUID) -> PageState? { read("pages/\(id.wire).json", as: PageState.self) }
    public func savePage(_ id: UUID, _ page: PageState) throws { try write(page, to: "pages/\(id.wire).json") }

    public func deletePage(_ id: UUID) throws {
        let url = file("pages/\(id.wire).json")
        if FileManager.default.fileExists(atPath: url.path()) {
            try FileManager.default.removeItem(at: url)
        }
    }
}
