import JavaScriptCore

/// What running a snippet printed, or why it stopped.
struct CodeOutput: Sendable {
    let text: String
    let failed: Bool

    private final class Lines: @unchecked Sendable {
        var lines: [String] = []
    }

    /// Runs `source` in a fresh JavaScriptCore context, off the main thread, with `console.log` printing.
    static func run(_ source: String) async -> CodeOutput {
        await Task.detached {
            guard let context = JSContext() else { return CodeOutput(text: "JavaScript is unavailable", failed: true) }
            let printed = Lines()
            let log: @convention(block) () -> Void = {
                let arguments = (JSContext.currentArguments() as? [JSValue]) ?? []
                printed.lines.append(arguments.map { $0.toString() ?? "" }.joined(separator: " "))
            }
            context.evaluateScript("var console = {}")
            context.objectForKeyedSubscript("console").setObject(log, forKeyedSubscript: "log" as NSString)
            let result = context.evaluateScript(source)
            if let exception = context.exception {
                return CodeOutput(text: (printed.lines + [exception.toString() ?? "Error"]).joined(separator: "\n"), failed: true)
            }
            let value = result.flatMap { $0.isUndefined ? nil : $0.toString() }
            let lines = printed.lines + (value.map { [$0] } ?? [])
            return CodeOutput(text: lines.isEmpty ? "(no output)" : lines.joined(separator: "\n"), failed: false)
        }.value
    }
}
