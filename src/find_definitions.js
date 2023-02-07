// TODO rename to analyze.js

import {set_push, set_diff, set_union, map_object, map_find, uniq} from './utils.js'
import {collect_destructuring_identifiers, collect_imports, ancestry, find_leaf} from './ast_utils.js'

import {globals} from './globals.js'

const map_find_definitions = (nodes, mapper) => {
  const result = nodes.map(mapper)
  const undeclared = result.reduce(
    (acc, el) => el.undeclared == null ? acc : acc.concat(el.undeclared),
    []
  )
  const closed = result.map(r => r.closed).reduce(set_union, new Set())
  return {
    nodes: result.map(r => r.node),
    undeclared,
    closed,
  }
}

const scope_from_node = n => {
  if(n.type == 'import') {
    return Object.fromEntries(
      n.imports.map(i => [i.value, i])
    )
  } else if(n.type == 'export'){
    return scope_from_node(n.binding)
  } else if(n.type == 'const' || n.type == 'let'){
    return Object.fromEntries(
      collect_destructuring_identifiers(n.name_node).map(node => [
        node.value, node
      ])
    )
  } else if(n.type == 'function_decl') {
    // Return null because of hoisting. We take function decls into account
    // first before processing statements one by one
    return null
  } else {
    return null
  }
}

const add_trivial_definition = node => {
  if(node.type == 'identifier') {
    return {...node, definition: 'self'}
  } else if(['destructuring_default', 'destructuring_rest'].includes(node.type)){
    return {...node, 
      children: [add_trivial_definition(node.name_node), ...node.children.slice(1)]
    }
  } else if(node.type == 'destructuring_pair') {
    return {...node, children: [
      node.children[0], // key
      add_trivial_definition(node.children[1]), // value
    ]}
  } else if(['array_destructuring', 'object_destructuring'].includes(node.type)) {
    return {...node, children: node.children.map(add_trivial_definition)}
  } else {
    console.error(node)
    throw new Error('not implemented')
  }
}

/*
 * The function does these things:
 * - For each occurence of identifier, attaches definition to this identifier
 * - For each closure, attaches 'closed` property with set of vars it closes
 *   over
 * - Finds undeclared identifiers
 *
 * `scope` is names that are already defined and can be used immediately.
 * `closure_scope` is names that are defined but not yet assigned, but they
 * will be assigned by the time the closures would be called
 */

// TODO in same pass find already declared
export const find_definitions = (ast, scope = {}, closure_scope = {}, module_name) => {
  if(ast.type == 'identifier'){
    if(ast.definition != null) {
      // Definition previously added by add_trivial_definition
      return {node: ast, undeclared: null, closed: new Set([ast.value])}
    } else {
      const definition = scope[ast.value]
      if(definition == null){
        if(globals.has(ast.value)) {
          return {node: {...ast, definition: 'global'}, undeclared: null, closed: new Set()}
        } else {
          return {node: ast, undeclared: [ast], closed: new Set()}
        }
      } else {
        return {
          node: {...ast, definition: {index: definition.index}}, 
          undeclared: null, 
          closed: new Set([ast.value])
        }
      }
    }
  } else if(ast.type == 'do'){
    const hoisted_functions_scope = Object.fromEntries(
      ast.children
        .filter(s => s.type == 'function_decl')
        .map(s => [s.children[0].name, s.children[0]])
    )
    const children_with_scope = ast.children
      .reduce(
        ({scope, children}, node) => ({
          scope: {...scope, ...scope_from_node(node)}, 
          children: children.concat([{node, scope}]),
        })
        ,
        {scope: hoisted_functions_scope, children: []}
      )
    const local_scope = children_with_scope.scope
    const {nodes, undeclared, closed} = map_find_definitions(children_with_scope.children, cs => 
      find_definitions(cs.node, {...scope, ...cs.scope}, local_scope, module_name)
    )
    return {
      node: {...ast, children: nodes}, 
      undeclared, 
      closed: set_diff(closed, new Set(Object.keys(local_scope))),
    }
  } else if (ast.type == 'function_expr'){
    const args_identifiers = collect_destructuring_identifiers(ast.function_args)
    const args_scope = Object.fromEntries(args_identifiers.map(a => [
      a.value, a
    ]))
    const {nodes, undeclared, closed} = map_find_definitions(ast.children, 
      node => find_definitions(node, {...scope, ...closure_scope, ...args_scope})
    )
    const next_closed = set_diff(closed, new Set(args_identifiers.map(a => a.value)))
    return {
      node: {...ast, children: nodes, closed: next_closed}, 
      undeclared,
      closed: new Set(),
    }
  } else if(ast.children != null){
    let children, full_import_path
    if(ast.type == 'import') {
      full_import_path = concat_path(module_name, ast.module)
      children = ast.children.map(c => ({...c, definition: {module: full_import_path}}))
    } else if(ast.type == 'const') {
      children = [add_trivial_definition(ast.name_node), ...ast.children.slice(1)]
    } else if(ast.type == 'let') {
      children = ast.name_node.map(add_trivial_definition)
    } else {
      children = ast.children
    }

    const {nodes, undeclared, closed} = map_find_definitions(children, 
      c => find_definitions(c, scope, closure_scope)
    )

    return {
      node: ast.type == 'import' 
        ? {...ast, children: nodes, full_import_path}
        : {...ast, children: nodes},
      undeclared, 
      closed
    }
  } else {
    return {node: ast, undeclared: null, closed: new Set()}
  }
}

