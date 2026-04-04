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
      // SECURITY: Sanitize stored HTML before injecting into DOM
      const sanitized = this._sanitizeHtml(html)
      if (sanitized !== html) {
        // If sanitization changed anything, discard old data entirely
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

  // SECURITY: Sanitize stored HTML to prevent stored XSS.
  // BUG FIX: Old version only stripped <script> tags and onclick= style handlers.
  // Missing vectors that could still execute JS:
  //   - src="javascript:..." on <img>, <iframe>, <script> etc.
  //   - href="javascript:..." (was only fixed for href, not src/action/formaction)
  //   - srcdoc= attribute on <iframe> (can embed full HTML documents)
  //   - formaction= on <button>/<input> (overrides form action)
  //   - <base href=...> (can redirect all relative URLs to attacker-controlled origin)
  //   - <iframe>, <object>, <embed>, <link rel=import> (content injection)
  //   - Unquoted event handlers: onerror=alert(1) (no quotes — old regex missed these)
  _sanitizeHtml(html) {
    let clean = html

    // 1. Remove dangerous block-level elements entirely (with their content)
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    clean = clean.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    clean = clean.replace(/<embed\b[^>]*>/gi, '')
    clean = clean.replace(/<base\b[^>]*>/gi, '')  // Prevents base-href hijacking
    clean = clean.replace(/<link\b[^>]*>/gi, '')   // Prevents stylesheet/import injection

    // 2. Remove ALL inline event handlers (quoted and unquoted variants)
    //    Old regex: /\s+on\w+=\s*["'][^"']*["']/ — missed unquoted, multi-word, etc.
    //    New: strip any on* attribute regardless of quoting style.
    clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

    // 3. Strip javascript: URI scheme from ALL attributes that accept URLs.
    //    Old version only fixed href="javascript:...". Any attribute can carry it:
    //    src=, action=, formaction=, xlink:href=, data=, etc.
    clean = clean.replace(
      /((?:href|src|action|formaction|data|xlink:href)\s*=\s*["'])\s*javascript:[^"']*/gi,
      '$1#'
    )
    // Also catch unquoted variant: src=javascript:alert(1)
    clean = clean.replace(
      /((?:href|src|action|formaction|data)\s*=\s*)javascript:\S*/gi,
      '$1#'
    )

    // 4. Strip srcdoc= (iframe content injection — iframe removed above but belt+suspenders)
    clean = clean.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

    // 5. Strip formaction= (overrides <form action> — allows redirecting POST requests)
    clean = clean.replace(/\s+formaction\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')

    return clean
  },

  rebindEvents() {
    document.querySelectorAll('#outputArea .output-entry').forEach(bindEntryActions)
  }
}
