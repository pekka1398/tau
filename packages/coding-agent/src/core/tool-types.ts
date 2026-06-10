/**
 * Core tool types — extracted from the extension system.
 *
 * These are the minimal types needed by tools and UI components.
 * No extension infrastructure required.
 */

import type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { Component } from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";
import type { Theme } from "../modes/interactive/theme/theme.ts";
import type { ModelRegistry } from "./model-registry.ts";

export type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode };

/** Minimal context passed to tool execute(). Replaces ExtensionContext. */
export interface ToolContext {
	/** Current working directory */
	cwd: string;
	/** Model registry for API key resolution */
	modelRegistry: ModelRegistry;
	/** Current model (may be undefined) */
	model: Model<any> | undefined;
	/** UI context (available in TUI/RPC modes) */
	ui?: any;
	/** Current run mode */
	mode?: string;
	/** Whether dialog-capable UI is available */
	hasUI?: boolean;
	/** Session manager */
	sessionManager?: any;
	/** Whether the agent is idle */
	isIdle?: () => boolean;
	/** Abort signal */
	signal?: AbortSignal;
	/** Abort the current operation */
	abort?: () => void;
	/** Shutdown */
	shutdown?: () => void;
	/** Get context usage */
	getContextUsage?: () => ContextUsage | undefined;
	/** Trigger compaction */
	compact?: (options?: CompactOptions) => void;
	/** Get system prompt */
	getSystemPrompt?: () => string;
	/** Whether there are pending messages */
	hasPendingMessages?: () => boolean;
	/** Additional properties for backward compatibility */
	[key: string]: any;
}

/** Rendering options for tool results */
export interface ToolRenderResultOptions {
	expanded: boolean;
	isPartial: boolean;
}

/** Context passed to tool renderers. */
export interface ToolRenderContext<TState = any, TArgs = any> {
	args: TArgs;
	toolCallId: string;
	invalidate: () => void;
	lastComponent: Component | undefined;
	state: TState;
	cwd: string;
	executionStarted: boolean;
	argsComplete: boolean;
	isPartial: boolean;
	expanded: boolean;
	showImages: boolean;
	isError: boolean;
}

/**
 * Tool definition.
 */
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TParams;
	renderShell?: "default" | "self";
	prepareArguments?: (args: unknown) => Static<TParams>;
	executionMode?: ToolExecutionMode;

	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: ToolContext,
	): Promise<AgentToolResult<TDetails>>;

	renderCall?: (args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
	renderResult?: (
		result: AgentToolResult<TDetails>,
		options: ToolRenderResultOptions,
		theme: Theme,
		context: ToolRenderContext<TState, Static<TParams>>,
	) => Component;
}

type AnyToolDefinition = ToolDefinition<any, any, any>;

export function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
	tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition {
	return tool as ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition;
}

/** Context usage tracking */
export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

/** Options for triggering compaction */
export interface CompactOptions {
	customInstructions?: string;
	onComplete?: (result: any) => void;
	onError?: (error: Error) => void;
}

/** Message renderer for custom messages */
export type MessageRenderer<T = unknown> = (data: T, ...args: any[]) => any;

/** Tool info for listing/querying. */
export type ToolInfo = Pick<ToolDefinition, "name" | "description" | "parameters" | "promptGuidelines"> & {
	label: string;
	promptSnippet?: string;
};
