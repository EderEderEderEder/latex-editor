import SwiftUI

/// „Einfügen“: Schnellzugriff auf die Bausteine; ein Klick auf das Symbol öffnet das Fenster mit dem
/// zuletzt gewählten Baustein.
struct InsertMenu: View {
    let model: AppModel

    var body: some View {
        Menu {
            Button("Einfügeoptionen …", systemImage: "slider.horizontal.3") { model.presentInsert() }
            Divider()
            ForEach(InsertionKind.allCases) { kind in
                Button(kind.title, systemImage: kind.symbolName) { model.presentInsert(kind) }
                    .disabled(!model.canPresentInsert(kind))
            }
        } label: {
            // Nicht „plus.square.on.square“: Das steht unter macOS meist für „Duplizieren“.
            Label("Einfügen", systemImage: "plus")
        } primaryAction: {
            model.presentInsert()
        }
        .menuIndicator(.visible)
        .disabled(model.project.rootURL == nil)
        .help("Tabelle, Bild, Codeblock … einfügen")
    }
}

/// „Kompilieren“ (⌘B); während eines Builds „Abbrechen“ (⌘.). Die Option „Beim Speichern kompilieren“ liegt im Menü Ablage.
struct CompileButton: View {
    let model: AppModel

    private var isRunning: Bool { model.build.status == .running }

    var body: some View {
        if isRunning {
            Button("Abbrechen", systemImage: "xmark.circle") { model.build.cancelBuild() }
                .help("Kompilieren abbrechen (⌘.)")
        } else {
            Button("Kompilieren", systemImage: "hammer") { model.compile() }
                .disabled(model.project.mainFileURL == nil)
                .help("Kompilieren (⌘B)")
        }
    }
}

/// Status des letzten Builds (auch „noch nicht kompiliert“); ein Klick zeigt die Meldungen in der Seitenleiste.
struct BuildStatusView: View {
    let build: BuildStore
    let sidebar: SidebarStore

    var body: some View {
        Button {
            sidebar.tab = .issues
        } label: {
            HStack(spacing: 5) {
                indicator
                Text(title)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            .font(.callout)
            .padding(.horizontal, 6)
        }
        .buttonStyle(.plain)
        .help(help)
    }

    @ViewBuilder
    private var indicator: some View {
        switch build.status {
        case .running:
            ProgressView().controlSize(.small)
        case .succeeded:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
        case .cancelled:
            Image(systemName: "stop.circle.fill").foregroundStyle(.secondary)
        case .unavailable:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        case .idle:
            Image(systemName: "hammer").foregroundStyle(.secondary)
        }
    }

    private var title: String {
        switch build.status {
        // Ein vorhandenes PDF kann älter sein als der Text; das soll man sehen
        case .idle: "Noch nicht kompiliert"
        case .running: "Kompiliert …"
        case .succeeded: build.warningCount == 0 ? "Erfolgreich" : "Erfolgreich · \(warnings)"
        case .failed: "\(build.errorCount) Fehler · \(warnings)"
        case .cancelled: "Abgebrochen"
        case .unavailable: "MacTeX fehlt"
        }
    }

    private var warnings: String {
        build.warningCount == 1 ? "1 Warnung" : "\(build.warningCount) Warnungen"
    }

    private var help: String {
        switch build.status {
        case let .unavailable(message): return message
        case .idle: return "Seit dem Öffnen des Projekts wurde nicht kompiliert, das PDF kann veraltet sein. ⌘B kompiliert."
        case .cancelled: return "Das Kompilieren wurde abgebrochen. Meldungen und PDF stammen vom Build davor."
        default: return "Meldungen in der Seitenleiste anzeigen"
        }
    }
}

/// Branch-Menü: aktueller Branch mit ↑/↓ (Stand des letzten Abrufs, die App fragt nie selbst beim
/// Remote nach), Branches wechseln und anlegen, Abrufen, Pull und Push.
struct BranchMenu: View {
    let model: AppModel
    let createBranch: () -> Void

    private var git: GitStore { model.git }

    var body: some View {
        Menu {
            Section("Branches") {
                ForEach(git.branches, id: \.self) { name in
                    Button { Task { await model.switchBranch(to: name) } } label: {
                        if name == git.branch.head { Label(name, systemImage: "checkmark") } else { Text(name) }
                    }
                }
                Button("Neuer Branch …", systemImage: "plus", action: createBranch)
            }
            .disabled(git.isBusy)
            if git.hasRemote {
                Section("Remote") {
                    Button("Abrufen", systemImage: "arrow.triangle.2.circlepath") { Task { await model.fetchFromRemote() } }
                    Button(pullTitle, systemImage: "arrow.down") { Task { await model.pullFromRemote() } }
                        .disabled(git.branch.upstream == nil)
                    Button(pushTitle, systemImage: "arrow.up") { Task { await model.pushToRemote() } }
                        .disabled(git.branch.head == nil)
                }
                .disabled(git.isBusy)
            }
            Divider()
            Button("Änderungen anzeigen") { model.sidebar.tab = .changes }
        } label: {
            Label(title, systemImage: git.activity == nil ? "arrow.triangle.branch" : "arrow.triangle.2.circlepath")
                .labelStyle(.titleAndIcon)
        }
        .menuIndicator(.hidden)
        .help(help)
    }

    private var title: String {
        if let activity = git.activity { return activity }
        var parts = [git.branch.displayName]
        if git.branch.ahead > 0 { parts.append("↑\(git.branch.ahead)") }
        if git.branch.behind > 0 { parts.append("↓\(git.branch.behind)") }
        return parts.joined(separator: " ")
    }

    private var pullTitle: String {
        git.branch.behind > 0 ? "Pull (\(git.branch.behind) neu)" : "Pull"
    }

    private var pushTitle: String {
        if git.branch.upstream == nil { return "Push (Branch neu anlegen)" }
        return git.branch.ahead > 0 ? "Push (\(git.branch.ahead) Commits)" : "Push"
    }

    private var help: String {
        let branch = git.branch
        let name = branch.head.map { "Branch „\($0)“" } ?? "Losgelöster HEAD (\(branch.displayName))"
        guard let upstream = branch.upstream else { return name + " · kein Upstream" }
        let distance = "\(branch.ahead) voraus, \(branch.behind) zurück gegenüber \(upstream)"
        return name + " · " + distance + " (Stand des letzten Abrufs)"
    }
}
