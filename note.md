# pi-mono 项目分析

## 项目概览

pi-mono monorepo，包含以下主要包：

| 包 | npm | 用途 |
|---|-----|------|
| `packages/ai` | `@earendil-works/pi-ai` | LLM provider 抽象层 |
| `packages/agent` | `@earendil-works/pi-agent-core` | Agent 框架 |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | 编码代理 CLI |
| `packages/tui` | `@earendil-works/pi-tui` | 终端 UI 库 |
| `packages/ai-dash` | `ai-dash` | 安全 Shell（C 语言） |

依赖关系：
```
tui ←── coding-agent （使用 TUI 组件渲染交互界面）
 ai ←── agent        （agent 通过 ai 包调用 LLM）
agent ←── coding-agent （coding-agent 基于 agent 框架）
ai-dash              （独立的 C 程序，被 coding-agent 的 bash 工具调用）
```

---

## 1. packages/ai — LLM Provider 抽象层

v0.78.1，~30 源文件。

```
src/
├── index.ts                    # 入口
├── types.ts                    # 核心类型定义
├── stream.ts                   # 流式响应处理
├── models.ts / models.generated.ts   # 模型定义 + 自动生成
├── image-models.ts / .generated.ts   # 图像模型
├── api-registry.ts             # Provider 注册表
├── images-api-registry.ts      # 图像 Provider 注册表
├── images.ts                   # 图像生成 API
├── session-resources.ts        # 会话资源管理
├── env-api-keys.ts             # 环境变量 API key 读取
├── oauth.ts                    # OAuth 认证
├── cli.ts                      # CLI 工具
├── providers/                  # 各 LLM provider 实现
│   ├── register-builtins.ts    #   内置 provider 注册
│   ├── simple-options.ts       #   简单配置选项
│   ├── transform-messages.ts   #   消息格式转换
│   ├── openai-completions.ts   #   OpenAI Completions API
│   ├── openai-prompt-cache.ts  #   OpenAI prompt cache
│   └── images/
│       ├── openrouter.ts
│       └── register-builtins.ts
└── utils/                      # 工具函数
    ├── abort-signals.ts, diagnostics.ts, event-stream.ts
    ├── hash.ts, headers.ts, json-parse.ts
    ├── node-http-proxy.ts, overflow.ts, sanitize-unicode.ts
    ├── typebox-helpers.ts, validation.ts
    └── oauth/index.ts, oauth/types.ts
```

**职责**: 统一的 LLM API 层，支持多个 provider（Anthropic, OpenAI, Google, Bedrock, Azure, Cloudflare, Mistral, GitHub Copilot 等），自动生成模型列表，处理流式响应和图像生成。

---

## 2. packages/agent — Agent 框架核心

v0.78.1，~25 源文件。

```
src/
├── index.ts / node.ts          # 入口（通用 + Node.js 特定）
├── types.ts                    # 核心类型
├── agent.ts                    # Agent 主类
├── agent-loop.ts               # Agent 循环（调用 LLM → 执行工具 → 回调）
├── proxy.ts                    # 代理/转发层
└── harness/                    # Agent 运行环境
    ├── agent-harness.ts        #   Agent Harness 主类
    ├── types.ts                #   Harness 类型
    ├── messages.ts             #   消息处理
    ├── system-prompt.ts        #   系统提示词构建
    ├── skills.ts               #   Skills 加载
    ├── prompt-templates.ts     #   提示词模板
    ├── env/nodejs.ts           #   Node.js 环境适配
    ├── compaction/             #   上下文压缩
    │   ├── compaction.ts       #     压缩逻辑
    │   ├── branch-summarization.ts  # 分支摘要
    │   └── utils.ts
    ├── session/                #   会话存储
    │   ├── session.ts          #     会话管理
    │   ├── jsonl-repo.ts       #     JSONL 文件存储
    │   ├── jsonl-storage.ts    #     JSONL 持久化
    │   ├── memory-repo.ts      #     内存存储
    │   ├── memory-storage.ts
    │   ├── repo-utils.ts
    │   └── uuid.ts
    └── utils/
        ├── shell-output.ts
        └── truncate.ts
```

**职责**: 通用 Agent 框架，管理 agent 循环、会话持久化（JSONL/内存）、上下文压缩（compaction）、消息处理。transport 抽象，不绑定特定 UI。

