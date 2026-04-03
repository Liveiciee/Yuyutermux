import { bindEntryActions } from './terminal.js'

export const Storage = {
  KEY: 'yuyu_terminal_history',
  VERSION_KEY: 'yuyu_storage_version',
  CURRENT_VERSION: 2,  // Bump version to invalidate old potentially XSS'd data

  save() {
    const entries = document.querySelectorAll('#outputArea .output-entry')
    if (entries.length === 0) return
    const html = Array.from(entries).slice(-30).map(e => e.outerHTML).join('')
    try {
      localStorage.setItem(this.KEY, html)
      localStorage.setItem(this.VERSION_KEY, String(this.CURRENT_VERSION))
    } catch {
      // localStorage full or unavailable — silently fail
    }
  },

  load() {
    // SECURITY: Invalidate old storage that may contain XSS payloads
    const storedVersion = parseInt(localStorage.getItem(this.VERSION_KEY) || '0', 10)
    if (storedVersion < this.CURRENT_VERSION) {
      this.clear()
      return
    }

    const html = localStorage.getItem(this.KEY)
    if (html) {
      // SECURITY: Basic XSS sanitization — remove script tags and event handlers
      const sanitized = this._sanitizeHtml(html)
      if (sanitized !== html) {
        // If sanitization changed anything, discard old data
        this.clear()
        return
      }
      const area = document.getElementById('outputArea')
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

  // SECURITY: Sanitize stored HTML to prevent stored XSS
  _sanitizeHtml(html) {
    // Remove <script> tags
    let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove inline event handlers (onclick, onerror, onload, etc.)
    clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    clean = clean.replace(/\s+on\w+\s*=\s*\S+/gi, '')
    // Remove javascript: URLs
    clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    return clean
  },

  rebindEvents() {
    document.querySelectorAll('#outputArea .output-entry').forEach(bindEntryActions)
  }
}
