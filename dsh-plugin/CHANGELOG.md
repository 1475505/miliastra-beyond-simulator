# DSH 插件更新公告

## 2.0.11 · 2026-10-07

本次为 `dsh-plugin-beyond-simulator@2.0.11` 稳定性修复，解决主组件启动或重载时报 `webserver: duplicate prefix route "/qxqy-simulator/api"` 的问题。

### 修复内容

- 修复组件卸载时 HTTP 路由未注销的问题。同一组件重新激活或依赖服务重载后，可正常注册 API、试玩页、渲染脚本、图片和音频路由。
- 完善初始化失败回滚，清理本次已经注册的路由。
- 组件卸载时等待试玩 Worker 退出，并阻止迟到请求重新创建已卸载的会话。
- 增加生命周期回归验证，确保重启后网页与 AI 工具操作同一份工程。

该问题在只安装一份插件时也可触发，报错本身不代表重复安装。修复补齐了路由的生命周期清理。

### 安装与更新

可直接下载本 Release 附带的 `dsh-plugin-beyond-simulator-2.0.11.tgz`，通过实际使用的 Harness profile 安装。以下以 `web` profile 为例：

```sh
dsh plugin --profile web add ./dsh-plugin-beyond-simulator-2.0.11.tgz
```

npm 版本审核上线后，也可执行：

```sh
dsh plugin --profile web add dsh-plugin-beyond-simulator@2.0.11
```

更新后请从托盘完整退出 Harness，再重新启动，以清除旧进程残留的路由。保留原版 `cordis.patch.yml`，无需注释主组件的 insert。

### 验证

- 全量自动化测试：309 通过、7 项条件测试跳过、0 失败。
- DSH Tools 0.1 / 0.2 两套基线的独立安装包验证通过。
- 真实 Harness 0.2.0-rc.2 完整启动、带活跃 Worker 的组件重复重启，以及 HTTP/工具状态一致性验证通过。

反馈者 Desktop 环境的原始触发链及修复包回验仍待确认。npm 使用暂存审核流程，工作流成功不等于版本已公开；公开状态以 npm registry 为准。
