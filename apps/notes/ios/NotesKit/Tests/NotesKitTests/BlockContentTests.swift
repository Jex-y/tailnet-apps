import Foundation
import Testing
@testable import NotesKit

private func json(_ text: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
}

@Test("reads back every kind of block it writes", arguments: [
    BlockContent.paragraph("Let $x$ be real, and $y \\ne 0$."),
    .paragraph(""),
    .heading(.two, "Limits of $f$"),
    .math("\\int_0^1 x\\,dx"),
    .code(.ts, "const x: number = 1;"),
    .ink(height: 320),
])
func roundTrips(content: BlockContent) {
    #expect(BlockContent(node: content.node) == content)
}

@Test func splitsInlineMathsAsTheServerDoes() throws {
    #expect(BlockContent.paragraph("a $ b\n $c$").node == (try json("""
    {"type":"paragraph","content":[{"type":"text","text":"a $ b\\n "},{"type":"math_inline","content":[{"type":"text","text":"c"}]}]}
    """)))
    #expect(BlockContent.paragraph("$x$$y$").node == (try json("""
    {"type":"paragraph","content":[{"type":"math_inline","content":[{"type":"text","text":"x"}]},{"type":"math_inline","content":[{"type":"text","text":"y"}]}]}
    """)))
}

@Test("keeps what it cannot edit exactly as it came", arguments: [
    #"{"type":"paragraph","content":[{"type":"text","text":"bold","marks":[{"type":"strong"}]}]}"#,
    #"{"type":"bullet_list","content":[{"type":"list_item","content":[{"type":"paragraph"}]}]}"#,
    #"{"type":"heading","attrs":{"level":5},"content":[]}"#,
])
func keepsOther(node: String) throws {
    let parsed = try json(node)
    #expect(BlockContent(node: parsed) == .other(parsed))
    #expect(BlockContent(node: parsed).node == parsed)
}
