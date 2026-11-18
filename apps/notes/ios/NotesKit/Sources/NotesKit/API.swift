import Foundation

public enum APIError: Error, Equatable, Sendable {
    /// The server answered and said no, so sending the same thing again will not help.
    case refused(status: Int, reason: String)
    /// The server could not be reached, or failed; worth trying again later.
    case unavailable(String)
}

/// The notes server, as this app talks to it; tests use a fake.
public protocol NotesAPI: Sendable {
    func notebooks() async throws(APIError) -> [Notebook]
    func pages() async throws(APIError) -> [PageSummary]
    func changes(page: UUID, since: Int) async throws(APIError) -> PageChanges
    func push(_ batch: Batch) async throws(APIError)
    func putImage(page: UUID, block: UUID, seq: Int, png: Data) async throws(APIError)
}

/// The server over HTTP. Who is asking is the device's Tailscale login, which `tailscale serve` adds on the way in.
public struct HTTPNotesAPI: NotesAPI {
    private let base: URL
    private let session: URLSession

    public init(base: URL, session: URLSession = .shared) {
        self.base = base
        self.session = session
    }

    private struct Refusal: Decodable { let error: String }

    private func url(_ path: String, _ query: [URLQueryItem] = []) -> URL {
        base.appending(path: "notes/api/\(path)").appending(queryItems: query)
    }

    private func send(_ request: URLRequest) async throws(APIError) -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw .unavailable(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw .unavailable("Not an HTTP response") }
        switch http.statusCode {
        case 200..<300:
            return data
        case 400..<500 where http.statusCode != 408 && http.statusCode != 429:
            let reason = (try? JSONDecoder().decode(Refusal.self, from: data))?.error ?? "Refused"
            throw .refused(status: http.statusCode, reason: reason)
        default:
            throw .unavailable("The server answered \(http.statusCode)")
        }
    }

    private func get<T: Decodable>(_ url: URL, as type: T.Type) async throws(APIError) -> T {
        let data = try await send(URLRequest(url: url))
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw .unavailable("Unreadable answer: \(error)")
        }
    }

    public func notebooks() async throws(APIError) -> [Notebook] {
        try await get(url("notebooks"), as: [Notebook].self)
    }

    public func pages() async throws(APIError) -> [PageSummary] {
        try await get(url("pages"), as: [PageSummary].self)
    }

    public func changes(page: UUID, since: Int) async throws(APIError) -> PageChanges {
        try await get(url("pages/\(page.wire)/changes", [URLQueryItem(name: "since", value: String(since))]), as: PageChanges.self)
    }

    public func push(_ batch: Batch) async throws(APIError) {
        var request = URLRequest(url: url("push"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(batch.key, forHTTPHeaderField: "Idempotency-Key")
        struct Body: Encodable { let mutations: [Mutation] }
        do {
            request.httpBody = try JSONEncoder().encode(Body(mutations: batch.mutations))
        } catch {
            throw .refused(status: 0, reason: "Could not encode the changes: \(error)")
        }
        _ = try await send(request)
    }

    public func putImage(page: UUID, block: UUID, seq: Int, png: Data) async throws(APIError) {
        var request = URLRequest(url: url("pages/\(page.wire)/blocks/\(block.wire)/image", [URLQueryItem(name: "seq", value: String(seq))]))
        request.httpMethod = "PUT"
        request.setValue("image/png", forHTTPHeaderField: "Content-Type")
        request.httpBody = png
        _ = try await send(request)
    }
}
