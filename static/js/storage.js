import { bindEntryActions } from './terminal.js'

export const Storage = {
  KEY: 'yuyu_terminal_history',
  VERSION_KEY: 'yuyu_storage_version',
  CURRENT_VERSION: 2,

  save() {
    const area = document.getElementById('outputArea')
    if (!area) return
    const entries = area.querySelectorAll('.output-entry')
    if (entries.length === 0) return
    const html = Array.from(entries).slice(-30).map(e => e.outerHTML).join('')
    try {
      localStorage.setItem(this.KEY, html)
      localStorage.setItem(this.VERSION_KEY, String(this.CURRENT_VERSION))
    } catch {
      // localStorage full or unavailable
    }
  },

  load() {
    const area = document.getElementById('outputArea')
    if (!area) return

    const storedVersion = parseInt(localStorage.getItem(this.VERSION_KEY) || '0', 10)
    if (storedVersion < this.CURRENT_VERSION) {
      this.clear()
      return
    }

    const html = localStorage.getItem(this.KEY)
    if (html) {
      const sanitized = this._sanitizeHtml(html)
      if (sanitized !== html) {
        this.clear()
        return
      }
      area.innerHTML = sanitized
      this.rebindEvents()
    }
  },

  clear() {
    try {
      localStorage.removeItem(this.KEY)
      localStorage.removeItem(this.VERSION_KEY)
    } catch {
      // ignore
    }
  },

  _sanitizeHtml(html) {
    let clean = html

    // 1. Remove dangerous block-level elements (case-insensitive)
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    clean = clean.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    clean = clean.replace(/<embed\b[^>]*>/gi, '')
    clean = clean.replace(/<base\b[^>]*>/gi, '')
    clean = clean.replace(/<link\b[^>]*>/gi, '')

    // 2. Remove ALL inline event handlers (case-insensitive, quoted/unquoted)
    clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

    // 3. Strip javascript: URI scheme (case-insensitive) from URL attributes
    clean = clean.replace(
      /((?:href|src|action|formaction|data|xlink:href)\s*=\s*["'])\s*javascript:[^"']*/gi,
      '$1#'
    )
    clean = clean.replace(
      /((?:href|src|action|formaction|data)\s*=\s*)javascript:\S*/gi,
      '$1#'
    )

    // 4. Strip srcdoc attribute
    clean = clean.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

    // 5. Strip formaction attribute
    clean = clean.replace(/\s+formaction\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

    return clean
  },

  rebindEvents() {
    const area = document.getElementById('outputArea')
    if (!area) return
    area.querySelectorAll('.output-entry').forEach(bindEntryActions)
  }
}