/**
 * Converter interface.
 *
 * Each format has its own converter that implements this interface.
 * The converter handles: pre-processing, chunking, API calls (if needed),
 * and post-processing. It returns a single merged text result.
 */

import type { ConverterContext, TranscribeResult } from "../types.ts";

export interface Converter {
  /** Format name for logging. */
  readonly name: string;
  /** File extensions this converter handles (with dot). */
  readonly extensions: string[];

  /**
   * Convert a file to text.
   *
   * @param filePath Absolute path to the file.
   * @param ctx Converter context with options, API access, and cwd.
   * @returns TranscribeResult with the faithful transcription.
   */
  convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult>;
}
