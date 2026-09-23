const GROUPS = {
  EaseType: [
    'Linear', 'InSine', 'OutSine', 'InOutSine',
    'InQuad', 'OutQuad', 'InOutQuad',
    'InCubic', 'OutCubic', 'InOutCubic',
    'InQuart', 'OutQuart', 'InOutQuart',
    'InQuint', 'OutQuint', 'InOutQuint',
    'InExpo', 'OutExpo', 'InOutExpo',
    'InCirc', 'OutCirc', 'InOutCirc',
    'InBack', 'OutBack', 'InOutBack',
    'InElastic', 'OutElastic', 'InOutElastic',
    'InBounce', 'OutBounce', 'InOutBounce',
  ],
  CustomVariableEntityType: ['Level', 'PlayerSelf', 'AvatarSelf'],
  Device: ['KeyboardAndMouse', 'Mobile', 'Controller', 'MobileController'],
  StageMode: ['Beyond', 'Classic'],
  LanguageType: [
    'LanguageNone', 'LanguageEng', 'LanguageChs', 'LanguageCht',
    'LanguageFra', 'LanguageDeu', 'LanguageSpa', 'LanguagePor',
    'LanguageRus', 'LanguageJpn', 'LanguageKor', 'LanguageTha',
    'LanguageVie', 'LanguageInd', 'LanguageTur', 'LanguageIta',
  ],
  ParamType: [
    'Entity', 'EntityList', 'Int', 'IntList', 'Bool', 'BoolList',
    'Float', 'FloatList', 'String', 'StringList', 'Vector3', 'Vector3List',
    'Guid', 'GuidList', 'ConfigId', 'PrefabId', 'ConfigIdList', 'PrefabIdList',
  ],
  CursorEventType: [
    'CursorDown', 'CursorUp', 'CursorEnter', 'CursorExit',
    'CursorDrag', 'CursorBeginDrag', 'CursorEndDrag', 'CursorClick',
  ],
  ScrollDirection: ['Horizontal', 'Vertical'],
  ScrollLayoutConstraint: ['AutoWrap', 'Fixed'],
  ScrollAlignType: ['Bottom', 'Center', 'Top'],
  ControllerNavigationDir: ['Up', 'Down', 'Left', 'Right'],
  ControllerNavigationEventType: [
    'Confirm', 'Cancel', 'Focus', 'LostFocus',
    'RightStickUp', 'RightStickDown', 'RightStickRight', 'RightStickLeft',
    'LeftStickUp', 'LeftStickDown', 'LeftStickRight', 'LeftStickLeft',
  ],
  ControllerNavigationMode: ['None', 'NearestControl', 'Specified'],
  TextHorizontalAlignment: ['Left', 'Middle', 'Right'],
  TextVerticalAlignment: ['Top', 'Middle', 'Bottom'],
  ImageType: ['Basic', 'Stretch'],
  ImageSource: [
    'StaticReference', 'Item', 'Equipment', 'Skill',
    'UnitStatus', 'Faction', 'Currency', 'Prefab',
  ],
  ImageFillType: ['Unused', 'Horizontal', 'Vertical', 'Radial90', 'Radial180', 'Radial360'],
  ImageFillHorizontalType: ['Left', 'Right'],
  ImageFillVerticalType: ['Bottom', 'Top'],
  ImageFillRadial90Type: ['BottomLeft', 'TopLeft', 'TopRight', 'BottomRight'],
  ImageFillRadialType: ['Bottom', 'Left', 'Top', 'Right'],
  ImageMaskSoftEdgeMode: ['Percentage', 'Pixel'],
  UIAnimationLayer: ['AboveAllControls', 'BelowAllControls'],
}

const KEYBOARD = [
  ...Array.from({ length: 43 }, (_, i) => `CraftspersonKey${i + 1}`),
  'MoveForwardKey', 'MoveBackwardKey', 'MoveLeftKey', 'MoveRightKey',
  'SwitchToWalkOrRunKey', 'SprintKey', 'JumpKey', 'DropKey',
  'OpenShortcutWheelKey', 'InteractKey', 'NormalAttackKey',
  'CharacterSkill1Key', 'CharacterSkill2Key', 'CharacterSkill3Key', 'CharacterSkill4Key',
  'None',
]

const CONTROLLER = [
  ...Array.from({ length: 14 }, (_, i) => `CraftspersonKey${i + 1}`),
  'SprintKey', 'JumpKey', 'InteractKey', 'NormalAttackKey',
  'CharacterSkill1Key', 'CharacterSkill2Key', 'CharacterSkill3Key', 'CharacterSkill4Key',
  'MenuConfirmKey', 'MenuBackKey', 'None',
]

function keyEvents() {
  const names = []
  for (const suffix of ['Down', 'Up']) {
    for (let i = 1; i <= 43; i++) names.push(`KeyboardCraftspersonKey${i}${suffix}`)
    for (const k of [
      'MoveForwardKey', 'MoveBackwardKey', 'MoveLeftKey', 'MoveRightKey',
      'SwitchToWalkOrRunKey', 'SprintKey', 'JumpKey', 'DropKey',
      'OpenShortcutWheelKey', 'InteractKey', 'NormalAttackKey',
      'CharacterSkill1Key', 'CharacterSkill2Key', 'CharacterSkill3Key', 'CharacterSkill4Key',
    ]) names.push(`Keyboard${k}${suffix}`)
    for (let i = 1; i <= 14; i++) names.push(`ControllerCraftspersonKey${i}${suffix}`)
    for (const k of [
      'SprintKey', 'JumpKey', 'InteractKey', 'NormalAttackKey',
      'CharacterSkill1Key', 'CharacterSkill2Key', 'CharacterSkill3Key', 'CharacterSkill4Key',
      'MenuConfirmKey', 'MenuBackKey',
    ]) names.push(`Controller${k}${suffix}`)
  }
  return names
}

GROUPS.KeyboardKeyCode = KEYBOARD
GROUPS.ControllerKeyCode = CONTROLLER
GROUPS.KeyEventType = keyEvents()

const ITEM_CACHE = new Map()

export function makeEnumItem(enumType, name) {
  const key = `${enumType}\0${name}`
  let item = ITEM_CACHE.get(key)
  if (!item) {
    item = {
      __kind: 'EnumItem',
      Name: name,
      FullName: `Enum.${enumType}.${name}`,
      EnumType: enumType,
    }
    ITEM_CACHE.set(key, item)
  }
  return item
}

export function canonicalEnumItem(enumType, value) {
  if (value == null) return value
  if (value.__kind === 'EnumItem') {
    return makeEnumItem(value.EnumType || enumType, value.Name)
  }
  if (typeof value === 'string' && value) return makeEnumItem(enumType, value)
  return value
}

export function buildEnumTree() {
  const tree = {}
  for (const [type, names] of Object.entries(GROUPS)) {
    const group = {}
    for (const name of names) {
      group[name] = makeEnumItem(type, name)
    }
    tree[type] = group
  }
  return tree
}
