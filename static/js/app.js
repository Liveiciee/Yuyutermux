import { Terminal, Toast, StatusBar, Suggestions } from './terminal.js'
import { Storage } from './storage.js'
import { ExtraKeys } from './extra-keys.js'
import { FileManager } from './file-manager.js'
import { ModalKeyboard } from './modal-keyboard.js'
import { Editor } from './editor.js'
import { GlobalSearch } from './global-search.js'
import { GitHub } from './github.js'
import { Auth } from './api.js'

// Store interval references for cleanup
let _cwdInterval = null
// Use {} not null — typeof null === 'object' in JS, so StatusBar.init() would
// try to set null.interval = id, which crashes in strict mode (ES modules).
let _connectionInterval = {}

document.addEventListener('DOMContentLoaded', () => {
  // Wrap each init in try-catch so one failure doesn't kill ALL event handlers.
  try { initSplash() } catch (e) { console.error('[initSplash]', e) }
  try { initInput() } catch (e) { console.error('[initInput]', e) }
  try { initModules() } catch (e) { console.error('[initModules]', e) }
  try { initTerminal() } catch (e) { console.error('[initTerminal]', e) }
  try { initFileManager() } catch (e) { console.error('[initFileManager]', e) }
  try { initGitHub() } catch (e) { console.error('[initGitHub]', e) }
  try { initPWA() } catch (e) { console.error('[initPWA]', e) }
  try { initAuth() } catch (e) { console.error('[initAuth]', e) }
  try { initShortcuts() } catch (e) { console.error('[initShortcuts]', e) }
})

function initAuth() {
  const logoutBtn = document.getElementById('logoutBtn')
  if (logoutBtn) {
    logoutBtn.style.display = ''
    logoutBtn.onclick = () => {
      if (confirm('Logout? Session akan berakhir.')) {
        Auth.logout()
      }
    }
  }
}

function initSplash() {
  const splash = document.getElementById('splashScreen')
  const barFill = splash?.querySelector('.splash-bar-fill')
  const splashStatus = splash?.querySelector('.splash-status')
  const container = document.querySelector('.paper-container')

  const steps = [
    { pct: '30%', text: 'Loading modules...' },
    { pct: '60%', text: 'Initializing terminal...' },
    { pct: '85%', text: 'Connecting to server...' },
    { pct: '100%', text: 'Ready!' }
  ]

  let idx = 0
  const advance = () => {
    if (idx >= steps.length) return

    const step = steps[idx]
    if (barFill) barFill.style.width = step.pct
    if (splashStatus) splashStatus.textContent = step.text
    idx++

    if (idx < steps.length) {
      setTimeout(advance, 300 + Math.random() * 200)
    } else {
      setTimeout(() => {
        splash?.classList.add('fade-out')
        container?.classList.add('visible')
        setTimeout(() => splash?.remove(), 600)
      }, 300)
    }
  }

  if (barFill) barFill.classList.add('animate')
  setTimeout(advance, 200)
}

function initInput() {
  // BUG FIX: Was missing null guards — if the element doesn't exist in the DOM
  // (e.g. a template change or partial render), addEventListener() would throw
  // "Cannot read properties of null", crashing the entire initInput() call and
  // leaving the char-count display permanently broken.
  const cmdInput = document.getElementById('cmdInput')
  const charCount = document.getElementById('inputCharCount')
  if (!cmdInput || !charCount) return

  cmdInput.addEventListener('input', () => {
    cmdInput.style.height = '22px'
    cmdInput.style.height = Math.min(cmdInput.scrollHeight, 120) + 'px'
    charCount.textContent = `${cmdInput.value.length} chars`
  })
}

function initTerminal() {
  const cmdInput = document.getElementById('cmdInput')
  if (!cmdInput) return

  document.getElementById('sendBtn').onclick = () => Terminal.run()
  cmdInput.onkeydown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      Terminal.run()
    }
  }

  document.getElementById('clearAllBtn').onclick = () => Terminal.clearAll()

  const updateCwd = async () => {
    try {
      const res = await fetch('/api/execute/cwd')
      if (res.ok) {
        const data = await res.json()
        if (res.status !== 401) {
          const el = document.getElementById('statusDir')
          if (el && data.success && data.display) {
            el.textContent = data.display
          }
        }
      }
    } catch { /* server might not be ready yet */ }
  }
  updateCwd()
  _cwdInterval = setInterval(updateCwd, 2000)
}

