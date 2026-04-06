import { Terminal, Toast, StatusBar, Suggestions } from './terminal.js'
import { Storage } from './storage.js'
import { ExtraKeys } from './extra-keys.js'
import { FileManager } from './file-manager.js'
import { ModalKeyboard } from './modal-keyboard.js'
import { Editor } from './editor.js'
import { GlobalSearch } from './global-search.js'
import { GitHub } from './github.js'
import { Auth } from './api.js'

/* ===== INTERNAL STATE ===== */
let _cwdInterval = null
let _connectionInterval = {}

/* ===== BOOT ===== */
document.addEventListener('DOMContentLoaded', () => {
  try { initModules() } catch (e) { console.error('initModules:', e) }
  try { initInput() } catch (e) { console.error('initInput:', e) }
  try { initTerminal() } catch (e) { console.error('initTerminal:', e) }
  try { initFileManager() } catch (e) { console.error('initFileManager:', e) }
  try { initGitHub() } catch (e) { console.error('initGitHub:', e) }
  try { initPWA() } catch (e) { console.error('initPWA:', e) }
  try { initAuth() } catch (e) { console.error('initAuth:', e) }
  try { initShortcuts() } catch (e) { console.error('initShortcuts:', e) }
  /* Splash dismissed LAST — deterministic: all inits complete */
  initSplash()
})

/* ===== AUTH ===== */
function initAuth() {
  const logoutBtn = document.getElementById('logoutBtn')
  if (!logoutBtn) return
  if (document.cookie.includes('yuyu_authed')) {
    logoutBtn.classList.remove('hidden')
  }
  logoutBtn.onclick = () => {
    if (confirm('Logout? Session akan berakhir.')) Auth.logout()
  }
}

/* ===== SPLASH ===== */
function initSplash() {
  const splash = document.getElementById('splashScreen')
  const container = document.querySelector('.paper-container')
  if (!splash) return

  /* Deterministic exit: called after all init functions completed.
     requestAnimationFrame ensures the browser has painted the initial
     state so the CSS transition actually animates. */
  requestAnimationFrame(() => {
    splash.classList.add('fade-out')
    container?.classList.add('visible')
    setTimeout(() => splash.remove(), 600)
  })
}

/* ===== INPUT ===== */
function initInput() {
  const cmdInput = document.getElementById('cmdInput')
  const charCount = document.getElementById('inputCharCount')
  if (!cmdInput || !charCount) return

  cmdInput.addEventListener('input', () => {
    cmdInput.style.height = '22px'
    cmdInput.style.height = Math.min(cmdInput.scrollHeight, 120) + 'px'
    charCount.textContent = `${cmdInput.value.length} chars`
  })
}

/* ===== TERMINAL ===== */
function initTerminal() {
  const sendBtn = document.getElementById('sendBtn')
  const clearBtn = document.getElementById('clearAllBtn')
  const cmdInput = document.getElementById('cmdInput')

  if (sendBtn) sendBtn.onclick = () => Terminal.run()
  
  // FIX: CLR button now clears localStorage terminal history as well
  if (clearBtn) clearBtn.onclick = () => {
    Terminal.clearAll();
    localStorage.removeItem('terminalHistory');
    if (window.terminalHistory) window.terminalHistory = [];
  }

  if (cmdInput) {
    cmdInput.onkeydown = (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault()
        Terminal.run()
      }
    }
  }

  const updateCwd = async () => {
    try {
      const res = await fetch('/api/execute/cwd', {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) {
        const data = await res.json()
        if (res.status !== 401 && data.success && data.display) {
          const el = document.getElementById('statusDir')
          if (el) el.textContent = data.display
        }
      }
    } catch (e) {
      console.log("CWD FAIL", e)
    }
  }

  updateCwd()
  _cwdInterval = setInterval(updateCwd, 5000)
}

