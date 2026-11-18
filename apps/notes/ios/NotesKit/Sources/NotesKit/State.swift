import Foundation

/// The ids a device has changed but not yet had the server take, which a pull must not overwrite.
public struct Pending: Hashable, Sendable {
    public let blocks: Set<UUID>
    public let strokes: Set<UUID>
    /// Ink blocks with strokes drawn or erased here that the server has yet to take.
    public let inkBlocks: Set<UUID>

    public init(_ mutations: [Mutation]) {
        var blocks = Set<UUID>()
        var strokes = Set<UUID>()
        var inkBlocks = Set<UUID>()
        for mutation in mutations {
            switch mutation {
            case let .putBlock(_, block): blocks.insert(block.id)
            case let .deleteBlock(_, id): blocks.insert(id)
            case let .addStroke(_, block, stroke):
                strokes.insert(stroke.id)
                inkBlocks.insert(block)
            case let .eraseStrokes(_, block, ids):
                strokes.formUnion(ids)
                inkBlocks.insert(block)
            case .putNotebook, .deleteNotebook, .putPage, .deletePage: break
            }
        }
        self.blocks = blocks
        self.strokes = strokes
        self.inkBlocks = inkBlocks
    }
}

/// An ink block to render and upload, with its strokes as of the change they were pulled at.
public struct ImageDue: Hashable, Sendable {
    public let block: UUID
    public let seq: Int
    public let height: Double
    public let strokes: [Stroke]
}

/// A page's content as this device holds it, as of the server's change `seq` plus any changes made here since.
public struct PageState: Hashable, Sendable, Codable {
    public private(set) var seq: Int
    public private(set) var blocks: [UUID: Block]
    /// Each ink block's strokes, in the order drawn.
    public private(set) var strokes: [UUID: [Stroke]]
    /// The change number at which each ink block's strokes were last pulled, which a rendering of it is as of.
    public private(set) var inkSeq: [UUID: Int]
    /// The change number of the rendering of each ink block last uploaded.
    public private(set) var rendered: [UUID: Int]

    public static let empty = PageState(seq: 0, blocks: [:], strokes: [:], inkSeq: [:], rendered: [:])

    /// Ink blocks whose strokes the server holds as they are here, and has no rendering of as late.
    public func imagesDue(except pending: Pending) -> [ImageDue] {
        ordered.compactMap { block in
            guard case let .ink(height) = block.content, !pending.inkBlocks.contains(block.id),
                  let seq = inkSeq[block.id], seq > rendered[block.id, default: 0]
            else { return nil }
            return ImageDue(block: block.id, seq: seq, height: height, strokes: strokes[block.id, default: []])
        }
    }

    public func rendering(_ due: ImageDue) -> PageState {
        var next = self
        next.rendered[due.block] = max(due.seq, rendered[due.block, default: 0])
        return next
    }

    /// The page's blocks top to bottom.
    public var ordered: [Block] {
        blocks.values.sorted { ($0.order, $0.id.wire) < ($1.order, $1.id.wire) }
    }

    /// `changes` pulled from the server, except where `pending` says this device has changed something since.
    public func applying(_ changes: PageChanges, except pending: Pending) -> PageState {
        var next = self
        next.seq = changes.seq
        for change in changes.blocks {
            switch change {
            case let .block(block) where !pending.blocks.contains(block.id):
                next.blocks[block.id] = block
            case let .deleted(id) where !pending.blocks.contains(id):
                next.blocks[id] = nil
                next.strokes[id] = nil
            default:
                break
            }
        }
        for change in changes.strokes {
            switch change {
            case let .stroke(block, stroke) where !pending.strokes.contains(stroke.id):
                next.strokes[block] = next.strokes[block, default: []].filter { $0.id != stroke.id } + [stroke]
                next.inkSeq[block] = changes.seq
            case let .erased(block, id) where !pending.strokes.contains(id):
                next.strokes[block] = next.strokes[block, default: []].filter { $0.id != id }
                next.inkSeq[block] = changes.seq
            default:
                break
            }
        }
        return next
    }

    /// The page with a change made on this device, ahead of the server taking it.
    public func applying(_ mutation: Mutation) -> PageState {
        var next = self
        switch mutation {
        case let .putBlock(_, block):
            next.blocks[block.id] = block
        case let .deleteBlock(_, id):
            next.blocks[id] = nil
        case let .addStroke(_, block, stroke):
            if !next.strokes[block, default: []].contains(where: { $0.id == stroke.id }) {
                next.strokes[block, default: []].append(stroke)
            }
        case let .eraseStrokes(_, block, ids):
            let erased = Set(ids)
            next.strokes[block] = next.strokes[block, default: []].filter { !erased.contains($0.id) }
        case .putNotebook, .deleteNotebook, .putPage, .deletePage:
            break
        }
        return next
    }