function initFileManager() {
  const fileModal = document.getElementById('fileModal')
  const extraKeysPaper = document.getElementById('extraKeysPaper')
  const browser = document.getElementById('fileBrowser')

  if (!fileModal || !browser) {
    console.error('[initFileManager] Missing DOM elements')
    return
  }

  browser.addEventListener('click', (e) => {
    const item = e.target.closest('.file-item')
    if (!item) return

    const { path, type } = item.dataset

    if (e.target.closest('.file-del')) {
      e.stopPropagation()
      FileManager.deleteItem(path)
    } else if (e.target.closest('.file-download')) {
      e.stopPropagation()
      FileManager.downloadFile(path)
    } else {
      FileManager.openItem(path, type)
    }
  })

  document.getElementById('editFileBtn').onclick = () => {
    try {
      fileModal.showModal()
    } catch (err) {
      console.warn('[fileModal] showModal failed:', err)
      fileModal.show?.() || (fileModal.hidden = false)
    }
    extraKeysPaper?.classList.add('hidden')
    FileManager.load('')
  }

  document.getElementById('modalCancel').onclick = () => {
    fileModal.close()
    extraKeysPaper?.classList.remove('hidden')
  }

  document.getElementById('modalSave').onclick = () => FileManager.save()
  document.getElementById('modalNewFile').onclick = () => FileManager.createNew()
  document.getElementById('modalRename').onclick = () => FileManager.renameFile()
  document.getElementById('refreshFileListBtn').onclick = () => FileManager.load(FileManager.dir)

  const uploadInput = document.getElementById('uploadInput')
  if (uploadInput) {
    uploadInput.onchange = (e) => {
      if (e.target.files[0]) FileManager.uploadFile(e.target.files[0])
      e.target.value = ''
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fileModal.open) {
      fileModal.close()
      extraKeysPaper?.classList.remove('hidden')
    }
  })
}

function initGitHub() {
  GitHub.init()
  document.getElementById('gitBtn')?.addEventListener('click', () => GitHub.open())
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js').catch(() => {})
  }

  let deferredPrompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    document.getElementById('pwaInstallPrompt')?.classList.remove('hidden')
  })

  const installBtn = document.getElementById('pwaInstallBtn')
  if (installBtn) {
    installBtn.onclick = async () => {
      if (!deferredPrompt) return
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      document.getElementById('pwaInstallPrompt')?.classList.add('hidden')
      deferredPrompt = null
      if (outcome === 'accepted') Toast.show('App installed!', 'success')
    }
  }

  document.getElementById('pwaDismissBtn')?.addEventListener('click', () => {
    document.getElementById('pwaInstallPrompt')?.classList.add('hidden')
  })
}

function initModules() {
  // Initialize Toast FIRST — it is used by StatusBar and other modules
  ModalKeyboard.init()
  ExtraKeys.init()
  Toast.init()
  StatusBar.init(_connectionInterval)
  Suggestions.init()
  Storage.load()
  Editor.init()
  GlobalSearch.init()
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    // BUG FIX: Was missing null checks — getElementById() returns null if the
    // element doesn't exist. Accessing .value/.focus() on null throws a TypeError
    // that, inside a 'keydown' listener, silently swallows the shortcut and can
    // leave keyboard handling in a broken state for the rest of the session.

    // Ctrl+K → Clear terminal input
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault()
      const input = document.getElementById('cmdInput')
      const charCount = document.getElementById('inputCharCount')
      if (!input) return
      if (document.activeElement !== input) input.focus()
      input.value = ''
      input.style.height = '22px'
      if (charCount) charCount.textContent = '0 chars'
      return
    }

    // Ctrl+L → Clear terminal output
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      Terminal.clearAll()
      document.getElementById('cmdInput')?.focus()
      return
    }

    // Ctrl+F → Open FILES modal
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault()
      document.getElementById('editFileBtn')?.click()
      return
    }

    // Ctrl+G → Open GIT modal
    if (e.ctrlKey && e.key === 'g') {
      e.preventDefault()
      document.getElementById('gitBtn')?.click()
      return
    }

    // Ctrl+/ → Toggle extra keys panel
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault()
      document.getElementById('extraKeysPaper')?.classList.toggle('hidden')
      return
    }
  })
}

// Cleanup intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
  if (_cwdInterval) clearInterval(_cwdInterval)
  if (_connectionInterval?.interval) clearInterval(_connectionInterval.interval)
})