---

## 3. packages/coding-agent — 编码代理 CLI

v0.78.1，入口 `bin: pi`，最大包（~100+ 源文件）。

```
src/
├── cli.ts / main.ts / index.ts    # CLI 入口
├── config.ts / migrations.ts      # 配置 + 迁移
├── package-manager-cli.ts         # 包管理 CLI
│
├── cli/                           # CLI 参数解析
│   ├── args.ts, config-selector.ts, file-processor.ts
│   ├── initial-message.ts, list-models.ts, session-picker.ts
│
├── core/                          # 核心逻辑
│   ├── agent-session.ts           #   Agent 会话
│   ├── agent-session-runtime.ts   #   运行时
│   ├── agent-session-services.ts  #   服务层
│   ├── system-prompt.ts           #   系统提示词（coding-specific）
│   ├── bash-executor.ts           #   Bash 执行器
│   ├── exec.ts                    #   命令执行
│   ├── keybindings.ts             #   快捷键配置
│   ├── model-resolver.ts          #   模型解析
│   ├── model-registry.ts          #   模型注册
│   ├── session-manager.ts         #   会话管理
│   ├── settings-manager.ts        #   设置管理
│   ├── trust-manager.ts           #   信任管理
│   ├── event-bus.ts               #   事件总线
│   ├── slash-commands.ts          #   / 命令
│   ├── skills.ts                  #   技能系统
│   ├── resource-loader.ts         #   资源加载
│   ├── output-guard.ts            #   输出安全检查
│   ├── diagnostics.ts             #   诊断
│   ├── http-dispatcher.ts         #   HTTP 调度
│   ├── compaction/                #   上下文压缩
│   ├── extensions/                #   扩展系统
│   │   ├── index.ts, loader.ts, runner.ts, types.ts, wrapper.ts
│   ├── tools/                     #   工具定义
│   │   ├── bash.ts, index.ts, path-utils.ts
│   │   ├── output-accumulator.ts, render-utils.ts
│   │   ├── tool-definition-wrapper.ts, truncate.ts
│   └── export-html/               #   HTML 导出
│
├── modes/                         # 运行模式
│   ├── index.ts
│   ├── interactive/               #   交互模式（TUI）
│   │   ├── interactive-mode.ts
│   │   ├── theme/ (dark.json, light.json, theme.ts)
│   │   └── components/ (~30 个 UI 组件)
│   │       ├── assistant-message.ts, user-message.ts
│   │       ├── bash-execution.ts, diff.ts
│   │       ├── footer.ts, model-selector.ts
│   │       ├── extension-editor.ts, config-selector.ts
│   │       └── ...
│   ├── print-mode.ts              #   非交互打印模式
│   └── rpc/                       #   RPC 模式（JSONL）
│       ├── rpc-mode.ts, rpc-client.ts, rpc-types.ts, jsonl.ts
│
└── utils/                         # 工具函数
    ├── git.ts, shell.ts, clipboard.ts
    ├── image-resize.ts, image-convert.ts
    ├── syntax-highlight.ts, html.ts
    ├── ansi.ts, fs-watch.ts, paths.ts
    └── ... (~20 个文件)
```

**职责**: 完整的编码代理 CLI，包含 bash/read/edit/write 工具、会话管理、3 种运行模式（交互 TUI、打印、RPC）、扩展系统、主题系统、HTML 导出等。

---

## 4. packages/ai-dash — 安全 Shell（C 语言）

非 npm JS 包 — 修改版的 dash shell（C 语言）。

```
src/
├── main.c, init.c, eval.c      # shell 主循环、初始化、求值
├── exec.c, system.c            # 命令执行
├── parser.c, nodes.c, syntax.c # 解析器
├── expand.c                    # 变量展开
├── jobs.c                      # 作业控制
├── var.c, alias.c              # 变量、别名
├── trap.c, redir.c             # 信号、重定向
├── builtins.c                  # 内建命令注册
├── bltin/                      # 内建命令实现
│   ├── fedit.c                 #   fedit 命令（自定义 search/replace 编辑）
│   ├── rm.c                    #   rm 拦截（移至回收站）
│   ├── test.c, printf.c, times.c
└── (其他标准 dash 源文件)
```

