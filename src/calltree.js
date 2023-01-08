import {map_accum, map_find, map_object, stringify, findLast} from './utils.js'
import {is_eq, find_error_origin_node} from './ast_utils.js'
import {find_node, find_leaf, ancestry_inc} from './ast_utils.js'
import {color} from './color.js'
import {eval_frame} from './eval.js'

export const pp_calltree = tree => ({
  id: tree.id,
  ok: tree.ok,
  args: tree.args,
  value: tree.value,
  is_log: tree.is_log,
  has_more_children: tree.has_more_children,
  string: tree.code?.string,
  children: tree.children && tree.children.map(pp_calltree)
})

export const current_cursor_position = state => 
  state.cursor_position_by_file[state.current_module] 
  // When we open file for the first time, cursor set to the beginning
  ?? 0

export const set_cursor_position = (state, cursor_position) => (
  {
    ...state,
    cursor_position_by_file: {
      ...state.cursor_position_by_file, [state.current_module]: cursor_position
    }
  }
)

export const set_location = (state, location) => set_cursor_position(
  {...state, current_module: location.module},
  location.index
)

const is_stackoverflow = node =>
  // Chrome
  node.error.message == 'Maximum call stack size exceeded'
  ||
  // Firefox
  node.error.message == "too much recursion"

export const calltree_node_loc = node => node.toplevel  
    ? {module: node.module}
    : node.fn.__location

export const get_deferred_calls = state => state.calltree.children[1].children

export const root_calltree_node = state =>
  // Returns calltree node for toplevel
  // It is either toplevel for entrypoint module, or for module that throw
  // error and prevent entrypoint module from executing.
  // state.calltree.children[1] is deferred calls
  state.calltree.children[0]

export const root_calltree_module = state =>
  root_calltree_node(state).module

export const make_calltree = (root_calltree_node, deferred_calls) => ({
  id: 'calltree',
  children: [
    root_calltree_node,
    {id: 'deferred_calls', children: deferred_calls},
  ]
})

export const is_native_fn = calltree_node =>
  !calltree_node.toplevel && calltree_node.fn.__location == null

export const active_frame = state => 
  state.frames[state.active_calltree_node.id]

const get_calltree_node_by_loc = (state, node) =>
  state.calltree_node_by_loc
    ?.[state.current_module]
    ?.[
        state.parse_result.modules[state.current_module] == node
          // identify toplevel by index `-1`, because function and toplevel can
          // have the same index (in case when module starts with function_expr)
          ? -1
          : node.index
      ]

const add_calltree_node_by_loc = (state, loc, node_id) => {
  return {
    ...state,
    calltree_node_by_loc: 
      {...state.calltree_node_by_loc,
        [loc.module]: {
          ...state.calltree_node_by_loc?.[loc.module],
          [loc.index ?? -1]: node_id
        }
      }
  }
}

export const set_active_calltree_node = (
  state, 
  active_calltree_node, 
  current_calltree_node = state.current_calltree_node,
) => {
  const result = {
    ...state, 
    active_calltree_node,
    current_calltree_node,
  }
  // TODO currently commented, required to implement livecoding second and
  // subsequent fn calls
  /*
  // Record last_good_state every time active_calltree_node changes
  return {...result, last_good_state: result}
  */
  return result
}

export const add_frame = (
  state, 
  active_calltree_node,
  current_calltree_node = active_calltree_node,
) => {
  let with_frame
  if(state.frames?.[active_calltree_node.id] == null) {
    const frame = eval_frame(active_calltree_node, state.modules)
    const coloring = color(frame)
    with_frame = {...state, 
      frames: {...state.frames, 
        [active_calltree_node.id]: {...frame, coloring}
      }
    }
  } else {
    with_frame = state
  }
  const result = add_calltree_node_by_loc(
    with_frame,
    calltree_node_loc(active_calltree_node),
    active_calltree_node.id,
  )
  return set_active_calltree_node(result, active_calltree_node, current_calltree_node)
}

const replace_calltree_node = (root, node, replacement) => {
  const do_replace = root => {
    if(root.id == node.id) {
      return [true, replacement]
    }

    if(root.children == null) {
      return [false, root]
    }

    const [replaced, children] = map_accum(
      (replaced, c) => replaced
        // Already replaced, do not look for replacement
        ? [true, c]
        : do_replace(c),
      false,
      root.children,
    )

    if(replaced) {
      return [true, {...root, children}]
    } else {
      return [false, root]
    }
  }

  const [replaced, result] = do_replace(root)

  if(!replaced) {
    throw new Error('illegal state')
  }
  
  return result
}

