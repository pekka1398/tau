/**
 * CSV/TSV converter.
 *
 * Strategy:
 * 1. Detect encoding and delimiter
 * 2. Parse rows
 * 3. Convert to markdown table
 * 4. Chunk large files by rows
 *
 * Handles: .csv, .tsv
 */

import { readFile } from "node:fs/promises";
import { chunkCsvRows, DEFAULTS } from "../chunk.ts";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

export const csvConverter: Converter = {
	name: "CSV",
	extensions: [".csv", ".tsv"],

	async convert(filePath: string, _ctx: ConverterContext): Promise<TranscribeResult> {
		const warnings: string[] = [];

		// Read file
		const buffer = await readFile(filePath);
		const text = detectEncoding(buffer);
		const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

		if (lines.length === 0) {
			return { text: "(empty CSV)", format: "csv", chunks: 0, usedApi: false, warnings };
		}

		// Detect delimiter
		const delimiter = detectDelimiter(lines[0]);
		warnings.push(`Detected delimiter: ${delimiter === "\t" ? "TAB" : delimiter}`);

		// Parse all rows
		const allRows = lines.map((line) => parseCsvLine(line, delimiter));
		const header = allRows[0].map(String);
		const rows = allRows.slice(1);

		warnings.push(`${rows.length} data rows, ${header.length} columns`);

		// Chunk if large
		const chunks = chunkCsvRows(rows, header, DEFAULTS.CSV_ROWS_PER_CHUNK);

		if (chunks.length === 1) {
			const table = toMarkdownTable(header, rows);
			return { text: table, format: "csv", chunks: 1, usedApi: false, warnings };
		}

		warnings.push(`Split into ${chunks.length} chunks`);
		const parts = chunks.map((chunk) => {
			// Re-parse chunk text back to rows for markdown conversion
			const chunkLines = (chunk.text ?? "").split("\n");
			const chunkHeader = parseCsvLine(chunkLines[0], delimiter);
			const chunkRows = chunkLines.slice(1).map((l) => parseCsvLine(l, delimiter));
			return toMarkdownTable(chunkHeader, chunkRows);
		});

		return {
			text: parts.join("\n\n"),
			format: "csv",
			chunks: chunks.length,
			usedApi: false,
			warnings,
		};
	},
};

/**
 * Detect encoding from buffer.
 * Checks for BOM, then defaults to UTF-8.
 */
function detectEncoding(buffer: Buffer): string {
	// UTF-8 BOM
	if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return buffer.subarray(3).toString("utf-8");
	}
	// UTF-16 LE BOM
	if (buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.toString("utf-16le");
	}
	// Default to UTF-8
	return buffer.toString("utf-8");
}

/**
 * Detect CSV delimiter from the first line.
 */
function detectDelimiter(firstLine: string): string {
	const candidates = [",", "\t", ";", "|"];
	let best = ",";
	let bestCount = 0;

	for (const delim of candidates) {
		const count = (firstLine.match(new RegExp(delim === "|" ? "\\|" : delim, "g")) || []).length;
		if (count > bestCount) {
			bestCount = count;
			best = delim;
		}
	}

	return best;
}

/**
 * Simple CSV line parser (handles quoted fields).
 */
function parseCsvLine(line: string, delimiter: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++; // skip escaped quote
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else {
			if (char === '"') {
				inQuotes = true;
			} else if (char === delimiter) {
				fields.push(current);
				current = "";
			} else {
				current += char;
			}
		}
	}

	fields.push(current);
	return fields;
}

/** Convert rows to a markdown table. */
function toMarkdownTable(header: string[], rows: string[][]): string {
	if (header.length === 0) return "(empty table)";

	const lines: string[] = [];
	lines.push(`| ${header.join(" | ")} |`);
	lines.push(`| ${header.map(() => "---").join(" | ")} |`);

	for (const row of rows) {
		const padded = [...row];
		while (padded.length < header.length) padded.push("");
		lines.push(`| ${padded.map(String).join(" | ")} |`);
	}

	return lines.join("\n");
}
