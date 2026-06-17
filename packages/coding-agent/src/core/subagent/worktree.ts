/**
 * Git worktree isolation for subagents.
 *
 * Creates temporary git worktrees so agents can work on isolated copies
 * of the repository without affecting the parent's working directory.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { getProjectDir } from "../../config.ts";

export interface WorktreeInfo {
	worktreePath: string;
	worktreeBranch: string;
	headCommit: string;
	gitRoot: string;
}

/**
 * Create a git worktree for an agent.
 *
 * @param cwd - The repository root (or a directory inside it)
 * @param slug - A unique slug for the worktree branch name (e.g., "agent-abc123")
 * @returns WorktreeInfo with paths and commit info, or null if not a git repo
 */
export function createAgentWorktree(cwd: string, slug: string): WorktreeInfo | null {
	// Find git root
	let gitRoot: string;
	try {
		gitRoot = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8" }).trim();
	} catch {
		return null; // Not a git repo
	}

	// Get current HEAD commit
	let headCommit: string;
	try {
		headCommit = execSync("git rev-parse HEAD", { cwd: gitRoot, encoding: "utf-8" }).trim();
	} catch {
		return null; // No commits yet
	}

	const branchName = `agent-${slug}`;
	const worktreePath = join(getProjectDir(gitRoot), "worktrees", slug);

	// Create worktree directory
	try {
		execSync(`mkdir -p "${join(getProjectDir(gitRoot), "worktrees")}"`, { cwd: gitRoot });
	} catch {
		return null;
	}

	// Create the worktree with a new branch
	try {
		execSync(`git worktree add "${worktreePath}" -b "${branchName}" HEAD`, {
			cwd: gitRoot,
			encoding: "utf-8",
			stdio: "pipe",
		});
	} catch {
		// Cleanup on failure
		try {
			execSync(`git worktree remove --force "${worktreePath}"`, { cwd: gitRoot, stdio: "pipe" });
		} catch {
			// Ignore cleanup errors
		}
		return null;
	}

	return {
		worktreePath,
		worktreeBranch: branchName,
		headCommit,
		gitRoot,
	};
}

/**
 * Check if a worktree has changes compared to the base commit.
 *
 * @param worktreePath - Path to the worktree
 * @param headCommit - The commit to compare against
 * @returns true if there are changes, false if clean
 */
export function hasWorktreeChanges(worktreePath: string, headCommit: string): boolean {
	try {
		const status = execSync("git status --porcelain", {
			cwd: worktreePath,
			encoding: "utf-8",
		}).trim();

		if (status.length > 0) return true;

		// Also check for new commits
		const log = execSync(`git log --oneline ${headCommit}..HEAD`, {
			cwd: worktreePath,
			encoding: "utf-8",
		}).trim();

		return log.length > 0;
	} catch {
		// If we can't check, assume there are changes (safer to keep)
		return true;
	}
}

/**
 * Remove a git worktree and its branch.
 *
 * @param worktreePath - Path to the worktree
 * @param branchName - The branch name to delete
 * @param gitRoot - The git repository root
 */
export function removeAgentWorktree(worktreePath: string, branchName: string, gitRoot: string): void {
	try {
		execSync(`git worktree remove --force "${worktreePath}"`, {
			cwd: gitRoot,
			stdio: "pipe",
		});
	} catch {
		// Ignore removal errors
	}

	try {
		execSync(`git branch -D "${branchName}"`, {
			cwd: gitRoot,
			stdio: "pipe",
		});
	} catch {
		// Ignore branch deletion errors
	}
}
