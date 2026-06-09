下一代Agent架构——Pi Agent Core 设计逻辑深度解析
王鹏LLM
王鹏LLM​
华东理工大学 工业催化硕士
​关注他
261 人赞同了该文章
项目地址：https://github.com/badlogic/pi-mono

核心哲学: "An autonomous agent is just an LLM + tools + a loop."
— Mario Zechner, What I learned building an opinionated and minimal coding agent
一、Pi 的反直觉立场
在当前 Agent 框架生态中，大多数项目在做加法：更多工具、更长提示词、更复杂的规划链、更多子 Agent。Pi 的创作者 Mario Zechner 认为这是一条弯路。他的核心论点是：

"前沿模型已经被 RL 训练得足够理解'编码 Agent'是什么。你不需要 10,000 token 的系统提示词。"
这不是空谈。Pi 在 Terminal-Bench 2.0 上使用 Claude Opus 4.5 进入了排行榜前列，与 Codex、Cursor、Windsurf 等拥有复杂工具链的 Agent 竞争——而 Pi 的系统提示词 + 工具定义加起来 不到 1000 token。

对比维度	Claude Code	Codex	Pi
系统提示词	约 10,000+ tokens	适中	< 1,000 tokens
内置工具数	数十个	适中	4 个 (read/write/edit/bash)
Plan Mode	有（黑盒子 Agent）	有	无（用文件代替）
MCP 支持	有	有	无（用 CLI 工具代替）
Sub-Agent	有（不可观测）	—	无（通过 bash 自我调用）
二、架构分层：5 个文件构成的运行时
pi-agent-core 的全部源码只有 5 个文件、约 1,500 行代码：


下面逐层剖析每个核心模块的设计决策。

三、类型系统：少即是多
源码：types.ts
3.1 AgentMessage — 应用状态与模型上下文的分离
这是整个设计最精妙的抽象：

// 空接口 —— 通过 Declaration Merging 扩展
export interface CustomAgentMessages {
    // Empty by default - apps extend via declaration merging
}

// AgentMessage = LLM 消息 + 自定义消息
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
为什么不直接用 LLM 的 Message 类型？ 因为真实应用中存在大量"非 LLM 消息"：

场景	消息类型	交给 LLM？
用户提问	UserMessage	✅
Agent 回复	AssistantMessage	✅
工具结果	ToolResultMessage	✅
UI 通知	{ role: "notification" }	❌ 过滤掉
文件变更事件	{ role: "artifact" }	❌ 过滤掉
会话分支标记	{ role: "branch" }	❌ 过滤掉
应用层通过 Declaration Merging 扩展自定义消息类型，编译器自动推断联合类型。内部所有逻辑（压缩、分支、UI 渲染）都基于 AgentMessage 运转，仅在调用 LLM 的瞬间才通过 convertToLlm() 过滤为 Message[]。

这就是 Zechner 所称的"最晚转换"（late conversion）策略。

3.2 AgentLoopConfig — 可插拔的行为注入
export interface AgentLoopConfig extends SimpleStreamOptions {
    model: Model<any>;
    convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
    transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
    getSteeringMessages?: () => Promise<AgentMessage[]>;
    getFollowUpMessages?: () => Promise<AgentMessage[]>;
    getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
}
注意这里没有 maxSteps、maxTokens、temperature 等"常见"配置项（它们继承自 SimpleStreamOptions，但循环本身不关心这些）。循环只关心两件事：

如何把 AgentMessage 转为 LLM 能懂的格式（convertToLlm）
工具执行间隙有没有人要说话（getSteeringMessages/getFollowUpMessages）
3.3 AgentEvent — 细粒度的生命周期事件
export type AgentEvent =
    | { type: "agent_start" }
    | { type: "agent_end"; messages: AgentMessage[] }
    | { type: "turn_start" }
    | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
    | { type: "message_start"; message: AgentMessage }
    | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
    | { type: "message_end"; message: AgentMessage }
    | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
    | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
    | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
三层嵌套的生命周期：Agent > Turn > Message/Tool。每一层都有 start/end 事件，构成完整的可观测性——这正是 Zechner 反复强调的：

"Claude Code 的 Plan Mode 会 spawn 一个子 Agent，你对子 Agent 内部的运作零可见性。这是黑盒中的黑盒。"
四、核心循环：双层 While 的精密设计
源码：agent-loop.ts
4.1 入口：agentLoop vs agentLoopContinue
两个入口函数体现了一个重要区分：

函数	用途	前置条件
agentLoop(prompts, context, config)	用户发了新消息	可以从空上下文开始
agentLoopContinue(context, config)	重试/恢复	上下文最后一条非 assistant
agentLoopContinue 的存在让 重试 变得优雅：出错后不需要重新构造 prompt，直接 continue() 即可从当前上下文继续。

4.2 双层循环结构
这是 runLoop() 的完整控制流——它是理解 Pi Agent 的关键：


关键设计点：

1. 外层循环: FollowUp 驱动

// agent-loop.ts L116-194
while (true) {
    // ... 内层循环处理 tool calls + steering ...

    // Agent 即将停止，检查 follow-up
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
        pendingMessages = followUpMessages;
        continue; // 重启内层循环！
    }
    break; // 真正停止
}
2. 内层循环: ToolCall + Steering 驱动

// agent-loop.ts L122-182
while (hasMoreToolCalls || pendingMessages.length > 0) {
    // 注入 pending messages
    // 流式调用 LLM
    // 执行工具
    // 检查 steering
}
3. Steering 中断的实现细节

当用户在工具执行期间发送 steering message 时，executeToolCalls 会立即停止执行后续工具，将剩余工具全部标记为"Skipped due to queued user message"并返回错误结果：

// agent-loop.ts L363-374
if (getSteeringMessages) {
    const steering = await getSteeringMessages();
    if (steering.length > 0) {
        steeringMessages = steering;
        const remainingCalls = toolCalls.slice(index + 1);
        for (const skipped of remainingCalls) {
            results.push(skipToolCall(skipped, stream)); // "Skipped due to queued user message."
        }
        break;
    }
}
这意味着 LLM 会在下一轮看到：

已执行工具的正常结果
被跳过工具的错误结果（告知 LLM 这些工具被用户打断了）
用户的 steering message
LLM 因此能理解发生了什么并做出适当调整。

4.3 流式应答处理
streamAssistantResponse() 是 AgentMessage → Message 转换的唯一边界：

// agent-loop.ts L204-289
async function streamAssistantResponse(...) {
    // 1. 可选的上下文变换（剪枝、注入外部上下文）
    let messages = context.messages;
    if (config.transformContext) {
        messages = await config.transformContext(messages, signal);
    }

    // 2. 转换为 LLM 格式（这是唯一的转换点！）
    const llmMessages = await config.convertToLlm(messages);

    // 3. 动态解析 API Key（支持过期 OAuth Token）
    const resolvedApiKey = ...;

    // 4. 流式调用 LLM
    const response = await streamFunction(config.model, llmContext, { ... });

    // 5. 实时转发事件到 EventStream
    for await (const event of response) {
        // partial message 实时更新到 context.messages
        // 每个 delta 都通过 stream.push() 转发给 UI
    }
}
[!IMPORTANT]
partial message 被就地更新到 context.messages 数组中（line 262: context.messages[context.messages.length - 1] = partialMessage），这意味着上下文始终是"当前最新状态"。
五、Agent 类：状态容器 + 消息队列
源码：agent.ts
5.1 两种队列模式
Agent 类引入了思考周到的队列机制：

