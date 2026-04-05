import { api, esc } from './api.js'
import { FileManager } from './file-manager.js'
import { highlightMatch } from './search-utils.js'
import { Toast } from './terminal.js'

const TEMPLATE = `
<div class="modal-box" style="height:80vh;display:flex;flex-direction:column">
  <header class="modal-header">
    <h3>\u2312 FIND IN FILES</h3>
    <button id="gs-close" class="paper-btn ghost">&times;</button>
  </header>
  <div class="file-toolbar">
    <div style="display:flex;gap:6px;align-items:center;flex:1">
      <input id="gs-input" placeholder="Search in all files..." style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 12px;color:var(--text);font-size:12px;outline:none;font-family:var(--mono)" />
      <button id="gs-btn-case" title="Match case" style="background:var(--dark);border:1px solid var(--border);border-radius:3px;padding:4px 8px;color:var(--cement);font-size:10px;cursor:pointer;font-family:var(--mono)">Aa</button>
      <button id="gs-btn-search" class="paper-btn primary" style="padding:8px 14px;font-size:11px">SEARCH</button>
    </div>
  </div>
  <div id="gs-results" style="flex:1;overflow-y:auto;padding:4px 0;font-family:var(--mono)"></div>
</div>
`

export const GlobalSearch = {
  dialog: null,
  input: null,
  resultsEl: null,
  caseSensitive: false,

  init() {
    this.dialog = document.createElement('dialog')
    this.dialog.id = 'globalSearchModal'
    this.dialog.className = 'paper-modal'
    this.dialog.innerHTML = TEMPLATE
    document.body.appendChild(this.dialog)

    this.input = document.getElementById('gs-input')
    this.resultsEl = document.getElementById('gs-results')
    if (!this.input || !this.resultsEl) return

    const closeBtn = document.getElementById('gs-close')
    if (closeBtn) closeBtn.onclick = () => this.hide()

    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.hide()
    })
    
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter') this.doSearch()
      if (e.key === 'Escape') this.hide()
    }
    
    const searchBtn = document.getElementById('gs-btn-search')
    if (searchBtn) searchBtn.onclick = () => this.doSearch()
    this.setupCaseToggle()
    this.setupResultsHandler()
  },

  setupCaseToggle() {
    const btn = document.getElementById('gs-btn-case')
    if (!btn) return
    const updateStyle = () => {
      btn.style.background = this.caseSensitive ? 'var(--surface)' : 'var(--dark)'
      btn.style.color = this.caseSensitive ? 'var(--accent)' : 'var(--cement)'
    }
    updateStyle()
    btn.onclick = () => {
      this.caseSensitive = !this.caseSensitive
      updateStyle()
    }
  },

  setupResultsHandler() {
    if (!this.resultsEl) return
    this.resultsEl.addEventListener('click', (e) => {
      const match = e.target.closest('.gs-match')
      if (match && match.dataset.file && match.dataset.line) {
        this.hide()
        FileManager.openFileWithLine(match.dataset.file, parseInt(match.dataset.line, 10))
        return
      }
      
      const header = e.target.closest('.gs-file-header')
      if (header) {
        const matches = header.nextElementSibling
        if (matches) {
          matches.classList.toggle('hidden')
          const arrow = header.querySelector('.gs-arrow')
          if (arrow) arrow.textContent = matches.classList.contains('hidden') ? '\u25B8' : '\u25BE'
          header.style.borderLeftColor = matches.classList.contains('hidden') ? 'transparent' : 'var(--accent)'
        }
      }
    })
  },

  show() {
    if (!this.dialog) return
    try {
      this.dialog.showModal()
    } catch (err) {
      if (this.dialog.show) this.dialog.show()
      else this.dialog.hidden = false
    }
    if (this.input) {
      this.input.value = ''
      setTimeout(() => this.input?.focus(), 50)
    }
    if (this.resultsEl) this.resultsEl.innerHTML = ''
  },

  hide() {
    if (!this.dialog) return
    try { this.dialog.close() } catch { this.dialog.hidden = true }
  },

  async doSearch() {
    const q = this.input?.value.trim()
    if (!q) return
    
    const btn = document.getElementById('gs-btn-search')
    if (btn) {
      btn.innerHTML = '\u00B7\u00B7\u00B7'
      btn.disabled = true
    }
    if (this.resultsEl) this.resultsEl.innerHTML = '<div style="padding:20px;color:var(--cement);text-align:center">Searching...</div>'
    
    try {
      const { ok, data } = await api.get(`/api/files/search?q=${encodeURIComponent(q)}&case=${this.caseSensitive ? '1' : '0'}`)
      const results = (ok && data?.success) ? (data.results || []) : []
      this.renderResults(results, q)
    } catch (err) {
      if (this.resultsEl) this.resultsEl.innerHTML = '<div style="padding:20px;color:var(--danger);text-align:center">Search failed</div>'
      Toast.show('Search failed', 'error')
    } finally {
      if (btn) {
        btn.innerHTML = 'SEARCH'
        btn.disabled = false
      }
    }
  },

  renderResults(results, q) {
    if (!this.resultsEl) return
    const total = results.reduce((sum, r) => sum + (r.matches?.length || 0), 0)
    
    if (results.length === 0 || total === 0) {
      this.resultsEl.innerHTML = '<div style="padding:20px;color:var(--cement);text-align:center;font-size:11px">No results found</div>'
      Toast.show('No results found', 'info')
      return
    }

    Toast.show(`${total} results in ${results.length} files`, 'success')

    let html = `<div style="padding:6px 12px;font-size:10px;color:var(--cement)">${total} results in ${results.length} files</div>`
    const isExpanded = results.length <= 5

    for (const { file, matches } of results) {
      if (!matches?.length) continue
      html += this.renderFileResults(file, matches, isExpanded, q)
    }

    this.resultsEl.innerHTML = html
  },

  renderFileResults(file, matches, isExpanded, q) {
    return `
      <div>
        <div class="gs-file-header" data-file="${esc(file)}" style="display:flex;align-items:center;gap:6px;padding:4px 12px;cursor:pointer;border-left:2px solid ${isExpanded ? 'var(--accent)' : 'transparent'}">
          <span style="color:var(--cement);font-size:10px" class="gs-arrow">${isExpanded ? '\u25BE' : '\u25B8'}</span>
          <span style="font-size:11px;color:var(--accent);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file)}</span>
          <span style="font-size:9px;color:var(--cement);background:var(--dark);padding:1px 6px;border-radius:2px">${matches.length}</span>
        </div>
        <div class="${isExpanded ? '' : 'hidden'}" style="padding:2px 0">
          ${matches.map(m => this.renderMatch(m, file, q)).join('')}
        </div>
      </div>`
  },

  renderMatch(match, file, q) {
    const rawText = match?.text ?? ''
    const lineNum = match?.line ?? 0
    const highlighted = highlightMatch(rawText, q, this.caseSensitive)
      .replace(/<mark>/g, '<mark style="background:rgba(255,107,53,.15);color:var(--accent);padding:0 2px">')
    
    return `
      <div class="gs-match" data-file="${esc(file)}" data-line="${lineNum}" style="display:flex;gap:8px;padding:3px 12px 3px 28px;cursor:pointer">
        <span style="font-size:10px;color:var(--cement);min-width:28px;text-align:right">${lineNum}</span>
        <span style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${highlighted}</span>
      </div>`
  }
}