export const API_BASE = ''

export const SERVER_HINT_HTML = '<br><span style="opacity:0.7;font-size:11px">Server-nya nyalakan dulu di terminal ðŸ˜</span>'
export const SERVER_HINT_TEXT = '\nServer-nya nyalakan dulu di terminal ðŸ˜'

export const esc = (s) => s ? s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : ''

// FIX Bug #3: Only send Content-Type header for requests with a body (POST/PUT)
export const api = {
  async request(url, options = {}) {
    try {
      const headers = {}
      // Only set Content-Type for requests that have a body
      if (options.body) {
        headers['Content-Type'] = 'application/json'
      }
      const res = await fetch(API_BASE + url, {
        ...options,
        headers: { ...headers, ...options.headers }
      })
      return { ok: res.ok, status: res.status, data: await res.json() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  },
  get: (url) => api.request(url),
  post: (url, body) => api.request(url, { method: 'POST', body: JSON.stringify(body) })
}

// ANSI COLOR PARSER
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
  return text.replace(/\x1b\[([0-9;]*)m/g, (match, codes) => {
    return '</span>' + (codes ? `<span class="${codes.split(';').map(c => ANSI_CODES[c] || '').filter(Boolean).join(' ')}">` : '')
  })
}

// FILE TYPE ICONS
const FILE_ICONS = {
  py: { icon: 'ðŸ', cls: 'py' },
  js: { icon: 'âš¡', cls: 'js' },
  ts: { icon: 'ðŸ”·', cls: 'js' },
  html: { icon: 'ðŸŒ', cls: 'html' },
  htm: { icon: 'ðŸŒ', cls: 'html' },
  css: { icon: 'ðŸŽ¨', cls: 'css' },
  json: { icon: 'ðŸ“‹', cls: 'json' },
  md: { icon: 'ðŸ“', cls: 'md' },
  txt: { icon: 'ðŸ“„', cls: 'default' },
  sh: { icon: 'âš™ï¸', cls: 'sh' },
  yaml: { icon: 'âš™ï¸', cls: 'sh' },
  yml: { icon: 'âš™ï¸', cls: 'sh' },
  toml: { icon: 'âš™ï¸', cls: 'sh' },
  cfg: { icon: 'âš™ï¸', cls: 'sh' },
  log: { icon: 'ðŸ“‹', cls: 'default' },
  zip: { icon: 'ðŸ“¦', cls: 'default' },
  png: { icon: 'ðŸ–¼ï¸', cls: 'default' },
  jpg: { icon: 'ðŸ–¼ï¸', cls: 'default' },
  gitignore: { icon: 'ðŸ”€', cls: 'default' }
}

export function getFileIcon(name, isDir) {
  if (isDir) return { icon: 'ðŸ“', cls: 'dir' }
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const noExt = name.startsWith('.') ? name.slice(1) : null
  return FILE_ICONS[noExt || ext] || FILE_ICONS[ext] || { icon: 'ðŸ“„', cls: 'default' }
}
