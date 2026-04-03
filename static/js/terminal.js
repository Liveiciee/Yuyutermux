import { api, esc, SERVER_HINT_TEXT } from './api.js'
import { Storage } from './storage.js'

// CONSTANTS
const CONFIG = {
  MAX_ENTRIES: 30,
  HISTORY_LIMIT: 50,
  HANG_TIMEOUT: 10000,
  CONNECT_TIMEOUT: 3000,
  VIRTUAL_SCROLL_THRESHOLD: 10,   // total entries before collapsing
  VIRTUAL_SCROLL_KEEP: 5          // always show this many recent entries fully
}

// ICONS SVG
const ICONS = {
  copy: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>`,
  delete: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`
}

// ANIMATION CLASS NAMES (exported for animation.css)
export const ANIM_CLASSES = {
  entryPulse: 'entry-pulse',
  entryDoneSuccess: 'entry-done-success',
  entryDoneError: 'entry-done-error',
  entryStagger: 'entry-stagger'
}

// TOAST SYSTEM
export const Toast = {
  container: null,
  icons: { success: '\u2713', error: '\u2717', info: '\u2139', warning: '\u26A0' },

  init() {
    this.container = document.getElementById('toastContainer')
  },

  show(message, type = 'info', duration = 3000) {
    if (!this.container) return
    const toast = document.createElement('div')
    toast.className = `toast ${type}`
    toast.innerHTML = `<span class="toast-icon">${this.icons[type] || '\u2139'}</span><span>${esc(message)}</span>`
    this.container.appendChild(toast)

    setTimeout(() => {
      toast.classList.add('removing')
      toast.addEventListener('animationend', () => toast.remove())
    }, duration)
  }
}

// STATUS BAR
export const StatusBar = {
  startTime: Date.now(),
  cmdCount: 0,
  timer: null,

  init(intervalRef) {
    this.timer = setInterval(() => this.updateTime(), 1000)
    this.updateTime()
    this.checkConnection()
    // FIX: Store interval reference for cleanup in app.js
    const id = setInterval(() => this.checkConnection(), 15000)
    if (intervalRef && typeof intervalRef === 'object') {
      // Export the reference back to the caller
      intervalRef.interval = id
    }
  },

  updateTime() {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000)
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const secs = String(elapsed % 60).padStart(2, '0')
    const el = document.getElementById('statusTime')
    if (el) el.textContent = `${mins}:${secs}`
  },

  incrementCmd() {
    this.cmdCount++
    const el = document.getElementById('statusCmdCount')
    if (el) el.textContent = `${this.cmdCount} cmd${this.cmdCount !== 1 ? 's' : ''}`
  },

  async checkConnection() {
    const dot = document.getElementById('statusDot')
    const conn = document.getElementById('statusConnection')
    try {
      // FIX Bug #5: Pake /api/health (ringan) bukan /api/files/list (scan seluruh direktori!)
      const res = await fetch('/api/health', {
        method: 'GET',
        signal: AbortSignal.timeout(CONFIG.CONNECT_TIMEOUT)
      })
      if (res.ok) {
        dot.className = 'status-dot connected'
        conn.textContent = 'CONNECTED'
      } else {
        throw new Error()
      }
    } catch {
      dot.className = 'status-dot error'
      conn.textContent = 'OFFLINE'
    }
  }
}

// ENTRY ACTIONS HELPER
export function bindEntryActions(entry) {
  const pre = entry.querySelector('pre')
  const copyBtn = entry.querySelector('.act-copy')
  const delBtn = entry.querySelector('.act-del')

  if (copyBtn) {
    copyBtn.onclick = () => {
      if (!pre) return
      navigator.clipboard.writeText(pre.textContent).then(() => {
        copyBtn.innerHTML = '<span style="color:var(--success)">\u2713</span> COPIED'
        setTimeout(() => copyBtn.innerHTML = `${ICONS.copy} COPY`, 1500)
      })
    }
  }

  if (delBtn) {
    delBtn.onclick = () => {
      entry.style.transition = 'opacity 0.2s, transform 0.2s'
      entry.style.opacity = '0'
      entry.style.transform = 'translateX(20px)'
      setTimeout(() => entry.remove(), 200)
    }
  }

  // FIX Bug #7: Rebind KILL button - inline onclick gak bisa akses module scope
  const killBtn = entry.querySelector('.hang-warning button')
  if (killBtn) {
    killBtn.onclick = () => Terminal.kill(killBtn)
  }

  // Virtual scroll: click on collapsed entry to expand/collapse
  entry.addEventListener('click', (e) => {
    // Don't toggle if clicking on action buttons
    if (e.target.closest('.output-actions') || e.target.closest('.hang-warning')) return
    entry.classList.toggle('collapsed')
  })
}

