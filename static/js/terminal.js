import { api, esc, SERVER_HINT_TEXT } from './api.js'
import { Storage } from './storage.js'

// CONSTANTS
const CONFIG = {
  MAX_ENTRIES: 30,
  HISTORY_LIMIT: 50,
  HANG_TIMEOUT: 10000,
  CONNECT_TIMEOUT: 3000,
  VIRTUAL_SCROLL_THRESHOLD: 10,
  VIRTUAL_SCROLL_KEEP: 5
}

// ICONS SVG
const ICONS = {
  copy: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>`,
  delete: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>`
}

export const ANIM_CLASSES = {
  entryPulse: 'entry-pulse',
  entryDoneSuccess: 'entry-done-success',
  entryDoneError: 'entry-done-error',
  entryStagger: 'entry-stagger'
}

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

export const StatusBar = {
  startTime: Date.now(),
  cmdCount: 0,
  timer: null,
  checkConnectionTimer: null,

  init() {
    this.timer = setInterval(() => this.updateTime(), 1000)
    this.updateTime()
    this.checkConnection()
    this.checkConnectionTimer = setInterval(() => this.checkConnection(), 15000)
  },

  destroy() {
    if (this.timer) clearInterval(this.timer)
    if (this.checkConnectionTimer) clearInterval(this.checkConnectionTimer)
    this.timer = null
    this.checkConnectionTimer = null
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
      const res = await fetch('/api/health', {
        method: 'GET',
        signal: AbortSignal.timeout(CONFIG.CONNECT_TIMEOUT)
      })
      if (res.ok) {
        if (dot) dot.className = 'status-dot connected'
        if (conn) conn.textContent = 'CONNECTED'
      } else throw new Error()
    } catch {
      if (dot) dot.className = 'status-dot error'
      if (conn) conn.textContent = 'OFFLINE'
    }
  }
}

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
      if (entry._terminalController && !entry._terminalController.signal.aborted) {
        entry._terminalController.abort()
      }
      if (entry._stopHangTimer) entry._stopHangTimer()
      entry.style.transition = 'opacity 0.2s, transform 0.2s'
      entry.style.opacity = '0'
      entry.style.transform = 'translateX(20px)'
      setTimeout(() => entry.remove(), 200)
    }
  }

  const killBtn = entry.querySelector('.hang-warning button')
  if (killBtn) {
    killBtn.onclick = () => Terminal.kill(killBtn)
  }

  entry.addEventListener('click', (e) => {
    if (e.target.closest('.output-actions') || e.target.closest('.hang-warning')) return
    entry.classList.toggle('collapsed')
  })
}

function applyVirtualScroll(area) {
  if (!area) return
  const entries = area.querySelectorAll('.output-entry')
  if (entries.length <= CONFIG.VIRTUAL_SCROLL_THRESHOLD) return
  const keepCount = CONFIG.VIRTUAL_SCROLL_KEEP
  entries.forEach((entry, idx) => {
    if (idx < entries.length - keepCount) entry.classList.add('collapsed')
    else entry.classList.remove('collapsed')
  })
}

