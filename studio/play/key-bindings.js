// Official Lua UI API, local rev223 snapshot: KeyboardKeyCode / KeyEventType.
// See studio/docs/browser-input.md for source and browser-only policy.
const craftCodes = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'KeyU', 'KeyZ', 'KeyY', 'KeyG', 'KeyH', 'KeyI', 'KeyO', 'KeyP', 'KeyJ', 'KeyK', 'KeyL', 'KeyV',
  'F5', 'F6', 'F7', 'F8', 'F9', 'F10',
  'Backquote', 'Minus', 'Equal', 'BracketLeft', 'Comma', 'Period', 'Slash',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlRight', 'ShiftRight', 'Backspace', 'CapsLock',
]
const keyCodes = new Map(craftCodes.map((code, i) => [code, `CraftspersonKey${i + 1}`]))
for (const [code, name] of Object.entries({
  KeyW: 'MoveForwardKey', KeyS: 'MoveBackwardKey', KeyA: 'MoveLeftKey', KeyD: 'MoveRightKey',
  ControlLeft: 'SwitchToWalkOrRunKey', Space: 'JumpKey', KeyX: 'DropKey', Tab: 'OpenShortcutWheelKey',
  KeyF: 'InteractKey', KeyE: 'CharacterSkill1Key', KeyQ: 'CharacterSkill2Key',
  KeyR: 'CharacterSkill3Key', KeyT: 'CharacterSkill4Key',
})) keyCodes.set(code, name)

export function keyEventName(event, phase) {
  if (phase !== 'Down' && phase !== 'Up') return ''
  if (event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.key === 'Dead') return ''
  const key = String(event.key || '')
  // Letters follow the typed letter on non-QWERTY layouts. An unsupported
  // letter must not fall through to a different physical letter's binding.
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : event.code
  const name = keyCodes.get(code)
  return name ? `Keyboard${name}${phase}` : ''
}

export function mouseKeyEventName(button, phase) {
  if (phase !== 'Down' && phase !== 'Up') return ''
  const name = button === 0 ? 'NormalAttackKey' : button === 2 ? 'SprintKey' : ''
  return name ? `Keyboard${name}${phase}` : ''
}
