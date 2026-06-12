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

| Absolute Path | Lines | Keywords | Description |
|---|---|---|---|
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/bun/cli.ts | 12 | cli, restore-sandbox-env | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/bun/restore-sandbox-env.ts | 33 | restore-sandbox-env, restoreSandboxEnv | Workaround for https://github.com/oven-sh/bun/issues/27802 |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/cli/args.ts | 384 | args, Mode, Args, isValidThinkingLevel, parseArgs | CLI argument parsing and help display |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/cli/config-selector.ts | 60 | config-selector, ResolvedPaths, ConfigSelectorOptions | TUI config selector for `pi config` command |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/cli/file-processor.ts | 100 | file-processor, ProcessedFiles, ProcessFileOptions | Process @file CLI arguments into text content and image attachments |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/cli/initial-message.ts | 44 | initial-message, InitialMessageInput, InitialMessageResult, buildInitialMessage, args | Combine stdin content, @file text, and the first CLI message into a single |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/cli/list-models.ts | 111 | list-models | List available models with optional fuzzy search |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/cli/session-picker.ts | 53 | session-picker | TUI session selector for --resume flag |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/cli.ts | 21 | cli, config, core, main | CLI entry point for the refactored coding agent. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/config.ts | 540 | config, isBunBinary, isBunRuntime, InstallMethod, SelfUpdateCommand | Detect if we're running as a Bun compiled binary. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/agent-session-runtime.ts | 421 | agent-session-runtime, CreateAgentSessionRuntimeResult, CreateAgentSessionRuntimeFactory, SessionImportFileNotFoundError, AgentSessionRuntime | Result returned by runtime creation. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/agent-session-services.ts | 202 | agent-session-services, AgentSessionRuntimeDiagnostic, CreateAgentSessionServicesOptions, CreateAgentSessionFromServicesOptions, AgentSessionServices | Non-fatal issues collected while creating services or sessions. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/agent-session.ts | 3211 | agent-session, ParsedSkillBlock, parseSkillBlock, AgentSessionEvent, AgentSessionEventListener | AgentSession - Core abstraction for agent lifecycle and session management. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/auth-storage.ts | 340 | auth-storage, ApiKeyCredential, AuthCredential, AuthStorageData, AuthStatus | Credential storage for API keys. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/bash-executor.ts | 157 | bash-executor, BashExecutorOptions, BashResult, tools | Bash command execution with streaming support and cancellation. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/compaction/branch-summarization.ts | 369 | branch-summarization, BranchSummaryResult, BranchSummaryDetails, BranchPreparation, CollectEntriesResult | Branch summarization for tree navigation. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/compaction/compaction.ts | 877 | compaction, CompactionDetails, CompactionResult, CompactionSettings, DEFAULT_COMPACTION_SETTINGS | Context compaction for long sessions. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/compaction/index.ts | 8 | index, branch-summarization, compaction, utils | Compaction and summarization utilities. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/compaction/utils.ts | 171 | utils, FileOperations, createFileOps, extractFileOpsFromMessage, computeFileLists | Shared utilities for compaction and branch summarization. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/defaults.ts | 4 | defaults, DEFAULT_THINKING_LEVEL | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/diagnostics.ts | 16 | diagnostics, ResourceCollision, ResourceDiagnostic | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/discord-bridge.ts | 548 | discord-bridge, formatUserMessage, formatAssistantMessage, formatToolResultMessage, formatBashExecutionMessage | Discord Bridge — control Pi from your phone via Discord. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/event-bus.ts | 34 | event-bus, EventBus, EventBusController, createEventBus | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/exec.ts | 108 | exec, ExecOptions, ExecResult | Shared command execution utilities for extensions and custom tools. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/extensions/index.ts | 381 | index, InputSource, SessionStartEvent, ShutdownHandler, TreePreparation | Extension types — minimal stubs after infrastructure removal. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/footer-data-provider.ts | 389 | footer-data-provider, FooterDataProvider, ReadonlyFooterDataProvider | Find git metadata paths by walking up from cwd. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/http-dispatcher.ts | 63 | http-dispatcher, DEFAULT_HTTP_IDLE_TIMEOUT_MS, HTTP_IDLE_TIMEOUT_CHOICES, parseHttpIdleTimeoutMs, formatHttpIdleTimeoutMs | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/index.ts | 116 | index, agent-session, agent-session-runtime, agent-session-services, bash-executor | Core modules shared between all run modes. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/keybindings.ts | 373 | keybindings, AppKeybindings, AppKeybinding, KEYBINDINGS, migrateKeybindingsConfig | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/messages.ts | 196 | messages, COMPACTION_SUMMARY_PREFIX, COMPACTION_SUMMARY_SUFFIX, BRANCH_SUMMARY_PREFIX, BRANCH_SUMMARY_SUFFIX | Custom message types and transformers for the coding agent. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/model-registry.ts | 991 | model-registry, ResolvedRequestAuth, clearApiKeyCache, ModelRegistry, ProviderConfigInput | Model registry - manages built-in and custom models, provides API key resolution |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/model-resolver.ts | 607 | model-resolver, defaultModelPerProvider, ScopedModel, findExactModelReferenceMatch, ParsedModelResult | Model resolution, scoping, and initial selection |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/output-guard.ts | 109 | output-guard, takeOverStdout, restoreStdout, isStdoutTakenOver, writeRawStdout | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/package-manager.ts | 2574 | package-manager, PathMetadata, ResolvedResource, ResolvedPaths, MissingSourceAction | Compute a numeric precedence rank for a resource based on its metadata. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/prompts/static-prompt.ts | 3 | static-prompt, STATIC_SYSTEM_PROMPT | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/prompt-templates.ts | 286 | prompt-templates, PromptTemplate, parseCommandArgs, substituteArgs, LoadPromptTemplatesOptions | Represents a prompt template loaded from a markdown file |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/provider-attribution.ts | 23 | provider-attribution, mergeProviderAttributionHeaders | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/provider-display-names.ts | 4 | provider-display-names, BUILT_IN_PROVIDER_DISPLAY_NAMES | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/resolve-config-value.ts | 287 | resolve-config-value, getConfigValueEnvVarName, getConfigValueEnvVarNames, getMissingConfigValueEnvVarNames, isCommandConfigValue | Resolve configuration values that may be shell commands, environment variables,  |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/resource-loader.ts | 851 | resource-loader, ResourceExtensionPaths, ResourceLoader, loadProjectContextFiles, DefaultResourceLoaderOptions | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/roadmap.ts | 312 | roadmap, roadmapExists, getRoadmapAbsolutePath, createRoadmap | Project roadmap management. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/sdk.ts | 523 | sdk, CreateAgentSessionOptions, CreateAgentSessionResult, agent-session, auth-storage | Optional default tool suppression mode when no explicit allowlist is provided. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/session-cwd.ts | 60 | session-cwd, SessionCwdIssue, getMissingSessionCwdIssue, formatMissingSessionCwdError, formatMissingSessionCwdPrompt | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/session-manager.ts | 1568 | session-manager, CURRENT_SESSION_VERSION, SessionHeader, NewSessionOptions, SessionEntryBase | Custom entry for extensions to store extension-specific data in the session. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/settings-manager.ts | 1177 | settings-manager, CompactionSettings, BranchSummarySettings, ProviderRetrySettings, RetrySettings | Package source for npm/git packages. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/skills.ts | 488 | skills, SkillFrontmatter, Skill, LoadSkillsResult, LoadSkillsFromDirOptions | Validate skill name per Agent Skills spec. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/slash-commands.ts | 41 | slash-commands, SlashCommandSource, SlashCommandInfo, BuiltinSlashCommand, BUILTIN_SLASH_COMMANDS | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/source-info.ts | 41 | source-info, SourceScope, SourceOrigin, SourceInfo, createSourceInfo | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/subagent/agents.ts | 191 | agents, AgentScope, AgentIsolation, AgentConfig, AgentDiscoveryResult | Agent discovery and configuration for the subagent system. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/subagent/built-in-agents.ts | 66 | built-in-agents, getBuiltInAgents, isBuiltInAgent, agents | Built-in agent definitions. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/subagent/fork.ts | 92 | fork, FORK_BOILERPLATE_TAG, buildForkedMessages, buildChildDirective, isInForkChild | Fork subagent system. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/subagent/task-registry.ts | 186 | task-registry, SubagentTask, NotificationCallback, TaskRegistry, formatTaskNotification | TaskRegistry - Tracks background subagent tasks. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/subagent/tool.ts | 922 | tool, UsageStats, SingleResult, SubagentDetails, resolveAgentTools | SubagentTool - Delegate tasks to specialized agents with isolated context. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/subagent/transcript.ts | 135 | transcript, recordTranscript, readTranscript, writeAgentMetadata, readAgentMetadata | Subagent transcript persistence. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/subagent/worktree.ts | 132 | worktree, WorktreeInfo, createAgentWorktree, hasWorktreeChanges, removeAgentWorktree | Git worktree isolation for subagents. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/system-prompt.ts | 161 | system-prompt, BuildSystemPromptOptions, buildSystemPrompt, prompts, skills | System prompt construction and project context loading |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/task-manager.ts | 188 | task-manager, TaskStatus, BackgroundTask, TaskCompletedEvent, TaskManagerEvents | Background task manager for tracking async bash commands. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/timings.ts | 32 | timings, resetTimings, time, printTimings | Central timing instrumentation for startup profiling. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/todo.ts | 389 | todo, TodoStatus, TodoPriority, Todo, TodoStore | Project todo/issue tracking. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/bash.ts | 834 | bash, BashToolInput, BashToolDetails, BashIntent, BashOperations | Pluggable operations for the bash tool. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/index.ts | 88 | index, Tool, ToolDef, ToolName, allToolNames | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/output-accumulator.ts | 223 | output-accumulator, OutputAccumulatorOptions, OutputSnapshot, OutputAccumulator, truncate | Incrementally tracks streaming output with bounded memory. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/path-utils.ts | 119 | path-utils, expandPath, resolveToCwd, resolveReadPath | Resolve a path relative to the given cwd. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/render-utils.ts | 86 | render-utils, shortenPath, linkPath, str, replaceTabs | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts | 46 | tool-definition-wrapper, wrapToolDefinition, wrapToolDefinitions, createToolDefinitionFromAgentTool | Synthesize a minimal ToolDefinition from an AgentTool. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/api.ts | 218 | api, ApiConfig, types | Multimodal API wrapper. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/chunk.ts | 162 | chunk, DEFAULTS, chunkByPages, chunkPdfImages, chunkAudio | Chunking strategies for different file formats. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/audio.ts | 566 | audio, audioConverter, _interface | Audio converter — traditional DSP pre-processing for better transcription. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/csv.ts | 162 | csv, csvConverter, _interface | CSV/TSV converter. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/docx.ts | 76 | docx, docxConverter, _interface | DOCX/Office document converter. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/image.ts | 180 | image, imageConverter, _interface | Image converter. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/_interface.ts | 26 | _interface, Converter | Converter interface. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/notebook.ts | 137 | notebook, notebookConverter, _interface | Jupyter Notebook (.ipynb) converter. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/pdf.ts | 339 | pdf, pdfConverter, _interface | PDF converter — per-page routing with PyMuPDF analysis. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/converters/xlsx.ts | 104 | xlsx, xlsxConverter, _interface | XLSX/Spreadsheet converter. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/detect.ts | 76 | detect, detectFormat, getExtension, formatName, types | File type detection by extension and magic bytes. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/pdf-analyze.ts | 121 | pdf-analyze, types | PDF page analyzer — per-page routing using PyMuPDF via Python subprocess. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/transcribe.ts | 133 | transcribe, TranscribeOutput, converters, detect, types | Transcribe orchestrator. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe.ts | 154 | transcribe, createTranscribeToolDefinition | Transcribe tool — faithful file transcription for any format. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/transcribe/types.ts | 104 | types, FileFormat, PdfType, TranscribeOptions, Chunk | Shared types for the omni-tool transcribe pipeline. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/truncate.ts | 277 | truncate, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES, GREP_MAX_LINE_LENGTH, TruncationResult | Shared truncation utilities for tool outputs. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tools/vision.ts | 122 | vision, createVisionToolDefinition | read-image tool — lets the model directly see image files. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/tool-types.ts | 136 | tool-types, ToolContext, ToolRenderResultOptions, ToolRenderContext, ToolDefinition | Core tool types — extracted from the extension system. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/core/trust-manager.ts | 149 | trust-manager, ProjectTrustDecision, hasProjectTrustInputs, ProjectTrustStore | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/index.ts | 302 | index, cli, config, core, main | Core session management |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/main.ts | 865 | main, MainOptions, cli, config, core | Main entry point for the coding agent CLI. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/migrations.ts | 448 | migrations, migrateAuthToAuthJson, migrateSessionsFromAgentRoot, runMigrations, config | One-time migrations that run on startup. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/index.ts | 8 | index, ModelInfo, interactive, print-mode | Run modes for the coding agent. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/armin.ts | 383 | armin, ArminComponent | Armin says hi! A fun easter egg with animated XBM art. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/assistant-message.ts | 137 | assistant-message, AssistantMessageComponent | Component that renders a complete assistant message |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/bash-execution.ts | 221 | bash-execution, BashExecutionComponent, dynamic-border, keybinding-hints, visual-truncate | Component for displaying bash command execution with streaming output. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/bordered-loader.ts | 69 | bordered-loader, BorderedLoader, dynamic-border, keybinding-hints | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/branch-summary-message.ts | 59 | branch-summary-message, BranchSummaryMessageComponent, keybinding-hints | Component that renders a branch summary message with collapsed/expanded state. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/compaction-summary-message.ts | 60 | compaction-summary-message, CompactionSummaryMessageComponent, keybinding-hints | Component that renders a compaction message with collapsed/expanded state. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/config-selector.ts | 629 | config-selector, ConfigSelectorComponent, dynamic-border, keybinding-hints | TUI component for managing package resources (enable/disable) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/countdown-timer.ts | 40 | countdown-timer, CountdownTimer | Reusable countdown timer for dialog components. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/custom-editor.ts | 81 | custom-editor, CustomEditor | Custom editor that handles app-level keybindings for coding-agent. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/custom-message.ts | 100 | custom-message, CustomMessageComponent | Component that renders a custom message entry from extensions. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/daxnuts.ts | 165 | daxnuts, DaxnutsComponent | POWERED BY DAXNUTS - Easter egg for OpenCode + Kimi K2.5 |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/diff.ts | 148 | diff, RenderDiffOptions, renderDiff | Parse diff line to extract prefix, line number, and content. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/dynamic-border.ts | 26 | dynamic-border, DynamicBorder | Dynamic border component that adjusts to viewport width. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/earendil-announcement.ts | 54 | earendil-announcement, EarendilAnnouncementComponent, dynamic-border | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/extension-editor.ts | 157 | extension-editor, ExtensionEditorComponent, dynamic-border, keybinding-hints | Multi-line editor component for extensions. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/extension-input.ts | 88 | extension-input, ExtensionInputOptions, ExtensionInputComponent, countdown-timer, dynamic-border | Simple text input component for extensions. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/extension-selector.ts | 113 | extension-selector, ExtensionSelectorOptions, ExtensionSelectorComponent, countdown-timer, dynamic-border | Generic selector component for extensions. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/footer.ts | 193 | footer, formatCwdForFooter, FooterComponent | Sanitize text for display in a single-line status. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/index.ts | 32 | index, armin, assistant-message, bash-execution, bordered-loader | UI Components for extensions |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/keybinding-hints.ts | 49 | keybinding-hints, KeyTextFormatOptions, formatKeyText, keyText, keyDisplayText | Utilities for formatting keybinding hints in the UI. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/model-selector.ts | 339 | model-selector, ModelSelectorComponent, dynamic-border, keybinding-hints | Component that renders a model selector with search |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/scoped-models-selector.ts | 356 | scoped-models-selector, ModelsConfig, ModelsCallbacks, ScopedModelsSelectorComponent, dynamic-border | Component for enabling/disabling models for Ctrl+P cycling. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/session-selector-search.ts | 195 | session-selector-search, SortMode, NameFilter, ParsedSearchQuery, MatchResult | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/session-selector.ts | 1024 | session-selector, SessionSelectorComponent, dynamic-border, keybinding-hints, session-selector-search | Build a tree structure from sessions based on parentSessionPath. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/settings-selector.ts | 579 | settings-selector, SettingsConfig, SettingsCallbacks, SettingsSelectorComponent, dynamic-border | A submenu component for selecting from a list of options. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/show-images-selector.ts | 51 | show-images-selector, ShowImagesSelectorComponent, dynamic-border | Component that renders a show images selector with borders |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts | 56 | skill-invocation-message, SkillInvocationMessageComponent, keybinding-hints | Component that renders a skill invocation message with collapsed/expanded state. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/theme-selector.ts | 68 | theme-selector, ThemeSelectorComponent, dynamic-border | Component that renders a theme selector |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/thinking-selector.ts | 75 | thinking-selector, ThinkingSelectorComponent, dynamic-border | Component that renders a thinking level selector with borders |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/tool-execution.ts | 379 | tool-execution, ToolExecutionOptions, ToolExecutionComponent | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/tree-selector.ts | 1252 | tree-selector, FilterMode, TreeSelectorComponent, dynamic-border, keybinding-hints | Tree list component with selection and ASCII art visualization |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/trust-selector.ts | 119 | trust-selector, TrustSelectorOptions, TrustSelectorComponent, dynamic-border, keybinding-hints | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/user-message-selector.ts | 156 | user-message-selector, UserMessageSelectorComponent, dynamic-border | Custom user message list component with selection |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/user-message.ts | 45 | user-message, UserMessageComponent | Component that renders a user message |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/components/visual-truncate.ts | 51 | visual-truncate, VisualTruncateResult, truncateToVisualLines | Shared utility for truncating text to visual lines (accounting for line wrapping |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts | 5528 | interactive-mode, formatResumeCommand, InteractiveModeOptions, InteractiveMode, components | Interactive mode for the coding agent. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/interactive/theme/theme.ts | 1241 | theme, ThemeColor, ThemeBg, Theme, getAvailableThemes | Convert a 256-color index to hex string. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/modes/print-mode.ts | 161 | print-mode, PrintModeOptions | Print mode (single-shot): Send prompts, output result, exit. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/package-manager-cli.ts | 642 | package-manager-cli, PackageCommand, cli, config, core | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/ansi.ts | 61 | ansi, stripAnsi | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/changelog.ts | 100 | changelog, ChangelogEntry, parseChangelog, compareVersions, getNewEntries | Parse changelog entries from CHANGELOG.md |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/child-process.ts | 120 | child-process, spawnProcess, spawnProcessSync, waitForChildProcess | Wait for a child process to terminate without hanging on inherited stdio handles |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/clipboard-image.ts | 301 | clipboard-image, ClipboardImage, isWaylandSession, extensionForImageMimeType, clipboard-native | Convert unsupported image formats to PNG using Photon. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/clipboard-native.ts | 33 | clipboard-native, ClipboardModule, loadClipboardNative | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/clipboard.ts | 128 | clipboard, clipboard-image, clipboard-native | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/deprecation.ts | 15 | deprecation, warnDeprecation, clearDeprecationWarningsForTests | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/exif-orientation.ts | 184 | exif-orientation, applyExifOrientation, photon | Flip orientations mutate in-place. Rotations return a new image (caller must fre |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/frontmatter.ts | 40 | frontmatter, parseFrontmatter, stripFrontmatter | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/fs-watch.ts | 31 | fs-watch, FS_WATCH_RETRY_DELAY_MS, closeWatcher, watchWithErrorHandler | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/git.ts | 227 | git, GitSource, parseGitUrl | Parsed git URL information. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/html.ts | 52 | html, DecodedHtmlEntity, decodeHtmlEntity, decodeHtmlEntityAt | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/image-convert.ts | 42 | image-convert, exif-orientation, photon | Convert image to PNG format for terminal display. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/image-resize-core.ts | 165 | image-resize-core, ImageResizeOptions, ResizedImage, exif-orientation, photon | Resize an image to fit within the specified max dimensions and encoded file size |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/image-resize.ts | 124 | image-resize, formatDimensionNote, image-resize-core | Resize an image to fit within the specified max dimensions and encoded file size |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/image-resize-worker.ts | 43 | image-resize-worker, image-resize-core | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/json.ts | 7 | json, stripJsonComments | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/mime.ts | 75 | mime, detectSupportedImageMimeType | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/open-browser.ts | 25 | open-browser, openBrowser | Open a URL or file in the platform browser/default handler. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/paths.ts | 119 | paths, PathInputOptions, canonicalizePath, isLocalPath, normalizePath | Resolve a path to its canonical (real) form, following symlinks. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/photon.ts | 140 | photon | Photon image processing wrapper. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/pi-user-agent.ts | 5 | pi-user-agent, getPiUserAgent | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/shell.ts | 216 | shell, ShellConfig, getShellConfig, getShellEnv, sanitizeBinaryOutput | Find bash executable on PATH (cross-platform) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/sleep.ts | 19 | sleep | Sleep helper that respects abort signal. |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/syntax-highlight.ts | 147 | syntax-highlight, HighlightFormatter, HighlightTheme, HighlightOptions, renderHighlightedHtml | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/tools-manager.ts | 370 | tools-manager, getToolPath | Check if a command exists in PATH by trying to run it |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/version-check.ts | 107 | version-check, LatestPiRelease, comparePackageVersions, isNewerPackageVersion, pi-user-agent | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/coding-agent/src/utils/windows-self-update.ts | 85 | windows-self-update, cleanupWindowsSelfUpdateQuarantine, quarantineWindowsNativeDependencies, paths | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/agent/src/agent-loop.ts | 743 | agent-loop, AgentEventSink, agentLoop, agentLoopContinue, types | Agent loop that works with AgentMessage throughout. |
| /home/pekka/Desktop/yuuuu/pi/packages/agent/src/agent.ts | 558 | agent, AgentOptions, Agent, agent-loop, types | Stateful wrapper around the low-level agent loop. |
| /home/pekka/Desktop/yuuuu/pi/packages/agent/src/index.ts | 11 | index, agent, agent-loop, proxy, subagent | Core Agent |
| /home/pekka/Desktop/yuuuu/pi/packages/agent/src/node.ts | 2 | node, index | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/agent/src/proxy.ts | 368 | proxy, ProxyAssistantMessageEvent, ProxyStreamOptions, streamProxy | Proxy stream function for apps that route LLM calls through a server. |
| /home/pekka/Desktop/yuuuu/pi/packages/agent/src/subagent.ts | 140 | subagent, SubagentConfig, runSubagent, getSubagentOutput, getSubagentUsage | Subagent execution engine. |
| /home/pekka/Desktop/yuuuu/pi/packages/agent/src/types.ts | 421 | types, StreamFn, ToolExecutionMode, QueueMode, AgentToolCall | Stream function used by the agent loop. |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/api-registry.ts | 99 | api-registry, ApiStreamFunction, ApiStreamSimpleFunction, ApiProvider, registerApiProvider | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/cli.ts | 148 | cli, utils | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/env-api-keys.ts | 70 | env-api-keys, findEnvKeys, getEnvApiKey, types | Fallback for https://github.com/oven-sh/bun/issues/27802 |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/image-models.generated.ts | 490 | image-models.generated, IMAGE_MODELS, types | This file is auto-generated by scripts/generate-image-models.ts |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/image-models.ts | 43 | image-models, getImageModel, getImageProviders, getImageModels, types | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/images-api-registry.ts | 54 | images-api-registry, ImagesApiFunction, ImagesApiProvider, registerImagesApiProvider, getImagesApiProvider | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/images.ts | 22 | images, images-api-registry, types | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/index.ts | 35 | index, api-registry, env-api-keys, image-models, images | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/models.generated.ts | 4280 | models.generated, MODELS, types | This file is auto-generated by scripts/generate-models.ts |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/models.ts | 93 | models, getModel, getProviders, getModels, calculateCost | Check if two models are equal by comparing both their id and provider. |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/oauth.ts | 2 | oauth, utils | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/providers/images/openrouter.ts | 187 | openrouter, generateImagesOpenRouter | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/providers/images/register-builtins.ts | 51 | register-builtins, generateImagesOpenRouter, registerBuiltInImagesApiProviders, openrouter | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/providers/openai-completions.ts | 1179 | openai-completions, OpenAICompletionsOptions, streamOpenAICompletions, streamSimpleOpenAICompletions, convertMessages | Check if conversation messages contain tool calls or tool results. |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/providers/openai-prompt-cache.ts | 9 | openai-prompt-cache, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH, clampOpenAIPromptCacheKey | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/providers/register-builtins.ts | 141 | register-builtins, streamOpenAICompletions, streamSimpleOpenAICompletions, registerBuiltInApiProviders, resetApiProviders | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/providers/simple-options.ts | 54 | simple-options, buildBaseOptions, clampReasoning, adjustMaxTokensForThinking | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/providers/transform-messages.ts | 221 | transform-messages, transformMessages | Normalize tool call ID for cross-provider compatibility. |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/session-resources.ts | 25 | session-resources, SessionResourceCleanup, registerSessionResourceCleanup, cleanupSessionResources | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/stream.ts | 75 | stream, streamSimple, api-registry, env-api-keys, types | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/types.ts | 572 | types, KnownApi, Api, KnownImagesApi, ImagesApi | Preferred transport for providers that support multiple transports. |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/abort-signals.ts | 42 | abort-signals, CombinedAbortSignal, combineAbortSignals | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/diagnostics.ts | 46 | diagnostics, DiagnosticErrorInfo, AssistantMessageDiagnostic, formatThrownValue, extractDiagnosticError | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/event-stream.ts | 89 | event-stream, EventStream, AssistantMessageEventStream, createAssistantMessageEventStream | Generic event stream class for async iteration |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/hash.ts | 14 | hash, shortHash | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/headers.ts | 8 | headers, headersToRecord | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/json-parse.ts | 125 | json-parse, repairJson, parseJsonWithRepair, parseStreamingJson | Repairs malformed JSON string literals by: |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/node-http-proxy.ts | 124 | node-http-proxy, NodeHttpProxyAgents, UNSUPPORTED_PROXY_PROTOCOL_MESSAGE, resolveHttpProxyUrlForTarget, createHttpProxyAgentsForTarget | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/oauth/index.ts | 44 | index, getOAuthProvider, registerOAuthProvider, unregisterOAuthProvider, resetOAuthProviders | OAuth credential management - stub (only OpenRouter API key auth is supported). |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/oauth/types.ts | 80 | types, OAuthCredentials, OAuthProviderId, OAuthProvider, OAuthPrompt | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/overflow.ts | 162 | overflow, isContextOverflow, getOverflowPatterns | Regex patterns to detect context overflow errors from different providers. |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/sanitize-unicode.ts | 26 | sanitize-unicode, sanitizeSurrogates | Removes unpaired Unicode surrogate characters from a string. |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/typebox-helpers.ts | 25 | typebox-helpers, StringEnum | Creates a string enum schema compatible with Google's API and other providers |
| /home/pekka/Desktop/yuuuu/pi/packages/ai/src/utils/validation.ts | 325 | validation, validateToolCall, validateToolArguments | Finds a tool by name and validates the tool call arguments against its TypeBox s |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/autocomplete.ts | 784 | autocomplete, AutocompleteItem, SlashCommand, AutocompleteSuggestions, AutocompleteProvider | Use fd to walk directory tree (fast, respects .gitignore) |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/box.ts | 140 | box, Box | Box component - a container that applies padding and background to all children |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/cancellable-loader.ts | 41 | cancellable-loader, CancellableLoader, loader | Loader that can be cancelled with Escape. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/editor.ts | 2237 | editor, TextChunk, wordWrapLine, EditorTheme, EditorOptions | A segmenter that wraps Intl.Segmenter and merges graphemes that fall |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/image.ts | 127 | image, ImageTheme, ImageOptions, Image | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/input.ts | 448 | input, Input | Input component - single-line text input with horizontal scrolling |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/loader.ts | 93 | loader, LoaderIndicatorOptions, Loader, text | Loader component that updates with an optional spinning animation. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/markdown.ts | 815 | markdown, DefaultTextStyle, MarkdownTheme, MarkdownOptions, Markdown | Default text styling for markdown content. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/select-list.ts | 230 | select-list, SelectItem, SelectListTheme, SelectListTruncatePrimaryContext, SelectListLayoutOptions | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/settings-list.ts | 251 | settings-list, SettingItem, SettingsListTheme, SettingsListOptions, SettingsList | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/spacer.ts | 29 | spacer, Spacer | Spacer component that renders empty lines |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/text.ts | 115 | text, Text | Text component - displays multi-line text with word wrapping |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/components/truncated-text.ts | 66 | truncated-text, TruncatedText | Text component that truncates to fit viewport width |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/editor-component.ts | 75 | editor-component, EditorComponent, autocomplete, tui | Interface for custom editor components. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/fuzzy.ts | 138 | fuzzy, FuzzyMatch, fuzzyMatch, fuzzyFilter | Fuzzy matching utilities. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/index.ts | 108 | index, autocomplete, components, editor-component, fuzzy | Core TUI interfaces and classes |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/keybindings.ts | 245 | keybindings, Keybindings, Keybinding, KeybindingDefinition, KeybindingDefinitions | Global keybinding registry. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/keys.ts | 1401 | keys, setKittyProtocolActive, isKittyProtocolActive, KeyId, Key | Keyboard input handling for terminal applications. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/kill-ring.ts | 47 | kill-ring, KillRing | Ring buffer for Emacs-style kill/yank operations. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/native-modifiers.ts | 60 | native-modifiers, ModifierKey, isNativeModifierPressed | (no description) |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/stdin-buffer.ts | 435 | stdin-buffer, StdinBufferOptions, StdinBufferEventMap, StdinBuffer | StdinBuffer buffers input and emits complete sequences. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/terminal-image.ts | 484 | terminal-image, ImageProtocol, TerminalCapabilities, CellDimensions, ImageDimensions | Checks whether the attached tmux client forwards OSC 8 hyperlinks to the |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/terminal.ts | 532 | terminal, KeyboardProtocolNegotiationSequence, parseKeyboardProtocolNegotiationSequence, isAppleTerminalSession, normalizeAppleTerminalInput | Minimal terminal interface for TUI |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/tui.ts | 1518 | tui, Component, Focusable, isFocusable, CURSOR_MARKER | Minimal TUI implementation with differential rendering |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/undo-stack.ts | 29 | undo-stack, UndoStack | Generic undo stack with clone-on-push semantics. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/utils.ts | 1158 | utils, getGraphemeSegmenter, getWordSegmenter, visibleWidth, normalizeTerminalOutput | Get the shared grapheme segmenter instance. |
| /home/pekka/Desktop/yuuuu/pi/packages/tui/src/word-navigation.ts | 118 | word-navigation, WordNavigationOptions, findWordBackward, findWordForward, utils | Options for word navigation functions. |

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
