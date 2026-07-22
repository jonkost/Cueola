// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "talkbackd",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "talkbackd",
            path: "Sources/talkbackd"
        )
    ]
)