// Steering mode: "all" = 一次性发送全部 | "one-at-a-time" = 每次只发一条
private steeringMode: "all" | "one-at-a-time";
private followUpMode: "all" | "one-at-a-time";
为什么需要 one-at-a-time？ 考虑这个场景：用户在 Agent 工作时快速发送了 3 条修正。one-at-a-time 模式让 Agent 逐条处理，每条都能得到充分响应，而不是一股脑收到 3 条然后只回应最后一条。

5.2 prompt() vs continue() vs steer() vs followUp()

方法	调用时机	效果
prompt(msg)	Agent 空闲时	开一轮新对话
continue()	Agent 空闲时	从当前状态续接（重试/消费队列）
steer(msg)	Agent 工作时	中断当前工具链，插入消息
followUp(msg)	任何时候	排队到 Agent 完成后执行
abort()	Agent 工作时	取消当前 LLM 调用
5.3 错误恢复
Agent 类在 catch 中构造了一个完整的 AssistantMessage（带 stopReason: "error"），确保错误状态也会成为上下文历史的一部分：

// agent.ts L497-518
catch (err: any) {
    const errorMsg: AgentMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        stopReason: this.abortController?.signal.aborted ? "aborted" : "error",
        errorMessage: err?.message || String(err),
        // ... usage: all zeros
    };
    this.appendMessage(errorMsg);
}
这意味着用户可以 continue() 从错误处重试，LLM 会看到之前的错误信息并据此调整策略。

六、Proxy Stream：带宽优化的客户端重建
源码：proxy.ts
这个模块为 Web 应用场景设计（浏览器 → 代理服务器 → LLM）。核心创新是 带宽优化：服务器不传输 partial 字段（完整的局部消息对象），仅传输轻量的 delta 事件：


ProxyAssistantMessageEvent 比原始 AssistantMessageEvent 轻得多——没有 partial 字段，仅包含 contentIndex + delta 等最小信息。客户端通过 processProxyEvent() 逐步重建完整消息。

七、设计哲学总结
7.1 "不做什么"比"做什么"更重要
刻意不做	理由
无 Plan Mode	用文件 PLAN.md 替代。有完整可观测性，可版本控制，可跨会话共享
无 MCP 支持	MCP 工具描述占 7-9% 上下文窗口。用 CLI + README 通过 bash 调用，按需加载
无 Sub-Agent	"黑盒中的黑盒"，失去可观测性。通过 bash 自我调用，保留完整输出可见性
无 maxSteps	循环自然结束。"我从来没找到需要 maxSteps 的用例，所以为什么要加？"
无权限检查	"安全措施大多是安全剧场。一旦 Agent 能写代码和运行代码，就 game over。"
7.2 核心设计原则

Pi Agent设计原则极简主义可观测性可干预性最晚转换自我进化&lt; 1000 token 系统提示4 个核心工具5 个源文件三层事件生命周期所有工具执行可见拒绝黑盒子 AgentSteering 中断FollowUp 排队Abort 取消内部用 AgentMessage仅 LLM 边界转换自定义消息不泄露通过 bash 自我调用运行时动态扩展不依赖预制 Skills

7.3 写给开发者：何时借鉴 Pi 的设计
✅ 你的 Agent 需要高可观测性 → 学习 Pi 的三层事件系统
✅ 你在构建编码/CLI Agent → 学习"4 工具 + bash"的极简策略
✅ 你需要跨 Provider 会话迁移 → 学习 convertToLlm 的最晚转换模式
✅ 你需要用户中途干预 → 学习 Steering/FollowUp 双队列机制
❌ 你需要复杂的多 Agent 编排 → Pi 的设计理念与此相悖
❌ 你需要严格的安全沙箱 → Pi 明确选择了"YOLO by default"
编辑于 2026-02-10 21:30・湖北
图片
豆包让小白也能玩转 AI 漫画图片生成
豆包让小白也能玩转 AI 漫画图片生成 
查看详情
用户头像
豆包
的广告
​赞同 261​
​25 条评论
​708
​14
​分享
​申请转载
​
​

理性发言，友善互动

25 条评论
默认
最新
老海儿
老海儿
下一代Agent架构是什么样的？这种极简的架构并不能代表下一代Agent架构。

02-11 · 北京
​回复
​8
wentian zhang
wentian zhang
我反而觉得，在复杂的多 Agent 编排中，pi的极简模式已经是最具有实用价值了。其实所有的agent底座其核心处理就是任务的解耦。pi本身的极简架构已经提供了完成小任务的良好骨架，在此基础上以skill的方式扩展为subagent，再通过定制的subagent合作方式嵌入工作流，以目前ai的能力来说这几乎是复杂任务的唯一解——当前ai的能力并不存在一个足够通用的重型架构。即便ai的能力再增长，从效率的角度，一个包打一切的架构本身可能也是低效的。高内聚低耦合是复杂性管理的必然，AI扩展的边界只是将人的工作进一步上移了。

05-21 · 上海
​回复
​8
泰勒展开翅膀
泰勒展开翅膀
下一代 agent 应该由 agent 自己去设计

03-11 · 广东
​回复
​2
向锋
向锋
想要 pi-agent 的简洁设计，又想用 python 技术栈的，可以看下这个项目： ​cubepi.pages.dev/

05-27 · 北京
​回复
​1
提莫
提莫
上下文管理根本没有，丢一张大图片给他，几轮对话下来上下文直接被打满了[大笑]，可能是我的使用姿势不对吧，反正折腾了几天后我还是老老实实用回了 Claude code。
05-28 · 湖南
​回复
​喜欢
MrFGY
MrFGY
这个是不是应该指向判断处🤔


04-28 · 上海
​回复
​喜欢
贾维斯
贾维斯
OpenClaw就是用pi agent core为底层框架的， 凭这一点就值得研究。 Peter Steinberger 用肯定是有原因的。

03-30 · 中国香港
​回复
​喜欢
春秋的呓语
春秋的呓语
我使用OpenClaw的体验很差。同样的模型我觉得OpenCode还可以

05-17 · 河北
​回复
​喜欢
贾维斯
贾维斯
Runtime boundaries
The embedded agent runtime is built on the Pi agent core (models, tools, and prompt pipeline). Session management, discovery, tool wiring, and channel delivery are OpenClaw-owned layers on top of that core.

03-30 · 中国香港
​回复
​喜欢
难能可贵
难能可贵
不同场景而已，跨代，哪个模型给你取的名？

03-27 · 北京
​回复
​喜欢
cosine.Y
cosine.Y
如果用 opus模型，就算你架构很不合理也能跑的很好，pi 就是默认你用的 opus 才基于这个理念设计的架构，这怎么就是下一代架构了呢
03-14 · 浙江
​回复
​喜欢
马克
马克
你这段话不就已经解释了么




