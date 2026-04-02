import { bindEntryActions } from './terminal.js'

export const Storage = {
  KEY: 'yuyu_terminal_history',

  save() {
    const entries = document.querySelectorAll('#outputArea .output-entry')
    if (entries.length === 0) return
    const html = Array.from(entries).slice(-30).map(e => e.outerHTML).join('')
    localStorage.setItem(this.KEY, html)
  },

  load() {
    const html = localStorage.getItem(this.KEY)
    if (html) {
      const area = document.getElementById('outputArea')
      area.innerHTML = html
      this.rebindEvents()
    }
  },

  rebindEvents() {
    document.querySelectorAll('#outputArea .output-entry').forEach(bindEntryActions)
  }
}
