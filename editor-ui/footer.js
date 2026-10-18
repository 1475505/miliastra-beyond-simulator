import { t, createUseLocale } from '../studio/i18n.js'

const repository = 'https://github.com/1475505/miliastra-beyond-simulator'

export function createFooter(React) {
  const e = React.createElement
  const useLocale = createUseLocale(React)
  function Dialog({ title, children, onClose }) {
    const ref = React.useRef(null)
    React.useEffect(() => {
      const previous = document.activeElement
      ref.current.showModal()
      return () => { ref.current?.close(); previous?.focus?.() }
    }, [])
    return e('dialog', { ref, className: 'qxsim-modal', 'aria-label': title,
      onCancel: event => { event.preventDefault(); onClose() } },
    e('h2', null, title), children,
    e('footer', null, e('button', { className: 'qxsim-action', onClick: onClose }, t('关闭'))))
  }
  return function Footer({ request, version }) {
    useLocale()
    const [dialog, setDialog] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [result, setResult] = React.useState(null)
    const [error, setError] = React.useState('')
    async function check() {
      setDialog('updates'); setBusy(true); setError(''); setResult(null)
      try { setResult(await request('updates')) }
      catch (reason) { setError(/^unknown (?:editor )?action\b/i.test(reason?.message || '')
        ? '当前后台尚未加载检查更新功能，请重启 Web 或 Harness 宿主后重试。'
        : '检查更新失败，请检查网络连接后重试。') }
      finally { setBusy(false) }
    }
    const messages = { available: t('发现新版本'), current: t('当前已是最新版本'), ahead: t('当前版本比公开版本更新'), unavailable: t('暂未找到此安装包的正式版本') }
    return e(React.Fragment, null,
      e('footer', { className: 'qxsim-footer' },
        version ? e('span', { className: 'qxsim-muted' }, `v${version}`) : null,
        e('span', { className: 'spacer' }),
        e('button', { onClick: check, disabled: busy }, busy ? t('正在检查更新…') : t('检查更新')),
        e('a', { href: 'https://space.bilibili.com/23358791', target: '_blank', rel: 'noreferrer' }, t('作者B站')),
        e('button', { onClick: () => setDialog('contact') }, t('联系作者'))),
      dialog === 'contact' ? e(Dialog, { title: t('联系作者'), onClose: () => setDialog('') },
        e('div', null,
          e('p', null, t('QQ群号1007538100')),
          e('p', null, t('作者邮箱 '), e('a', { href: 'mailto:725230880@qq.com' }, '725230880@qq.com')),
          e('p', null, t('开源仓库 '), e('a', { href: repository, target: '_blank', rel: 'noreferrer' }, repository)))) : null,
      dialog === 'updates' ? e(Dialog, { title: t('检查更新'), onClose: () => setDialog('') },
        e('div', { role: 'status' },
          busy ? e('p', null, t('正在检查更新…')) : null,
          error ? e('p', { role: 'alert' }, t(error)) : null,
          !busy && !error && result ? e(React.Fragment, null,
            e('p', null, t(messages[result.status])),
            e('p', null, t`当前版本：${result.currentVersion}`),
            result.latestVersion ? e('p', null, t`公开版本：${result.latestVersion}`) : null,
            e('p', null, t('更新后请重启宿主并刷新编辑器与试玩页。')),
            e('a', { href: result.url, target: '_blank', rel: 'noreferrer' }, t('查看更新说明')),
            result.status === 'available' && result.downloadUrl ? e('p', null, e('a', { href: result.downloadUrl, target: '_blank', rel: 'noreferrer' }, t('下载更新包'))) : null) : null,
          error ? e(React.Fragment, null,
            e('button', { className: 'qxsim-action', onClick: check, disabled: busy }, t('重试')),
            e('p', null, e('a', { href: repository + '/releases', target: '_blank', rel: 'noreferrer' }, t('查看更新说明')))) : null)) : null)
  }
}
