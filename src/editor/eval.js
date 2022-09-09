import {ValueExplorer} from './value_explorer.js'
import {el} from './domutils.js'

export class Eval {

  constructor(ui, container) {
    this.ui = ui
    this.container = container

    this.container.addEventListener('keydown', (e) => {
      if(e.key == 'Escape') {
        this.escape()
      }
    })

    // TODO jump to fn location, view function calls
    // container.addEventListener('click', jump_to_fn_location)

  }

  escape() {
    if(this.focusedFrom == null) {
      this.ui.editor.focus()
    } else {
      this.focusedFrom.focus()
      this.focusedFrom = null
    }
  }

  show_value(value){
    this.container.innerHTML = ''
    const container = el('div', {'class': 'eval_content', tabindex: 0})
    this.container.appendChild(container)
    const explorer = new ValueExplorer({
      container,
      on_escape: () => this.escape()
    })
    explorer.render(value)
  }

  show_error(error){
    this.container.innerHTML = ''
    this.container.appendChild(el('span', 'eval_error', error.toString()))
  }

  show_value_or_error({ok, value, error}){
    if(ok) {
      this.show_value(value)
    } else {
      this.show_error(error)
    }
  }

  clear_value_or_error() {
    this.container.innerHTML = ''
  }

  focus_value_or_error(from) {
    this.focusedFrom = from
    if(this.container.childElementCount != 1) {
      throw new Error('illegal state')
    }
    this.container.children[0].focus()
  }


}
