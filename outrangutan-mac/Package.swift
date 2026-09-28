// swift-tools-version:5.9
// Outrangutan for Mac. Build the app with ./build-app.sh (see README.md).
import PackageDescription

let package = Package(
    name: "Outrangutan",
    platforms: [.macOS(.v14)],
    targets: [
        // The rules for talking to the rundown and KeyWi Bird. No screen and no
        // network in here, so the tests can check every rule on their own.
        .target(
            name: "OutrangutanCore",
            path: "Sources/OutrangutanCore"
        ),
        .executableTarget(
            name: "Outrangutan",
            dependencies: ["OutrangutanCore"],
            path: "Sources/Outrangutan"
        ),
        .testTarget(
            name: "OutrangutanTests",
            dependencies: ["OutrangutanCore"],
            path: "Tests/OutrangutanTests"
        )
    ]
)
