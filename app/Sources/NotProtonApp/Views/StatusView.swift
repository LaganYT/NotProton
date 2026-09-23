// 'Status' view, see SystemStatus for actual logic

import SwiftUI

enum StatusTone: Sendable {
    case ok, info, warning, bad, neutral

    var symbol: String {
        switch self {
        case .ok: "circle.fill"
        case .info: "circle"
        case .warning: "circle.fill"
        case .bad: "circle.fill"
        case .neutral: "circle"
        }
    }

    var color: Color {
        switch self {
        case .ok: .green
        case .info: .secondary
        case .warning: .orange
        case .bad: .red
        case .neutral: .secondary
        }
    }
}

struct StatusAction {
    let label: String
    var isProminent = false
    var role: ButtonRole?
    var help: String?
    var isEnabled = true
    let perform: () -> Void
}

enum StatusMetrics {
    static let symbolWidth: CGFloat = 10
    static let symbolSpacing: CGFloat = 8
    static var textInset: CGFloat { symbolWidth + symbolSpacing }
}

struct StatusRow: View {

    @Environment(\.colorSchemeContrast) private var contrast

    let title: String
    var value: String?

    var tone: StatusTone?
    var detail: String?
    var action: StatusAction?

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: StatusMetrics.symbolSpacing) {
                if let tone {
                    Image(systemName: tone.symbol)
                        .font(.system(size: 8))
                        .foregroundStyle(tone.color)
                        .frame(width: StatusMetrics.symbolWidth)
                        .accessibilityHidden(true)
                } else {
                    Color.clear.frame(width: StatusMetrics.symbolWidth, height: 1)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.headline)
                    if let value {
                        Text(value)
                            .foregroundStyle(.secondary)
                    }
                    if let detail {
                        Text(detail)
                            .font(.callout)
                            .foregroundStyle(contrast == .increased ? .secondary : .tertiary)
                            .textSelection(.enabled)
                    }
                }
            }

            if let action {
                Spacer(minLength: 12)
                button(action)
                    .disabled(!action.isEnabled)
                    .help(action.help ?? "")
                    .accessibilityLabel("\(action.label), \(title)")
            }
        }
        .accessibilityElement(children: .combine)
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func button(_ action: StatusAction) -> some View {
        if action.isProminent {
            Button(action.label, role: action.role, action: action.perform)
                .buttonStyle(.borderedProminent)
        } else {
            Button(action.label, role: action.role, action: action.perform)
                .buttonStyle(.bordered)
        }
    }
}

struct StatusView: View {
    @Environment(SystemStatus.self) private var status

    private static let updateBlockPrompt =
        "Steam client updates may break NotProton. If you don't want to wait for "
            + "NotProton to be updated to be compatible with future Steam versions at the "
            + "cost of not getting updates to the Steam client, you can stop the Steam "
            + "client from updating itself."