const expand_calltree_node = (state, node) => {
  if(node.has_more_children) {
    const next_node = state.calltree_actions.expand_calltree_node(node)
    return {
      state: {...state, 
        calltree: replace_calltree_node(state.calltree, node, next_node)
      },
      node: next_node
    }
  } else {
    return {state, node}
  }
}

const jump_calltree_node = (_state, _current_calltree_node) => {
  const {state, node: current_calltree_node} = expand_calltree_node(
    _state, _current_calltree_node
  )

  /*
  When node is selected or expanded/collapsed
    If native, goto call site
    If hosted
      If parent is native
        goto inside fn
      If parent is hosted
        If expanded, goto inside fn
        If collapsed, goto call site
  */

  /* Whether to show fn body (true) or callsite (false) */
  let show_body

  const [parent] = path_to_root(state.calltree, current_calltree_node)

  if(
    current_calltree_node.toplevel 
    || 
    parent.id == 'deferred_calls'
  ) {
    show_body = true
  } else if(is_native_fn(current_calltree_node)) {
    show_body = false
  } else {
    if(is_native_fn(parent)) {
      show_body = true
    } else {
      const is_expanded = state.calltree_node_is_expanded[current_calltree_node.id]
      show_body = is_expanded
    }
  }

  const active_calltree_node = show_body ? current_calltree_node : parent
  
  const next = add_frame(state, active_calltree_node, current_calltree_node)

  const loc = show_body
    ? calltree_node_loc(next.active_calltree_node)
    : find_callsite(next.modules, active_calltree_node, current_calltree_node)

  return {
    state: next.current_calltree_node.toplevel
      ? {...next, current_module: loc.module}
      // TODO: better jump not start of function (arguments), but start
      // of body?
      : set_location(next, loc),
    effects: next.current_calltree_node.toplevel
      ? {type: 'unembed_value_explorer'}
      : {
          type: 'embed_value_explorer',
          args: [{
            index: loc.index,
            result: {
              ok: true,
              value: current_calltree_node.ok
                ?  {
                  '*arguments*': current_calltree_node.args,
                  '*return*': current_calltree_node.value,
                }
                : {
                  '*arguments*': current_calltree_node.args,
                  '*throws*': current_calltree_node.error,
                }
            }
          }],
        }
  }
}

export const path_to_root = (root, child) => {
  const do_path = (root) => {
    if(root.id == child.id) {
      return []
    }
    if(root.children == null) {
      return null
    }
    return root.children.reduce(
      (result, c) => {
        if(result != null) {
          return result
        }
        const path = do_path(c)
        if(path == null) {
          return null
        }
        return [...path, root]
      },
      null
    )
  }
  
  const result = do_path(root)

  if(result == null) {
    throw new Error('illegal state')
  }

  return result
}

export const is_expandable = node => 
  // Hosted node always can be expanded, even if has not children
  // Toplevel cannot be expanded if has no children
  (!is_native_fn(node) && !node.toplevel) 
  || 
  (node.children != null || node.has_more_children)

/*
  Right - 
    - does not has children - nothing
    - has children - first click expands, second jumps to first element

  Left - 
    - root - nothing
    - not root collapse node, goes to parent if already collapsed

  Up - goes to prev visible element
  Down - goes to next visible element

  Click - select and toggle expand
  
  step_into - select and expand
*/

const arrow_down = state => {
  const current = state.current_calltree_node
  let next_node

  if(
       is_expandable(current) 
    && state.calltree_node_is_expanded[current.id]
    && current.children != null
  ) {

    next_node = current.children[0]

  } else {

    const next = (n, path) => {
      if(n.id == 'calltree') {
        return null
      }
      const [parent, ...grandparents] = path
      const child_index = parent.children.findIndex(c =>  
        c == n
      )
      const next_child = parent.children[child_index + 1]
      if(next_child == null) {
        return next(parent, grandparents)
      } else {
        return next_child
      }
    }

    next_node = next(
      current, 
      path_to_root(state.calltree, current)
    )
  }

  if(next_node?.id == 'deferred_calls') {
    if(next_node.children == null) {
      next_node = null
    } else {
      next_node = next_node.children[0]
    }
  }

  return next_node == null 
    ? state 
    : jump_calltree_node(state, next_node)
}

const arrow_up = state => {
  const current = state.current_calltree_node
  if(current == root_calltree_node(state)) {
    return state
  }
  const [parent] = path_to_root(state.calltree, current)
  const child_index = parent.children.findIndex(c =>  
    c == current
  )
  const next_child = parent.children[child_index - 1]
  const last = node => {
    if(
         !is_expandable(node) 
      || !state.calltree_node_is_expanded[node.id]
      || node.children == null
    ) {
      return node
    } else {
      return last(node.children[node.children.length - 1])
    }
  }
  let next_node
  if(next_child == null) {
    next_node = parent.id == 'deferred_calls'
      ? last(root_calltree_node(state))
      : parent
  } else {
    next_node = last(next_child)
  }
  return jump_calltree_node(state, next_node)
}

