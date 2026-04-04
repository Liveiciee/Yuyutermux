import { api, esc, SERVER_HINT_HTML, SERVER_HINT_TEXT, getFileIcon } from './api.js'
import { Terminal, Toast } from './terminal.js'
import { Editor } from './editor.js'

const LANG_MAP = {
  py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', html: 'html',
  htm: 'html', css: 'css', json: 'json', md: 'markdown', yaml: 'yaml',
  yml: 'yaml', toml: 'toml', cfg: 'ini'
}

const FileTemplates = {
  error: (msg, hint = '') => `<div class="file-item" style="border-left:2px solid var(--danger)"><span class="file-name" style="color:var(--danger)">${esc(msg)}${hint}</span></div>`,
  
  item: (item, isActive, parentPath = null) => {
    const icon = getFileIcon(item.name, item.type === 'directory')
    const size = item.type === 'file' ? item.size : ''
    const activeClass = isActive ? ' active-file' : ''
    
    return `
      <div class="file-item${activeClass}" data-path="${esc(item.path)}" data-type="${item.type}">
        <span class="file-name">
          <span class="file-icon ${icon.cls}">${icon.icon}</span>
          ${esc(item.name)}
        </span>
        <span class="file-size">${size}</span>
        <div class="file-actions">
          ${item.type === 'file' ? '<button class="file-download">\u2193</button>' : ''}
          <button class="file-del">\u00D7</button>
        </div>
      </div>`
  },
  
  parentDir: (parentPath) => `
    <div class="file-item" data-path="${esc(parentPath)}" data-type="directory">
      <span class="file-name"><span class="file-icon dir">\u{1F4C1}</span> ..</span>
      <span class="file-size">PARENT</span>
    </div>`,
  
  empty: '<div class="file-item"><span class="file-name" style="color:var(--cement);justify-content:center;display:flex">EMPTY DIRECTORY</span></div>'
}

