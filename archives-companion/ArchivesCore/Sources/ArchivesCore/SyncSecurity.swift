import Foundation
import CryptoKit
import Security

public enum SyncSafetyError: LocalizedError {
    case invalid(String)
    public var errorDescription: String? {
        switch self { case .invalid(let message): return message }
    }
}

public enum PairingSecret {
    private static let service = "com.lucaorion.archives.pairing.v2"
    public static func load() throws -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "peer",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw SyncSafetyError.invalid("Pairing keychain unavailable (\(status)).")
        }
        return value
    }
    public static func save(_ value: String) throws {
        _ = try key(value)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "peer"]
        let data = Data(value.lowercased().utf8)
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw SyncSafetyError.invalid("Couldn't save pairing key (\(status)).") }
    }
    public static func generate() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw SyncSafetyError.invalid("Secure random generator unavailable.")
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
    static func key(_ value: String) throws -> SymmetricKey {
        let chars = Array(value.utf8)
        guard chars.count == 64, chars.allSatisfy({ (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0) }) else {
            throw SyncSafetyError.invalid("Paste the 64-character pairing key from Archives Sync on your Mac.")
        }
        var bytes = [UInt8]()
        for i in stride(from: 0, to: chars.count, by: 2) {
            bytes.append(UInt8(String(decoding: chars[i...i+1], as: UTF8.self), radix: 16)!)
        }
        return SymmetricKey(data: bytes)
    }
}

struct AuthenticatedPacket: Codable {
    let version: Int
    let challenge: String
    let sequence: UInt64
    let body: Data
}

public struct SecureChannel {
    public static let maxPacketBytes = 32_000_000
    public let challenge: String
    private let key: SymmetricKey
    private let role: Role
    public enum Role { case phone, mac }
    private var sent: UInt64 = 0
    private var received: UInt64 = 0
    public init(secret: String, role: Role, challenge: String = UUID().uuidString) throws {
        key = try PairingSecret.key(secret)
        self.role = role
        self.challenge = challenge
    }
    public mutating func seal(_ body: Data, recipientChallenge: String) throws -> Data {
        guard body.count <= 24_000_000, recipientChallenge.count == 36, sent < UInt64.max else {
            throw SyncSafetyError.invalid("Sync message exceeds the transfer limit.")
        }
        sent += 1
        let packet = AuthenticatedPacket(version: 2, challenge: recipientChallenge, sequence: sent, body: body)
        return try AES.GCM.seal(JSONEncoder().encode(packet), using: key, authenticating: Data((role == .phone ? "from-phone-v2" : "from-mac-v2").utf8)).combined!
    }
    public mutating func open(_ data: Data) throws -> Data {
        guard data.count <= Self.maxPacketBytes else { throw SyncSafetyError.invalid("Sync message too large.") }
        let clear = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key, authenticating: Data((role == .phone ? "from-mac-v2" : "from-phone-v2").utf8))
        let packet = try JSONDecoder().decode(AuthenticatedPacket.self, from: clear)
        guard packet.version == 2, packet.challenge == challenge, packet.sequence > received else {
            throw SyncSafetyError.invalid("Rejected stale or incompatible sync message.")
        }
        received = packet.sequence
        return packet.body
    }
}

public enum AssetSafety {
    public static let maxBytes = 8_000_000
    public static func validName(_ name: String) -> Bool {
        !name.isEmpty && name.utf8.count <= 180 && name != "." && name != ".."
            && name.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0) }
    }
    public static func url(_ name: String, in directory: URL) throws -> URL {
        guard validName(name) else { throw SyncSafetyError.invalid("Invalid asset filename.") }
        let root = directory.standardizedFileURL.resolvingSymlinksInPath()
        let dest = root.appendingPathComponent(name)
        let attributes = try? FileManager.default.attributesOfItem(atPath: dest.path)
        guard attributes?[.type] as? FileAttributeType != .typeSymbolicLink,
              dest.resolvingSymlinksInPath().deletingLastPathComponent() == root else {
            throw SyncSafetyError.invalid("Asset path escapes its library.")
        }
        return dest
    }
    public static func read(_ url: URL) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size <= maxBytes else { throw SyncSafetyError.invalid("Only regular images up to 8 MB can sync.") }
        let data = try Data(contentsOf: url)
        guard data.count <= maxBytes else { throw SyncSafetyError.invalid("Image exceeds 8 MB.") }
        return data
    }
    public static func publish(_ data: Data, name: String, in directory: URL) throws {
        guard !data.isEmpty, data.count <= maxBytes else { throw SyncSafetyError.invalid("Invalid image size.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        let dest = try url(name, in: directory)
        if FileManager.default.fileExists(atPath: dest.path) {
            guard try read(dest) == data else { throw SyncSafetyError.invalid("Image filename conflict; existing file preserved.") }
            return
        }
        let temporary = directory.appendingPathComponent(".incoming-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard FileManager.default.createFile(atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600]) else {
            throw SyncSafetyError.invalid("Couldn't stage incoming image.")
        }
        try FileManager.default.linkItem(at: temporary, to: dest)
    }
}
