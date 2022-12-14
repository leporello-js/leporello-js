import {el, scrollIntoViewIfNeeded} from './domutils.js'
import {exec} from '../index.js'
import {header} from './value_explorer.js'

export class Logs {
  constructor(ui, el) {
    this.el = el
    this.ui = ui
    this.el.addEventListener('keydown', (e) => {

      if(e.key == 'Enter') {
        // TODO reselect call node that was selected previously by calling
        // 'calltree.navigate_logs_position'
        this.ui.editor.focus()
      }

      if(e.key == 'F1') {
        this.ui.editor.focus_value_explorer(this.el)
      }

      if(e.key == 'F2') {
        this.ui.set_active_tab('calltree')
      }

      if(e.key == 'F3') {
        this.ui.editor.focus()
      }

      if(e.key == 'ArrowDown' || e.key == 'j'){
        exec('calltree.navigate_logs_increment', 1)
      }

      if(e.key == 'ArrowUp' || e.key == 'k'){
        exec('calltree.navigate_logs_increment', -1)
      }
    })
  }

  render_logs(prev_logs, logs) {

    if(prev_logs?.logs != logs.logs) {

      this.el.innerHTML = ''
      for(let i = 0; i < logs.logs.length; i++) {
        const log = logs.logs[i]
        this.el.appendChild(
          el('div', 
            'log call_header ' 
              + (log.log_fn_name == 'error' ? 'error' : '') 
              // Currently console.log calls from native fns (like Array::map)
              // are not recorded, so next line is dead code
              + (log.module == null ? ' native' : '')
            ,
            el('a', {
              href: 'javascript: void(0)', 
              click: () => exec('calltree.navigate_logs_position', i),
            },
              (log.module == '' ? '*scratch*' : log.module)
              + ': '
              + (
                log.toplevel
                ? 'toplevel'
                : 'fn ' + (log.parent_name == '' ? 'anonymous' : log.parent_name)
              )
              + ':'
            ),
            ' ',
            log.args.map(a => header(a)).join(', ')
          )
        )
      }

    }

    if(prev_logs?.log_position != logs.log_position) {
      if(prev_logs?.logs == logs.logs && prev_logs?.log_position != null) {
        this.el.children[prev_logs.log_position].classList.remove('active')
      }
      if(logs.log_position != null) {
        const active_child = this.el.children[logs.log_position]
        active_child.classList.add('active')
        scrollIntoViewIfNeeded(this.el, active_child)
      }
    }
  }

}