Go to LocalLLM
r/LocalLLM
•
1mo ago
Konamicoder
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter

Pi coding agent 是很棒的（或者我如何學會不再擔心並放下 OpenCode）
Discussion
警告：接下來是長篇文章。好消息是，這完全是人類撰寫的。這篇帖子沒有使用任何 AI 的拙劣作品。我是老派的，我喜歡自己實際撰寫我的 Reddit 帖子。想你們會欣賞這篇完全由人類寫成的東西。 ;)

免責聲明：這篇帖子對 Pi 說了好話。我與 Pi 編碼代理的開發團隊沒有任何關聯。

昨天，我第一次在我的本地 LLM 設備上嘗試了 Pi 編碼代理。我之前一直使用 OpenCode 作為我的日常驅動代理，對於 Pi 簡約的方式感到有些害怕。

順便提一下，我的設備是一台擁有 64Gb RAM 的 M4 MacBook Pro。oMLX 是後端，提供 jundot 的 qwen3.6:35b-a3b-oQ6。我大約每秒處理 60 個標記，RAM 使用率約 80%。

我的編碼需求相對適中。我為我的桌上遊戲興趣小組運行大約八個靜態網站，這些網站托管在 GitHub 頁面上。因此，日常任務通常涉及更新用戶提交的網站、實施功能請求、修復小錯誤等。

我已經習慣了 OpenCode 的安全感，與一組內建工具一起。我已經接受，有時 OpenCode 回應請求會花費一些時間，並已習慣它有時的小失誤和可愛的愚蠢錯誤。例如，我經常要求 OpenCode 使用 ImageMagick 命令行工具製作一個 3x3 的桌上遊戲封面圖像拼貼。這通常需要幾次修改，因為 OpenCode 會首先將它們呈現為一條直線，而不是 3x3 的網格。然後在反饋後，它會呈現 3x3 的網格，但每個圖像的尺寸都不同。再者，在更多的反饋之後，它才會最終輸出一個大小相等的 3x3 圖像網格。你知道有句老話說 LLM 就像是新手實習生？在我這裡，OpenCode 常常就像是一個需要多次解釋任務才能正確完成的實習生。

但至少 OpenCode 是我熟悉的那個壞實習生。正如我所說，我已經習慣了在其限制和怪癖中工作。

無論如何，昨天我決定克服對離開 OpenCode 的安全感的緊張，深入探索 Pi 編碼代理的未知深度。我給了 Pi 一個完全相同的任務，使用類似的提示：創建一個指定桌上遊戲封面圖像的 3x3 網格，每個圖像 400x400 像素。

Pi 有條不紊地開始了這個任務。首先，它確定了哪些圖像在本地可用，哪些則不可用。然後它在網上搜索網站以獲取缺失的圖像並本地下載。接著，它按照我所期望的規格創建了 3x3 的網格，第一次就成功了。與 OpenCode 相比，我為 Pi 的表現感到驚訝，因為它更好、更快、更準確、功能更強。我沒有改變本地模型，只是更換了代理設備。如果 OpenCode 像是一個不成熟的實習生，那麼 Pi 更像是一個值得信賴和可靠的隊友。

在 OpenCode 的時候，我一直以為它只能處理例行維護和更新，如果我需要進行更重的工作，就不得不使用像 Codex 這樣的雲模型。但我決定給 Pi 一個更具挑戰性的測試，以發掘其真正的能力。我要求 Pi 計劃一步步添加一個搜索功能到我的一個網站，支持用戶輸入時即時過濾，帶有與網站現有 CSS 相匹配的下拉菜單等。

你猜怎麼著，Pi 擬定了計劃，並向我確認是否可以開始，然後開始一項一項地執行計劃。雖然不是完美，但在幾個地方功能的調用順序有誤。我認真地將網頁檢查器的錯誤反饋給 Pi，它很快確定了問題並修正了它們。在幾分鐘內，我的搜索功能基本上按照我設想的樣子運作了。

更令人印象深刻的是：遵循 Pi 的哲學「如果你需要額外功能，就要求 Pi 來建造」，我要求 Pi 回顧我們的編碼會話，然後根據這些建議一些改進來解決主要的痛點。Pi 認識到它需要更好的自動壓縮功能，還有一種更好的方法來無縫地接續上下文；並且將這些功能整合進自己裡面。它還增加了一個 JS 腳本，以緩解我們遇到的功能調用時機問題。因此，與 Pi 一起工作時，人們逐漸地自定義和改進 Pi，使其更適合你實際的編碼工作。

天啊，我真的很印象深刻。Pi 將這種本地 LLM 的運作方式從「對於例行任務來說夠用」提升到了「足夠好，以至於我認為不需要啟動雲模型」。我現在有信心拋下 OpenCode。

總結：我克服了我的恐懼，嘗試了 Pi 而不是 OpenCode，並擁有了一個很棒的體驗。


Upvote
106

Downvote

92
Go to comments


1

Share
Join the conversation
Sort by:

Best

Search Comments
Expand comment search
Comments Section
u/Existing_Arrival_702 avatar
Existing_Arrival_702
•
1mo ago
這真的很難理解。有人能解釋一下為什麼嗎？據我所知，像 OpenCode、Pi 或甚至 Claude 這類工具其實只是包裝器。實際的推理能力來自於大型語言模型（LLM）。我知道每個工具使用不同的系統提示，但這真的能創造如此巨大的差異，以至於一個工具在同一任務中成功而另一個卻完全失敗嗎？ 這讓我想起了人類。大腦是最重要的部分。無論手臂或腿部稍微強壯或虛弱，應該只會影響工作速度一點，而不會完全毀掉結果。



Upvote
12

Downvote

Reply

Award

Share

confuseddork24
•
1mo ago
這個工具帶來的差異可以非常大。它做的不僅僅是系統提示，還有記憶管理、更廣泛的上下文管理，以及工具、mcps、技能等是如何向代理曝光的、會話管理等等。查看 terminal-bench，他們有通過 harness+LLM 得出的基準分數，這在某種程度上突顯了工具帶來的不同。

所以這的確是一個包裝，但並不是所有的包裝都是一樣的。


Upvote
36

Downvote

Reply

Award

Share

u/LORD_CMDR_INTERNET avatar
LORD_CMDR_INTERNET
•
1mo ago
•
Edited 1mo ago
你的類比是錯誤的。

把安全帶想像成經理，LLM則像是你開發團隊的成員。

一個表現優秀的團隊在擁有優秀、高效、知識豐富的經理與糟糕的經理（那位給他們帶來無意義的需求、噪音、會議及不切實際的期望）時，產出的結果會一樣嗎？

當然不會。一位好的經理能有效地管理工作負荷，設置明確的期望，協助協調工作。這就是安全帶的作用，是的，它對你的工作流程產出有著巨大的影響。



Upvote
8

Downvote

Reply

Award

Share

