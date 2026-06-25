import chalk from "chalk";
import { selectConfig } from "./cli/config-selector.ts";
import {
	APP_NAME,
	getAgentDir,
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	PACKAGE_NAME,
	type SelfUpdateCommand,
	VERSION,
} from "./config.ts";
import { LocalResourceResolver } from "./core/resource-resolver.ts";
import { SettingsManager } from "./core/settings-manager.ts";
import { Markdown, type MarkdownTheme } from "./core/tui/index.ts";
import { spawnProcess } from "./utils/child-process.ts";
import { getLatestTauRelease, isNewerPackageVersion } from "./utils/version-check.ts";

const SELF_UPDATE_NOTE_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text) => chalk.bold(chalk.yellow(text)),
	link: (text) => chalk.cyan(text),
	linkUrl: (text) => chalk.dim(text),
	code: (text) => chalk.yellow(text),
	codeBlock: (text) => chalk.dim(text),
	codeBlockBorder: (text) => chalk.dim(text),
	quote: (text) => chalk.dim(text),
	quoteBorder: (text) => chalk.dim(text),
	hr: (text) => chalk.dim(text),
	listBullet: (text) => chalk.yellow(text),
	bold: (text) => chalk.bold(text),
	italic: (text) => chalk.italic(text),
	strikethrough: (text) => chalk.strikethrough(text),
	underline: (text) => chalk.underline(text),
};

function reportSettingsErrors(settingsManager: SettingsManager, context: string): void {
	const errors = settingsManager.drainErrors();
	for (const { scope, error } of errors) {
		console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
		if (error.stack) {
			console.error(chalk.dim(error.stack));
		}
	}
}

function printUpdateHelp(): void {
	console.log(`${chalk.bold("Usage:")}
  ${APP_NAME} update [--force]

Update Tau.

Options:
  --force       Reinstall Tau even if the current version is latest
`);
}

function printSelfUpdateUnavailable(npmCommand?: string[], updatePackageName = PACKAGE_NAME): void {
	console.error(`error: ${APP_NAME} cannot self-update this installation.`);
	console.error(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand, updatePackageName));

	const entrypoint = process.argv[1];
	if (entrypoint) {
		console.error("");
		console.error(`Location of ${APP_NAME} executable: ${entrypoint}`);
	}
}

function printSelfUpdateFallback(command: SelfUpdateCommand): void {
	console.error(chalk.dim(`If this keeps failing, run this command yourself: ${command.display}`));
}

function printSelfUpdateNote(note: string): void {
	const trimmedNote = note.trim();
	if (!trimmedNote) {
		return;
	}

	console.log();
	console.log(chalk.bold(chalk.yellow("Update note")));
	try {
		const width = Math.max(20, process.stdout.columns ?? 80);
		const renderedLines = new Markdown(trimmedNote, 0, 0, SELF_UPDATE_NOTE_MARKDOWN_THEME)
			.render(width)
			.map((line) => line.trimEnd());
		console.log(renderedLines.join("\n"));
	} catch {
		console.log(trimmedNote);
	}
	console.log();
}

interface SelfUpdatePlan {
	packageName: string;
	shouldRun: boolean;
	note?: string;
}

async function getSelfUpdatePlan(force: boolean): Promise<SelfUpdatePlan> {
	if (force) {
		return { packageName: PACKAGE_NAME, shouldRun: true };
	}

	try {
		const latestRelease = await getLatestTauRelease(VERSION);
		const packageName = latestRelease?.packageName ?? PACKAGE_NAME;
		if (!latestRelease || packageName !== PACKAGE_NAME || isNewerPackageVersion(latestRelease.version, VERSION)) {
			return { packageName, shouldRun: true, ...(latestRelease?.note ? { note: latestRelease.note } : {}) };
		}
	} catch {
		return { packageName: PACKAGE_NAME, shouldRun: true };
	}

	console.log(chalk.green(`${APP_NAME} is already up to date (v${VERSION})`));
	return { packageName: PACKAGE_NAME, shouldRun: false };
}

async function runSelfUpdate(command: SelfUpdateCommand): Promise<void> {
	console.log(chalk.dim(`Updating ${APP_NAME} with ${command.display}...`));
	for (const step of command.steps ?? [command]) {
		await new Promise<void>((resolve, reject) => {
			const child = spawnProcess(step.command, step.args, {
				stdio: "inherit",
			});
			child.on("error", (error) => {
				reject(error);
			});
			child.on("close", (code, signal) => {
				if (code === 0) {
					resolve();
				} else if (signal) {
					reject(new Error(`${step.display} terminated by signal ${signal}`));
				} else {
					reject(new Error(`${step.display} exited with code ${code ?? "unknown"}`));
				}
			});
		});
	}
}

function parseProjectTrustOverride(args: readonly string[]): boolean | undefined {
	let trustOverride: boolean | undefined;
	for (const arg of args) {
		if (arg === "--approve" || arg === "-a") {
			trustOverride = true;
		} else if (arg === "--no-approve" || arg === "-na") {
			trustOverride = false;
		}
	}
	return trustOverride;
}

export async function handleConfigCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "config") {
		return false;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const projectTrusted = parseProjectTrustOverride(args) ?? true;
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
	reportSettingsErrors(settingsManager, "config command");
	const resourceResolver = new LocalResourceResolver({ cwd, agentDir, settingsManager });
	const resolvedPaths = await resourceResolver.resolve();

	await selectConfig({
		resolvedPaths,
		settingsManager,
		cwd,
		agentDir,
	});

	process.exit(0);
}

export async function handleUpdateCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "update") {
		return false;
	}

	let force = false;
	for (const arg of args.slice(1)) {
		if (arg === "-h" || arg === "--help") {
			printUpdateHelp();
			return true;
		}
		if (arg === "--force") {
			force = true;
			continue;
		}
		console.error(chalk.red(`Unknown option or argument ${arg} for "update".`));
		console.error(chalk.dim(`Usage: ${APP_NAME} update [--force]`));
		process.exitCode = 1;
		return true;
	}

	const settingsManager = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: true });
	reportSettingsErrors(settingsManager, "update command");
	const npmCommand = settingsManager.getGlobalSettings().npmCommand;
	const selfUpdatePlan = await getSelfUpdatePlan(force);
	if (!selfUpdatePlan.shouldRun) {
		return true;
	}

	const selfUpdateCommand = getSelfUpdateCommand(PACKAGE_NAME, npmCommand, selfUpdatePlan.packageName);
	if (!selfUpdateCommand) {
		printSelfUpdateUnavailable(npmCommand, selfUpdatePlan.packageName);
		process.exitCode = 1;
		return true;
	}

	if (selfUpdatePlan.note) {
		printSelfUpdateNote(selfUpdatePlan.note);
	}

	try {
		await runSelfUpdate(selfUpdateCommand);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown update error";
		console.error(chalk.red(`Error: ${message}`));
		printSelfUpdateFallback(selfUpdateCommand);
		process.exitCode = 1;
		return true;
	}

	console.log(chalk.green(`Updated ${APP_NAME}`));
	return true;
}
