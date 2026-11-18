// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NotesKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [.library(name: "NotesKit", targets: ["NotesKit"])],
    targets: [
        .target(name: "NotesKit"),
        .testTarget(name: "NotesKitTests", dependencies: ["NotesKit"]),
    ]
)
