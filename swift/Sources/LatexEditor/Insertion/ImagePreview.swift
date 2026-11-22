import AppKit
import ImageIO
import PDFKit

/// Ein geladenes Bild für Vorschau und Bibliothek: Miniatur, Maße und Dateigröße.
struct ImagePreviewInfo: @unchecked Sendable {
    let image: NSImage
    /// Pixel bei Rastergrafiken, Punkte bei PDF und Vektoren
    let size: CGSize
    let isVector: Bool
    let byteCount: Int

    /// „1200 × 800 px“ bzw. „210 × 297 pt“
    var sizeText: String {
        "\(Int(size.width.rounded())) × \(Int(size.height.rounded())) \(isVector ? "pt" : "px")"
    }

    var byteText: String {
        ByteCountFormatter.string(fromByteCount: Int64(byteCount), countStyle: .file)
    }
}

enum ImagePreviewLoader {
    /// Längste Seite der Miniatur in Pixeln
    static let previewPixels: CGFloat = 640
    static let thumbnailPixels: CGFloat = 280

    /// Liest eine Miniatur; blockiert, deshalb nicht auf dem Main-Thread aufrufen. `nil`: nicht lesbar.
    static func load(_ url: URL, maxPixels: CGFloat = previewPixels) -> ImagePreviewInfo? {
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        if url.pathExtension.lowercased() == "pdf" { return loadPDF(url, maxPixels: maxPixels, bytes: bytes) }
        return loadRaster(url, maxPixels: maxPixels, bytes: bytes) ?? loadOther(url, bytes: bytes)
    }

    private static func loadRaster(_ url: URL, maxPixels: CGFloat, bytes: Int) -> ImagePreviewInfo? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? CGFloat,
              let height = properties[kCGImagePropertyPixelHeight] as? CGFloat else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let image = NSImage(cgImage: thumbnail, size: NSSize(width: thumbnail.width, height: thumbnail.height))
        return ImagePreviewInfo(image: image, size: CGSize(width: width, height: height), isVector: false, byteCount: bytes)
    }

    /// Erste Seite; die Größe ist die des Beschnitts (`\includegraphics` nimmt die Seite wie die Vorlage sie vorgibt)
    private static func loadPDF(_ url: URL, maxPixels: CGFloat, bytes: Int) -> ImagePreviewInfo? {
        guard let page = PDFDocument(url: url)?.page(at: 0) else { return nil }
        let bounds = page.bounds(for: .cropBox)
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        let scale = maxPixels / max(bounds.width, bounds.height)
        let image = page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .cropBox)
        return ImagePreviewInfo(image: image, size: bounds.size, isVector: true, byteCount: bytes)
    }

    /// SVG, EPS … soweit macOS sie darstellen kann
    private static func loadOther(_ url: URL, bytes: Int) -> ImagePreviewInfo? {
        guard let image = NSImage(contentsOf: url), image.size.width > 0, image.size.height > 0 else { return nil }
        return ImagePreviewInfo(image: image, size: image.size, isVector: true, byteCount: bytes)
    }
}

/// Findet die Datei zu einem `\includegraphics`-Pfad: relativ zu Hauptdatei, Projekt und der Datei selbst, mit den
/// `\graphicspath`-Ordnern, mit und ohne Endung (LaTeX probiert die Endungen durch).
enum GraphicsResolver {
    static let extensions = ["pdf", "png", "jpg", "jpeg", "gif", "svg", "tif", "tiff", "eps"]

    static func resolve(
        _ path: String, bases: [URL], graphicsDirectories: [String],
        fileExists: (URL) -> Bool = { FileManager.default.fileExists(atPath: $0.path) }
    ) -> URL? {
        let trimmed = path.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let prefixes = [""] + graphicsDirectories
        let candidates = trimmed.hasPrefix("/") ? [URL(fileURLWithPath: trimmed)] : bases.flatMap { base in
            prefixes.map { base.appendingPathComponent($0 + trimmed) }
        }
        for candidate in candidates {
            if !candidate.pathExtension.isEmpty, fileExists(candidate), !FileOperations.isDirectory(candidate) { return candidate.standardizedFileURL }
            for fileExtension in extensions {
                let withExtension = URL(fileURLWithPath: candidate.path + "." + fileExtension)
                if fileExists(withExtension) { return withExtension.standardizedFileURL }
            }
        }
        return nil
    }

    /// Pfad im Text einer `\includegraphics`-Zeile an einer Stelle (UTF-16): Pfad und sein Bereich
    private static let expression = try! NSRegularExpression(pattern: #"\\includegraphics\*?\s*(?:\[[^\]\n]*\]\s*)?\{([^{}\n]+)\}"#)

    static func path(at location: Int, in text: NSString) -> (path: String, range: NSRange)? {
        guard location >= 0, location <= text.length else { return nil }
        let line = text.lineRange(for: NSRange(location: min(location, max(0, text.length - 1)), length: 0))
        guard line.length <= 2_000 else { return nil }
        let masked = LatexMasking.scannable(text.substring(with: line)) as NSString
        for match in expression.matches(in: masked as String, range: NSRange(location: 0, length: masked.length)) {
            let range = match.range(at: 1)
            let absolute = NSRange(location: range.location + line.location, length: range.length)
            if location >= absolute.location, location <= NSMaxRange(absolute) {
                return (masked.substring(with: range), absolute)
            }
        }
        return nil
    }
}
