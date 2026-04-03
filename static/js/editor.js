import { esc } from './api.js'

const LANG_MAP = {
  py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', html: 'html',
  htm: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml',
  yml: 'yaml', toml: 'toml', cfg: 'ini'
}

export const Editor = {
  ta: null,
  gutter: null,
  highlightLayer: null,
  currentLang: 'plaintext',
  _highlightTimer: null,
  // FIX: Store handler references for cleanup — prevents memory leak
  _viewportHandler: null,
  _resizeHandler: null,

  init() {
    this.ta = document.getElementById('modalContent')
    this.gutter = document.getElementById('lineNumbers')
    if (!this.ta || !this.gutter) return

    this._createHighlightLayer()

    this.ta.addEventListener('input', () => {
      this.updateGutter()
      this._scheduleHighlight()
    })
    this.ta.addEventListener('scroll', () => this.syncScroll())
    this.ta.addEventListener('keydown', (e) => this.handleKeys(e))

    this.updateGutter()
    this._initViewport()
  },

  // FIX: Proper cleanup to prevent memory leaks
  destroy() {
    if (this._highlightTimer) {
      clearTimeout(this._highlightTimer)
      this._highlightTimer = null
    }
    if (this._viewportHandler) {
      window.visualViewport?.removeEventListener('resize', this._viewportHandler)
      this._viewportHandler = null
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler)
      this._resizeHandler = null
    }
  },

  _createHighlightLayer() {
    const wrapper = document.getElementById('editorWrapper')
    if (!wrapper) return

    this.highlightLayer = document.createElement('pre')
    this.highlightLayer.className = 'editor-highlight-layer'
    this.highlightLayer.setAttribute('aria-hidden', 'true')

    const code = document.createElement('code')
    this.highlightLayer.appendChild(code)
    wrapper.appendChild(this.highlightLayer)
  },

  _scheduleHighlight() {
    if (this._highlightTimer) clearTimeout(this._highlightTimer)
    this._highlightTimer = setTimeout(() => this._doHighlight(), 100)
  },

  _doHighlight() {
    if (!this.highlightLayer) return

    const code = this.highlightLayer.querySelector('code')
    if (!code) return

    const value = this.ta.value

    if (typeof hljs === 'undefined') {
      code.textContent = value
      this.ta.classList.remove('highlighting-on')
      return
    }

    // FIX: ROOT CAUSE of "syntax highlight mati warna" — replaced hljs.highlightElement()
    // with hljs.highlight(). The old code used highlightElement() which sets
    // code.dataset.highlighted = "yes" after the first successful call. On ALL
    // subsequent calls, hljs checks this attribute and SKIPS highlighting entirely
    // (returns early). Setting code.innerHTML or code.className does NOT clear
    // dataset attributes, so the highlight layer was permanently frozen after
    // the first render. User would see: colors on file open, then NO COLORS
    // when typing. Additionally, the frozen highlight layer showed OLD content
    // while the textarea showed NEW content → "teks dobel" (doubled text overlay).
    //
    // hljs.highlight() is a pure function — it takes text + language, returns
    // highlighted HTML. No internal state mutation, no dataset check, always fresh.
    // We also removed the redundant esc() call: esc(value) + code.innerHTML
    // was a wasted round-trip because hljs.highlight() reads raw text and does
    // its own HTML escaping internally.

    try {
      const result = hljs.highlight(value, {
        language: this.currentLang,
        ignoreIllegals: true
      })
      code.innerHTML = result.value
      code.className = `language-${this.currentLang} hljs`
    } catch {
      // Language not registered — try auto-detect as fallback
      try {
        const result = hljs.highlightAuto(value)
        code.innerHTML = result.value
        code.className = `${result.language} hljs`
      } catch {
        // Both failed — show plain text
        code.textContent = value
        code.className = ''
      }
    }

    this.ta.classList.add('highlighting-on')
  },

  setLanguage(lang) {
    this.currentLang = lang || 'plaintext'
    this._doHighlight()
  },

  _initViewport() {
    // FIX: Cleanup previous listeners before adding new ones
    this.destroy()

    if ('virtualKeyboard' in navigator) {
      navigator.virtualKeyboard.overlaysContent = false
    }

    this._viewportHandler = () => {
      const h = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`)
    }
    this._resizeHandler = this._viewportHandler

    this._viewportHandler()
    window.visualViewport?.addEventListener('resize', this._viewportHandler)
    window.addEventListener('resize', this._resizeHandler)
  },

  updateGutter() {
    const lineCount = this.ta.value.split('\n').length
    if (lineCount <= 1) {
      this.gutter.textContent = '1'
      return
    }
    this.gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')
  },

  syncScroll() {
    this.gutter.scrollTop = this.ta.scrollTop
    if (this.highlightLayer) {
      this.highlightLayer.scrollTop = this.ta.scrollTop
      this.highlightLayer.scrollLeft = this.ta.scrollLeft
    }
  },

  handleKeys(e) {
    if (e.key === 'Tab') {
      e.preventDefault()
      this.insertAtCursor('    ')
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const start = this.ta.selectionStart
      const val = this.ta.value
      const lineStart = val.lastIndexOf('\n', start - 1) + 1
      const currentLine = val.substring(lineStart, start)
      const indent = currentLine.match(/^\s*/)[0]
      // FIX: Added auto-indent for common pairs: { } ( ) [ ] — not just Python ':'
      const extraIndent = currentLine.trimEnd().endsWith(':') ||
                          currentLine.trimEnd().endsWith('{') ||
                          currentLine.trimEnd().endsWith('(') ||
                          currentLine.trimEnd().endsWith('[') ? '    ' : ''
      this.insertAtCursor('\n' + indent + extraIndent)
      return
    }

    if (e.key === 's' && e.ctrlKey) {
      e.preventDefault()
      document.getElementById('modalSave')?.click()
    }
  },

  // FIX: insertAtCursor was breaking undo/redo — setting .value programmatically
  // resets the browser's undo stack. After pressing Tab/Enter, Ctrl+Z would not
  // undo the inserted text. Fix: use document.execCommand('insertText') which
  // integrates with the browser's native undo history.
  insertAtCursor(text) {
    this.ta.focus()

    if (document.execCommand?.('insertText', false, text)) {
      this.updateGutter()
      this._scheduleHighlight()
      return
    }

    // Fallback for browsers where execCommand doesn't work in textarea
    const start = this.ta.selectionStart
    const end = this.ta.selectionEnd
    this.ta.value = this.ta.value.substring(0, start) + text + this.ta.value.substring(end)
    this.ta.selectionStart = this.ta.selectionEnd = start + text.length
    this.updateGutter()
    this._scheduleHighlight()
  },

  // FIX: Added null guards — crashes if init() failed (elements missing)
  // FIX: Removed duplicate _doHighlight() call — setLanguage() already calls it,
  // so the old code was calling _doHighlight() TWICE per file load (wasteful).
  onLoad(lang) {
    if (!this.ta) return

    this.currentLang = lang || 'plaintext'
    this.updateGutter()
    this.ta.scrollTop = 0
    if (this.gutter) this.gutter.scrollTop = 0
    if (this.highlightLayer) this.highlightLayer.scrollTop = 0
    this._doHighlight()
  }
}