**职责**: 基于 dash 的安全 shell，添加了 fedit（search/replace 文件编辑）、rm 拦截（移到回收站而非删除）、危险命令阻断等安全特性。

---

## 5. packages/tui — 终端 UI 库（详细分析）

v0.78.1 | ~11,700 行 TypeScript | 依赖仅 `marked` + `get-east-asian-width`

一个终端 UI 库，核心特性是**差分渲染**（differential rendering）— 只重绘变化的行，而非每帧全屏刷新。

### 架构层次

```
Terminal (底层 I/O)
  └─ TUI (渲染引擎 + 焦点管理 + Overlay)
       └─ Components (具体 UI 元素)
```

### 文件行数统计

```
 2236 components/editor.ts
 1493 tui.ts
 1400 keys.ts
 1157 utils.ts
  814 components/markdown.ts
  783 autocomplete.ts
  531 terminal.ts
  483 terminal-image.ts
  447 components/input.ts
  434 stdin-buffer.ts
  250 components/settings-list.ts
  244 keybindings.ts
  229 components/select-list.ts
  139 components/box.ts
  137 fuzzy.ts
  126 components/image.ts
  117 word-navigation.ts
  114 components/text.ts
```

### 核心模块

#### 5.1 terminal.ts (531 行) — 终端抽象

`Terminal` 接口 + `ProcessTerminal` 实现，封装 stdin/stdout raw mode：

- **Kitty 键盘协议协商** — 启动时发送 `CSI > 7 u` 查询，自动检测终端能力（Kitty / modifyOtherKeys / legacy fallback）
- **StdinBuffer** — 将批量 stdin 拆分为单个按键序列，避免粘连
- **Bracketed paste** — 启用 `\x1b[200~` ... `\x1b[201~` 粘贴模式
- **Windows VT Input** — Windows 上加载 native `.node` 模块启用 VT 序列
- **OSC 9;4 进度指示** — 终端进度条（如 ConEmu/WezTerm 支持的）
- **drainInput()** — 退出时排空 stdin，防止 Kitty key release 泄漏到父 shell

#### 5.2 tui.ts (1,493 行) — 渲染引擎

核心类 `TUI extends Container`，实现差分渲染。

**渲染管线**：
```
render(width) → newLines[]
  → compositeOverlays()     // 合成 overlay
  → extractCursorPosition() // 提取 CURSOR_MARKER 位置
  → applyLineResets()       // 给每行追加 reset 序列
  → diff with previousLines
  → 只写变化的行到 stdout
```

**关键机制**：
- **差分对比** — 逐行比较 newLines vs previousLines，只重写 `[firstChanged, lastChanged]` 区间
- **同步输出** — 使用 `\x1b[?2026h` / `\x1b[?2026l` 包裹，防止闪烁
- **Kitty 图片管理** — 跟踪 kitty image ID，变化时自动删除旧图
- **viewport 管理** — 追踪 scrollback 位置，处理终端 resize（全清重绘）
- **渲染节流** — 最小间隔 16ms (60fps)，通过 `process.nextTick` + `setTimeout` 调度
- **宽度溢出保护** — 渲染行超过终端宽度时写 crash log 并抛异常

**Overlay 系统**：
- `showOverlay(component, options)` → 返回 `OverlayHandle`
- 支持 9 种 anchor 定位（center, top-left, bottom-right 等）
- 支持百分比尺寸/定位（`"50%"`）
- 焦点栈管理 — overlay 显示时自动获取焦点，隐藏时恢复之前的焦点
- `nonCapturing` overlay 不抢焦点
- 按 `focusOrder` 合成到基内容上（后画的在上层）

**光标管理**：
- `CURSOR_MARKER = "\x1b_pi:c\x07"` — 组件在渲染输出中标记光标位置
- TUI 提取标记后，用绝对定位移动硬件光标（用于 IME 候选窗口）

**组件接口**：
```typescript
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}

interface Focusable {
  focused: boolean;  // TUI 设置，组件据此输出 CURSOR_MARKER
}
```

#### 5.3 keys.ts (1,400 行) — 键盘输入解析

三层协议支持：

