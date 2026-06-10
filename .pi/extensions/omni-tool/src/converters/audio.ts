/**
 * Audio converter.
 *
 * Strategy:
 * 1. ffprobe for metadata (duration, format, sample rate, channels)
 * 2. ffmpeg pre-processing:
 *    - Volume normalization
 *    - Silence detection (for chunking at natural pauses)
 *    - Convert to API-compatible format (wav/mp3)
 * 3. Chunk by time (10 min default) or silence boundaries
 * 4. Send to multimodal API for transcription
 * 5. Post-process: merge chunks, clean up
 *
 * Non-speech sounds are described in [brackets].
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkAudio, DEFAULTS } from "../chunk.ts";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

export const audioConverter: Converter = {
  name: "Audio",
  extensions: [".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus"],

  async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
    const warnings: string[] = [];

    // Step 1: Get metadata
    const metadata = await getAudioMetadata(filePath);
    const durationMin = (metadata.duration / 60).toFixed(1);
    warnings.push(`Audio: ${durationMin}min, ${metadata.format}, ${metadata.sampleRate}Hz, ${metadata.channels}ch`);

    // Step 2: Pre-process — normalize volume, convert to wav
    const processedPath = await preprocessAudio(filePath, metadata);
    warnings.push("Pre-processed: volume normalized, converted to WAV");

    // Step 3: Detect silence for smarter chunking
    const silences = await detectSilence(processedPath);
    if (silences.length > 0) {
      warnings.push(`Detected ${silences.length} silence points for chunking`);
    }

    // Step 4: Chunk by time (silence-aware chunking is a future enhancement)
    const timeChunks = chunkAudio(metadata.duration, DEFAULTS.AUDIO_MINUTES_PER_CHUNK);
    warnings.push(`Split into ${timeChunks.length} chunk(s)`);

    // Step 5: Extract audio segments and transcribe each
    const results: string[] = [];
    for (let i = 0; i < timeChunks.length; i++) {
      const chunk = timeChunks[i];
      const segmentPath = await extractAudioSegment(
        processedPath,
        chunk.startSec,
        chunk.endSec - chunk.startSec,
      );

      try {
        const segmentData = await readFile(segmentPath);
        const prompt = buildAudioPrompt(chunk.label, i === 0, metadata);

        const text = await ctx.callApi(prompt, segmentData, "audio/wav");
        results.push(`[${chunk.label}]\n${text}`);
      } finally {
        await unlink(segmentPath).catch(() => {});
      }
    }

    // Cleanup
    await unlink(processedPath).catch(() => {});

    return {
      text: results.join("\n\n"),
      format: "audio",
      chunks: timeChunks.length,
      usedApi: true,
      warnings,
    };
  },
};

interface AudioMetadata {
  duration: number; // seconds
  format: string;
  sampleRate: number;
  channels: number;
  bitrate?: number;
}

/** Get audio metadata using ffprobe. */
function getAudioMetadata(filePath: string): Promise<AudioMetadata> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      (err, stdout) => {
        if (err) return reject(new Error(`ffprobe failed: ${err.message}`));

        try {
          const data = JSON.parse(stdout);
          const stream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "audio") ?? data.streams?.[0];
          const format = data.format;

          resolve({
            duration: parseFloat(format?.duration ?? "0"),
            format: format?.format_name ?? "unknown",
            sampleRate: parseInt(stream?.sample_rate ?? "44100", 10),
            channels: stream?.channels ?? 1,
            bitrate: format?.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
          });
        } catch {
          reject(new Error("Failed to parse ffprobe output"));
        }
      },
    );
  });
}

/**
 * Pre-process audio: normalize volume, convert to WAV.
 * Returns path to processed temporary file.
 */
function preprocessAudio(filePath: string, metadata: AudioMetadata): Promise<string> {
  const outPath = join(tmpdir(), `omni-audio-${Date.now()}.wav`);

  return new Promise((resolve, reject) => {
    // Build filter chain
    const filters: string[] = [];

    // Volume normalization (loudnorm filter for broadcast-quality normalization)
    filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

    // High-pass to reduce low-frequency rumble (clothing noise, etc.)
    filters.push("highpass=f=80");

    const filterChain = filters.join(",");

    execFile(
      "ffmpeg",
      ["-y", "-i", filePath, "-af", filterChain, "-ar", "16000", "-ac", "1", outPath],
      (err) => {
        if (err) reject(new Error(`Audio pre-processing failed: ${err.message}`));
        else resolve(outPath);
      },
    );
  });
}

/**
 * Detect silence points using ffmpeg's silencedetect filter.
 * Returns array of silence start times (seconds).
 */
function detectSilence(filePath: string): Promise<number[]> {
  return new Promise((resolve) => {
    execFile(
      "ffmpeg",
      ["-i", filePath, "-af", "silencedetect=noise=-30dB:d=0.5", "-f", "null", "-"],
      (_err, _stdout, stderr) => {
        // Parse silence_end from stderr
        const silenceEnds: number[] = [];
        const regex = /silence_end: ([\d.]+)/g;
        let match;
        while ((match = regex.exec(stderr)) !== null) {
          silenceEnds.push(parseFloat(match[1]));
        }
        resolve(silenceEnds);
      },
    );
  });
}

/** Extract a time segment from an audio file. */
function extractAudioSegment(filePath: string, startSec: number, durationSec: number): Promise<string> {
  const outPath = join(tmpdir(), `omni-segment-${Date.now()}-${startSec}.wav`);

  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-ss", String(startSec), "-i", filePath, "-t", String(durationSec), "-c", "copy", outPath],
      (err) => {
        if (err) reject(new Error(`Segment extraction failed: ${err.message}`));
        else resolve(outPath);
      },
    );
  });
}

function buildAudioPrompt(label: string, isFirstChunk: boolean, metadata: AudioMetadata): string {
  const base = `Transcribe this audio segment faithfully (${label}).`;

  return `${base}

Rules:
- Transcribe ALL speech verbatim. Do not summarize or paraphrase.
- Describe non-speech sounds in [brackets]: e.g., [bird chirping], [door closes], [music playing], [typing], [traffic noise].
- Note speaker changes with [Speaker 1], [Speaker 2], etc. if multiple speakers.
- If speech is unclear, use [unclear] rather than guessing.
- If there is silence, note [silence] briefly — do not fill space.
- Include emotional tone if obvious: [angrily], [laughing], [whispering].
- For environmental sounds, be specific: [rain on window], [distant siren], [phone ringing].

Context: ${metadata.duration}s audio, ${metadata.sampleRate}Hz, ${metadata.channels} channel(s).`;
}
