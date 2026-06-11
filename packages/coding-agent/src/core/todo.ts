/**
 * Project todo/issue tracking.
 *
 * Stores todos in .pi/todos.json at the project root.
 * Accessible via CLI (`pi todo`), slash command (`/todo`), and agent tools.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type TodoStatus = "open" | "in_progress" | "done" | "cancelled";
export type TodoPriority = "critical" | "high" | "medium" | "low";

export interface Todo {
	id: string;
	title: string;
	status: TodoStatus;
	priority: TodoPriority;
	tags: string[];
	created: string; // ISO date
	updated: string; // ISO date
	description?: string;
}

export interface TodoStore {
	todos: Todo[];
	nextId: number;
}

function getTodosPath(cwd: string): string {
	return join(cwd, ".pi", "todos.json");
}

function ensurePiDir(cwd: string): void {
	const dir = join(cwd, ".pi");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Load todos from disk.
 */
export function loadTodos(cwd: string): TodoStore {
	const path = getTodosPath(cwd);
	if (!existsSync(path)) {
		return { todos: [], nextId: 1 };
	}
	try {
		const raw = readFileSync(path, "utf-8");
		const data = JSON.parse(raw);
		// Migration: handle missing nextId
		if (!data.nextId) {
			data.nextId = data.todos.length > 0
				? Math.max(...data.todos.map((t: Todo) => parseInt(t.id.replace("t-", ""), 10) || 0)) + 1
				: 1;
		}
		return data as TodoStore;
	} catch {
		return { todos: [], nextId: 1 };
	}
}

/**
 * Save todos to disk.
 */
export function saveTodos(cwd: string, store: TodoStore): void {
	ensurePiDir(cwd);
	const path = getTodosPath(cwd);
	writeFileSync(path, JSON.stringify(store, null, "\t") + "\n", "utf-8");
}

/**
 * Add a new todo.
 */
export function addTodo(
	cwd: string,
	title: string,
	options?: { priority?: TodoPriority; tags?: string[]; description?: string },
): Todo {
	const store = loadTodos(cwd);
	const now = new Date().toISOString().split("T")[0];
	const todo: Todo = {
		id: `t-${String(store.nextId).padStart(3, "0")}`,
		title,
		status: "open",
		priority: options?.priority ?? "medium",
		tags: options?.tags ?? [],
		created: now,
		updated: now,
		description: options?.description,
	};
	store.todos.push(todo);
	store.nextId++;
	saveTodos(cwd, store);
	return todo;
}

/**
 * Update a todo by ID.
 */
export function updateTodo(
	cwd: string,
	id: string,
	updates: Partial<Pick<Todo, "title" | "status" | "priority" | "tags" | "description">>,
): Todo | null {
	const store = loadTodos(cwd);
	const todo = store.todos.find((t) => t.id === id);
	if (!todo) return null;

	if (updates.title !== undefined) todo.title = updates.title;
	if (updates.status !== undefined) todo.status = updates.status;
	if (updates.priority !== undefined) todo.priority = updates.priority;
	if (updates.tags !== undefined) todo.tags = updates.tags;
	if (updates.description !== undefined) todo.description = updates.description;
	todo.updated = new Date().toISOString().split("T")[0];

	saveTodos(cwd, store);
	return todo;
}

/**
 * Delete a todo by ID.
 */
export function deleteTodo(cwd: string, id: string): boolean {
	const store = loadTodos(cwd);
	const idx = store.todos.findIndex((t) => t.id === id);
	if (idx === -1) return false;
	store.todos.splice(idx, 1);
	saveTodos(cwd, store);
	return true;
}

/**
 * Query todos with optional filters.
 */
export function queryTodos(
	cwd: string,
	filters?: { status?: TodoStatus; priority?: TodoPriority; tag?: string },
): Todo[] {
	const store = loadTodos(cwd);
	let results = store.todos;

	if (filters?.status) {
		results = results.filter((t) => t.status === filters.status);
	}
	if (filters?.priority) {
		results = results.filter((t) => t.priority === filters.priority);
	}
	if (filters?.tag) {
		results = results.filter((t) => t.tags.includes(filters.tag!));
	}

	// Sort: priority (critical first), then status (open first), then created (newest first)
	const priorityOrder: Record<TodoPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
	const statusOrder: Record<TodoStatus, number> = { in_progress: 0, open: 1, done: 2, cancelled: 3 };

	return results.sort((a, b) => {
		const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
		if (pDiff !== 0) return pDiff;
		const sDiff = statusOrder[a.status] - statusOrder[b.status];
		if (sDiff !== 0) return sDiff;
		return b.created.localeCompare(a.created);
	});
}

/**
 * Format todos as a human-readable table.
 */
export function formatTodos(todos: Todo[]): string {
	if (todos.length === 0) return "No todos.";

	const lines: string[] = [];
	const statusIcon: Record<TodoStatus, string> = {
		open: "[ ]",
		in_progress: "[~]",
		done: "[x]",
		cancelled: "[-]",
	};
	const priorityIcon: Record<TodoPriority, string> = {
		critical: "!!!",
		high: "!! ",
		medium: "!  ",
		low: "   ",
	};

	for (const t of todos) {
		const tags = t.tags.length > 0 ? ` {${t.tags.join(",")}}` : "";
		const desc = t.description ? `\n      ${t.description}` : "";
		lines.push(`${statusIcon[t.status]} ${t.id} ${priorityIcon[t.priority]} ${t.title}${tags}${desc}`);
	}

	return lines.join("\n");
}

