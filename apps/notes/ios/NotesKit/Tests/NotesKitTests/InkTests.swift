#if canImport(PencilKit)
import Foundation
import PencilKit
import Testing
@testable import NotesKit

private func drawn(_ points: [(Double, Double)], width: Double = 3) -> PKStroke {
    PKStroke(
        ink: PKInk(.pen, color: .init(red: 0.2, green: 0.4, blue: 0.6, alpha: 1)),
        path: PKStrokePath(
            controlPoints: points.enumerated().map { i, xy in
                PKStrokePoint(
                    location: CGPoint(x: xy.0, y: xy.1),
                    timeOffset: Double(i) / 100,
                    size: CGSize(width: width, height: width),
                    opacity: 1, force: 1, azimuth: 0.5, altitude: 1
                )
            },
            creationDate: Date()
        )
    )
}

@Test func convertsADrawnStrokeIntoStrokeUnits() {
    let stroke = Ink.stroke(drawn([(50, 100), (60, 110)]), scale: 0.5)

    #expect(stroke.tool == .pen)
    #expect(stroke.color == "#336699")
    #expect(stroke.width == 6)
    #expect(stroke.points.map(\.x) == [100, 120])
    #expect(stroke.points.map(\.y) == [200, 220])
    #expect(stroke.points.map(\.t) == [0, 10])
    #expect(stroke.points.map(\.pressure) == [0.5, 0.5])
}

@Test func knowsThePagesStrokesWhenTheCanvasHandsThemBack() {
    let page = [Ink.stroke(drawn([(0, 0), (10, 10)]), scale: 1), Ink.stroke(drawn([(5, 5), (9, 9), (12, 3)]), scale: 1)]
    let canvas = Ink.drawing(page, scale: 2)

    #expect(Ink.diff(canvas.drawing, from: canvas.keys, scale: 2).isEmpty)
}

@Test func takesAStrokeDrawnAndOneErased() {
    let page = [Ink.stroke(drawn([(0, 0), (10, 10)]), scale: 1), Ink.stroke(drawn([(5, 5), (9, 9)]), scale: 1)]
    let canvas = Ink.drawing(page, scale: 1)
    let edited = PKDrawing(strokes: [canvas.drawing.strokes[1], drawn([(1, 2), (3, 4)])])

    let diff = Ink.diff(edited, from: canvas.keys, scale: 1)

    #expect(diff.erased == [page[0].id])
    #expect(diff.drawn.map { $0.points.map(\.x) } == [[1, 3]])
    #expect(Ink.diff(edited, from: diff.keys, scale: 1).isEmpty)
}

@Test func takesAStrokeMovedWithTheLassoAsANewOne() {
    let page = [Ink.stroke(drawn([(0, 0), (10, 10)]), scale: 1)]
    let canvas = Ink.drawing(page, scale: 1)
    var moved = canvas.drawing.strokes[0]
    moved.transform = CGAffineTransform(translationX: 100, y: 0)

    let diff = Ink.diff(PKDrawing(strokes: [moved]), from: canvas.keys, scale: 1)

    #expect(diff.erased == [page[0].id])
    #expect(diff.drawn.map { $0.points.map(\.x) } == [[100, 110]])
}
#endif
