import { existsSync, readFileSync } from 'node:fs'

export const name = 'qxqy-simulator-skill'
export const inject = ['skills']

export const SKILL_NAME = 'qxqy-simulator'
export const SKILL_DESCRIPTION = '指导如何通过千星沙箱 UI 模拟器插件完成 UI→JSON/GIA 转换与导入尝试、编辑器或试玩截图验证、AI 驱动的交互测试。当会话中可见 qxqy_studio_get / qxqy_studio_patch / qxqy_studio_play / qxqy_studio_ui_screenshot / qxqy_studio_play_screenshot / qxqy_studio_load 工具，或用户提到千星沙箱模拟器、"模拟器"标签、UI 转 JSON、GIA 导入导出、工作区存档、试玩、交互测试队列时使用。'

function loadSkillContent() {
  const candidates = [
    new URL('../skill.md', import.meta.url),
    new URL('../../skill/SKILL.md', import.meta.url),
  ]
  const hit = candidates.find((url) => existsSync(url))
  if (!hit) throw new Error('simulator skill body is missing')
  return readFileSync(hit, 'utf8')
}

export function apply(ctx) {
  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    source: 'runtime',
    content: loadSkillContent(),
  })
}