u/Equal-Chipmunk-4053 avatar
Equal-Chipmunk-4053
•
6d ago
不僅如此，模型還被訓練使用某些工具，因此哪些工具透過 harness 暴露出來是很重要的。


Upvote
1

Downvote

Reply

Award

Share

u/BitterProfessional7p avatar
BitterProfessional7p
•
1mo ago
上下文污染會影響性能。OpenCode 的指令更全面，能夠指導 LLM 並提供更多工具使用。Pi 提供的工具較少，基本上依賴 Bash。

由 ChatGPT 製作的表格，通過下載提示並計算代幣，我尚未驗證以下數字，但根據我的經驗，這些數字似乎是正確的，至少對 Pi、OpenCode、KiloCode 和 Cline 是如此：

工具	默認提示中的代幣數
Pi 代理	~491
OpenCode	~1,809
Cline	~11,747
Codex CLI	~1,500
Claude Code	~15,000
Kilo Code	~10,000–14,000

Upvote
6

Downvote

Reply

Award

Share

InfraScaler
•
1mo ago
手臂或腿稍微強一些或弱一些應該只會稍微影響工作速度，而不會完全毀掉結果。

所以我和尤塞恩·博爾特在100米賽跑中的結果非常相似。他大約需要9秒，而我可能需要60秒。這只是51秒的差距，沒什麼大不了的。


Upvote
10

Downvote

Reply

Award

Share

u/Sleepnotdeading avatar
Sleepnotdeading
•
1mo ago
它們不是包裝，而是束帶。 把它想像成管理一隊搬家工人。 如果你隨便放任他們，他們會抓住看到的東西隨便丟進卡車裡。 如果你把他們放在有搬運帶的束帶裡，他們會先搬運大件家具，因為那正是這些束帶的用途。

這不是一個完美的比喻，但合身的束帶可以讓模型保持專注，並且可以讓一個小型模型表現得超出其實力。



Upvote
3

Downvote

Reply

Award

Share

u/Looz-Ashae avatar
Looz-Ashae
•
1mo ago
它們是包裝材料。"Harness"是千禧世代為包裝材料創造的一個花哨的詞。



Upvote
-1

Downvote

Reply

Award

Share

tinycurses
•
28d ago
我不知道，在典型的程式設計師語言中，包裝器只是一個薄薄的表現/可存取層。

如果它實際上只是提供最初的提示來設定對輸入/輸出的模糊期望，那就可以了。不過這裡的其他評論確實暗示了束帶管理著相當不小的功能性——對我來說，這至少讓它超出了"包裝器"的概念界限。


Upvote
4

Downvote

Reply

Award

Share

u/Sleepnotdeading avatar
Sleepnotdeading
•
1mo ago
“包裝者”是一個笨拙的術語，源於大量不成熟的聊天機器人。“架構”是更準確的術語，用於描述這些模型周圍的現代支架，這實際上會幫助OP進行他們對Pi Code的研究。



Upvote
5

Downvote

Reply

Award

Share

lotekjunky
•
1mo ago
"orchestrator" 這個詞怎麼了？



Upvote
3

Downvote

Reply

Award

Share

l_dang
•
28d ago
不同的事


Upvote
1

Downvote

Reply

Award

Share


Looz-Ashae
•
1mo ago
OneMonk
•
11d ago
包裝和安全帶是兩個不同的東西，真正的價值在於安全帶。包裝大多是沒有價值的。



Upvote
2

Downvote

Reply

Award

Share

u/Looz-Ashae avatar
Looz-Ashae
•
9d ago
哦，是嗎？毫無價值？如果你在我們的領域有能力，那麼告訴我一個在每種程式語言中都能概括包裝器的術語。那麼你就有了評估包裝器無用性的答案。

否則你只是拿著半年前聽過的術語在亂踢，沒有理由讓我們聽你說話。



Upvote
0

Downvote

Reply

Award

Share

OneMonk
•
9d ago
•
Edited 8d ago
如果你想要一些術語，這裡有幾個：適配器、外觀、裝飾器、包裝類、圍繞語句的函數。

不確定你為什麼要我定義包裝器……上述描述都不是對價值的描述。

我的主張是比較性的，包裝器和鞍帶之間，我說鞍帶才是有價值的地方。

包裝器調解/抽象一個大型語言模型的輸出，然後這個輸出被最終用戶消費。通常需要很少的指令，位於調用路徑中並適應或限制訪問。沒有護城河。有限的價值。

鞍帶驅動主題，並需要相當多的技術專業知識來創造：設置環境、提供輸入、運行它、收集輸出，可以對結果進行主動干預。包裝器是重新包裝已存在的東西；鞍帶才是讓你實際測試、評估和提取能力的事物。

希望這已經是對你來說足夠透徹的解釋了。如果你認為這是AI寫的，你真的是無法幫助了。



Upvote
2

Downvote

Reply

Award

Share

u/Looz-Ashae avatar
Looz-Ashae
•
8d ago
一個大型語言模型生成的答案真是絕妙



Upvote
1

Downvote

Reply

Award

Share

OneMonk
•
8d ago
我用了包裝紙，看到吧，毫無價值。


Upvote
2

Downvote

Reply

Award

Share

confuseddork24
•
1mo ago
“包裝”有區別嗎？



Upvote
1

Downvote

Reply

Award

Share

u/Looz-Ashae avatar
Looz-Ashae
•
1mo ago
少一些實體來稱呼相同的事物，可以讓每個人保持一致。是的，確實是這樣。



Upvote
-2

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
你是對的。語言保持不變，從不演變。我們應該繼續把車叫做「無馬馬車」。/s



Upvote
4

Downvote

Reply

Award

Share

u/dookyspoon avatar
dookyspoon
•
8d ago
我很感謝這個 /s。我一直困惑到最後。


Upvote
1

Downvote

Reply

Award

Share

OrbMan99
•
27d ago
也許你對一些較複雜的鞍具不太熟悉。撇開一些系統提示的複雜性，它們通常會添加像源代碼索引、上下文管理和壓縮、記憶體、MCP 和插件生態系統等功能。它們實際上是成熟的應用程序，並且能大大影響體驗和結果。


Upvote
1

Downvote

Reply

Award

Share

DementedJay
•
1mo ago
沒錯，我的感覺也是如此。模型的表現怎麼會受到代理框架如此劇烈的影響？我不是說這不可能，我想我們都見過微小的調整和變化能對結果產生重大影響，但這看起來還是很奇怪。



Upvote
1

Downvote

Reply

Award

Share

Ok_Substance2327
•
1mo ago
Opencodes 系統提示非常龐大，裡面可能有什麼東西解釋那些巨大的差異？



Upvote
6

Downvote

Reply

Award

Share

vtkayaker
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
是的。Pi有一個_超_小的系統提示和4-5個簡單的工具。基本上就是，“嘿，你現在是一個代理人，你有這些基本工具，去吧。”

所以Pi幾乎完全依賴於模型知道如何做編碼代理。但是事實證明Qwen3.6已經知道這一點。我有很多Pi的運行顯示這效果很好。

所以如果Pi的表現超過OpenCode，那可能是因為OpenCode在上下文中灌入了太多東西，讓模型感到困惑。