// ── Virtual scroll helper ─────────────────────────────────────────────────
function applyVirtualScroll(area) {
  const entries = area.querySelectorAll('.output-entry')
  if (entries.length <= CONFIG.VIRTUAL_SCROLL_THRESHOLD) return

  // Mark entries older than the N most recent as collapsed
  const keepCount = CONFIG.VIRTUAL_SCROLL_KEEP
  entries.forEach((entry, idx) => {
    if (idx < entries.length - keepCount) {
      entry.classList.add('collapsed')
    } else {
      entry.classList.remove('collapsed')
    }
  })
}

// TERMINAL CORE
export const Terminal = {
  // FIX: Lazy-init DOM reference — avoids null if module evaluates before DOM is ready
  _area: null,
  get area() {
    if (!this._area) this._area = document.getElementById('outputArea')
    return this._area
  },
  history: [],
  idx: -1,
  activeCmd: '',

  add(cmd) {
    this.area.querySelector('.placeholder')?.remove()

    const entry = document.createElement('div')
    entry.className = 'output-entry running'
    entry.innerHTML = `
      <div class="cmd-line">
        <div>
          <strong>$</strong> ${esc(cmd)}
          <span class="cmd-spinner" id="spinner-${Date.now()}">
            <span class="spinner-dots"><span></span><span></span><span></span></span> RUNNING
          </span>
        </div>
        <span class="cmd-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <pre class="output-content"></pre>
      <div class="hang-warning hidden">
        No output for 10s. Hung process?
        <button class="paper-btn small" style="border-color:var(--warning);color:var(--warning);">KILL</button>
      </div>
      <div class="output-actions hidden">
        <button class="paper-btn small act-copy">${ICONS.copy} COPY</button>
        <button class="paper-btn small act-del">${ICONS.delete} DELETE</button>
      </div>`

    // ── Animation: entry pulse on creation ──
    entry.classList.add(ANIM_CLASSES.entryPulse)
    entry.addEventListener('animationend', () => {
      entry.classList.remove(ANIM_CLASSES.entryPulse)
    }, { once: true })

    const pre = entry.querySelector('.output-content')
    const warning = entry.querySelector('.hang-warning')
    const actions = entry.querySelector('.output-actions')
    const spinner = entry.querySelector('.cmd-spinner')
    let hangTimer = null
    const controller = new AbortController()

    const stopHangTimer = () => {
      if (hangTimer) {
        clearTimeout(hangTimer)
        hangTimer = null
      }
    }

    const resetHangTimer = () => {
      stopHangTimer()
      warning.classList.add('hidden')
      hangTimer = setTimeout(() => warning.classList.remove('hidden'), CONFIG.HANG_TIMEOUT)
    }

    const setDone = (success, exitCode) => {
      if (spinner) spinner.remove()
      entry.classList.remove('running')
      entry.classList.add(success ? 'success' : 'error')

      // ── Animation: done state bump ──
      entry.classList.add(success ? ANIM_CLASSES.entryDoneSuccess : ANIM_CLASSES.entryDoneError)
      entry.addEventListener('animationend', () => {
        entry.classList.remove(ANIM_CLASSES.entryDoneSuccess, ANIM_CLASSES.entryDoneError)
      }, { once: true })

      actions.classList.remove('hidden')

      const badge = document.createElement('span')
      badge.className = `cmd-status-badge ${success ? 'success' : 'error'}`
      badge.textContent = success ? `\u2713 EXIT 0` : `\u2717 EXIT ${exitCode}`
      entry.querySelector('.cmd-line > div').appendChild(badge)
    }

    bindEntryActions(entry)

    this.area.appendChild(entry)
    const entries = this.area.querySelectorAll('.output-entry')
    if (entries.length > CONFIG.MAX_ENTRIES) entries[0].remove()

    // ── Virtual scroll: collapse older entries ──
    applyVirtualScroll(this.area)

    this.area.scrollTop = this.area.scrollHeight

    this.history.push(cmd)
    if (this.history.length > CONFIG.HISTORY_LIMIT) this.history.shift()
    resetHangTimer()
    StatusBar.incrementCmd()

    return { pre, resetHangTimer, stopHangTimer, controller, setDone }
  },

  async run() {
    const input = document.getElementById('cmdInput')
    const cmd = input.value.trim()
    if (!cmd) return

    input.value = ''
    input.style.height = '22px'
    this.activeCmd = cmd

    const btn = document.getElementById('sendBtn')
    btn.classList.add('streaming')
    btn.disabled = true
    input.focus()
    this.idx = -1

    document.getElementById('inputCharCount').textContent = '0 chars'

    const { pre, resetHangTimer, stopHangTimer, controller, setDone } = this.add(cmd)
    let isError = false
    let exitCode = 0

    try {
      const res = await fetch('/api/execute/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
        signal: controller.signal
      })

      // FIX: Handle 401 — redirect to login like api.request() does.
      // Previously used raw fetch() without auth handling, so auth failures
      // showed cryptic "STREAM ERROR: HTTP 401" instead of redirecting.
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        pre.textContent += chunk
        resetHangTimer()
        this.area.scrollTop = this.area.scrollHeight
        if (chunk.includes('[ERROR:')) isError = true
      }

      const text = pre.textContent
      const exitMatch = text.match(/\[EXIT_CODE:(\d+)\]/)
      if (exitMatch) {
        exitCode = exitMatch[1]
        isError = exitCode !== '0'
      }
      pre.textContent = text.replace(/\[EXIT_CODE:\d+\]\n?/g, '').replace(/\[ERROR:.*?\]\n?/g, '')

    } catch (err) {
      if (err.name === 'AbortError') {
        api.post('/api/execute/kill')
        Toast.show('Process terminated', 'warning')
        return
      }
      pre.textContent = `STREAM ERROR: ${err.message}`
      isError = true
      exitCode = 1
    } finally {
      stopHangTimer()
      btn.classList.remove('streaming')
      btn.disabled = false
      Storage.save()
    }

    setDone(!isError, exitCode)
    if (isError) Toast.show(`Command failed (exit ${exitCode})`, 'error')
  },

  async kill(btnEl) {
    btnEl.textContent = 'KILLING...'
    await api.post('/api/execute/kill')
    btnEl.closest('.hang-warning').innerHTML = 'Process terminated'
    Toast.show('Process terminated', 'warning')
  },

  log(message, isError = false) {
    this.area.querySelector('.placeholder')?.remove()
    const entry = document.createElement('div')
    entry.className = `output-entry${isError ? ' error' : ' success'}`
    entry.innerHTML = `
      <div class="cmd-line">
        <div><strong>$</strong> ${esc(message)}</div>
        <span class="cmd-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <pre class="output-content">${esc(message)}</pre>
      <div class="output-actions">
        <button class="paper-btn small act-copy">${ICONS.copy} COPY</button>
        <button class="paper-btn small act-del">${ICONS.delete} DELETE</button>
      </div>`

    // ── Animation: entry pulse on creation ──
    entry.classList.add(ANIM_CLASSES.entryPulse)
    entry.addEventListener('animationend', () => {
      entry.classList.remove(ANIM_CLASSES.entryPulse)
    }, { once: true })

    bindEntryActions(entry)
    this.area.appendChild(entry)

    const entries = this.area.querySelectorAll('.output-entry')
    if (entries.length > CONFIG.MAX_ENTRIES) entries[0].remove()

    // ── Virtual scroll: collapse older entries ──
    applyVirtualScroll(this.area)

    this.area.scrollTop = this.area.scrollHeight
    Storage.save()
  },

  clearAll() {
    const entries = this.area.querySelectorAll('.output-entry')
    if (entries.length === 0) return

    // ── Animation: staggered fade-out ──
    entries.forEach((e, i) => {
      e.classList.add(ANIM_CLASSES.entryStagger)
      // Apply stagger delay via inline transition-delay
      e.style.transitionDelay = `${i * 40}ms`
    })

    setTimeout(() => {
      this.area.innerHTML = `
        <div class="placeholder">
          <div class="placeholder-icon">
            <span class="placeholder-cursor">&gt;_</span>
          </div>
          <div class="placeholder-text">READY FOR COMMANDS</div>
          <div class="placeholder-hint">Ctrl+Enter to execute \u00B7 Extra keys below</div>
        </div>`
      Toast.show('Terminal cleared', 'info')
    }, entries.length * 40 + 250)
  },

  navUp() {
    if (this.idx < this.history.length - 1) {
      this.idx++
      const input = document.getElementById('cmdInput')
      input.value = this.history[this.history.length - 1 - this.idx]
      input.dispatchEvent(new Event('input'))
    }
  },

  navDown() {
    if (this.idx > 0) {
      this.idx--
      const input = document.getElementById('cmdInput')
      input.value = this.history[this.history.length - 1 - this.idx]
      input.dispatchEvent(new Event('input'))
    } else if (this.idx === 0) {
      this.idx = -1
      const input = document.getElementById('cmdInput')
      input.value = ''
      input.dispatchEvent(new Event('input'))
    }
  }
}

