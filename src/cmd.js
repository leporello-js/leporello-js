import {map_object, pick_keys, collect_nodes_with_parents} from './utils.js'
import {
  is_eq, is_child, ancestry, ancestry_inc, map_tree,
  find_leaf, find_fn_by_location, find_node, find_error_origin_node
} from './ast_utils.js'
import {load_modules} from './parse_js.js'
import {find_export} from './find_definitions.js'
import {eval_modules} from './eval.js'
import {
  root_calltree_node, root_calltree_module, calltree_commands,
  add_frame, calltree_node_loc, expand_path,
  initial_calltree_node, default_expand_path, toggle_expanded, active_frame, 
  find_call, find_call_node, set_active_calltree_node
} from './calltree.js'

const apply_eval_result = (state, eval_result) => {
  // TODO what if console.log called from native fn (like Array::map)?
  // Currently it is not recorded. Maybe we should patch monkey patch console?
  const logs = (
    eval_result.calltree[state.entrypoint] == null
      ? []
      : collect_nodes_with_parents(
          eval_result.calltree[state.entrypoint].calls, 
          n => n.is_log,
        )
    )
    .map(({parent, node}) => (
      {
        id: node.id,
        toplevel: parent.toplevel,
        module: parent.toplevel 
          ? parent.module
          : parent.fn.__location.module,
        parent_name: parent.fn?.name,
        args: node.args,
        log_fn_name: node.fn.name,
      }
    ))
    
  return {
    ...state, 
    calltree: eval_result.calltree,
    calltree_actions: eval_result.calltree_actions,
    logs: {logs, log_position: null},
  }
}

const apply_active_calltree_node = (state, index) => {
  if(!state.parse_result.ok) {
    return state
  } 

  const node = find_call_node(state, index)

  if(
    // edit module that is not imported (maybe recursively by state.entrypoint)
    node == null
    ||
    node.type == 'do' /* toplevel AST node */
  ) {
    const result = eval_modules(state.parse_result.modules, state.parse_result.sorted)
    const next = apply_eval_result(state, result)

    if(node == state.parse_result.modules[root_calltree_module(next)]) {
      const toplevel = root_calltree_node(next)
      return add_frame(
        default_expand_path(
          next,
          toplevel
        ),
        toplevel,
      )
    } else {
      const {node, state: next2} = initial_calltree_node(next)
      return set_active_calltree_node(next2, null, node)
    }
  }

  const result = eval_modules(
    state.parse_result.modules, 
    state.parse_result.sorted,
    {index: node.index, module: state.current_module},
  )

  if(result.call == null) {
    // Unreachable call
    const {node, state: next} = initial_calltree_node(
      apply_eval_result(state, result)
    )
    return set_active_calltree_node(next, null, node)
  }

  const next = apply_eval_result(state, result)
  // We cannot use `call` because `code` was not assigned to it
  const active_calltree_node = find_node(root_calltree_node(next),
    n => n.id == result.call.id
  )

  return add_frame(
    default_expand_path(
      expand_path(
        next,
        active_calltree_node
      )
    ),
    active_calltree_node,
  )
}

const input = (state, code, index) => {
  const files = {...state.files, [state.current_module]: code}
  const next = apply_active_calltree_node(
    apply_code({...state, files}, [state.current_module]),
    index
  )
  const effects1 = next.current_module == ''
    ? {type: 'save_to_localstorage', args: ['code', code]}
    : {type: 'write', args: [
      next.current_module,
      next.files[next.current_module],
    ]}
  const {state: next2, effects: effects2} = do_move_cursor(next, index)
  return {
    state: next2, 
    effects: [effects1, effects2],
  }
}

const apply_code = (state, dirty_files) => {
  const parse_result = load_modules(state.entrypoint, module => {
    if(dirty_files != null && dirty_files.includes(module)) {
      return state.files[module]
    }

    if(state.parse_result != null) {
      const result = state.parse_result.cache[module]
      if(result != null) {
        return result
      } else {
        return state.files[module]
      }
    } else {
      return state.files[module]
    }

  })

  return {
    ...state,
    parse_result,
    calltree: null,

    // Shows that calltree is brand new and requires entire rerender
    calltree_changed_token: {},

    calltree_actions: null,
    logs: null,
    current_calltree_node: null,
    active_calltree_node: null,
    calltree_node_is_expanded: null,
    frames: null,
    calltree_node_by_loc: null,
    // TODO keep selection_state?
    selection_state: null,
  }

}

