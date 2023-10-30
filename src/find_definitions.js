// TODO rename to analyze.js

import {set_push, set_diff, set_union, map_object, map_find, uniq, uniq_by} 
  from './utils.js'
import {collect_destructuring_identifiers, collect_imports, ancestry, find_leaf} 
  from './ast_utils.js'

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
      n.children.map(i => [i.value, i])
    )
  } else if(n.type == 'export'){
    return scope_from_node(n.binding)
  } else if(n.type == 'let' || n.type == 'const') {
    return Object.fromEntries(
      n.children
        .flatMap(collect_destructuring_identifiers)
        .map(node => [
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
  } else if (node.type == 'decl_pair') {
    return {
      ...node, 
      children: node.children.with(0, add_trivial_definition(node.children[0]))
    }
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

export const find_definitions = (ast, globals, scope = {}, closure_scope = {}, module_name) => {
  

  // sanity check
  if(!(globals instanceof Set)) {
    throw new Error('not a set')
  }

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
      find_definitions(cs.node, globals, {...scope, ...cs.scope}, local_scope, module_name)
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
      node => find_definitions(node, globals, {...scope, ...closure_scope, ...args_scope})
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
      children = ast.children.map((c, i) => ({
        ...c, 
        definition: {
          module: full_import_path, 
          is_default: i == 0 && ast.default_import != null,
        }
      }))
    } else if(ast.type == 'const' || ast.type == 'let') {
      children = ast.children.map(add_trivial_definition)
    } else {
      children = ast.children
    }

    const {nodes, undeclared, closed} = map_find_definitions(children, 
      c => find_definitions(c, globals, scope, closure_scope)
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
    return collect_imports(modules[module])
      .map(m => sort_module_deps(m))
      .flat()
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
    const imports = node.children
      .filter(n => n.type == 'import')
      .reduce(
        (imports, n) => [
          ...imports,
          // TODO imports
          // TODO use flatmap
          ...(n.imports.map(i => ({name: i.value, from: n.module})))
        ],
        []
      )
    const exports = node.statement
      .filter(n => n.type == 'export')
      .map(n => collect_destructuring_identifiers(n.binding.name_node))
      .reduce((all, current) => [...all, ...current], [])

    return {imports, exports}
  })
}

/*
code analysis:
- name is declared once and only once (including function args). Name can be imported once
- every assignment can only be to identifier is earlier declared by let
- cannot import names that are not exported from modules.If there is default import from module, there should be default export
- module can be imported either as external or regular
- cannot return from modules toplevel
- await only in async fns
- import only from toplevel
*/
export const analyze = (node, is_toplevel = true) => {
  return [
      ...analyze_await(node, true),
      ...named_declared_once(node),
  ]
}

const collect_problems = (node, context, collector) => {
  const {context: next_context, problems: node_problems} = collector(node, context)
  if(node.children == null) {
    return node_problems
  }
  return node.children.reduce(
    (problems, c) =>  {
      const ps = collect_problems(c, next_context, collector)
      if(ps == null) {
        return problems
      } 
      if(problems == null) {
        return ps
      }
      return problems.concat(ps)
    },
    node_problems
  )
}

const analyze_await = (node, is_async_context = true) => {
  const result = collect_problems(node, is_async_context, (node, is_async_context) => {
    if(node.type == 'function_expr') {
      return {problems: null, context: node.is_async}
    }
    if(node.type == 'unary' && node.operator == 'await' && !is_async_context) {
      const _await = node.children[0]
      const problem = {
        index: _await.index, 
        length: _await.length, 
        message: 'await is only valid in async functions and the top level bodies of modules',
      }
      return {problems: [problem], context: is_async_context}
    }
    return {problems: null, context: is_async_context}
  })
  
  return result ?? []
}

const find_duplicates = names => {
  const duplicates = names.filter((n, i) => 
    names.find((name, j) => name.value == n.value && j < i) != null
  )
  const problems = duplicates.map(d => ({
    index: d.index,
    length: d.length,
    message: `Identifier '${d.value}' has already been declared`,
  }))
  return problems
}

const named_declared_once = node => {
  return collect_problems(node, null, (node, cxt) => {
    if(node.type == 'function_expr') {
      const names = collect_destructuring_identifiers(node.function_args)
      return {
        context: uniq_by(names, n => n.value),
        problems: find_duplicates(names),
      }
    } else if(node.type == 'do') {
      const names = node
        .children
        .map(c => {
          if(c.type == 'function_decl') {
            const function_expr = c.children[0]
            return {
              value: function_expr.name, 
              index: function_expr.index, 
              length: function_expr.name.length
            }
          } else {
            const scope = scope_from_node(c)
            return scope == null
              ? null
              : Object.values(scope)
          }
        })
        .flat()
        .filter(n => n != null)
      const problems = find_duplicates(
        [...(cxt ?? []), ...names]
      )
      return {context: null, problems}
    } else {
      return {context: null, problems: null}
    }
  })
  
}
