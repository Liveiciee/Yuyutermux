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
  // Store handler references for cleanup — prevents memory leak on re-init
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

  // Proper cleanup to prevent memory leaks
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

    // Use hljs.highlight() (pure function) instead of hljs.highlightElement()
    // (which sets dataset.highlighted and then skips on subsequent calls).
    try {
      const result = hljs.highlight(value, {
        language: this.currentLang,
        ignoreIllegals: true
      })
      code.innerHTML = result.value
      code.className = `language-${this.currentLang} hljs`
    } catch {
      try {
        const result = hljs.highlightAuto(value)
        code.innerHTML = result.value
        code.className = `${result.language} hljs`
      } catch {
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
    // Cleanup previous listeners before adding new ones to avoid duplicates
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

  // insertAtCursor: uses execCommand('insertText') as primary path because it
  // integrates with the browser's native undo/redo history. The fallback
  // (direct .value assignment) breaks undo — it is a known limitation and
  // only triggers on browsers that don't support execCommand in textareas
  // (very rare in 2024+ Chromium-based browsers used in Termux/Brave).
  insertAtCursor(text) {
    this.ta.focus()

    if (document.execCommand?.('insertText', false, text)) {
      this.updateGutter()
      this._scheduleHighlight()
      return
    }

    // Fallback: breaks undo stack but keeps editor functional
    const start = this.ta.selectionStart
    const end = this.ta.selectionEnd
    this.ta.value = this.ta.value.substring(0, start) + text + this.ta.value.substring(end)
    this.ta.selectionStart = this.ta.selectionEnd = start + text.length
    this.updateGutter()
    this._scheduleHighlight()
  },

  onLoad(lang) {
    if (!this.ta) return

    this.currentLang = lang || 'plaintext'
    this.updateGutter()

    // BUG FIX: Was only resetting scrollTop, not the cursor position.
    // When switching between files, the cursor stayed at its position from the
    // previous file. If that position exceeded the new file's length, browsers
    // clamp it silently — but visually the user expected the cursor at position 0.
    // Resetting selectionStart/End to 0 places the cursor at the start consistently.
    this.ta.scrollTop = 0
    this.ta.selectionStart = 0
    this.ta.selectionEnd = 0

    if (this.gutter) this.gutter.scrollTop = 0
    if (this.highlightLayer) this.highlightLayer.scrollTop = 0
    this._doHighlight()
  }
}
