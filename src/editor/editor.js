import {exec, get_state} from '../index.js'
import {ValueExplorer} from './value_explorer.js'
import {stringify_for_header} from '../value_explorer_utils.js'
import {el, stringify, fn_link} from './domutils.js'

/*
  normalize events 'change' and 'changeSelection':
  - change is debounced
  - changeSelection must not fire if 'change' is fired. So for every keystroke,
    either change or changeSelection should be fired, not both
  - changeSelection fired only once (ace fires it multiple times for single
    keystroke)
*/
const normalize_events = (ace_editor, {
  on_change, 
  on_change_selection, 
  is_change_selection_supressed,
  on_change_immediate,
}) => {
  const TIMEOUT = 1000

  let state 

  const set_initial_state = () => {
    state = {}
  }

  set_initial_state()

  const flush = () => {
    if(state.change_args != null) {
      on_change(...state.change_args)
    } else if(state.change_selection_args != null) {
      on_change_selection(...state.change_selection_args)
    }
    set_initial_state()
  }

  ace_editor.on('change', (...args) => {
    on_change_immediate()

    if(state.tid != null) {
      clearTimeout(state.tid)
    }

    state.change_args = args

    state.tid = setTimeout(() => {
      state.tid = null
      flush()
    }, TIMEOUT)
  })

  ace_editor.on('changeSelection', (...args) => {
    // TODO debounce changeSelection?
    if(is_change_selection_supressed()) {
      return
    }
    if(state.tid != null) {
      // flush is already by `change`, skip `changeSelection`
      return
    }
    state.change_selection_args = args
    if(!state.is_flush_set) {
      state.is_flush_set = true
      Promise.resolve().then(() => {
        if(state.tid == null) {
          flush()
        }
      })
    }
  })
}

export class Editor { 

  constructor(ui, editor_container){
    this.ui = ui
    this.editor_container = editor_container

    this.make_resizable()

    this.markers = {}
    this.sessions = {}

    this.ace_editor = globalThis.ace.edit(this.editor_container)

    this.ace_editor.setOptions({
      behavioursEnabled: false,
      // Scroll past end for value explorer
      scrollPastEnd: 100 /* Allows to scroll 100*<screen size> */,

      enableLiveAutocompletion: false,
      enableBasicAutocompletion: true,
    })

    normalize_events(this.ace_editor, {
      on_change: () => {
        try {
          exec('input', this.ace_editor.getValue(), this.get_cursor_position())
        } catch(e) {
          // Do not throw Error to ACE because it breaks typing
          console.error(e)
          this.ui.set_status(e.message)
        }
      },

      on_change_immediate: () => {
        this.unembed_value_explorer()
      },

      on_change_selection: () => {
        try {
          if(!this.is_change_selection_supressed) {
            exec('move_cursor', this.get_cursor_position())
          }
        } catch(e) {
          // Do not throw Error to ACE because it breaks typing
          console.error(e)
          this.ui.set_status(e.message)
        }
      },

      is_change_selection_supressed: () => {
        return this.is_change_selection_supressed
      }
    })
    
    this.focus()

    this.init_keyboard()
  }

  focus() {
    this.ace_editor.focus()
  }

  supress_change_selection(action) {
    try {
      this.is_change_selection_supressed = true
      action()
    } finally {
      this.is_change_selection_supressed = false
    }
  }

  ensure_session(file, code) {
    let session = this.sessions[file]
    if(session == null) {
      session = globalThis.ace.createEditSession(code)
      this.sessions[file] = session
      session.setUseWorker(false)
      session.setOptions({
        mode: "ace/mode/javascript",
        tabSize: 2,
        useSoftTabs: true,
      })
    }
    return session
  }

  get_session(file) {
    return this.sessions[file]
  }

  switch_session(file) {
    // Supress selection change triggered by switching sessions
    this.supress_change_selection(() => {
      this.ace_editor.setSession(this.get_session(file))
    })
  }

