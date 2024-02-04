import {header, stringify_for_header} from '../value_explorer_utils.js'
import {el} from './domutils.js'
import {has_error} from '../calltree.js'

export class IO_Trace {
  constructor(ui, el) {
    this.el = el
    this.ui = ui

    this.el.addEventListener('keydown', (e) => {

      if(e.key == 'Escape') {
        this.ui.editor.focus()
      }

      if(e.key == 'F4') {
        this.ui.editor.focus()
      }

    })
  }

  clear() {
    this.el.innerHTML = ''
    this.is_rendered = false
  }

  render_io_trace(state, force) {
    if(force) {
      this.is_rendered = false
    }

    if(this.is_rendered) {
      return
    }

    this.is_rendered = true

    this.el.innerHTML = ''

    const items = state.io_trace ?? []
    // Number of items that were used during execution
    const used_count = state.rt_cxt.io_trace_index ?? items.length

    for(let i = 0; i < items.length; i++) {
      const item = items[i]
      if(item.type == 'resolution') {
        continue
      }
      const is_used = i < used_count
      this.el.appendChild(
        el('div', 
          'call_header ' 
            + (has_error(item) ? 'error ' : '') 
            + (is_used ? '' : 'native '),
          item.name,
          '(' ,
          item.args.map(a => header(a)).join(', '),
          '): ' ,
          (item.ok ? stringify_for_header(item.value) : item.error.toString()) 
        )
      )
    }
  }

}
