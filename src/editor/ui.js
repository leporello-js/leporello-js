import {exec, get_state, open_app_window} from '../index.js'
import {Editor} from './editor.js'
import {Files} from './files.js'
import {CallTree} from './calltree.js'
import {Logs} from './logs.js'
import {IO_Trace} from './io_trace.js'
import {ShareDialog} from './share_dialog.js'
import {el} from './domutils.js'

export class UI {
  constructor(container, state){
    this.open_app_window = this.open_app_window.bind(this)

    this.files = new Files(this)

    this.tabs = {}
    this.debugger = {}

    container.appendChild(
      (this.root = el('div', 'root',
        this.editor_container = el('div', 'editor_container'),
        el('div', 'bottom', 
          this.debugger_container = el('div', 'debugger',
            this.debugger_loaded = el('div', 'debugger_wrapper', 
              el('div', 'tabs', 
                this.tabs.calltree = el('div', 'tab', 
                  el('a', {
                    click: () => this.set_active_tab('calltree'),
                    href: 'javascript: void(0)',
                  }, 'Call tree (F2)')
                ),
                this.tabs.logs = el('div', 'tab', 
                  el('a', {
                    click: () => this.set_active_tab('logs'),
                    href: 'javascript: void(0)',
                  }, 'Logs (F3)')
                ),
                this.tabs.io_trace = el('div', 'tab', 
                  el('a', {
                    click: () => this.set_active_tab('io_trace'),
                    href: 'javascript: void(0)',
                  }, 'IO trace (F4)')
                ),
              ),
              this.debugger.calltree = el('div', {
                'class': 'tab_content', 
                tabindex: 0,
              }),
              this.debugger.logs = el('div', {
                'class': 'tab_content logs', 
                tabindex: 0,
              }),
              this.debugger.io_trace = el('div', {
                'class': 'tab_content io_trace', 
                tabindex: 0,
              }),
            ),
            this.debugger_loading = el('div', 'debugger_wrapper',
              this.debugger_loading_message = el('div'),
            ),
          ),
          this.problems_container = el('div', {"class": 'problems_container', tabindex: 0},
            this.problems = el('div'),
          )
        ),

        this.files.el,

        this.statusbar = el('div', 'statusbar',
          this.status = el('div', 'status'),
          this.current_module = el('div', 'current_module'),

          el('a', {
            'class': 'statusbar_action first',
            href: 'javascript: void(0)',
            click: () => exec('clear_io_trace')
          },
            'Clear IO trace (F6)'
          ),

          el('a', {
            'class': 'statusbar_action open_app_window_button',
            href: 'javascript: void(0)',
            click: this.open_app_window,
          },
            '(Re)open app window (F7)',
            this.open_app_window_tooltip = el('div', {
              'class': 'open_app_window_tooltip', 
            },
              'Click here to open app window'
            )
          ),

          this.options = el('div', 'options',
            el('label', {'for': 'standard'},
              el('input', {
                id: 'standard', 
                type: 'radio', 
                name: 'keyboard',
                checked: localStorage.keyboard == 'standard' 
                         || localStorage.keyboard == null,
                change: () => {
                  this.editor.set_keyboard_handler('standard')
                }
              }),
              'Standard'
            ),
            el('label', {'for': 'vim'},
              el('input', {
                id: 'vim', 
                type: 'radio', 
                name: 'keyboard',
                checked: localStorage.keyboard == 'vim',
                change: () => {
                  this.editor.set_keyboard_handler('vim')
                }
              }),
              'VIM'
            )
          ),
          el('a', {
              'class': 'show_help',
              href: 'javascript: void(0)', 
              click: () => this.help_dialog.showModal(),
            }, 
            'Help',
          ),
          el('a', {
              'class': 'github',
              href: 'https://github.com/leporello-js/leporello-js',
              target: '__blank',
            }, 'Github'),
          el('button', {
              'class': 'share_button',
              'click': () => this.share_dialog.showModal(),
            }, 'Share'),
          this.help_dialog = this.render_help(),
          this.share_dialog = new ShareDialog().el,
        )
      ))
    )

    window.addEventListener('keydown', () => this.clear_status(), true)
    window.addEventListener('click', () => this.clear_status(), true)

    window.addEventListener('keydown', e => {
      if(e.key == 'F2') {
        this.set_active_tab('calltree')
      }

      if(e.key == 'F3'){
        this.set_active_tab('logs')
      }

      if(e.key == 'F4'){
        this.set_active_tab('io_trace')
      }

      if(e.key == 'F6'){
        exec('clear_io_trace')
      }

      if(e.key == 'F7'){
        this.open_app_window()
      }
    })

    this.editor = new Editor(this, this.editor_container)

    this.calltree = new CallTree(this, this.debugger.calltree)
    this.logs = new Logs(this, this.debugger.logs)
    this.io_trace = new IO_Trace(this, this.debugger.io_trace)

    // TODO jump to another module
    // TODO use exec
    const jump_to_fn_location = (e) => {
      let loc
      if((loc = e.target.dataset.location) != null){
        loc = JSON.parse(loc)
        this.editor.set_cursor_position(loc.index)
        this.editor.focus()
      }
    }

    // TODO when click in calltree, do not jump to location, navigateCallTree
    // instead
    this.debugger.calltree.addEventListener('click', jump_to_fn_location)

    this.render_current_module(state.current_module)

    this.set_active_tab('calltree', true)
  }

