#if canImport(PencilKit)
import Foundation
import PencilKit

#if canImport(UIKit)
import UIKit
private typealias PlatformColor = UIColor
#else
import AppKit
private typealias PlatformColor = NSColor
#endif

/**
 What tells one PencilKit stroke from another. PencilKit gives strokes no identity and copies them on every change,
 so a stroke is known by what PencilKit leaves alone: a stroke moved with the lasso, or cut by the eraser, comes back
 different and is taken as the old one erased and a new one drawn.
 */
public struct InkKey: Hashable, Sendable {
    let seed: UInt32
    let created: Date
    let count: Int
    let transform: [CGFloat]

    init(_ stroke: PKStroke) {
        seed = stroke.randomSeed
        created = stroke.path.creationDate
        count = stroke.path.count
        let t = stroke.transform
        transform = [t.a, t.b, t.c, t.d, t.tx, t.ty]
    }
}

/// What changed on a canvas since it last matched the page: strokes drawn, strokes gone, and how to know them next.
public struct InkDiff: Sendable {
    public let drawn: [Stroke]
    public let erased: [UUID]
    public let keys: [InkKey: UUID]

    public var isEmpty: Bool { drawn.isEmpty && erased.isEmpty }
}

public struct InkDrawing: Sendable {
    public let drawing: PKDrawing
    public let keys: [InkKey: UUID]
}

/// Strokes between the page and a PencilKit canvas `scale` points per stroke unit.
public enum Ink {
    private static func tool(_ type: PKInk.InkType) -> InkTool {
        switch type {
        case .pencil, .crayon: .pencil
        case .marker, .watercolor: .marker
        default: .pen
        }
    }

    private static func inkType(_ tool: InkTool) -> PKInk.InkType {
        switch tool {
        case .pen: .pen
        case .pencil: .pencil
        case .marker, .highlighter: .marker
        }
    }

    private static func hex(_ color: CGColor) -> String {
        let srgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)
        let parts = (srgb?.components ?? [0, 0, 0, 1]).map { Int((min(max($0, 0), 1) * 255).rounded()) }
        let rgba = parts.count >= 4 ? parts : [parts[0], parts[0], parts[0], parts.last ?? 255]
        let digits = rgba[3] == 255 ? rgba.prefix(3) : rgba.prefix(4)
        return "#" + digits.map { String(format: "%02x", $0) }.joined()
    }

    private static func color(_ hex: String) -> PlatformColor {
        let digits = hex.dropFirst()
        let value = UInt64(digits, radix: 16) ?? 0
        let hasAlpha = digits.count == 8
        let rgba = hasAlpha ? value : value << 8 | 0xff
        return PlatformColor(
            red: CGFloat(rgba >> 24 & 0xff) / 255,
            green: CGFloat(rgba >> 16 & 0xff) / 255,
            blue: CGFloat(rgba >> 8 & 0xff) / 255,
            alpha: CGFloat(rgba & 0xff) / 255
        )
    }

    private static func rounded(_ value: Double, _ per: Double) -> Double {
        (value * per).rounded() / per
    }

    /// `drawn` in stroke units, with any lasso move baked into its points.
    public static func stroke(_ drawn: PKStroke, scale: Double, id: UUID = UUID()) -> Stroke {
        let points = Array(drawn.path)
        let sizes = points.map(\.size.width).sorted()
        let size = sizes.isEmpty ? 1 : Double(sizes[sizes.count / 2])
        return Stroke(
            id: id,
            tool: tool(drawn.ink.inkType),
            color: hex(drawn.ink.color.cgColor),
            width: rounded(size / scale, 100),
            points: points.map { point in
                let at = point.location.applying(drawn.transform)
                return InkPoint(
                    x: rounded(at.x / scale, 100),
                    y: rounded(at.y / scale, 100),
                    t: (point.timeOffset * 1000).rounded(),
                    pressure: rounded(Double(point.size.width) / (2 * size), 1000),
                    azimuth: rounded(point.azimuth, 1000),
                    altitude: rounded(point.altitude, 1000)
                )
            }
        )
    }

    public static func pkStroke(_ stroke: Stroke, scale: Double) -> PKStroke {
        let points = stroke.points.map { point in
            let size = max(point.pressure * 2 * stroke.width * scale, 0.1)
            return PKStrokePoint(
                location: CGPoint(x: point.x * scale, y: point.y * scale),
                timeOffset: point.t / 1000,
                size: CGSize(width: size, height: size),
                opacity: 1,
                force: 1,
                azimuth: point.azimuth,
                altitude: point.altitude
            )
        }
        var drawn = PKStroke(
            ink: PKInk(inkType(stroke.tool), color: color(stroke.color)),
            path: PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSinceReferenceDate: 0))
        )
        let id = stroke.id.uuid
        drawn.randomSeed = UInt32(id.0) << 24 | UInt32(id.1) << 16 | UInt32(id.2) << 8 | UInt32(id.3)
        return drawn
    }

    /// The page's strokes as a drawing, and how to know each of them when the canvas hands them back.
    public static func drawing(_ strokes: [Stroke], scale: Double) -> InkDrawing {
        let drawn = strokes.map { pkStroke($0, scale: scale) }
        let keys = Dictionary(zip(drawn.map(InkKey.init), strokes.map(\.id)), uniquingKeysWith: { first, _ in first })
        return InkDrawing(drawing: PKDrawing(strokes: drawn), keys: keys)
    }

    /// What the canvas now holds against what it held when it last matched the page.
    public static func diff(_ canvas: PKDrawing, from keys: [InkKey: UUID], scale: Double) -> InkDiff {
        var next: [InkKey: UUID] = [:]
        var drawn: [Stroke] = []
        for stroke in canvas.strokes {
            let key = InkKey(stroke)
            if let id = keys[key] {
                next[key] = id
            } else {
                let converted = Ink.stroke(stroke, scale: scale)
                next[key] = converted.id
                drawn.append(converted)
            }
        }
        let kept = Set(next.values)
        return InkDiff(drawn: drawn, erased: keys.values.filter { !kept.contains($0) }, keys: next)
    }
}
#endif
