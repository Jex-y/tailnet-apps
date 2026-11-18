import Foundation

/// What the app shows about the notes as a whole.
public struct NotesSnapshot: Hashable, Sendable {
    public let index: NotesIndex
    /// Changes made here the server has yet to take.
    public let unsent: Int
    /// Why the server last refused a batch, which was then dropped and the pages it touched reloaded.
    public let refusal: String?

    /// The snapshot with changes made on screen and not yet handed to the engine laid on top.
    public func laying(_ unsaved: [Mutation]) -> NotesSnapshot {
        NotesSnapshot(index: unsaved.reduce(index) { $0.applying($1) }, unsent: unsent + unsaved.count, refusal: refusal)
    }
}

/// How far a flush got.
public enum FlushOutcome: Hashable, Sendable {
    case sent
    /// The server could not be reached; everything unsent is kept for the next attempt.
    case offline(String)
}

/**
 Keeps this device's notes and the server's in step. Every change is applied here at once, saved, and queued; a
 flush sends the queue in batches; a pull takes what changed on the server since the page's last pull, except what
 this device has changed and not yet had taken. Nothing local is lost while offline: the outbox is saved before
 every send, and a batch is resent under its key until answered.
 */
public actor SyncEngine {
    private let api: any NotesAPI
    private let store: any NotesStore
    private var index: NotesIndex
    private var outbox: Outbox
    private var pages: [UUID: PageState] = [:]
    private var refusal: String?

    private init(api: any NotesAPI, store: any NotesStore, index: NotesIndex, outbox: Outbox) {
        self.api = api
        self.store = store
        self.index = index
        self.outbox = outbox
    }

    public static func open(api: any NotesAPI, store: any NotesStore) async -> SyncEngine {
        SyncEngine(api: api, store: store, index: await store.loadIndex(), outbox: await store.loadOutbox())
    }

    public func snapshot() -> NotesSnapshot {
        NotesSnapshot(index: index, unsent: outbox.pending.count, refusal: refusal)
    }

    public func page(_ id: UUID) async -> PageState {
        if let page = pages[id] {
            return page
        }
        let page = await store.loadPage(id) ?? .empty
        pages[id] = page
        return page
    }

    /// Applies changes here at once and queues them for the server.
    public func perform(_ mutations: [Mutation]) async throws {
        for mutation in mutations {
            index = index.applying(mutation)
            if case let .deletePage(id) = mutation {
                pages[id] = nil
                try await store.deletePage(id)
            }
            if let id = mutation.page {
                pages[id] = await page(id).applying(mutation)
            }
            outbox = outbox.queuing(mutation)
        }
        try await store.saveIndex(index)
        try await store.saveOutbox(outbox)
        for id in Set(mutations.compactMap(\.page)) {
            if let page = pages[id] {
                try await store.savePage(id, page)
            }
        }
    }

    /// Sends everything unsent, batch by batch, until done or the server cannot be reached.
    public func flush() async throws -> FlushOutcome {
        while true {
            let sealed = outbox.sealing(key: { UUID().uuidString })
            guard let batch = sealed.batch else { return .sent }
            outbox = sealed.outbox
            try await store.saveOutbox(outbox)
            switch await answer(to: batch) {
            case nil:
                outbox = outbox.answered(batch.key)
                try await store.saveOutbox(outbox)
            case let .refused(status, reason):
                outbox = outbox.answered(batch.key)
                try await store.saveOutbox(outbox)
                refusal = "\(reason) (\(status))"
                try await reload(touchedBy: batch)
            case let .unavailable(reason):
                return .offline(reason)
            }
        }
    }

    /// Why the server did not take the batch; nil when it did.
    private func answer(to batch: Batch) async -> APIError? {
        do throws(APIError) {
            try await api.push(batch)
            return nil
        } catch {
            return error
        }
    }

    /// Rebuilds what a refused batch changed from the server, with whatever else is still unsent laid on top.
    private func reload(touchedBy batch: Batch) async throws {
        do {
            try await refreshIndex()
            for id in Set(batch.mutations.compactMap(\.page)) {
                guard index.pages[id] != nil else {
                    pages[id] = nil
                    try await store.deletePage(id)
                    continue
                }
                let mine = outbox.pending.filter { $0.page == id }
                let server = PageState.empty.applying(try await api.changes(page: id, since: 0), except: Pending(mine))
                let page = mine.reduce(server) { $0.applying($1) }
                pages[id] = page
                try await store.savePage(id, page)
            }
        } catch is APIError {
            return
        }
    }

    public func refreshIndex() async throws(APIError) {
        let notebooks = try await api.notebooks()
        let listed = try await api.pages()
        index = NotesIndex.listed(notebooks: notebooks, pages: listed, pending: outbox.pending)
        try? await store.saveIndex(index)
    }

    /// The page with what changed on the server since it was last pulled.
    @discardableResult
    public func pull(_ id: UUID) async throws(APIError) -> PageState {
        let current = await page(id)
        let changes = try await api.changes(page: id, since: current.seq)
        let page = current.applying(changes, except: Pending(outbox.pending))
        pages[id] = page
        try? await store.savePage(id, page)
        return page
    }

    /// Ink blocks on the page to render and upload, now the server holds their strokes as they are here.
    public func imagesDue(on id: UUID) async -> [ImageDue] {
        await page(id).imagesDue(except: Pending(outbox.pending))
    }

    public func upload(png: Data, of due: ImageDue, on id: UUID) async throws(APIError) {
        try await api.putImage(page: id, block: due.block, seq: due.seq, png: png)
        let page = await page(id).rendering(due)
        pages[id] = page
        try? await store.savePage(id, page)
    }

    public func dismissRefusal() {
        refusal = nil
    }
}