  set_active_tab(tab_id, skip_focus = false) {
    this.active_tab = tab_id
    Object.values(this.tabs).forEach(el => el.classList.remove('active'))
    this.tabs[tab_id].classList.add('active')
    Object.values(this.debugger).forEach(el => el.style.display = 'none')
    this.debugger[tab_id].style.display = 'block'

    if(tab_id == 'io_trace') {
      this.io_trace.render_io_trace(get_state(), false)
    }

    if(!skip_focus) {
      this.debugger[tab_id].focus()
    }
  }

  open_app_window() {
    this.toggle_open_app_window_tooltip(false)
    localStorage.onboarding_open_app_window = true
    open_app_window(get_state())
  }

  render_debugger_loading(state) {
    this.debugger_container.style = ''
    this.problems_container.style = 'display: none'

    this.debugger_loaded.style = 'display: none'
    this.debugger_loading.style = ''

    this.debugger_loading_message.innerText = 
      state.loading_external_imports_state != null
        ? 'Loading external modules...'
        : 'Waiting...'
  }

  render_debugger(state) {
    this.debugger_container.style = ''
    this.problems_container.style = 'display: none'

    this.debugger_loading.style = 'display: none'
    this.debugger_loaded.style = ''

    this.calltree.render_calltree(state)
    this.logs.render_logs(null, state.logs)
  }

  render_io_trace(state) {
    // render lazily, only if selected
    if(this.active_tab == 'io_trace') {
      this.io_trace.render_io_trace(state, true)
    } else {
      // Do not render until user switch to the tab
      this.io_trace.clear()
    }
  }

  render_problems(problems) {
    this.debugger_container.style = 'display: none'
    this.problems_container.style = ''
    this.problems.innerHTML = ''
    problems.forEach(p => {
      const s = this.editor.get_session(p.module)
      const pos = s.doc.indexToPosition(p.index)
      const module = p.module == '' ? "*scratch*" : p.module
      this.problems.appendChild(
        el('div', 'problem', 
          el('a', {
            href: 'javascript:void(0)', 
            click: () => exec('goto_problem', p)
          },
            `${module}:${pos.row + 1}:${pos.column} - ${p.message}`
          )
        )
      )
    })
  }

  set_status(text){
    this.current_module.style = 'display: none'
    this.status.style = ''
    this.status.innerText = text
  }

  clear_status(){
    this.render_current_module(get_state().current_module)
  }

  render_current_module(current_module) {
    this.status.style = 'display: none'
    this.current_module.innerText = 
      current_module == ''
        ? '*scratch*'
        : current_module
    this.current_module.style = ''
  }

  render_help() {
    const options =  [
      ['Focus value explorer', 'F1'],
      ['Navigate value explorer', '← → ↑ ↓ or hjkl'],
      ['Leave value explorer', 'F1 or Esc'],
      ['Focus call tree view', 'F2'],
      ['Navigate call tree view', '← → ↑ ↓ or hjkl'],
      ['Leave call tree view', 'F2 or Esc'],
      ['Focus console logs', 'F3'],
      ['Navigate console logs', '↑ ↓ or jk'],
      ['Leave console logs', 'F3 or Esc'],
      ['Focus IO trace', 'F4'],
      ['Leave IO trace', 'F4 or Esc'],
      ['Jump to definition', 'F5', 'gd'],
      ['Expand selection to eval expression', 'Ctrl-↓ or Ctrl-j'],
      ['Collapse selection', 'Ctrl-↑ or Ctrl-k'],
      ['Step into call', 'Ctrl-i', '\\i'],
      ['Step out of call', 'Ctrl-o', '\\o'],
      ['When in call tree view, jump to return statement', 'Enter'],
      ['When in call tree view, jump to function arguments', 'a'],
      ['Clear IO trace', 'F6'],
      ['(Re)open run window (F7)', 'F7'],
    ]
    return el('dialog', 'help_dialog',
      el('table', 'help',
        el('thead', '', 
          el('th', '', 'Action'),
          el('th', 'key', 'Standard'),
          el('th', 'key', 'VIM'),
        ),
        el('tbody', '', 
          options.map(([text, standard, vim]) => 
            el('tr', '', 
              el('td', '', text),
              el('td', 
                vim == null 
                  ? {'class': 'key spanned', colspan: 2} 
                  : {'class': 'key'}, 
                standard
              ),
              vim == null 
                ? null 
                : el('td', 'key', vim),
            )
          )
        )
      ),
      el('form', {method: 'dialog'}, 
        el('button', null, 'Close'),
      ),
    )
  }

  toggle_open_app_window_tooltip(on) {
    this.open_app_window_tooltip.classList.toggle('on', on)
  }

}
