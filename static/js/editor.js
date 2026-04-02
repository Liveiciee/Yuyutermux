export const Editor = {
  ta: null,
  gutter: null,

  init() {
    this.ta = document.getElementById('modalContent')
    this.gutter = document.getElementById('lineNumbers')
    if (!this.ta || !this.gutter) return

    this.ta.addEventListener('input', () => this.updateGutter())
    this.ta.addEventListener('scroll', () => this.syncScroll())
    this.ta.addEventListener('keydown', (e) => this.handleKeys(e))

    this.updateGutter()
  },

  updateGutter() {
    const lines = this.ta.value.split('\n').length
    this.gutter.textContent = Array.from({length: lines}, (_, i) => i + 1).join('\n')
  },

  syncScroll() {
    this.gutter.scrollTop = this.ta.scrollTop
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
  },

  onLoad() {
    this.updateGutter()
    this.ta.scrollTop = 0
    this.gutter.scrollTop = 0
  }
}
