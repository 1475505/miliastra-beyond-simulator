import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'qxqy-simulator-preset'
const PRESET_ID = 'wonderland-lua-builder'
const PRESET_ROOT_NAME = '.agent-presets'

/**
 * 随插件分发的 agent 预设源目录。
 *
 * 打包形态：<pkg>/dsh-plugin/presets/wonderland-lua-builder（由根 agent/wonderland-lua-builder 构建复制）；
 * 源码形态：simulator/agent/wonderland-lua-builder（本模块位于 lib/preset.js 时向上两级）。
 * 与 skill.js 相同的双候选策略：先命中打包目录，再退回源码树。
 */
function resolvePresetSource() {
  const candidates = [
    new URL(`../presets/${PRESET_ID}`, import.meta.url),
    new URL(`../../agent/${PRESET_ID}`, import.meta.url),
  ]
  return candidates.find((url) => existsSync(url))
}

/** Harness home：DSH_HOME 未设置时回退 ~/.dsh（与 dsh-home-paths 一致）。 */
function resolveDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function log(ctx, level, message) {
  try {
    ctx.logger?.[level]?.(message)
  } catch {
    // logger 服务可能缺失或为函数形态；安装预设失败不得拖垮启动。
  }
}

/**
 * 把 agent 预设安装进 DSH 的用户预设根。
 *
 * CLI 把 agent-presets.config.roots 钉死为 shipped 根，profile bundle 无法新增
 * 预设 root；用户根（includeUserRoot 默认 true 追加）是唯一可扩展来源，因此这里
 * 在启动时把包内捆绑的预设物化到 $DSH_HOME/.agent-presets/<id>。roster 每次读取
 * 都重扫磁盘，复制完成后预设立即可见。
 *
 * 语义：目标已存在则跳过，绝不覆盖用户自建/改过的预设；删除目标目录后重启即重装。
 */
export function apply(ctx) {
  void (async () => {
    const source = resolvePresetSource()
    const home = resolveDshHome()
    const target = join(home, PRESET_ROOT_NAME, PRESET_ID)
    try {
      if (!source) throw new Error(`bundled agent preset "${PRESET_ID}" is missing from the package`)
      if (existsSync(target)) {
        log(ctx, 'info', `[qxqy-simulator-preset] agent preset "${PRESET_ID}" already installed at ${target}; skipping (delete it to reinstall)`)
        return
      }
      await mkdir(join(home, PRESET_ROOT_NAME), { recursive: true })
      await cp(source, target, { recursive: true })
      log(ctx, 'info', `[qxqy-simulator-preset] agent preset "${PRESET_ID}" installed → ${target}`)
    } catch (error) {
      // 安装失败只损失预设，主插件与技能正文不受牵连。
      log(ctx, 'error', `[qxqy-simulator-preset] failed to install preset "${PRESET_ID}": ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
}
