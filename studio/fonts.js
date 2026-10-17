// Shared names only; font bytes and local paths never enter project data.
export const DEFAULT_FONT = '"Microsoft YaHei UI","Microsoft YaHei","HarmonyOS Sans SC","Noto Sans CJK SC",sans-serif'
export const FONT_ROUTE = '/qxqy-font'
export const MAX_FONT_BYTES = 32 * 1024 * 1024
export const fontFamily = id => `QxqyLocal_${id}`
export const fontStack = id => id ? `"${fontFamily(id)}",${DEFAULT_FONT}` : DEFAULT_FONT
