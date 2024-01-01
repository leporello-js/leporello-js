import {el, scrollIntoViewIfNeeded} from './domutils.js'
import {exec} from '../index.js'
import {header} from '../value_explorer_utils.js'
import {with_version_number_of_log} from '../cmd.js'

export class Logs {
  constructor(ui, el) {
    this.el = el
    this.ui = ui
    this.el.addEventListener('keydown', (e) => {

      if(e.key == 'Escape') {
        this.ui.editor.focus()
      }

      if(e.key == 'Enter') {
        // TODO reselect call node that was selected previously by calling
        // 'calltree.navigate_logs_position'
        this.ui.editor.focus()
      }

      if(e.key == 'F1') {
        this.ui.editor.focus_value_explorer(this.el)
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

  rerender_logs(state, logs) {
    this.el.innerHTML = ''
    this.render_logs(state, null, logs)
  }

  render_logs(state, prev_logs, logs) {
    for(
      let i = prev_logs == null ? 0 : prev_logs.logs.length ; 
      i < logs.logs.length; 
      i++
    )
    {
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
          with_version_number_of_log(state, log, () =>
            // TODO fn_link, for function args, like in ./calltree.js
            log.args.map(a => header(a)).join(', ')
          )
        )
      )
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
