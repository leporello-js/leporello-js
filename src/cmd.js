import {map_object, map_find, filter_object, collect_nodes_with_parents, uniq, 
  set_is_eq} from './utils.js'
import {
  is_eq, is_child, ancestry, ancestry_inc, map_tree,
  find_leaf, find_fn_by_location, find_node, find_error_origin_node,
  collect_external_imports, collect_destructuring_identifiers
} from './ast_utils.js'
import {load_modules} from './parse_js.js'
import {eval_modules} from './eval.js'
import {
  root_calltree_node, root_calltree_module, make_calltree, 
  get_deferred_calls,
  calltree_commands,
  add_frame, calltree_node_loc, expand_path,
  initial_calltree_node, default_expand_path, toggle_expanded, active_frame, 
  find_call, set_active_calltree_node, 
  set_cursor_position, current_cursor_position, set_location,
  is_native_fn,
} from './calltree.js'

// external
import {with_version_number} from './runtime/runtime.js'

const collect_logs = (logs, call) => {
  const id_to_log = new Map(
    collect_nodes_with_parents(call, n => n.is_log)
    .map(({parent, node}) => (
      [
        node.id,
        {
          id: node.id,
          version_number: node.version_number,
          toplevel: parent.toplevel,
          module: parent.toplevel 
            ? parent.module
            : parent.fn.__location.module,
          parent_name: parent.fn?.name,
          args: node.args,
          log_fn_name: node.fn.name,
        }
      ]
    ))
  )
  return logs.map(l => id_to_log.get(l.id))
}

export const with_version_number_of_log = (state, log_item, action) => 
  with_version_number(state.rt_cxt, log_item.version_number, action)

const apply_eval_result = (state, eval_result) => {
  // TODO what if console.log called from native fn (like Array::map)?
  // Currently it is not recorded. Maybe we should monkey patch `console`?
  return {
    ...state,
    calltree: make_calltree(eval_result.calltree, null),
    calltree_node_by_loc: eval_result.calltree_node_by_loc,
    // TODO copy rt_cxt?
    rt_cxt: eval_result.rt_cxt,
    logs: {
      logs: collect_logs(eval_result.logs, eval_result.calltree), 
      log_position: null
    },
    modules: eval_result.modules,
    io_trace: 
      (eval_result.io_trace == null || eval_result.io_trace.length == 0)
        // If new trace is empty, reuse previous trace
        ? state.io_trace
        : eval_result.io_trace
  }
}

const run_code = (s, globals) => {
  const is_globals_eq = s.globals == null
    ? globals == null
    : set_is_eq(s.globals, globals) 

  // If globals change, then errors for using undeclared identifiers may be
  // no longer valid. Do not use cache
  const parse_cache = is_globals_eq ? s.parse_result.cache : {}
  const loader = module => s.files[module]
  const parse_result = load_modules(s.entrypoint, loader, parse_cache, globals)

  const state = {
    ...s,
    globals,
    parse_result,
    calltree: null,
    modules: null,

    // Shows that calltree is brand new and requires entire rerender
    calltree_changed_token: {},

    rt_cxt: null,
    logs: null,
    current_calltree_node: null,
    active_calltree_node: null,
    calltree_node_is_expanded: null,
    frames: null,
    colored_frames: null,
    calltree_node_by_loc: null,
    selected_calltree_node_by_loc: null,
    selection_state: null,
    loading_external_imports_state: null,
    value_explorer: null,
  }

  if(!state.parse_result.ok) {
    return state
  } 

  const external_imports = uniq( 
    collect_external_imports(state.parse_result.modules)
      .map(i => i.node.full_import_path)
  )

  if(external_imports.length != 0) {
    // Trigger loading of external modules
    return {...state, 
      loading_external_imports_state: {
        external_imports,
      }
    }
  } else {
    // Modules were loaded and cached, proceed
    return external_imports_loaded(state, state)
  }
}

