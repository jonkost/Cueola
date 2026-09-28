// swift-tools-version:5.9
// Outrangutan for Mac. Build the app with ./build-app.sh (see README.md).
import PackageDescription

let package = Package(
    name: "Outrangutan",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Outrangutan",
            path: "Sources/Outrangutan"
        ),
        .testTarget(
            name: "OutrangutanTests",
            dependencies: ["Outrangutan"],
            path: "Tests/OutrangutanTests"
        )
    ]
)
