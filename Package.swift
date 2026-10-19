// swift-tools-version: 6.0
import PackageDescription

// Tests nur über scripts/test.sh starten: Swift Testing liegt bei reinen Command Line Tools
// außerhalb der Standard-Suchpfade, das Skript reicht die nötigen Flags durch.
let package = Package(
    name: "LatexEditor",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "LatexEditor",
            path: "Sources/LatexEditor"
        ),
        .testTarget(
            name: "LatexEditorTests",
            dependencies: ["LatexEditor"],
            path: "Tests/LatexEditorTests",
            resources: [.copy("Fixtures")]
        )
    ]
)