    var body: some View {
        Group {
            if let snapshot = status.snapshot {
                statusForm(snapshot)
            } else {
                ProgressView("Checking")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Status")
        .toolbar {
            if #available(macOS 26.1, *) {
                ToolbarItem(placement: .primaryAction) { refreshButton }
                    .visibilityPriority(.high)
            } else {
                ToolbarItem(placement: .primaryAction) { refreshButton }
            }
        }
        .confirmationDialog(
            "Block Steam client updates?",
            isPresented: asking(.blockUpdates),
            titleVisibility: .visible
        ) {
            Button("Block Updates", role: .destructive) {
                Task { await status.setUpdateBlock(true) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(Self.updateBlockPrompt)
        }
        .confirmationDialog(
            "Replace Steam with Valve's bundle?",
            isPresented: asking(.replaceSteam),
            titleVisibility: .visible
        ) {
            Button("Replace Steam", role: .destructive) {
                Task { await status.repairSteam() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "This will restore Steam itself to its original state but does not remove "
                    + "the support components used by NotProton."
            )
        }
        .confirmationDialog(
            "Remove everything NotProton has created?",
            isPresented: asking(.removeEverything),
            titleVisibility: .visible
        ) {
            Button("Remove Everything", role: .destructive) {
                Task { await status.removeEverything() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "Steam is restored to its unmodified state and NotProton is removed, including "
                    + "the compatibility tool that lives inside the Steam folder. Windows games "
                    + "and Steam Play prefixes are not removed."
            )
        }
        .confirmationDialog(
            CrossOverLicense.notActivatedTitle,
            isPresented: asking(.installUnlicensed),
            titleVisibility: .visible
        ) {
            Button("Continue Anyway") {
                Task { await status.installIntoSteam() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                CrossOverLicense.notActivatedAdvice
                    + " NotProton can be deployed, but the CrossOver compatibility tool "
                    + "cannot be installed without a valid license."
            )
        }
        .task { if status.snapshot == nil { await status.refresh() } }
        .confirmationDialog(
            CrossOverLicense.notActivatedTitle,
            isPresented: asking(.toolUnlicensed),
            titleVisibility: .visible
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(CrossOverLicense.notActivatedAdvice)
        }
    }

    private func asking(_ confirmation: SystemStatus.Confirmation) -> Binding<Bool> {
        Binding(
            get: { status.pendingConfirmation == confirmation },
            set: { shown in
                if !shown, status.pendingConfirmation == confirmation {
                    status.pendingConfirmation = nil
                }
            }
        )
    }

    private func statusForm(_ snapshot: StatusSnapshot) -> some View {
        Form {
            if let failure = status.failure {
                StatusRow(
                    title: "Failed",
                    value: failure,
                    tone: .bad,
                    action: status.failureRemedy?.settingsPane.map { pane in
                        StatusAction(label: Remedy.settingsButton) {
                            Remedy.openSettings(pane)
                        }
                    }
                )
            } else if let outcome = status.outcome {
                StatusRow(title: "Done", value: outcome, tone: .ok)
            }

            if let activity = status.activity {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                    Text(activity)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Steam") {
                steamRow(snapshot.steam, payload: snapshot.payload)
                if snapshot.steamRunning {
                    StatusRow(
                        title: "Steam is running",
                        value: "Close Steam before continuing.",
                        tone: .info
                    )
                }
                updateBlockRow(snapshot.updateBlocked)
            }

            Section("Compatibility Tool") {
                crossOverRow(snapshot)
                runnerRow(snapshot.runner, payload: snapshot.payload)
            }

            componentsSection(snapshot.payload)

            dangerSection
        }
        .formStyle(.grouped)
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
    }

    private var dangerSection: some View {
        Section {
            StatusRow(
                title: "Repair Steam",
                value: "Restore Steam to its original state.",
                action: StatusAction(
                    label: "Repair",
                    role: .destructive,
                    isEnabled: status.isIdle
                ) { status.pendingConfirmation = .replaceSteam }
            )
            StatusRow(
                title: "Remove Everything",
                value: "Remove NotProton and restore Steam to its original state.",
                action: StatusAction(
                    label: "Remove",
                    role: .destructive,
                    isEnabled: status.isIdle
                ) { status.pendingConfirmation = .removeEverything }
            )
        }
    }

    private var refreshButton: some View {
        Button("Refresh", systemImage: "arrow.clockwise") {
            Task { await status.refresh() }
        }
        .disabled(!status.isIdle)
    }

    private func installAction(prominent: Bool) -> StatusAction {
        StatusAction(
            label: "Install",
            isProminent: prominent,
            help: "Install NotProton into Steam.",
            isEnabled: status.isIdle
        ) {
            Task { await status.requestInstall() }
        }
    }

    private func steamRow(_ deployment: SteamDeployment, payload: PayloadState) -> some View {
        switch deployment {
        case .steamMissing:
            StatusRow(title: "NotProton", value: "Steam not found.", tone: .bad)
        case .notInstalled:
            StatusRow(
                title: "NotProton",
                value: "Not installed.",
                tone: .neutral,
                action: installAction(prominent: true)
            )
        case .installed(let version):
            if payload.isComplete {
                StatusRow(
                    title: "NotProton",
                    value: "Installed" + (version.map { " (\($0))" } ?? ""),
                    tone: .ok
                )
            } else {
                StatusRow(
                    title: "NotProton",
                    value: "Installed, but not for this account.",
                    tone: .warning,
                    detail: "Steam is set up for NotProton, but this account is missing its "
                        + "components. Install to add them.",
                    action: installAction(prominent: true)
                )
            }
        case .outdated(_, let bundled):
            StatusRow(
                title: "NotProton",
                value: "Update available (\(bundled)).",
                tone: .warning,
                action: installAction(prominent: true)
            )
        case .foreign:
            StatusRow(
                title: "NotProton",
                value: "Another dylib is present.",
                tone: .warning,
                detail: "Repair your Steam install before installing NotProton."
            )
        }
    }

    private func updateBlockRow(_ blocked: Bool) -> some View {
        Toggle(isOn: blockUpdates) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Block Steam client updates")
                    .font(.headline)
                Text(
                    blocked
                        ? "The Steam client will not update itself."
                        : "A Steam client update may break NotProton."
                )
                .foregroundStyle(.secondary)
            }
            .padding(.leading, StatusMetrics.textInset)
        }
        .disabled(!status.isIdle)
        .help("Steam client updates may break NotProton.")
    }

    private var blockUpdates: Binding<Bool> {
        Binding(
            get: { status.snapshot?.updateBlocked ?? false },
            set: { wanted in
                if wanted {
                    status.pendingConfirmation = .blockUpdates
                } else {
                    Task { await status.setUpdateBlock(false) }
                }
            }
        )
    }

    @ViewBuilder
    private func crossOverRow(_ snapshot: StatusSnapshot) -> some View {
        if let install = snapshot.crossOver.first(where: \.isUsable) {
            if case .supported(let build) = install.support {
                StatusRow(
                    title: install.name,
                    value: "Build \(build.displayVersion)",
                    tone: snapshot.crossOverLicense?.licensed == true ? .ok : .warning,
                    detail: install.bundle.path(percentEncoded: false),
                    action: crossOverAction()
                )
            }
        } else {
            StatusRow(
                title: "CrossOver",
                value: "Not found. Supported: \(SupportedRunners.versionList).",
                tone: .bad,
                action: crossOverAction()
            )
        }
    }

    private func crossOverAction() -> StatusAction {
        if status.chosenCrossOver != nil {
            return StatusAction(
                label: "Use Search",
                help: "Use the default CrossOver.",
                isEnabled: status.isIdle
            ) { Task { await status.clearCrossOverChoice() } }
        }
        return StatusAction(
            label: "Choose\u{2026}",
            help: "Pick a CrossOver install.",
            isEnabled: status.isIdle
        ) { Task { await status.chooseCrossOver() } }
    }

    private func runnerAction(
        label: String = "Set Up", replacingExisting: Bool = false
    ) -> StatusAction {
        StatusAction(
            label: label,
            isProminent: true,
            help: "Set up the compatibility tool from CrossOver.",
            isEnabled: status.isIdle && status.usableCrossOver != nil
        ) {
            Task { await status.requestCompatibilityTool(replacingExisting: replacingExisting) }
        }
    }

    private func runnerRow(_ state: RunnerState, payload: PayloadState) -> some View {
        let patchedMissing = !payload.missing(origin: .patched).isEmpty

        switch state {
        case .none:
            return StatusRow(
                title: "Compatibility Tool",
                value: "Not set up.",
                tone: .neutral,
                action: runnerAction()
            )
        case .cloned(let build, let supported):
            let satisfied = supported && !patchedMissing
            return StatusRow(
                title: "Compatibility Tool",
                value: "Build \(SupportedRunners.displayVersion(forID: build))"
                    + (supported ? "" : " (unsupported)"),
                tone: satisfied ? .ok : .warning,
                action: satisfied
                    ? runnerAction(label: "Copy Again", replacingExisting: true)
                    : runnerAction()
            )
        case .unpatched(let build, _):
            return StatusRow(
                title: "Compatibility Tool",
                value: "Build \(SupportedRunners.displayVersion(forID: build)), not patched.",
                tone: .warning,
                action: runnerAction()
            )
        case .bundleShaped(let build):
            return StatusRow(
                title: "Compatibility Tool",
                value: "Build \(SupportedRunners.displayVersion(forID: build)), needs re-setup.",
                tone: .warning,
                action: runnerAction()
            )
        case .broken:
            return StatusRow(
                title: "Compatibility Tool",
                value: "Unusable.",
                tone: .bad,
                action: runnerAction()
            )
        }
    }

    private func fetchAction() -> StatusAction {
        StatusAction(
            label: "Fetch Valve Binaries",
            isProminent: true,
            help: "Download missing Valve binaries.",
            isEnabled: status.isIdle
        ) { Task { await status.fetchValveBinaries() } }
    }

    @ViewBuilder
    private func componentsSection(_ payload: PayloadState) -> some View {
        if let problem = payload.manifestProblem {
            Section("NotProton Components") {
                StatusRow(title: "Components", value: "Component list unreadable.", tone: .bad, detail: problem)
            }
        } else if payload.isComplete {
            Section("NotProton Components") {
                StatusRow(title: "Components", value: "Ready.", tone: .ok)
            }
        } else if payload.isEmpty {
            Section("NotProton Components") {
                StatusRow(title: "Components", value: "Not yet deployed.", tone: .neutral)
            }
        } else {
            Section("NotProton Components") {
                if !payload.missing.isEmpty {
                    let names = payload.missing.map {
                        URL(filePath: $0.path).lastPathComponent
                    }.joined(separator: ", ")
                    StatusRow(
                        title: "Missing",
                        value: names,
                        tone: .bad,
                        action: payload.missing.contains(where: { $0.origin.isFetchable })
                            ? fetchAction() : nil
                    )
                }
                if !payload.overlayShimPresent {
                    StatusRow(title: "Overlay shim", value: "Missing.", tone: .bad)
                }
                if payload.signatureDatabase == nil {
                    StatusRow(title: "Signature database", value: "Missing.", tone: .bad)
                }
            }
        }
    }
}
