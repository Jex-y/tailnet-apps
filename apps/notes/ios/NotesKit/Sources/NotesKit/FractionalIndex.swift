/// Order keys exactly as the server's `fractional-indexing` makes them, so keys from either side interleave: base 62,
/// an integer part whose head letter gives its length, and a fraction with no trailing zero.
public enum FractionalIndex {
    public enum Failure: Error, Equatable {
        case invalidKey(String)
        case notAscending(String, String)
        case exhausted
    }

    private static let digits = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".utf8)
    private static let zero = digits[0]
    private static let last = digits[digits.count - 1]
    private static let lowerA = UInt8(ascii: "a")
    private static let lowerZ = UInt8(ascii: "z")
    private static let upperA = UInt8(ascii: "A")
    private static let upperZ = UInt8(ascii: "Z")

    private static func value(_ digit: UInt8) -> Int {
        digits.firstIndex(of: digit) ?? 0
    }

    /// A key that sorts after `before` and before `after`; either may be nil for the start or end.
    public static func between(_ before: String?, _ after: String?) throws(Failure) -> String {
        let a = before.map { Array($0.utf8) }
        let b = after.map { Array($0.utf8) }
        if let a { try validate(a) }
        if let b { try validate(b) }
        if let a, let b, !a.lexicographicallyPrecedes(b) {
            throw .notAscending(String(decoding: a, as: UTF8.self), String(decoding: b, as: UTF8.self))
        }
        return String(decoding: try keyBetween(a, b), as: UTF8.self)
    }

    private static func keyBetween(_ a: [UInt8]?, _ b: [UInt8]?) throws(Failure) -> [UInt8] {
        switch (a, b) {
        case (nil, nil):
            return [lowerA, zero]
        case let (nil, b?):
            let ib = try integerPart(b)
            let fb = Array(b[ib.count...])
            if ib == smallestInteger {
                return ib + (try midpoint([], fb))
            }
            if ib.lexicographicallyPrecedes(b) {
                return ib
            }
            guard let decremented = try decrement(ib) else { throw .exhausted }
            return decremented
        case let (a?, nil):
            let ia = try integerPart(a)
            let fa = Array(a[ia.count...])
            if let incremented = try increment(ia) {
                return incremented
            }
            return ia + (try midpoint(fa, nil))
        case let (a?, b?):
            let ia = try integerPart(a)
            let fa = Array(a[ia.count...])
            let ib = try integerPart(b)
            let fb = Array(b[ib.count...])
            if ia == ib {
                return ia + (try midpoint(fa, fb))
            }
            guard let incremented = try increment(ia) else { throw .exhausted }
            if incremented.lexicographicallyPrecedes(b) {
                return incremented
            }
            return ia + (try midpoint(fa, nil))
        }
    }

    private static let smallestInteger = [upperA] + Array(repeating: zero, count: 26)

    private static func midpoint(_ a: [UInt8], _ b: [UInt8]?) throws(Failure) -> [UInt8] {
        if let b, !a.lexicographicallyPrecedes(b) {
            throw .notAscending(String(decoding: a, as: UTF8.self), String(decoding: b, as: UTF8.self))
        }
        if a.last == zero || b?.last == zero {
            throw .invalidKey("trailing zero")
        }
        if let b {
            var n = 0
            while n < b.count, (n < a.count ? a[n] : zero) == b[n] {
                n += 1
            }
            if n > 0 {
                return Array(b[..<n]) + (try midpoint(Array(a[min(n, a.count)...]), Array(b[n...])))
            }
        }
        let digitA = a.first.map(value) ?? 0
        let digitB = b.map { value($0[0]) } ?? digits.count
        if digitB - digitA > 1 {
            return [digits[(digitA + digitB + 1) / 2]]
        }
        if let b, b.count > 1 {
            return [b[0]]
        }
        return [digits[digitA]] + (try midpoint(Array(a.dropFirst()), nil))
    }

    private static func integerLength(_ head: UInt8) throws(Failure) -> Int {
        if head >= lowerA && head <= lowerZ { return Int(head - lowerA) + 2 }
        if head >= upperA && head <= upperZ { return Int(upperZ - head) + 2 }
        throw .invalidKey("head \(Character(Unicode.Scalar(head)))")
    }

    private static func integerPart(_ key: [UInt8]) throws(Failure) -> [UInt8] {
        let length = try integerLength(key[0])
        guard length <= key.count else { throw .invalidKey(String(decoding: key, as: UTF8.self)) }
        return Array(key[..<length])
    }

    private static func validate(_ key: [UInt8]) throws(Failure) {
        guard !key.isEmpty, key != smallestInteger, key.allSatisfy(digits.contains) else {
            throw .invalidKey(String(decoding: key, as: UTF8.self))
        }
        let integer = try integerPart(key)
        if key.count > integer.count && key.last == zero {
            throw .invalidKey(String(decoding: key, as: UTF8.self))
        }
    }

    private static func increment(_ x: [UInt8]) throws(Failure) -> [UInt8]? {
        guard x.count == (try integerLength(x[0])) else { throw .invalidKey(String(decoding: x, as: UTF8.self)) }
        let head = x[0]
        var trailing: [UInt8] = []
        for i in stride(from: x.count - 1, through: 1, by: -1) {
            let d = value(x[i]) + 1
            if d == digits.count {
                trailing.insert(zero, at: 0)
            } else {
                return [head] + Array(x[1..<i]) + [digits[d]] + trailing
            }
        }
        if head == upperZ { return [lowerA, zero] }
        if head == lowerZ { return nil }
        let next = head + 1
        return [next] + (next > lowerA ? trailing + [zero] : Array(trailing.dropFirst()))
    }

    private static func decrement(_ x: [UInt8]) throws(Failure) -> [UInt8]? {
        guard x.count == (try integerLength(x[0])) else { throw .invalidKey(String(decoding: x, as: UTF8.self)) }
        let head = x[0]
        var trailing: [UInt8] = []
        for i in stride(from: x.count - 1, through: 1, by: -1) {
            let d = value(x[i]) - 1
            if d == -1 {
                trailing.insert(last, at: 0)
            } else {
                return [head] + Array(x[1..<i]) + [digits[d]] + trailing
            }
        }
        if head == lowerA { return [upperZ, last] }
        if head == upperA { return nil }
        let previous = head - 1
        return [previous] + (previous < upperZ ? trailing + [last] : Array(trailing.dropFirst()))
    }
}
