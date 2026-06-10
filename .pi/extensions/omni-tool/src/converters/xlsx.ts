/**
 * XLSX/Spreadsheet converter.
 *
 * Strategy:
 * 1. Parse with SheetJS (xlsx)
 * 2. Convert to markdown table format
 * 3. Large sheets are chunked by rows
 *
 * Handles: .xlsx, .xls, .ods
 */

import { readFile } from "node:fs/promises";
import { chunkCsvRows } from "../chunk.ts";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

export const xlsxConverter: Converter = {
  name: "Spreadsheet",
  extensions: [".xlsx", ".xls", ".ods"],

  async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
    const warnings: string[] = [];
    let XLSX: typeof import("xlsx");

    try {
      XLSX = await import("xlsx");
    } catch {
      throw new Error("xlsx package not installed. Run: npm install in .pi/extensions/omni-tool/");
    }

    const buffer = await readFile(filePath);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return { text: "(empty spreadsheet)", format: "xlsx", chunks: 0, usedApi: false, warnings };
    }

    // Determine which sheets to process
    const targetSheets = ctx.options.sheet
      ? sheetNames.filter((name) => name === ctx.options.sheet)
      : sheetNames;

    if (ctx.options.sheet && targetSheets.length === 0) {
      warnings.push(`Sheet "${ctx.options.sheet}" not found. Available: ${sheetNames.join(", ")}`);
      return { text: "", format: "xlsx", chunks: 0, usedApi: false, warnings };
    }

    const sections: string[] = [];

    for (const sheetName of targetSheets) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      // Convert to array of arrays
      const data = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, defval: "" });

      if (data.length === 0) {
        sections.push(`## Sheet: ${sheetName}\n\n(empty)`);
        continue;
      }

      // First row as header
      const header = data[0].map(String);
      const rows = data.slice(1);

      // Chunk if large
      const chunks = chunkCsvRows(rows, header);

      if (chunks.length === 1) {
        sections.push(`## Sheet: ${sheetName}\n\n${toMarkdownTable(header, rows)}`);
      } else {
        warnings.push(`Sheet "${sheetName}" split into ${chunks.length} chunks`);
        const tableParts = chunks.map((chunk) => chunk.text ?? "");
        sections.push(`## Sheet: ${sheetName}\n\n${tableParts.join("\n\n")}`);
      }
    }

    return {
      text: sections.join("\n\n"),
      format: "xlsx",
      chunks: sections.length,
      usedApi: false,
      warnings,
    };
  },
};

/** Convert rows to a markdown table. */
function toMarkdownTable(header: string[], rows: string[][]): string {
  if (header.length === 0) return "(empty table)";

  const lines: string[] = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (const row of rows) {
    // Pad row to match header length
    const padded = [...row];
    while (padded.length < header.length) padded.push("");
    lines.push(`| ${padded.map(String).join(" | ")} |`);
  }

  return lines.join("\n");
}