  unembed_value_explorer() {
    if(this.widget == null) {
      return
    }

    const session = this.ace_editor.getSession()
    const widget_bottom = this.widget.el.getBoundingClientRect().bottom
    session.widgetManager.removeLineWidget(this.widget) 

    if(this.widget.is_dom_el) {
      /*
        if cursor moves below widget, then ace editor first adjusts scroll,
        and then widget gets remove, so scroll jerks. We have to set scroll
        back
      */
      // distance travelled by cursor
      const distance = session.selection.getCursor().row - this.widget.row
      if(distance > 0) {
        const line_height = this.ace_editor.renderer.lineHeight
        const scroll = widget_bottom - this.editor_container.getBoundingClientRect().bottom
        if(scroll > 0) {
          const scrollTop = session.getScrollTop()
          session.setScrollTop(session.getScrollTop() - scroll - line_height*distance)
        }
      }
    }

    this.widget = null
  }

  update_value_explorer_margin() {
    if(this.widget != null) {
      const session = this.ace_editor.getSession()

      // Calculate left margin in such way that value explorer does not cover
      // code. It has sufficient left margin so all visible code is to the left
      // of it
      const lines_count = session.getLength()
      let margin = 0
      for(
        let i = this.widget.row; 
        i <= this.ace_editor.renderer.getLastVisibleRow();
        i++
      ) {
        margin = Math.max(margin, session.getLine(i).length)
      }

      // Next line sets margin based on whole file
      //const margin = this.ace_editor.getSession().getScreenWidth() 

      this.widget.content.style.marginLeft = (margin + 1) + 'ch'
    }
  }

  embed_value_explorer({node, index, length, result: {ok, value, error}}) {
    this.unembed_value_explorer()

    const session = this.ace_editor.getSession()

    let content
    const container = el('div', {'class': 'embed_value_explorer_container'},
      el('div', {'class': 'embed_value_explorer_wrapper'},
        content = el('div', {
          // Ace editor cannot render widget before the first line. So we
          // render in on the next line and apply translate
          'class': 'embed_value_explorer_content', 
          tabindex: 0
        })
      )
    )

    let initial_scroll_top

    const escape = () => {
      if(initial_scroll_top != null) {
        // restore scroll
        session.setScrollTop(initial_scroll_top)
      }
      if(this.widget.return_to == null) {
        this.focus()
      } else {
        this.widget.return_to.focus()
      }
      // TODO select root in value explorer
    }

    container.addEventListener('keydown', e => {
      if(e.key == 'Escape') {
        escape()
      }
    })

    if(node != null && node.type == 'function_call') {
      content.append(el('a', {
        href: 'javascript: void(0)',
        'class': 'embed_value_explorer_control',
        click: () => exec('step_into', index),
      }, 'Step into call (Enter)'))
    }

    let is_dom_el

    if(ok) {
      if(value instanceof globalThis.app_window.Element && !value.isConnected) {
        is_dom_el = true
        if(value instanceof globalThis.app_window.SVGElement) {
          // Create svg context
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.appendChild(value)
          content.appendChild(svg)
        } else {
          content.appendChild(value)
        }
      } else {
        is_dom_el = false
        const exp = new ValueExplorer({
          container: content,
          event_target: container,
          on_escape: escape,
          scroll_to_element: t => {
            if(initial_scroll_top == null) {
              initial_scroll_top = session.getScrollTop()
            }
            let scroll
            const out_of_bottom = t.getBoundingClientRect().bottom - this.editor_container.getBoundingClientRect().bottom
            if(out_of_bottom > 0) {
              session.setScrollTop(session.getScrollTop() + out_of_bottom)
            }
            const out_of_top = this.editor_container.getBoundingClientRect().top - t.getBoundingClientRect().top
            if(out_of_top > 0) {
              session.setScrollTop(session.getScrollTop() - out_of_top)
            }
          },
        })

        exp.render(value)
      }
    } else {
      is_dom_el = false
      content.appendChild(el('span', 'eval_error', stringify_for_header(error)))
    }

    const widget = this.widget = {
      node,
      row: is_dom_el
       ? session.doc.indexToPosition(index + length).row
       : session.doc.indexToPosition(index).row,
      fixedWidth: true,
      el: container,
      content,
      is_dom_el,
    }


    if (!session.widgetManager) {
      const LineWidgets = require("ace/line_widgets").LineWidgets;
      session.widgetManager = new LineWidgets(session);
      session.widgetManager.attach(this.ace_editor);
    }

    if(is_dom_el) {
      container.classList.add('is_dom_el')
      session.widgetManager.addLineWidget(widget) 
    } else {
      container.classList.add('is_not_dom_el')
      const line_height = this.ace_editor.renderer.lineHeight
      content.style.transform = `translate(0px, -${line_height}px)`
      // hide element before margin applied to avoid jitter
      container.style.display = 'none'
      session.widgetManager.addLineWidget(widget) 
      // update_value_explorer_margin relies on getLastVisibleRow which can be
      // incorrect because it may be executed right after set_cursor_position
      // which is async in ace_editor. Use setTimeout
      setTimeout(() => {
        this.update_value_explorer_margin()
        container.style.display = ''
      }, 0)
    }

  }

