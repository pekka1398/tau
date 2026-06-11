/**
 * Audio converter — with traditional DSP pre-processing.
 *
 * Pipeline:
 *   1. Probe: ffprobe → format, duration, sample rate, channels, bitrate
 *   2. Normalize: any format → WAV 16kHz mono (API-compatible)
 *   3. Analyze: volumedetect, silencedetect, astats
 *   4. Pre-process: compand → afftdn → loudnorm → highpass/lowpass
 *   5. Chunk: by silence boundaries (not fixed time)
 *   6. Send to API: each chunk → Gemini
 *   7. Assemble: merge transcriptions in order
 */

import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

const MAX_CHUNK_SEC = 600; // 10 min hard limit
const SILENCE_THRESH = "-35dB";
const SILENCE_DURATION = "0.4"; // seconds

export const audioConverter: Converter = {
	name: "Audio",
	extensions: [".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus"],

	async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
		const warnings: string[] = [];
		const tmpFiles: string[] = [];

		const cleanup = async () => {
			for (const f of tmpFiles) await unlink(f).catch(() => {});
		};

		try {
			// ── Step 1: Probe ──────────────────────────────────────────────
			const probe = await probeAudio(filePath);
			warnings.push(`Input: ${probe.format}, ${probe.durationSec.toFixed(1)}s, ${probe.sampleRate}Hz, ${probe.channels}ch, ${probe.bitrate ?? "?"}bps`);

			// ── Step 2: Normalize format → WAV 16kHz mono ──────────────────
			const normalizedPath = tmpPath("normalized.wav");
			tmpFiles.push(normalizedPath);
			await ffmpeg(filePath, [
				"-i", filePath,
				"-ar", "16000",
				"-ac", "1",
				"-acodec", "pcm_s16le",
				"-y", normalizedPath,
			]);
			warnings.push("Normalized: WAV 16kHz mono 16-bit");

			// ── Step 3: Analyze ────────────────────────────────────────────
			const analysis = await analyzeAudio(normalizedPath);
			warnings.push(`Volume: max=${analysis.maxVolume}dB, mean=${analysis.meanVolume}dB`);
			warnings.push(`Silence: ${analysis.silences.length} segments detected`);

			// ── Step 4: Pre-process ────────────────────────────────────────
			const processedPath = tmpPath("processed.wav");
			tmpFiles.push(processedPath);

			const filters: string[] = [];

			// Highpass: remove rumble below 80Hz
			filters.push("highpass=f=80");

			// Lowpass: remove hiss above 8kHz (speech range)
			filters.push("lowpass=f=8000");

			// Dynamic compression: tame peaks, boost quiet parts
			// compand: attacks=0.3s, decays=0.8s, soft-knee 6dB
			// Points: -90dB→-90dB (noise floor), -40dB→-35dB (quiet speech),
			//         -20dB→-18dB (normal speech), 0dB→-3dB (peaks)
			const needsCompression = parseFloat(analysis.maxVolume) - parseFloat(analysis.meanVolume) > 20;
			if (needsCompression) {
				filters.push("compand=attacks=0.3:decays=0.8:points=-90/-90|-40/-35|-20/-18|0/-3:soft-knee=6");
				warnings.push("Applied: dynamic compression (high dynamic range detected)");
			}

			// Noise reduction: only if there's significant noise floor
			const hasNoise = parseFloat(analysis.meanVolume) < -35;
			if (hasNoise) {
				filters.push("afftdn=nf=-25");
				warnings.push("Applied: FFT denoising (low mean volume detected)");
			}

			// Loudness normalization to -16 LUFS (broadcast standard)
			filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

			await ffmpeg(normalizedPath, [
				"-i", normalizedPath,
				"-af", filters.join(","),
				"-ar", "16000",
				"-ac", "1",
				"-y", processedPath,
			]);
			warnings.push(`Pre-processing chain: ${filters.length} filters`);

			// ── Step 5: Chunk by silence ───────────────────────────────────
			const processedSilences = await detectSilence(processedPath);
			const chunks = buildChunks(probe.durationSec, processedSilences, MAX_CHUNK_SEC);
			warnings.push(`Chunks: ${chunks.length} (${chunks.map((c) => `${c.startSec.toFixed(0)}-${c.endSec.toFixed(0)}s`).join(", ")})`);

			// ── Step 6: Extract & transcribe each chunk ───────────────────
			const results: string[] = [];
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				const chunkPath = tmpPath(`chunk-${i}.wav`);
				tmpFiles.push(chunkPath);

				await ffmpeg(processedPath, [
					"-i", processedPath,
					"-ss", String(chunk.startSec),
					"-t", String(chunk.endSec - chunk.startSec),
					"-c", "copy",
					"-y", chunkPath,
				]);

				const segmentData = await readFile(chunkPath);
				const prompt = buildAudioPrompt(chunk.label, i === 0, probe);

				const text = await ctx.callApi(prompt, segmentData, "audio/wav");
				results.push(`[${chunk.label}]\n${text}`);
			}

			// ── Step 7: Assemble ──────────────────────────────────────────
			await cleanup();
			return {
				text: results.join("\n\n"),
				format: "audio",
				chunks: chunks.length,
				usedApi: true,
				warnings,
			};
		} catch (err) {
			await cleanup();
			throw err;
		}
	},
};

// ── Types ────────────────────────────────────────────────────────────────────

interface AudioProbe {
	format: string;
	durationSec: number;
	sampleRate: number;
	channels: number;
	bitrate?: number;
}

interface AudioAnalysis {
	maxVolume: string;
	meanVolume: string;
	silences: Array<{ start: number; end?: number }>;
}