// COMMAND SUGGESTIONS
export const Suggestions = {
  dropdown: null,
  input: null,
  activeIndex: -1,
  visible: false,

  init() {
    this.dropdown = document.getElementById('suggestionsDropdown')
    this.input = document.getElementById('cmdInput')
    if (!this.dropdown || !this.input) return

    this.input.addEventListener('input', () => this.update())
    this.input.addEventListener('keydown', (e) => this.handleKey(e))
    this.input.addEventListener('blur', () => setTimeout(() => this.hide(), 150))
  },

  update() {
    const val = this.input.value.trim().toLowerCase()
    if (val.length < 1 || Terminal.history.length === 0) {
      this.hide()
      return
    }

    const matches = Terminal.history
      .filter((cmd, i, arr) => arr.indexOf(cmd) === i)
      .filter(cmd => cmd.toLowerCase().includes(val))
      .slice(0, 5)

    if (matches.length === 0) {
      this.hide()
      return
    }

    this.activeIndex = -1
    this.dropdown.innerHTML = matches.map((m, i) => `
      <div class="suggestion-item" data-index="${i}" data-value="${esc(m)}">
        ${esc(m)}<span class="suggestion-hint">\u2191\u2193 enter</span>
      </div>
    `).join('')

    this.dropdown.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.select(item.dataset.value)
      })
    })

    this.show()
  },

  handleKey(e) {
    if (!this.visible) return
    const items = this.dropdown.querySelectorAll('.suggestion-item')
    if (!items.length) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.activeIndex = Math.min(this.activeIndex + 1, items.length - 1)
      this.highlight(items)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.activeIndex = Math.max(this.activeIndex - 1, -1)
      this.highlight(items)
      if (this.activeIndex === -1) Terminal.navUp()
    } else if (e.key === 'Tab' || (e.key === 'Enter' && e.ctrlKey && this.activeIndex >= 0)) {
      if (this.activeIndex >= 0) {
        e.preventDefault()
        this.select(items[this.activeIndex].dataset.value)
      }
    }
  },

  highlight(items) {
    items.forEach((item, i) => item.classList.toggle('active', i === this.activeIndex))
  },

  select(value) {
    this.input.value = value
    this.input.focus()
    this.hide()
    this.input.dispatchEvent(new Event('input'))
  },

  show() {
    this.dropdown.classList.remove('hidden')
    this.visible = true
  },

  hide() {
    this.dropdown.classList.add('hidden')
    this.visible = false
    this.activeIndex = -1
  }
}