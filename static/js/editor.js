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

  init() {
    this.ta = document.getElementById('modalContent')
    this.gutter = document.getElementById('lineNumbers')
    if (!this.ta || !this.gutter) return

    // Create the syntax highlight overlay
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

  // ── Highlight layer setup ──────────────────────────────────────────────
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

  // ── Debounced highlighting ────────────────────────────────────────────
  _scheduleHighlight() {
    if (this._highlightTimer) clearTimeout(this._highlightTimer)
    this._highlightTimer = setTimeout(() => this._doHighlight(), 100)
  },

  _doHighlight() {
    if (!this.highlightLayer) return

    const code = this.highlightLayer.querySelector('code')
    if (!code) return

    const value = this.ta.value

    // Guard: if hljs is not loaded, just show plain text
    if (typeof hljs === 'undefined') {
      code.textContent = value
      this.ta.classList.remove('highlighting-on')
      return
    }

    // HTML-escape the content before passing to hljs
    const escaped = esc(value)

    // Set content and highlight
    code.innerHTML = escaped
    code.className = `language-${this.currentLang}`

    try {
      hljs.highlightElement(code)
    } catch {
      // If highlighting fails for unsupported language, keep plain
      code.textContent = value
    }

    // Activate the transparent-text overlay
    this.ta.classList.add('highlighting-on')
  },

  // ── Language management ────────────────────────────────────────────────
  setLanguage(lang) {
    this.currentLang = lang || 'plaintext'
    this._doHighlight()
  },

  // ── Viewport / virtual keyboard fix ────────────────────────────────────
  _initViewport() {
    if ('virtualKeyboard' in navigator) {
      navigator.virtualKeyboard.overlaysContent = false
    }
    const update = () => {
      const h = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
  },

  updateGutter() {
    const lines = this.ta.value.split('\n').length
    this.gutter.textContent = Array.from({length: lines}, (_, i) => i + 1).join('\n')
  },

  syncScroll() {
    this.gutter.scrollTop = this.ta.scrollTop
    // Sync the highlight layer scroll with the textarea
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
      const extraIndent = currentLine.trimEnd().endsWith(':') ? '    ' : ''
      this.insertAtCursor('\n' + indent + extraIndent)
      return
    }

    if (e.key === 's' && e.ctrlKey) {
      e.preventDefault()
      document.getElementById('modalSave')?.click()
    }
  },

  insertAtCursor(text) {
    const start = this.ta.selectionStart
    const end = this.ta.selectionEnd
    this.ta.value = this.ta.value.substring(0, start) + text + this.ta.value.substring(end)
    this.ta.selectionStart = this.ta.selectionEnd = start + text.length
    this.updateGutter()
    this._scheduleHighlight()
  },

  onLoad(lang) {
    // Set language and enable highlighting
    if (lang) {
      this.setLanguage(lang)
    }
    this.updateGutter()
    this.ta.scrollTop = 0
    this.gutter.scrollTop = 0
    if (this.highlightLayer) {
      this.highlightLayer.scrollTop = 0
    }
    this._doHighlight()
  }
}