# dsh-shell-switch

Switch [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) between the **PowerShell** and **Bash** shell stacks on Windows — with one environment variable.

English | [中文](#中文)

## Why

DeepSeek Harness's base bundle `@deepseek-ai/dsh-base` gates the two shell stacks purely by platform:

```yaml
- id: bash-sandbox
  name: '@deepseek-ai/dsh-bash-sandbox'
  disabled: !!js process.platform === 'win32'      # bash unusable on Windows

- id: pwsh-sandbox
  name: '@deepseek-ai/dsh-pwsh-sandbox'
  disabled: !!js process.platform !== 'win32'      # PowerShell only on Windows
```

So on Windows the agent always gets `pwsh`, and there is no configuration knob to change it. dsh's own docs state the constraint:

> A Windows host that prefers the unconfined PowerShell executor can switch the shell rows in its profile patch … the switch must disable both PowerShell rows and re-enable both bash rows, otherwise the profile fails to load.

This bundle replaces all four rows with an env-driven expression, so the stack is a launch-time choice instead of a platform constant.

## Install

```bash
git clone https://github.com/Twofruitsgrape/dsh-shell-switch
```

Then in DeepSeek Harness, ask the agent:

> Install the bundle at `<absolute path to this directory>` with `plugin_manager` action `install_bundle`.

The plugin manager runs package installation and bundle selection itself — do not reproduce those steps with shell commands. Restart DeepSeek Harness afterwards.

## Usage

The bundle needs to know **where Git Bash lives on your machine**. Point it at
the Git-Bash `bin` directory (or directly at `bash.exe`):

```powershell
# Windows — tell the plugin where Git Bash is, then launch
$env:DSH_BASH_DIR = "C:\Program Files\Git\bin"
& "C:\Users\ALICE\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
```

On load the plugin verifies the directory actually contains `bash.exe`. If it
does, the bash stack is mounted and that directory is prepended to `PATH` so the
executor's `bash` lookup finds Git Bash instead of the WSL stub. If the directory
is missing or invalid, the plugin safely falls back to PowerShell and logs a
warning — it never leaves you with a broken shell.

| Variable | Meaning |
|---|---|
| `DSH_BASH_DIR` (set) | Use the bash at this directory/exe; validate it first |
| `DSH_SHELL=bash` | Force bash (falls back to PowerShell if none is valid) |
| `DSH_SHELL=powershell` / `pwsh` | Force PowerShell — switch back any time |
| neither set | `auto`: bash if one is valid/found on `PATH`, else PowerShell |

Both rows of a stack read the same resolved value, so a partial switch (which
makes the profile fail to load) is structurally impossible.

### Persisting the choice

```powershell
[Environment]::SetEnvironmentVariable('DSH_BASH_DIR', 'C:\Program Files\Git\bin', 'User')
```

### Why a directory instead of auto-detection

Earlier versions guessed Git's location by probing `C:\Program Files` and
rewriting `PATH`. That is fragile: it can shadow a WSL bash you actually wanted,
or silently do nothing when Git is installed elsewhere. Handing the plugin an
explicit directory is deterministic and obvious — you always know which bash is
in use.

## How it works

`cordis.patch.yml` hands the four shell rows an expressions that reads a single
resolved variable, `DSH_SHELL_EFFECTIVE`. The bundle's JavaScript module
(`index.js`) is evaluated **before** the patch is interpolated: it validates
`DSH_BASH_DIR` (or a `DSH_SHELL` force), resolves the directory of a usable
`bash`, prepends it to `PATH` when needed, and publishes the final choice as
`DSH_SHELL_EFFECTIVE`. Keeping the filesystem access in a real module (rather
than a one-line `!!js` expression) is why the plugin can verify the directory
instead of blindly trusting it.

| Row | Package | Role |
|---|---|---|
| `bash-sandbox` | `@deepseek-ai/dsh-bash-sandbox` | Bash executor (sandboxed) |
| `tool-bash` | `@deepseek-ai/dsh-tool-bash` | Model-facing `bash` tool |
| `pwsh-sandbox` | `@deepseek-ai/dsh-pwsh-sandbox` | PowerShell executor |
| `tool-pwsh` | `@deepseek-ai/dsh-tool-pwsh` | Model-facing `pwsh` tool |

Exactly one stack is active at any time. Both rows of a stack read the same
variable, so a partial switch (which makes the profile fail to load) is
structurally impossible.

## Caveats

- **You point the plugin at Git Bash; it does not install one.** Install Git for
  Windows first, then set `DSH_BASH_DIR` to its `bin` directory.
- **Beware `WindowsApps\bash.exe` / `system32\bash.exe`.** These are WSL stubs,
  not Git Bash (`uname -s` reports `Linux`). When the plugin injects your
  `DSH_BASH_DIR` it is prepended *ahead* of those, so the executor prefers Git
  Bash. If you leave `DSH_BASH_DIR` unset and rely on PATH auto-detection, a WSL
  stub may win — that still runs bash, just not the MSYS2 one.
- **Permissions are untouched.** This bundle changes only which shell stack is mounted.

## Tests

```bash
npm install
npm test
```

60+ assertions across three suites: patch structure, per-stack row coherence,
the exactly-one-stack-active invariant over 8 env scenarios, composition against
the real shipped base-bundle rows, and the bash-resolution module (unit-tested
against fixtures that isolate the host from its own PATH).

## License

MIT

---

## 中文

### 为什么需要

DeepSeek Harness 的基础 bundle `@deepseek-ai/dsh-base` 按平台硬门控 shell 栈：Windows 上 `bash-sandbox` / `tool-bash` 被 `disabled`，只有 PowerShell 可用，且没有任何配置项能改。

官方说明：

> A Windows host that prefers the unconfined PowerShell executor can switch the shell rows in its profile patch … the switch must disable both PowerShell rows and re-enable both bash rows, otherwise the profile fails to load.

本 bundle 把这四行换成由环境变量驱动的表达式，让 shell 栈变成启动时的选择，而不是平台常量。

### 安装

```bash
git clone https://github.com/Twofruitsgrape/dsh-shell-switch
```

然后在 DeepSeek Harness 里让 agent 执行：用 `plugin_manager` 的 `install_bundle` 安装该绝对路径目录。重启生效。

### 用法

插件需要知道 **Git Bash 在你机器上的位置**。把它指向 Git Bash 的 `bin` 目录（或直接指向 `bash.exe`）：

```powershell
# 告诉插件 Git Bash 在哪, 然后启动
$env:DSH_BASH_DIR = "C:\Program Files\Git\bin"
& "C:\Users\ALICE\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
```

加载时插件会**校验**该目录是否真有 `bash.exe`。有效 → 挂载 bash 栈并把该目录前置到 `PATH`（让执行器优先用 Git Bash 而非 WSL 占位）；无效/缺失 → 安全退回 PowerShell 并打印警告，**绝不会让你卡在坏掉的 shell**。

| 变量 | 含义 |
|---|---|
| 设 `DSH_BASH_DIR` | 用此目录/exe 下的 bash，先校验 |
| `DSH_SHELL=bash` | 强制 bash（无有效 bash 时退回 PowerShell） |
| `DSH_SHELL=powershell` / `pwsh` | 强制 PowerShell —— 随时切回 |
| 都不设 | `auto`：有有效 bash 或用 PATH 检测到则 bash，否则 PowerShell |

同一栈的两行共用同一解析值，所以「部分切换导致 profile 加载失败」在结构上不可能。

### 持久化

```powershell
[Environment]::SetEnvironmentVariable('DSH_BASH_DIR', 'C:\Program Files\Git\bin', 'User')
```

### 为什么用「填目录」而不是自动探测

早期版本靠猜 Git 位置 + 重写 PATH，很脆：可能把你想要的 WSL bash 盖掉，或在 Git 装在别处时静默失效。显式给目录是确定且透明的——你始终知道用的是哪个 bash。

### 注意事项

- **Windows 上用 bash 需要 `PATH` 里有 bash 可执行文件。** Git for Windows 提供 `C:\Program Files\Git\bin\bash.exe`；注意常见的 `Git\cmd` 目录里只有 `git.exe`，**没有** `bash.exe`。
- **小心 `WindowsApps\bash.exe`**，那是 WSL 占位程序而非 Git Bash。若它在 `PATH` 中排在 `Git\bin` 之前，命令会跑在 WSL 下。把 `C:\Program Files\Git\bin` 前置可得到 Git Bash（`uname -s` 为 `MINGW64_NT-*`），WSL 则返回 `Linux`。
- **不影响权限模型**，本 bundle 只切换 shell 栈。

### 测试

```bash
npm install && npm test
```

29 项断言：patch 结构、每个栈的行一致性、8 种环境变量场景下「恰好一个栈激活」的不变量、以及 `package.json` 的 bundle 契约。
