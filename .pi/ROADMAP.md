# Project Roadmap

> Auto-generated project overview. Update this file as the project evolves.
> Agents: reference this file to understand project structure and find important files.

## Architecture

```
packages/ai              LLM provider abstraction (OpenRouter, model registry, streaming)
packages/agent           Agent loop core (runAgentLoop, EventStream, tool execution)
packages/tui             Terminal UI components (Ink-based, themes, keybindings)
packages/ai-dash         Sandboxed shell (C, modified dash) — spawned as subprocess

packages/coding-agent    Main product — depends on all above
├─ src/cli/              CLI argument parsing, entry point
├─ src/core/             Session management, tools, subagent, config
│  ├─ tools/             Bash, Transcribe, Vision tool definitions
│  ├─ subagent/          Fork, worktree, transcript, built-in agents
│  ├─ compaction/        Context compaction for long sessions
│  └─ extensions/        Extension type stubs (infrastructure removed)
├─ src/modes/            Execution modes
│  ├─ interactive/       TUI mode (default)
│  ├─ print-mode.ts      Single-shot mode (-p flag)
│  └─ rpc/               JSON-RPC mode
└─ src/bun/              Bun-specific entry point and sandbox fix
```

## Dependencies

```
coding-agent ──→ agent ──→ ai (LLM provider, streaming)
    │                        ↑
    ├────────────────────────┘
    │
    ├────→ tui (terminal rendering)
    │
    └────→ ai-dash (C binary, spawned via child_process.spawn)
```

## Entry Points

| Want to... | Go to |
|---|---|
| Change CLI args | `src/cli/args.ts` |
| Change tool behavior | `src/core/tools/bash.ts` |
| Add a new tool | `src/core/tools/` + `src/core/tools/index.ts` |
| Change system prompt | `src/core/prompts/static-system-prompt.md` |
| Change subagent logic | `src/core/subagent/tool.ts` |
| Change agent definitions | `src/core/subagent/agents.ts` + `built-in-agents.ts` |
| Change TUI display | `src/modes/interactive/` |
| Change model/provider | `packages/ai/src/providers/` |
| Change agent loop | `packages/agent/src/agent-loop.ts` |
| Change fork/worktree | `src/core/subagent/fork.ts` + `worktree.ts` |
| Change todo system | `src/core/todo.ts` |
| Change roadmap | `src/core/roadmap.ts` |
| Change config/paths | `src/config.ts` |
| Change keybindings | `src/core/keybindings.ts` |
| Change theme | `src/modes/interactive/theme/` |

## File Structure

