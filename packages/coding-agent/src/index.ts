// Core session management

export { type Args, parseArgs } from "./cli/args.ts";

// Config paths
export { getAgentDir, getDocsPath, getExamplesPath, getPackageDir, getReadmePath, VERSION } from "./config.ts";
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type ParsedSkillBlock,
	type PromptOptions,
	parseSkillBlock,
	type SessionStats,
} from "./core/agent-session.ts";
// Auth and model registry
export {
	type ApiKeyCredential,
	type AuthCredential,
	type AuthStatus,
	AuthStorage,
	type AuthStorageBackend,
	FileAuthStorageBackend,
	InMemoryAuthStorageBackend,
} from "./core/auth-storage.ts";
// Compaction
export {
	type BranchPreparation,
	type BranchSummaryResult,
	COMPACT_PROMPT,
	type CollectEntriesResult,
	type CompactionResult,
	collectEntriesForBranchSummary,
	effectiveChars,
	estimateTokens,
	extractAssistantText,
	findSplitPoint,
	type GenerateBranchSummaryOptions,
	generateBranchSummary,
	KEEP_RECENT_CHARS,
	prepareBranchEntries,
	rebuildMessages,
	type SplitPoint,
	totalMessageChars,
} from "./core/compaction/index.ts";
export { createEventBus, type EventBus, type EventBusController } from "./core/event-bus.ts";
// Extension system
export type {
	AgentEndEvent,
	AgentStartEvent,
	AgentToolResult,
	AgentToolUpdateCallback,
	AppKeybinding,
	AutocompleteProviderFactory,
	BashToolCallEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeProviderRequestEvent,
	BeforeProviderRequestEventResult,
	BuildSystemPromptOptions,
	CompactOptions,
	ContextEvent,
	ContextUsage,
	CustomToolCallEvent,
	ExecOptions,
	ExecResult,
	Extension,
	ExtensionActions,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionEvent,
	ExtensionFactory,
	ExtensionFlag,
	ExtensionHandler,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	InputEvent,
	InputEventResult,
	InputSource,
	KeybindingsManager,
	LoadExtensionsResult,
	MessageRenderer,
	MessageRenderOptions,
	ProviderConfig,
	ProviderModelConfig,
	RegisteredCommand,
	RegisteredTool,
	ResolvedCommand,
	SessionBeforeCompactEvent,
	SessionBeforeForkEvent,
	SessionBeforeSwitchEvent,
	SessionBeforeTreeEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
	SlashCommandInfo,
	SlashCommandSource,
	SourceInfo,
	TerminalInputHandler,
	ToolCallEvent,
	ToolCallEventResult,
	ToolDefinition,
	ToolExecutionMode,
	ToolInfo,
	ToolRenderResultOptions,
	ToolResultEvent,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashEventResult,
	WidgetPlacement,
	WorkingIndicatorOptions,
} from "./core/extensions/index.ts";
export {
	createExtensionRuntime,
	defineTool,
	discoverAndLoadExtensions,
	ExtensionRunner,
	isBashToolResult,
	isToolCallEventType,
	wrapRegisteredTool,
	wrapRegisteredTools,
} from "./core/extensions/index.ts";
// Footer data provider (git branch + extension statuses - data not otherwise available to extensions)
export type { ReadonlyFooterDataProvider } from "./core/footer-data-provider.ts";
export { convertToLlm } from "./core/messages.ts";
export { ModelRegistry } from "./core/model-registry.ts";
export type {
	PackageManager,
	PathMetadata,
	ProgressCallback,
	ProgressEvent,
	ResolvedPaths,
	ResolvedResource,
} from "./core/package-manager.ts";
export { DefaultPackageManager } from "./core/package-manager.ts";
export type { ResourceCollision, ResourceDiagnostic, ResourceLoader } from "./core/resource-loader.ts";
export { DefaultResourceLoader, loadProjectContextFiles } from "./core/resource-loader.ts";
// SDK for programmatic usage
export {
	AgentSessionRuntime,
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	type CreateAgentSessionRuntimeFactory,
	type CreateAgentSessionRuntimeResult,
	type CreateAgentSessionServicesOptions,
	// Factory
	createAgentSession,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createBashTool,
	type PromptTemplate,
} from "./core/sdk.ts";
export {
	type BranchSummaryEntry,
	buildSessionContext,
	type CompactionEntry,
	CURRENT_SESSION_VERSION,
	type CustomEntry,
	type CustomMessageEntry,
	type FileEntry,
	getLatestCompactionEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	type NewSessionOptions,
	parseSessionEntries,
	type SessionContext,
	type SessionEntry,
	type SessionEntryBase,
	type SessionHeader,
	type SessionInfo,
	type SessionInfoEntry,
	SessionManager,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "./core/session-manager.ts";
export {
	type ImageSettings,
	type PackageSource,
	type RetrySettings,
	SettingsManager,
	type SettingsManagerCreateOptions,
} from "./core/settings-manager.ts";
// Skills
export {
	formatSkillsForPrompt,
	type LoadSkillsFromDirOptions,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
	type SkillFrontmatter,
} from "./core/skills.ts";
export { createSyntheticSourceInfo } from "./core/source-info.ts";
// Background task management
export { type BackgroundTask, TaskManager, type TaskStatus } from "./core/task-manager.ts";
// Tools
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashToolDefinition,
	createLocalBashOperations,
	createTranscribeToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type ToolsOptions,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./core/tools/index.ts";
export { hasProjectTrustInputs, type ProjectTrustDecision, ProjectTrustStore } from "./core/trust-manager.ts";
// Main entry point
export { type MainOptions, main } from "./main.ts";
// Run modes for programmatic SDK usage
export {
	InteractiveMode,
	type InteractiveModeOptions,
	type ModelInfo,
	type PrintModeOptions,
	runPrintMode,
} from "./modes/index.ts";
// UI components for extensions
export {
	ArminComponent,
	AssistantMessageComponent,
	BashExecutionComponent,
	BorderedLoader,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomEditor,
	CustomMessageComponent,
	DynamicBorder,
	ExtensionEditorComponent,
	ExtensionInputComponent,
	ExtensionSelectorComponent,
	FooterComponent,
	keyHint,
	keyText,
	ModelSelectorComponent,
	type RenderDiffOptions,
	rawKeyHint,
	renderDiff,
	SessionSelectorComponent,
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
	ShowImagesSelectorComponent,
	SkillInvocationMessageComponent,
	ThemeSelectorComponent,
	ThinkingSelectorComponent,
	ToolExecutionComponent,
	type ToolExecutionOptions,
	TreeSelectorComponent,
	truncateToVisualLines,
	UserMessageComponent,
	UserMessageSelectorComponent,
	type VisualTruncateResult,
} from "./modes/interactive/components/index.ts";
// Theme utilities for custom tools and extensions
export {
	getLanguageFromPath,
	getMarkdownTheme,
	getSelectListTheme,
	getSettingsListTheme,
	highlightCode,
	initTheme,
	Theme,
	type ThemeColor,
} from "./modes/interactive/theme/theme.ts";
// Clipboard utilities
export { copyToClipboard } from "./utils/clipboard.ts";
export { parseFrontmatter, stripFrontmatter } from "./utils/frontmatter.ts";
export { convertToPng } from "./utils/image-convert.ts";
export { formatDimensionNote, type ResizedImage, resizeImage } from "./utils/image-resize.ts";
// Shell utilities
export { getShellConfig } from "./utils/shell.ts";
