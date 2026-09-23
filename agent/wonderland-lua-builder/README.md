# 千星 2D+Lua 游戏制作（Agent 预设）

预设 id：`wonderland-lua-builder`。从 shipped `standard` 复制后定制，不修改部署自带预设。

## 设计

把一次会话变成工作室。前期用 HTML 对齐最终效果，**先不碰模拟器**；开发完成后再用模拟器试玩/截图做交付验证。交付物是可在模拟器与真机运行的游戏，不是网页。

| 风险 | 方法 | 完成证据 |
|---|---|---|
| 玩法是否值得做 | HTML 最终效果演示 → 用户打开试玩 | Gate C |
| 规则是否正确 | 契约 → Red–Green–Regress | qxqy-autotest（阶段 6 起） |
| 平台 / 交付 | 模拟器 play/screenshot → GIA → 真机 | Gate D / E |

原神/千星官方图元全部可用；模拟器对非 `100001–100006` 显示缺失框（看不见效果，不是禁用）。

## 工作流

```text
PREFLIGHT
   ↓
1 GDD ──→ 2 美术（无分歧并入 A）
   │
   └──→ 3 契约 ──→ 4 HTML 最终效果演示（不接触模拟器，Gate C）
                              ↓
                         5 测试设计 → 6 Lua + 模拟器 TDD（开始接触模拟器）
                              ↓
                         7 交付验证：play / 截图（Gate D）
                              ↓
                         8 品质 / GIA / 真机（Gate E）
```

细节：`skills/qxqy-game-studio/`。2D API 不随预设分发：构建 Agent 工作区时由用户自行放入知识库与 `AGENTS.md`。不要用 miliastra 3D 节点库回答 Lua 问题。

## 依赖

必须（交付验证阶段）：profile 已装 `dsh-plugin-beyond-simulator`；存档 `workspace/<slug>/<slug>.save.json` 且头部含 `qxqy-simulator-save`。写依赖编辑器 API 的 Lua 前，工作区应有用户自备的 2D 知识库。

可选：`image_generate` / `imagegen`、像素重建、帧动画。阶段 1–4 不要求模拟器。

## 本机安装（开发者）

DSH **没有** `dsh plugin add` 这类预设安装命令。用户预设的唯一落点是：

`${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`

本仓库维护路径：`agent/wonderland-lua-builder/`（整目录就是预设：`agent.cordis.yml` + `preset.yml` + `skills/`）。

从仓库根覆盖安装到当前用户 DSH：

```powershell
$dst = Join-Path ($env:DSH_HOME ? $env:DSH_HOME : "$env:USERPROFILE\.dsh") '.agent-presets\wonderland-lua-builder'
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Path 'agent\wonderland-lua-builder\*' -Destination $dst -Recurse -Force
```

POSIX：

```sh
dst="${DSH_HOME:-$HOME/.dsh}/.agent-presets/wonderland-lua-builder"
mkdir -p "$dst"
cp -R agent/wonderland-lua-builder/. "$dst/"
```

安装后：

1. 名单会立刻扫到该目录（roster 每次 `list()` 读盘）。**已打开的会话不会换预设**；新建会话，在选择器里选「千星 2D+Lua 游戏制作」。
2. 改 `agent.cordis.yml` 才会让下一会话吃到新 composition 代际；只改 `skills/` 时，新会话也能读到新 Skill 正文（skill 加载按文件），但已挂载的 composition 代际仍以 yml stamp 为准。
3. 不要编辑 shipped `agent-presets`（升级覆盖）。
4. 行为回归：`evals/agent-behavior.md`。

## 对外分发

DSH 0.1 预设层**没有** GitHub bundle / npm 安装通道（那是 profile **插件** 的 `dsh plugin --profile web add`）。预设只能作为**目录**交给对方。

推荐：

| 方式 | 给对方什么 | 对方做什么 |
|---|---|---|
| 复制目录 | `agent/wonderland-lua-builder/` 整夹 | 拷到 `~/.dsh/.agent-presets/wonderland-lua-builder/` |
| 克隆本仓库 | 仓库 URL | 同上，从 `agent/wonderland-lua-builder` 拷出 |
| GUI | 已安装的本机预设 | 设置 → Agent 预设 → 复制（`copy()` 只能从已发现的 id 复制，不能从任意 URL 拉） |

对方还需要自行：

- 安装 `dsh-plugin-beyond-simulator`（交付验证用）
- 在 **Agent 工作区**放入 2D 知识库与 `AGENTS.md`（本预设不捆绑语料）
- 新建会话选本预设；不要指望当前会话热切换

不要做成 `dsh plugin add github:…`：那会进 profile bundle，容易把引擎服务发到进程全局，且升级/平面规则与预设不同。

不要把本目录放进 shipped `config/agent-presets/` 再分发 DSH 安装包：升级覆盖，且污染 `cordis` 作者模式。
