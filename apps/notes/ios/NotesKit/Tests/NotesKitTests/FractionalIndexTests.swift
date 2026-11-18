import Testing
@testable import NotesKit

@Test("makes every key the server's fractional-indexing makes", arguments: fractionalIndexVectors)
func matchesServer(before: String?, after: String?, expected: String) throws {
    #expect(try FractionalIndex.between(before, after) == expected)
}

@Test func refusesKeysOutOfOrder() {
    #expect(throws: FractionalIndex.Failure.notAscending("a1", "a0")) { try FractionalIndex.between("a1", "a0") }
}

@Test func refusesMalformedKeys() {
    #expect(throws: FractionalIndex.Failure.self) { try FractionalIndex.between("a10", nil) }
    #expect(throws: FractionalIndex.Failure.self) { try FractionalIndex.between("!", nil) }
}
