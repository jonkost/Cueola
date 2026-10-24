import Foundation

/// Reading and writing the setup as a JSON file a person can open and read.
public enum SetupFile {
    /// Where the setup lives on this Mac:
    /// ~/Library/Application Support/Vixel/setup.json
    public static var standard: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Vixel", isDirectory: true).appendingPathComponent("setup.json")
    }

    public static func encode(_ setup: Setup) throws -> Data {
        var copy = setup
        copy.version = Setup.currentVersion
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(copy)
    }

    /// Reads a setup. A file from an older Vixel reads fine, and anything
    /// missing takes its usual value.
    public static func decode(_ data: Data) throws -> Setup {
        try JSONDecoder().decode(Setup.self, from: data)
    }

    /// The setup in the file, or nil if there is none or it cannot be read.
    public static func read(from url: URL) -> Setup? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decode(data)
    }

    /// Writes the whole file at once, so a crash mid-save never leaves half
    /// a file behind.
    public static func write(_ setup: Setup, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encode(setup).write(to: url, options: .atomic)
    }
}
