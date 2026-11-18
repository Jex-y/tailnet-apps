import NotesKit
import PencilKit
import SwiftUI

struct PageView: View {
    let model: NotesModel
    @State private var pen = PenChoice.pen(.black)
    @FocusState private var focused: UUID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let meta = model.openMeta {
                    TextField(
                        "Title",
                        text: Binding(get: { meta.title }, set: { model.rename(meta, to: $0) })
                    )
                    .font(.largeTitle.bold())
                    .padding(.leading, 36)
                }
                ForEach(model.page.ordered) { block in
                    BlockRow(model: model, block: block, pen: $pen, focused: $focused)
                }
                AddBlockMenu(model: model, after: model.page.ordered.last?.id)
                    .padding(.leading, 36)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItem(placement: .principal) { PenPicker(pen: $pen) }
        }
        .refreshable { await model.sync() }
        .onChange(of: model.inserted) { _, id in focused = id }
    }
}

struct AddBlockMenu: View {
    let model: NotesModel
    let after: UUID?
    var label = "Add"

    var body: some View {
        Menu {
            AddBlockItems(model: model, after: after)
        } label: {
            Label(label, systemImage: "plus.circle")
        }
    }
}

struct AddBlockItems: View {
    let model: NotesModel
    let after: UUID?

    var body: some View {
        Button("Handwriting", systemImage: "pencil.and.scribble") { model.insert(.ink(height: 600), after: after) }
        Button("Text", systemImage: "text.alignleft") { model.insert(.paragraph(""), after: after) }
        Button("Heading", systemImage: "textformat.size") { model.insert(.heading(.two, ""), after: after) }
        Button("Maths", systemImage: "function") { model.insert(.math(""), after: after) }
        Button("Code", systemImage: "chevron.left.forwardslash.chevron.right") {
            model.insert(.code(.ts, ""), after: after)
        }
    }
}

private struct BlockRow: View {
    let model: NotesModel
    let block: Block
    @Binding var pen: PenChoice
    var focused: FocusState<UUID?>.Binding

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Menu {
                Menu("Insert Below") { AddBlockItems(model: model, after: block.id) }
                Button("Move Up", systemImage: "arrow.up") { model.move(block.id, .up) }
                Button("Move Down", systemImage: "arrow.down") { model.move(block.id, .down) }
                Button("Delete", systemImage: "trash", role: .destructive) { model.delete(block: block.id) }
            } label: {
                Image(systemName: "line.3.horizontal")
                    .foregroundStyle(.tertiary)
                    .frame(width: 28, height: 28)
            }
            content
                .focused(focused, equals: block.id)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func set(_ content: BlockContent) {
        model.update(block.id, to: content)
    }

    @ViewBuilder private var content: some View {
        switch block.content {
        case let .paragraph(text):
            TextField("Write, with $x^2$ for maths", text: Binding(get: { text }, set: { set(.paragraph($0)) }), axis: .vertical)
        case let .heading(level, text):
            TextField("Heading", text: Binding(get: { text }, set: { set(.heading(level, $0)) }), axis: .vertical)
                .font(level == .one ? .title.bold() : level == .two ? .title2.bold() : .title3.bold())
        case let .math(latex):
            HStack(alignment: .firstTextBaseline) {
                Text("$$").foregroundStyle(.secondary)
                TextField("LaTeX", text: Binding(get: { latex }, set: { set(.math($0)) }), axis: .vertical)
            }
            .font(.body.monospaced())
            .padding(10)
            .background(.fill.quaternary, in: .rect(cornerRadius: 8))
        case let .code(language, source):
            CodeBlock(language: language, source: source, set: set)
        case let .ink(height):
            InkBlock(
                strokes: model.page.strokes[block.id, default: []],
                height: height,
                pen: $pen,
                changed: { diff in
                    model.ink(block.id, diff)
                    let lowest = diff.drawn.flatMap(\.points).map(\.y).max() ?? 0
                    if lowest > height - 150 {
                        set(.ink(height: height + 400))
                    }
                },
                taller: { set(.ink(height: height + 400)) }
            )
        case let .other(node):
            VStack(alignment: .leading, spacing: 4) {
                Text(plainText(node))
                Text("Written elsewhere. Ask Claude to change it.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private func plainText(_ node: JSONValue) -> String {
    switch node {
    case let .object(fields):
        if case let .string(text)? = fields["text"] { return text }
        if case let .array(children)? = fields["content"] {
            return children.map(plainText).joined(separator: fields["type"] == .string("paragraph") ? "" : "\n")
        }
        return ""
    default:
        return ""
    }
}

private struct CodeBlock: View {
    let language: CodeLanguage
    let source: String
    let set: (BlockContent) -> Void
    @State private var output: CodeOutput?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("Language", selection: Binding(get: { language }, set: { set(.code($0, source)) })) {
                    Text("TypeScript").tag(CodeLanguage.ts)
                    Text("JavaScript").tag(CodeLanguage.js)
                }
                .pickerStyle(.segmented)
                .fixedSize()
                Spacer()
                if language == .js {
                    Button("Run", systemImage: "play.fill") {
                        Task { output = await CodeOutput.run(source) }
                    }
                }
            }
            TextField("Code", text: Binding(get: { source }, set: { set(.code(language, $0)) }), axis: .vertical)
                .font(.body.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if let output {
                Text(output.text)
                    .font(.callout.monospaced())
                    .foregroundStyle(output.failed ? .red : .secondary)
                    .textSelection(.enabled)
            }
        }
        .padding(10)
        .background(.fill.quaternary, in: .rect(cornerRadius: 8))
    }
}
