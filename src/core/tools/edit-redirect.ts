/**
 * Hidden "edit" tool that catches incorrect tool_use calls.
 * When the AI tries to call `edit` as a separate tool, this returns
 * a reminder to use the bash tool with the edit command instead.
 */

import { Type } from "typebox";
import type { ToolDefinition } from "../tool-types.ts";

const EditRedirectParams = Type.Object({
	file_path: Type.Optional(Type.String()),
	old_string: Type.Optional(Type.String()),
	new_string: Type.Optional(Type.String()),
	command: Type.Optional(Type.String()),
	content: Type.Optional(Type.String()),
});

export function createEditRedirectToolDefinition(): ToolDefinition<typeof EditRedirectParams, any> {
	return {
		name: "edit",
		description: "Do NOT use this tool. Use the bash tool instead.",
		parameters: EditRedirectParams,
		label: "edit (redirect)",
		execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
			return {
				content: [
					{
						type: "text" as const,
						text: [
							"ERROR: `edit` is NOT a standalone tool. You must use the **bash** tool.",
							"",
							"To edit a file, call the bash tool with this command:",
							"",
							"  edit <file> << 'EOF'",
							"  <<<<<<< SEARCH",
							"  exact content to find",
							"  =======",
							"  replacement content",
							"  >>>>>>> REPLACE",
							"  EOF",
							"",
							"Example tool call:",
							'  { "name": "bash", "input": { "command": "edit myfile.ts << \'EOF\'\\n<<<<<<< SEARCH\\nold line\\n=======\\nnew line\\n>>>>>>> REPLACE\\nEOF" } }',
							"",
							"Remember: `edit` is a builtin command inside the ai-dash shell, not a separate tool.",
						].join("\n"),
					},
				],
				details: {},
			};
		},
	};
}
