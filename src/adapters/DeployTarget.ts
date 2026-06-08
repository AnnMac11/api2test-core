/** A single generated artefact to be delivered (a source file plus its contents). */
export interface DeployArtifact {
    /** Path relative to the test-project root, e.g. `GeneratedClasses/CreateCustomer.cs`. */
    relativePath: string;
    /** File contents. */
    content: string;
}

/** Result of a deploy operation. */
export interface DeployResult {
    success: boolean;
    /** Where the artefacts landed (a folder path, a PR URL, …). */
    location?: string;
    message?: string;
}

/**
 * Delivery contract for generated code. Selected per consumer:
 *
 *   - **LocalFileDeployTarget** — writes into a folder the user picks (VS Code today).
 *   - **RepoPrDeployTarget**    — opens a branch/PR in a Git repo (enterprise / Jira — future).
 *
 * Keeps the engine ignorant of *where* code goes; consumers wire the concrete target.
 */
export interface DeployTarget {
    /** Human-readable name, e.g. `Local folder` or `GitHub PR`. */
    readonly name: string;

    /** Deliver the artefacts. */
    deploy(artifacts: DeployArtifact[]): Promise<DeployResult>;
}