Upvote
6

Downvote

Reply

Award

Share

Nnazeroth
•
20d ago
PI是一個有bash訪問權限的開源家伙…模形智慧會不斷試錯，直到找到它需要如何做的方式。


Upvote
1

Downvote

Reply

Award

Share

Agreeable-Fly-1980
•
1mo ago
雖然派的很小。派也沒有所有的指示和保護措施。我喜歡它，我也真的很喜歡赫爾墨斯



Upvote
5

Downvote

Reply

Award

Share

u/patsully98 avatar
patsully98
•
1mo ago
請原諒我的無知，但 pi 和 Hermes 之間有多少重疊？他們是在以不同的方式解決類似的問題嗎？解決各自的問題？還是說更可能的情況是可以用一個來解決另一個的問題？



Upvote
1

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
Hermes是一個功能齊全的AI助手平台，具有記憶、消息傳遞、日程安排和子代理。Pi是一個簡約的CLI編碼工具，你可以擴展它來構建你想要的東西。Hermes是“內建電池”的方法；Pi則是“自製電池”的方法。


Upvote
4

Downvote

Reply

Award

Share

Agreeable-Fly-1980
•
27d ago
Pi是我的編程工具，Hermes擅長研究和規劃。至少這是我使用它的方式。我主要與Hermes接口，但讓Hermes使用Pi來編程



Upvote
2

Downvote

Reply

Award

Share

u/Equal-Chipmunk-4053 avatar
Equal-Chipmunk-4053
•
6d ago
赫爾墨斯使用圓周率，並以類似openclaw的方式建立大量的東西


Upvote
1

Downvote

Reply

Award

Share

confuseddork24
•
1mo ago
污染了上下文。克勞德在最近的更新中膨脹了他們的系統提示，而我確實注意到這帶來了負面影響。Pi有一個最小的提示。


Upvote
5

Downvote

Reply

Award

Share

DementedJay
•
1mo ago
這樣說得通。那 Pi 的系統提示是不是小得多，甚至根本沒有？我自己也不知道。



Upvote
1

Downvote

Reply

Award

Share

confuseddork24
•
1mo ago
Pi有一個非常簡單的提示。


Upvote
3

Downvote

Reply

Award

Share

u/Icaruszin avatar
Icaruszin
•
1mo ago
是的，Pi 的功能非常簡單，我想它的系統提示大約只有 1k~ 個標記。它默認只有 4 個工具。


Upvote
3

Downvote

Reply

Award

Share

Ok_Substance2327
•
1mo ago
測試的第二天，我很喜歡它，目前比之前更喜歡。唯一能想到的目前缺少的就是計劃模式，但這可能可以透過擴充功能或其他方式實現。



Upvote
3

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
確實，這是 Pi 文件對此的說明：

 **無計畫模式。** 將計畫寫入文件，或使用 [擴展](#extensions)進行建立，或安裝一個套件。



Upvote
1

Downvote

Reply

Award

Share

Ok_Substance2327
•
1mo ago
是的，我已經讓人幫我組裝了，哈哈。有一個範例可能已經可以使用，但我也想先測試一下。


Upvote
1

Downvote

Reply

Award

Share

evanboho
•
26d ago
所有缺失的部分都在由擴展填補： https://pi.dev/packages?name=plan


Upvote
1

Downvote

Reply

Award

Share

u/Thick-Protection-458 avatar
Thick-Protection-458
•
1mo ago
根據代理框架——不，這是不會的。到頭來，代理框架基本上就是一種華麗的循環運行方式。

根據這個特定的鞍具所提供的任何上下文、工具和上下文管理——當然可以，為什麼不呢？


Upvote
2

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
這是我有限的理解。Pi的簡約方法讓上下文保持乾淨，沒有其他工具的冗餘。保持上下文的清晰意味著模型的推理能力可以更專注於執行編碼任務。這可以帶來更快且更準確的結果。

因此在腦與手的比喻中，工具不僅僅是手。工具還是前額葉皮層，指導大腦（模型）如何處理信息。



Upvote
1

Downvote

Reply

Award

Share

Ambitious_Spare7914
•
1mo ago
安全帶也可以根據「如果這樣，那麼那樣」的邏輯進行一些前處理和後處理，使用傳統的確定性人工智慧。所以你所看到的——以及大型語言模型看到的可能與發送的內容不同。


Upvote
3

Downvote

Reply

Award

Share

u/wahnsinnwanscene avatar
wahnsinnwanscene
•
1mo ago
它們是包裝器，意指 llm 呼叫是主要功能，其餘的都是包裹在上面的。它也是一個鞍具，因為額外的代碼提升了基本功能，能夠包括上下文、記憶和文物管理。


Upvote
1

Downvote

Reply

Award

Share

bemore_
•
1mo ago
一個帶有安全帶的30B模型表現會比單獨的模型更好，所以它不能只是個包裝


Upvote
1

Downvote

Reply

Award

Share

sinan_online
•
28d ago
人類的類比只有那麼大。有時候，回到基本概念是最好的，記住這就是強化版的自動完成功能：你放進去的任何內容，這就是它關注的重點。

對我來說，Claude Code 真是令人驚豔——它要求大型語言模型（LLM）決定是否保留記憶，然後在回憶時，它會詢問 LLM 特定記憶是否相關，然後把那些放進上下文窗口。如果你問我，這真的很聰明，似乎能帶來很多不同。

老實說，那種「推理」對我來說更像是「思緒流淌」。推理似乎是用來籌集資金的公關詞。在較小的模型中，這一點變得十分明顯，它只是無休止地進行，而沒有生成任何有用的東西，這與人類推理有很大不同。如果在這一切之後，更大的模型也會犯一些重要且低級的錯誤。


Upvote
1

Downvote

Reply

Award

Share

u/gvij avatar
gvij
•
21d ago
假設你正在建立一個AI代理。然後試著在Cursor、Claude Code和 Neo AI Engineer 中使用相同的提示進行AI代理的構建任務，並保持相同的模型——比如說Sonnet 4.6，你會發現結果有明顯的差異。模型是相同的。但這個代理圍繞模型所增加的上下文幫助LLM理解任務。

LLM是一個輸入/輸出機器。它獲取輸入並根據其內部推理產生輸出。因此基本上，輸入 + LLM系統提示 + LLM自己的推理 = 輸出。

你擁有輸入和系統提示作為你控制的旋鈕。你扭動提供的上下文和系統提示中的指示，然後結果會完全改變，因為這對LLM的推理影響很大。


Upvote
1

Downvote

Reply

Award

Share

u/RobinDough avatar
RobinDough
•
10d ago
有規則的層次，在派對裡，那就是魔法，


Upvote
1

Downvote

Reply

Award

Share

PermissionFit6843
•
6d ago
大型語言模型就像馬一樣。要讓騎乘順暢，你需要優秀的騎術——以及像 OpenCode 或 Pi 這樣的工具，正是如此。


Upvote
1

Downvote

Reply

Award

Share

kamikamen
•
3d ago
一個工具帶就像是給一個人提供一堆工具和說明。告訴一位天才他們不被允許做某些事情，或者給他們一堆與他們工作無關的工具，他們可能會產出一些不理想的結果。

給一個普通人最基本的工具，讓他們能夠加添更多的工具（如果他們希望），並且不要給出任何可能與你要求他們做的工作相矛盾的指示，他們可能表現得相當不錯。

幾乎所有的LLM都能透過類比來理解這一點，這真的很不可思議。


Upvote
1

Downvote

Reply

Award

Share

u/Subject_Mix_8339 avatar
Subject_Mix_8339
•
1mo ago
我最初在LM Studio、OpenCode、普通的llama cpp聊天等地方嘗試一個模型時也感到懷疑。但在pi中它的感覺真的不一樣。有一種工具/代理回圈加上最小系統提示和自定義搜索擴展的組合，使用起來真的更好。

我主要玩的是Qwen 3.6 35b-a3b，和pi一起使用的感覺特別好。


Upvote
1

Downvote

Reply

Award

Share

siegevjorn
•
1mo ago
我想試試看。

你為什麼會從開放代碼轉變過來？

那你有考慮過「暗戀」嗎？

我想知道更多有關Pi背後的開發者及他們的動機。他們是商業型的，有人知道他們的商業模式嗎？（例如，收購HF）



Upvote
4

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
你可以在 https://pi.dev.上研究更多關於他們的資訊。


Upvote
2

Downvote

Reply

Award

Share

u/InfiniteSprinkles730 avatar
InfiniteSprinkles730
•
28d ago
我同意，我在OpenCode也有非常類似的經歷。


Upvote
2

Downvote

Reply

Award

Share

OrbMan99
•
27d ago
如果我還沒嘗試過，但有這個： https://github.com/Zetaphor/pi-vscode-extension


Upvote
2

Downvote

Reply

Award

Share

u/mathew84 avatar
mathew84
•
27d ago
這個鞍具有很大的不同。
看看 little-coder（這是 pi 加上一些調整）。

SLM 和較小的 LLMs 並不像我們想的那麼無能，它們只是無法處理重型鞍具。

帶有大型系統提示和許多技能/MCP 工具的鞍具需要更強大的模型來運行。

我們所需的只是考慮到小型模型限制的精簡鞍具，這會帶來不同的效果。


Upvote
2

Downvote

Reply

Award

Share

gogojojoe
•
10d ago
太棒了，謝謝分享！


Upvote
2

Downvote

Reply

Award

Share

misanthrophiccunt
•
1mo ago
•
Edited 1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
我們需要在 Reddit 文章開頭正常化這樣的寫法

> 警告：這是一篇長文... 完全是人類寫的。這篇文章沒有使用 AI 亂寫。

說真的。光是這一點就值得讚。

編輯：根據開放代碼，我發現 Big Pickle 在自我鬥爭上浪費了太多時間。你可以用四行話來簡單概括一萬字的思考塊。這真的是太令人疲倦了。更別提煩人了。我什麼時候會使用它呢？當我的本地 Qwen3.6 27B 模型在另一個 tmux "視窗" 或 Zed Editor 線程（我透過 CLI 和 Zed 都在用）忙於其他項目時。不幸的是，我的 VRAM 不夠，無法在本地 Qwen 上運行平行提示，否則每秒的代幣會變得非常非常慢。

直到這位 可愛的紳士 讓我意識到我可以便宜地成為額外 RTX 3090 的快樂擁有者……但我仍在等待交貨。

我同意 Pi 在某種程度上不浪費我的代幣。我覺得 Pi 開發者在這一點上付出了意識上的努力：讓它不浪費時間。



Upvote
3

Downvote

Reply

Award

Share

OrbMan99
•
27d ago
我很喜歡你在那個留言串中的評論 :)



