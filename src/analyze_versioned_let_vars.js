import {collect_destructuring_identifiers} from './ast_utils.js'

const set_versioned_let_vars = (node, closed_let_vars, assigned_vars) => {
  if(
    node.type == 'identifier' 
    && closed_let_vars.find(index => node.index == index) != null
    && assigned_vars.find(index => node.index == index) != null
  ) {
    return {...node, is_versioned_let_var: true}
  } else if(node.children != null) {
    return {
      ...node, 
      children: node.children.map(c => 
        set_versioned_let_vars(c, closed_let_vars, assigned_vars)
      )
    }
  } else {
    return node
  }
}

const do_find_versioned_let_vars = (node, current_fn) => {
  const children_result = node
    .children
    .map(c => find_versioned_let_vars(c, current_fn))
  const children = children_result.map(r => r.node)
  const closed_let_vars = children_result
    .flatMap(r => r.closed_let_vars)
    .filter(r => r != null)
  const assigned_vars = children_result
    .flatMap(r => r.assigned_vars)
    .filter(r => r != null)
  return {
    node: {...node, children},
    closed_let_vars,
    assigned_vars,
  }
}

const has_versioned_let_vars = (node, is_root = true) => {
  if(node.type == 'identifier' && node.is_versioned_let_var) {
    return true
  } else if(node.type == 'function_expr' && !is_root) {
    return false
  } else if(node.children != null) {
    return node.children.find(c => has_versioned_let_vars(c, false)) != null
  } else {
    return false
  }
}

// TODO function args
export const find_versioned_let_vars = (node, current_fn = node) => {
  /*
    Assigns 'is_versioned_let_var: true' to let variables that are
      - assigned after declaration
      - closed in nested function
    and sets 'has_versioned_let_vars: true' for functions that have versioned
    let vars.

  - Traverse AST
  - collects closed_let_vars and assigned_vars going from AST bottom to root:
    - For every assignment, add assigned var to assigned_vars
    - For every use of identifier, check if it used in function where it
      declared, and populate assigned_vars otherwise
  - for 'do' node, find 'let' declarations and set is_versioned_let_var.
  */
  if(node.type == 'do') {
    const {node: result, closed_let_vars, assigned_vars} 
      = do_find_versioned_let_vars(node, current_fn)
    const next_node = {
      ...result,
      children: result.children.map(c => {
        if(c.type != 'let') {
          return c
        } else {
          const children = c.children.map(decl => {
            if(decl.type == 'identifier') {
              return set_versioned_let_vars(decl, closed_let_vars, assigned_vars)
            } else if(decl.type == 'decl_pair') {
              const [left, right] = decl.children
              return {
                ...decl, 
                children: [
                  set_versioned_let_vars(left, closed_let_vars, assigned_vars), 
                  right
                ]
              }
            } else {
              throw new Error('illegal state')
            }
          })
          return {...c, children}
        }
      })
    }
    return {
      node: node == current_fn
        // toplevel
        ? {...next_node, has_versioned_let_vars: has_versioned_let_vars(next_node)}
        : next_node,
      closed_let_vars,
      assigned_vars,
    }
  } else if(node.type == 'assignment') {
    const {node: next_node, closed_let_vars, assigned_vars} 
        = do_find_versioned_let_vars(node, current_fn)
    const next_assigned_vars = node
      .children
      .filter(c => c.type == 'decl_pair')
      .flatMap(decl_pair => 
      collect_destructuring_identifiers(decl_pair).map(id => {
        if(id.definition.index == null) {
          throw new Error('illegal state')
        }
        return id.definition.index
      })
    )
    return {
      node: next_node, 
      closed_let_vars,
      assigned_vars: [...(assigned_vars ?? []), ...next_assigned_vars],
    }
  } else if(node.type == 'function_expr') {
    const result = do_find_versioned_let_vars(node, node)
    return {
      ...result, 
      node: {
        ...result.node, 
        has_versioned_let_vars: has_versioned_let_vars(result.node)
      }
    }
  } else if(node.children != null) {
    return do_find_versioned_let_vars(node, current_fn)
  } else if(node.type == 'identifier') {
    if(node.definition == 'self') {
      return {node, closed_let_vars: null, assigned_vars: null}
    }
    const index = node.definition.index
    if(!(index >= current_fn.index && index < current_fn.index + current_fn.length)) {
      // used let var from parent function scope
      return {
        node, 
        closed_let_vars: [index],
        assigned_vars: null,
      }
    } else {
      return {node, closed_let_vars: null, assigned_vars: null}
    }
  } else if(node.children == null) {
    return {node, closed_let_vars: null, assigned_vars: null}
  }
}
