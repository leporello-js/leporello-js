import {write_file} from './filesystem.js'
import {write_example} from './examples.js'
import {color_file} from './color.js'
import {
  root_calltree_node, 
  calltree_node_loc, 
  get_deferred_calls
} from './calltree.js'
import {current_cursor_position} from './calltree.js'
import {exec, reload_app_window, FILES_ROOT} from './index.js'
import {redraw_canvas} from './canvas.js'

// Imports in the context of `app_window`, so global variables in loaded
// modules refer to that window's context 
const import_in_app_window = url => {
  return new globalThis.app_window.Function('url', `
    return import(url)
  `)(url)
}

const load_external_imports = async state => {
  if(state.loading_external_imports_state == null) {
    return
  }
  const urls = state.loading_external_imports_state.external_imports
  const results = await Promise.allSettled(
    urls.map(u => import_in_app_window(
      /^\w+:\/\//.test(u)    
        ? // starts with protocol, import as is
          u
        : // local path, load using File System Access API, see service_worker.js
          // Append special URL segment that will be intercepted in service worker
          // Note that we use the same origin as current page (where Leporello
          // is hosted), so Leporello can access window object for custom
          // `html_file`
          FILES_ROOT + '/' + u
    ))
  )
  const modules = Object.fromEntries(
    results.map((r, i) => (
      [
        urls[i],
        {
          ok: r.status == 'fulfilled',
          error: r.reason,
          module: r.value,
        }
      ]
    ))
  )
  exec('external_imports_loaded', state /* becomes prev_state */, modules)
}

const ensure_session = (ui, state, file = state.current_module) => {
  ui.editor.ensure_session(file, state.files[file])
}

const clear_file_coloring = (ui, file) => {
  ui.editor.remove_markers_of_type(file, 'evaluated_ok')
  ui.editor.remove_markers_of_type(file, 'evaluated_error')
}

const clear_coloring = ui => {
  ui.editor.for_each_session((file, session) => clear_file_coloring(ui, file))
}

const render_coloring = (ui, state) => {
  const file = state.current_module

  clear_file_coloring(ui, file)

  color_file(state, file).forEach(c => {
    ui.editor.add_marker(
      file,
      c.result.ok 
        ? 'evaluated_ok'
        : 'evaluated_error',
      c.index, 
      c.index + c.length
    )
  })
}

const render_parse_result = (ui, state) => {
  ui.editor.for_each_session((file, session) => {
    ui.editor.remove_markers_of_type(file, 'error-code')
    session.clearAnnotations()
  })

  if(!state.parse_result.ok){

    ui.editor.for_each_session((file, session) => {
      session.setAnnotations(
        state.parse_result.problems
          .filter(p => p.module == file)
          .map(p => {
            const pos = session.doc.indexToPosition(p.index)
            return {
              row: pos.row,
              column: pos.column,
              text: p.message,
              type: "error",
            }
          })
      )
    })

    state.parse_result.problems.forEach(problem => {
      ensure_session(ui, state, problem.module)
      // TODO unexpected end of input
      ui.editor.add_marker(
        problem.module,
        'error-code',
        problem.index,
        // TODO check if we can show token
        problem.token == null 
          ? problem.index + 1
          : problem.index + problem.token.length
      )
    })

    ui.render_problems(state.parse_result.problems)
  } else {
    // Ensure session for each loaded module
    Object.keys(state.parse_result.modules).forEach(file => {
      ensure_session(ui, state, file)
    })
  }
}

export const render_initial_state = (ui, state, example) => {
  ensure_session(ui, state)
  ui.editor.switch_session(state.current_module)
  if(
    example != null 
    && example.with_app_window 
    && !localStorage.onboarding_open_app_window
  ) {
    ui.toggle_open_app_window_tooltip(true)
  }
}