Upvote
4

Downvote

Reply

Award

Share

misanthrophiccunt
•
27d ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
💃


Upvote
1

Downvote

Reply

Award

Share

darkeagle03
•
1mo ago
你試過Claude Code的工具嗎？在你的經驗中，Pi跟它比起來怎麼樣？我喜歡Claude可以與VS Code連接，但我想知道Pi是否更快或在獲得類似或更好結果的同時使用更少的tokens。



Upvote
1

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
我在工作中使用Claude Code，家裡的專案則使用Pi和本地模型。Claude Code就像一隻800磅的大猩猩，我超喜歡它，特別是因為我在工作中幾乎可以無限使用token。但是對於我的家用編碼專案，我認為Pi的理念更加節約，並且幫助我最大限度地利用本地模型，這樣我就可以避免向大企業按token付費。



Upvote
3

Downvote

Reply

Award

Share

darkeagle03
•
1mo ago
現在在家，我正在使用連接到本地運行的 QWEN 模型的 Claude Code。在你看來，使用本地模型時，Pi 的體驗是否更好？



Upvote
1

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
在我看來，Pi 在更有效地使用本地模型方面百分之百更好。Claude Code 有一個龐大的系統提示，還有經過優化的 Claude frontier 雲模型。而 Pi 的系統提示則簡潔得多，開銷也少得多。

如果你習慣於所有與 Claude Code 連接的工具和其他命令，那麼轉到只有五個簡單工具的 Pi 將會是一個很大的過渡。這種理念與大多數其他的智能工具非常不同。使用 Pi，界面非常簡單，如果你需要一個工具來支持你的工作流程，你只需要求 Pi 按照你的規格建造它，然後發出 /reload 命令以訪問新工具。

現在你設置中的另一個大問題是你正在使用 Ollama 作為模型後端。朋友不會讓朋友使用 Ollama。閱讀這篇文章，然後為你的系統研究一個更好的模型後端：

https://sleepingrobots.com/dreams/stop-using-ollama/



Upvote
4

Downvote

Reply

Award

Share

darkeagle03
•
1mo ago
我還不太習慣Claude Code的指令，但我正在適應它編排事務的方式，讓我能夠相對輕鬆地進行操作。不幸的是，我在興趣項目上的工作能力基本上是每天大約4次，每次5分鐘或更少，因此這對我來說很重要。

我使用ollama的原因基本上與上述相同。當我幾週前決定使用Claude Code為本地LLM進行POC（給自己）時，它的設置非常快速、簡單，並且大多數情況下可以輕鬆完成。我會尋找更好的選擇，希望也能更快速，但我仍然希望設置和管理相對簡單，包括與CC的整合，現在也可能與Pi整合，因為我真的沒有其他的時間。有什麼建議嗎？



Upvote
1

Downvote

Reply

Award

Share

Konamicoder
OP
•
1mo ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
如果你沒有時間去投資更好的模型後端，又喜歡Claude Code，並且它對你有用，那我的建議就是堅持使用你現在擁有的東西。找出最適合你情況的設置需要時間、研究和實驗。如果你不願意或無法在這些方面投資，那麼就繼續使用現在對你有用的東西。此外，我不知道你的硬體情況，所以在沒有這些信息的情況下，我無法給你任何有用的建議。



Upvote
1

Downvote

Reply

Award

Share

darkeagle03
•
1mo ago
說得好。這個硬體是一台舊筆記型電腦，配有3080 16GB和32GB的系統RAM。

