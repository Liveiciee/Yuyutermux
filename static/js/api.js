export const API_BASE = ''

export const SERVER_HINT_HTML = '<br><span style="opacity:0.7;font-size:11px">Server-nya nyalakan dulu di terminal &#x1F60D;</span>'
export const SERVER_HINT_TEXT = '\nServer-nya nyalakan dulu di terminal \u{1F60D}'

export const esc = (s) => {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', 
    '"': '&quot;', "'": '&#39;'
  }[c]))
}

// ========== AUTH MODULE (Steroid Edition) ==========
const tokenCache = new Map()
const pendingPromises = new Map()

const POSITIVE_CACHE_TTL = 5 * 60 * 1000
const NEGATIVE_CACHE_TTL = 5 * 60 * 1000
const MAX_CACHE_SIZE = 1000
const NETWORK_TIMEOUT_MS = 5000
const STUCK_PROMISE_THRESHOLD_MS = 15000
const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000

let cleanupInterval = null

function startCacheCleanup() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [token, { isPositive, timestamp }] of tokenCache) {
      const ttl = isPositive ? POSITIVE_CACHE_TTL : NEGATIVE_CACHE_TTL
      if (now - timestamp >= ttl) tokenCache.delete(token)
    }
    while (tokenCache.size >= MAX_CACHE_SIZE) {
      tokenCache.delete(tokenCache.keys().next().value)
    }
  }, CACHE_CLEANUP_INTERVAL_MS)
}

function stopCacheCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
}

function getCookieValue(name) {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[2] : null
}

function isRetryableError(err, status) {
  if (status >= 500) return true
  if (status === 408) return true
  if (status >= 400 && status < 500) return false
  if (err.name === 'AbortError') return true
  if (err instanceof TypeError) return true
  return false
}

async function fetchWithRetry(token, externalSignal, maxAttempts = 2) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (externalSignal?.aborted) throw new Error('AbortError')

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    externalSignal?.addEventListener('abort', onAbort, { once: true })

    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
    try {
      const response = await fetch('/api/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
        signal: controller.signal,
        credentials: 'same-origin'
      })
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onAbort)

      if (response.status === 401 || response.status === 403) return false
      if (!response.ok) throw new Error(`HTTP_${response.status}`)

      const data = await response.json()
      if (typeof data.valid !== 'boolean') {
        console.warn('[AUTH] Invalid API response: valid field not boolean')
        return false
      }
      return data.valid
    } catch (err) {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', onAbort)
      lastError = err

      const statusMatch = err.message?.match(/HTTP_(\d+)/)
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0

      if (!isRetryableError(err, statusCode)) {
        if (statusCode === 400 || statusCode === 401 || statusCode === 403) return false
        break
      }

      if (attempt < maxAttempts) {
        const random = crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF
        const delay = Math.min(100 * Math.pow(2, attempt) + random * 100, 1000)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  console.error('[AUTH] Verification failed', lastError?.message)
  return false
}

async function isAuthenticatedInternal() {
  const token = getCookieValue('yuyu_token')?.trim()
  if (!token || token.length === 0 || token.length > 2048) return false

  const now = Date.now()
  const cached = tokenCache.get(token)
  if (cached) {
    const ttl = cached.isPositive ? POSITIVE_CACHE_TTL : NEGATIVE_CACHE_TTL
    if (now - cached.timestamp < ttl) return cached.valid
    tokenCache.delete(token)
  }

  const existing = pendingPromises.get(token)
  if (existing) return existing

  const controller = new AbortController()
  const promise = (async () => {
    const watchdog = setTimeout(() => {
      if (pendingPromises.has(token)) {
        controller.abort()
        pendingPromises.delete(token)
      }
    }, STUCK_PROMISE_THRESHOLD_MS)

    let isValid = false
    try {
      isValid = await fetchWithRetry(token, controller.signal)
    } catch {
      isValid = false
    }
    clearTimeout(watchdog)
    tokenCache.delete(token)
    tokenCache.set(token, {
      valid: isValid,
      timestamp: Date.now(),
      isPositive: isValid === true
    })
    pendingPromises.delete(token)
    return isValid
  })()

  pendingPromises.set(token, promise)
  return promise
}

startCacheCleanup()

export const Auth = {
  getToken() {
    return getCookieValue('yuyu_token') || ''
  },
  getHeaders() {
    const token = this.getToken()
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  },
  async isAuthenticated() {
    return await isAuthenticatedInternal()
  },
  async logout() {
    tokenCache.clear()
    pendingPromises.clear()
    stopCacheCleanup()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      await fetch('/api/execute/kill', { method: 'POST', signal: controller.signal }).catch(() => {})
      clearTimeout(timeout)
      const logoutController = new AbortController()
      const logoutTimeout = setTimeout(() => logoutController.abort(), 3000)
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: logoutController.signal }).catch(() => {})
      clearTimeout(logoutTimeout)
    } finally {
      window.location.href = '/login'
    }
  },
  stopCacheCleanup
}

