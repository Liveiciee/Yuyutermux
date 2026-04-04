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

export function getFileIcon(name, isDir) {
  if (isDir) return { cls: 'dir', icon: '\u{1F4C1}' }
  const ext = (name || '').split('.').pop()?.toLowerCase() || ''
  const map = {
    py: { cls: 'py', icon: '\u{1F40D}' },
    js: { cls: 'js', icon: '\u{1F4DC}' },
    ts: { cls: 'ts', icon: '\u{1F539}' },
    json: { cls: 'json', icon: '\u{1F4CB}' },
    md: { cls: 'md', icon: '\u{1F4DD}' },
    html: { cls: 'html', icon: '\u{1F310}' },
    css: { cls: 'css', icon: '\u{1F3A8}' },
    sh: { cls: 'sh', icon: '\u26A1' },
    yml: { cls: 'yml', icon: '\u2699' },
    yaml: { cls: 'yaml', icon: '\u2699' },
    txt: { cls: 'txt', icon: '\u{1F4C4}' },
    lock: { cls: 'lock', icon: '\u{1F512}' },
  }
  return map[ext] || { cls: 'file', icon: '\u{1F4C4}' }
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
  return match ? match[1] : null
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
      await fetch('/api/execute/kill', {
        method: 'POST',
        signal: controller.signal,
        credentials: 'same-origin'
      }).catch(() => {})
      clearTimeout(timeout)

      const logoutController = new AbortController()
      const logoutTimeout = setTimeout(() => logoutController.abort(), 3000)

      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: logoutController.signal,
        credentials: 'same-origin'
      }).catch(() => {})

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
        headers,
        credentials: 'same-origin'
      })

      clearTimeout(timeoutId)

      if (res.status === 401) {
        setTimeout(() => { window.location.href = '/login' }, 100)
        return { ok: false, status: 401, data: { success: false, error: 'Unauthorized' }, needsAuth: true }
      }

      const contentType = res.headers.get('content-type') || ''
      let data

      if (contentType.includes('application/json')) {
        try {
          data = await res.json()
        } catch (e) {
          data = { success: false, error: 'Invalid JSON response' }
        }
      } else {
        const text = await res.text()
        data = { success: false, error: `Unexpected format: ${contentType || 'unknown'}` }
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
          console.error('HTML response:', text.substring(0, 200))
        }
      }

      return { ok: res.ok, status: res.status, data }

    } catch (err) {
      clearTimeout(timeoutId)

      if (err.name === 'AbortError') {
        return { ok: false, status: 408, data: { success: false, error: 'Request timeout' }, timedOut: true }
      }

      return { ok: false, status: 0, data: { success: false, error: err.message || 'Network error' }, networkError: true }
    }
  },

  get: (url, options = {}) => api.request(url, { ...options, method: 'GET' }),
  post: (url, body, options = {}) => api.request(url, { ...options, method: 'POST', body: JSON.stringify(body) })
}
