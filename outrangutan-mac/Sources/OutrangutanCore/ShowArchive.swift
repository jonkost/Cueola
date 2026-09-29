import Foundation

/// The .ogshow show file, the same one the web Outrangutan saves: a plain
/// zip with nothing squeezed ("store"). Inside are show.json (the cue list,
/// the pads and a list of media) and a media folder with each file as it is.
/// Media is copied in slices, so a show with hours of video never has to fit
/// in memory. Classic zip, so a show file tops out at 4 GB, like the web's.
public enum ShowArchive {
    public static let fileExtension = "ogshow"
    static let most: UInt64 = 0xFFFF_FFFE
    static let slice = 4 * 1024 * 1024

    public enum Failure: Error, Equatable {
        case tooBig
        case notAZip
        case missing(String)
        case squeezedFormat
    }

    /// Writes a zip one entry at a time.
    public final class Writer {
        private let handle: FileHandle
        private var central = Data()
        private var count: UInt16 = 0
        private let time: UInt16, date: UInt16

        public init(url: URL) throws {
            FileManager.default.createFile(atPath: url.path, contents: nil)
            handle = try FileHandle(forWritingTo: url)
            try handle.truncate(atOffset: 0)
            (time, date) = ShowArchive.dosTime(Date())
        }

        /// Adds a small entry from memory, like show.json.
        public func add(name: String, data: Data) throws {
            try add(name: name, size: UInt64(data.count)) { write in try write(data) }
        }

        /// Adds a file, copied in slices. `progress` hears how many bytes
        /// have gone in so far.
        public func add(name: String, file: URL, progress: ((UInt64) -> Void)? = nil) throws {
            let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.uint64Value ?? 0
            let reader = try FileHandle(forReadingFrom: file)
            defer { try? reader.close() }
            try add(name: name, size: size) { write in
                var done: UInt64 = 0
                while let chunk = try reader.read(upToCount: ShowArchive.slice), !chunk.isEmpty {
                    try write(chunk)
                    done += UInt64(chunk.count)
                    progress?(done)
                }
            }
        }

        /// Writes the zip's table of contents and closes the file.
        public func finish() throws {
            let start = try handle.offset()
            guard start + UInt64(central.count) <= ShowArchive.most else { throw Failure.tooBig }
            try handle.write(contentsOf: central)
            var end = Data()
            end.le32(0x0605_4B50)
            end.le16(0); end.le16(0)
            end.le16(count); end.le16(count)
            end.le32(UInt32(central.count))
            end.le32(UInt32(start))
            end.le16(0)
            try handle.write(contentsOf: end)
            try handle.close()
        }

        private func add(name: String, size: UInt64, body: ((Data) throws -> Void) throws -> Void) throws {
            let offset = try handle.offset()
            guard size <= ShowArchive.most, offset + size <= ShowArchive.most else { throw Failure.tooBig }
            let nameBytes = Data(name.utf8)
            // The local header goes first with a blank checksum; it is filled
            // in once the data has been read through.
            var local = Data()
            local.le32(0x0403_4B50)
            local.le16(20); local.le16(0x0800); local.le16(0)
            local.le16(time); local.le16(date)
            local.le32(0)
            local.le32(UInt32(size)); local.le32(UInt32(size))
            local.le16(UInt16(nameBytes.count)); local.le16(0)
            local.append(nameBytes)
            try handle.write(contentsOf: local)
            var crc = CRC32()
            try body { chunk in
                crc.update(chunk)
                try handle.write(contentsOf: chunk)
            }
            let after = try handle.offset()
            try handle.seek(toOffset: offset + 14)
            var sum = Data(); sum.le32(crc.value)
            try handle.write(contentsOf: sum)
            try handle.seek(toOffset: after)

            central.le32(0x0201_4B50)
            central.le16(20); central.le16(20); central.le16(0x0800); central.le16(0)
            central.le16(time); central.le16(date)
            central.le32(crc.value)
            central.le32(UInt32(size)); central.le32(UInt32(size))
            central.le16(UInt16(nameBytes.count)); central.le16(0); central.le16(0)
            central.le16(0); central.le16(0); central.le32(0)
            central.le32(UInt32(offset))
            central.append(nameBytes)
            count += 1
        }
    }

    /// Reads a zip's entries.
    public final class Reader {
        struct Entry { let method: UInt16; let size: UInt64; let headerAt: UInt64 }
        private let handle: FileHandle
        private var entries: [String: Entry] = [:]

