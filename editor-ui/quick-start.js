import { t } from '../studio/i18n.js'

export const QUICK_START_ID = 'simulator-guide-v7'
export const quickStartStorageKey = sessionId => `qxqy-quick-start:${QUICK_START_ID}:${sessionId}`

export const QUICK_START_CSS = `
.qxsim-footer .qxsim-quick-button{min-height:28px;padding:4px 10px;border:1px solid #32a6b755;border-radius:6px;color:#147486;background:color-mix(in srgb,#39c6ce 10%,var(--panel));font-weight:650;transition:background-color .14s,border-color .14s}.qxsim[data-theme=dark] .qxsim-quick-button{color:#7edce4}.qxsim-footer .qxsim-quick-button:not(:disabled):hover{color:var(--text);border-color:#32a6b7;background:color-mix(in srgb,#39c6ce 18%,var(--panel));text-decoration:none}.qxsim-footer .qxsim-quick-button:not(:disabled):active{background:color-mix(in srgb,#39c6ce 26%,var(--panel))}
.qxsim-modal.qxsim-quick-welcome{width:min(410px,94vw);padding:24px;border-radius:14px}.qxsim-quick-welcome h2{font-size:20px;margin:0 0 10px}.qxsim-quick-welcome>p{font-size:13px;color:var(--muted);margin:0 0 20px;line-height:1.7}.qxsim-quick-welcome footer{gap:8px;flex-wrap:wrap}
.qxsim-quick-example{padding:12px 0;margin-bottom:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
.qxsim-quick-layer{position:absolute;inset:0;z-index:20;pointer-events:none;overflow:hidden}.qxsim-quick-shade{position:absolute;inset:0;width:100%;height:100%;fill:#07131c55}.qxsim-quick-spot{position:absolute;border:2px solid #36c4cf;border-radius:6px;box-shadow:0 0 0 3px #36c4cf28;box-sizing:border-box}
.qxsim-quick-guide{position:absolute;box-sizing:border-box;width:304px;max-width:calc(100% - 24px);padding:14px 16px;border:1px solid #32a6b766;border-radius:10px;background:var(--panel);color:var(--text);box-shadow:0 8px 30px #0003;pointer-events:auto;font-size:12px}
.qxsim-quick-guide.external{width:460px;padding:18px 22px;border-top:3px solid #36c4cf;box-shadow:0 12px 42px #0004;font-size:13px}.qxsim-quick-context{display:inline-block;margin-bottom:10px;padding:4px 8px;border-radius:5px;background:color-mix(in srgb,#36c4cf 13%,var(--panel));color:var(--text);font-size:12px;font-weight:650}.qxsim-quick-guide.external h2{font-size:17px}.qxsim-quick-guide .qxsim-quick-tasks{margin:10px 0 0;padding-left:22px;font-size:inherit;line-height:1.8}.qxsim-quick-tasks li+li{margin-top:6px}.qxsim-quick-tasks strong{color:var(--text)}.qxsim-quick-guide .qxsim-quick-continue{margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:11px;line-height:1.7}.qxsim-quick-guide .qxsim-quick-manual{margin-top:3px;font-size:11px}
.qxsim-quick-guide{display:flex;flex-direction:column}.qxsim-quick-guide>*{flex-shrink:0}.qxsim-quick-guide>.qxsim-quick-body{flex:0 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.qxsim-quick-top{display:flex;align-items:center;gap:8px;margin-bottom:10px}.qxsim-quick-top select{width:0;flex:1;min-width:0;min-height:30px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);color:var(--text);font:inherit;padding:4px 6px;cursor:pointer}.qxsim-quick-top select:not(:disabled):hover{border-color:var(--blue)}.qxsim-quick-top select option{background:var(--panel);color:var(--text)}
.qxsim-quick-progress{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:11px;margin-bottom:6px}.qxsim-quick-progress span:last-child{flex-shrink:0}
.qxsim-quick-controls>.qxsim-quick-previous{flex:0 0 auto}.qxsim-quick-controls>.qxsim-action{min-width:0;min-height:38px;height:auto;white-space:normal;text-align:center;font-size:12px;line-height:1.5;padding:8px 10px}.qxsim-quick-controls>[data-quick-next]{flex:1;font-weight:650}
.qxsim .qxsim-quick-link{min-height:30px;padding:5px 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--muted);font-size:11px;cursor:pointer;touch-action:manipulation}.qxsim .qxsim-quick-link:not(:disabled):hover{color:var(--text);background:var(--hover);border-color:var(--line)}.qxsim .qxsim-quick-link:not(:disabled):active{background:color-mix(in srgb,var(--blue) 14%,var(--panel))}.qxsim .qxsim-quick-link:disabled{opacity:1;color:var(--muted);cursor:not-allowed}.qxsim-quick-top>.qxsim-quick-link{flex:0 0 30px;width:30px;font-size:18px;line-height:1;padding:0}.qxsim-quick-guide h2{font-size:15px;line-height:1.5;margin:0 0 6px}.qxsim-quick-guide p{margin:0;color:var(--muted);line-height:1.7}.qxsim-quick-guide details{margin-top:8px;color:var(--muted);font-size:11px}.qxsim-quick-guide summary{cursor:pointer}.qxsim-quick-guide ol{padding-left:18px;line-height:1.7;margin:6px 0 0}.qxsim-quick-controls{display:flex;align-items:stretch;justify-content:space-between;gap:10px;margin-top:14px}.qxsim-quick-back{display:block;margin-top:8px;align-self:flex-start}.qxsim-quick-error{color:var(--danger);font-size:12px;line-height:1.5;margin-top:8px;overflow-wrap:anywhere}.qxsim-quick-arrow{position:absolute;width:8px;height:8px;background:var(--panel);border:solid #32a6b766;border-width:1px 0 0 1px;transform:rotate(45deg)}
.qxsim-modal.qxsim-quick-welcome footer{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qxsim-quick-welcome footer>.qxsim-action{height:auto;min-height:40px;white-space:normal;line-height:1.5;padding:8px 12px}.qxsim-quick-welcome footer>.qxsim-action.primary{grid-column:1 / -1;font-weight:650}.qxsim-quick-welcome footer>.qxsim-quick-link{justify-self:end}.qxsim-quick-welcome [role=alert]{padding:10px 12px;border:1px solid color-mix(in srgb,var(--danger) 40%,var(--line));border-radius:6px;background:color-mix(in srgb,var(--danger) 7%,var(--panel))}
`