const external_imports_loaded = (
  s, 
  prev_state, 
  external_imports, 
) => {
  if(
    s.loading_external_imports_state 
    != 
    prev_state.loading_external_imports_state
  ) {
    // code was modified after loading started, discard
    return s
  }

  const state = {
    ...s,
    loading_external_imports_state: null
  }

  if(external_imports != null) {
    const errors = new Set(
      Object
        .entries(external_imports)
        .filter(([url, result]) => !result.ok)
        .map(([url, result]) => url)
    )
    if(errors.size != 0) {
      const problems = collect_external_imports(state.parse_result.modules)
        .filter(({node}) => errors.has(node.full_import_path))
        .map(({node, module_name}) => ({
          index: node.index,
          message: external_imports[node.full_import_path].error.message,
          module: module_name,
        }))
      return {...state,
        parse_result: {
          ok: false,
          cache: state.parse_result.cache,
          problems,
        }
      }
    }
  }

  // TODO if module not imported, then do not run code on edit at all
  const result = eval_modules(
    state.parse_result,
    external_imports,
    state.on_deferred_call,
    state.calltree_changed_token,
    state.io_trace,
    state.storage,
  )

  if(result.then != null) {
    return {...state, 
      eval_modules_state: { promise: result }
    }
  } else {
    return eval_modules_finished(state, state, result)
  }
}

const eval_modules_finished = (state, prev_state, result) => {
  if(state.calltree_changed_token != prev_state.calltree_changed_token) {
    // code was modified after prev vesion of code was executed, discard
    return state
  }

  if(result.rt_cxt.io_trace_is_replay_aborted) {
    // execution was discarded, return state to execute `run_code` without io_trace
    return clear_io_trace({...state, rt_cxt: result.rt_cxt})
  }

  const next = find_call(
    apply_eval_result(state, result),
    current_cursor_position(state)
  )

  let result_state

  if(next.active_calltree_node == null) {
    const {node, state: next2} = initial_calltree_node(next)
    result_state = set_active_calltree_node(next2, null, node)
  } else {
    result_state = default_expand_path(
      expand_path(
        next,
        next.active_calltree_node
      )
    )
  }

  const eval_state_clear = result_state.eval_modules_state == null
    ? result_state
    : {...result_state, eval_modules_state: null}

  return do_move_cursor(
    eval_state_clear, 
    current_cursor_position(eval_state_clear)
  )
}

const input = (state, code, index) => {
  const files = {...state.files, [state.current_module]: code}
  const with_files = {
    ...state, 
    files,
    parse_result: state.parse_result == null 
      ? null
      : {
          ...state.parse_result, 
          cache: filter_object(state.parse_result.cache, module =>
            module != state.current_module
          )
        }
  }
  const next = set_cursor_position(with_files, index)
  const effect_save = {
    type: 'write', 
    args: [
      next.current_module,
      next.files[next.current_module],
    ]
  }
  return {state: next, effects: [effect_save]}
}

const can_evaluate_node = (parent, node) => {
  const anc = ancestry(node, parent)
  if(anc == null){
    return {ok: false, message: 'out of scope'}
  }

  const intermediate_fn = anc.find(n => 
    !is_eq(n, parent) && !is_eq(n, node) && n.type == 'function_expr'
  )

  if(intermediate_fn != null){
    // TODO check if identifier is defined in current scope, and eval
    return {ok: false, message: 'code was not reached during program execution'}
  }

  return {ok: true}
}

const validate_index_action = state => {
  if(!state.parse_result.ok){
    return {state, effects: {type: 'set_status', args: ['invalid syntax']}}
  }

  if(
    state.loading_external_imports_state != null 
    || 
    state.eval_modules_state != null
  ) {
    return {state, effects: {type: 'set_status', args: ['loading']}}
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

  if(is_native_fn(calltree_node)) {
    return {
      state, 
      effects: {
        type: 'set_status', 
        args: ['Cannot step into: function is either builtin or from external lib']
      }
    }
  }

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
      // collapse
      if(selection_state.node.children != null){
        const leaf = find_leaf(selection_state.node, index)
        next_node = ancestry_inc(leaf, selection_state.node)
          .findLast(n => !n.not_evaluatable && n != selection_state.node)
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
      selection_state: { 
        ok: false,
        message: 'out of scope',
      }
    }
  }

  const next_selection_state = get_next_selection_state(selection_state, frame, is_expand, index)

  if(!next_selection_state.ok) {
    return {selection_state: next_selection_state}
  }

  const {ok, message} = can_evaluate_node(frame, next_selection_state.node)
  if(ok){
    const node = find_node(frame, n => is_eq(n, next_selection_state.node))
    if(node.result == null) {
      return {
        selection_state: {
          ...next_selection_state, 
          ok: false,
          message: 'expression was not reached during program execution',
        }
      }
    } else {
      let result
      if(node.result.ok) {
        result = node.result
      } else {
        const error_node = find_error_origin_node(node)
        result = error_node.result
      }
      return {
        selection_state: {...next_selection_state, ok: true},
        result
      }
    }
  } else {
    return {
      selection_state: {...next_selection_state, ok: false, message}
    }
  }
}