  focus_value_explorer(return_to) {
    if(this.widget != null) {
      this.widget.return_to = return_to
      this.widget.content.focus({preventScroll: true})
    }
  }

  set_keyboard_handler(type) {
    if(type != null) {
      localStorage.keyboard = type
    }
    this.ace_editor.setKeyboardHandler(
      type == 'vim' ? "ace/keyboard/vim" : null
    )
  }

  init_keyboard(){
    this.set_keyboard_handler(localStorage.keyboard)

    // Intercept Enter to execute step_into if function_call selected
    this.ace_editor.keyBinding.addKeyboardHandler(($data, hashId, keyString, keyCode, e) => {
      if(keyString == 'return') {
        if(this.widget?.node?.type == 'function_call') {
          exec('step_into', this.widget.node.index)
          return {command: "null"} // to stop other handlers
        }
      }
    })

    const VimApi = require("ace/keyboard/vim").CodeMirror.Vim

    // Remove commands binded to function keys that we are going to redefine
    this.ace_editor.commands.removeCommand('openCommandPallete')
    this.ace_editor.commands.removeCommand('toggleFoldWidget')
    this.ace_editor.commands.removeCommand('goToNextError')


    this.ace_editor.commands.bindKey("F5", "goto_definition");
    VimApi._mapCommand({
      keys: 'gd',
      type: 'action',
      action: 'aceCommand',
      actionArgs: { name: "goto_definition" }
    })
    this.ace_editor.commands.addCommand({
      name: 'goto_definition',
      exec: (editor) => {
        this.goto_definition()
      }
    })


    this.ace_editor.commands.bindKey("F1", "focus_value_explorer");
    this.ace_editor.commands.addCommand({
      name: 'focus_value_explorer',
      exec: (editor) => {
        this.focus_value_explorer()
      }
    })


    this.ace_editor.commands.bindKey("ctrl-i", 'step_into')
    VimApi._mapCommand({
      keys: '\\i',
      type: 'action',
      action: 'aceCommand',
      actionArgs: { name: "step_into" }
    })
    this.ace_editor.commands.addCommand({
      name: 'step_into',
      exec: (editor) => {
        exec('step_into', this.get_cursor_position())
      }
    })


    this.ace_editor.commands.bindKey("ctrl-o", 'step_out')
    VimApi._mapCommand({
      keys: '\\o',
      type: 'action',
      action: 'aceCommand',
      actionArgs: { name: "step_out" }
    })
    this.ace_editor.commands.addCommand({
      name: 'step_out',
      exec: (editor) => {
        exec('calltree.arrow_left')
      }
    })


    this.ace_editor.commands.addCommand({
      name: 'expand_selection',
      exec: () => {
        exec('eval_selection', this.get_cursor_position(), true)
      }
    })
    this.ace_editor.commands.addCommand({
      name: 'collapse_selection',
      exec: () => {
        exec('eval_selection', this.get_cursor_position(), false)
      }
    })
    this.ace_editor.commands.bindKey("ctrl-j", 'expand_selection')
    this.ace_editor.commands.bindKey("ctrl-down", 'expand_selection')
    this.ace_editor.commands.bindKey("ctrl-k", 'collapse_selection')
    this.ace_editor.commands.bindKey("ctrl-up", 'collapse_selection')


    this.ace_editor.commands.addCommand({
      name: 'edit',
      exec: (editor, input) => {
        const module = input.args == null ? '' : input.args[0]
        exec('change_current_module', module)
      }
    })
    VimApi.defineEx("edit", "e", function(cm, input) {
      cm.ace.execCommand("edit", input)
    })

    this.ace_editor.commands.addCommand({
      name: 'buffer',
      exec: (editor, input) => {
        const search_query = input.args == null ? '' : input.args[0]
        // TODO move to cmd.js
        const module = search_query == '' 
          ? ''
          : Object.keys(get_state().files).find(name => name.includes(search_query))
        if(module != null) {
          exec('change_current_module', module)
        }
      }
    })
    VimApi.defineEx("buffer", "b", function(cm, input) {
      cm.ace.execCommand("buffer", input)
    })

    // TODO remove my custom binding
    VimApi.map('jj', '<Esc>', 'insert')
  }