/* ===== FILE MANAGER ===== */
function initFileManager() {
  const fileModal = document.getElementById('fileModal')
  const extraKeysPaper = document.getElementById('extraKeysPaper')
  const browser = document.getElementById('fileBrowser')
  if (!fileModal || !browser) return

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

  const editBtn = document.getElementById('editFileBtn')
  const modalCancel = document.getElementById('modalCancel')
  const modalSave = document.getElementById('modalSave')
  const modalNewFile = document.getElementById('modalNewFile')
  const modalRename = document.getElementById('modalRename')
  const refreshBtn = document.getElementById('refreshFileListBtn')
  const uploadInput = document.getElementById('uploadInput')

  if (editBtn) {
    editBtn.onclick = () => {
      try { fileModal.showModal() } catch { fileModal.show?.() || (fileModal.hidden = false) }
      extraKeysPaper?.classList.add('hidden')
      FileManager.load('')
    }
  }

  if (modalCancel) {
    modalCancel.onclick = () => {
      fileModal.close()
      extraKeysPaper?.classList.remove('hidden')
    }
  }

  if (modalSave) modalSave.onclick = () => {
    Editor.syncBlocksToTextarea()
    FileManager.save()
  }
  if (modalNewFile) modalNewFile.onclick = () => FileManager.createNew()
  if (modalRename) modalRename.onclick = () => FileManager.renameFile()
  if (refreshBtn) refreshBtn.onclick = () => FileManager.load(FileManager.dir)

  if (uploadInput) {
    uploadInput.onchange = (e) => {
      if (e.target.files[0]) FileManager.uploadFile(e.target.files[0])
      e.target.value = ''
    }
  }

  const globalSearchBtn = document.getElementById('btn-global-search')
  if (globalSearchBtn) globalSearchBtn.onclick = () => GlobalSearch.show()

  // Block mode toggle
  const modeToggle = document.getElementById('editorModeToggle')
  if (modeToggle) {
    modeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]')
      if (!btn) return
      const targetMode = btn.dataset.mode
      if (targetMode === Editor.mode) return
      Editor.toggleMode()
    })
  }

  // Handle unsupported language event
  document.addEventListener('editor:blockmode-unsupported', (e) => {
    Toast.show(`Block mode not supported for ${e.detail.lang}`, 'warning')
  })

  // Fullscreen editor — uses Fullscreen API (hides browser address bar & nav)
  const modalBox = document.getElementById('modalBox')
  const fullscreenBtn = document.getElementById('editorFullscreenBtn')
  const fullscreenExitBtn = document.getElementById('fullscreenExitBtn')
  const fullscreenModeToggle = document.getElementById('fullscreenModeToggle')

  function enterFullscreen() {
    // Sync file info to fullscreen bar
    const fnEl = document.getElementById('fullscreenFileName')
    const langEl = document.getElementById('fullscreenLang')
    const origFn = document.getElementById('editorFileName')
    const origLang = document.getElementById('editorLang')
    if (fnEl && origFn) fnEl.textContent = origFn.textContent
    if (langEl && origLang) langEl.textContent = origLang.textContent

    modalBox.classList.add('fullscreen-editor')

    // Use Fullscreen API to hide browser UI (address bar, nav bar)
    const el = fileModal || modalBox
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {})
    } else if (el && el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen()
    }
  }

  function exitFullscreen() {
    modalBox.classList.remove('fullscreen-editor')

    // Exit browser fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (document.webkitFullscreenElement) {
      document.webkitExitFullscreen()
    }
  }

  function isFullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement)
  }

  if (fullscreenBtn) fullscreenBtn.onclick = () => enterFullscreen()
  if (fullscreenExitBtn) fullscreenExitBtn.onclick = () => exitFullscreen()

  // Fullscreen TEXT/BLOCK toggle — same logic as editor header toggle
  const fsModeToggle = document.getElementById('fullscreenModeToggle')
  if (fsModeToggle) {
    fsModeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]')
      if (!btn) return
      const targetMode = btn.dataset.mode
      if (targetMode === Editor.mode) return
      Editor.toggleMode()
    })
  }

  // Listen for native fullscreen exit (user pressed Escape or swipe)
  document.addEventListener('fullscreenchange', () => {
    if (!isFullscreenActive()) {
      modalBox?.classList.remove('fullscreen-editor')
    }
  })
  document.addEventListener('webkitfullscreenchange', () => {
    if (!isFullscreenActive()) {
      modalBox?.classList.remove('fullscreen-editor')
    }
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fileModal.open) {
      if (isFullscreenActive()) {
        exitFullscreen()
        return
      }
      fileModal.close()
      extraKeysPaper?.classList.remove('hidden')
    }
  })
}

/* ===== GITHUB ===== */
function initGitHub() {
  GitHub.init()
  const gitBtn = document.getElementById('gitBtn')
  if (gitBtn) gitBtn.addEventListener('click', () => GitHub.open())
}

/* ===== PWA ===== */
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js').catch(() => {})
  }
}

/* ===== MODULES ===== */
function initModules() {
  ModalKeyboard.init()
  ExtraKeys.init()
  Toast.init()
  StatusBar.init()
  Suggestions.init()
  Storage.load()
  Editor.init()
  GlobalSearch.init()
}

/* ===== SHORTCUTS ===== */
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault()
      const input = document.getElementById('cmdInput')
      const charCount = document.getElementById('inputCharCount')
      if (!input) return
      if (document.activeElement !== input) input.focus()
      input.value = ''
      input.style.height = '22px'
      if (charCount) charCount.textContent = '0 chars'
    }
    if (e.ctrlKey && e.key === 'b') {
      const fileModal = document.getElementById('fileModal')
      if (fileModal?.open) {
        e.preventDefault()
        Editor.toggleMode()
      }
    }
  })
}

/* ===== CLEANUP ===== */
window.addEventListener('beforeunload', () => {
  if (_cwdInterval) clearInterval(_cwdInterval)
  if (_connectionInterval?.interval) clearInterval(_connectionInterval.interval)
})