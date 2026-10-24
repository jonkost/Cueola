// swift-tools-version:5.9
// Vixel for Mac. Build the app with ./build-app.sh (see README.md).
import PackageDescription

let package = Package(
    name: "Vixel",
    platforms: [.macOS(.v14)],
    targets: [
        // The warp math and the saved setup. No screen in here, so the
        // tests can check every rule on their own.
        .target(
            name: "VixelCore",
            path: "Sources/VixelCore"
        ),
        .executableTarget(
            name: "Vixel",
            dependencies: ["VixelCore"],
            path: "Sources/Vixel"
        ),
        .testTarget(
            name: "VixelTests",
            dependencies: ["VixelCore"],
            path: "Tests/VixelTests"
        )
    ]
)