  add_marker(file, className, from, to){
    const session = this.get_session(file)
    const from_pos = session.doc.indexToPosition(from)
    const to_pos = session.doc.indexToPosition(to)
    const markerId = session.addMarker(
      new globalThis.ace.Range(from_pos.row,from_pos.column,to_pos.row,to_pos.column), 
      className
    )
    if(this.markers[file] == null){
      this.markers[file] = []
    }
    this.markers[file].push({className, from, to, markerId})
  }

  remove_markers_of_type(file, type){
    if(this.markers[file] == null){
      this.markers[file] = []
    }
    const for_removal = this.markers[file].filter(h => h.className == type)
    const session = this.get_session(file)
    for(let marker of for_removal){
      session.removeMarker(marker.markerId)
    }
    this.markers[file] = this.markers[file].filter(h => h.className != type)
  }


  get_cursor_position(file){
    const session = file == null
      ? this.ace_editor.getSession()
      : this.get_session(file)

    if(session == null) {
      // Session was not created for file
      throw new Error('illegal state')
    }

    return session.doc.positionToIndex(session.selection.getCursor())
  }

  set_cursor_position(index){
    if(index == null) {
      throw new Error('illegal state')
    }

    const pos = this.ace_editor.session.doc.indexToPosition(index)

    this.supress_change_selection(() => {
      const pos = this.ace_editor.session.doc.indexToPosition(index)
      this.ace_editor.moveCursorToPosition(pos)
      // Moving cursor performs selection, clear it
      this.ace_editor.clearSelection()
      const first = this.ace_editor.renderer.getFirstVisibleRow()
      const last =  this.ace_editor.renderer.getLastVisibleRow()
      if(pos.row < first || pos.row > last) {
        this.ace_editor.scrollToLine(pos.row)
      }
    })
  }

  goto_definition(){
    const index = this.get_cursor_position()
    exec('goto_definition', index)
  }

  for_each_session(cb) {
    for(let file in this.sessions) {
      cb(file, this.sessions[file])
    }
  }

  make_resizable() {

    const apply_height = () => {
      this.editor_container.style.height = localStorage.editor_height + 'vh'
    }

    let last_resize_time = new Date().getTime()

    window.addEventListener('resize', () => {
      last_resize_time = new Date().getTime()
    })

    // Save editor_height on resize and restore it on reopen
    if(localStorage.editor_height != null) {
      apply_height()
    }

    let is_first_run = true

    new ResizeObserver((e) => {
      if(is_first_run) {
        // Resize observer callback seems to fire immediately on create
        is_first_run = false
        return
      }
      if(new Date().getTime() - last_resize_time < 100) {
        // Resize observer triggered by window resize, skip
        return
      }

      // See https://stackoverflow.com/a/57166828/795038
      // ace editor must be updated based on container size change
      this.ace_editor.resize()

      const height = this.editor_container.offsetHeight / window.innerHeight * 100
      localStorage.editor_height = height
      // resize applies height in pixels. Wait for it and apply height in vh
      setTimeout(apply_height, 0)

    }).observe(this.editor_container)
  }
}

