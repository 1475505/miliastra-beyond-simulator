export const REPOSITORY_URL = 'https://github.com/1475505/miliastra-beyond-simulator'
const releasesApi = 'https://api.github.com/repos/1475505/miliastra-beyond-simulator/releases?per_page=100'
const stable = value => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
const compare = (a, b) => {
  const left = a.split(/[.-]/).slice(0, 3).map(Number), right = b.split(/[.-]/).slice(0, 3).map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i])
  return b.includes('-') && !a.includes('-') ? 1 : a.includes('-') && !b.includes('-') ? -1 : 0
}

function repositoryLink(value, kind) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === 'https://github.com'
      && url.pathname.startsWith(`/1475505/miliastra-beyond-simulator/releases/${kind}/`) ? url.href : null
  } catch { return null }
}

export function releaseForPackage(releases, packageName) {
  if (!Array.isArray(releases)) throw new Error('Invalid release response')
  const candidates = []
  for (const release of releases) {
    if (release.draft || release.prerelease || !Array.isArray(release.assets)) continue
    for (const asset of release.assets) {
      if (typeof asset.name !== 'string' || !asset.name.startsWith(packageName + '-') || !asset.name.endsWith('.tgz')) continue
      const version = asset.name.slice(packageName.length + 1, -4)
      const url = repositoryLink(release.html_url, 'tag')
      const downloadUrl = repositoryLink(asset.browser_download_url, 'download')
      if (!stable(version) || !url || !downloadUrl) continue
      candidates.push({ version, url, downloadUrl, publishedAt: release.published_at || null })
    }
  }
  return candidates.sort((a, b) => compare(b.version, a.version))[0] || null
}

// This only checks metadata. Installation remains an explicit user action.
export function createUpdateChecker({ packageName, currentVersion, fetch: fetcher = globalThis.fetch, now = Date.now }) {
  let cached = null, pending = null
  return async function checkUpdates() {
    if (cached && now() - cached.checkedAt < 5 * 60_000) return cached
    if (pending) return pending
    pending = (async () => {
      const response = await fetcher(releasesApi, { headers: { accept: 'application/vnd.github+json',
        'user-agent': 'beyond-simulator-update-check', 'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status})`)
      const release = releaseForPackage(await response.json(), packageName)
      const order = release ? compare(release.version, currentVersion) : 0
      cached = { packageName, currentVersion, latestVersion: release?.version || null,
        status: !release ? 'unavailable' : order > 0 ? 'available' : order < 0 ? 'ahead' : 'current',
        url: release?.url || `${REPOSITORY_URL}/releases`, downloadUrl: release?.downloadUrl || null,
        checkedAt: now(), publishedAt: release?.publishedAt || null }
      return cached
    })().finally(() => { pending = null })
    return pending
  }
}
