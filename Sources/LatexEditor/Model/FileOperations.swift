import Foundation

enum FileOperationError: LocalizedError, Equatable {
    case emptyName
    case invalidCharacters
    case nameTooLong
    case hiddenName
    case alreadyExists(String)
    case outsideProject
    case isProjectRoot
    case cannotMoveIntoItself
    case notFound(String)

    var errorDescription: String? {
        switch self {
        case .emptyName: "Der Name darf nicht leer sein."
        case .invalidCharacters: "Der Name darf weder „/“ noch „:“ oder „\\“ enthalten."
        case .nameTooLong: "Der Name ist zu lang."
        case .hiddenName: "Namen mit Punkt am Anfang sind versteckte Dateien und würden im Baum nicht erscheinen."
        case let .alreadyExists(name): "„\(name)“ existiert an dieser Stelle bereits."
        case .outsideProject: "Diese Datei liegt außerhalb des Projektordners."
        case .isProjectRoot: "Der Projektordner selbst kann hier nicht geändert werden."
        case .cannotMoveIntoItself: "Ein Ordner kann nicht in sich selbst verschoben werden."
        case let .notFound(name): "„\(name)“ wurde nicht gefunden."
        }
    }
}

/// Dateioperationen im Projekt. Alle Funktionen prüfen Namen und Ziel, bevor sie etwas ändern.
enum FileOperations {
    static let maximumNameLength = 120
    static let defaultExtension = "tex"
    private static let forbiddenCharacters = CharacterSet(charactersIn: "/:\\").union(.controlCharacters)

    // MARK: Namen

    /// Gibt den bereinigten Namen zurück oder wirft einen verständlichen Fehler.
    static func validateName(_ raw: String) throws -> String {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw FileOperationError.emptyName }
        guard name.rangeOfCharacter(from: forbiddenCharacters) == nil else { throw FileOperationError.invalidCharacters }
        guard name.count <= maximumNameLength else { throw FileOperationError.nameTooLong }
        guard !name.hasPrefix(".") else { throw FileOperationError.hiddenName }
        return name
    }

    /// Für neue Dateien: ohne Endung wird `.tex` ergänzt.
    static func newFileName(from raw: String) throws -> String {
        let name = try validateName(raw)
        return URL(fileURLWithPath: name).pathExtension.isEmpty ? "\(name).\(defaultExtension)" : name
    }

    /// Beim Umbenennen: Wer die Endung weglässt, behält die bisherige.
    static func renamedFileName(from raw: String, original: URL) throws -> String {
        let name = try validateName(raw)
        let originalExtension = original.pathExtension
        let hasExtension = !URL(fileURLWithPath: name).pathExtension.isEmpty
        return hasExtension || originalExtension.isEmpty || isDirectory(original) ? name : "\(name).\(originalExtension)"
    }

    /// Ziel `directory/name`. Existiert dort schon etwas anderes, ein Fehler; `replacing` ist die
    /// umzubenennende Datei selbst (Änderung nur der Groß-/Kleinschreibung ist erlaubt).
    static func destination(for name: String, in directory: URL, replacing: URL? = nil) throws -> URL {
        let target = directory.appendingPathComponent(name).standardizedFileURL
        guard FileManager.default.fileExists(atPath: target.path) else { return target }
        if let replacing, replacing.standardizedFileURL.path.lowercased() == target.path.lowercased() { return target }
        throw FileOperationError.alreadyExists(name)
    }

    // MARK: Anlegen

    @discardableResult
    static func createFile(named raw: String, in directory: URL, contents: String = "") throws -> URL {
        let target = try destination(for: try newFileName(from: raw), in: directory)
        try contents.write(to: target, atomically: true, encoding: .utf8)
        return target
    }

    @discardableResult
    static func createFolder(named raw: String, in directory: URL) throws -> URL {
        let target = try destination(for: try validateName(raw), in: directory)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
        return target
    }

    // MARK: Umbenennen, Duplizieren, Verschieben

    /// Benennt um (gleicher Ordner). Reine Groß-/Kleinschreibung läuft über einen Zwischennamen,
    /// weil das Dateisystem sie nicht unterscheidet.
    @discardableResult
    static func rename(_ url: URL, toFileName name: String) throws -> URL {
        let source = url.standardizedFileURL
        guard FileManager.default.fileExists(atPath: source.path) else { throw FileOperationError.notFound(source.lastPathComponent) }
        let target = try destination(for: name, in: source.deletingLastPathComponent(), replacing: source)
        guard target != source else { return source }
        if target.path.lowercased() == source.path.lowercased() {
            let temporary = source.deletingLastPathComponent().appendingPathComponent(".umbenennen-\(UUID().uuidString)")
            try FileManager.default.moveItem(at: source, to: temporary)
            try FileManager.default.moveItem(at: temporary, to: target)
        } else {
            try FileManager.default.moveItem(at: source, to: target)
        }
        return target
    }

    /// „name Kopie.tex“, bei Kollision „name Kopie 2.tex“, …
    @discardableResult
    static func duplicate(_ url: URL) throws -> URL {
        let source = url.standardizedFileURL
        guard FileManager.default.fileExists(atPath: source.path) else { throw FileOperationError.notFound(source.lastPathComponent) }
        let directory = source.deletingLastPathComponent()
        let stem = source.deletingPathExtension().lastPathComponent
        let fileExtension = source.pathExtension
        var number = 1
        var target: URL
        repeat {
            let suffix = number == 1 ? " Kopie" : " Kopie \(number)"
            target = directory.appendingPathComponent(stem + suffix + (fileExtension.isEmpty ? "" : ".\(fileExtension)"))
            number += 1
        } while FileManager.default.fileExists(atPath: target.path)
        try FileManager.default.copyItem(at: source, to: target)
        return target.standardizedFileURL
    }

    /// Prüft ein Verschieben, ohne etwas zu ändern, und liefert das Ziel.
    static func validateMove(_ url: URL, into folder: URL, projectRoot: URL) throws -> URL {
        let source = url.standardizedFileURL
        let directory = folder.standardizedFileURL
        let root = projectRoot.standardizedFileURL
        guard source != root else { throw FileOperationError.isProjectRoot }
        guard isInside(source, root: root), isInside(directory, root: root) || directory == root else {
            throw FileOperationError.outsideProject
        }
        guard directory.path != source.path, !directory.path.hasPrefix(source.path + "/") else {
            throw FileOperationError.cannotMoveIntoItself
        }
        if source.deletingLastPathComponent() == directory { return source }
        return try destination(for: source.lastPathComponent, in: directory)
    }

    @discardableResult
    static func move(_ url: URL, into folder: URL, projectRoot: URL) throws -> URL {
        let source = url.standardizedFileURL
        let target = try validateMove(source, into: folder, projectRoot: projectRoot)
        guard target != source else { return source }
        try FileManager.default.moveItem(at: source, to: target)
        return target
    }

    // MARK: Hilfen

    static func isInside(_ url: URL, root: URL) -> Bool {
        url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/")
    }

    static func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
    }

    /// Ordner, in dem „Neue Datei“ landet: ein gewählter Ordner, sonst der Ordner der gewählten Datei.
    static func targetFolder(for selection: URL?, projectRoot: URL) -> URL {
        guard let selection else { return projectRoot }
        return isDirectory(selection) ? selection : selection.deletingLastPathComponent()
    }
}
