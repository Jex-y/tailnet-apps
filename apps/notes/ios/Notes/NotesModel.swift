import Foundation
import NotesKit
import Observation

/// How the last attempt to reach the server went.
enum Connection: Equatable {
    case idle
    case syncing
    case offline(String)
}

/**
 The notes as the screen shows them. Changes show at once and are handed to the engine a moment later, so a burst of
 typing is saved and queued once, not per key; anything pulled from the server is shown with those changes still on
 top until the engine has them.
 */
@MainActor @Observable
final class NotesModel {
    private let engine: SyncEngine
    private let renderer: (ImageDue) -> Data?

    private(set) var snapshot: NotesSnapshot
    private(set) var openPage: UUID?
    private(set) var page: PageState = .empty
    private(set) var connection: Connection = .idle
    /// The block last added here, for the page to put the cursor in.
    private(set) var inserted: UUID?

    private var unsaved: [Mutation] = []
    private var saving: Task<Void, Never>?
    private var flushing: Task<Void, Never>?

    init(engine: SyncEngine, snapshot: NotesSnapshot, renderer: @escaping (ImageDue) -> Data?) {
        self.engine = engine
        self.snapshot = snapshot
        self.renderer = renderer
    }

    var notebooks: [Notebook] { snapshot.index.orderedNotebooks }

    func pages(in notebook: UUID) -> [PageMeta] { snapshot.index.pages(in: notebook) }

    var openMeta: PageMeta? { openPage.flatMap { snapshot.index.pages[$0] } }

    func open(_ id: UUID?) async {
        await save()
        openPage = id
        guard let id else { return }
        page = await engine.page(id)
        await sync()
    }

    // MARK: Changes

    func perform(_ mutations: [Mutation]) {
        guard !mutations.isEmpty else { return }
        for mutation in mutations {
            if mutation.page == openPage {
                page = page.applying(mutation)
            }
        }
        unsaved += mutations
        snapshot = snapshot.laying(mutations)
        if mutations.contains(where: { if case .deletePage = $0 { true } else { false } }),
           let openPage, snapshot.index.pages[openPage] == nil
        {
            self.openPage = nil
            page = .empty
        }
        saving?.cancel()
        saving = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await save()
            scheduleFlush()
        }
    }

    /// Hands everything changed on screen to the engine, which saves it before anything else happens.
    func save() async {
        let batch = unsaved
        unsaved = []
        guard !batch.isEmpty else { return }
        do {
            try await engine.perform(batch)
        } catch {
            connection = .offline("Could not save on this iPad: \(error.localizedDescription)")
        }
    }

    private func scheduleFlush() {
        flushing?.cancel()
        flushing = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    func newNotebook(title: String) {
        perform([.putNotebook(Notebook(title: title, position: (notebooks.map(\.position).max() ?? -1) + 1))])
    }

    func rename(_ notebook: Notebook, to title: String) {
        var renamed = notebook
        renamed.title = title
        perform([.putNotebook(renamed)])
    }

    @discardableResult
    func newPage(in notebook: UUID) -> PageMeta {
        let page = PageMeta(
            notebookId: notebook,
            title: "Untitled",
            position: (pages(in: notebook).map(\.position).max() ?? -1) + 1
        )
        perform([.putPage(page)])
        return page
    }

    func rename(_ page: PageMeta, to title: String) {
        var renamed = page
        renamed.title = title
        perform([.putPage(renamed)])
    }

    func delete(page: UUID) { perform([.deletePage(page)]) }
    func delete(notebook: UUID) { perform([.deleteNotebook(notebook)]) }

    // MARK: Blocks of the open page

    func insert(_ content: BlockContent, after block: UUID?) {
        guard let openPage, let order = try? block.map(page.order(after:)) ?? page.orderAtEnd() else { return }
        let block = Block(order: order, content: content)
        perform([.putBlock(page: openPage, block)])
        inserted = block.id
    }

    func update(_ block: UUID, to content: BlockContent) {
        guard let openPage, var changed = page.blocks[block], changed.content != content else { return }
        changed.content = content
        perform([.putBlock(page: openPage, changed)])
    }

    func delete(block: UUID) {
        guard let openPage else { return }
        perform([.deleteBlock(page: openPage, id: block)])
    }

    enum Direction { case up, down }

    func move(_ block: UUID, _ direction: Direction) {
        let blocks = page.ordered
        guard let openPage, let index = blocks.firstIndex(where: { $0.id == block }) else { return }
        let order: String?
        switch direction {
        case .up where index > 0:
            order = try? page.order(after: index > 1 ? blocks[index - 2].id : nil)
        case .down where index < blocks.count - 1:
            order = try? page.order(after: blocks[index + 1].id)
        default:
            order = nil
        }
        guard let order else { return }
        var moved = blocks[index]
        moved.order = order
        perform([.putBlock(page: openPage, moved)])
    }

    func ink(_ block: UUID, _ diff: InkDiff) {
        guard let openPage, !diff.isEmpty else { return }
        perform(
            diff.drawn.map { .addStroke(page: openPage, block: block, $0) }
                + (diff.erased.isEmpty ? [] : [.eraseStrokes(page: openPage, block: block, ids: diff.erased)])
        )
    }

    // MARK: Server

    /// Sends what is unsent, then takes what changed on the server, then uploads renderings of handwriting it lacks.
    func sync() async {
        guard connection != .syncing else { return }
        connection = .syncing
        await save()
        do {
            if case let .offline(reason) = try await engine.flush() {
                connection = .offline(reason)
                snapshot = await engine.snapshot().laying(unsaved)
                return
            }
            try await engine.refreshIndex()
            if let id = openPage {
                let pulled = try await engine.pull(id)
                if openPage == id {
                    page = unsaved.filter { $0.page == id }.reduce(pulled) { $0.applying($1) }
                }
                for due in await engine.imagesDue(on: id) {
                    if let png = renderer(due) {
                        try await engine.upload(png: png, of: due, on: id)
                    }
                }
            }
            connection = .idle
        } catch let error as APIError {
            connection = .offline(String(describing: error))
        } catch {
            connection = .offline(error.localizedDescription)
        }
        snapshot = await engine.snapshot().laying(unsaved)
        if let id = openPage, snapshot.index.pages[id] == nil {
            openPage = nil
            page = .empty
        }
    }

    func dismissRefusal() {
        Task {
            await engine.dismissRefusal()
            snapshot = await engine.snapshot().laying(unsaved)
        }
    }
}