/**
 * Format a single todo for display.
 */
export function formatTodo(todo: Todo): string {
	const lines = [
		`ID:          ${todo.id}`,
		`Title:       ${todo.title}`,
		`Status:      ${todo.status}`,
		`Priority:    ${todo.priority}`,
		`Tags:        ${todo.tags.length > 0 ? todo.tags.join(", ") : "(none)"}`,
		`Created:     ${todo.created}`,
		`Updated:     ${todo.updated}`,
	];
	if (todo.description) {
		lines.push(`Description: ${todo.description}`);
	}
	return lines.join("\n");
}

/**
 * Get a summary of todo counts by status.
 */
export function getTodoSummary(cwd: string): string {
	const store = loadTodos(cwd);
	const counts: Record<TodoStatus, number> = { open: 0, in_progress: 0, done: 0, cancelled: 0 };
	for (const t of store.todos) {
		counts[t.status]++;
	}
	return `Open: ${counts.open} | In Progress: ${counts.in_progress} | Done: ${counts.done} | Cancelled: ${counts.cancelled} | Total: ${store.todos.length}`;
}

// ============================================================================
// CLI handler
// ============================================================================

function printUsage(): void {
	console.log(`Usage: pi todo <command> [args]

Commands:
  list [--status <status>] [--priority <priority>] [--tag <tag>]   List todos
  add <title> [--priority <p>] [--tag <t>] [--desc <d>]            Add a todo
  done <id>                                                        Mark as done
  update <id> [--status <s>] [--priority <p>] [--title <t>]        Update a todo
  delete <id>                                                      Delete a todo
  show <id>                                                        Show todo details
  summary                                                          Show counts

Statuses: open, in_progress, done, cancelled
Priorities: critical, high, medium, low
`);
}

/**
 * CLI entry point for `pi todo`.
 */
export async function runTodoCli(cwd: string, args: string[]): Promise<number> {
	if (args.length === 0) {
		printUsage();
		return 0;
	}

	const command = args[0];
	const rest = args.slice(1);

	function flag(name: string): string | undefined {
		const idx = rest.indexOf(`--${name}`);
		if (idx === -1 || idx + 1 >= rest.length) return undefined;
		return rest[idx + 1];
	}

	function positional(): string {
		// Collect all non-flag args as positional
		const parts: string[] = [];
		for (let i = 0; i < rest.length; i++) {
			if (rest[i].startsWith("--")) {
				i++; // skip value
				continue;
			}
			parts.push(rest[i]);
		}
		return parts.join(" ");
	}

	switch (command) {
		case "list":
		case "ls": {
			const status = flag("status") as TodoStatus | undefined;
			const priority = flag("priority") as TodoPriority | undefined;
			const tag = flag("tag");
			const todos = queryTodos(cwd, { status, priority, tag });
			console.log(formatTodos(todos));
			return 0;
		}

		case "add":
		case "new": {
			const title = positional();
			if (!title) {
				console.error("Error: title is required. Usage: pi todo add <title>");
				return 1;
			}
			const priority = flag("priority") as TodoPriority | undefined;
			const tags = flag("tag")?.split(",").map((t) => t.trim()) ?? [];
			const description = flag("desc");
			const todo = addTodo(cwd, title, { priority, tags, description });
			console.log(`Created: ${todo.id} — ${todo.title}`);
			return 0;
		}

		case "done": {
			const id = positional();
			if (!id) {
				console.error("Error: id is required. Usage: pi todo done <id>");
				return 1;
			}
			const todo = updateTodo(cwd, id, { status: "done" });
			if (!todo) {
				console.error(`Error: todo ${id} not found`);
				return 1;
			}
			console.log(`Done: ${todo.id} — ${todo.title}`);
			return 0;
		}

		case "update": {
			const id = positional();
			if (!id) {
				console.error("Error: id is required. Usage: pi todo update <id> [--status ...] [--priority ...]");
				return 1;
			}
			const updates: Parameters<typeof updateTodo>[2] = {};
			const status = flag("status");
			const priority = flag("priority");
			const title = flag("title");
			if (status) updates.status = status as TodoStatus;
			if (priority) updates.priority = priority as TodoPriority;
			if (title) updates.title = title;
			const todo = updateTodo(cwd, id, updates);
			if (!todo) {
				console.error(`Error: todo ${id} not found`);
				return 1;
			}
			console.log(`Updated: ${todo.id} — ${todo.title} [${todo.status}]`);
			return 0;
		}

		case "delete":
		case "rm": {
			const id = positional();
			if (!id) {
				console.error("Error: id is required. Usage: pi todo delete <id>");
				return 1;
			}
			const ok = deleteTodo(cwd, id);
			if (!ok) {
				console.error(`Error: todo ${id} not found`);
				return 1;
			}
			console.log(`Deleted: ${id}`);
			return 0;
		}

		case "show": {
			const id = positional();
			if (!id) {
				console.error("Error: id is required. Usage: pi todo show <id>");
				return 1;
			}
			const store = loadTodos(cwd);
			const todo = store.todos.find((t) => t.id === id);
			if (!todo) {
				console.error(`Error: todo ${id} not found`);
				return 1;
			}
			console.log(formatTodo(todo));
			return 0;
		}

		case "summary": {
			console.log(getTodoSummary(cwd));
			return 0;
		}

		default:
			console.error(`Unknown command: ${command}`);
			printUsage();
			return 1;
	}
}
