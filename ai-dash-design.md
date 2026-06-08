# ai-dash design notes

## 職責分工

### ai-dash 負責（shell 內部）
- 黑名單攔截（vim/nano/reboot/rm -rf / 等）
  - 跳過 sudo/doas/time/nice/nohup/strace 前綴
  - 取 basename 比對（`/usr/bin/rm` → `rm`）
- fedit builtin（SEARCH/REPLACE 編輯）
- rm builtin（移動到 trash）
- 診斷系統（E1001 command not found + 建議）
- flag 提示（apt install 缺 -y 等）
- `**` glob 支持（遞歸匹配，expandmeta 入口攔截 → collect_dirs → 拼接 → expmeta）

### pi bash tool 負責（外部調用方）
- spawn ai-dash -c（替代系統 bash）
- 讀取 fd 3 語意 metadata（read/edit/list/search/fs/bash）
- 全部輸出截斷（OutputAccumulator，40K 字符 / 200 行）
- timeout
- abort signal
- 流式輸出推送

### Bash-Only 架構
模型只看到一個 `bash(command: string)` tool。ai-dash 透過 fd 3 吐出語意 metadata，TUI 根據 intent 決定渲染方式（高亮/diff/compact/原始輸出）。

### 原因
外部命令（grep, ls, python...）的輸出不經過 dash 的 output.c — execve() 後子進程直接繼承 fd 1，直通。builtin 輸出量小，不值得在 dash 裡做截斷。統一在 bash tool 層處理更簡單。

## 環境變量
- `NO_COLOR=1` — 已在 bash tool 裡設置
- `TERM=dumb` — 已在 bash tool 裡設置

## 構建
```bash
cd packages/ai-dash
./configure --quiet
make -j$(nproc)
cp src/dash bin/ai-dash
```

## 結構
```
packages/ai-dash/
├── bin/ai-dash
├── src/           # C 源碼
│   ├── bltin/     # fedit.c, rm.c
│   ├── exec.c     # 命令執行 + 診斷
│   ├── eval.c     # 命令評估（黑名單放這裡）
│   └── ...
├── index.js
├── package.json
└── configure.ac
```

## 已完成

### fd 3 語意 Metadata（meta.c + eval.c）
- `evaltree()` 在頂層判斷 compound（pipeline/chain）→ 直接吐 `{"intent":"bash","compound":true}`
- simple command 延後到 `evalcommand()` 用展開後 argv 判斷
- `classify_intent()` 用 basename 分類：cat/head/tail/sed → read, fedit → edit, ls/tree → list, grep/rg/find → search, cp/mv/mkdir → fs, 其他 → bash
- 路徑提取只對 cat/head/tail/fedit/ls/tree/find 輸出 path（保守策略）
- fd 3 optional：`fcntl(3, F_GETFD)` 檢查，不存在就跳過
- FD_CLOEXEC：外部命令 exec 後自動關閉 fd 3
- JSON 格式：`{"v":1,"event":"intent","intent":"read","cmd":"cat","path":"foo.c","compound":false}`

### 黑名單（eval.c: check_blacklist）
- `skip_wrappers()` 跳過 sudo/doas/time/nice/nohup/strace 及其 flags
- `xbasename()` 取路徑最後一段（`/usr/bin/rm` → `rm`）
- 永遠封鎖：vim, vi, nano, emacs, ne, micro, reboot, shutdown, halt, poweroff, mkfs, dd, wipefs
- 條件封鎖：rm -rf 系統路徑、chmod/chown 系統路徑
- 注意：只檢查 argv 內的 command，不檢查 heredoc 內嵌的指令

### ** glob（expand.c）
- `has_doublestar()` 偵測 pattern 中是否有連續 `**`
- `expandmeta()` 入口攔截，跳過原廠邏輯
- `collect_dirs()` 用 opendir 遞歸收集所有子目錄（ckmalloc 分配，ckfree 釋放）
- 對每個目錄拼接 `dir/suffix` 成標準 glob pattern
- 丟回原廠 `expmeta()` 處理匹配和排序
- 不改動 expmeta 內部邏輯

## 未解決：read-before-write

fedit 前應該先讀過文件，否則模型可能瞎改。但 `ai-dash -c` 每次是新 shell，沒有跨調用狀態。

### 方案
- **ai-dash + 文件**：bash tool 寫已讀路徑到 `/tmp/ai-dash-read-<session>`，ai-dash 讀該文件檢查
- **pi bash tool**：TypeScript 層解析 command，追蹤 readFiles Set
- **不管**：靠 system prompt 提醒模型先讀再改

### 問題
- ai-dash 方案：需要 bash tool 傳 session ID，要改兩邊
- bash tool 方案：要解析 shell 命令，跟 yuuuu-old 一樣複雜
- 不管：fedit 可能在沒讀過的文件上執行，fuzzy match 可能匹配錯

### 狀態
暫不做，先靠模型自覺。

## 黑名單設計哲學

黑名單是防笨不是防壞。AI agent 場景下模型是合作的，不會故意繞黑名單。擋的是「打錯字」或「不知道危險命令」的情況，不是對抗惡意攻擊。

## 已知繞過方式（不修）

黑名單只檢查 argv 內的 command name。以下情況可以繞過，但認為模型不會故意使用：

### 重定向覆蓋
`> /etc/passwd` — 不是命令，是 shell 重定向，黑名單不攔截。
可以清空任何可寫文件。

### Heredoc 內嵌指令
`/usr/bin/sudo /usr/bin/bash -c "reboot"` — 黑名單只看到 sudo/bash，不解析 -c 內的字串。

### 方括號 glob 繞過
`[r]m -rf /` — shell 展開後變成 `rm`，但黑名單比對的是未展開的 `[r]m`。

### 反斜線繞過
`\r\m -rf /` — shell 解析後變成 `rm`，但黑名單比對的是字面的 `\r\m`。

### 進程替換
`>(cat /etc/shadow)` — 不是命令，黑名單不攔截。

### 狀態
不修。黑名單是防笨不是防壞，模型不會故意繞。
