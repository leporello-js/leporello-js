import {exec, get_state} from '../index.js'
import {ValueExplorer} from './value_explorer.js'
import {el, stringify, fn_link} from './domutils.js'
import {FLAGS} from '../feature_flags.js'

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

    this.markers = {}
    this.sessions = {}

    this.ace_editor = ace.edit(this.editor_container)

    this.ace_editor.setOptions({
      behavioursEnabled: false,
      // Scroll past end for value explorer
      scrollPastEnd: 100 /* Allows to scroll 100*<screen size> */,
    })

    normalize_events(this.ace_editor, {
      on_change: () => {
        try {
          exec('input', this.ace_editor.getValue(), this.get_caret_position())
        } catch(e) {
          // Do not throw Error to ACE because it breaks typing
          console.error(e)
          this.ui.set_status(e.message)
        }
      },

      on_change_immediate: () => {
        this.update_value_explorer_margin()
      },

      on_change_selection: () => {
        try {
          if(!this.is_change_selection_supressed) {
            exec('move_cursor', this.get_caret_position())
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
      session = ace.createEditSession(code)
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
    if(this.widget != null) {
      this.ace_editor.getSession().widgetManager.removeLineWidget(this.widget) 
      this.widget = null
    }
  }

  update_value_explorer_margin() {
    if(this.widget != null) {
      this.widget.content.style.marginLeft = 
        (this.ace_editor.getSession().getScreenWidth() + 1) + 'ch'
    }
  }

  embed_value_explorer({index, result: {ok, value, error}}) {
    this.unembed_value_explorer()

    const session = this.ace_editor.getSession()
    const pos = session.doc.indexToPosition(index)
    const row = pos.row

    const line_height = this.ace_editor.renderer.lineHeight

    let content
    const container = el('div', {'class': 'embed_value_explorer_container'},
      el('div', {'class': 'embed_value_explorer_wrapper'},
        content = el('div', {
          // Ace editor cannot render widget before the first line. So we
          // render in on the next line and apply translate
          'style': `transform: translate(0px, -${line_height}px)`,
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

    if(ok) {
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
    } else {
      content.appendChild(el('span', 'eval_error', error.toString()))
    }

    this.widget = {
       row,
       fixedWidth: true,
       el: container,
       content,
     }

    this.update_value_explorer_margin()

    const LineWidgets = require("ace/line_widgets").LineWidgets;
    if (!session.widgetManager) {
      session.widgetManager = new LineWidgets(session);
      session.widgetManager.attach(this.ace_editor);
    }
    session.widgetManager.addLineWidget(this.widget) 
  }

  focus_value_explorer(return_to) {
    if(FLAGS.embed_value_explorer) {
      if(this.widget != null) {
        this.widget.return_to = return_to
        this.widget.content.focus({preventScroll: true})
      }
    } else {
      if(get_state().selection_state != null) {
        this.ui.eval.focus_value_or_error()
      }
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

    const VimApi = require("ace/keyboard/vim").CodeMirror.Vim


    this.ace_editor.commands.bindKey("F2", "switch_window");
    VimApi._mapCommand({
      keys: '<C-w>',
      type: 'action',
      action: 'aceCommand',
      actionArgs: { name: "switch_window" }
    })
    this.ace_editor.commands.addCommand({
      name: 'switch_window',
      exec: (editor) => {
        this.ui.set_active_tab('calltree')
      }
    })

    this.ace_editor.commands.bindKey("F3", "focus_logs");
    this.ace_editor.commands.addCommand({
      name: 'focus_logs',
      exec: (editor) => {
        this.ui.set_active_tab('logs')
      }
    })


    this.ace_editor.commands.bindKey("F4", "goto_definition");
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
        exec('step_into', this.get_caret_position())
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
        exec('eval_selection', this.get_caret_position(), true)
      }
    })
    this.ace_editor.commands.addCommand({
      name: 'collapse_selection',
      exec: () => {
        exec('eval_selection', this.get_caret_position(), false)
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

    // TODO remove my custom binding
    VimApi.map('jj', '<Esc>', 'insert')
  }

  add_marker(file, className, from, to){
    const session = this.get_session(file)
    const from_pos = session.doc.indexToPosition(from)
    const to_pos = session.doc.indexToPosition(to)
    const markerId = session.addMarker(
      new ace.Range(from_pos.row,from_pos.column,to_pos.row,to_pos.column), 
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


  get_caret_position(file){
    const session = file == null
      ? this.ace_editor.getSession()
      : this.get_session(file)

    // Session was not created for file
    if(session == null) {
      return null
    }

    return session.doc.positionToIndex(session.selection.getCursor())
  }

  set_caret_position(index){
    if(index == null) {
      throw new Error('illegal state')
    }

    const pos = this.ace_editor.session.doc.indexToPosition(index)
    console.log('set caret position', index, pos)

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
    const index = this.get_caret_position()
    exec('goto_definition', index)
  }

  for_each_session(cb) {
    for(let file in this.sessions) {
      cb(file, this.sessions[file])
    }
  }
}

