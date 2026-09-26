import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 模拟器策略，不是官方契约。真机语言只来自 game.GetLanguageType()。
// 试玩宿主在启动时读取本机客户端最近一次 "Request to set language"，
// 映射到 Enum.LanguageType 的 Name。读不到就保持运行时默认 LanguageChs。
const CLIENT_LANGUAGE_TO_ENUM = {
  'zh-cn': 'LanguageChs',
  chs: 'LanguageChs',
  'zh-tw': 'LanguageCht',
  cht: 'LanguageCht',
  en: 'LanguageEng',
  'en-us': 'LanguageEng',
  eng: 'LanguageEng',
  ja: 'LanguageJpn',
  'ja-jp': 'LanguageJpn',
  jp: 'LanguageJpn',
  ko: 'LanguageKor',
  'ko-kr': 'LanguageKor',
  kr: 'LanguageKor',
  fr: 'LanguageFra',
  fra: 'LanguageFra',
  de: 'LanguageDeu',
  deu: 'LanguageDeu',
  es: 'LanguageSpa',
  spa: 'LanguageSpa',
  pt: 'LanguagePor',
  por: 'LanguagePor',
  ru: 'LanguageRus',
  rus: 'LanguageRus',
  th: 'LanguageTha',
  tha: 'LanguageTha',
  vi: 'LanguageVie',
  vie: 'LanguageVie',
  id: 'LanguageInd',
  ind: 'LanguageInd',
  tr: 'LanguageTur',
  tur: 'LanguageTur',
  it: 'LanguageIta',
  ita: 'LanguageIta',
}

export function languageTypeFromClientLog(text) {
  const matches = [...String(text || '').matchAll(/Request to set language:([A-Za-z0-9_-]+)/g)]
  const code = matches.at(-1)?.[1]?.toLowerCase()
  return CLIENT_LANGUAGE_TO_ENUM[code] || null
}

export function defaultClientLanguageLogPath() {
  return join(homedir(), 'AppData', 'LocalLow', 'miHoYo', '原神', 'output_log.txt')
}

export function readClientLanguageType(logPath = defaultClientLanguageLogPath()) {
  try {
    return languageTypeFromClientLog(readFileSync(logPath, 'utf8'))
  } catch {
    return null
  }
}