我願意設置其他的東西，但2小時的手動研究加上設置時間大約相當於我實際完成這件事的1個月，不幸的是。幾乎每天的每分鐘都已經被安排好了，而不包括我用來做興趣的時間。AI是我能夠再次考慮進行任何個人軟體專案的唯一原因。CC + ollama 的路徑可以使用，但速度相當慢，所以我想找一些能加快這個過程的東西。



Upvote
1

Downvote

Reply

Award

Share

Konamicoder
OP
•
28d ago
•
Edited 28d ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
謝謝分享你的硬體規格。這裡有一些建議，可以讓你的設備運行得更快：

vLLM 是比 Ollama 更好、更快的後端。vLLM 通過一個標準的 OpenAI兼容端點提供模型，因此你可以對任何工具進行配置。對於工具來說，Pi 比 Claude Code 輕得多且臃腫得少。祝你好運！



Upvote
1

Downvote

Reply

Award

Share

darkeagle03
•
24d ago
•
Edited 24d ago
據我所知，我已經讓vllm運行起來了。在我的Windows機器上，這是一個小挑戰，因為不使用docker會造成功能上的過度膨脹。雖然它與Claude Code配合不佳，因為CC的提示對我的16GB設備來說超出了最大token大小，而該設備在運行支持 openai 工具呼叫的模型時無法應對。我想知道你是否有什麼秘訣？我嘗試了cpu卸載，但如果超過4GB，它出於某種原因拒絕提供模型，儘管我有更多的可用資源。

我會試試Pi，看看情況如何。

編輯：所以我確實使用LiteLLM和很多調整使其與CC運行起來了，但效果仍然不佳。對Claude來說，上下文實在太小了，而且它似乎不想真正執行文件等，這對於「讓它自己運行」來說是個問題。Ollama實際上在這方面運行良好，並沒有像我的vllm設置那樣碰到上下文窗口，但速度很慢。


Upvote
2

Downvote

Reply

Award

Share

darkeagle03
•
28d ago
謝謝你的推薦。我真的很感激！

這些是我應該自己去弄清楚的事情。這並不難，付出的努力會轉化為增加的知識，不過我的時間表被工作、孩子、孩子的活動、妻子、家務、擴大家庭等等填得滿滿的，這讓我感到非常掙扎。能夠在我的小專案想法上再次看到一些進展，對我來說已經是多年以來的第一次，真的很棒。



Upvote
1

Downvote

Reply

Award

Share

Konamicoder
OP
•
28d ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
嘿，兄弟，我明白。 我自己也有四個孩子。 幸運的是（或不幸的是，視你的觀點而定），他們現在大多已經長大並搬出家裡了，這意味著我有更多的時間來投入當地的 LLM 探索。 不過幾年前，我也是在那個看似無窮無盡又令人疲憊的工作-孩子-活動等等的列車上。 希望這些建議能幫助你更有效地利用有限的空閒時間！😄


Upvote
1

Downvote

Reply

Award

Share

5 more replies
wrightpt
•
21d ago
哪家公司讓你使用Claude代碼。真是一家好公司。


Upvote
1

Downvote

Reply

Award

Share

u/RoderickHossack avatar
RoderickHossack
•
16d ago
你能描述一下你的設置嗎？我試著在使用 Docker 的 SBX 沙盒系統的容器中使用類似 Pi 的東西，但因為它不受支持，所以我遇到了一些麻煩。

我真的很想知道這個代理開發的東西是什麼樣子，但我又不想要一個可能隨意決定刪除我電腦上任何東西的代理。



Upvote
1

Downvote

Reply

Award

Share

Konamicoder
OP
•
16d ago
•
Edited 16d ago
Profile Badge for the Achievement Top 1% Commenter Top 1% Commenter
首先，大多數代理式工具在對您的系統進行任何更改之前，會明確要求您的許可。特別是 Pi 採取「默認 YOLO 模式」的哲學，這意味著它假設用戶發出的任何命令都是自動批准的。但即便如此，如果您給 Pi 一個會摧毀數據的命令，它仍會再三確認您是否真的想這樣做。因此，代理式工具隨意刪除您電腦上所有內容的情況非常不可能，也沒有發生過在我身上。

請注意，我在談論與 Pi 同類的代理式工具，如 Claude Code、Codex CLI、OpenCode、Qwen Code、nanocoder 等。您輸入命令，它們遵循您的命令，除非您告訴它們，否則不會自主行動。

我不是在說像 OpenClaw 這樣的自主代理協調者。我對這些沒有經驗，也沒有嘗試的意圖。但如果有任何可能會在您未明確告訴它們這樣做的情況下，對您的電腦和數據造成傷害的話，那就是這些，我的看法。

說了這麼多，我不在 Docker 中運行 Pi，因為您遇到的複雜性。我直接在我的系統上運行 Pi。我將我的各個編程項目各放在自己的項目文件夾中。然後我告訴 Pi 專注於哪個文件夾，並限制它在這個會話中僅在特定的項目文件夾內工作。因此，在一個會話中我發出的任何命令都僅限於指定的項目文件夾。我會馬上到那裡。

希望這能幫到你！


Upvote
1

Downvote

Reply

Award

Share




Pi: The Minimal Agent Within OpenClaw
written on January 31, 2026

If you haven’t been living under a rock, you will have noticed this week that a project of my friend Peter went viral on the internet. It went by many names. The most recent one is OpenClaw but in the news you might have encountered it as ClawdBot or MoltBot depending on when you read about it. It is an agent connected to a communication channel of your choice that just runs code.

What you might be less familiar with is that what’s under the hood of OpenClaw is a little coding agent called Pi. And Pi happens to be, at this point, the coding agent that I use almost exclusively. Over the last few weeks I became more and more of a shill for the little agent. After I gave a talk on this recently, I realized that I did not actually write about Pi on this blog yet, so I feel like I might want to give some context on why I’m obsessed with it, and how it relates to OpenClaw.

Pi is written by Mario Zechner and unlike Peter, who aims for “sci-fi with a touch of madness,” 1 Mario is very grounded. Despite the differences in approach, both OpenClaw and Pi follow the same idea: LLMs are really good at writing and running code, so embrace this. In some ways I think that’s not an accident because Peter got me and Mario hooked on this idea, and agents last year.

What is Pi?
So Pi is a coding agent. And there are many coding agents. Really, I think you can pick effectively anyone off the shelf at this point and you will be able to experience what it’s like to do agentic programming. In reviews on this blog I’ve positively talked about AMP and one of the reasons I resonated so much with AMP is that it really felt like it was a product built by people who got both addicted to agentic programming but also had tried a few different things to see which ones work and not just to build a fancy UI around it.

Pi is interesting to me because of two main reasons:

First of all, it has a tiny core. It has the shortest system prompt of any agent that I’m aware of and it only has four tools: Read, Write, Edit, Bash.
The second thing is that it makes up for its tiny core by providing an extension system that also allows extensions to persist state into sessions, which is incredibly powerful.
And a little bonus: Pi itself is written like excellent software. It doesn’t flicker, it doesn’t consume a lot of memory, it doesn’t randomly break, it is very reliable and it is written by someone who takes great care of what goes into the software.