export const Terminal = {
  _area: null,
  get area() {
    if (!this._area) this._area = document.getElementById('outputArea')
    return this._area
  },
  history: [],
  idx: -1,
  activeCmd: '',
  _clearTimeout: null,

  add(cmd) {
    const area = this.area
    if (!area) throw new Error('outputArea not found')

    if (this._clearTimeout) {
      clearTimeout(this._clearTimeout)
      this._clearTimeout = null
    }

    area.querySelector('.placeholder')?.remove()

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

    entry._terminalController = controller
    entry._stopHangTimer = () => {
      if (hangTimer) clearTimeout(hangTimer)
      hangTimer = null
    }

    const resetHangTimer = () => {
      entry._stopHangTimer()
      if (warning) warning.classList.add('hidden')
      hangTimer = setTimeout(() => {
        if (warning) warning.classList.remove('hidden')
      }, CONFIG.HANG_TIMEOUT)
    }

    const setDone = (success, exitCode) => {
      if (!entry.isConnected) return
      if (spinner) spinner.remove()
      entry.classList.remove('running')
      entry.classList.add(success ? 'success' : 'error')
      entry.classList.add(success ? ANIM_CLASSES.entryDoneSuccess : ANIM_CLASSES.entryDoneError)
      entry.addEventListener('animationend', () => {
        entry.classList.remove(ANIM_CLASSES.entryDoneSuccess, ANIM_CLASSES.entryDoneError)
      }, { once: true })
      if (actions) actions.classList.remove('hidden')
      const badge = document.createElement('span')
      badge.className = `cmd-status-badge ${success ? 'success' : 'error'}`
      badge.textContent = success ? `\u2713 EXIT 0` : `\u2717 EXIT ${exitCode}`
      const cmdDiv = entry.querySelector('.cmd-line > div')
      if (cmdDiv) cmdDiv.appendChild(badge)
    }

    bindEntryActions(entry)
    area.appendChild(entry)

    const entries = area.querySelectorAll('.output-entry')
    if (entries.length > CONFIG.MAX_ENTRIES) {
      const oldEntry = entries[0]
      if (oldEntry._stopHangTimer) oldEntry._stopHangTimer()
      if (oldEntry._terminalController && !oldEntry._terminalController.signal.aborted) {
        oldEntry._terminalController.abort()
      }
      oldEntry.remove()
    }

    applyVirtualScroll(area)
    area.scrollTop = area.scrollHeight

    this.history.push(cmd)
    if (this.history.length > CONFIG.HISTORY_LIMIT) this.history.shift()
    resetHangTimer()
    StatusBar.incrementCmd()

    return { pre, resetHangTimer, stopHangTimer: entry._stopHangTimer, controller, setDone }
  },

  async run() {
    const input = document.getElementById('cmdInput')
    if (!input) return
    const cmd = input.value.trim()
    if (!cmd) return

    input.value = ''
    input.style.height = '22px'
    this.activeCmd = cmd

    const btn = document.getElementById('sendBtn')
    if (btn) {
      btn.classList.add('streaming')
      btn.disabled = true
    }
    input.focus()
    this.idx = -1

    const charCount = document.getElementById('inputCharCount')
    if (charCount) charCount.textContent = '0 chars'

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

      if (res.status === 401) {
        controller.abort()
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
        if (pre) pre.textContent += chunk
        resetHangTimer()
        const area = this.area
        if (area) area.scrollTop = area.scrollHeight
        if (chunk.includes('[ERROR:')) isError = true
      }

      const text = pre ? pre.textContent : ''
      const exitMatch = text.match(/\[EXIT_CODE:(\d+)\]/)
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10)
        isError = exitCode !== 0
      }
      if (pre) pre.textContent = text.replace(/\[EXIT_CODE:\d+\]\n?/g, '').replace(/\[ERROR:.*?\]\n?/g, '')

    } catch (err) {
      if (err.name === 'AbortError') {
        await api.post('/api/execute/kill')
        Toast.show('Process terminated', 'warning')
        return
      }
      if (pre) pre.textContent = `STREAM ERROR: ${err.message}`
      isError = true
      exitCode = 1
    } finally {
      stopHangTimer()
      if (btn) {
        btn.classList.remove('streaming')
        btn.disabled = false
      }
      Storage.save()
    }

    setDone(!isError, exitCode)
    if (isError) Toast.show(`Command failed (exit ${exitCode})`, 'error')
  },

  async kill(btnEl) {
    if (!btnEl) return
    btnEl.textContent = 'KILLING...'
    await api.post('/api/execute/kill')
    const warningDiv = btnEl.closest('.hang-warning')
    if (warningDiv) warningDiv.innerHTML = 'Process terminated'
    Toast.show('Process terminated', 'warning')
  },

  log(message, isError = false) {
    const area = this.area
    if (!area) return

    if (this._clearTimeout) {
      clearTimeout(this._clearTimeout)
      this._clearTimeout = null
    }

    area.querySelector('.placeholder')?.remove()
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

    entry.classList.add(ANIM_CLASSES.entryPulse)
    entry.addEventListener('animationend', () => {
      entry.classList.remove(ANIM_CLASSES.entryPulse)
    }, { once: true })

    bindEntryActions(entry)
    area.appendChild(entry)

    const entries = area.querySelectorAll('.output-entry')
    if (entries.length > CONFIG.MAX_ENTRIES) {
      const oldEntry = entries[0]
      if (oldEntry._stopHangTimer) oldEntry._stopHangTimer()
      if (oldEntry._terminalController && !oldEntry._terminalController.signal.aborted) {
        oldEntry._terminalController.abort()
      }
      oldEntry.remove()
    }

    applyVirtualScroll(area)
    area.scrollTop = area.scrollHeight
    Storage.save()
  },

  clearAll() {
    const area = this.area
    if (!area) return

    const entries = area.querySelectorAll('.output-entry')
    if (entries.length === 0) return

    entries.forEach(e => {
      if (e._stopHangTimer) e._stopHangTimer()
      if (e._terminalController && !e._terminalController.signal.aborted) {
        e._terminalController.abort()
      }
    })

    entries.forEach((e, i) => {
      e.classList.add(ANIM_CLASSES.entryStagger)
      e.style.transitionDelay = `${i * 40}ms`
    })

    this._clearTimeout = setTimeout(() => {
      this._clearTimeout = null
      if (area) {
        area.innerHTML = `
          <div class="placeholder">
            <div class="placeholder-icon">
              <span class="placeholder-cursor">&gt;_</span>
            </div>
            <div class="placeholder-text">READY FOR COMMANDS</div>
            <div class="placeholder-hint">Ctrl+Enter to execute \u00B7 Extra keys below</div>
          </div>`
      }
      Toast.show('Terminal cleared', 'info')
    }, entries.length * 40 + 250)
  },

  navUp() {
    if (this.idx < this.history.length - 1) {
      this.idx++
      const input = document.getElementById('cmdInput')
      if (input) {
        input.value = this.history[this.history.length - 1 - this.idx]
        input.dispatchEvent(new Event('input'))
      }
    }
  },

  navDown() {
    if (this.idx > 0) {
      this.idx--
      const input = document.getElementById('cmdInput')
      if (input) {
        input.value = this.history[this.history.length - 1 - this.idx]
        input.dispatchEvent(new Event('input'))
      }
    } else if (this.idx === 0) {
      this.idx = -1
      const input = document.getElementById('cmdInput')
      if (input) {
        input.value = ''
        input.dispatchEvent(new Event('input'))
      }
    }
  }
}

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
    if (!this.dropdown || !this.input) return
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
    this.dropdown.innerHTML = ''
    matches.forEach((m, i) => {
      const div = document.createElement('div')
      div.className = 'suggestion-item'
      div.dataset.index = i
      div.dataset.value = m
      div.textContent = m
      const hint = document.createElement('span')
      hint.className = 'suggestion-hint'
      hint.textContent = '\u2191\u2193 enter'
      div.appendChild(hint)
      div.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.select(m)
      })
      this.dropdown.appendChild(div)
    })
    this.show()
  },

  handleKey(e) {
    if (!this.visible || !this.dropdown) return
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
      if (this.activeIndex === -1) {
        this.hide()
        Terminal.navUp()
      }
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
    if (!this.input) return
    this.input.value = value
    this.input.focus()
    this.hide()
    this.input.dispatchEvent(new Event('input'))
  },

  show() {
    if (this.dropdown) {
      this.dropdown.classList.remove('hidden')
      this.visible = true
    }
  },

  hide() {
    if (this.dropdown) {
      this.dropdown.classList.add('hidden')
      this.visible = false
      this.activeIndex = -1
    }
  }
}