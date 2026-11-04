import NotesKit
import PencilKit
import SwiftUI

enum InkColor: String, CaseIterable, Hashable {
    case black, blue, red, green

    var ui: UIColor {
        switch self {
        case .black: .black
        case .blue: UIColor(red: 0.1, green: 0.3, blue: 0.85, alpha: 1)
        case .red: UIColor(red: 0.85, green: 0.15, blue: 0.15, alpha: 1)
        case .green: UIColor(red: 0.1, green: 0.55, blue: 0.25, alpha: 1)
        }
    }
}

/// The pen in hand. The eraser takes whole strokes, so every stroke on the page stays one the server has whole.
enum PenChoice: Hashable {
    case pen(InkColor)
    case pencil(InkColor)
    case highlighter
    case eraser
    case lasso

    var tool: PKTool {
        switch self {
        case let .pen(color): PKInkingTool(.pen, color: color.ui, width: 3)
        case let .pencil(color): PKInkingTool(.pencil, color: color.ui, width: 3)
        case .highlighter: PKInkingTool(.marker, color: UIColor.systemYellow.withAlphaComponent(0.5), width: 18)
        case .eraser: PKEraserTool(.vector)
        case .lasso: PKLassoTool()
        }
    }

    var color: InkColor? {
        switch self {
        case let .pen(color), let .pencil(color): color
        case .highlighter, .eraser, .lasso: nil
        }
    }
}

struct PenPicker: View {
    @Binding var pen: PenChoice
    @State private var color = InkColor.black

    var body: some View {
        HStack(spacing: 4) {
            tool(.pen(color), "pencil.tip")
            tool(.pencil(color), "pencil")
            tool(.highlighter, "highlighter")
            tool(.eraser, "eraser")
            tool(.lasso, "lasso")
            Divider().frame(height: 20)
            ForEach(InkColor.allCases, id: \.self) { choice in
                Button {
                    color = choice
                    switch pen {
                    case .pencil: pen = .pencil(choice)
                    default: pen = .pen(choice)
                    }
                } label: {
                    Circle()
                        .fill(Color(uiColor: choice.ui))
                        .frame(width: 20, height: 20)
                        .overlay { Circle().stroke(.primary, lineWidth: pen.color == choice ? 2 : 0).padding(-3) }
                }
                .accessibilityLabel(choice.rawValue)
            }
        }
    }

    private func tool(_ choice: PenChoice, _ symbol: String) -> some View {
        Button {
            pen = choice
        } label: {
            Image(systemName: symbol)
                .frame(width: 32, height: 28)
                .background(sameTool(choice) ? AnyShapeStyle(.tint.opacity(0.2)) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 6))
        }
    }

    private func sameTool(_ choice: PenChoice) -> Bool {
        switch (pen, choice) {
        case (.pen, .pen), (.pencil, .pencil), (.highlighter, .highlighter), (.eraser, .eraser), (.lasso, .lasso): true
        default: false
        }
    }
}

struct InkBlock: View {
    let strokes: [Stroke]
    /// In stroke units, where the block is `inkWidth` wide.
    let height: Double
    @Binding var pen: PenChoice
    let changed: (InkDiff) -> Void
    let taller: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                InkCanvas(strokes: strokes, scale: geometry.size.width / inkWidth, pen: $pen, changed: changed)
            }
            .aspectRatio(inkWidth / height, contentMode: .fit)
            .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 8))
            Button("Make room", systemImage: "chevron.compact.down", action: taller)
                .labelStyle(.iconOnly)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity)
        }
    }
}

private struct InkCanvas: UIViewRepresentable {
    let strokes: [Stroke]
    let scale: Double
    @Binding var pen: PenChoice
    let changed: (InkDiff) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.isScrollEnabled = false
        #if targetEnvironment(simulator)
            canvas.drawingPolicy = .anyInput
        #else
            canvas.drawingPolicy = .pencilOnly
        #endif
        canvas.delegate = context.coordinator
        let pencil = UIPencilInteraction(delegate: context.coordinator)
        canvas.addInteraction(pencil)
        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        canvas.tool = pen.tool
        guard scale > 0 else { return }
        let ids = Set(strokes.map(\.id))
        if scale != coordinator.scale || ids != Set(coordinator.keys.values) {
            let drawing = Ink.drawing(strokes, scale: scale)
            coordinator.scale = scale
            coordinator.keys = drawing.keys
            coordinator.loading = true
            canvas.drawing = drawing.drawing
            coordinator.loading = false
        }
    }

    @MainActor
    final class Coordinator: NSObject, PKCanvasViewDelegate, UIPencilInteractionDelegate {
        var parent: InkCanvas
        var scale: Double = 0
        var keys: [InkKey: UUID] = [:]
        var loading = false
        private var beforeEraser: PenChoice?

        init(_ parent: InkCanvas) {
            self.parent = parent
        }

        func canvasViewDrawingDidChange(_ canvas: PKCanvasView) {
            guard !loading, scale > 0 else { return }
            let diff = Ink.diff(canvas.drawing, from: keys, scale: scale)
            keys = diff.keys
            if !diff.isEmpty {
                parent.changed(diff)
            }
        }

        /// A double tap on the Pencil swaps to the eraser and back.
        func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
            if parent.pen == .eraser {
                parent.pen = beforeEraser ?? .pen(.black)
            } else {
                beforeEraser = parent.pen
                parent.pen = .eraser
            }
        }
    }
}

/// A rendering of handwriting for Claude to see: dark ink on white, `inkWidth` pixels wide.
@MainActor
func renderPNG(_ due: ImageDue) -> Data? {
    let bounds = CGRect(x: 0, y: 0, width: inkWidth, height: due.height)
    let drawing = Ink.drawing(due.strokes, scale: 1).drawing
    var ink: UIImage?
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
        ink = drawing.image(from: bounds, scale: 1)
    }
    guard let ink else { return nil }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(bounds: bounds, format: format).pngData { context in
        UIColor.white.setFill()
        context.fill(bounds)
        ink.draw(in: bounds)
    }
}