```
.husky (1)
  pre-commit
.pi/ (10)
  git (1)
    .gitignore
  npm (1)
    .gitignore
  prompts/ (4)
    cl.md
    is.md
    pr.md
    wr.md
  skills (1)
    add-llm-provider.md
  ROADMAP.md
  project-map.md
  todos.json
packages/ (697)
  agent/ (22)
    docs/ (4)
      agent-harness.md
      durable-harness.md
      hooks.md
      observability.md
    src/ (7)
      agent-loop.ts
      agent.ts
      index.ts
      node.ts
      proxy.ts
      subagent.ts
      types.ts
    test/ (6)
      utils/ (2)
        calculate.ts
        get-current-time.ts
      agent-loop.test.ts
      agent.test.ts
      e2e.test.ts
      subagent.test.ts
    CHANGELOG.md
    README.md
    package.json
    tsconfig.build.json
    vitest.config.ts
  ai/ (127)
    scripts/ (2)
      generate-models.ts
      generate-test-image.ts
    src/ (34)
      providers/ (7)
        images/ (2)
          ... (2 more files)
        openai-completions.ts
        openai-prompt-cache.ts
        register-builtins.ts
        simple-options.ts
        transform-messages.ts
      utils/ (13)
        oauth/ (2)
          ... (2 more files)
        abort-signals.ts
        diagnostics.ts
        event-stream.ts
        hash.ts
        headers.ts
        json-parse.ts
        node-http-proxy.ts
        overflow.ts
        sanitize-unicode.ts
        typebox-helpers.ts
        validation.ts
      api-registry.ts
      cli.ts
      env-api-keys.ts
      image-models.generated.ts
      image-models.ts
      images-api-registry.ts
      images.ts
      index.ts
      models.generated.ts
      models.ts
      oauth.ts
      session-resources.ts
      stream.ts
      types.ts
    test/ (84)
      data (1)
        red-circle.png
      abort.test.ts
      anthropic-adaptive-thinking-models.test.ts
      anthropic-eager-tool-input-compat.test.ts
      anthropic-eager-tool-input-e2e.test.ts
      anthropic-empty-thinking-signature-compat.test.ts
      anthropic-force-adaptive-thinking.test.ts
      anthropic-long-cache-retention-e2e.test.ts
      anthropic-oauth.test.ts
      anthropic-opus-4-8-smoke.test.ts
      anthropic-sse-parsing.test.ts
      anthropic-temperature-compat.test.ts
      anthropic-thinking-disable.test.ts
      anthropic-tool-name-normalization.test.ts
      azure-openai-base-url.test.ts
      azure-utils.ts
      bedrock-convert-messages.test.ts
      bedrock-custom-headers.test.ts
      bedrock-endpoint-resolution.test.ts
      bedrock-models.test.ts
      ... (64 more)
    CHANGELOG.md
    README.md
    bedrock-provider.d.ts
    bedrock-provider.js
    package.json
    tsconfig.build.json
    vitest.config.ts
  ai-dash/ (102)
    bin (1)
      ai-dash
    src/ (85)
      bltin/ (10)
        .dirstamp
        bltin.h
        echo.1
        edit.c
        printf.1
        printf.c
        rm.c
        test.1
        test.c
        times.c
      funcs/ (8)
        cmv
        dirs
        kill
        login
        newgrp
        popd
        pushd
        suspend
      .gitignore
      Makefile.am
      Makefile.in
      TOUR
      alias.c
      alias.h
      arith_yacc.c
      arith_yacc.h
      arith_yylex.c
      builtins.def.in
      cd.c
      cd.h
      dash.1
      error.c
      error.h
      eval.c
      eval.h
      exec.c
      ... (49 more)
    COPYING
    ChangeLog
    Makefile.am
    Makefile.in
    README.md
    aclocal.m4
    autogen.sh
    compile
    config.h.in
    configure
    configure.ac
    depcomp
    index.js
    install-sh
    missing
    package.json
  coding-agent/ (378)
    docs/ (33)
      images/ (4)
        doom-extension.png
        exy.png
        interactive-mode.png
        tree-view.png
      compaction.md
      containerization.md
      custom-provider.md
      development.md
      docs.json
      extensions.md
      index.md
      json.md
      keybindings.md
      models.md
      packages.md
      prompt-templates.md
      providers.md
      quickstart.md
      rpc.md
      sdk.md
      session-format.md
      sessions.md
      settings.md
      ... (10 more)
    examples/ (16)
      sdk/ (14)
        01-minimal.ts
        02-custom-model.ts
        03-custom-prompt.ts
        04-skills.ts
        05-tools.ts
        06-extensions.ts
        07-context-files.ts
        08-prompt-templates.ts
        09-api-keys-and-oauth.ts
        10-settings.ts
        11-sessions.ts
        12-full-control.ts
        13-session-runtime.ts
        README.md
      README.md
      rpc-extension-ui.ts
    scripts (1)
      migrate-sessions.sh
    src/ (163)
      bun/ (2)
        cli.ts
        restore-sandbox-env.ts
      cli/ (6)
        args.ts
        config-selector.ts
        file-processor.ts
        initial-message.ts
        list-models.ts
        session-picker.ts
      core/ (76)
        compaction/ (4)
          ... (4 more files)
        extensions (1)
          ... (1 more files)
        prompts/ (2)
          ... (2 more files)
        subagent/ (8)
          ... (8 more files)
        tools/ (23)
          ... (23 more files)
        agent-session-runtime.ts
        agent-session-services.ts
        agent-session.ts
        auth-storage.ts
        bash-executor.ts
        defaults.ts
        diagnostics.ts
        discord-bridge.ts
        event-bus.ts
        exec.ts
        footer-data-provider.ts
        http-dispatcher.ts
        index.ts
        keybindings.ts
        messages.ts
        ... (23 more)
      modes/ (43)
        interactive/ (41)
          ... (41 more files)
        index.ts
        print-mode.ts
      utils/ (29)
        ansi.ts
        changelog.ts
        child-process.ts
        clipboard-image.ts
        clipboard-native.ts
        clipboard.ts
        deprecation.ts
        exif-orientation.ts
        frontmatter.ts
        fs-watch.ts
        git.ts
        highlight-js-lib-index.d.ts
        html.ts
        image-convert.ts
        image-resize-core.ts
        image-resize-worker.ts
        image-resize.ts
        json.ts
        mime.ts
        open-browser.ts
        ... (9 more)
      ai-dash.d.ts
      cli.ts
      config.ts
      index.ts
      main.ts
      migrations.ts
      package-manager-cli.ts
    test/ (157)
      fixtures/ (21)
        empty-agent (1)
          ... (1 more files)
        empty-cwd (1)
          ... (1 more files)
        skills/ (14)
          ... (14 more files)
        skills-collision/ (2)
          ... (2 more files)
        assistant-message-with-thinking-code.json
        before-compaction.jsonl
        large-session.jsonl
      session-manager/ (7)
        build-context.test.ts
        custom-session-id.test.ts
        file-operations.test.ts
        labels.test.ts
        migration.test.ts
        save-entry.test.ts
        tree-traversal.test.ts
      suite/ (28)
        regressions/ (19)
          ... (19 more files)
        README.md
        agent-session-bash-persistence.test.ts
        agent-session-compaction.test.ts
        agent-session-model-extension.test.ts
        agent-session-prompt.test.ts
        agent-session-queue.test.ts
        agent-session-retry-events.test.ts
        agent-session-runtime.test.ts
        harness.ts
      agent-session-auto-compaction-queue.test.ts
      agent-session-branching.test.ts
      agent-session-compaction.test.ts
      agent-session-concurrent.test.ts
      agent-session-dynamic-provider.test.ts
      agent-session-dynamic-tools.test.ts
      agent-session-retry.test.ts
      agent-session-runtime-events.test.ts
      agent-session-stats.test.ts
      agent-session-tree-navigation.test.ts
      ansi-utils.test.ts
      args.test.ts
      assistant-message.test.ts
      auth-storage.test.ts
      bash-close-hang-windows.test.ts
      bash-execution-width.test.ts
      block-images.test.ts
      ... (84 more)
    .gitignore
    CHANGELOG.md
    README.md
    npm-shrinkwrap.json
    package.json
    tsconfig.build.json
    tsconfig.examples.json
    vitest.config.ts
  tui/ (68)
    native/ (6)
      darwin/ (3)
        prebuilds/ (2)
          ... (2 more files)
        src (1)
          ... (1 more files)
      win32/ (3)
        prebuilds/ (2)
          ... (2 more files)
        src (1)
          ... (1 more files)
    src/ (27)
      components/ (12)
        box.ts
        cancellable-loader.ts
        editor.ts
        image.ts
        input.ts
        loader.ts
        markdown.ts
        select-list.ts
        settings-list.ts
        spacer.ts
        text.ts
        truncated-text.ts
      autocomplete.ts
      editor-component.ts
      fuzzy.ts
      index.ts
      keybindings.ts
      keys.ts
      kill-ring.ts
      native-modifiers.ts
      stdin-buffer.ts
      terminal-image.ts
      terminal.ts
      tui.ts
      undo-stack.ts
      utils.ts
      word-navigation.ts
    test/ (30)
      autocomplete.test.ts
      bug-regression-isimageline-startswith-bug.test.ts
      chat-simple.ts
      editor.test.ts
      fuzzy.test.ts
      image-test.ts
      input.test.ts
      key-tester.ts
      keybindings.test.ts
      keys.test.ts
      markdown.test.ts
      overlay-non-capturing.test.ts
      overlay-options.test.ts
      overlay-short-content.test.ts
      regression-regional-indicator-width.test.ts
      select-list.test.ts
      stdin-buffer.test.ts
      tab-width.test.ts
      terminal-image.test.ts
      terminal.test.ts
      ... (10 more)
    CHANGELOG.md
    README.md
    package.json
    tsconfig.build.json
    vitest.config.ts
scripts/ (21)
  browser-smoke-entry.ts
  build-binaries.sh
  check-browser-smoke.mjs
  check-lockfile-commit.mjs
  check-pinned-deps.mjs
  check-ts-relative-imports.mjs
  cost.ts
  edit-tool-stats.mjs
  extract-tool-usage.py
  generate-coding-agent-shrinkwrap.mjs
  local-release.mjs
  profile-coding-agent-node.mjs
  publish.mjs
  read-tool-stats.mjs
  release.mjs
  session-context-stats.mjs
  session-transcripts.ts
  stats.ts
  sync-versions.js
  tool-stats.ts
  ... (1 more)
.gitattributes
.gitignore
.npmrc
LICENSE
biome.json
package-lock.json
package.json
tsconfig.base.json
tsconfig.json
```