export const apply_code_with_active_calltree_node = (state, index) => {
  const next = apply_code(state)
  return apply_active_calltree_node(next, index)
}

const can_evaluate_node = (parent, node) => {
  // TODO also can evaluate in top level even if stepped into (and evaluate in
  // any stack frame that was before current one)

  const anc = ancestry(node, parent)
  if(anc == null){
    return {ok: false, message: 'out of scope'}
  }

  const intermediate_fn = anc.find(n => 
    !is_eq(n, parent) && !is_eq(n, node) && n.type == 'function_expr'
  )

  if(intermediate_fn != null){
    // TODO check if identifier is defined in current scope, and eval
    return {ok: false, message: 'cannot eval inside function: first step into it'}
  }

  return {ok: true}
}

const validate_index_action = state => {
  if(!state.parse_result.ok){
    return {state, effects: {type: 'set_status', args: ['invalid syntax']}}
  }
  if(
    state.active_calltree_node == null
    ||
    calltree_node_loc(state.active_calltree_node).module != state.current_module
  ) {
    return {
      state, 
      effects: {
        type: 'set_status', 
        args: ['code was not reached during program execution']
      }
    }
  }
}

const get_step_into_node = (ast, frame, index) => {
  // TODO step into from toplevel (must be fixed by frame follows cursor)

  const node = find_leaf(ast, index)

  // Find parent node with function call
  const call = ancestry_inc(node, ast).find(n => n.type == 'function_call')

  if(call == null){
    return {ok: false, message: 'no function call to step into'}
  }

  const can_eval = can_evaluate_node(frame, call)
  if(!can_eval.ok){
    return {ok: false, message: can_eval.message}
  }

  const callnode = find_node(frame, n => is_eq(n, call))
  if(callnode.result == null) {
    return {ok: false, message: 'call was not reached during program execution'}
  } else {
    return {ok: true, calltree_node: callnode.result.call}
  }
}

const step_into = (state, index) => {

  const validate_result = validate_index_action(state)
  if(validate_result != null) {
    return validate_result
  }

  const {ok, message, calltree_node} = get_step_into_node(
    state.parse_result.modules[state.current_module],
    active_frame(state),
    index
  )
  if(!ok){
    return {state, effects: {type: 'set_status', args: [message]}}
  } else {
    const expanded = {
      ...state, calltree_node_is_expanded: {
        ...state.calltree_node_is_expanded, [calltree_node.id]: true
      }
    }
    return toggle_expanded(
      {...expanded, current_calltree_node: calltree_node},
      true
    )
  }
}

const get_next_selection_state = (selection_state, frame, is_expand, index) => {
  if(selection_state != null && selection_state.index == index){
    // Expanding/collapsing selection
    let next_node
    const effective_is_expand = selection_state.initial_is_expand == is_expand
    if(effective_is_expand){
      if(is_eq(selection_state.node, frame)) {
        next_node = selection_state.node
      } else {
        next_node = ancestry(selection_state.node, frame).find(n => !n.not_evaluatable)
        if(next_node.is_statement) {
          next_node = selection_state.node
        }
      }
    } else {
      // TODO when collapsing, also check that node is evaluatable
      // collapse
      if(selection_state.node.children != null){
        next_node = 
            selection_state.node.children.find(n => 
              n.index <= index && n.index + n.length > index 
            )
          ??
            // caret not inside child but in whitespace
            selection_state.node
      } else {
        // no children, cannot collapse
        next_node = selection_state.node
      }
    }
    return {
      ok: true,
      initial_is_expand: selection_state.initial_is_expand, 
      node: next_node, 
      index,
    }
  } else {
    // Creating new selection
    const leaf = find_leaf(frame, index);
    const a = ancestry_inc(leaf, frame);
    const node = a.find(n => !n.not_evaluatable);
    if(node.is_statement) {
      return {
        ok: false,
        message: 'can only evaluate expression, not statement',
      }
    }
    return {
      ok: true,
      index, 
      node,
      initial_is_expand: is_expand,
    }
  }
}

