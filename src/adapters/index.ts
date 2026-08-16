/**
 * Pluggable adapters — selected at install time so storage, language, and delivery vary per
 * consumer (VS Code / enterprise / Jira) without touching the engine.
 */
export * from './StorageProvider';
export * from './CodeEmitter';
export * from './CSharpEmitter';
export * from './TypeScriptEmitter';
export * from './PythonEmitter';
export * from './DeployTarget';
