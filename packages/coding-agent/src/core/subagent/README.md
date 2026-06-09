# Subagent System

Pi's subagent system allows the main agent to delegate tasks to specialized sub-agents with isolated context. Sub-agents run in-process (not as child processes) and share the same LLM provider infrastructure as the main agent.

## Architecture

```
Main Agent (AgentSession)
  │
  ├── Tool: "subagent" (registered alongside "bash" in _baseToolDefinitions)
  │     │
  │     ├── execute({ agent, task })                    → sync: blocks until result
  │     ├── execute({ tasks: [...] })                   → sync parallel: blocks all
  │     ├── execute({ chain: [...] })                   → sync chain: sequential
  │     ├── execute({ agent, task, run_in_background })  → async: returns immediately
  │     └── execute({ tasks: [...], run_in_background }) → async parallel: returns immediately
  │
  └── Notification Flow (async only):
        background agent completes
          → TaskRegistry.complete()
          → notificationCallback()
          → AgentSession: agent.followUp() or sendUserMessage()
          → main agent receives result on next turn
```

## Key Files

### packages/agent/src/subagent.ts (139 lines)

Core execution engine. Creates an isolated `AgentContext` and runs `agentLoop()` independently from the parent.

| Export | Purpose |
|--------|---------|
| `runSubagent(config)` | Run an isolated agent loop, returns `EventStream<AgentEvent, AgentMessage[]>` |
| `getSubagentOutput(messages)` | Extract final text from agent messages |
| `getSubagentUsage(messages)` | Collect token usage stats across all turns |

### packages/coding-agent/src/core/subagent/agents.ts (152 lines)

Agent discovery from markdown files with YAML frontmatter.

| Export | Purpose |
|--------|---------|
| `discoverAgents(cwd, scope)` | Scan `~/.pi/agent/agents/*.md` and `<project>/.pi/agents/*.md` |
| `AgentConfig` | Parsed agent definition (name, description, tools, model, systemPrompt) |
| `AgentScope` | `"user"` / `"project"` / `"both"` |

Agent file format:

```markdown
---
name: reviewer
description: Code review agent
tools: read,grep,ls
model: gpt-4
---
You are a code reviewer. Focus on security and correctness...
```

### packages/coding-agent/src/core/subagent/task-registry.ts (192 lines)

Tracks background (async) subagent tasks.

| Export | Purpose |
|--------|---------|
| `TaskRegistry` | Register/update/complete/fail/kill background tasks |
| `formatTaskNotification(task, result)` | Build human-readable notification text |
| `SubagentTask` | Task state: id, status, progress, abortController |

### packages/coding-agent/src/core/subagent/tool.ts (559 lines)

The `subagent` tool definition registered in the tool registry.

| Export | Purpose |
|--------|---------|
| `createSubagentToolDefinition(options?)` | Factory for the tool definition |
| `SubagentToolOptions` | `{ taskRegistry?: TaskRegistry }` |
| `SingleResult` / `SubagentDetails` / `UsageStats` | Result types |

### packages/coding-agent/src/core/tools/index.ts

Tool registry factory. `subagent` is registered alongside `bash` as a built-in tool.

```typescript
export type ToolName = "bash" | "subagent";

export function createAllToolDefinitions(cwd, options) {
  return {
    bash: createBashToolDefinition(cwd, options?.bash),
    subagent: createSubagentToolDefinition(options?.subagent),
  };
}
```

### packages/coding-agent/src/core/agent-session.ts

Integration point. Creates `TaskRegistry`, sets up notification callback, passes registry to tool factory.

Key lines:
- Line 316: `_subagentTaskRegistry` field
- Line 341: `new TaskRegistry()` in constructor
- Line 368: notification callback (`agent.followUp` or `sendUserMessage`)
- Line 2470: `createAllToolDefinitions` with subagent options
- Line 2501: `defaultActiveToolNames = ["bash", "subagent"]`

### packages/agent/test/subagent.test.ts (304 lines)

5 tests covering:
1. Basic subagent run + event collection
2. Output extraction
3. Usage stats collection
4. Abort signal handling
5. Full tool call cycle (agent calls tool, gets result, responds)

## Execution Modes

### Sync (blocking)

The main agent calls the subagent tool and waits. The main agent cannot do anything else until the subagent finishes.

```
Main agent turn:
  → LLM generates tool_call: subagent({ agent: "reviewer", task: "..." })
  → runSubagent() runs in-process, iterates event stream
  → Returns result as tool_result
  → LLM continues with result
```

### Async (background)

The main agent calls the subagent with `run_in_background: true` and continues immediately.

```
Main agent turn:
  → LLM generates tool_call: subagent({ agent: "reviewer", task: "...", run_in_background: true })
  → TaskRegistry.register(taskId)
  → void runSingleAgentAsync()  ← fire and forget
  → Returns "Background agent launched..." as tool_result
  → LLM continues working

[Later, on a future turn]:
  → Background agent completes
  → TaskRegistry.complete() → notificationCallback()
  → agent.followUp(notification)  ← injected into main agent's queue
  → Main agent receives notification as a user message
```

## Comparison with Claude Code's Subagent

| Feature | Pi | Claude Code |
|---------|-----|-------------|
| Execution | In-process (agentLoop) | In-process (query loop) |
| Sync mode | Yes | Yes |
| Async/background | Yes (TaskRegistry) | Yes (LocalAgentTask) |
| Notification | agent.followUp() | enqueuePendingNotification() |
| Agent discovery | .md frontmatter | .md + .json + built-in |
| Fork (context inheritance) | Not yet | Yes (experimental) |
| Sync→async conversion | Not yet | Yes |
| Worktree isolation | Not yet | Yes |
| Agent memory | Not yet | Yes |
| MCP server per agent | Not yet | Yes |
| Hooks per agent | Not yet | Yes |
| Sidechain transcript | Not yet | Yes |
| Resume | Not yet | Yes |

## Roadmap

### Phase 1-3: Done

- [x] In-process subagent execution engine (`runSubagent`)
- [x] Agent discovery from .md files
- [x] SubagentTool with sync/parallel/chain modes
- [x] Async/background execution with TaskRegistry
- [x] Notification injection into main agent via followUp
- [x] Registered as built-in tool alongside bash

### Phase 4: Near-term improvements

- [ ] System prompt guidance for LLM (when to use subagent, available agents)
- [ ] TUI status bar showing background agent count and progress
- [ ] Resolve agent.model to actual Model instance (currently uses parent's model)
- [ ] Pass actual tools to subagent (currently empty tool array)
- [ ] Agent confirmation dialog for project-scoped agents

### Phase 5: Advanced features

- [ ] Sync→async conversion (background long-running sync agents)
- [ ] Sidechain transcript persistence + resume
- [ ] Fork mode (inherit parent context for prompt cache sharing)
- [ ] Worktree isolation (git worktree per agent)
- [ ] Agent memory (persistent across sessions)
- [ ] Per-agent MCP server configuration
- [ ] Per-agent hooks (SubagentStart/SubagentStop)
- [ ] Skills preloading from agent frontmatter

## How to Test

```bash
# Run subagent unit tests
cd packages/agent
node ../../node_modules/vitest/dist/cli.js --run test/subagent.test.ts
```
