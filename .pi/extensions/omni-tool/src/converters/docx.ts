/**
 * DOCX/Office document converter.
 *
 * Strategy:
 * 1. Use pandoc to convert to plain text
 * 2. If pandoc fails or output is poor, fall back to API
 *
 * Handles: .docx, .doc, .odt, .rtf
 */

import { execFile } from "node:child_process";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

export const docxConverter: Converter = {
  name: "Office Document",
  extensions: [".docx", ".doc", ".odt", ".rtf"],

  async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
    const warnings: string[] = [];

    // Step 1: Try pandoc
    try {
      const text = await runPandoc(filePath);
      if (text.trim().length > 0) {
        return {
          text: text.trim(),
          format: "docx",
          chunks: 1,
          usedApi: false,
          warnings,
        };
      }
      warnings.push("pandoc returned empty output");
    } catch (err) {
      warnings.push(`pandoc failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 2: Fall back to API (send as file if possible, otherwise error)
    warnings.push("Falling back to API transcription");
    try {
      // pandoc can extract images; for now, just report the failure
      // TODO: extract embedded images and send to API
      const text = await ctx.callApi(
        "This file could not be converted locally. Please describe the content and extract all text.",
      );
      return {
        text,
        format: "docx",
        chunks: 1,
        usedApi: true,
        warnings,
      };
    } catch (err) {
      throw new Error(
        `Failed to transcribe document: ${warnings.join("; ")}. API error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
};

/** Run pandoc to convert a document to plain text. */
function runPandoc(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "pandoc",
      [filePath, "-t", "plain", "--wrap=none"],
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`pandoc failed: ${stderr || err.message}`));
        else resolve(stdout);
      },
    );
  });
}
