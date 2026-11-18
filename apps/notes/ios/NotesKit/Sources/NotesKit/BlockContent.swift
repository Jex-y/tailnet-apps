public enum CodeLanguage: String, Hashable, Sendable, CaseIterable {
    case ts, js
}

public enum HeadingLevel: Int, Hashable, Sendable, CaseIterable {
    case one = 1, two, three
}

/**
 What one block of a page holds, as this app edits it. Prose is plain text in which `$…$` is inline LaTeX, the same
 convention the server's MCP tools write with. A node this app cannot edit without losing something (a list, a quote,
 a paragraph with bold in it) is kept exactly as it came, as ``other``.
 */
public enum BlockContent: Hashable, Sendable {
    case paragraph(String)
    case heading(HeadingLevel, String)
    case math(String)
    case code(CodeLanguage, String)
    /// `height` is in stroke units, where the block is ``inkWidth`` wide.
    case ink(height: Double)
    case other(JSONValue)

    public var isInk: Bool {
        if case .ink = self { true } else { false }
    }
}

private func text(_ value: String) -> [JSONValue] {
    value.isEmpty ? [] : [.object(["type": .string("text"), "text": .string(value)])]
}

/// `$…$` becomes inline maths, split exactly as the server's `blocks.ts` splits it.
private func prose(_ value: String) -> [JSONValue] {
    var nodes: [JSONValue] = []
    var cursor = value.startIndex
    for match in value.matches(of: /\$([^$\n]+)\$/) {
        nodes += text(String(value[cursor..<match.range.lowerBound]))
        nodes.append(.object(["type": .string("math_inline"), "content": .array(text(String(match.1)))]))
        cursor = match.range.upperBound
    }
    return nodes + text(String(value[cursor...]))
}

/// The prose of a paragraph or heading, if nothing in it would be lost by editing it as plain text.
private func plainProse(_ content: [JSONValue]?) -> String? {
    var parts: [String] = []
    for node in content ?? [] {
        switch node["type"]?.string {
        case "text" where node["marks"] == nil:
            guard let value = node["text"]?.string else { return nil }
            parts.append(value)
        case "math_inline":
            let latex = (node["content"]?.array ?? []).compactMap { $0["text"]?.string }.joined()
            parts.append("$\(latex)$")
        default:
            return nil
        }
    }
    return parts.joined()
}

private func plainText(_ content: [JSONValue]?) -> String {
    (content ?? []).compactMap { $0["text"]?.string }.joined()
}

extension BlockContent {
    /// The block as a ProseMirror node in the server's page schema.
    public var node: JSONValue {
        switch self {
        case let .paragraph(value):
            .object(["type": .string("paragraph"), "content": .array(prose(value))])
        case let .heading(level, value):
            .object([
                "type": .string("heading"),
                "attrs": .object(["level": .number(Double(level.rawValue))]),
                "content": .array(prose(value)),
            ])
        case let .math(latex):
            .object(["type": .string("math_block"), "content": .array(text(latex))])
        case let .code(language, source):
            .object([
                "type": .string("code_block"),
                "attrs": .object(["language": .string(language.rawValue)]),
                "content": .array(text(source)),
            ])
        case let .ink(height):
            .object(["type": .string("ink"), "attrs": .object(["height": .number(height)])])
        case let .other(node):
            node
        }
    }

    /// Reads a node the server sent; one this app cannot edit faithfully stays as it is.
    public init(node: JSONValue) {
        let content = node["content"]?.array
        let attrs = node["attrs"]
        switch node["type"]?.string {
        case "paragraph":
            self = plainProse(content).map(BlockContent.paragraph) ?? .other(node)
        case "heading":
            if let level = attrs?["level"]?.number.flatMap({ HeadingLevel(rawValue: Int($0)) }),
               let value = plainProse(content)
            {
                self = .heading(level, value)
            } else {
                self = .other(node)
            }
        case "math_block":
            self = .math(plainText(content))
        case "code_block":
            if let language = attrs?["language"]?.string.flatMap(CodeLanguage.init(rawValue:)) {
                self = .code(language, plainText(content))
            } else {
                self = .other(node)
            }
        case "ink":
            self = attrs?["height"]?.number.map { .ink(height: $0) } ?? .other(node)
        default:
            self = .other(node)
        }
    }
}
