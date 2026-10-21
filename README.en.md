# Miliastra Sandbox Simulator

[简体中文](README.md) | English | [Quick Guide](https://ppt.070077.xyz/beyond-ai/index.html)

A standalone simulator for **2D + Lua game development in Miliastra Wonderland**. Edit UI, run scripts, and playtest in your browser, or let AI interact with the game, capture screenshots, and run tests. Export assets for verification in the game.

Available as a **Web editor, an MCP server, and a DeepSeek Harness plugin**, with support for AI tools such as OpenCode, WorkBuddy, and Codex.

## Features

| Capability | Description |
|---|---|
| **Visual UI editing** | Create 11 client control types and adjust hierarchy, location, size, anchors, and properties. |
| **Lua execution** | Manage multiple scripts, attach them to client controls or Client Control Templates, and debug input and animations. |
| **Standalone playtests** | Use mouse, touch, or keyboard input; pause, step through execution, and inspect logs. |
| **Device and multiplayer simulation** | Choose from five PC/mobile canvases and simulate 1–8 local players with perspective switching. |
| **AI automated tests** | Edit projects, send input, capture screenshots, and record and replay test cases. |
| **Seven-step workflow** | Progress through design, TDD, an HTML demo, art, Lua implementation, testing, and in-game validation. |
| **Saves and asset exchange** | Save complete JSON projects and import/export UI, Lua, and supported GIA content. |

See the [client control support matrix](studio/docs/control-support.md) for details.

## Integrations

| Integration | Use case |
|---|---|
| **[Web editor](#web-deployment)** | Edit and playtest in your browser, or view projects modified by AI. |
| **[MCP server](#mcp-integration)** | Let OpenCode, WorkBuddy, Codex, and other AI tools edit and test directly. |
| **[DeepSeek Harness plugin](#deepseek-harness-plugin)** | Use the editor, simulator tools, and game creation agent inside Harness. |

### Web deployment

Requires **Node.js 22+**:

```sh
npm install -g beyond-simulator-web
mkdir ../my-game
beyond-simulator-web --workspace ../my-game --open
```

`my-game` stores your game files. For an existing project, specify its directory instead, for example `--workspace E:/my-game`.

- [Editor](http://127.0.0.1:4173/editor): edit, save, and playtest.
- [Save preview](http://127.0.0.1:4173/): view saved projects, with automatic refresh when files change.

Docker deployment is also supported. For external access, configure an access password and HTTPS. The service is intended for a single trusted operator. See the [Web guide](web/README.md).

### MCP integration

Requires Node.js 22+ and an AI client with local MCP stdio support:

```sh
npm install -g beyond-simulator-mcp
```

Add a local stdio server in your client:

| Setting | Value |
|---|---|
| Server name (your choice) | `qxqy-simulator` |
| Command | `beyond-simulator-mcp` |
| Arguments | `--workspace`, followed by an existing game directory's absolute path, such as `E:/my-game` |

Configuration examples: [OpenCode](https://opencode.ai/docs/mcp-servers/), [WorkBuddy](https://open.workbuddy.cn/docs/connector), and [Codex](mcp/README.md#codex-接入). After connecting, tools such as `qxqy_project_open` and `qxqy_studio_play` should be available.

Use MCP independently or point it and Web to the same workspace. Once AI saves the project, view it in Web's save preview. See the [MCP guide](mcp/README.md) for full setup.

### DeepSeek Harness plugin

Requires Node.js 22+ and DeepSeek Harness:

```sh
dsh plugin --profile web add dsh-plugin-beyond-simulator
dsh web
```

Bind a game workspace to the session and open **Simulator**. For a new session, choose the **千星 2D+Lua 游戏制作** game creation agent preset.

To update, rerun the installation command and restart Harness; existing user agent presets are preserved. See the [Harness plugin guide](dsh-plugin/README.md) for GitHub/local package installation and version compatibility.

## Build a game in seven steps with an agent

Provide a game idea, reference image, or existing project. Choose the game creation agent in Harness, or ask another AI tool to read the [seven-step Skill](agent/wonderland-lua-builder/skills/qxqy-game-studio/SKILL.md) and work through MCP.

| Step | Output |
|---|---|
| **1. Game design** | Core gameplay, controls, scoring, and win/loss rules. |
| **2. TDD test cases** | Actions and expected results for starting, success, failure, restarting, and edge cases. |
| **3. HTML demo** | A playable demo to confirm visuals, controls, and pacing. |
| **4. Miliastra art assets** | Reference art, an asset list, and a UI recreation plan. |
| **5. Lua implementation** | Playable game scripts and a complete save. |
| **6. Testing** | AI playtests, bug fixes, and regression results. |
| **7. In-game validation** | Import, script attachment, and update instructions, plus fixes based on in-game feedback. |

Connect an accessible source of official 2D/Lua documentation first, such as `miliastra-toolbox` or local files. Packages do not include the official knowledge base. See the [agent and Skill guide](agent/wonderland-lua-builder/README.md).

## User guide

### 1. Prepare a project

A save contains **Server UI, Client Control Templates, and Lua scripts**. Start from scratch, open an existing project through **Workspace Saves**, or use **Import** to load JSON, GIA, and Lua files.

### 2. Edit and playtest

1. Add controls in **UI Editor** and switch between PC/mobile canvases to check layouts.
2. Create or import scripts in **Lua Scripts** and attach them to client controls or Client Control Templates. Template scripts run when the template is instantiated.
3. Configure variables and signals in **Server Logic** as needed.
4. Click **Playtest ↗**. Pause, step through execution, and check **Logs** to debug, or adjust the player count and switch perspectives. Hosts that block new windows use an embedded playtest; return with **Back to Editor**, **Close Playtest**, or Escape.

### 3. Let AI help you test

After connecting through MCP or Harness, describe the actions and expected results:

> Open my save on the mobile 16:9 canvas. Click start, then click the target and check that the score increases by 1. Take a screenshot and check the logs. Record these actions as a test case and replay it after changes.

### 4. Save and export

| Purpose | Action |
|---|---|
| Continue development or make a backup | Export **Complete Save JSON (all three asset types)** to retain UI, scripts, and attachments. |
| Save to the workspace | Click **Save Project** and enter a relative path, such as `my-game.save.json`. |
| Import into the official editor | Export the appropriate GIA and review export notices and the imported result. |
| Exchange UI or scripts separately | Export **Current UI Authoring JSON**, a script bundle, or an individual Lua script. |

Editing and playtesting do not automatically write a complete save to disk. Save before exiting, or ask AI to call the save tool when using MCP.

### 5. Import into the game and keep scripts up to date

After importing assets and scripts into Miliastra Sandbox, check the actual control/template indices and update Lua references.

For later changes, ask AI to update the bound script folder, or use **Lua Scripts → Sync Scripts to Game** to bind a folder, preview changes, and confirm copying. Then save the stage in Miliastra Sandbox and playtest again. New scripts still need mappings and attachments. Update files manually if the game folder is inaccessible.

See [in-game delivery and validation](agent/wonderland-lua-builder/skills/qxqy-game-studio/references/07-device-validation.md) and [script synchronization](studio/docs/script-sync.md).

## Current support limits

- **Passing in the simulator does not guarantee passing in the game.** Final verification in Miliastra Wonderland is required.
- **Multiplayer playtests use local simulation.** Server support covers variables and signals, without the full official node graph or network multiplayer.
- **Images** support basic primitives, static assets, Prefab icons, and **Basic/Stretch** modes. Animated effects and 3D models are outside the preview scope. See [image assets](studio/docs/image-assets.md).
- **Lua 2D audio** can play during playtests, with assets downloaded on demand. See [audio assets](studio/docs/audio-assets.md).
- **GIA supports a verified subset of content.** Review export notices and keep original files and complete JSON saves.

## Build from source

Requires Node.js 22+ and pnpm 10.15.0. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

See the [distribution guide](DISTRIBUTION.md) for packaging and publishing.

## License

[GNU GPL v3.0 (GPL-3.0-only)](LICENSE) · [Source repository](https://github.com/1475505/miliastra-beyond-simulator)

## Interface language and updates

Switch languages next to **Font Settings**. Auto mode follows the system language and defaults to English in non-Chinese environments. The footer provides **Check for Updates** and **Contact Author**. See the [interface guide](studio/docs/interface.md).

## Local custom fonts

Use **Font Settings** to choose a local TTF/OTF file, the system font, or automatic discovery in Genshin Impact installation folders on Windows. Restart the host and refresh the page after saving. Settings stay on the local machine. See the [font guide](studio/docs/local-fonts.md).
