const MAX_BYTES = 6 * 1024 * 1024
const DEFAULT_URL = 'https://ppt.070077.xyz/beyond-ai/flappy-fish.save.json'

// Web and DSH share the configured source and download validation.
// Source URLs are deployment configuration, shared by all tutorial sessions.
// The browser only requests the configured example through the same-origin host.
export function createQuickStartSource(options = {}) {
  const url = options.quickStartUrl ?? process.env.QXQY_QUICK_START_URL ?? DEFAULT_URL
  const info = {
    enabled: Boolean(url), id: 'flappy-fish-motion-v1',
    sourceLabel: '在线示例',
  }
  return {
    info,
    async load(signal) {
      if (!info.enabled) throw new Error('尚未配置快速上手示例')
      const source = new URL(url)
      if (!['http:', 'https:'].includes(source.protocol)) throw new Error('示例下载地址必须为 HTTP(S)')
      const response = await fetch(source, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error(`示例下载失败：HTTP ${response.status}`)
      const chunks = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > MAX_BYTES) throw new Error('示例存档超过 6 MiB')
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      const archive = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
      if (archive.format !== 'qxqy-simulator-save' || !archive.assets?.server || !archive.assets?.client || !Array.isArray(archive.assets?.scripts)) {
        throw new Error('下载内容不是完整的 .save.json 存档')
      }
      archive.scriptSync = null
      return Buffer.from(JSON.stringify(archive)).toString('base64')
    },
  }
}