interface Chunk {
	startSec: number;
	endSec: number;
	label: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpPath(name: string): string {
	return join(tmpdir(), `omni-audio-${Date.now()}-${name}`);
}

function ffmpeg(input: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		// args already include -i input or -i <path> etc
		execFile("ffmpeg", args, { maxBuffer: 50 * 1024 * 1024 }, (err, _stdout, stderr) => {
			if (err) reject(new Error(`ffmpeg failed: ${stderr?.slice(-200) || err.message}`));
			else resolve();
		});
	});
}

function ffprobe(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("ffprobe", args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) reject(new Error(`ffprobe failed: ${stderr || err.message}`));
			else resolve(stdout);
		});
	});
}

async function probeAudio(filePath: string): Promise<AudioProbe> {
	const stdout = await ffprobe(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath]);
	const data = JSON.parse(stdout);
	const stream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "audio") ?? data.streams?.[0];
	const format = data.format;
	return {
		format: format?.format_name ?? "unknown",
		durationSec: parseFloat(format?.duration ?? "0"),
		sampleRate: parseInt(stream?.sample_rate ?? "44100", 10),
		channels: stream?.channels ?? 1,
		bitrate: format?.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
	};
}

async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
	// volumedetect → max_volume, mean_volume
	const volStdout = await new Promise<string>((resolve) => {
		execFile(
			"ffmpeg",
			["-i", filePath, "-af", "volumedetect", "-f", "null", "-"],
			{ maxBuffer: 10 * 1024 * 1024 },
			(_err, _stdout, stderr) => resolve(stderr ?? ""),
		);
	});

	const maxMatch = volStdout.match(/max_volume:\s*([-\d.]+)\s*dB/);
	const meanMatch = volStdout.match(/mean_volume:\s*([-\d.]+)\s*dB/);

	// silencedetect → silence segments
	const silences = await detectSilence(filePath);

	return {
		maxVolume: maxMatch?.[1] ?? "0",
		meanVolume: meanMatch?.[1] ?? "0",
		silences,
	};
}

async function detectSilence(filePath: string): Promise<Array<{ start: number; end?: number }>> {
	const stdout = await new Promise<string>((resolve) => {
		execFile(
			"ffmpeg",
			["-i", filePath, "-af", `silencedetect=noise=${SILENCE_THRESH}:d=${SILENCE_DURATION}`, "-f", "null", "-"],
			{ maxBuffer: 10 * 1024 * 1024 },
			(_err, _stdout, stderr) => resolve(stderr ?? ""),
		);
	});

	const silences: Array<{ start: number; end?: number }> = [];
	const startRe = /silence_start:\s*([\d.]+)/g;
	const endRe = /silence_end:\s*([\d.]+)/g;

	const starts: number[] = [];
	let m;
	while ((m = startRe.exec(stdout)) !== null) starts.push(parseFloat(m[1]));
	const ends: number[] = [];
	while ((m = endRe.exec(stdout)) !== null) ends.push(parseFloat(m[1]));

	for (let i = 0; i < starts.length; i++) {
		silences.push({ start: starts[i], end: ends[i] });
	}

	return silences;
}

function buildChunks(durationSec: number, silences: Array<{ start: number; end?: number }>, maxSec: number): Chunk[] {
	if (durationSec <= maxSec && silences.length === 0) {
		return [{ startSec: 0, endSec: durationSec, label: formatTime(0) + "-" + formatTime(durationSec) }];
	}

	// Find optimal split points (midpoints of silence segments)
	const splitPoints = silences
		.filter((s) => s.end !== undefined)
		.map((s) => (s.start + s.end!) / 2)
		.sort((a, b) => a - b);

	// Build chunks respecting maxSec
	const chunks: Chunk[] = [];
	let chunkStart = 0;

	for (const sp of splitPoints) {
		if (sp - chunkStart >= maxSec) {
			chunks.push({
				startSec: chunkStart,
				endSec: sp,
				label: formatTime(chunkStart) + "-" + formatTime(sp),
			});
			chunkStart = sp;
		}
	}

	// Final chunk
	if (chunkStart < durationSec) {
		chunks.push({
			startSec: chunkStart,
			endSec: durationSec,
			label: formatTime(chunkStart) + "-" + formatTime(durationSec),
		});
	}

	// If no silence points were usable, fall back to fixed chunks
	if (chunks.length === 0) {
		for (let start = 0; start < durationSec; start += maxSec) {
			const end = Math.min(start + maxSec, durationSec);
			chunks.push({ startSec: start, endSec: end, label: formatTime(start) + "-" + formatTime(end) });
		}
	}

	return chunks;
}

function formatTime(sec: number): string {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = Math.floor(sec % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function buildAudioPrompt(label: string, isFirstChunk: boolean, probe: AudioProbe): string {
	const context = `Audio: ${probe.durationSec.toFixed(0)}s total, ${probe.sampleRate}Hz, ${probe.channels}ch.`;

	return `Transcribe this audio segment faithfully (${label}).
${context}

Rules:
- Transcribe ALL speech verbatim. Do NOT summarize, paraphrase, or omit any content.
- Do NOT add your own commentary or interpretation.
- Describe non-speech sounds in [brackets]: e.g., [bird chirping], [door closes], [music playing].
- Note speaker changes with [Speaker 1], [Speaker 2], etc. if multiple speakers.
- If speech is unclear, use [unclear] rather than guessing.
- If there is silence, note [silence] briefly — do not fill space.
- Include emotional tone if obvious: [angrily], [laughing], [whispering].
- Preserve numbers, dates, names, and technical terms exactly.${isFirstChunk ? "\n- This is the first segment. Identify the language and speakers if possible." : ""}`;
}
