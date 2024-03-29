const collect_function_exprs = new Function('root', `
  const result = []
  function do_collect(n) {
    if(n.type == 'function_expr') {
      result.push(n)
      return
    }
    if(n.children == null) {
      return
    }
    for(let c of n.children) {
      do_collect(c)
    }
  }
  do_collect(root)
  return result
`)

const is_result_eq = (a,b) => a.result == null
  ? b.result == null
  : b.result != null 
      && a.result.ok == b.result.ok 
      && !(!a.result.is_error_origin) == !(!b.result.is_error_origin)

const node_to_color = node => ({
  index: node.index, 
  length: node.length, 
  result: node.result == null 
    ? null 
    : node.type == 'function_expr'
      ? null
      : node.result.ok
        ? {ok: true}
        : {ok: false, is_error_origin: !(!node.result.is_error_origin)}
})

const is_short_circuit = node =>
  node.type == 'binary' || node.type == 'ternary'

const color_children = (node, is_root) => {
  const coloring = node.children.map(n => do_color(n)).reduce(
    (coloring, [range, ...rest]) => {
      if(coloring.length == 0) {
        return [range, ...rest]
      } else {
        const prev_range = coloring[coloring.length - 1]
        if(is_result_eq(prev_range, range)) {
          // Merge ranges
          return [
            ...coloring.slice(0, coloring.length - 1),
            {
              index: prev_range.index,
              length: range.index - prev_range.index + range.length,
              result: range.result == null ? null : {ok: range.result.ok}
            },
            ...rest
          ]
        } else if(!is_short_circuit(node) && prev_range.result == null && range.result?.ok){
          // Expand range back to the end of prev range
          const index = prev_range.index + prev_range.length
          return [
            ...coloring,
            {...range,
              index,
              length: range.index - index + range.length,
            },
            ...rest,
          ]
        } else if(!is_short_circuit(node) && prev_range.result?.ok && range.result == null) {
          // Expand prev_range until beginning of range
          const index = prev_range.index + prev_range.length
          return [
            ...coloring.slice(0, coloring.length - 1),
            {...prev_range,
              length: range.index - prev_range.index
            },
            range,
            ...rest,
          ]
        } else {
          // Append range
          return [
            ...coloring,
            range,
            ...rest,
          ]
        }
      }
    },
    []
  )

  if(
    node.result == null || node.result?.ok
    &&
    // All colors the same
    coloring.reduce(
      (result, c) => result && is_result_eq(coloring[0], c), 
      true
    )
  ) {

    if(is_result_eq(node, coloring[0])) {
      if(is_root && node.type == 'function_expr') {
        // Override null result for function expr
        return [{...node_to_color(node), result: {ok: node.result.ok}}]
      } else {
        return [node_to_color(node)]
      }
    } else {
      const node_color = node_to_color(node)
      const last = coloring[coloring.length - 1]
      const index = coloring[0].index + coloring[0].length
      return [
        {
          ...node_color,
          length: coloring[0].index - node_color.index,
        },
        ...coloring,
        {
          ...node_color,
          index,
          length: node.index + node.length - index,
        },
      ]
    }

  } 

  if(coloring.length == 0) {
    throw new Error('illegal state')
  }

  // if first child is ok, then expand it to the beginning of parent
  const first = coloring[0]
  const adj_left = is_result_eq(first, node) && node.result?.ok
    ? [
        {...first, 
          index: node.index, 
          length: first.length + first.index - node.index 
        }, 
        ...coloring.slice(1),
      ]
    : coloring

  // if last child is ok, then expand it to the end of parent
  const last = adj_left[adj_left.length - 1]
  const adj_right = is_result_eq(last, node) && node.result?.ok
    ? [
        ...adj_left.slice(0, adj_left.length - 1),
        {...last, 
          index: last.index, 
          length: node.index + node.length - last.index,
        }, 
      ]
    : adj_left

  return adj_right
}

const do_color = (node, is_root = false) => {
  if(node.type == 'function_expr' && !is_root) {
    return [{...node_to_color(node), result: null}]
  }

  if(
    false
    || node.children == null 
    || node.children.length == 0 
  ) {
    return [node_to_color(node)]
  } 

  if(node.result?.is_error_origin) {
    const color = node_to_color(node)
    const exprs = collect_function_exprs(node)
    if(exprs.length == 0) {
      return [color]
    }
    // Color node in red, but make holes for function exprs
    return exprs
      .map((e, i) => {
        let prev_index
        if(i == 0) {
          prev_index = node.index
        } else {
          const prev_expr = exprs[i - 1]
          prev_index = prev_expr.index + prev_expr.length
        }
        return {
          index: prev_index, 
          length: e.index - prev_index, 
          result: color.result
        }
      })
      .concat([{
        index: exprs.at(-1).index + exprs.at(-1).length, 
        length: node.index + node.length 
          - (exprs.at(-1).index + exprs.at(-1).length), 
        result: color.result,
      }])
  } 

  const result = color_children(node, is_root)
  return node.result != null && !node.result.ok
    ? result.map(c => c.result == null
        ? {...c, result: {ok: false, is_error_origin: false}}
        : c
      )
    : result
}

export const color = frame => {
  const coloring = do_color(frame, true)
    .filter(c => 
      // Previously we colored nodes that were not reach to grey color, now we
      // just skip them
      c.result != null
      &&
      // Parts that were not error origins
      (c.result.ok || c.result.is_error_origin)
    )

  // Sanity-check result
  const {ok} = coloring.reduce(
    ({ok, prev}, c) => {
      if(!ok) {
        return {ok}
      }
      if(prev == null) {
        return {ok, prev: c}
      } else {
        // Check that prev is before next
        // TODO check that next is right after prev, ie change > to ==
        if(prev.index + prev.length > c.index) {
          return {ok: false}
        } else {
          return {ok: true, prev: c}
        }
      }
    },
    {ok: true, prev: null}
  )
  if(!ok) {
    throw new Error('illegal state')
  }
  return coloring
}

export const color_file = (state, file) =>
  Object
    .values(state.colored_frames?.[file] ?? {})
    .filter(node_id => node_id != null)
    .map(node_id => state.frames[node_id].coloring)
    .flat()