const arrow_left = state => {
  const current = state.current_calltree_node
  const is_expanded = state.calltree_node_is_expanded[current.id]
  if(!is_expandable(current) || !is_expanded) {
    const [parent] = path_to_root(state.calltree, current)
    if(parent.id == 'calltree' || parent.id == 'deferred_calls') {
      return state
    } else {
      return jump_calltree_node(state, parent)
    }
  } else {
    return toggle_expanded(state)
  }
}

const arrow_right = state => {
  const current = state.current_calltree_node
  if(is_expandable(current)) {
    const is_expanded = state.calltree_node_is_expanded[current.id]
    if(!is_expanded) {
      return toggle_expanded(state)
    } else {
      if(current.children != null) {
        return jump_calltree_node(state, current.children[0])
      } else {
        return state
      }
    }
  } else {
    return state
  }
}

const find_callsite = (modules, parent, node) => {
  const frame = eval_frame(parent, modules)
  const result = find_node(frame, n => n.result?.call == node)
  return {module: calltree_node_loc(parent).module, index: result.index}
}

export const toggle_expanded = (state, is_exp) => {
  const node_id = state.current_calltree_node.id
  const prev = state.calltree_node_is_expanded[node_id]
  const next_is_exp = is_exp ?? !prev
  const expanded_state = {
    ...state,
    calltree_node_is_expanded: {
      ...state.calltree_node_is_expanded, 
      [node_id]: next_is_exp,
    }
  }
  return jump_calltree_node(
    expanded_state, 
    state.current_calltree_node,
  )
}

const click = (state, id) => {
  const node = find_node(state.calltree, n => n.id == id)
  const {state: nextstate, effects} = jump_calltree_node(state, node)
  if(is_expandable(node)) {
    // `effects` are intentionally discarded, correct `set_cursor_position` will
    // be applied in `toggle_expanded`
    return toggle_expanded(nextstate)
  } else {
    return {state: nextstate, effects}
  }
}

export const expand_path = (state, node) => ({
  ...state,
  calltree_node_is_expanded: {
    ...state.calltree_node_is_expanded, 
    ...Object.fromEntries(
        path_to_root(state.calltree, node)
          .map(n => [n.id, true])
      ),
    // Also expand node, since it is not included in
    // path_to_root
    [node.id]: true,
  }
})

export const initial_calltree_node = state => {
  const root = root_calltree_node(state)
  if(
    root.ok
    ||
    // Not looking for error origin, stack too deep
    is_stackoverflow(root)
  ) {
    return {
      state: expand_path(state, root),
      node: root,
    }
  } else {
    // Find error origin
    const node = find_node(root, 
      n => !n.ok && (
        // All children are ok
        n.children == null
        ||
        n.children.find(c => !c.ok) == null
      )
    )
    return {state: expand_path(state, node), node}
  }
}

export const default_expand_path = state => initial_calltree_node(state).state

export const find_call_node = (state, index) => {
  const module = state.parse_result.modules[state.current_module]

  if(module == null) {
    // Module is not executed
    return null
  }

  let node

  if(index < module.index || index >= module.index + module.length) {
    // index is outside of module, it can happen because of whitespace and
    // comments in the beginning and the end
    node = module
  } else {
    const leaf = find_leaf(module, index)
    const anc = ancestry_inc(leaf, module)
    const fn = anc.find(n => n.type == 'function_expr')
    node = fn == null
      ? module
      : fn
  }

  return node
}

