import Foundation
import Testing
@testable import NotesKit

private let page = UUID()

private func stroke() -> Stroke {
    Stroke(tool: .pen, color: "#000000", width: 2, points: [InkPoint(x: 1, y: 2, t: 0, pressure: 0.5, azimuth: 0, altitude: 1)])
}

private func put(_ block: Block) -> Mutation { .putBlock(page: page, block) }

@Suite struct OutboxTests {
    @Test func keepsOneQueuedWriteOfABlockBeingTyped() {
        let block = Block(order: "a0", content: .paragraph("L"))
        let outbox = Outbox.empty
            .queuing(put(block))
            .queuing(put(Block(id: block.id, order: "a0", content: .paragraph("Le"))))
            .queuing(put(Block(id: block.id, order: "a0", content: .paragraph("Let"))))

        #expect(outbox.queued == [put(Block(id: block.id, order: "a0", content: .paragraph("Let")))])
    }

    @Test func keepsWritesApartWhenSomethingCameBetween() {
        let block = Block(order: "a0", content: .ink(height: 300))
        let drawn = Mutation.addStroke(page: page, block: block.id, stroke())
        let taller = put(Block(id: block.id, order: "a0", content: .ink(height: 500)))

        #expect(Outbox.empty.queuing(put(block)).queuing(drawn).queuing(taller).queued == [put(block), drawn, taller])
    }

    @Test func resendsASealedBatchUnderTheSameKey() {
        let first = Outbox.empty.queuing(.deletePage(UUID())).sealing(key: { "one" })
        let again = first.outbox.queuing(.deletePage(UUID())).sealing(key: { "two" })

        #expect(again.batch == first.batch)
        #expect(again.outbox.queued.count == 1)
        #expect(again.outbox.answered("one").sealing(key: { "two" }).batch?.key == "two")
    }

    @Test func roundTripsThroughJSON() throws {
        let block = Block(order: "a0", content: .ink(height: 300))
        let outbox = Outbox.empty.queuing(put(block)).queuing(.addStroke(page: page, block: block.id, stroke()))
            .sealing(key: { "k" }).outbox.queuing(.eraseStrokes(page: page, block: block.id, ids: [UUID()]))

        #expect(try JSONDecoder().decode(Outbox.self, from: JSONEncoder().encode(outbox)) == outbox)
    }
}

@Suite struct PageStateTests {
    @Test func ordersBlocksByKey() throws {
        let state = [("a1", "second"), ("a0", "first"), ("a0V", "between")].reduce(PageState.empty) { state, row in
            state.applying(put(Block(order: row.0, content: .paragraph(row.1))))
        }

        #expect(state.ordered.map(\.content) == [.paragraph("first"), .paragraph("between"), .paragraph("second")])
        #expect(try state.orderAtEnd() == "a2")
        let first = try #require(state.ordered.first)
        #expect(try state.order(after: first.id) == "a0G")
        #expect(try state.order(after: nil) == "Zz")
    }

    @Test func takesPulledChangesExceptWhereThisDeviceIsAhead() {
        let mine = Block(order: "a0", content: .paragraph("typed here"))
        let theirs = Block(order: "a1", content: .paragraph("written elsewhere"))
        let local = PageState.empty.applying(put(mine))
        let pulled = PageChanges(
            seq: 4,
            blocks: [.block(Block(id: mine.id, order: "a0", content: .paragraph("older"))), .block(theirs)],
            strokes: []
        )

        let state = local.applying(pulled, except: Pending([put(mine)]))

        #expect(state.seq == 4)
        #expect(state.ordered == [mine, theirs])
    }

    @Test func dueAnImageOnceTheServerHoldsTheStrokes() {
        let ink = Block(order: "a0", content: .ink(height: 300))
        let drawn = stroke()
        let pulled = PageState.empty.applying(put(ink)).applying(
            PageChanges(seq: 7, blocks: [.block(ink)], strokes: [.stroke(block: ink.id, drawn)]),
            except: Pending([])
        )

        #expect(pulled.imagesDue(except: Pending([.addStroke(page: page, block: ink.id, stroke())])) == [])
        let due = ImageDue(block: ink.id, seq: 7, height: 300, strokes: [drawn])
        #expect(pulled.imagesDue(except: Pending([])) == [due])
        #expect(pulled.rendering(due).imagesDue(except: Pending([])) == [])
    }

    @Test func erasesStrokesPulled() {
        let ink = Block(order: "a0", content: .ink(height: 300))
        let (a, b) = (stroke(), stroke())
        let drawn = PageState.empty.applying(
            PageChanges(seq: 3, blocks: [.block(ink)], strokes: [.stroke(block: ink.id, a), .stroke(block: ink.id, b)]),
            except: Pending([])
        )

        let erased = drawn.applying(PageChanges(seq: 4, blocks: [], strokes: [.erased(block: ink.id, id: a.id)]), except: Pending([]))

        #expect(erased.strokes[ink.id] == [b])
    }
}
