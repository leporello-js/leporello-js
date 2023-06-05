import {uniq} from './utils.js'

export const collect_destructuring_identifiers = node => {
  if(Array.isArray(node)) {
    return node.map(collect_destructuring_identifiers).flat()
  } else if(node.type == 'identifier') {
    return [node]
  } else if(['destructuring_default', 'destructuring_rest'].includes(node.type)){
    return collect_destructuring_identifiers(node.name_node)
  } else if(node.type == 'destructuring_pair') {
    return collect_destructuring_identifiers(node.value)
  } else if(
    ['array_destructuring', 'object_destructuring', 'function_args']
      .includes(node.type)
  ) {
    return node.elements
        .map(collect_destructuring_identifiers)
        .flat()
  } else {
    console.error(node)
    throw new Error('not implemented')
  }
}

export const map_destructuring_identifiers = (node, mapper) => {
  const map = node => map_destructuring_identifiers(node, mapper)
  if(node.type == 'identifier') {
    return mapper(node)
  } else if(node.type == 'destructuring_default') {
    return {...node, children: [map(node.children[0]), node.children[1]]}
  } else if(node.type == 'destructuring_rest') {
    return {...node, children: [mapper(node.children[0])]}
  } else if(node.type == 'destructuring_pair') {
    return {...node, children: [node.children[0], map(node.children[1])]}
  } else if(node.type == 'array_destructuring' || node.type == 'object_destructuring') {
    return {...node, children: node.children.map(map)}
  } else {
    console.error(node)
    throw new Error('not implemented')
  }
}

export const collect_imports = module => {
  return uniq(
    module.stmts
      .filter(n => n.type == 'import')
      .filter(n => !n.is_external)
      .map(n => n.full_import_path)
  )
}

export const collect_external_imports = modules =>
  Object
    .entries(modules)
    .map(([module_name, node]) => 
      node
        .children
        .filter(c => c.type == 'import' && c.is_external)
        .map(node => ({node, module_name}))
    )
    .flat()

export const find_leaf = (node, index) => {
  if(!(node.index <= index && node.index + node.length > index)){
    return null
  } else {
    if(node.children == null){
      return node
    } else {
      const children = node.children.map(n => find_leaf(n, index))
      const child = children.find(c => c != null)
      return child || node
    }
  }
}


export const is_child = (child, parent) => {
  return parent.index <= child.index && 
    (parent.index + parent.length) >= child.index + child.length
}

// TODO inconsistency. Sometimes we compare by identity, sometimes by this
// function
export const is_eq = (a, b) => {
  return a.index == b.index && a.length == b.length 
    // Two different nodes can have the same index and length. Currently there
    // is only one case: single-child do statement and its only child. So we
    // add `type` to comparison. Better refactor it and add unique id to every
    // node? Maybe also include `module` to id?
    && a.type == b.type
}

export const ancestry = (child, parent) => {
  if(is_eq(parent, child)){
    return []
  } else {
    if(parent.children == null){
      return null
    } else {
      const c = parent.children.find(c => is_child(child, c))
      if(c == null){
        return null
      } else {
        return ancestry(child, c).concat([parent])
      }
    }
  }
}

export const ancestry_inc = (child, parent) => 
  [child, ...ancestry(child, parent)]

export const find_fn_by_location = (node, loc) => {
  if(
    node.index == loc.index && node.length == loc.length 
      // see comment for is_eq
      && node.type == 'function_expr'
  ) {
    return node
  } else if(node.children == null){
    throw new Error('illegal state')
  } else {
    const c = node.children.find(c => is_child(loc, c))
    if(c == null){
      throw new Error('illegal state')
    } else {
      return find_fn_by_location(c, loc)
    }
  }
}

export const find_node = (node, pred) => {
  if(pred(node)) {
    return node
  }
  if(node.children == null) {
    return null  
  }
  return node
    .children
    .reduce(
      (result, c) => result ?? find_node(c, pred),
      null
    )
}

export const find_error_origin_node = node =>
  find_node(
    node, 
    n => n.result != null && !n.result.ok && (
      n.result.error != null
      ||
      // In case if throw null or throw undefined
      n.type == 'throw'
      ||
      // await can also throw null
      n.type == 'unary' && n.operator == 'await'
      // or function call throwing null or undefined
      || 
      n.type == 'function_call'
    )
  )

/* Maps tree nodes, discarding mapped children, so maps only node contents, not
 * allowing to modify structure */
export const map_tree = (node, mapper) => {
  const mapped = mapper(node)
  if(node.children == null) {
    return mapped
  }
  return {...mapped,
    children: node.children.map(c => map_tree(c, mapper))
  }
}
