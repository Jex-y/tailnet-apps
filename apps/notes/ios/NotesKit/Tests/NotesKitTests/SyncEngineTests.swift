import Foundation
import Testing
@testable import NotesKit

private struct Upload: Equatable {
    let block: UUID
    let seq: Int
}

/// A server that takes or refuses pushes as told, and answers pulls with whatever it was given.
private actor FakeServer: NotesAPI {
    var pushed: [Batch] = []
    var answer: APIError?
    var listed: (notebooks: [Notebook], pages: [PageSummary]) = ([], [])
    var changesByPage: [UUID: PageChanges] = [:]
    var images: [Upload] = []

    func failing(with error: APIError?) { answer = error }
    func serving(_ changes: PageChanges, for page: UUID) { changesByPage[page] = changes }

    func notebooks() async throws(APIError) -> [Notebook] { listed.notebooks }
    func pages() async throws(APIError) -> [PageSummary] { listed.pages }

    func changes(page: UUID, since: Int) async throws(APIError) -> PageChanges {
        changesByPage[page] ?? PageChanges(seq: since, blocks: [], strokes: [])
    }

    func push(_ batch: Batch) async throws(APIError) {
        pushed.append(batch)
        if let answer { throw answer }
    }

    func putImage(page: UUID, block: UUID, seq: Int, png: Data) async throws(APIError) {
        images.append(Upload(block: block, seq: seq))
    }
}

private actor MemoryStore: NotesStore {
    var index = NotesIndex.empty
    var outbox = Outbox.empty
    var pages: [UUID: PageState] = [:]

    func loadIndex() -> NotesIndex { index }
    func saveIndex(_ index: NotesIndex) { self.index = index }
    func loadOutbox() -> Outbox { outbox }
    func saveOutbox(_ outbox: Outbox) { self.outbox = outbox }
    func loadPage(_ id: UUID) -> PageState? { pages[id] }
    func savePage(_ id: UUID, _ page: PageState) { pages[id] = page }
    func deletePage(_ id: UUID) { pages[id] = nil }
}

private struct Fixture {
    let server = FakeServer()
    let store = MemoryStore()
    let notebook = Notebook(title: "Analysis", position: 0)
    let page: PageMeta

    init() {
        page = PageMeta(notebookId: notebook.id, title: "Week 1", position: 0)
    }

    func engine() async -> SyncEngine { await SyncEngine.open(api: server, store: store) }
}

@Test func keepsChangesMadeOfflineAndSendsThemUnderOneKeyUntilTaken() async throws {
    let fixture = Fixture()
    let engine = await fixture.engine()
    await fixture.server.failing(with: .unavailable("no network"))

    try await engine.perform([.putNotebook(fixture.notebook), .putPage(fixture.page)])
    #expect(try await engine.flush() == .offline("no network"))
    #expect(try await engine.flush() == .offline("no network"))
    #expect(await engine.snapshot().unsent == 2)

    await fixture.server.failing(with: nil)
    #expect(try await engine.flush() == .sent)

    let keys = await fixture.server.pushed.map(\.key)
    #expect(keys.count == 3 && Set(keys).count == 1)
    #expect(await engine.snapshot().unsent == 0)
}

@Test func survivesARelaunchWithNothingSent() async throws {
    let fixture = Fixture()
    let block = Block(order: "a0", content: .paragraph("Let $x$ be real."))
    try await fixture.engine().perform([.putNotebook(fixture.notebook), .putPage(fixture.page), .putBlock(page: fixture.page.id, block)])

    let relaunched = await fixture.engine()

    #expect(await relaunched.snapshot().unsent == 3)
    #expect(await relaunched.snapshot().index.pages(in: fixture.notebook.id) == [fixture.page])
    #expect(await relaunched.page(fixture.page.id).ordered == [block])
}

@Test func dropsARefusedBatchAndReloadsThePageItTouched() async throws {
    let fixture = Fixture()
    let engine = await fixture.engine()
    let server = Block(order: "a0", content: .paragraph("on the server"))
    await fixture.server.serving(PageChanges(seq: 1, blocks: [.block(server)], strokes: []), for: fixture.page.id)
    await fixture.server.failing(with: .refused(status: 409, reason: "That page no longer exists"))

    try await engine.perform([.putBlock(page: fixture.page.id, Block(order: "a1", content: .paragraph("refused")))])
    #expect(try await engine.flush() == .sent)

    #expect(await engine.snapshot().refusal == "That page no longer exists (409)")
    #expect(await engine.snapshot().unsent == 0)
    #expect(await engine.page(fixture.page.id) == .empty)
}

@Test func rebuildsARefusedPageFromTheServer() async throws {
    let fixture = Fixture()
    let engine = await fixture.engine()
    let server = Block(order: "a0", content: .paragraph("on the server"))
    try await fixture.server.listing(notebooks: [fixture.notebook], pages: [summary(of: fixture.page, seq: 1)])
    await fixture.server.serving(PageChanges(seq: 1, blocks: [.block(server)], strokes: []), for: fixture.page.id)
    await fixture.server.failing(with: .refused(status: 400, reason: "language must be one of ts, js"))

    try await engine.perform([.putBlock(page: fixture.page.id, Block(order: "a1", content: .paragraph("refused")))])
    #expect(try await engine.flush() == .sent)

    #expect(await engine.page(fixture.page.id).ordered == [server])
}

private func summary(of page: PageMeta, seq: Int) throws -> PageSummary {
    try JSONDecoder().decode(PageSummary.self, from: Data(#"""
    {"id":"\#(page.id.wire)","notebookId":"\#(page.notebookId.wire)","title":"\#(page.title)","position":\#(page.position),"seq":\#(seq),"updatedAt":"2026-10-20T10:00:00.000Z"}
    """#.utf8))
}

@Test func layersUnsentChangesOverTheServersListing() async throws {
    let fixture = Fixture()
    let engine = await fixture.engine()
    let renamed = PageMeta(id: fixture.page.id, notebookId: fixture.notebook.id, title: "Renamed here", position: 0)
    await fixture.server.failing(with: .unavailable("offline"))
    try await engine.perform([.putPage(renamed)])
    _ = try await engine.flush()

    try await fixture.server.listing(
        notebooks: [fixture.notebook],
        pages: [summary(of: fixture.page, seq: 5)]
    )
    try await engine.refreshIndex()

    #expect(await engine.snapshot().index.pages(in: fixture.notebook.id) == [renamed])
}

@Test func uploadsARenderingOnceThePulledStrokesAreAllThereIs() async throws {
    let fixture = Fixture()
    let engine = await fixture.engine()
    let ink = Block(order: "a0", content: .ink(height: 300))
    let drawn = Stroke(tool: .pen, color: "#000000", width: 2, points: [InkPoint(x: 1, y: 1, t: 0, pressure: 0.5, azimuth: 0, altitude: 1)])
    await fixture.server.serving(PageChanges(seq: 2, blocks: [.block(ink)], strokes: [.stroke(block: ink.id, drawn)]), for: fixture.page.id)

    try await engine.pull(fixture.page.id)
    let due = await engine.imagesDue(on: fixture.page.id)
    for image in due {
        try await engine.upload(png: Data([0x89]), of: image, on: fixture.page.id)
    }

    #expect(due == [ImageDue(block: ink.id, seq: 2, height: 300, strokes: [drawn])])
    #expect(await fixture.server.images == [Upload(block: ink.id, seq: 2)])
    #expect(await engine.imagesDue(on: fixture.page.id) == [])
}

extension FakeServer {
    func listing(notebooks: [Notebook], pages: [PageSummary]) { listed = (notebooks, pages) }
}
