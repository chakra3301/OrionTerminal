// swift-tools-version: 6.0
import PackageDescription

// ArchivesCore  — pure, dependency-free heart: data model, sync payload, merge
//                 engine, Multipeer transport. Stays free of GRDB so the merge
//                 logic is unit-testable in isolation.
// ArchivesStore — the GRDB persistence layer (the phone's local DB + reading the
//                 desktop's orion.db). Depends on ArchivesCore + GRDB.
let package = Package(
    name: "ArchivesCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ArchivesCore", targets: ["ArchivesCore"]),
        .library(name: "ArchivesStore", targets: ["ArchivesStore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift", from: "6.0.0"),
    ],
    targets: [
        .target(name: "ArchivesCore"),
        .target(
            name: "ArchivesStore",
            dependencies: [
                "ArchivesCore",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        .testTarget(name: "ArchivesCoreTests", dependencies: ["ArchivesCore"]),
        .testTarget(name: "ArchivesStoreTests", dependencies: ["ArchivesStore"]),
    ]
)