// Deliver one finished game, rather than tour the editor's features.
// External steps are user-confirmed; the guide cannot observe the game editor.
const STAGES = [
  { id: 'play', label: '先试玩这个游戏', steps: [
    { id: 'debug', label: '体验 AI 做好的游戏', page: 'ui', target: 'play', next: '试玩过了，去导出 →',
      title: '假设 AI 已经做好了这个游戏', why: '这份示例就当作 AI 交给你的成品。点击右上角「试玩」体验，玩完点「返回编辑」，我们把它导入千星沙箱。',
      actions: ['点击右上角高亮的「试玩」按钮，在打开的试玩窗口中体验游戏。', '体验完后，点击试玩窗口的「返回编辑」，回到当前页面。'],
      detailsTitle: '以后换成你自己的游戏', details: ['模拟器是可以让 AI 直接操作的外置沙箱。告诉 AI 你想做什么奇域，让它制作并保存完整 .save.json，再从「工作区存档」打开。', '左边是控件树，中间是界面，右边是属性。试玩遇到问题，把「日志」报错发给 AI 修改。'] },
  ] },
  { id: 'import', label: '导出并导入千星沙箱', steps: [
    { id: 'export', label: '下载整合包', target: 'export', next: '已下载，去千星沙箱 →',
      title: '接下来，把这个游戏导入千星沙箱', why: '先从模拟器下载控件和脚本的整合包。',
      actions: ['点击右上角高亮的「导出」下拉框。', '点击「资产包 GIA 整合包（控件+脚本）」，等待 .gia 下载完成。', '在浏览器下载列表中找到这个文件，记住它保存的位置。'] },
    { id: 'import', label: '放入资产目录', external: true, next: '已放入 GIA →',
      title: '切换到千星沙箱，打开资产目录', why: '这一步要在千星沙箱和系统文件夹中完成，不是在模拟器里导入。',
      actions: ['在千星沙箱中新建或打开你要放入游戏的存档。', '打开系统菜单，点击「资产导入导出工具」，切到「导入与转存」页签。', '点击右下角「加载外部资产」。弹出「外部资产加载」窗口后，先点击其中的「打开目录」。', '在打开的系统文件夹中，复制放入刚从模拟器下载的 .gia 文件。放好后返回引导，下一步再加载。'] },
    { id: 'transfer', label: '转存这份游戏', external: true, next: '已转存资产 →',
      title: '现在，加载并转存刚放入的资产', why: '文件放进目录后，还需要点击加载和转存，才会成为当前存档的资产。',
      actions: ['回到千星沙箱的「外部资产加载」弹窗，点击弹窗内的「加载外部资产」。', '等待加载完成，看到文件添加成功的提示后，在「导入与转存」中找到这份游戏的资产。', '点击选中该资产，再点击右下角「转存所选资产」。', '如果弹出页签选择窗口，选择要存放的页签并确认，等待资产转存成功。'] },
    { id: 'layout', label: '让界面显示出来', external: true, next: '已加入布局，去核对索引 →',
      title: '点击「添加界面控件」，把游戏放进布局', why: '资产转存成功后，还要把导入的客户端控件容器加到实际使用的界面布局。',
      actions: ['打开「界面控件组管理」，点击左上角「界面布局」页签。', '在左侧选中要使用的布局，例如「游戏布局」。', '点击左下角「添加界面控件」按钮，在弹出的列表里展开「自定义模板」。', '点击本次导入的客户端控件容器。看到它出现在左侧「布局详情 → 自定义」中，就完成了这一步。'] },
  ] },
  { id: 'indices', label: '校准客户端控件索引', steps: [
    { id: 'game-index', label: '复制客户端模板索引', external: true, next: '已记下索引，回模拟器 →',
      title: '找到导入的客户端模板，复制实际索引', why: '这里重点校准 Lua 中引用的客户端控件模板及其子控件，尤其是用于实例化的模板索引；不是布局索引，也不是逐个重编号服务端界面。',
      actions: ['在千星沙箱打开「界面控件组库 → 客户端控件模板」，找到本次导入、Lua 中用到的模板。', '选中要核对的模板；如果 Lua 还引用了它的子控件，再进入模板选中对应子控件。', '在右侧面板顶部、控件名称下方找到「索引」数值，点击数值旁边的复制图标。', '记下模板和控件名称。示例先核对 RectTemplate、CircleTemplate、TriangleTemplate，不要复制「游戏布局」或客户端控件容器的索引来替代模板索引。'] },
    { id: 'select-control', label: '选中对应客户端模板', page: 'ui', assetType: 'client-control-template', target: 'tree', next: '已选中对应控件 →',
      title: '回到模拟器，在左侧找到对应的客户端控件', why: '主要需要校准的是客户端控件索引，尤其是 Lua 引用的客户端模板。已切到「UI控件-客户端」，请选择同名模板或子控件，不需要逐个修改服务端界面控件。',
      actions: ['在左侧「UI控件-客户端」列表中，点击刚才记下的同名模板；核对子控件时选中模板内对应节点。', '核对右侧名称，确认是同一个客户端模板或子控件后再继续。'] },
    { id: 'indices', label: '修改客户端控件索引', page: 'ui', assetType: 'client-control-template', target: 'control-guid', fallback: 'tree',
      next: '索引已对齐，更新 Lua →',
      title: '把对应客户端模板的实机索引填到这里', why: '在「客户端控件索引」中粘贴千星沙箱里同一个模板或子控件的数值，点击「修改」。主要核对 Lua 用到的客户端模板和控件；相同则不用改。',
      actions: ['点击右侧高亮区域中的索引输入框，粘贴刚在千星沙箱复制的数值。', '点击输入框旁边的「修改」按钮；其他用到的控件或模板也逐项核对。数值相同则不用修改。'],
      detailsTitle: '同批模板可批量修改', details: ['同一次导入且模板结构未变时，可勾选「自动修改其他客户端索引值」；分批导入或结构有变化时逐项核对。'] },
    { id: 'references', label: '让代码使用新索引', page: 'ui', assetType: 'client-control-template', target: 'guid-sync', fallback: 'control-guid', next: 'Lua 已处理，去找脚本目录 →',
      title: '索引改好了，再让 Lua 用上新索引', why: '点击「复制提示词给 AI」，发给当前项目的 AI；处理后点「AI 已处理，重新载入存档」。没有索引变更可直接继续。',
      actions: ['在页面上方的索引同步提示中，点击「复制提示词给 AI」，粘贴给当前项目的 AI。', '等 AI 处理并保存后，回这里点击「AI 已处理，重新载入存档」，检查结果。如果索引没有变化，可跳过。'],
      detailsTitle: '也可以直接替换', details: ['「全量替换脚本索引」会替换已登记脚本中的同值数字，可能改到非索引内容。使用后检查代码并试玩。'] },
  ] },
  { id: 'paths', label: '绑定真机路径', steps: [
    { id: 'find-script', label: '找到导入的脚本', external: true, next: '已打开脚本所在目录 →',
      title: '再切到千星沙箱，找到这个游戏的脚本', why: '从已经导入的脚本映射打开目录，才能找到当前账号、当前存档实际使用的位置。',
      actions: ['点击顶部「窗口」菜单，打开「客户端脚本资源管理器」。', '在左侧展开「客户端脚本映射」，点击本次导入的页签；未分类时点击「未分类页签」。', '在右侧按「名称」和「文件路径」找到本游戏的脚本，示例入口是 workspace/flappy-fish/main.lua。', '双击对应的脚本行，打开它所在的系统目录；不要选左侧的「脚本外部资产」。'],
      detailsTitle: '示例该找哪个脚本？', details: ['示例的入口是 workspace/flappy-fish/main.lua，另外还有 draws.lua 和 motion.lua。自己的游戏找对应入口脚本即可。'] },
    { id: 'find-path', label: '复制导入根目录', external: true, next: '已复制路径，回模拟器 →',
      title: '沿这个目录找到 default_import_file', why: '我们需要的是关卡的脚本导入根目录，不是单个 Lua 文件或项目子文件夹。',
      actions: ['在刚打开的系统文件夹中，通过地址栏或上一级按钮，找到名为 default_import_file 的文件夹。', '进入 default_import_file，点击文件管理器地址栏，复制该文件夹的完整路径。', '确认路径以 default_import_file 结尾，再切回模拟器。下一步将它粘贴到「千星沙箱脚本文件夹」。'] },
    { id: 'paths', label: '项目脚本位置', page: 'script', target: 'sync-workspaceDir',
      title: '回到模拟器，填写项目脚本文件夹', why: '已为你打开「Lua 脚本 → 实机脚本同步」。示例的代码已在存档里，这一项留空；自己的游戏填项目在工作区内的相对目录。' },
    { id: 'client-root', label: '游戏脚本位置', page: 'script', target: 'sync-clientImportRoot',
      title: '把刚复制的完整路径粘贴到这里', why: '填入「千星沙箱脚本文件夹」，结尾应为 default_import_file。也可点「发现本机目录」选择刚才的账号和关卡。' },
    { id: 'client-subdir', label: '对齐脚本映射', page: 'script', target: 'sync-clientSubdir',
      title: '保留导入时的项目子文件夹', why: '示例这一项也留空，保留原路径 workspace/flappy-fish/main.lua。看下方复制路径示例，确认脚本会回到刚才找到的位置。' },
    { id: 'archive', label: '存档位置', page: 'script', target: 'sync-archive',
      title: '给这份工程留一个存档位置', why: '填写工作区内的 .save.json 相对路径。可以沿用当前值，下一步会把工程和目录绑定一起保存。' },
    { id: 'settings', label: '保存路径设置', page: 'script', target: 'sync-settings',
      next: '已保存设置，去更新脚本 →',
      title: '现在点击「保存设置」', why: '把刚填的目录绑定到这份存档。接下来，将已经校准索引的脚本更新到千星沙箱。',
      actions: ['点击高亮区域里的「保存设置」，不要只点引导卡片的继续按钮。', '看到「脚本位置已保存」提示后，再继续查看更新。'] },
  ] },
  { id: 'update', label: '更新脚本并实机试玩', steps: [
    { id: 'sync', label: '查看这次脚本更新', page: 'script', target: 'sync-actions', next: '已看到差异，去确认复制 →',
      title: '点击「保存存档并查看更新」', why: '先查看每个脚本将复制到哪里，以及更新前后的代码。此时还没有写入千星沙箱。',
      actions: ['点击高亮的「保存存档并查看更新」按钮，等待出现脚本更新清单。', '核对「复制到」的目标路径，展开「对比更新前后的代码」检查本次内容。'] },
    { id: 'copy', label: '确认写入游戏目录', page: 'script', target: 'sync-confirm', fallback: 'sync-actions', next: '已复制，去千星沙箱试玩 →',
      title: '核对路径，勾选脚本，再确认复制', why: '在更新清单中勾选本次脚本，点击「确认复制」。如果提示内容相同，就不用复制，直接继续。',
      actions: ['在脚本更新清单中勾选本次要更新的文件。', '点击清单底部高亮的「确认复制 N 个脚本」，等待「脚本已复制到千星沙箱」提示。内容都相同时可以直接继续。'],
      detailsTitle: '还没出现更新清单？', details: ['先完成目录绑定并保存设置，再点击「保存存档并查看更新」。'] },
    { id: 'game-play', label: '在千星沙箱验证', external: true,
      title: '最后，回千星沙箱保存关卡并重新试玩', why: '现在体验导入后的游戏，确认界面、操作和脚本都正常。以后让 AI 修改玩法，再重复「查看更新 → 确认复制」，已有脚本无需重新导入 GIA。',
      actions: ['回到千星沙箱，保存当前关卡，让脚本更新进入这份存档。', '启动游戏内试玩，实际检查画面、操作和刚修改的功能。', '如果出现问题，保留日志或截图交给 AI 处理；确认正常后，回这里完成引导。'],
      detailsTitle: '以后继续修改游戏', details: ['告诉 AI：「把这次脚本修改同步到已绑定的千星沙箱目录。」', '新增脚本还需在游戏中关联映射；改变 UI 结构则需更新 GIA。'] },
  ] },
]
const STEPS = STAGES.flatMap((stage, stageIndex) => stage.steps.map((step, stageStep) => ({ ...step, stageIndex, stageStep })))

