/**
 * Jupyter Notebook (.ipynb) converter.
 *
 * Strategy:
 * 1. Parse JSON structure
 * 2. Extract cells (code + markdown)
 * 3. For code cells: include source + outputs
 * 4. For markdown cells: include as-is
 * 5. Truncate large outputs (images described as [image output])
 * 6. Chunk if too many cells
 *
 * This is purely local — no API needed.
 */

import { readFile } from "node:fs/promises";
import { chunkNotebookCells, DEFAULTS } from "../chunk.ts";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

interface NotebookCell {
	cell_type: string;
	source: string | string[];
	outputs?: NotebookOutput[];
	metadata?: Record<string, unknown>;
}

interface NotebookOutput {
	output_type: string;
	text?: string | string[];
	data?: Record<string, string | string[]>;
	name?: string;
	ename?: string;
	evalue?: string;
	traceback?: string[];
}

interface Notebook {
	cells: NotebookCell[];
	metadata?: Record<string, unknown>;
	nbformat?: number;
}

export const notebookConverter: Converter = {
	name: "Jupyter Notebook",
	extensions: [".ipynb"],

	async convert(filePath: string, _ctx: ConverterContext): Promise<TranscribeResult> {
		const warnings: string[] = [];

		// Parse JSON
		const raw = await readFile(filePath, "utf-8");
		let notebook: Notebook;
		try {
			notebook = JSON.parse(raw);
		} catch {
			throw new Error(`Invalid notebook JSON: ${filePath}`);
		}

		const cells = notebook.cells ?? [];
		warnings.push(`Notebook: ${cells.length} cells, nbformat v${notebook.nbformat ?? "?"}`);

		// Extract cells
		const extracted = cells.map((cell) => extractCell(cell));

		// Chunk if large
		const chunks = chunkNotebookCells(extracted, DEFAULTS.NOTEBOOK_CELLS_PER_CHUNK);

		const sections: string[] = [];

		// Add notebook metadata header
		const kernel = (notebook.metadata as Record<string, unknown>)?.kernelspec as Record<string, unknown> | undefined;
		if (kernel) {
			sections.push(`[Kernel: ${kernel.display_name ?? kernel.name ?? "unknown"}]`);
		}

		for (const chunk of chunks) {
			sections.push(chunk.text ?? "");
		}

		return {
			text: sections.join("\n\n"),
			format: "notebook",
			chunks: chunks.length,
			usedApi: false,
			warnings,
		};
	},
};

/** Extract text content from a notebook cell. */
function extractCell(cell: NotebookCell): { type: string; source: string; outputs?: string[] } {
	const source = Array.isArray(cell.source) ? cell.source.join("") : (cell.source ?? "");
	const outputs = cell.outputs?.map((o) => extractOutput(o)).filter((o) => o.length > 0);

	return {
		type: cell.cell_type ?? "unknown",
		source,
		outputs,
	};
}

/** Extract text from a cell output. */
function extractOutput(output: NotebookOutput): string {
	switch (output.output_type) {
		case "stream":
			return joinText(output.text);

		case "execute_result":
		case "display_data": {
			const parts: string[] = [];
			// Prefer text/plain
			if (output.data?.["text/plain"]) {
				parts.push(joinText(output.data["text/plain"]));
			}
			// Note image outputs
			if (output.data?.["image/png"] || output.data?.["image/jpeg"]) {
				parts.push("[image output]");
			}
			if (output.data?.["text/html"]) {
				parts.push("[HTML output]");
			}
			return parts.join("\n");
		}

		case "error":
			return `[Error: ${output.ename ?? "unknown"}] ${joinText(output.text)}`;

		default:
			return joinText(output.text);
	}
}

function joinText(text: string | string[] | undefined): string {
	if (Array.isArray(text)) return text.join("");
	return text ?? "";
}
