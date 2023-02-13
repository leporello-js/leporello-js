import {header, stringify_for_header} from './value_explorer.js'
import {el} from './domutils.js'
import {has_error} from '../calltree.js'

// TODO render grey items there were not used in run

export class IO_Cache {
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

  render_io_cache(items) {
    this.el.innerHTML = ''
    for(let item of items) {
      if(item.type == 'resolution') {
        continue
      }
      this.el.appendChild(
        el('div', 
          'call_header ' + (has_error(item) ? 'error' : ''),
          item.name,
          '(' ,
          // TODO fn_link, like in ./calltree.js
          item.args.map(a => header(a)).join(', '),
          '): ' ,
          (item.ok ? stringify_for_header(item.value) : item.error.toString()) 
        )
      )
    }
  }

}
