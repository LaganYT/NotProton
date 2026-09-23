// Clones CrossOver, throws it in bridge, invokes ntdll patch,

import Foundation

enum RunnerSetup {

    enum Phase: Sendable {
        case cloning
        case staging
        case patching
        case finished

        var label: String {
            switch self {
            case .cloning: "Copying CrossOver"
            case .staging: "Patching"
            case .patching: "Installing compatibility tool"
            case .finished: "Done"
            }
        }
    }

    struct Outcome: Sendable {
        let build: RunnerBuild
        let staged: [WineArch]
        let installed: RunnerPatcher.Outcome

        var stagedNothing: Bool { staged.isEmpty && installed.wroteNothing }
    }

    static func run(
        from install: CrossOverInstall,
        replacingExisting: Bool = false,
        report: @Sendable (Phase) -> Void = { _ in }
    ) throws -> Outcome {
        try CrossOverLicense.requireValid(for: install)

        report(.cloning)
        let build = try RunnerInstaller.clone(from: install, replacingExisting: replacingExisting)

        report(.staging)
        let root = SupportPaths.clonedRoot(forBuild: build.id)
        let staged = try NtdllPatcher.stage(build: build, runnerRoot: root)

        report(.patching)
        let installed = try RunnerPatcher.install(build: build, root: root)

        report(.finished)
        return Outcome(build: build, staged: staged, installed: installed)
    }
}