const eval_selection = (state, index, is_expand) => {
  const validate_result = validate_index_action(state)
  if(validate_result != null) {
    return validate_result
  }

  const {selection_state, result} = selection(
    state.selection_state, 
    active_frame(state),
    is_expand, 
    index
  )

  const nextstate = {...state, 
    selection_state,
    value_explorer: selection_state.ok
      ? {
          node: selection_state.node,
          index: selection_state.node.index,
          length: selection_state.node.length,
          result,
        }
      : null
  }

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

const change_entrypoint = (state, entrypoint, current_module = entrypoint) => {
  return {...state, 
    entrypoint,
    current_module,
  }
}

const change_html_file = (state, html_file) => {
  return {...state, html_file}
}

const goto_location = (state, loc) => {
  return {
    state: move_cursor(set_location(state, loc), loc.index),
    effects: {type: 'set_focus'},
  }
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
          const exp = map_find(state.parse_result.modules[d.module].children, n => {
            if(n.type != 'export') {
              return null
            }
            if(n.is_default && d.is_default) {
              return n.children[0]
            } else if(!n.is_default && !d.is_default) {
              const ids = n.binding.children.flatMap(c => 
                collect_destructuring_identifiers(c.name_node)
              )
              return ids.find(i => i.value == node.value)
            }
          })
          loc = {module: d.module, index: exp.index}
        } else {
          loc = {module: state.current_module, index: d.index}
        }
        return goto_location(state, loc)
      }
    }
  }
}