export const FileManager = {
  dir: '',
  file: '',
  content: '',

  get el() {
    return {
      browser: document.getElementById('fileBrowser'),
      path: document.getElementById('currentPathDisplay'),
      editor: document.getElementById('modalContent')
    }
  },

  async load(path = '') {
    this.dir = path
    this.el.browser.innerHTML = FileTemplates.error('Loading...')
    
    const { ok, data } = await api.get(`/api/files/list?path=${encodeURIComponent(path)}`)
    
    if (!ok) {
      this.el.browser.innerHTML = FileTemplates.error('ERROR: Failed to fetch', SERVER_HINT_HTML)
      return
    }
    
    if (data?.error) {
      this.el.browser.innerHTML = FileTemplates.error(`ERROR: ${data.error}`)
      return
    }
    
    this.el.path.textContent = data.current_path || '~/Yuyutermux'
    this.render(data.items)
  },

  render(items) {
    let html = ''
    
    if (this.dir) {
      const parent = this.dir.split('/').slice(0, -1).join('/')
      html += FileTemplates.parentDir(parent)
    }
    
    items.forEach(item => {
      const isActive = this.file === item.path
      html += FileTemplates.item(item, isActive)
    })
    
    this.el.browser.innerHTML = html || FileTemplates.empty
  },

  async openItem(path, type) {
    if (type === 'directory') {
      return this.load(path)
    }
    
    this.file = path
    this.el.editor.value = 'Loading...'
    
    const name = path.split('/').pop()
    const ext = name.split('.').pop()?.toLowerCase() || ''
    
    document.getElementById('editorFileName').textContent = name
    document.getElementById('editorLang').textContent = LANG_MAP[ext] || ext || 'text'
    document.getElementById('modalRename').classList.remove('hidden')
    
    const { ok, data } = await api.post('/api/files/read', { path })
    
    if (!ok || data?.error) {
      this.el.editor.value = `// ERROR: ${data?.error || 'Failed to fetch'}${SERVER_HINT_TEXT}`
      this.content = ''
      return
    }
    
    this.content = data.content || ''
    this.el.editor.value = this.content
    Editor.onLoad(LANG_MAP[ext] || ext || '')
    this.load(this.dir)
  },

  downloadFile(path) {
    // BUG FIX: Old version used `window.location.href = /api/files/download?path=...`
    // which navigates the current page to the download URL. If the server returns
    // a non-file response (e.g. 401 login page HTML), it replaces the entire app UI
    // with an HTML document. Using a temporary hidden <a download> element instead:
    //   1. Triggers a download dialog, not a page navigation
    //   2. If the response is not a file (401, 404), the browser handles it gracefully
    //      without disrupting the current app state
    //   3. The httponly cookie is automatically included (same-origin navigation)
    const a = document.createElement('a')
    a.href = `/api/files/download?path=${encodeURIComponent(path)}`
    a.download = path.split('/').pop() || 'download'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    // Small delay before removal so the browser has time to initiate the download
    setTimeout(() => document.body.removeChild(a), 200)
    Toast.show('Downloading...', 'info')
  },

  async deleteItem(path) {
    const name = path.split('/').pop()
    if (!confirm(`Delete "${name}"?`)) return
    
    const { ok, data } = await api.post('/api/files/delete', { path })
    
    if (ok && !data?.error) {
      Toast.show(`Deleted: ${name}`, 'success')
      this.load(this.dir)
      
      if (this.file === path) {
        this.clearEditor()
      }
    } else {
      Toast.show(!ok ? 'Connection failed' : (data?.error || 'Delete failed'), 'error')
    }
  },

  clearEditor() {
    this.file = ''
    this.content = ''
    this.el.editor.value = ''
    document.getElementById('editorFileName').textContent = 'No file selected'
    document.getElementById('editorLang').textContent = '\u2014'
    document.getElementById('modalRename').classList.add('hidden')
  },

  async save() {
    if (!this.file) {
      Toast.show('Select a file first', 'warning')
      return
    }
    
    const btn = document.getElementById('modalSave')
    const originalText = btn.innerHTML
    
    btn.innerHTML = 'SAVING...'
    btn.disabled = true
    
    const { ok, data } = await api.post('/api/files/write', { 
      path: this.file, 
      content: this.el.editor.value 
    })
    
    btn.disabled = false
    
    if (ok && data?.success) {
      this.content = this.el.editor.value
      btn.innerHTML = '\u2713 SAVED'
      const filename = this.file.split('/').pop()
      Toast.show(`${filename} saved`, 'success')
      Terminal.log(`SAVE ${filename} \u2014 File saved successfully`)
      setTimeout(() => btn.innerHTML = originalText, 1500)
    } else {
      btn.innerHTML = originalText
      Toast.show(!ok ? 'Connection failed' : (data?.error || 'Save failed'), 'error')
    }
  },

  async createNew() {
    const name = prompt('New filename:')
    if (!name) return
    
    const { ok, data } = await api.post('/api/files/create', { path: this.dir, filename: name })
    
    if (ok && data?.success) {
      Toast.show(`Created: ${name}`, 'success')
      this.load(this.dir)
    } else {
      Toast.show(!ok ? 'Connection failed' : (data?.error || 'Create failed'), 'error')
    }
  },

  async renameFile() {
    if (!this.file) return
    
    const oldName = this.file.split('/').pop()
    const newName = prompt(`Rename "${oldName}" to:`, oldName)
    if (!newName || newName === oldName) return
    
    const parent = this.file.substring(0, this.file.lastIndexOf('/'))
    const newPath = parent + '/' + newName
    
    // Read → write new → delete old (non-atomic; known limitation)
    const { ok: readOk, data: readData } = await api.post('/api/files/read', { path: this.file })
    if (!readOk || readData?.error) {
      Toast.show('Failed to read file', 'error')
      return
    }
    
    const { ok: writeOk } = await api.post('/api/files/write', { path: newPath, content: readData.content })
    if (!writeOk) {
      Toast.show('Failed to write new file', 'error')
      return
    }
    
    const { ok: delOk } = await api.post('/api/files/delete', { path: this.file })
    if (!delOk) {
      Toast.show('Failed to delete old file', 'error')
      return
    }
    
    this.file = newPath
    this.content = readData.content
    document.getElementById('editorFileName').textContent = newName
    Toast.show(`Renamed to ${newName}`, 'success')
    this.load(this.dir)
  },

  async uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', this.dir)
    
    // uploadBtn is a <label> element, not a <button> — use pointer-events/opacity
    // instead of .disabled (which has no effect on labels)
    const btn = document.getElementById('uploadBtn')
    const originalText = btn?.innerHTML
    
    if (btn) {
      btn.innerHTML = 'UPLOADING...'
      btn.style.pointerEvents = 'none'
      btn.style.opacity = '0.5'
    }
    
    try {
      // NOTE: Do NOT set Content-Type header for FormData — the browser must set
      // it automatically with the correct multipart boundary. Setting it manually
      // omits the boundary and causes the server to reject the upload.
      // The httponly cookie is sent automatically (same-origin request).
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData })

      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      const data = await res.json()
      
      if (res.ok && data.success) {
        Toast.show(`Uploaded: ${file.name}`, 'success')
        Terminal.log(`UPLOAD ${file.name} \u2014 Upload successful`)
        this.load(this.dir)
      } else {
        Toast.show(data.error || 'Upload failed', 'error')
      }
    } catch {
      Toast.show('Connection failed', 'error')
    } finally {
      if (btn) {
        btn.innerHTML = originalText
        btn.style.pointerEvents = ''
        btn.style.opacity = ''
      }
    }
  },

  async openFileWithLine(filepath, targetLine) {
    const modal = document.getElementById('fileModal')
    if (!modal.open) {
      modal.showModal()
      document.getElementById('extraKeysPaper')?.classList.add('hidden')
    }
    
    this.file = filepath
    const editor = document.getElementById('modalContent')
    editor.value = 'Loading...'
    
    const name = filepath.split('/').pop()
    const ext = name.split('.').pop()?.toLowerCase() || ''
    
    document.getElementById('editorFileName').textContent = name
    document.getElementById('editorLang').textContent = LANG_MAP[ext] || ext || 'text'
    document.getElementById('modalRename').classList.remove('hidden')
    
    const { ok, data } = await api.post('/api/files/read', { path: filepath })
    
    if (!ok || data?.error) {
      editor.value = `// ERROR: ${data?.error || 'Failed to load'}`
      return
    }
    
    this.content = data.content || ''
    editor.value = this.content
    Editor.onLoad(LANG_MAP[ext] || ext || '')
    
    // Scroll to target line (after highlight renders)
    setTimeout(() => {
      const lines = editor.value.split('\n')
      if (targetLine < 1 || targetLine > lines.length) return
      
      const lineHeight = parseInt(getComputedStyle(editor).lineHeight) || 20
      editor.scrollTop = (targetLine - 1) * lineHeight
      
      let startPos = 0
      for (let i = 0; i < targetLine - 1; i++) {
        startPos += lines[i].length + 1
      }
      const endPos = startPos + lines[targetLine - 1].length
      
      editor.focus()
      editor.setSelectionRange(startPos, endPos)
      
      // Highlight flash — apply to editorWrapper, not editor directly
      // (textarea has background: transparent !important when highlighting-on is active)
      const wrapper = document.getElementById('editorWrapper')
      if (wrapper) {
        wrapper.style.background = 'rgba(255,107,53,0.15)'
        setTimeout(() => { wrapper.style.background = '' }, 1000)
      }
    }, 100)
  }
}
