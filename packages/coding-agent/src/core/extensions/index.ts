/**
 * Extension types — minimal stubs after infrastructure removal.
 */

export type { ExecOptions, ExecResult } from "../exec.ts";
export type { AppKeybinding, KeybindingsManager } from "../keybindings.ts";
export type { CustomMessage } from "../messages.ts";
export type { SlashCommandInfo, SlashCommandSource } from "../slash-commands.ts";
export type { SourceInfo } from "../source-info.ts";
export type { BuildSystemPromptOptions } from "../system-prompt.ts";
export type {
	AgentToolResult,
	AgentToolUpdateCallback,
	CompactOptions,
	ContextUsage,
	ToolContext as ExtensionContext,
	ToolDefinition,
	ToolExecutionMode,
	ToolInfo,
	ToolRenderResultOptions,
} from "../tool-types.ts";
export { defineTool } from "../tool-types.ts";

// Types used by agent-session.ts and other core files
export type InputSource = "interactive" | "rpc" | "extension";

export interface SessionStartEvent {
	type: "session_start";
	reason: "startup" | "reload" | "new" | "resume" | "fork";
	previousSessionFile?: string;
}

export type ShutdownHandler = () => void;

export interface TreePreparation {
	targetId: string;
	oldLeafId: string | null;
	commonAncestorId: string | null;
	entriesToSummarize: any[];
	userWantsSummary: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export interface ReplacedSessionContext {
	cwd: string;
	sendMessage?: any;
	sendUserMessage?: any;
	withSession?: any;
}

// Event stubs
export interface AgentStartEvent {
	type: "agent_start";
}
export interface AgentEndEvent {
	type: "agent_end";
	messages: any[];
}
export interface TurnStartEvent {
	type: "turn_start";
	[key: string]: any;
}
export interface TurnEndEvent {
	type: "turn_end";
	message: any;
	[key: string]: any;
}
export interface MessageStartEvent {
	type: "message_start";
	message: any;
}
export interface MessageUpdateEvent {
	type: "message_update";
	message: any;
	[key: string]: any;
}
export interface MessageEndEvent {
	type: "message_end";
	message: any;
}
export interface ToolExecutionStartEvent {
	type: "tool_execution_start";
	toolCallId: string;
	toolName: string;
	args: any;
}
export interface ToolExecutionUpdateEvent {
	type: "tool_execution_update";
	toolCallId: string;
	toolName: string;
	args: any;
	partialResult: any;
}
export interface ToolExecutionEndEvent {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	result: any;
	isError: boolean;
}
export interface SessionBeforeCompactResult {
	cancel?: boolean;
	compaction?: any;
}
export interface SessionBeforeTreeResult {
	cancel?: boolean;
	summary?: any;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}
export interface ContextEvent {
	type: "context";
	messages: any[];
}
export interface ContextEventResult {
	messages?: any[];
}
export interface InputEvent {
	type: "input";
	text: string;
	images?: any[];
	source: InputSource;
}
export interface InputEventResult {
	action: "continue" | "handled" | "transform";
	text?: string;
	images?: any[];
}
export interface ToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	args: any;
}
export interface ToolCallEventResult {
	block?: boolean;
	message?: string;
}
export interface ToolResultEvent {
	type: "tool_result";
	toolCallId: string;
	content: any;
	details?: any;
	isError?: boolean;
}
export interface ToolResultEventResult {
	content?: any;
	details?: any;
	isError?: boolean;
}
export interface UserBashEvent {
	type: "user_bash";
	command: string;
}
export interface UserBashEventResult {
	handled?: boolean;
}
export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	prompt: string;
	images?: any[];
	systemPrompt: string;
	systemPromptOptions: any;
}
export interface BeforeAgentStartEventResult {
	message?: any;
	systemPrompt?: string;
}
export interface BeforeProviderRequestEvent {
	type: "before_provider_request";
	payload: any;
}
export interface SessionBeforeCompactEvent {
	type: "session_before_compact";
}
export interface SessionBeforeForkEvent {
	type: "session_before_fork";
}
export interface SessionBeforeForkResult {
	cancel?: boolean;
}
export interface SessionBeforeSwitchEvent {
	type: "session_before_switch";
}
export interface SessionBeforeSwitchResult {
	cancel?: boolean;
}
export interface SessionBeforeTreeEvent {
	type: "session_before_tree";
}
export interface SessionShutdownEvent {
	type: "session_shutdown";
	reason?: string;
}
export interface SessionCompactEvent {
	type: "session_compact";
}
export interface SessionTreeEvent {
	type: "session_tree";
}
export interface SessionEvent {
	type: string;
}
export interface ResourcesDiscoverEvent {
	type: "resources_discover";
	cwd: string;
	reason: string;
}
export interface ResourcesDiscoverResult {
	skillPaths?: string[];
	promptPaths?: string[];
	themePaths?: string[];
}