export const find_call = (state, index) => {
  const node = find_call_node(state, index)

  if(node == null) {
    return state
  }

  if(state.active_calltree_node != null && is_eq(node, state.active_calltree_node.code)) {
    return state
  }

  const ct_node_id = get_calltree_node_by_loc(state, node)

  if(ct_node_id === null) {
    // strict compare (===) with null, to check if we put null earlier to
    // designate that fn is not reachable
    return set_active_calltree_node(state, null)
  }

  if(ct_node_id != null) {
    const ct_node = find_node(
      state.calltree,
      n => n.id == ct_node_id
    )
    if(ct_node == null) {
      throw new Error('illegal state')
    }
    return set_active_calltree_node(state, ct_node, ct_node)
  } 

  if(node == state.parse_result.modules[root_calltree_module(state)]) {
    const toplevel = root_calltree_node(state)
    return add_frame(
      expand_path(
        state,
        toplevel
      ),
      toplevel,
    )
  } else if(node.type == 'do') {
    // Currently we only allow to eval in toplevel of entrypoint module
    return state
  }

  const loc = {index: node.index, module: state.current_module}
  
  // First try to find node among existing calltree nodes
  const call = find_node(state.calltree, node => 
    true
    && node.fn != null
    && node.fn.__location != null
    && node.fn.__location.index == loc.index
    && node.fn.__location.module == loc.module
  )

  let next_calltree, active_calltree_node

  if(call != null) {
    if(call.has_more_children) {
      active_calltree_node = state.calltree_actions.expand_calltree_node(call)
      next_calltree = replace_calltree_node(
        state.calltree, 
        call, 
        active_calltree_node
      )
    } else {
      active_calltree_node = call
      next_calltree = state.calltree
    }
  } else {
    const find_result = state.calltree_actions.find_call(state.calltree, loc)
    if(find_result == null) {
      return add_calltree_node_by_loc(
        // Remove active_calltree_node
        // current_calltree_node may stay not null, because it is calltree node
        // explicitly selected by user in calltree view
        set_active_calltree_node(state, null),
        loc,
        null
      )
    }

    active_calltree_node = find_result.call
    next_calltree = replace_calltree_node(
      state.calltree, 
      find_node(state.calltree, n => n.id == find_result.node.id),
      find_result.node,
    )
  }

  return add_frame(
    expand_path(
      {...state, calltree: next_calltree},
      active_calltree_node
    ),
    active_calltree_node,
  )
}

const select_return_value = state => {
  if(state.current_calltree_node.toplevel) {
    return {state}
  }

  const code = state.active_calltree_node.code
  const loc = calltree_node_loc(state.active_calltree_node)
  const frame = active_frame(state)

  let node, result_node

  if(state.current_calltree_node == state.active_calltree_node) {
    if(frame.result.ok) {
      if(code.body.type == 'do') {
        const return_statement = find_node(frame, n => 
          n.type == 'return' && n.result?.ok
        )

        if(return_statement == null) {
          // Fn has no return statement
          return {
            state: set_location(state, {module: loc.module, index: code.body.index}),
            effects: {type: 'set_focus'}
          }
        } else {
          result_node = return_statement.children[0]
        }

      } else {
        // Last children is function body expr
        result_node = frame.children[frame.children.length - 1]
      }
    } else {
      result_node = find_error_origin_node(frame)
    }

    node = find_node(code, n => is_eq(result_node, n))

  } else {
    result_node = find_node(frame, n => 
      (n.type == 'function_call' || n.type == 'new')
      && n.result != null
      && n.result.call.id == state.current_calltree_node.id
    )
    node = find_node(code, n => is_eq(result_node, n))
  }

  return {
    state: {
      ...set_location(state, {module: loc.module, index: node.index}),
      selection_state: {
        node,
        initial_is_expand: true,
        result: result_node.result,
      }
    }, 
    effects: {type: 'set_focus'}
  }

}

const select_arguments = (state, with_focus = true) => {
  if(state.current_calltree_node.toplevel) {
    return {state}
  }

  const loc = calltree_node_loc(state.active_calltree_node)
  const frame = active_frame(state)

  let node, result
  
  if(state.current_calltree_node == state.active_calltree_node) {
    if(state.active_calltree_node.toplevel) {
      return {state}
    }
    node = state.active_calltree_node.code.children[0] // function_args
    result = frame.children[0].result

  } else {
    const call = find_node(frame, n => 
      (n.type == 'function_call' || n.type == 'new')
      && n.result != null
      && n.result.call.id == state.current_calltree_node.id
    )
    const call_node = find_node(state.active_calltree_node.code, n => is_eq(n, call))
    node = call_node.children[1] // call_args
    result = call.children[1].result
  }

  return {
    state: {
      ...set_location(state, {module: loc.module, index: node.index}),
      selection_state: {
        node,
        initial_is_expand: true,
        result,
      }
    }, 
    effects: with_focus
      ? {type: 'set_focus'}
      : null,
  }
}

const navigate_logs_increment = (state, increment) => {
  if(state.logs.logs.length == 0) {
    return {state}
  }
  const index = 
    Math.max(
      Math.min(
        state.logs.log_position == null
          ? 0
          : state.logs.log_position + increment,
        state.logs.logs.length - 1
      ),
      0
    )
  return navigate_logs_position(state, index)
}

const navigate_logs_position = (state, log_position) => {
  const node = find_node(state.calltree, n =>
    n.id == state.logs.logs[log_position].id
  )
  const {state: next, effects} = select_arguments(
    expand_path(jump_calltree_node(state, node).state, node),
    false,
  )
  return {
    state: {...next, logs: {...state.logs, log_position}},
    effects,
  }
}

export const calltree_commands = {
  arrow_down, 
  arrow_up, 
  arrow_left, 
  arrow_right, 
  click,
  select_return_value,
  select_arguments,
  navigate_logs_position,
  navigate_logs_increment,
}