Pi also is a collection of little components that you can build your own agent on top. That’s how OpenClaw is built, and that’s also how I built my own little Telegram bot and how Mario built his mom. If you want to build your own agent, connected to something, Pi when pointed to itself and mom, will conjure one up for you.

What’s Not In Pi
And in order to understand what’s in Pi, it’s even more important to understand what’s not in Pi, why it’s not in Pi and more importantly: why it won’t be in Pi. The most obvious omission is support for MCP. There is no MCP support in it. While you could build an extension for it, you can also do what OpenClaw does to support MCP which is to use mcporter. mcporter exposes MCP calls via a CLI interface or TypeScript bindings and maybe your agent can do something with it. Or not, I don’t know :)

And this is not a lazy omission. This is from the philosophy of how Pi works. Pi’s entire idea is that if you want the agent to do something that it doesn’t do yet, you don’t go and download an extension or a skill or something like this. You ask the agent to extend itself. It celebrates the idea of code writing and running code.

That’s not to say that you cannot download extensions. It is very much supported. But instead of necessarily encouraging you to download someone else’s extension, you can also point your agent to an already existing extension, say like, build it like the thing you see over there, but make these changes to it that you like.

Agents Built for Agents Building Agents
When you look at what Pi and by extension OpenClaw are doing, there is an example of software that is malleable like clay. And this sets certain requirements for the underlying architecture of it that are actually in many ways setting certain constraints on the system that really need to go into the core design.

So for instance, Pi’s underlying AI SDK is written so that a session can really contain many different messages from many different model providers. It recognizes that the portability of sessions is somewhat limited between model providers and so it doesn’t lean in too much into any model-provider-specific feature set that cannot be transferred to another.

The second is that in addition to the model messages it maintains custom messages in the session files which can be used by extensions to store state or by the system itself to maintain information that either not at all is sent to the AI or only parts of it.

Because this system exists and extension state can also be persisted to disk, it has built-in hot reloading so that the agent can write code, reload, test it and go in a loop until your extension actually is functional. It also ships with documentation and examples that the agent itself can use to extend itself. Even better: sessions in Pi are trees. You can branch and navigate within a session which opens up all kinds of interesting opportunities such as enabling workflows for making a side-quest to fix a broken agent tool without wasting context in the main session. After the tool is fixed, I can rewind the session back to earlier and Pi summarizes what has happened on the other branch.

This all matters because for instance if you consider how MCP works, on most model providers, tools for MCP, like any tool for the LLM, need to be loaded into the system context or the tool section thereof on session start. That makes it very hard to impossible to fully reload what tools can do without trashing the complete cache or confusing the AI about how prior invocations work differently.

Tools Outside The Context
An extension in Pi can register a tool to be available to the LLM to call and every once in a while I find this useful. For instance, despite my criticism of how Beads is implemented, I do think that giving an agent access to a to-do list is a very useful thing. And I do use an agent-specific issue tracker that works locally that I had my agent build itself. And because I wanted the agent to also manage to-dos, in this particular case I decided to give it a tool rather than a CLI. It felt appropriate for the scope of the problem and it is currently the only additional tool that I’m loading into my context.

But for the most part all of what I’m adding to my agent are either skills or TUI extensions to make working with the agent more enjoyable for me. Beyond slash commands, Pi extensions can render custom TUI components directly in the terminal: spinners, progress bars, interactive file pickers, data tables, preview panes. The TUI is flexible enough that Mario proved you can run Doom in it. Not practical, but if you can run Doom, you can certainly build a useful dashboard or debugging interface.

I want to highlight some of my extensions to give you an idea of what’s possible. While you can use them unmodified, the whole idea really is that you point your agent to one and remix it to your heart’s content.

/answer
I don’t use plan mode. I encourage the agent to ask questions and there’s a productive back and forth. But I don’t like structured question dialogs that happen if you give the agent a question tool. I prefer the agent’s natural prose with explanations and diagrams interspersed.

The problem: answering questions inline gets messy. So /answer reads the agent’s last response, extracts all the questions, and reformats them into a nice input box.

The /answer extension showing a question dialog
/todos
Even though I criticize Beads for its implementation, giving an agent a to-do list is genuinely useful. The /todos command brings up all items stored in .pi/todos as markdown files. Both the agent and I can manipulate them, and sessions can claim tasks to mark them as in progress.


/review
As more code is written by agents, it makes little sense to throw unfinished work at humans before an agent has reviewed it first. Because Pi sessions are trees, I can branch into a fresh review context, get findings, then bring fixes back to the main session.

The /review extension showing review preset options
The UI is modeled after Codex which provides easy to review commits, diffs, uncommitted changes, or remote PRs. The prompt pays attention to things I care about so I get the call-outs I want (eg: I ask it to call out newly added dependencies.)

/control
An extension I experiment with but don’t actively use. It lets one Pi agent send prompts to another. It is a simple multi-agent system without complex orchestration which is useful for experimentation.

/files
Lists all files changed or referenced in the session. You can reveal them in Finder, diff in VS Code, quick-look them, or reference them in your prompt. shift+ctrl+r quick-looks the most recently mentioned file which is handy when the agent produces a PDF.

Others have built extensions too: Nico’s subagent extension and interactive-shell which lets Pi autonomously run interactive CLIs in an observable TUI overlay.

Software Building Software
These are all just ideas of what you can do with your agent. The point of it mostly is that none of this was written by me, it was created by the agent to my specifications. I told Pi to make an extension and it did. There is no MCP, there are no community skills, nothing. Don’t get me wrong, I use tons of skills. But they are hand-crafted by my clanker and not downloaded from anywhere. For instance I fully replaced all my CLIs or MCPs for browser automation with a skill that just uses CDP. Not because the alternatives don’t work, or are bad, but because this is just easy and natural. The agent maintains its own functionality.

My agent has quite a few skills and crucially I throw skills away if I don’t need them. I for instance gave it a skill to read Pi sessions that other engineers shared, which helps with code review. Or I have a skill to help the agent craft the commit messages and commit behavior I want, and how to update changelogs. These were originally slash commands, but I’m currently migrating them to skills to see if this works equally well. I also have a skill that hopefully helps Pi use uv rather than pip, but I also added a custom extension to intercept calls to pip and python to redirect them to uv instead.

Part of the fascination that working with a minimal agent like Pi gave me is that it makes you live that idea of using software that builds more software. That taken to the extreme is when you remove the UI and output and connect it to your chat. That’s what OpenClaw does and given its tremendous growth, I really feel more and more that this is going to become our future in one way or another.

https://x.com/steipete/status/2017313990548865292↩

This entry was tagged ai

copy as / view markdown

© Copyright 2026 by Armin Ronacher.

Content licensed under the Creative Commons Attribution-NonCommercial 4.0 International License.

Contact me via mail, bluesky, x, or github.

You can sponsor me on github.

More info: imprint & AI transparency. Subscribe via atom / RSS.

Color scheme: auto, light, dark.