const goto_problem = (state, p) => {
  return {
    state: set_location(state, p),
    effects: {type: 'set_focus'}
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

const get_stmt_value_explorer = (state, stmt) => {
  if(stmt.result == null) {
    // statement was not evaluated
    return null
  }

  let result

  if(stmt.result.ok) {
    if(stmt.type == 'return') {
      if(stmt.expr == null) {
        // add fake version number
        result = {ok: true, value: undefined, version_number: 0}
      } else {
        result = stmt.children[0].result
      }
    } else if(['let', 'const', 'assignment'].includes(stmt.type)) {

      if(stmt.children.find(c => c.type == 'assignment_pair') != null) {
        if(stmt.children.length != 1) {
          // Multiple assignments, not clear what value to show in value
          // explorer, show nothing
          return null
        }
        // get result of first assignment
        result = stmt.children[0].result 
      } else {
        const identifiers = stmt
          .children
          .flatMap(
            collect_destructuring_identifiers
          )
          .filter(id => id.result != null)
          .map(id => [id.value, id.result.value])
        let value
        if(
          stmt.children.length == 1 
          && 
          (
            stmt.children[0].type == 'identifier' 
            || 
            stmt.children[0].type == 'decl_pair' 
            && 
            stmt.children[0].name_node.type == 'identifier'
          )
        ) {
          // Just a single declaration
          if(identifiers.length != 1) {
            throw new Error('illegal state')
          }
          value = identifiers[0][1]
        } else {
          value = Object.fromEntries(identifiers)
        }

        // TODO different identifiers may have different version_number,
        // because there may be function calls and assignments in between fix
        // it
        const version_number = stmt.children[0].result.version_number
        return {
          index: stmt.index,
          length: stmt.length,
          result: {ok: true, value, version_number},
        }
      }
    } else if(stmt.type == 'if'){
      return null
    } else if(stmt.type == 'import'){
      result = {
        ok: true,
        value: state.modules[stmt.full_import_path],
        // For imports, we show version for the moment of module toplevel
        // starts execution
        version_number: state.active_calltree_node.version_number,
      }
    } else if (stmt.type == 'export') {
      return get_stmt_value_explorer(state, stmt.children[0])
    } else {
      result = stmt.result
    }
  } else {
    result = find_error_origin_node(stmt).result
  }

  return {index: stmt.index, length: stmt.length, result}
}


const get_value_explorer = (state, index) => {
  if(
    state.active_calltree_node == null
    ||
    (
      state.current_module 
      != 
      calltree_node_loc(state.active_calltree_node).module
    )
  ) {
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
        length: frame.children[0].length,
        result: frame.children[0].result,
      }
    }
  }

  if(frame.type == 'function_expr' && frame.body.type != 'do') {
    const result = frame.children[1].result
    if(result == null) {
      // Error in arguments, body not evaluated
      return null
    }
    return {
      index: frame.children[1].index,
      length: frame.children[1].length,
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

  return get_stmt_value_explorer(state, stmt)

}

const do_move_cursor = (state, index) => {
  // TODO: if value explorer is null, show current fn return value and args?

  const value_explorer = get_value_explorer(state, index)  
  if(
    value_explorer != null
    && value_explorer.result.ok
    && value_explorer.result.version_number == null
  ) {
    console.error('no version_number found', value_explorer)
    throw new Error('illegal state')
  }
  return { ...state, value_explorer}
}

const move_cursor = (s, index) => {

  const with_cursor = set_cursor_position(s, index)

  if(!s.parse_result.ok){
    return {state: with_cursor}
  }

  if(s.loading_external_imports_state != null || s.eval_modules_state != null) {
    // Code will be executed when imports will load, do not do it right now
    return {state: with_cursor}
  }

  // Remove selection on move cursor
  const state_sel_removed = {...with_cursor, selection_state: null}

  const state = find_call(state_sel_removed, index)

  const validate_result = validate_index_action(state)
  if(validate_result != null) {
    return { ...state, value_explorer: null }
  }

  return do_move_cursor(state, index)
}

const on_deferred_call = (state, call, calltree_changed_token, logs) => {
  if(state.calltree_changed_token != calltree_changed_token) {
    return state
  }
  return {...state, 
    calltree: make_calltree(
      root_calltree_node(state),
      [...(get_deferred_calls(state) ?? []), call],
    ),
    logs: {
      ...state.logs, 
      logs: state.logs.logs.concat(collect_logs(logs, call))
    },
  }
}

const clear_io_trace = state => {
  return {...state, io_trace: null}
}

const load_files = (state, dir) => {
  const collect_files = dir => dir.kind == 'file' 
    ? [dir]
    : dir.children.map(collect_files).flat()

  const files = Object.fromEntries(
    collect_files(dir).map(f => [f.path, f.contents])
  )

  return {
    ...state,
    project_dir: dir,
    files: {...files, '': state.files['']},
  }
}

const apply_entrypoint_settings = (state, entrypoint_settings) => {
  const blank_if_not_exists = key =>
    state.files[entrypoint_settings[key]] == null 
      ? ''
      : entrypoint_settings[key]

  const entrypoint = blank_if_not_exists('entrypoint')
  const current_module = blank_if_not_exists('current_module')
  const html_file = blank_if_not_exists('html_file')

  return {
    ...state,
    entrypoint,
    current_module,
    html_file,
  }
}

const load_dir = (state, dir, has_file_system_access, entrypoint_settings) => {
  // Clear parse cache and rerun code
  const with_dir = load_files(state, dir)
  return {
    ...(
      entrypoint_settings == null
        ? with_dir
        : apply_entrypoint_settings(with_dir, entrypoint_settings)
    ),

    has_file_system_access,

    // remove cache. We have to clear cache because imports of modules that are
    // not available because project_dir is not available have errors and the
    // errors are cached
    parse_result: {...state.parse_result, cache: {}},
  }
}

const create_file = (state, dir, current_module) => {
  return {...load_dir(state, dir, true), current_module}
}

const open_app_window = state => ({...state, storage: new Map()})

const get_initial_state = (state, entrypoint_settings, cursor_pos = 0) => {
  const with_files = state.project_dir == null
    ? state
    : load_files(state, state.project_dir)

  const with_settings = apply_entrypoint_settings(with_files, entrypoint_settings)

  return {
    ...with_settings,
    storage: new Map(),
    cursor_position_by_file: {[with_settings.current_module]: cursor_pos},
  }
}

export const COMMANDS = {
  get_initial_state,
  input, 
  run_code,
  open_app_window,
  load_dir,
  create_file,
  step_into,
  change_current_module,
  change_entrypoint,
  change_html_file,
  goto_location,
  goto_definition,
  goto_problem,
  move_cursor,
  eval_selection,
  external_imports_loaded,
  eval_modules_finished,
  on_deferred_call,
  clear_io_trace,
  calltree: calltree_commands,
}
