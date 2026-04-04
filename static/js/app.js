import { Terminal, Toast, StatusBar, Suggestions } from './terminal.js'
import { Storage } from './storage.js'
import { ExtraKeys } from './extra-keys.js'
import { FileManager } from './file-manager.js'
import { ModalKeyboard } from './modal-keyboard.js'
import { Editor } from './editor.js'
import { GlobalSearch } from './global-search.js'
import { GitHub } from './github.js'
import { Auth } from './api.js'

let _cwdInterval = null
let _connectionInterval = {}

document.addEventListener('DOMContentLoaded', () => {
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
    // ← FIXED: Jangan set style.display, biarkan class .hidden bekerja
    // Jika tombol harus muncul setelah login, JS backend atau logic lain yang mengatur class-nya
    // Disini kita hanya set event handler
    logoutBtn.onclick = () => {
      if (confirm('Logout? Session akan berakhir.')) Auth.logout()
    }
  }
}

function initSplash() {
  const splash = document.getElementById('splashScreen')
  const barFill = splash?.querySelector('.splash-bar-fill')
  const splashStatus = splash?.querySelector('.splash-status')
  const container = document.querySelector('.paper-container')
  if (!barFill) return

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
    if (idx < steps.length) setTimeout(advance, 300 + Math.random() * 200)
    else setTimeout(() => {
      splash?.classList.add('fade-out')
      container?.classList.add('visible')
      setTimeout(() => splash?.remove(), 600)
    }, 300)
  }
  barFill.classList.add('animate')
  setTimeout(advance, 200)
}

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

function initTerminal() {
  const sendBtn = document.getElementById('sendBtn')
  const clearBtn = document.getElementById('clearAllBtn')
  const cmdInput = document.getElementById('cmdInput')
  if (sendBtn) sendBtn.onclick = () => Terminal.run()
  if (clearBtn) clearBtn.onclick = () => Terminal.clearAll()
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
      const res = await fetch('/api/execute/cwd')
      if (res.ok) {
        const data = await res.json()
        if (res.status !== 401 && data.success && data.display) {
          const el = document.getElementById('statusDir')
          if (el) el.textContent = data.display
        }
      }
    } catch { /* ignore */ }
  }
  updateCwd()
  _cwdInterval = setInterval(updateCwd, 2000)
}

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
  if (modalSave) modalSave.onclick = () => FileManager.save()
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fileModal.open) {
      fileModal.close()
      extraKeysPaper?.classList.remove('hidden')
    }
  })
}

function initGitHub() {
  GitHub.init()
  const gitBtn = document.getElementById('gitBtn')
  if (gitBtn) gitBtn.addEventListener('click', () => GitHub.open())
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js').catch(() => {})
  }
  let deferredPrompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    const promptDiv = document.getElementById('pwaInstallPrompt')
    if (promptDiv) promptDiv.classList.remove('hidden')
  })
  const installBtn = document.getElementById('pwaInstallBtn')
  if (installBtn) {
    installBtn.onclick = async () => {
      if (!deferredPrompt) return
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      const promptDiv = document.getElementById('pwaInstallPrompt')
      if (promptDiv) promptDiv.classList.add('hidden')
      deferredPrompt = null
      if (outcome === 'accepted') Toast.show('App installed!', 'success')
    }
  }
  const dismissBtn = document.getElementById('pwaDismissBtn')
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      document.getElementById('pwaInstallPrompt')?.classList.add('hidden')
    })
  }
}

function initModules() {
  ModalKeyboard.init()
  ExtraKeys.init()
  Toast.init()
  // ← FIXED: Hapus parameter yang tidak digunakan
  StatusBar.init() 
  Suggestions.init()
  Storage.load()
  Editor.init()
  GlobalSearch.init()
}

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
      return
    }
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      Terminal.clearAll()
      document.getElementById('cmdInput')?.focus()
      return
    }
    // ← FIXED: Ganti Ctrl+F (browser find) ke Ctrl+E (Edit)
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault()
      document.getElementById('editFileBtn')?.click()
      return
    }
    if (e.ctrlKey && e.key === 'g') {
      e.preventDefault()
      document.getElementById('gitBtn')?.click()
      return
    }
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault()
      document.getElementById('extraKeysPaper')?.classList.toggle('hidden')
      return
    }
  })
}

window.addEventListener('beforeunload', () => {
  if (_cwdInterval) clearInterval(_cwdInterval)
  if (_connectionInterval?.interval) clearInterval(_connectionInterval.interval)
})