function readProgress(sessionId) {
  try {
    const value = JSON.parse(localStorage.getItem(quickStartStorageKey(sessionId)) || '{}')
    return { active: Boolean(value.active), step: Math.max(0, Math.min(STEPS.length, Math.floor(Number(value.step) || 0))), collapsed: Boolean(value.collapsed) }
  } catch { return { active: false, step: 0, collapsed: false } }
}

const clamp = (n, min, max) => Math.max(min, Math.min(n, max))
function visibleRect(target, root) {
  if (!target || !target.getClientRects().length) return null
  let { left, right, top, bottom } = target.getBoundingClientRect()
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
    if (parent === root || /(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
    if (parent === root || /(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom) }
    if (parent === root) break
  }
  const base = root.getBoundingClientRect()
  return right - left > 2 && bottom - top > 2 ? { x: left - base.left, y: top - base.top, width: right - left, height: bottom - top } : null
}

function actionText(React, text) {
  return t(text).split(/(「[^」]+」)/g).map((part, index) => part.startsWith('「')
    ? React.createElement('strong', { key: index }, part) : part)
}

export function createQuickStart(React) {
  const e = React.createElement
  let welcomeOpened = false

  function Welcome({ info, onStart, onExample, onClose }) {
    const ref = React.useRef(null)
    const [busy, setBusy] = React.useState(''), [error, setError] = React.useState('')
    const busyRef = React.useRef(false)
    React.useEffect(() => {
      const dialog = ref.current, previous = document.activeElement
      const cancel = event => { event.preventDefault(); if (!busyRef.current) onClose() }
      dialog.addEventListener('cancel', cancel); dialog.showModal()
      return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); if (previous?.isConnected) previous.focus() }
    }, [])
    async function start(task, action) {
      if (busyRef.current) return
      busyRef.current = true; setBusy(action); setError('')
      try { await task() } catch (reason) { setError(reason?.message || String(reason)); busyRef.current = false; setBusy('') }
    }
    return e('dialog', { ref, className: 'qxsim-modal qxsim-quick-welcome', 'aria-label': t('快速上手'), 'aria-modal': true },
      e('h2', null, t('把一个游戏带进千星沙箱')), e('p', null, t('假设 AI 已经做好了游戏。接下来亲手试玩、导出、导入千星沙箱，校准索引并更新一次脚本。')),
      info?.open ? e('div', { className: 'qxsim-quick-example' }, t('下载在线示例存档开始，不会覆盖你的工程。')) : null,
      error ? e('div', { className: 'qxsim-quick-error', role: 'alert' }, t(error)) : null,
      e('footer', null,
        info?.open ? e('button', { className: 'qxsim-action primary', disabled: Boolean(busy), 'aria-busy': busy === 'example' || undefined, onClick: () => void start(onExample, 'example') }, busy === 'example' ? t('正在打开…') : error ? t('重试打开示例') : t('下载示例，开始实操')) : null,
        e('button', { className: `qxsim-action${info?.open ? '' : ' primary'}`, disabled: Boolean(busy), 'aria-busy': busy === 'current' || undefined, onClick: () => void start(onStart, 'current') }, busy === 'current' ? t('正在打开…') : t('用当前存档继续')),
        e('button', { className: 'qxsim-quick-link', disabled: Boolean(busy), onClick: onClose }, t('稍后再看'))))
  }

  function Coach({ step, index, page, selection, error, busy, goTo, collapse, back, example, locate }) {
    const layerRef = React.useRef(null), cardRef = React.useRef(null)
    const [layout, setLayout] = React.useState(null)
    const stage = STAGES[step?.stageIndex]
    React.useLayoutEffect(() => {
      const root = layerRef.current.closest('[data-qxsim-session-id]'), card = cardRef.current
      let frame, watched
      const resize = new ResizeObserver(entries => {
        if (watched && entries.some(entry => entry.target === root)) watched.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        schedule()
      })
      function measure() {
        const target = step?.target && (root.querySelector(`[data-quick-start-target="${step.target}"]`) || root.querySelector(`[data-quick-start-target="${step.fallback}"]`))
        if (target !== watched) { if (watched) resize.unobserve(watched); if (target) resize.observe(target); watched = target }
        const r = visibleRect(target, root), w = root.clientWidth, h = root.clientHeight
        const body = card.querySelector('.qxsim-quick-body')
        const cw = card.offsetWidth, ch = card.offsetHeight + Math.max(0, (body?.scrollHeight || 0) - (body?.clientHeight || 0)), gap = 14
        const bottom = h - (root.querySelector('.qxsim-footer')?.offsetHeight || 24) - 10
        const rootTop = root.getBoundingClientRect().top
        const navBottom = (root.querySelector('.qxsim-editor-nav')?.getBoundingClientRect().bottom ?? rootTop) - rootTop
        const externalTop = clamp(navBottom + 16, 12, Math.max(12, bottom - 120))
        let cardMaxHeight = step?.external ? bottom - externalTop : h - 56
        const fit = p => ({ ...p, x: clamp(p.x, 12, Math.max(12, w - cw - 12)), y: clamp(p.y, 12, Math.max(12, bottom - ch)) })
        let position = step?.external ? { x: Math.max(12, (w - cw) / 2), y: externalTop, side: '' }
          : fit({ x: w - cw - 18, y: bottom - ch, side: '' })
        if (r) {
          const cx = r.x + r.width / 2, cy = r.y + r.height / 2
          const choices = [
            { x: r.x + r.width + gap, y: cy - ch / 2, side: 'right', cardMaxHeight: h - 56 },
            { x: r.x - cw - gap, y: cy - ch / 2, side: 'left', cardMaxHeight: h - 56 },
            { x: cx - cw / 2, y: r.y + r.height + gap, side: 'bottom', cardMaxHeight: bottom - r.y - r.height - gap },
            { x: cx - cw / 2, side: 'top', cardMaxHeight: r.y - gap - 12 },
          ].filter(p => p.cardMaxHeight >= Math.min(180, h - 56)).map(p => {
            const height = Math.min(ch, p.cardMaxHeight)
            const desiredY = p.side === 'top' ? r.y - height - gap : p.y
            const f = { ...p, x: clamp(p.x, 12, Math.max(12, w - cw - 12)), y: clamp(desiredY, 12, Math.max(12, bottom - height)), height }
            const overlap = Math.max(0, Math.min(f.x + cw, r.x + r.width) - Math.max(f.x, r.x)) * Math.max(0, Math.min(f.y + height, r.y + r.height) - Math.max(f.y, r.y))
            return { ...f, score: overlap * 1000 + (ch - height) * 10 + Math.abs(f.x - p.x) + Math.abs(f.y - desiredY) }
          })
          position = choices.sort((a, b) => a.score - b.score)[0] || position
          cardMaxHeight = position.cardMaxHeight ?? cardMaxHeight
          const { x, y, side } = position
          position.arrow = side === 'left' || side === 'right'
            ? { top: clamp(cy - y - 4, 14, (position.height || ch) - 22), [side === 'right' ? 'left' : 'right']: -5, transform: `rotate(${side === 'right' ? -45 : 135}deg)` }
            : { left: clamp(cx - x - 4, 14, cw - 22), [side === 'bottom' ? 'top' : 'bottom']: -5, transform: `rotate(${side === 'bottom' ? 45 : 225}deg)` }
        }
        const next = { r, w, h, cardMaxHeight, ...position }
        setLayout(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
      }
      function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
      resize.observe(root); resize.observe(card)
      const mutations = new MutationObserver(schedule)
      mutations.observe(root, { childList: true, subtree: true })
      root.addEventListener('scroll', schedule, true); root.addEventListener('toggle', schedule, true)
      window.addEventListener('resize', schedule)
      measure()
      return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); root.removeEventListener('scroll', schedule, true); root.removeEventListener('toggle', schedule, true); window.removeEventListener('resize', schedule) }
    }, [step, page, selection])
    const r = step ? layout?.r : null
    const hole = r ? `M${r.x},${r.y}h${r.width}v${r.height}h${-r.width}Z` : ''
    const nextLabel = t(step ? step.next || (index === STEPS.length - 1 ? '完成导览' : '下一步 →') : '开始创作')
    return e('div', { className: 'qxsim-quick-layer', ref: layerRef },
      step?.external && layout ? e('svg', { className: 'qxsim-quick-shade', 'aria-hidden': true, style: { fill: '#07131c22' } }, e('rect', { width: '100%', height: '100%' })) : null,
      r ? e(React.Fragment, null,
        e('svg', { className: 'qxsim-quick-shade', 'aria-hidden': true }, e('path', { fillRule: 'evenodd', d: `M0,0H${layout.w}V${layout.h}H0Z${hole}` })),
        e('div', { className: 'qxsim-quick-spot', 'data-quick-highlight': step.target, 'aria-hidden': true, style: { left: r.x, top: r.y, width: r.width, height: r.height } })) : null,
      r ? e('div', { style: { position: 'absolute', left: layout.x, top: layout.y, width: cardRef.current?.offsetWidth, height: cardRef.current?.offsetHeight } }, e('i', { className: 'qxsim-quick-arrow', style: layout.arrow, 'aria-hidden': true })) : null,
      e('section', { ref: cardRef, className: `qxsim-quick-guide${step?.external ? ' external' : ''}`, 'aria-label': t('快速上手导览'), 'data-quick-stage': stage?.id, 'data-quick-step': step?.id || 'complete', style: { left: layout?.x ?? 12, top: layout?.y ?? 12, visibility: layout ? 'visible' : 'hidden', maxHeight: layout?.cardMaxHeight ?? 'calc(100% - 56px)', overflowY: 'auto' }, onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); collapse() } } },
        e('div', { className: 'qxsim-quick-top' },
          e('select', { 'aria-label': t('导览阶段'), value: step?.stageIndex ?? STAGES.length, disabled: busy, onChange: event => goTo(STEPS.findIndex(row => row.stageIndex === Number(event.target.value))) },
            ...STAGES.map((row, i) => e('option', { key: row.id, value: i }, `${i + 1} / ${STAGES.length} · ${t(row.label)}`)),
            !step ? e('option', { value: STAGES.length, disabled: true }, t('完成导览')) : null),
          e('button', { className: 'qxsim-quick-link', title: t('收起引导'), 'aria-label': t('收起引导'), disabled: busy, onClick: collapse }, '×')),
        step ? e('div', { className: 'qxsim-quick-progress' }, e('span', null, t(step.label)), e('span', null, `${step.stageStep + 1} / ${stage.steps.length}`)) : null,
        e('div', { key: step?.id || 'complete', className: 'qxsim-quick-body', 'aria-live': 'polite' },
          step?.external ? e('div', { className: 'qxsim-quick-context' }, t('现在切换到千星沙箱操作')) : null,
          e('h2', null, t(step?.title || '继续和 AI 制作你的奇域')),
          e('p', null, t(step?.why || '有模拟器问题都可以直接问你的 AI。')),
          step?.actions ? e('ol', { className: 'qxsim-quick-tasks', 'aria-label': t('请按顺序操作') }, step.actions.map((line, i) => e('li', { key: i }, actionText(React, line)))) : null,
          step?.details ? e('details', null, e('summary', null, t(step.detailsTitle || '游戏里还要做什么？')), e('ol', null, step.details.map(line => e('li', { key: line }, t(line))))) : null),
        step?.target && !r ? e('button', { className: 'qxsim-quick-link', onClick: locate, disabled: busy }, t('定位到这里')) : null,
        step ? e('div', { className: 'qxsim-quick-continue' },
          t('完成以上操作后，点击下方「{0}」继续。', nextLabel),
          e('p', { className: 'qxsim-quick-manual' }, t(step.external ? '此按钮只推进引导，不会替你操作千星沙箱。' : '请先操作页面上的控件；下方按钮只推进引导。'))) : null,
        e('div', { className: 'qxsim-quick-controls' },
          e('button', { className: 'qxsim-action qxsim-quick-previous', disabled: busy || index === 0, onClick: () => goTo(index - 1) }, t('← 上一步')),
          e('button', { className: 'qxsim-action primary', disabled: busy, 'aria-busy': busy || undefined, 'data-quick-next': '', onClick: () => step ? goTo(index + 1) : collapse() }, nextLabel)),
        back ? e('button', { className: 'qxsim-quick-link qxsim-quick-back', disabled: busy, onClick: back }, t('返回原工程')) : null,
        example ? e('button', { className: 'qxsim-quick-link qxsim-quick-back', disabled: busy, onClick: example }, t('打开示例存档')) : null,
        error ? e('div', { className: 'qxsim-quick-error', role: 'alert' }, t(error)) : null))
  }

  return function useQuickStart({ sessionId, info, snap, page, locate, prepare, suspended }) {
    const [welcome, setWelcome] = React.useState(() => {
      if (!info?.autoOpen || welcomeOpened || readProgress(sessionId).active) return false
      welcomeOpened = true; return true
    })
    const [progress, setProgress] = React.useState(() => readProgress(sessionId))
    const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
    const restored = React.useRef(false), busyRef = React.useRef(false)
    const active = Boolean(snap?.quickStart) || progress.active
    const showWelcome = welcome && !snap?.quickStart
    const step = STEPS[progress.step]
    function update(change) {
      setProgress(previous => {
        const next = change(previous)
        try { localStorage.setItem(quickStartStorageKey(sessionId), JSON.stringify(next)) } catch { /* Optional local progress. */ }
        return next
      })
    }
    React.useEffect(() => { restored.current = false; setProgress(readProgress(sessionId)) }, [sessionId])
    React.useEffect(() => {
      if (!snap || restored.current) return
      restored.current = true
      if (active && !progress.collapsed && step) void run(() => locate(step))
    }, [Boolean(snap), sessionId])
    async function run(task) {
      if (busyRef.current) return
      busyRef.current = true; setBusy(true); setError('')
      try { await task() } catch (reason) { setError(reason?.message || String(reason)) }
      finally { busyRef.current = false; setBusy(false) }
    }
    async function goTo(index) {
      if (STEPS[index]) await locate(STEPS[index])
      else await prepare()
      update(p => ({ ...p, active: true, step: index, collapsed: false }))
    }
    const collapse = () => update(p => ({ ...p, active: true, collapsed: true }))
    return {
      guide: active && !showWelcome && !progress.collapsed && !suspended ? e(Coach, { key: progress.step, step, index: progress.step, page, selection: snap?.selectedId, error, busy, collapse,
        goTo: index => void run(() => goTo(index)), locate: () => void run(() => locate(step)),
        back: snap?.quickStart && info?.back ? () => void run(async () => { await prepare(); await info.back(snap.quickStart.originalId) }) : null,
        example: !snap?.quickStart && info?.open ? () => setWelcome(true) : null }) : null,
      active: active && !progress.collapsed,
      open: () => active ? void run(() => goTo(progress.step)) : setWelcome(true),
      dialog: showWelcome ? e(Welcome, { info, onClose: () => setWelcome(false),
        onStart: async () => { await goTo(0); setWelcome(false) },
        onExample: async () => { await prepare(); await info.open(sessionId) } }) : null,
      savePath: snap?.quickStart?.savePath,
    }
  }
}
