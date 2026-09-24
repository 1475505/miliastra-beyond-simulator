const COMMON_FIELDS = Object.freeze([
  {
    key: 'genericField501',
    label: '通用槽 field501',
    type: 'number',
    defaultValue: 0,
    wire: 'GenericSlot.field501',
  },
  {
    key: 'footerField505',
    label: '尾部槽 field505',
    type: 'number',
    defaultValue: 0,
    wire: 'FooterSlot.field505',
  },
])

const KIND_FIELDS = Object.freeze({
  container: [],
  textbox: [
    { key: 'textField501', label: '文本配置 field501', type: 'number', defaultValue: 20, wire: 'TextConfig.field501' },
    { key: 'textField503', label: '文本配置 field503', type: 'number', defaultValue: 12, wire: 'TextConfig.field503' },
    {
      key: 'textAlign', label: '水平对齐枚举原始值', type: 'enum', defaultValue: 0, wire: 'TextConfig.align',
      options: [
        { value: 0, label: '0 · 左对齐' },
        { value: 1, label: '1 · 居中' },
        { value: 2, label: '2 · 右对齐' },
      ],
    },
  ],
  textwindow: [
    { key: 'textField501', label: '文本配置 field501', type: 'number', defaultValue: 20, wire: 'TextConfig.field501' },
    { key: 'textField503', label: '文本配置 field503', type: 'number', defaultValue: 12, wire: 'TextConfig.field503' },
    {
      key: 'textAlign', label: '水平对齐枚举原始值', type: 'enum', defaultValue: 0, wire: 'TextConfig.align',
      options: [
        { value: 0, label: '0 · 左对齐' },
        { value: 1, label: '1 · 居中' },
        { value: 2, label: '2 · 右对齐' },
      ],
    },
    { key: 'textField511', label: '文本视窗 field511', type: 'number', defaultValue: 1, wire: 'TextConfig.field511' },
    { key: 'textViewField502', label: '视窗标记 field502', type: 'number', defaultValue: 1, wire: 'TextConfig.viewFlags.field502' },
    { key: 'textViewField503', label: '视窗标记 field503', type: 'number', defaultValue: 1, wire: 'TextConfig.viewFlags.field503' },
  ],
  cursor: [
    { key: 'cursorField501', label: '光标检测 field501', type: 'number', defaultValue: 1, wire: 'CursorConfig.field501' },
  ],
  reference: [
    { key: 'templateRefSlot', label: '模板引用槽原始值', type: 'string', defaultValue: '', wire: 'Details.templateRefSlot' },
  ],
  grid: [
    { key: 'gridField501', label: '网格标记 field501', type: 'number', defaultValue: 1, wire: 'GridViewConfig.field501' },
    { key: 'gridField507', label: '网格标记 field507', type: 'number', defaultValue: 1, wire: 'GridViewConfig.field507' },
    { key: 'gridField508', label: '网格标记 field508', type: 'number', defaultValue: 1, wire: 'GridViewConfig.field508' },
    { key: 'gridField509', label: '网格标记 field509', type: 'number', defaultValue: 1, wire: 'GridViewConfig.field509' },
    { key: 'gridField511', label: '网格标记 field511', type: 'number', defaultValue: 5, wire: 'GridViewConfig.field511' },
    { key: 'gridField512', label: '网格标记 field512', type: 'number', defaultValue: 1, wire: 'GridViewConfig.field512' },
  ],
  keyhint: [
    { key: 'keyHintField501', label: '按键提示 field501', type: 'number', defaultValue: 1, wire: 'KeyHintConfig.field501' },
    { key: 'keyHintField502', label: '键鼠键位原始值', type: 'number', defaultValue: 1, wire: 'KeyHintConfig.field502' },
  ],
  image: [
    { key: 'imageField502', label: '图片标记 field502', type: 'number', defaultValue: 1, wire: 'ImageConfig.field502' },
    { key: 'imageField504', label: '图片标记 field504', type: 'number', defaultValue: 1, wire: 'ImageConfig.field504' },
    { key: 'imageField505', label: '图片标记 field505', type: 'number', defaultValue: 1, wire: 'ImageConfig.field505' },
    { key: 'imageField507', label: '图片标记 field507', type: 'number', defaultValue: 2, wire: 'ImageConfig.field507' },
    {
      key: 'imageFillType',
      label: '填充形状枚举原始值',
      type: 'enum',
      defaultValue: 1,
      wire: 'ImageConfig.fillType',
      options: [
        { value: 1, label: '1 · 横向' },
        { value: 2, label: '2 · 纵向' },
        { value: 3, label: '3 · 90度环绕' },
        { value: 4, label: '4 · 180度环绕' },
        { value: 5, label: '5 · 360度环绕' },
      ],
    },
  ],
  animation: [
    { key: 'effectSlot', label: '界面动效槽原始值', type: 'string', defaultValue: '', wire: 'Details.effectSlot' },
  ],
  fullscreen: [
    { key: 'fullscreenEffectSlot', label: '全屏动效槽原始值', type: 'string', defaultValue: '', wire: 'Details.fullscreenEffectSlot' },
  ],
})

export function rawFieldDefinitions(kind) {
  return [...COMMON_FIELDS, ...(KIND_FIELDS[kind] || [])]
}

export function rawFieldDefinition(kind, key) {
  return rawFieldDefinitions(kind).find((definition) => definition.key === key) || null
}

export function sanitizeRawFieldValue(definition, value) {
  if (!definition) throw new Error('unknown raw GIA field')
  if (definition.type === 'string') return String(value ?? '')
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${definition.wire} must be a finite number`)
  return Math.trunc(number)
}

export function createGiaRaw(kind, source = {}) {
  const out = {}
  for (const definition of rawFieldDefinitions(kind)) {
    const value = Object.hasOwn(source || {}, definition.key) ? source[definition.key] : definition.defaultValue
    out[definition.key] = sanitizeRawFieldValue(definition, value)
  }
  return out
}
