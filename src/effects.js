import {write_file} from './filesystem.js'
import {color_file} from './color.js'
import {root_calltree_node, calltree_node_loc} from './calltree.js'
import {FLAGS} from './feature_flags.js'

const ensure_session = (ui, state, file = state.current_module) => {
  ui.editor.ensure_session(file, state.files[file])
}

const clear_coloring = (ui, file) => {
  ui.editor.remove_markers_of_type(file, 'evaluated_ok')
  ui.editor.remove_markers_of_type(file, 'evaluated_error')
}

const render_coloring = (ui, state) => {
  const file = state.current_module

  clear_coloring(ui, file)

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

export const render_initial_state = (ui, state) => {
  ensure_session(ui, state)
  ui.editor.switch_session(state.current_module)
  render_parse_result(ui, state)
  if(state.current_calltree_node != null) {
    ui.render_debugger(state)
    render_coloring(ui, state)
  }
}

export const render_common_side_effects = (prev, next, command, ui) => {
  if(
    prev.project_dir != next.project_dir 
    || 
    prev.current_module != next.current_module
  ) {
    ui.render_entrypoint_select(next)
    ui.files.render(next)
  }

  if(prev.current_module != next.current_module) {
    localStorage.current_module = next.current_module
    ui.render_current_module(next.current_module)
  }

  if(prev.entrypoint != next.entrypoint) {
    localStorage.entrypoint = next.entrypoint
  }

  if(prev.current_module != next.current_module) {
    ensure_session(ui, next)
    ui.editor.unembed_value_explorer()
    ui.editor.switch_session(next.current_module)
  }

  if(prev.parse_result != next.parse_result) {
    render_parse_result(ui, next)
  }

  if(!next.parse_result.ok) {

    ui.calltree.clear_calltree()
    ui.editor.for_each_session((file, session) => clear_coloring(ui, file))
    ui.editor.unembed_value_explorer()

  } else {

    if(
      prev.current_calltree_node == null 
      ||
      prev.calltree_changed_token != next.calltree_changed_token
    ) {
      // Rerender entire calltree
      ui.render_debugger(next)
      ui.eval.clear_value_or_error()
      ui.editor.for_each_session(f => clear_coloring(ui, f))
      render_coloring(ui, next)
      ui.editor.unembed_value_explorer()
    } else {
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

      if(node_changed) {
        if(!next.current_calltree_node.toplevel) {
          ui.eval.show_value_or_error(next.current_calltree_node)
        } else {
          ui.eval.clear_value_or_error()
        }
      }

      if(prev.calltree_node_by_loc != next.calltree_node_by_loc) {
        render_coloring(ui, next)
      }
    }

    if(prev.logs != next.logs) {
      ui.logs.render_logs(prev.logs, next.logs)
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

  const selresult = next.selection_state?.result
  if(selresult != null && prev.selection_state?.result != selresult) {
    if(FLAGS.embed_value_explorer) {
      const node = next.selection_state.node
      ui.editor.embed_value_explorer({
        index: node.index + node.length, 
        result: next.selection_state.result,
      })
    } else {
      ui.eval.show_value_or_error(next.selection_state.result)
    }
  }
}


export const EFFECTS = {
  set_caret_position: (state, [index, with_focus], ui) => {
    ui.editor.set_caret_position(index)
    if(with_focus) {
      ui.editor.focus()
    }
  },

  set_status: (state, [msg], ui) => {
    ui.set_status(msg)
  },
  
  save_to_localstorage(state, [key, value]){
    localStorage[key] = value
  },

  write: (state, [name, contents], ui) => write_file(name, contents),

  embed_value_explorer(state, [{index, result}], ui){
    if(FLAGS.embed_value_explorer) {
      ui.editor.embed_value_explorer({index, result})
    } else {
      ui.eval.show_value_or_error(result)
    }
  },

  unembed_value_explorer(state, _, ui){
    if(FLAGS.embed_value_explorer) {
      ui.editor.unembed_value_explorer()
    } else {
      ui.eval.clear_value_or_error()
    }
  },
}