    /// The key that puts a block after `block`, or first when `block` is nil.
    public func order(after block: UUID?) throws(FractionalIndex.Failure) -> String {
        let blocks = ordered
        guard let block, let index = blocks.firstIndex(where: { $0.id == block }) else {
            return try FractionalIndex.between(nil, blocks.first?.order)
        }
        let next = blocks.index(after: index)
        return try FractionalIndex.between(blocks[index].order, next < blocks.endIndex ? blocks[next].order : nil)
    }

    /// The key that puts a block at the end of the page.
    public func orderAtEnd() throws(FractionalIndex.Failure) -> String {
        try FractionalIndex.between(ordered.last?.order, nil)
    }
}

/// The notebooks and pages, as of the server's last listing plus any changes made here since.
public struct NotesIndex: Hashable, Sendable, Codable {
    public private(set) var notebooks: [UUID: Notebook]
    public private(set) var pages: [UUID: PageMeta]
    /// Each page's change number as the server last listed it.
    public private(set) var serverSeq: [UUID: Int]

    public static let empty = NotesIndex(notebooks: [:], pages: [:], serverSeq: [:])

    public var orderedNotebooks: [Notebook] {
        notebooks.values.sorted { ($0.position, $0.id.wire) < ($1.position, $1.id.wire) }
    }

    public func pages(in notebook: UUID) -> [PageMeta] {
        pages.values.filter { $0.notebookId == notebook }.sorted { ($0.position, $0.id.wire) < ($1.position, $1.id.wire) }
    }

    /// The server's listing, with the changes this device has not yet had taken laid back on top.
    public static func listed(notebooks: [Notebook], pages: [PageSummary], pending: [Mutation]) -> NotesIndex {
        let server = NotesIndex(
            notebooks: Dictionary(uniqueKeysWithValues: notebooks.map { ($0.id, $0) }),
            pages: Dictionary(uniqueKeysWithValues: pages.map { ($0.id, $0.meta) }),
            serverSeq: Dictionary(uniqueKeysWithValues: pages.map { ($0.id, $0.seq) })
        )
        return pending.reduce(server) { $0.applying($1) }
    }

    public func applying(_ mutation: Mutation) -> NotesIndex {
        var next = self
        switch mutation {
        case let .putNotebook(notebook):
            next.notebooks[notebook.id] = notebook
        case let .deleteNotebook(id):
            next.notebooks[id] = nil
            next.pages = next.pages.filter { $0.value.notebookId != id }
        case let .putPage(page):
            next.pages[page.id] = page
        case let .deletePage(id):
            next.pages[id] = nil
        case .putBlock, .deleteBlock, .addStroke, .eraseStrokes:
            break
        }
        return next
    }
}

/// A batch of changes under the key the server remembers it by, so sending it again cannot apply it twice.
public struct Batch: Hashable, Sendable, Codable {
    public let key: String
    public let mutations: [Mutation]
}

/**
 Changes made on this device and not yet taken by the server, in the order made. Changes are queued, then sealed
 into a batch under a key before the first attempt to send it; a sealed batch is only ever resent whole, under the
 same key, until the server answers it.
 */
public struct Outbox: Hashable, Sendable, Codable {
    public private(set) var sealed: [Batch]
    public private(set) var queued: [Mutation]

    public static let empty = Outbox(sealed: [], queued: [])

    public var pending: [Mutation] { sealed.flatMap(\.mutations) + queued }
    public var isEmpty: Bool { sealed.isEmpty && queued.isEmpty }

    /**
     `mutation` queued after the rest. Typing rewrites a block many times over: a put replaces the queued put of the
     same block when nothing about that block was queued after it, so the queue holds one write per edit, not per key.
     */
    public func queuing(_ mutation: Mutation) -> Outbox {
        var next = self
        if case let .putBlock(_, block) = mutation,
           let last = next.queued.lastIndex(where: { $0.block == block.id }),
           case .putBlock = next.queued[last]
        {
            next.queued[last] = mutation
        } else {
            next.queued.append(mutation)
        }
        return next
    }

    /// The outbox ready to send, and the batch to send from it, if there is anything to send.
    public struct Sealed: Sendable {
        public let outbox: Outbox
        public let batch: Batch?
    }

    /// The batch to send now: the oldest sealed one, else everything queued sealed under `key`.
    public func sealing(key: () -> String, limit: Int = 500) -> Sealed {
        if let batch = sealed.first {
            return Sealed(outbox: self, batch: batch)
        }
        guard !queued.isEmpty else { return Sealed(outbox: self, batch: nil) }
        let batch = Batch(key: key(), mutations: Array(queued.prefix(limit)))
        return Sealed(outbox: Outbox(sealed: [batch], queued: Array(queued.dropFirst(limit))), batch: batch)
    }

    /// The outbox once the server has answered `key`, whether it took the batch or refused it.
    public func answered(_ key: String) -> Outbox {
        Outbox(sealed: sealed.filter { $0.key != key }, queued: queued)
    }
}
