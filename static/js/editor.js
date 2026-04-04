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
  _viewportHandler: null,
  _resizeHandler: null,
  _taInputHandler: null,
  _taScrollHandler: null,
  _taKeydownHandler: null,

  init() {
    this.ta = document.getElementById('modalContent')
    this.gutter = document.getElementById('lineNumbers')
    if (!this.ta || !this.gutter) return

    this._createHighlightLayer()
    this._syncLayerStyles() // Pastikan style layer sama persis dengan textarea

    this._taInputHandler = () => {
      this.updateGutter()
      this._scheduleHighlight()
    }
    this._taScrollHandler = () => this.syncScroll()
    this._taKeydownHandler = (e) => this.handleKeys(e)

    this.ta.addEventListener('input', this._taInputHandler)
    this.ta.addEventListener('scroll', this._taScrollHandler)
    this.ta.addEventListener('keydown', this._taKeydownHandler)

    this.updateGutter()
    this._initViewport()
  },

  // Sinkronkan style highlight layer dengan textarea (font, padding, line-height)
  _syncLayerStyles() {
    if (!this.ta || !this.highlightLayer) return
    const styles = window.getComputedStyle(this.ta)
    const layer = this.highlightLayer
    layer.style.fontFamily = styles.fontFamily
    layer.style.fontSize = styles.fontSize
    layer.style.lineHeight = styles.lineHeight
    layer.style.padding = styles.padding
    layer.style.whiteSpace = styles.whiteSpace
    layer.style.tabSize = styles.tabSize
    // Pastikan posisi left mengikuti gutter width
    const gutterWidth = this.gutter.offsetWidth
    layer.style.left = `${gutterWidth + 1}px` // +1 untuk border
  },

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
    if (this.ta) {
      if (this._taInputHandler) this.ta.removeEventListener('input', this._taInputHandler)
      if (this._taScrollHandler) this.ta.removeEventListener('scroll', this._taScrollHandler)
      if (this._taKeydownHandler) this.ta.removeEventListener('keydown', this._taKeydownHandler)
      this._taInputHandler = null
      this._taScrollHandler = null
      this._taKeydownHandler = null
    }
    if (this.highlightLayer?.parentNode) {
      this.highlightLayer.parentNode.removeChild(this.highlightLayer)
      this.highlightLayer = null
    }
  },

  _createHighlightLayer() {
    if (this.highlightLayer) return
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
    if (!this.highlightLayer || !this.ta) return
    const code = this.highlightLayer.querySelector('code')
    if (!code) return
    const value = this.ta.value
    if (typeof hljs === 'undefined') {
      code.textContent = value
      this.ta.classList.remove('highlighting-on')
      return
    }
    try {
      const result = hljs.highlight(value, { language: this.currentLang, ignoreIllegals: true })
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
    // Pastikan textarea benar-benar transparan (tambahan inline style)
    this.ta.style.color = 'transparent'
    this.ta.style.background = 'transparent'
    this.ta.style.webkitTextFillColor = 'transparent'
    this.syncScroll()
  },

  setLanguage(lang) {
    this.currentLang = lang || 'plaintext'
    this._doHighlight()
  },

  _initViewport() {
    if (this._viewportHandler) {
      window.visualViewport?.removeEventListener('resize', this._viewportHandler)
      window.removeEventListener('resize', this._resizeHandler)
    }
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
    if (!this.ta || !this.gutter) return
    const lineCount = this.ta.value.split('\n').length
    if (lineCount <= 1) {
      this.gutter.textContent = '1'
    } else {
      this.gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')
    }
    // Sinkronkan ulang posisi layer setelah gutter berubah lebar
    this._syncLayerStyles()
  },

  syncScroll() {
    if (!this.ta || !this.gutter) return
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

  insertAtCursor(text) {
    if (!this.ta) return
    this.ta.focus()
    const start = this.ta.selectionStart
    const end = this.ta.selectionEnd
    this.ta.setRangeText(text, start, end, 'end')
    this.ta.dispatchEvent(new Event('input', { bubbles: true }))
  },

  onLoad(lang, content) {
    if (!this.ta) return
    if (content !== undefined) this.ta.value = content
    this.currentLang = lang || 'plaintext'
    this.updateGutter()
    this.ta.scrollTop = 0
    this.ta.selectionStart = 0
    this.ta.selectionEnd = 0
    if (this.gutter) this.gutter.scrollTop = 0
    if (this.highlightLayer) this.highlightLayer.scrollTop = 0
    this._doHighlight()
  }
}