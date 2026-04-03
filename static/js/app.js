import { Terminal, Toast, StatusBar, Suggestions } from './terminal.js'
import { Storage } from './storage.js'
import { ExtraKeys } from './extra-keys.js'
import { FileManager } from './file-manager.js'
import { ModalKeyboard } from './modal-keyboard.js'
import { Editor } from './editor.js'
import { GlobalSearch } from './global-search.js'
import { GitHub } from './github.js'
import { Auth } from './api.js'

// FIX: Store interval references for cleanup
let _cwdInterval = null
// FIX: Use {} not null — typeof null === 'object' in JS, so StatusBar.init() would
// try to set null.interval = id, which crashes in strict mode (ES modules),
// killing Editor.init() and every init after it.
let _connectionInterval = {}

document.addEventListener('DOMContentLoaded', () => {
  // FIX: Wrap each init in try-catch so one failure doesn't kill ALL event handlers.
  // Previously, if initModules() threw, initTerminal/initFileManager/initGitHub never ran —
  // making ALL buttons (send, git modal, file upload) appear completely dead.
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
    barFill.style.width = step.pct
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
  const cmdInput = document.getElementById('cmdInput')
  const charCount = document.getElementById('inputCharCount')

  cmdInput.addEventListener('input', () => {
    cmdInput.style.height = '22px'
    cmdInput.style.height = Math.min(cmdInput.scrollHeight, 120) + 'px'
    charCount.textContent = `${cmdInput.value.length} chars`
  })
}

function initTerminal() {
  const cmdInput = document.getElementById('cmdInput')

  document.getElementById('sendBtn').onclick = () => Terminal.run()
  cmdInput.onkeydown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      Terminal.run()
    }
  }

  document.getElementById('clearAllBtn').onclick = () => Terminal.clearAll()

  // BUG FIX #11: CWD status bar update — sebelumnya poll /api/health yang TIDAK punya
  //   field "display" di response-nya (hanya {"status":"ok","service":"yuyutermux"}),
  //   jadi kondisi `if (el && data.display)` SELALU false → CWD tidak pernah update.
  //   Fix: poll /api/execute/cwd yang return {"cwd":"~","display":"~"}.
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
  // FIX: Store interval reference for cleanup
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
      // FIX: If dialog already open or browser doesn't support showModal,
      // fall back to removing [hidden] attribute
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

  // FIX: Upload uses <label for="uploadInput"> in HTML — no JS click handler needed.
  // The label's for="uploadInput" attribute natively triggers the file picker on all platforms,
  // including mobile browsers where hidden input .click() often fails.
  const uploadInput = document.getElementById('uploadInput')
  uploadInput.onchange = (e) => {
    if (e.target.files[0]) FileManager.uploadFile(e.target.files[0])
    e.target.value = ''
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
    document.getElementById('pwaInstallPrompt').classList.remove('hidden')
  })

  document.getElementById('pwaInstallBtn').onclick = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    document.getElementById('pwaInstallPrompt').classList.add('hidden')
    deferredPrompt = null
    // FIX: Toast is now initialized before initPWA runs
    if (outcome === 'accepted') Toast.show('App installed!', 'success')
  }

  document.getElementById('pwaDismissBtn').onclick = () => {
    document.getElementById('pwaInstallPrompt').classList.add('hidden')
  }
}

function initModules() {
  // FIX: Initialize these FIRST — especially Toast which is used by other modules
  ModalKeyboard.init()
  ExtraKeys.init()
  Toast.init()     // Must be before StatusBar.init() and other modules that use Toast
  StatusBar.init(_connectionInterval)  // FIX: Pass reference for cleanup
  Suggestions.init()
  Storage.load()
  Editor.init()
  GlobalSearch.init()
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+K → Clear terminal input (same as ESC extra key)
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault()
      const input = document.getElementById('cmdInput')
      if (input && document.activeElement !== input) input.focus()
      input.value = ''
      input.style.height = '22px'
      document.getElementById('inputCharCount').textContent = '0 chars'
      return
    }

    // Ctrl+L → Focus terminal and clear output (same as CLR button)
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      Terminal.clearAll()
      document.getElementById('cmdInput')?.focus()
      return
    }

    // Ctrl+F → Open FILES modal (same as FILES button)
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault()
      document.getElementById('editFileBtn')?.click()
      return
    }

    // Ctrl+G → Open GIT modal (same as GIT button)
    if (e.ctrlKey && e.key === 'g') {
      e.preventDefault()
      document.getElementById('gitBtn')?.click()
      return
    }

    // Ctrl+/ → Toggle extra keys panel visibility
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault()
      const panel = document.getElementById('extraKeysPaper')
      if (panel) panel.classList.toggle('hidden')
      return
    }
  })
}

// FIX: Cleanup intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
  if (_cwdInterval) clearInterval(_cwdInterval)
  if (_connectionInterval?.interval) clearInterval(_connectionInterval.interval)
})
