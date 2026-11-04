import Foundation

/// One block of a page: what it holds, and the key it sorts by.
public struct Block: Hashable, Sendable, Identifiable {
    public let id: UUID
    public var order: String
    public var content: BlockContent

    public init(id: UUID = UUID(), order: String, content: BlockContent) {
        self.id = id
        self.order = order
        self.content = content
    }
}

extension Block: Codable {
    private enum Keys: String, CodingKey { case id, order, node }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        id = try container.decode(UUID.self, forKey: .id)
        order = try container.decode(String.self, forKey: .order)
        content = BlockContent(node: try container.decode(JSONValue.self, forKey: .node))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(id.wire, forKey: .id)
        try container.encode(order, forKey: .order)
        try container.encode(content.node, forKey: .node)
    }
}

extension UUID {
    /// Lowercase, as Postgres writes ids back.
    var wire: String { uuidString.lowercased() }
}

/**
 One change to someone's notes, as the server's `Mutation` takes it. A put writes the whole row; a delete or erase of
 something already gone, or a stroke added again, changes nothing.
 */
public enum Mutation: Hashable, Sendable {
    case putNotebook(Notebook)
    case deleteNotebook(UUID)
    case putPage(PageMeta)
    case deletePage(UUID)
    case putBlock(page: UUID, Block)
    case deleteBlock(page: UUID, id: UUID)
    case addStroke(page: UUID, block: UUID, Stroke)
    case eraseStrokes(page: UUID, block: UUID, ids: [UUID])

    /// The page whose content this changes, if it changes one.
    public var page: UUID? {
        switch self {
        case .putNotebook, .deleteNotebook, .putPage, .deletePage: nil
        case let .putBlock(page, _), let .deleteBlock(page, _), let .addStroke(page, _, _),
             let .eraseStrokes(page, _, _): page
        }
    }

    /// The block whose row or strokes this changes, if any.
    public var block: UUID? {
        switch self {
        case .putNotebook, .deleteNotebook, .putPage, .deletePage: nil
        case let .putBlock(_, block): block.id
        case let .deleteBlock(_, id): id
        case let .addStroke(_, block, _), let .eraseStrokes(_, block, _): block
        }
    }
}

extension Mutation: Codable {
    private enum Keys: String, CodingKey { case type, row, id, pageId, blockId, stroke, strokeIds }

    private struct NotebookRow: Codable {
        let id: UUID
        let title: String
        let position: Int
    }

    private struct PageRow: Codable {
        let id: UUID
        let notebookId: UUID
        let title: String
        let position: Int
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case let .putNotebook(notebook):
            try container.encode("notebook.put", forKey: .type)
            try container.encode(WireNotebook(notebook), forKey: .row)
        case let .deleteNotebook(id):
            try container.encode("notebook.delete", forKey: .type)
            try container.encode(id.wire, forKey: .id)
        case let .putPage(page):
            try container.encode("page.put", forKey: .type)
            try container.encode(WirePage(page), forKey: .row)
        case let .deletePage(id):
            try container.encode("page.delete", forKey: .type)
            try container.encode(id.wire, forKey: .id)
        case let .putBlock(page, block):
            try container.encode("block.put", forKey: .type)
            try container.encode(page.wire, forKey: .pageId)
            try container.encode(block, forKey: .row)
        case let .deleteBlock(page, id):
            try container.encode("block.delete", forKey: .type)
            try container.encode(page.wire, forKey: .pageId)
            try container.encode(id.wire, forKey: .id)
        case let .addStroke(page, block, stroke):
            try container.encode("stroke.add", forKey: .type)
            try container.encode(page.wire, forKey: .pageId)
            try container.encode(block.wire, forKey: .blockId)
            try container.encode(WireStroke(stroke), forKey: .stroke)
        case let .eraseStrokes(page, block, ids):
            try container.encode("stroke.erase", forKey: .type)
            try container.encode(page.wire, forKey: .pageId)
            try container.encode(block.wire, forKey: .blockId)
            try container.encode(ids.map(\.wire), forKey: .strokeIds)
        }
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "notebook.put":
            let row = try container.decode(NotebookRow.self, forKey: .row)
            self = .putNotebook(Notebook(id: row.id, title: row.title, position: row.position))
        case "notebook.delete":
            self = .deleteNotebook(try container.decode(UUID.self, forKey: .id))
        case "page.put":
            let row = try container.decode(PageRow.self, forKey: .row)
            self = .putPage(PageMeta(id: row.id, notebookId: row.notebookId, title: row.title, position: row.position))
        case "page.delete":
            self = .deletePage(try container.decode(UUID.self, forKey: .id))
        case "block.put":
            self = .putBlock(
                page: try container.decode(UUID.self, forKey: .pageId),
                try container.decode(Block.self, forKey: .row)
            )
        case "block.delete":
            self = .deleteBlock(
                page: try container.decode(UUID.self, forKey: .pageId),
                id: try container.decode(UUID.self, forKey: .id)
            )
        case "stroke.add":
            self = .addStroke(
                page: try container.decode(UUID.self, forKey: .pageId),
                block: try container.decode(UUID.self, forKey: .blockId),
                try container.decode(Stroke.self, forKey: .stroke)
            )
        case "stroke.erase":
            self = .eraseStrokes(
                page: try container.decode(UUID.self, forKey: .pageId),
                block: try container.decode(UUID.self, forKey: .blockId),
                ids: try container.decode([UUID].self, forKey: .strokeIds)
            )
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown \(type)")
        }
    }
}

private struct WireNotebook: Encodable {
    let id: String
    let title: String
    let position: Int

    init(_ notebook: Notebook) {
        id = notebook.id.wire
        title = notebook.title
        position = notebook.position
    }
}

private struct WirePage: Encodable {
    let id: String
    let notebookId: String
    let title: String
    let position: Int

    init(_ page: PageMeta) {
        id = page.id.wire
        notebookId = page.notebookId.wire
        title = page.title
        position = page.position
    }
}

private struct WireStroke: Encodable {
    let id: String
    let tool: InkTool
    let color: String
    let width: Double
    let points: [InkPoint]

    init(_ stroke: Stroke) {
        id = stroke.id.wire
        tool = stroke.tool
        color = stroke.color
        width = stroke.width
        points = stroke.points
    }
}

public enum BlockChange: Hashable, Sendable, Decodable {
    case block(Block)
    case deleted(UUID)

    private enum Keys: String, CodingKey { case kind, id }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "block": self = .block(try Block(from: decoder))
        case "deleted": self = .deleted(try container.decode(UUID.self, forKey: .id))
        case let kind:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "Unknown \(kind)")
        }
    }
}

public enum StrokeChange: Hashable, Sendable, Decodable {
    case stroke(block: UUID, Stroke)
    case erased(block: UUID, id: UUID)

    private enum Keys: String, CodingKey { case kind, blockId, stroke, id }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let block = try container.decode(UUID.self, forKey: .blockId)
        switch try container.decode(String.self, forKey: .kind) {
        case "stroke": self = .stroke(block: block, try container.decode(Stroke.self, forKey: .stroke))
        case "erased": self = .erased(block: block, id: try container.decode(UUID.self, forKey: .id))
        case let kind:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "Unknown \(kind)")
        }
    }
}

/// Every block and stroke of a page changed after the number a device asked from, bringing it to `seq`.
public struct PageChanges: Hashable, Sendable, Decodable {
    public let seq: Int
    public let blocks: [BlockChange]
    public let strokes: [StrokeChange]
}
