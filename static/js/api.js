export const API_BASE = ''

export const SERVER_HINT_HTML = '<br><span style="opacity:0.7;font-size:11px">Server-nya nyalakan dulu di terminal \u{1F60D}</span>'
export const SERVER_HINT_TEXT = '\nServer-nya nyalakan dulu di terminal \u{1F60D}'

export const esc = (s) => s ? s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : ''

export const api = {
  async request(url, options = {}) {
    try {
      const res = await fetch(API_BASE + url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers }
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
  py: { icon: '\u{1F40D}', cls: 'py' },
  js: { icon: '\u26A1', cls: 'js' },
  ts: { icon: '\u{1F537}', cls: 'js' },
  html: { icon: '\u{1F310}', cls: 'html' },
  htm: { icon: '\u{1F310}', cls: 'html' },
  css: { icon: '\u{1F3A8}', cls: 'css' },
  json: { icon: '\u{1F4CB}', cls: 'json' },
  md: { icon: '\u{1F4DD}', cls: 'md' },
  txt: { icon: '\u{1F4C4}', cls: 'default' },
  sh: { icon: '\u2699', cls: 'sh' },
  yaml: { icon: '\u2699', cls: 'sh' },
  yml: { icon: '\u2699', cls: 'sh' },
  toml: { icon: '\u2699', cls: 'sh' },
  cfg: { icon: '\u2699', cls: 'sh' },
  log: { icon: '\u{1F4CB}', cls: 'default' },
  zip: { icon: '\u{1F4E6}', cls: 'default' },
  png: { icon: '\u{1F5BC}', cls: 'default' },
  jpg: { icon: '\u{1F5BC}', cls: 'default' },
  gitignore: { icon: '\u{1F500}', cls: 'default' }
}

export function getFileIcon(name, isDir) {
  if (isDir) return { icon: '\u{1F4C1}', cls: 'dir' }
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const noExt = name.startsWith('.') ? name.slice(1) : null
  return FILE_ICONS[noExt || ext] || FILE_ICONS[ext] || { icon: '\u{1F4C4}', cls: 'default' }
}