export const api = {
  async request(url, options = {}) {
    const controller = new AbortController()
    const timeout = options.timeout || 30000
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    try {
      const authHeaders = Auth.getHeaders()
      const headers = { ...authHeaders, ...options.headers }
      if (options.body && !options.headers?.['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
      const res = await fetch(API_BASE + url, {
        ...options,
        signal: controller.signal,
        headers
      })
      clearTimeout(timeoutId)
      if (res.status === 401) {
        setTimeout(() => { window.location.href = '/login' }, 100)
        return { ok: false, status: 401, data: { success: false, error: 'Unauthorized' }, needsAuth: true }
      }
      const contentType = res.headers.get('content-type') || ''
      let data
      if (contentType.includes('application/json')) {
        try { data = await res.json() } catch (e) { data = { success: false, error: 'Invalid JSON response' } }
      } else {
        const text = await res.text()
        data = { success: false, error: `Unexpected format: ${contentType || 'unknown'}` }
        if (text.includes('<!DOCTYPE') || text.includes('<html')) console.error('HTML response:', text.substring(0, 200))
      }
      return { ok: res.ok, status: res.status, data }
    } catch (err) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') return { ok: false, status: 408, data: { success: false, error: 'Request timeout' }, timedOut: true }
      return { ok: false, status: 0, data: { success: false, error: err.message || 'Network error' }, networkError: true }
    }
  },
  get: (url, options = {}) => api.request(url, { ...options, method: 'GET' }),
  post: (url, body, options = {}) => api.request(url, { ...options, method: 'POST', body: JSON.stringify(body) })
}

const ANSI_CODES = {
  '0': '', '1': 'ansi-bold', '2': 'ansi-dim', '3': 'ansi-italic',
  '4': 'ansi-underline', '30': 'ansi-black', '31': 'ansi-red',
  '32': 'ansi-green', '33': 'ansi-yellow', '34': 'ansi-blue',
  '35': 'ansi-magenta', '36': 'ansi-cyan', '37': 'ansi-white',
  '90': 'ansi-black', '91': 'ansi-red', '92': 'ansi-green',
  '93': 'ansi-yellow', '94': 'ansi-blue', '95': 'ansi-magenta',
  '96': 'ansi-cyan', '97': 'ansi-white'
}

export function parseAnsi(text) {
  if (!text) return ''
  let classes = []
  let result = ''
  let i = 0
  const len = text.length
  let spanOpen = false
  while (i < len) {
    if (text[i] === '\x1b' && i+1 < len && text[i+1] === '[') {
      const end = text.indexOf('m', i+2)
      if (end === -1) { result += esc(text.slice(i)); break }
      const codes = text.slice(i+2, end).split(';')
      for (const code of codes) {
        if (code === '0') {
          classes = []
        } else if (ANSI_CODES[code]) {
          const cls = ANSI_CODES[code]
          if (!classes.includes(cls)) classes.push(cls)
        }
      }
      i = end + 1
      if (spanOpen) result += '</span>'
      if (classes.length) {
        result += `<span class="${esc(classes.join(' '))}">`
        spanOpen = true
      } else {
        spanOpen = false
      }
    } else {
      let start = i
      while (i < len && !(text[i] === '\x1b' && i+1 < len && text[i+1] === '[')) i++
      result += esc(text.slice(start, i))
    }
  }
  if (spanOpen) result += '</span>'
  return result
}

const FILE_ICONS = {
  py: { icon: '\u{1F40D}', cls: 'py' }, js: { icon: '\u26A1', cls: 'js' },
  ts: { icon: '\u{1F537}', cls: 'js' }, html: { icon: '\u{1F310}', cls: 'html' },
  htm: { icon: '\u{1F310}', cls: 'html' }, css: { icon: '\u{1F3A8}', cls: 'css' },
  json: { icon: '\u{1F4CB}', cls: 'json' }, md: { icon: '\u{1F4DD}', cls: 'md' },
  txt: { icon: '\u{1F4C4}', cls: 'default' }, sh: { icon: '\u2699', cls: 'sh' },
  yaml: { icon: '\u2699', cls: 'sh' }, yml: { icon: '\u2699', cls: 'sh' },
  toml: { icon: '\u2699', cls: 'sh' }, cfg: { icon: '\u2699', cls: 'sh' },
  log: { icon: '\u{1F4CB}', cls: 'default' }, zip: { icon: '\u{1F4E6}', cls: 'default' },
  png: { icon: '\u{1F5BC}', cls: 'default' }, jpg: { icon: '\u{1F5BC}', cls: 'default' },
  gif: { icon: '\u{1F5BC}', cls: 'default' }, svg: { icon: '\u{1F5BC}', cls: 'default' },
  gitignore: { icon: '\u{1F500}', cls: 'default' }, env: { icon: '\u2696', cls: 'sh' },
  dockerfile: { icon: '\u{1F433}', cls: 'sh' }, makefile: { icon: '\u2699', cls: 'sh' },
  rs: { icon: '\u{1F980}', cls: 'rs' }, go: { icon: '\u{1F425}', cls: 'go' },
  java: { icon: '\u2615', cls: 'java' }, cpp: { icon: '\u{1F579}', cls: 'cpp' },
  c: { icon: '\u{1F579}', cls: 'cpp' }, h: { icon: '\u{1F4C3}', cls: 'cpp' },
  hpp: { icon: '\u{1F4C3}', cls: 'cpp' }, readme: { icon: '\u{1F4DD}', cls: 'md' }
}

export function getFileIcon(name, isDir) {
  if (isDir) return { icon: '\u{1F4C1}', cls: 'dir' }
  const lower = name.toLowerCase()
  if (FILE_ICONS[lower]) return FILE_ICONS[lower]
  if (name.startsWith('.')) {
    const noDot = name.slice(1).toLowerCase()
    if (FILE_ICONS[noDot]) return FILE_ICONS[noDot]
  }
  const parts = name.split('.')
  if (parts.length > 1) {
    const ext = parts.pop().toLowerCase()
    if (FILE_ICONS[ext]) return FILE_ICONS[ext]
    if (parts.length > 1) {
      const double = parts.pop().toLowerCase() + '.' + ext
      if (FILE_ICONS[double]) return FILE_ICONS[double]
    }
  }
  return { icon: '\u{1F4C4}', cls: 'default' }
}