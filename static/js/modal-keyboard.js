export const ModalKeyboard = {
  _ta: null,
  _box: null,
  _timeoutId: null,

  init() {
    this._ta = document.getElementById('modalContent')
    this._box = document.getElementById('modalBox')
    if (!this._ta || !this._box) return

    this._ta.addEventListener('focus', this._onFocus.bind(this))
    this._ta.addEventListener('blur', this._onBlur.bind(this))
  },

  _onFocus() {
    if (this._box) this._box.classList.add('keyboard-open')
  },

  _onBlur() {
    if (this._timeoutId) clearTimeout(this._timeoutId)
    this._timeoutId = setTimeout(() => {
      if (this._ta && this._box && document.activeElement !== this._ta) {
        this._box.classList.remove('keyboard-open')
      }
      this._timeoutId = null
    }, 200)
  },

  destroy() {
    if (this._ta) {
      this._ta.removeEventListener('focus', this._onFocus)
      this._ta.removeEventListener('blur', this._onBlur)
    }
    if (this._timeoutId) clearTimeout(this._timeoutId)
    this._ta = null
    this._box = null
  }
}