| 协议 | 格式 | 优先级 |
|------|------|--------|
| Kitty CSI-u | `\x1b[<codepoint>;<mod>:<event>u` | 最高 |
| modifyOtherKeys | `\x1b[27;<mod>;<code>~` | 中 |
| Legacy ESC 序列 | `\x1b[A`, `\x1b[Z` 等 | 最低 |

类型安全的 Key 系统：
- `KeyId` 类型 — 编译时校验，支持 `"ctrl+shift+alt+a"` 等组合
- `Key` helper — `Key.ctrl("c")`, `Key.ctrlShift("p")`, `Key.escape` 等带自动补全
- `matchesKey(data, keyId)` — 统一匹配函数，自动处理三层协议
- `parseKey(data)` — 反向解析，raw → keyId 字符串
- 非拉丁键盘布局支持 — 通过 Kitty flag 4 的 `baseLayoutKey` 映射
- Caps Lock / Num Lock 忽略 — `LOCK_MASK` 掩码过滤

#### 5.4 keybindings.ts (244 行) — 快捷键注册表

- 声明式 keybinding 定义，支持 declaration merging 扩展
- 默认绑定：editor 导航（Emacs 风格 `ctrl+a/e/b/f`）、input 操作、select 操作
- 下游包（如 coding-agent）通过 `declare module` 添加自己的 keybinding

#### 5.5 stdin-buffer.ts (434 行) — 输入缓冲

- 将批量 stdin 拆分为独立的 key 序列
- 识别 bracketed paste、Kitty 图片响应、OSC 序列等复合序列
- 可配置超时（默认 10ms）

### 组件库

| 组件 | 行数 | 描述 |
|------|------|------|
| **Editor** | 2,236 | 多行文本编辑器，最大的组件。支持：光标移动（Emacs + 普通）、word wrap、撤销栈、kill ring、paste markers（原子单元）、自动补全、行号、IME |
| **Markdown** | 814 | Markdown 渲染器，基于 `marked` 解析。支持 headings、code blocks（带语法高亮）、引用、列表、链接、图片（Kitty/iTerm2）、表格、HTML inline |
| **Input** | 447 | 单行输入，支持水平滚动、bracketed paste、kill ring（Emacs `ctrl+k/y`）、undo |
| **SelectList** | 229 | 可滚动选择列表，支持 fuzzy filter、description 列、自适应列宽 |
| **SettingsList** | 250 | 设置面板，支持 toggle、描述、选中状态 |
| **Box** | 139 | 边框容器组件 |
| **Image** | 126 | 终端图片显示（Kitty / iTerm2 协议） |
| **Text** | 114 | 静态文本组件 |
| **Loader / CancellableLoader** | ~120 | 加载动画（spinner） |
| **TruncatedText** | ~60 | 自动截断文本 |
| **Spacer** | ~20 | 空白填充 |

### 工具模块

| 模块 | 功能 |
|------|------|
| `utils.ts` (1,157 行) | `visibleWidth()`（东亚宽字符感知）、`truncateToWidth()`、`wrapTextWithAnsi()`、`sliceByColumn()`、ANSI/OSC 序列解析 |
| `terminal-image.ts` (483 行) | Kitty 图片协议 + iTerm2 内联图片，自动检测终端能力 |
| `autocomplete.ts` (783 行) | 自动补全框架，支持斜杠命令 + 多 provider 合并 |
| `fuzzy.ts` (137 行) | 模糊匹配算法 |
| `kill-ring.ts` | Emacs 风格 kill ring（剪贴板环） |
| `undo-stack.ts` | 通用撤销栈 |
| `word-navigation.ts` | 词级光标移动 |
| `native-modifiers.ts` | macOS/Windows 原生修饰键检测 |

### 设计亮点

1. **零依赖 UI 框架** — 不依赖 React/Ink，直接操作终端转义序列
2. **差分渲染** — 只重绘变化的行，~16ms 节流，流畅 60fps
3. **Kitty 协议优先** — 现代终端特性（按键释放、图片、键盘协议协商），对旧终端优雅降级
4. **Overlay 系统** — 类 z-index 图层管理，焦点栈，百分比定位
5. **IME 支持** — CURSOR_MARKER + 硬件光标定位，正确显示中/日输入法候选窗口
6. **东亚宽字符** — 全程追踪 `visibleWidth()`，CJK 字符正确计为 2 列宽
