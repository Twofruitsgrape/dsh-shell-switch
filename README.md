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

Set one variable **before launching** DeepSeek Harness:

```powershell
# Windows — Bash (the default when unset)
$env:DSH_SHELL = "bash"
& "C:\Users\ALICE\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
```

```powershell
# Windows — PowerShell
$env:DSH_SHELL = "powershell"
& "C:\Users\ALICE\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
```

| `DSH_SHELL` | Active stack |
|---|---|
| unset | bash |
| `bash` | bash |
| `powershell` / `pwsh` | PowerShell |

Values are case-insensitive.

### Persisting the choice

```powershell
[Environment]::SetEnvironmentVariable('DSH_SHELL', 'bash', 'User')
```

## What it changes

| Row | Package | Role |
|---|---|---|
| `bash-sandbox` | `@deepseek-ai/dsh-bash-sandbox` | Bash executor (sandboxed) |
| `tool-bash` | `@deepseek-ai/dsh-tool-bash` | Model-facing `bash` tool |
| `pwsh-sandbox` | `@deepseek-ai/dsh-pwsh-sandbox` | PowerShell executor |
| `tool-pwsh` | `@deepseek-ai/dsh-tool-pwsh` | Model-facing `pwsh` tool |

Exactly one stack is active at any time. Both rows of a stack share the same expression, so a partial switch (which would fail the profile load) is structurally impossible.

## Caveats

- **A Bash stack on Windows still needs a Bash binary on `PATH`.** The executor resolves `bash` from `PATH`. Git for Windows provides `C:\Program Files\Git\bin\bash.exe` — note that `Git\cmd` (often on `PATH`) contains only `git.exe`, *not* `bash.exe`.
- **Beware `WindowsApps\bash.exe`.** It is a WSL stub, not Git Bash. If it precedes `Git\bin` on `PATH`, commands run under WSL rather than MSYS2. Put `C:\Program Files\Git\bin` first to get Git Bash (`uname -s` → `MINGW64_NT-*`); WSL reports `Linux`.
- **Permissions are untouched.** This bundle changes only which shell stack is mounted.

## Tests

```bash
npm install
npm test
```

29 assertions covering: patch structure, per-stack row coherence, the exactly-one-stack-active invariant across 8 env scenarios, and the bundle contract in `package.json`.

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

启动 DeepSeek Harness **之前**设置：

```powershell
$env:DSH_SHELL = "bash"        # 默认（未设置时也是 bash）
$env:DSH_SHELL = "powershell"  # 切回 PowerShell
```

大小写不敏感，`pwsh` 亦可。

### 注意事项

- **Windows 上用 bash 需要 `PATH` 里有 bash 可执行文件。** Git for Windows 提供 `C:\Program Files\Git\bin\bash.exe`；注意常见的 `Git\cmd` 目录里只有 `git.exe`，**没有** `bash.exe`。
- **小心 `WindowsApps\bash.exe`**，那是 WSL 占位程序而非 Git Bash。若它在 `PATH` 中排在 `Git\bin` 之前，命令会跑在 WSL 下。把 `C:\Program Files\Git\bin` 前置可得到 Git Bash（`uname -s` 为 `MINGW64_NT-*`），WSL 则返回 `Linux`。
- **不影响权限模型**，本 bundle 只切换 shell 栈。

### 测试

```bash
npm install && npm test
```

29 项断言：patch 结构、每个栈的行一致性、8 种环境变量场景下「恰好一个栈激活」的不变量、以及 `package.json` 的 bundle 契约。
