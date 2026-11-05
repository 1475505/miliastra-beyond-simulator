// Default physical bindings: official Lua UI API (2026-10-24 local snapshot).
// These names are NOT GIA numeric enum values. Only keyboard 24 has a native
// single-variable sample; 1 is the existing empty/default slot in both fields.
const key = label => ({ type: 'key', label })
const pad = direction => ({ type: 'dpad', direction })
const shoulder = label => ({ type: 'shoulder', label })
const face = label => ({ type: 'face', label })
const mouse = side => ({ type: 'mouse', side })
const plus = { type: 'plus', label: '+' }
const combo = token => [shoulder('LB'), plus, token]
const craftLabels = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'U', 'Z', 'Y', 'G', 'H', 'I', 'O', 'P', 'J', 'K', 'L', 'V',
  'F5', 'F6', 'F7', 'F8', 'F9', 'F10', '`', '-', '=', '[', ',', '.', '/',
  '↑', '↓', '←', '→', '右Ctrl', '右Shift', 'Backspace', 'CapsLock',
]
const row = (name, label, tokens, physical) => ({ name, label, tokens, physical })
const keyboard = craftLabels.map((label, i) => row(`CraftspersonKey${i + 1}`, `奇匠按键${i + 1}`, [key(label)], label))
for (const [name, label, physical] of [
  ['MoveForwardKey', '向前移动', 'W'], ['MoveBackwardKey', '向后移动', 'S'],
  ['MoveLeftKey', '向左移动', 'A'], ['MoveRightKey', '向右移动', 'D'],
  ['SwitchToWalkOrRunKey', '切换行走/奔跑状态', '左Ctrl'], ['SprintKey', '冲刺', '鼠标右键'],
  ['JumpKey', '跳跃', 'Space'], ['DropKey', '落下', 'X'], ['OpenShortcutWheelKey', '呼出快捷轮盘', 'Tab'],
  ['InteractKey', '拾取/交互', 'F'], ['NormalAttackKey', '普通攻击', '鼠标左键'],
  ['CharacterSkill1Key', '角色技能1', 'E'], ['CharacterSkill2Key', '角色技能2', 'Q'],
  ['CharacterSkill3Key', '角色技能3', 'R'], ['CharacterSkill4Key', '角色技能4', 'T'],
]) keyboard.push(row(name, label, [physical.startsWith('鼠标') ? mouse(physical === '鼠标左键' ? 'left' : 'right') : key(physical)], physical))
const controller = [pad('left'), pad('down'), shoulder('LT'),
  combo(face('Y')), combo(face('X')), combo(face('A')),
  combo(pad('up')), combo(pad('right')), combo(pad('left')), combo(pad('down')),
  combo(shoulder('RB')), combo(shoulder('LT')), combo(shoulder('RT')), combo({ type: 'stick', label: 'LS' }),
].map((tokens, i) => row(`CraftspersonKey${i + 1}`, `奇匠按键${i + 1}`, Array.isArray(tokens) ? tokens : [tokens]))
for (const [name, label, token] of [
  ['SprintKey', '冲刺', shoulder('RB')], ['JumpKey', '跳跃', face('A')],
  ['InteractKey', '拾取/交互', face('X')], ['NormalAttackKey', '普通攻击', face('B')],
  ['CharacterSkill1Key', '角色技能1', shoulder('RT')], ['CharacterSkill2Key', '角色技能2', face('Y')],
  ['CharacterSkill3Key', '角色技能3', pad('up')], ['CharacterSkill4Key', '角色技能4', pad('right')],
  // Menu mappings depend on navigation settings; do not guess A/B.
  ['MenuConfirmKey', '菜单确认', { type: 'unknown', label: '?' }],
  ['MenuBackKey', '菜单返回', { type: 'unknown', label: '?' }],
]) controller.push(row(name, label, [token]))
const directions = { left: '←', right: '→', up: '↑', down: '↓' }
for (const entry of controller) entry.physical = entry.tokens.map(token => token.type === 'dpad' ? `十字键${directions[token.direction]}` : token.type === 'stick' ? 'LS(按下)' : token.label).join(' ')
for (const entries of [keyboard, controller]) entries.unshift(row('None', '无', [], ''))
export const KEY_HINT_KEYS = { keyboard, controller }
export const KEY_HINT_DEVICES = ['auto', 'keyboard', 'controller']
const wireInteger = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647

export function keyHintCode(value, device) {
  if (value == null || value === '' || Number(value) === 1) return 'None'
  if (device === 'keyboard' && Number(value) === 24) return 'CraftspersonKey1'
  return value?.Name ?? value
}

export function normalizeKeyHintCode(value, device) {
  if (typeof value === 'string' && KEY_HINT_KEYS[device].some(entry => entry.name === value)) return value
  if ((typeof value === 'number' || typeof value === 'string' && /^-?\d+$/.test(value))
      && wireInteger(Number(value))) return Number(value)
  throw new Error(`invalid ${device} key hint: ${String(value)}`)
}

export function keyHintWireCode(value, device, name) {
  if (value == null || value === '' || value === 'None') return 1
  if (typeof value === 'number' && wireInteger(value)) return value
  if (device === 'keyboard' && value === 'CraftspersonKey1') return 24
  throw new Error(`${name}: ${device} 按键 ${value} 尚无已核实的 GIA 数字映射；请在官方编辑器配置该键位，或在 Lua 中设置按键枚举。`)
}

export function keyHintOptions(device, current) {
  const options = KEY_HINT_KEYS[device].map(entry => ({ value: entry.name, label: entry.physical ? `${entry.physical} · ${entry.label}` : entry.label }))
  if (typeof current === 'number') options.unshift({ value: String(current), label: `原始键码 ${current}（${keyHintCode(current, device)}）` })
  return options
}

export function resolveKeyHint(control, device = 'KeyboardAndMouse', override = 'auto') {
  const mode = override === 'keyboard' || override === 'controller' ? override
    : ['Controller', 'MobileController', 'CONTROLLER_CONSOLE', 'CONTROLLER_MOBILE'].includes(device) ? 'controller'
      : ['Mobile', 'TOUCHSCREEN'].includes(device) ? 'touch' : 'keyboard'
  // Touch has no corresponding key field. Hiding it is preview policy.
  if (mode === 'touch') return { device: mode, name: 'None', label: '无', tokens: [] }
  const name = keyHintCode(control[`${mode}KeyCode`], mode)
  const entry = KEY_HINT_KEYS[mode].find(entry => entry.name === name)
  return { device: mode, name, label: entry?.label || `未识别键码 ${name}`, tokens: entry?.tokens || [{ type: 'unknown', label: '?' }] }
}