## Important Files

| File | Lines | Keywords | Description |
|---|---|---|---|
| packages/coding-agent/src/cli.ts | 21 | cli, config, core, main | CLI entry point for the refactored coding agent. |
| packages/coding-agent/src/main.ts | 865 | main, MainOptions, cli, config, core | Main entry point for the coding agent CLI. |
| packages/coding-agent/src/config.ts | 540 | config, isBunBinary, isBunRuntime, InstallMethod, SelfUpdateCommand | Detect if we're running as a Bun compiled binary. |
| packages/coding-agent/src/core/index.ts | 116 | index, agent-session, agent-session-runtime, agent-session-services, bash-executor | Core modules shared between all run modes. |
| packages/coding-agent/src/core/agent-session.ts | 3211 | agent-session, ParsedSkillBlock, parseSkillBlock, AgentSessionEvent, AgentSessionEventListener | AgentSession - Core abstraction for agent lifecycle and session management. |
| packages/coding-agent/src/core/system-prompt.ts | 161 | system-prompt, BuildSystemPromptOptions, buildSystemPrompt, prompts, skills | System prompt construction and project context loading |
| packages/coding-agent/src/core/todo.ts | 389 | todo, TodoStatus, TodoPriority, Todo, TodoStore | Project todo/issue tracking. |
| packages/coding-agent/src/core/roadmap.ts | 347 | roadmap, roadmapExists, getRoadmapAbsolutePath, createRoadmap | Project roadmap management. |
| packages/coding-agent/src/core/settings-manager.ts | 1177 | settings-manager, CompactionSettings, BranchSummarySettings, ProviderRetrySettings, RetrySettings | Package source for npm/git packages. |
| packages/coding-agent/src/core/model-registry.ts | 991 | model-registry, ResolvedRequestAuth, clearApiKeyCache, ModelRegistry, ProviderConfigInput | Model registry - manages built-in and custom models, provides API key resolution |
| packages/coding-agent/src/core/model-resolver.ts | 607 | model-resolver, defaultModelPerProvider, ScopedModel, findExactModelReferenceMatch, ParsedModelResult | Model resolution, scoping, and initial selection |
| packages/coding-agent/src/core/session-manager.ts | 1568 | session-manager, CURRENT_SESSION_VERSION, SessionHeader, NewSessionOptions, SessionEntryBase | Custom entry for extensions to store extension-specific data in the session. |
| packages/coding-agent/src/core/task-manager.ts | 188 | task-manager, TaskStatus, BackgroundTask, TaskCompletedEvent, TaskManagerEvents | Background task manager for tracking async bash commands. |
| packages/coding-agent/src/core/keybindings.ts | 373 | keybindings, AppKeybindings, AppKeybinding, KEYBINDINGS, migrateKeybindingsConfig | (no description) |
| packages/coding-agent/src/core/http-dispatcher.ts | 63 | http-dispatcher, DEFAULT_HTTP_IDLE_TIMEOUT_MS, HTTP_IDLE_TIMEOUT_CHOICES, parseHttpIdleTimeoutMs, formatHttpIdleTimeoutMs | (no description) |
| packages/coding-agent/src/core/tools/index.ts | 88 | index, Tool, ToolDef, ToolName, allToolNames | (no description) |
| packages/coding-agent/src/core/tools/bash.ts | 834 | bash, BashToolInput, BashToolDetails, BashIntent, BashOperations | Pluggable operations for the bash tool. |
| packages/coding-agent/src/core/tools/transcribe.ts | 154 | transcribe, createTranscribeToolDefinition | Transcribe tool — faithful file transcription for any format. |
| packages/coding-agent/src/core/tools/vision.ts | 122 | vision, createVisionToolDefinition | read-image tool — lets the model directly see image files. |
| packages/coding-agent/src/core/tool-types.ts | 136 | tool-types, ToolContext, ToolRenderResultOptions, ToolRenderContext, ToolDefinition | Core tool types — extracted from the extension system. |
| packages/coding-agent/src/core/subagent/tool.ts | 922 | tool, UsageStats, SingleResult, SubagentDetails, resolveAgentTools | SubagentTool - Delegate tasks to specialized agents with isolated context. |
| packages/coding-agent/src/core/subagent/agents.ts | 191 | agents, AgentScope, AgentIsolation, AgentConfig, AgentDiscoveryResult | Agent discovery and configuration for the subagent system. |
| packages/coding-agent/src/core/subagent/built-in-agents.ts | 66 | built-in-agents, getBuiltInAgents, isBuiltInAgent, agents | Built-in agent definitions. |
| packages/coding-agent/src/core/subagent/fork.ts | 92 | fork, FORK_BOILERPLATE_TAG, buildForkedMessages, buildChildDirective, isInForkChild | Fork subagent system. |
| packages/coding-agent/src/core/subagent/worktree.ts | 132 | worktree, WorktreeInfo, createAgentWorktree, hasWorktreeChanges, removeAgentWorktree | Git worktree isolation for subagents. |
| packages/coding-agent/src/core/subagent/task-registry.ts | 186 | task-registry, SubagentTask, NotificationCallback, TaskRegistry, formatTaskNotification | TaskRegistry - Tracks background subagent tasks. |
| packages/coding-agent/src/core/subagent/transcript.ts | 135 | transcript, recordTranscript, readTranscript, writeAgentMetadata, readAgentMetadata | Subagent transcript persistence. |
| packages/coding-agent/src/modes/interactive/interactive-mode.ts | 5528 | interactive-mode, formatResumeCommand, InteractiveModeOptions, InteractiveMode, components | Interactive mode for the coding agent. |
| packages/coding-agent/src/modes/print-mode.ts | 161 | print-mode, PrintModeOptions | Print mode (single-shot): Send prompts, output result, exit. |
| packages/coding-agent/src/cli/args.ts | 384 | args, Mode, Args, isValidThinkingLevel, parseArgs | CLI argument parsing and help display |
| packages/coding-agent/src/bun/cli.ts | 12 | cli, restore-sandbox-env | (no description) |
| packages/agent/src/index.ts | 11 | index, agent, agent-loop, proxy, subagent | Core Agent |
| packages/agent/src/agent.ts | 558 | agent, AgentOptions, Agent, agent-loop, types | Stateful wrapper around the low-level agent loop. |
| packages/agent/src/agent-loop.ts | 743 | agent-loop, AgentEventSink, agentLoop, agentLoopContinue, types | Agent loop that works with AgentMessage throughout. |
| packages/agent/src/subagent.ts | 140 | subagent, SubagentConfig, runSubagent, getSubagentOutput, getSubagentUsage | Subagent execution engine. |
| packages/agent/src/types.ts | 421 | types, StreamFn, ToolExecutionMode, QueueMode, AgentToolCall | Stream function used by the agent loop. |
| packages/ai/src/index.ts | 35 | index, api-registry, env-api-keys, image-models, images | (no description) |
| packages/ai/src/models.ts | 93 | models, getModel, getProviders, getModels, calculateCost | Check if two models are equal by comparing both their id and provider. |
| packages/ai/src/stream.ts | 75 | stream, streamSimple, api-registry, env-api-keys, types | (no description) |
| packages/ai/src/types.ts | 572 | types, KnownApi, Api, KnownImagesApi, ImagesApi | Preferred transport for providers that support multiple transports. |
| packages/ai/src/providers/openai-completions.ts | 1179 | openai-completions, OpenAICompletionsOptions, streamOpenAICompletions, streamSimpleOpenAICompletions, convertMessages | Check if conversation messages contain tool calls or tool results. |
| packages/tui/src/index.ts | 108 | index, autocomplete, components, editor-component, fuzzy | Core TUI interfaces and classes |
| packages/tui/src/tui.ts | 1518 | tui, Component, Focusable, isFocusable, CURSOR_MARKER | Minimal TUI implementation with differential rendering |

## Tech Stack

- **Runtime**: Bun (compiled binary) / Node.js (dev)
- **Language**: TypeScript (strict)
- **Lint**: Biome
- **Build**: tsgo (type check) + bun build --compile (binary)
- **Shell**: ai-dash (C, modified dash) — spawned as subprocess
- **Test**: Vitest
- **Package**: npm workspaces

## Conventions

- Tool 用 bash，没有独立的 read/write/edit
- 子代理默认继承父工具，除非 agent definition 限制 tools 字段
- Commit message: feat/fix/refactor + 简短描述
- 不要加不必要的抽象层，三次重复才提取
- 改动只限于需求范围，不要"顺手"改别的