export const selection = (selection_state, frame, is_expand, index) => {
  const leaf = find_leaf(frame, index)
  if(leaf == null) {
    return { 
      ok: false,
      message: 'out of scope',
    }
  }

  const next_selection_state = get_next_selection_state(selection_state, frame, is_expand, index)

  if(!next_selection_state.ok) {
    return next_selection_state
  }

  const {ok, message} = can_evaluate_node(frame, next_selection_state.node)
  if(ok){
    const node = find_node(frame, n => is_eq(n, next_selection_state.node))
    if(node.result == null) {
      return {
        ...next_selection_state, 
        ok: false,
        message: 'expression was not reached during program execution',
      }
    } else {
      let result
      if(node.result.ok) {
        result = node.result
      } else {
        const error_node = find_error_origin_node(node)
        result = error_node.result
      }
      return {...next_selection_state, ok: true, result}
    }
  } else {
    return {...next_selection_state, ok: false, message}
  }
}

const eval_selection = (state, index, is_expand) => {
  const validate_result = validate_index_action(state)
  if(validate_result != null) {
    return validate_result
  }

  const selection_state = selection(
    state.selection_state, 
    active_frame(state),
    is_expand, 
    index
  )

  const nextstate = {...state, selection_state}

  if(!selection_state.ok) {
    return {state: nextstate, effects: {type: 'set_status', args: [selection_state.message]}}
  }

  return {state: nextstate}
}


const change_current_module = (state, current_module) => {
  if(state.files[current_module] == null) {
    return {
      state,
      effects: {type: 'set_status', args: ['File not found']}
    }
  } else {
    return {...state, current_module}
  }
}

const change_entrypoint = (state, entrypoint, index) => {
  return apply_code_with_active_calltree_node(
    {...state, 
      entrypoint,
      current_module: entrypoint,
    },
    index
  )
}

const goto_definition = (state, index) => {
  if(!state.parse_result.ok){
    return {state, effects: {type: 'set_status', args: ['unresolved syntax errors']}}
  } else {
    const module = state.parse_result.modules[state.current_module]
    const node = find_leaf(module, index)
    if(node == null || node.type != 'identifier') {
      return {state, effects: {type: 'set_status', args: ['not an identifier']}}
    } else {
      const d = node.definition
      if(d == 'global') {
        return {state, effects: {type: 'set_status', args: ['global variable']}}
      } else if (d == 'self') {
        // place where identifier is declared, nothing to do
        return {state}
      } else {
        let loc
        if(d.module != null) {
          const exp = find_export(node.value, state.parse_result.modules[d.module])
          loc = {module: d.module, index: exp.index}
        } else {
          loc = {module: state.current_module, index: d.index}
        }
        return {
          state: {...state, current_module: loc.module}, 
          effects: {type: 'set_caret_position', args: [loc.index]}
        }
      }
    }
  }
}

const goto_problem = (state, p) => {
  return {
    state: {...state, current_module: p.module},
    // TODO set focus after jump
    effects: {type: 'set_caret_position', args: [p.index]}
  }
}


// TODO remove?
// TODO: to every child, add displayed_children property
/*
const filter_calltree = (calltree, pred) => {
  const do_filter_calltree = calltree => {
    const children = calltree.children && calltree.children
      .map(c => do_filter_calltree(c))
      .flat()

    if(pred(calltree)) {
      return [{...calltree, children}]
    } else {
      return children
    }
  }

  const result = do_filter_calltree(calltree)

  if(result.length == 1 && result[0].toplevel) {
    return result[0]
  } else {
    return {...calltree, children: result}
  }
}
*/