export type AutocompleteProviderFactory = any;
export type EditorFactory = any;
export type ExtensionCommandContext = any;
export type ExtensionUIDialogOptions = any;
export type ExtensionWidgetOptions = any;
export type WidgetPlacement = any;
export type WorkingIndicatorOptions = any;
export type ExtensionError = { extensionPath: string; event: string; error: string; stack?: string };
export type ExtensionErrorListener = (error: ExtensionError) => void;
export type MessageRenderer<T = unknown> = (data: T) => any;
export type MessageRenderOptions = any;
export type ProviderConfig = any;
export type ProviderModelConfig = any;
export type RegisteredTool = any;
export type RegisteredCommand = any;
export type ResolvedCommand = any;
export type Extension = any;
export type ExtensionFactory = any;
export type ExtensionRuntime = any;
export type LoadExtensionsResult = { extensions: any[]; runtime: any; errors: any[]; diagnostics?: any[] };
export type ExtensionFlag = any;
export type ExtensionShortcut = any;
export type ExtensionCommandContextActions = any;
export type ExtensionUIContext = any;
export type ExtensionMode = "tui" | "print" | "rpc" | "json";
export type ExtensionActions = any;
export type ExtensionContextActions = any;
export type ExtensionAPI = any;
export type ExtensionHandler<E = any, R = any> = (event: E, ctx: any) => Promise<R | undefined> | R | undefined;
export type BashToolCallEvent = any;
export type BeforeProviderRequestEventResult = any;
export type CustomToolCallEvent = any;
export type TerminalInputHandler = any;
export type ExtensionEvent = any;

// Type guards
export function isBashToolResult(): boolean {
	return false;
}
export function isToolCallEventType(): boolean {
	return false;
}

// No-op stub for ExtensionRunner
export class ExtensionRunner {
	hasHandlers(..._a: any[]): boolean {
		return false;
	}
	emit(..._a: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
	emitMessageEnd(..._a: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
	emitToolCall(..._a: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
	emitToolResult(..._a: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
	emitInput(..._a: any[]): Promise<any> {
		return Promise.resolve({ action: "continue" });
	}
	emitBeforeAgentStart(..._a: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
	emitContext(messages: any[]): Promise<any[]> {
		return Promise.resolve(messages);
	}
	emitBeforeProviderRequest(..._a: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
	emitUserBash(..._a: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
	emitResourcesDiscover(..._a: any[]): Promise<any> {
		return Promise.resolve({ skillPaths: [], promptPaths: [], themePaths: [] });
	}
	emitError(..._a: any[]): void {}
	invalidate(..._a: any[]): void {}
	getCommand(..._a: any[]): any {
		return undefined;
	}
	createCommandContext(..._a: any[]): any {
		return {};
	}
	createContext(..._a: any[]): any {
		return {};
	}
	getAllRegisteredTools(): any[] {
		return [];
	}
	getToolDefinition(..._a: any[]): undefined {
		return undefined;
	}
	getFlags(..._a: any[]): Map<any, any> {
		return new Map();
	}
	getShortcuts(..._a: any[]): Map<any, any> {
		return new Map();
	}
	getRegisteredCommands(): any[] {
		return [];
	}
	getShortcutDiagnostics(): any[] {
		return [];
	}
	getCommandDiagnostics(): any[] {
		return [];
	}
	getExtensionPaths(): string[] {
		return [];
	}
	getMessageRenderer(..._a: any[]): any {
		return undefined;
	}
	shutdown(..._a: any[]): void {}
	bindCore(..._a: any[]): void {}
	bindCommandContext(..._a: any[]): void {}
	setUIContext(..._a: any[]): void {}
	getUIContext(): any {
		return {};
	}
	hasUI(): boolean {
		return false;
	}
	setFlagValue(..._a: any[]): void {}
	getFlagValues(): Map<any, any> {
		return new Map();
	}
	onError(..._a: any[]): () => void {
		return () => {};
	}
}

import { wrapToolDefinition, wrapToolDefinitions } from "../tools/tool-definition-wrapper.ts";

export function wrapRegisteredTools(tools: any[], ..._rest: any[]): any[] {
	return wrapToolDefinitions(tools.map((t) => t.definition ?? t));
}
export function wrapRegisteredTool(tool: any, ..._rest: any[]): any {
	return wrapToolDefinition(tool.definition ?? tool);
}
export function createExtensionRuntime(..._a: any[]): any {
	return { pendingProviderRegistrations: [], flagValues: new Map() };
}
export function loadExtensions(..._a: any[]): any {
	return { extensions: [], runtime: createExtensionRuntime(), errors: [], diagnostics: [] };
}
export function loadExtensionFromFactory(..._a: any[]): any {
	return {};
}
export function discoverAndLoadExtensions(..._a: any[]): any {
	return { extensions: [], runtime: createExtensionRuntime(), errors: [], diagnostics: [] };
}
export function emitSessionShutdownEvent(..._a: any[]): Promise<boolean> {
	return Promise.resolve(false);
}