        public init(url: URL) throws {
            handle = try FileHandle(forReadingFrom: url)
            let length = try handle.seekToEnd()
            let tailSize = min(length, 65_558)
            try handle.seek(toOffset: length - tailSize)
            let tail = try handle.read(upToCount: Int(tailSize)) ?? Data()
            guard tail.count >= 22,
                  let end = stride(from: tail.count - 22, through: 0, by: -1).first(where: { tail.u32($0) == 0x0605_4B50 })
            else { throw Failure.notAZip }
            let count = Int(tail.u16(end + 10))
            let cdSize = Int(tail.u32(end + 12)), cdStart = UInt64(tail.u32(end + 16))
            try handle.seek(toOffset: cdStart)
            let cd = try handle.read(upToCount: cdSize) ?? Data()
            var p = 0
            for _ in 0..<count {
                guard p + 46 <= cd.count, cd.u32(p) == 0x0201_4B50 else { break }
                let nameLen = Int(cd.u16(p + 28)), extra = Int(cd.u16(p + 30)), comment = Int(cd.u16(p + 32))
                guard p + 46 + nameLen <= cd.count else { break }
                let name = String(decoding: cd.subdata(in: (cd.startIndex + p + 46)..<(cd.startIndex + p + 46 + nameLen)), as: UTF8.self)
                entries[name] = Entry(method: cd.u16(p + 10), size: UInt64(cd.u32(p + 20)), headerAt: UInt64(cd.u32(p + 42)))
                p += 46 + nameLen + extra + comment
            }
        }

        deinit { try? handle.close() }

        public var names: [String] { Array(entries.keys) }
        public func has(_ name: String) -> Bool { entries[name] != nil }

        /// A small entry, read into memory.
        public func data(_ name: String) throws -> Data {
            guard let e = entries[name] else { throw Failure.missing(name) }
            try seekToData(e)
            let raw = try handle.read(upToCount: Int(e.size)) ?? Data()
            return try unpack(raw, method: e.method)
        }

        /// Copies an entry out to a file, in slices.
        public func extract(_ name: String, to url: URL, progress: ((UInt64) -> Void)? = nil) throws {
            guard let e = entries[name] else { throw Failure.missing(name) }
            FileManager.default.createFile(atPath: url.path, contents: nil)
            let out = try FileHandle(forWritingTo: url)
            defer { try? out.close() }
            try seekToData(e)
            if e.method != 0 {
                // Someone zipped the show again with squeezing on. Small
                // entries still open; media that big is not worth the memory.
                guard e.size < 512 * 1024 * 1024 else { throw Failure.squeezedFormat }
                let raw = try handle.read(upToCount: Int(e.size)) ?? Data()
                try out.write(contentsOf: try unpack(raw, method: e.method))
                return
            }
            var left = e.size
            while left > 0 {
                guard let chunk = try handle.read(upToCount: Int(min(UInt64(ShowArchive.slice), left))), !chunk.isEmpty else { break }
                try out.write(contentsOf: chunk)
                left -= UInt64(chunk.count)
                progress?(e.size - left)
            }
        }

        public func size(_ name: String) -> UInt64 { entries[name]?.size ?? 0 }

        private func seekToData(_ e: Entry) throws {
            try handle.seek(toOffset: e.headerAt)
            let header = try handle.read(upToCount: 30) ?? Data()
            guard header.count == 30, header.u32(0) == 0x0403_4B50 else { throw Failure.notAZip }
            try handle.seek(toOffset: e.headerAt + 30 + UInt64(header.u16(26)) + UInt64(header.u16(28)))
        }

        private func unpack(_ raw: Data, method: UInt16) throws -> Data {
            switch method {
            case 0: return raw
            case 8:
                guard let out = try? (raw as NSData).decompressed(using: .zlib) as Data else { throw Failure.squeezedFormat }
                return out
            default: throw Failure.squeezedFormat
            }
        }
    }

    static func dosTime(_ d: Date) -> (UInt16, UInt16) {
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day, .hour, .minute, .second], from: d)
        let time = UInt16((c.hour ?? 0) << 11 | (c.minute ?? 0) << 5 | (c.second ?? 0) >> 1)
        let date = UInt16(((c.year ?? 1980) - 1980) & 0x7F) << 9 | UInt16((c.month ?? 1) << 5 | (c.day ?? 1))
        return (time, date)
    }
}

/// The zip checksum.
public struct CRC32 {
    private static let table: [UInt32] = (0..<256).map { n in
        var c = UInt32(n)
        for _ in 0..<8 { c = (c & 1) != 0 ? (0xEDB8_8320 ^ (c >> 1)) : (c >> 1) }
        return c
    }
    private var crc: UInt32 = 0xFFFF_FFFF
    public init() {}
    public mutating func update(_ data: Data) {
        var c = crc
        data.withUnsafeBytes { (buf: UnsafeRawBufferPointer) in
            for b in buf { c = CRC32.table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        }
        crc = c
    }
    public var value: UInt32 { crc ^ 0xFFFF_FFFF }
}

extension Data {
    mutating func le16(_ v: UInt16) { Swift.withUnsafeBytes(of: v.littleEndian) { append(contentsOf: $0) } }
    mutating func le32(_ v: UInt32) { Swift.withUnsafeBytes(of: v.littleEndian) { append(contentsOf: $0) } }
    func u16(_ i: Int) -> UInt16 { UInt16(self[startIndex + i]) | UInt16(self[startIndex + i + 1]) << 8 }
    func u32(_ i: Int) -> UInt32 { UInt32(u16(i)) | UInt32(u16(i + 2)) << 16 }
}
