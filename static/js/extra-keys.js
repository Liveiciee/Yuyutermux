import { api } from './api.js'
import { Terminal, Toast } from './terminal.js'

export const ExtraKeys = {
  defaults: [
    { label: 'TAB', value: '\t', type: 'insert' },
    { label: '|', value: '|', type: 'insert' },
    { label: '~', value: '~', type: 'insert' },
    { label: '/', value: '/', type: 'insert' },
    { label: '-', value: '-', type: 'insert' },
    { label: '_', value: '_', type: 'insert' },
    { label: '>', value: '>', type: 'insert' },
    { label: '<', value: '<', type: 'insert' },
    { label: '*', value: '*', type: 'insert' },
    { label: '$', value: '$', type: 'insert' },
    { label: 'CTRL+C', value: '', type: 'action', action: 'kill' },
    { label: 'ESC', value: '', type: 'action', action: 'clear' },
    { label: '\u2191', value: '', type: 'action', action: 'up' },
    { label: '\u2193', value: '', type: 'action', action: 'down' }
  ],

  init() {
    const row = document.getElementById('extraKeysRow')
    if (!row) return
    
    row.innerHTML = ''
    this.defaults.forEach(key => {
      const btn = document.createElement('button')
      btn.className = 'extra-key' + (key.type === 'action' ? ' accent' : '')
      btn.textContent = key.label
      btn.onclick = (e) => {
        // Ripple effect
        btn.classList.remove('ripple')
        // Force reflow so animation restarts if clicked rapidly
        void btn.offsetWidth
        btn.classList.add('ripple')
        setTimeout(() => btn.classList.remove('ripple'), 400)
        this.handle(key)
      }
      row.appendChild(btn)
    })
  },

  handle(key) {
    const input = document.getElementById('cmdInput')
    input.focus()
    
    if (key.type === 'insert') {
      const start = input.selectionStart
      const end = input.selectionEnd
      const text = input.value
      input.value = text.substring(0, start) + key.value + text.substring(end)
      input.selectionStart = input.selectionEnd = start + key.value.length
      input.dispatchEvent(new Event('input'))
      return
    }
    
    if (key.type === 'action') {
      this.handleAction(key.action, input)
    }
  },

  handleAction(action, input) {
    const charCount = document.getElementById('inputCharCount')
    
    switch (action) {
      case 'clear':
        input.value = ''
        input.style.height = '22px'
        if (charCount) charCount.textContent = '0 chars'
        break
      case 'kill':
        api.post('/api/execute/kill')
        Toast.show('Kill signal sent', 'warning')
        break
      case 'up':
        Terminal.navUp()
        break
      case 'down':
        Terminal.navDown()
        break
    }
  }
}