const get_value_explorer = (state, index) => {
  if(state.active_calltree_node == null) {
    return null
  }

  const frame = active_frame(state)

  if(
    true
    // not toplevel, function expr
    && frame.type == 'function_expr'
    && index >= frame.children[0].index 
    && index < frame.children[0].index + frame.children[0].length
  ) {
    if(frame.children[0].children.length == 0) {
      // Zero args
      return null
    } else {
      // cursor in args, show args
      return {
        index: frame.children[0].index,
        result: frame.children[0].result,
      }
    }
  }

  if(frame.type == 'function_expr' && frame.body.type != 'do') {
    const result = frame.children[1].result
    return {
      index: frame.children[1].index,
      result: result.ok
        ? result
        : find_error_origin_node(frame.children[1]).result
    }
  }

  const leaf = find_leaf(frame, index)
  const adjusted_leaf = (
    // We are in the whitespace at the beginning or at the end of the file
    leaf == null
    ||
    // Empty body or cursor between statements
    leaf.type == 'do' && index > frame.index
  )
    // Try find statement one symbol before, in case we are typing at the end
    // of current statement
    ? find_leaf(frame, index - 1)
    : leaf

  if(
    adjusted_leaf == null
    ||
    adjusted_leaf.type == 'do' 
    || 
    /* between body and args*/
    is_eq(frame, adjusted_leaf)
  ) {
    return null
  }

  const anc = ancestry_inc(adjusted_leaf, frame)
  const intermediate_fn = anc.find(n => 
    !is_eq(n, frame) && !is_eq(n, adjusted_leaf) && n.type == 'function_expr'
  )
  if(intermediate_fn != null) {
    // TODO maybe cut `anc` from frame to intermediate fn, so we do not look
    // inside intermediate fn. But it should be fixed by frame follows cursor
    return null
  }

  // Find inner do
  const do_index = anc.findIndex(n => n.type == 'do')
  const do_node = anc[do_index]
  const stmt = anc[do_index - 1]

  if(stmt.result == null) {
    // statement was not evaluated
    return null
  }

  let result

  if(stmt.result.ok) {
    if(['const', 'assignment'].includes(stmt.type)) {
      result = stmt.children[1].result
    } else if(stmt.type == 'return') {
      result = stmt.children[0].result
    } else if(stmt.type == 'let') {
      return {
        index: stmt.index,
        result: 
          {
            ok: true, 
            value: Object.fromEntries(
              stmt.children.map(c => 
                [c.value, c.result.value]
              )
            )
          }
      }
    } else if(stmt.type == 'if'){
      return null
    } else if(stmt.type == 'import'){
      result = {
        ok: true,
        value: pick_keys(
          state.calltree[stmt.full_import_path].exports,
          stmt.imports.map(i => i.value)
        ),
      }
    } else if (stmt.type == 'export') {
      result = stmt.children[0].children[1].result
    } else {
      result = stmt.result
    }
  } else {
    result = find_error_origin_node(stmt).result
  }

  return {index: stmt.index, result}
}

const do_move_cursor = (state, index) => {
  const value_exp = get_value_explorer(state, index)
  if(value_exp == null) {
    return {
      state, 
      effects: {type: 'unembed_value_explorer', args: []}
    }
  } else {
    return {
      state, 
      effects: 
        state.current_module == 
          calltree_node_loc(state.active_calltree_node).module
              ? {type: 'embed_value_explorer', args: [value_exp]}
              : null
    }
  }
}

const move_cursor = (s, index) => {
  if(!s.parse_result.ok){
    return {state: s}
  }

  // Remove selection on move cursor
  const state_sel_removed = {...s, selection_state: null}

  const state = find_call(state_sel_removed, index)

  const validate_result = validate_index_action(state)
  if(validate_result != null) {
    return {
      state, 
      effects: {type: 'unembed_value_explorer', args: []}
    }
  }

  return do_move_cursor(state, index)
}

const load_dir = (state, dir) => {
  const collect_files = dir => dir.kind == 'file' 
    ? [dir]
    : dir.children.map(collect_files).flat()

  const files = Object.fromEntries(
    collect_files(dir).map(f => [f.path, f.contents])
  )

  return {
    ...state,
    project_dir: dir,
    files: {...files, ...state.files}
  }
}

const create_file = (state, dir, current_module) => {
  return {...load_dir(state, dir), current_module}
}

export const get_initial_state = state => {
  const with_files = state.project_dir == null
    ? state
    : load_dir(state, state.project_dir)

  const entrypoint = with_files.entrypoint
  const current_module = with_files.current_module

  const s = {
    ...with_files,
    // If module for entrypoint or current_module does not exist, use *scratch*
    entrypoint: 
      with_files.files[entrypoint] == null 
        ? ''
        : entrypoint,
    current_module: with_files.files[current_module] == null 
      ? '' 
      : current_module,
  }

  return apply_code_with_active_calltree_node(s, 0)
}

export const COMMANDS = {
  input, 
  load_dir,
  create_file,
  step_into,
  change_current_module,
  change_entrypoint,
  goto_definition,
  goto_problem,
  move_cursor,
  eval_selection,
  calltree: calltree_commands,
}