export const find_export = (name, module) => {
  return map_find(module.stmts, n => {
    if(n.type != 'export') {
      return null
    }
    const ids = collect_destructuring_identifiers(n.binding.name_node)
    return ids.find(i => i.value == name)
  })
}

const BASE = 'dummy://dummy/'
const concat_path = (base, i) => {
  const result = new URL(i, BASE + base).toString()
  if(result.lastIndexOf(BASE) == 0) {
    return result.replace(BASE, '')
  } else {
    return result
  }
}

export const topsort_modules = (modules) => {
  const sort_module_deps = (module) => {
    return Object.keys(collect_imports(modules[module]))
      .reduce(
        (result, m) => result.concat(sort_module_deps(m)),
        []
      )
      .concat(module)
  }

  const sorted = Object.keys(modules).reduce(
    (result, module) => result.concat(sort_module_deps(module)),
    []
  )

  // now remove duplicates
  // quadratic, but N is supposed to be small
  return sorted.reduce(
    (result, elem) =>
      result.includes(elem)
      ? result
      : [...result, elem]
    ,
    []
  )
}

export const has_toplevel_await = modules =>
  Object.values(modules).some(m => node_has_toplevel_await(m))

const node_has_toplevel_await = node => {
  if(node.type == 'unary' && node.operator == 'await') {
    return true
  }
  if(node.type == 'function_expr') {
    return false
  }
  if(node.children == null) {
    return false
  }
  return node.children.find(c => node_has_toplevel_await(c)) != null
}

// TODO not implemented
// TODO detect cycles when loading modules
export const check_imports = modules => {
  // TODO allow circular imports
  return map_object(modules, (module, node) => {
    const imports = node.stmts
      .filter(n => n.type == 'import')
      .reduce(
        (imports, n) => [
          ...imports,
          ...(n.imports.map(i => ({name: i.value, from: n.module})))
        ],
        []
      )
    const exports = node.statement
      .filter(n => n.type == 'export')
      .map(n => collect_destructuring_identifiers(n.binding.name_node))
      .reduce((all, current) => [...all, ...current], [])

    return {imports, exports}
    //TODO check for each import, there is export
  })
  // Topological sort
  // For each module
  // Depth-traverse deps and detect cycles
}

/*
TODO: relax, only disallow code that leads to broken target code

code analysis:
- function must have one and only one return statement in every branch
- return must be the last statement in block

- name is declared once and only once (including function args). Name can be imported once
- let must be assigned once and only once (in each branch)
- every assignment can only be to if identifier is earlier declared by let
- assignment can only be inside if statement (after let) (relax it?)
- cannot import names that are not exported from modules
- module can be imported either as external or regular
- cannot return from modules (even inside toplevel if statements)
- await only in async fns
*/
export const analyze = (node, is_toplevel = true) => {
  // TODO remove
  return []

  /*
  // TODO sort by location?
  if(node.type == 'do') {
    let illegal_returns
    if(is_toplevel) {
      illegal_returns = node.stmts.filter(s => s.type == 'return')
    } else {
      const last = node.stmts[node.stmts.length - 1];
      illegal_returns = node.stmts.filter(s => s.type == 'return' && s != last);

      returns.map(node => ({
        node,
        message: 'illegal return statement',
      }));

      const last_return = last.type == 'return'
      ? null
      : {node: last, message: 'block must end with return statement'}
      

      // TODO recur to childs
    }
  } else if(node.children != null){
    return node.children
      .map(n => analyze(n, node.type == 'function_expr' ? false : is_toplevel))
      .reduce((ps, p) => ps.concat(p), [])
  } else {
    // TODO
    1
  }
  */
}