export const apply_side_effects = (prev, next, ui, cmd) => {
  if(prev.project_dir != next.project_dir) {
    ui.files.render(next)
  }

  if(prev.current_module != next.current_module) {
    ui.files.render_current_module(next.current_module)
  }

  if(prev.current_module != next.current_module) {
    localStorage.current_module = next.current_module
    ui.render_current_module(next.current_module)
  }

  if(prev.entrypoint != next.entrypoint) {
    localStorage.entrypoint = next.entrypoint
  }
  if(prev.html_file != next.html_file) {
    localStorage.html_file = next.html_file
  }

  if(prev.current_module != next.current_module) {
    ensure_session(ui, next)
    ui.editor.unembed_value_explorer()
    ui.editor.switch_session(next.current_module)
  }

  // Do not set cursor position on_deferred_call, because editor may be in the middle of the edition operation
  if(current_cursor_position(next) != ui.editor.get_cursor_position() && cmd != 'on_deferred_call') {
    ui.editor.set_cursor_position(current_cursor_position(next))
  }

  if(prev.loading_external_imports_state != next.loading_external_imports_state) {
    load_external_imports(next)
  }

  if(
    prev.eval_modules_state != next.eval_modules_state 
    && 
    next.eval_modules_state != null
  ) {
    const s = next.eval_modules_state
    s.promise.then(result => {
      exec('eval_modules_finished', 
        next, /* becomes prev_state */
        result, 
      )
    })
  }

  if(prev.parse_result != next.parse_result) {
    render_parse_result(ui, next)
  }
  
  if(!next.parse_result.ok) {

    ui.calltree.clear_calltree()
    clear_coloring(ui)

  } else {

    if(
      prev.calltree == null
      ||
      prev.calltree_changed_token != next.calltree_changed_token
    ) {

      // code finished executing

      const is_loading = 
        next.loading_external_imports_state != null
        ||
        next.eval_modules_state != null
      if(next.rt_cxt?.io_trace_is_replay_aborted) {
        reload_app_window()
      } else if(is_loading) {
        ui.calltree.clear_calltree()
        clear_coloring(ui)
        ui.render_debugger_loading(next)
      } else {
        // Rerender entire calltree
        ui.render_debugger(next)
        clear_coloring(ui)
        render_coloring(ui, next)
        ui.logs.rerender_logs(next, next.logs)

        if(
          prev.io_trace != next.io_trace 
          || 
          prev.rt_cxt?.io_trace_index != next.rt_cxt.io_trace_index
        ) {
          ui.render_io_trace(next)
        }
      }

    } else {

      // code was already executed before current action

      if(get_deferred_calls(prev) == null && get_deferred_calls(next) != null) {
        ui.calltree.render_deferred_calls(next)
      }

      if(
        prev.calltree != next.calltree 
        || 
        prev.calltree_node_is_expanded != next.calltree_node_is_expanded
      ) {
        ui.calltree.render_expand_node(prev, next)
      }

      const node_changed = next.current_calltree_node != prev.current_calltree_node

      if(node_changed) {
        ui.calltree.render_select_node(prev, next)
      } 

      if(prev.colored_frames != next.colored_frames) {
        render_coloring(ui, next)
      }

      ui.logs.render_logs(next, prev.logs, next.logs)


      // Redraw canvas
      if(
        prev.current_calltree_node != next.current_calltree_node
        ||
        prev.calltree_node_is_expanded != next.calltree_node_is_expanded
      ) {
        redraw_canvas(next, ui.is_focus_in_editor)
      }
    }
  }

  // Render 

  /* Eval selection */

  if(prev.selection_state != next.selection_state) {
    ui.editor.remove_markers_of_type(next.current_module, 'selection')
    const node = next.selection_state?.node
    if(node != null) {
      ui.editor.add_marker(
        next.current_module, 
        'selection', 
        node.index, 
        node.index + node.length
      )
    } 
  }


  // Value explorer
  if(prev.value_explorer != next.value_explorer) {
    if(next.value_explorer == null) {
      ui.editor.unembed_value_explorer()
    } else {
      ui.editor.embed_value_explorer(next, next.value_explorer)
    }
  }
}


export const EFFECTS = {
  set_focus: (_state, _args, ui) => {
    ui.editor.focus()
  },

  set_status: (state, [msg], ui) => {
    ui.set_status(msg)
  },
  
  save_to_localstorage(state, [key, value]){
    localStorage[key] = value
  },

  write: (state, [name, contents], ui, prev_state) => {
    if(name == '') {
      const share_id = new URL(window.location).searchParams.get('share_id')
      if(share_id == null) {
        localStorage['code'] = contents
      } else {
        const key = 'share_' + share_id
        if(localStorage['code'] == prev_state.files['']) {
          /*
            If scratch code is the same with share code, then update both

            Imagine the following scenario:

            - User shares code. URL is replaced with ?share_id=XXX
            - He keeps working on code
            - He closes browser tab and on the next day he opens app.leporello.tech
            - His work is lost (actually, he can still access it with
              ?share_id=XXX, but that not obvious

            To prevent that, we keep updating scratch code after sharing
          */
          localStorage['code'] = contents
        }
        localStorage[key] = contents
      }
    } else if(state.has_file_system_access) {
      write_file(name, contents)
    } else {
      write_example(name, contents)
    }
  }
}

