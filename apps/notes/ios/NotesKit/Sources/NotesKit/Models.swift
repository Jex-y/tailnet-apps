import Foundation

public struct Notebook: Hashable, Sendable, Codable, Identifiable {
    public let id: UUID
    public var title: String
    public var position: Int

    public init(id: UUID = UUID(), title: String, position: Int) {
        self.id = id
        self.title = title
        self.position = position
    }
}

/// Everything about a page but its content.
public struct PageMeta: Hashable, Sendable, Codable, Identifiable {
    public let id: UUID
    public var notebookId: UUID
    public var title: String
    public var position: Int

    public init(id: UUID = UUID(), notebookId: UUID, title: String, position: Int) {
        self.id = id
        self.notebookId = notebookId
        self.title = title
        self.position = position
    }
}

/// A page as the server lists it: `seq` counts the changes to its content.
public struct PageSummary: Hashable, Sendable, Decodable {
    public let id: UUID
    public let notebookId: UUID
    public let title: String
    public let position: Int
    public let seq: Int

    public var meta: PageMeta { PageMeta(id: id, notebookId: notebookId, title: title, position: position) }
}

public enum InkTool: String, Hashable, Sendable, Codable, CaseIterable {
    case pen, pencil, marker, highlighter
}

/// One sample of the pen, in the block's coordinates where every ink block is ``inkWidth`` wide.
public struct InkPoint: Hashable, Sendable, Codable {
    public let x: Double
    public let y: Double
    /// Milliseconds since the stroke began.
    public let t: Double
    /// 0 to 1: the point's share of twice the stroke's width.
    public let pressure: Double
    public let azimuth: Double
    public let altitude: Double

    public init(x: Double, y: Double, t: Double, pressure: Double, azimuth: Double, altitude: Double) {
        self.x = x
        self.y = y
        self.t = t
        self.pressure = min(max(pressure, 0), 1)
        self.azimuth = azimuth
        self.altitude = min(max(altitude, 0), .pi / 2)
    }
}

/// Never changes once drawn.
public struct Stroke: Hashable, Sendable, Codable, Identifiable {
    public let id: UUID
    public let tool: InkTool
    /// `#rrggbb` or `#rrggbbaa`.
    public let color: String
    public let width: Double
    public let points: [InkPoint]

    public init(id: UUID = UUID(), tool: InkTool, color: String, width: Double, points: [InkPoint]) {
        self.id = id
        self.tool = tool
        self.color = color
        self.width = width
        self.points = points
    }
}

/// The width of every ink block in stroke coordinates, whatever its width on screen.
public let inkWidth: Double = 1000
