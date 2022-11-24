import {exec, get_state, open_run_window} from '../index.js'
import {Editor} from './editor.js'
import {Files} from './files.js'
import {CallTree} from './calltree.js'
import {Logs} from './logs.js'
import {Eval} from './eval.js'
import {el} from './domutils.js'
import {FLAGS} from '../feature_flags.js'

export class UI {
  constructor(container, state){
    this.change_entrypoint = this.change_entrypoint.bind(this)

    this.files = new Files(this)

    this.tabs = {}
    this.debugger = {}

    container.appendChild(
      (this.root = el('div', 
          'root ' + (FLAGS.embed_value_explorer ? 'embed_value_explorer' : ''),
        this.editor_container = el('div', 'editor_container'),
        FLAGS.embed_value_explorer
          ? null
          : (this.eval_container = el('div', {class: 'eval'})),
        el('div', 'bottom', 
          this.debugger_container = el('div', 'debugger',
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
              this.entrypoint_select = el('div', 'entrypoint_select')
            ),
            this.debugger.calltree = el('div', {
              'class': 'tab_content', 
              tabindex: 0,
            }),
            this.debugger.logs = el('div', {
              'class': 'tab_content logs', 
              tabindex: 0,
            }),
          ),
          this.problems_container = el('div', {"class": 'problems', tabindex: 0}),
        ),

        this.files.el,

        this.statusbar = el('div', 'statusbar',
          this.status = el('div', 'status'),
          this.current_module = el('div', 'current_module'),
          /*
          // Fullscreen cancelled on escape, TODO
          el('a', {
            "class" : 'request_fullscreen',
            href: 'javascript:void(0)',
            click: e => document.body.requestFullscreen(),
          },
            'Fullscreen'
          ),
          */

          el('a', {
            'class': 'open_run_window',
            href: 'javascript: void(0)',
            click: open_run_window,
          },
            '(Re)open run window (F6)'
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
          this.help_dialog = this.render_help(),
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

      if(e.key == 'F5'){
        this.fullscreen_editor()
      }

      if(e.key == 'F6'){
        open_run_window()
      }
    })

    if(!FLAGS.embed_value_explorer) {
      this.eval = new Eval(this, this.eval_container)
    } else {
      // Stub
      this.eval = {
        show_value_or_error(){},
        clear_value_or_error(){},
        focus_value_or_error(){},
      }
    }

    this.editor = new Editor(this, this.editor_container)

    this.calltree = new CallTree(this, this.debugger.calltree)
    this.logs = new Logs(this, this.debugger.logs)

    // TODO jump to another module
    // TODO use exec
    const jump_to_fn_location = (e) => {
      let loc
      if((loc = e.target.dataset.location) != null){
        loc = JSON.parse(loc)
        this.editor.set_caret_position(loc.index)
        this.editor.focus()
      }
    }

    // TODO when click in calltree, do not jump to location, navigateCallTree
    // instead
    this.debugger.calltree.addEventListener('click', jump_to_fn_location)

    this.render_entrypoint_select(state)
    this.render_current_module(state.current_module)

    this.set_active_tab('calltree', true)
  }

  set_active_tab(tab_id, skip_focus = false) {
    Object.values(this.tabs).forEach(el => el.classList.remove('active'))
    this.tabs[tab_id].classList.add('active')
    Object.values(this.debugger).forEach(el => el.style.display = 'none')
    this.debugger[tab_id].style.display = 'block'
    if(!skip_focus) {
      this.debugger[tab_id].focus()
    }
  }

  render_entrypoint_select(state) {
    this.entrypoint_select.replaceChildren(
      el('span', 'entrypoint_title', 'entrypoint'),
      el('select', {
        click: e => e.stopPropagation(),
        change: this.change_entrypoint,
      },
        Object
          .keys(state.files)
          .sort()
          .filter(f => f == '' || f.endsWith('.js') || f.endsWith('.mjs'))
          .map(f =>
            el('option', 
              state.entrypoint == f
                ? { value: f, selected: true }
                : { value: f},
              f == '' ? "*scratch*" : f
            )
          )
      )
    )
  }

  change_entrypoint(e) {
    const file = e.target.value
    const index = this.editor.get_caret_position(file)
      // if index is null, session was not created, and index after session
      // creation will be 0
      ?? 0
    exec('change_entrypoint', file, index)
    this.editor.focus()
  }

  render_debugger(state) {
    this.debugger_container.style = ''
    this.problems_container.style = 'display: none'
    this.calltree.render_calltree(state)
    this.logs.render_logs(null, state.logs)
  }

  render_problems(problems) {
    this.debugger_container.style = 'display: none'
    this.problems_container.style = ''
    this.problems_container.innerHTML = ''
    problems.forEach(p => {
      const s = this.editor.get_session(p.module)
      const pos = s.doc.indexToPosition(p.index)
      const module = p.module == '' ? "*scratch*" : p.module
      this.problems_container.appendChild(
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
      ['Jump to definition', 'F4', 'gd'],
      ['Expand selection to eval expression', 'Ctrl-↓ or Ctrl-j'],
      ['Collapse selection', 'Ctrl-↑ or Ctrl-k'],
      ['Step into call', 'Ctrl-i', '\\i'],
      ['Step out of call', 'Ctrl-o', '\\o'],
      ['When in call tree view, jump to return statement', 'Enter'],
      ['When in call tree view, jump to function arguments', 'a'],
      ['Expand/collapse editor to fullscreen', 'F5'],
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

  fullscreen_editor() {
    this.root.classList.toggle('fullscreen_editor')
    this.editor.ace_editor.resize()
    if(this.root.classList.contains('fullscreen_editor')) {
      this.editor.focus()
    }
  }

}
