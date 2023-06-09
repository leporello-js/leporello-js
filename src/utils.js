export const findLast = new Function('arr', 'pred', `
  for(let i = arr.length - 1; i >= 0; i--) {
    if(pred(arr[i])) {
      return arr[i]
    }
  }
`)

export const set_push = (x,y) => new Set([...x, y])

export const set_union = (x,y) => new Set([...x, ...y])

export const set_diff = (x,y) => {
  return new Set([...x].filter(el => !y.has(el)))
}

export const map_object = (obj, mapper) => Object.fromEntries(
  Object.entries(obj).map(([k, v]) => [k, mapper(k,v)])
)

export const filter_object = (obj, pred) => Object.fromEntries(
  Object.entries(obj).filter(([k, v]) => pred(k,v))
)

// https://bit.cloud/ramda/ramda/map-accum/~code
export const map_accum = new Function('fn', 'acc', 'arr', `
  let idx = 0;
  const len = arr.length;
  const result = [];
  let tuple = [acc];
  while (idx < len) {
    tuple = fn(tuple[0], arr[idx], idx);
    result[idx] = tuple[1];
    idx += 1;
  }
  return [tuple[0], result];
`)

export const map_find = (arr, mapper) => arr.reduce(
  (result, curr, i) => result ?? mapper(curr, i),
  null
)

export const stringify = val => JSON.stringify(val, null, 2)

export const zip = (x,y) => {
  if(x.length != y.length){
    throw new Error('zipped arrays must have same length')
  } else {
    return x.map((el, i) => [el, y[i]])
  }
}

export const uniq = arr => [...new Set(arr)]

export const collect_nodes_with_parents = new Function('node', 'pred', `
  const result = []

  const do_collect = (node, parent) => {
    if(node.children != null) {
      for(let c of node.children) {
        do_collect(c, node)
      }
    }
    if(pred(node)) {
      result.push({node, parent})
    }
  }

  do_collect(node, null)

  return result
`)

// TODO remove
/*
function object_diff(a,b){
  function do_object_diff(a,b, context=[]) {
    if(a == b){
      return
    }
    if(a == null && b == null){
      return
    }
    if(typeof(a) != 'object' || typeof(b) != 'object'){
      throw new Error(`not an object ${a} ${b}`)
    }
    for(let key in a) {
      if(b[key] == null) {
        throw new Error(`missing ${key} in right object ${context.join('.')}`)
      }
    }
    for(let key in b) {
      if(a[key] == null) {
        throw new Error(`missing ${key} in left object ${context.join('.')}`)
      }
      do_object_diff(a[key], b[key], context.concat([key]))
    }
  }
  try {
    do_object_diff(a,b)
  } catch(e){
    return e.message
  }
}
*/


