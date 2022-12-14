import {
  zip, 
  stringify, 
  map_object, 
  filter_object, 
} from './utils.js'

import {
  find_fn_by_location, 
  collect_destructuring_identifiers,
  map_destructuring_identifiers,
  map_tree,
} from './ast_utils.js'

// TODO: fix error messages. For example, "__fn is not a function"

/*
Generate code that records all function invocations.

for each invokation, record 
  - function that was called with its closed variables
  - args  
  - return value (or exception)
  - child invocations (deeper in the stack)

When calling function, we check if it is native or not (call it hosted). If
it is native, we record invocation at call site. If it is hosted, we dont
record invocation at call site, but function expression was wrapped in code
that records invocation. So its call will be recorded.

Note that it is not enough to record all invocation at call site, because
hosted function can be called by native functions (for example Array::map).

For each invocation, we can replay function body with metacirculat interpreter,
collecting information for editor
*/

/*
type ToplevelCall = {
  toplevel: true,
  code,
  ok,
  value,
  error,
  children
}
type Call = {
  args, 
  code,
  fn,
  ok,
  value,
  error,
  children,
}
type Node = ToplevelCall | Call
*/

const codegen_function_expr = (node, cxt, name) => {
  const do_codegen = n => codegen(n, cxt)

  const args = node.function_args.children.map(do_codegen).join(',')

  const call = `(${args}) => ` + (
    (node.body.type == 'do')
    ? '{' + do_codegen(node.body) + '}'
    : '(' + do_codegen(node.body) + ')'
  )

  const argscount = node.function_args.children.find(a => a.type == 'rest') != null
    ? node.function_args.children.length
    : null

  const location = `{index: ${node.index}, length: ${node.length}, module: '${cxt.module}'}`

  // TODO first create all functions, then assign __closure, after everything
  // is declared. See 'out of order decl' test. Currently we assign __closure
  // on first call (see `trace`)
  const get_closure = `() => ({${[...node.closed].join(',')}})`

  return `trace(${call}, "${name}", ${argscount}, ${location}, ${get_closure})`
}

// TODO if statically can prove that function is hosted, then do not codegen
// trace
const codegen_function_call = (node, cxt) => {

  const do_codegen = n => codegen(n, cxt)

  const args = `[${node.args.children.map(do_codegen).join(',')}]`

  let call
  if(node.fn.type == 'member_access') {
    // Wrap to IIFE to create scope to calculate obj.
    // We cant do `codegen(obj)[prop].bind(codegen(obj))` because codegen(obj)
    // can be expr we dont want to eval twice

    const op = node.fn.is_optional_chaining ? '?.' : ''

    // TODO gensym __obj, __fn
    return `((() => {
      const __obj = ${do_codegen(node.fn.object)};
      const __fn = __obj${op}[${do_codegen(node.fn.property)}]
      return trace_call(__fn, __obj, ${args})
    })())`
  } else {
    return `trace_call(${do_codegen(node.fn)}, null, ${args})`
  }

}

const codegen = (node, cxt, parent) => {

  const do_codegen = (n, parent) => codegen(n, cxt, parent)

  if([
    'identifier',
    'number',
    'string_literal',
    'builtin_identifier',
    'backtick_string',
  ].includes(node.type)){
    return node.value
  } else if(node.type == 'do'){
    return node.stmts.reduce(
      (result, stmt) => result + (do_codegen(stmt)) + ';\n',
      ''
    )
  } else if(node.type == 'return') {
    return 'return ' + do_codegen(node.expr) + ';'
  } else if(node.type == 'throw') {
    return 'throw ' + do_codegen(node.expr) + ';'
  } else if(node.type == 'if') {
    const left = 'if(' + do_codegen(node.cond) + '){' +
      do_codegen(node.branches[0]) + ' } ' 
    return node.branches[1] == null
      ? left
      : left + ' else { ' + do_codegen(node.branches[1]) + ' }'
  } else if(node.type == 'array_literal'){
    return '[' + node.elements.map(c => do_codegen(c)).join(', ') + ']'
  } else if(node.type == 'object_literal'){
    const elements = 
      node.elements.map(el => {
        if(el.type == 'spread'){
          return do_codegen(el)
        } else if(el.type == 'identifier') {
          return el.value
        } else if(el.type == 'key_value_pair') {
          return '[' + do_codegen(el.key.type == 'computed_property' ? el.key.expr : el.key) + ']' 
            + ': (' + do_codegen(el.value) + ')'
        } else {
          throw new Error('unknown node type ' + el.type)
        }
      })
      .join(',')
    return '({' + elements + '})'
  } else if(node.type == 'function_call'){
    return codegen_function_call(node, cxt)
  } else if(node.type == 'function_expr'){
    const name = parent != null && parent.type == 'const'
        // TODO here we deduce fn name from left-side of assignment
        // TODO name inference is much more sophisticated, for example
        // `{foo: () => {...}}` infers name `foo`
        ? parent.name
        : 'anonymous'
    return codegen_function_expr(node, cxt, name)
  } else if(node.type == 'ternary'){
    return ''
    + '(' 
    + do_codegen(node.cond)
    + ')\n? '
    + do_codegen(node.branches[0])
    +'\n: '
    + do_codegen(node.branches[1])
  } else if(node.type == 'const'){
    const res = 'const ' + do_codegen(node.name_node) + ' = ' + do_codegen(node.expr, node) + ';'
    if(node.name_node.type == 'identifier' && node.expr.type == 'function_call') {
      // generate function name
      // TODO test it
      return res + `
        if(typeof(${node.name_node.value}) == 'function') {
          Object.defineProperty(${node.name_node.value}, "name", {value: "${node.name_node.value}"});
        }
      `
    } else {
      return res
    }
  } else if(node.type == 'let') {
    return 'let ' + node.names.join(',') + ';';
  } else if(node.type == 'assignment') {
    return node.name + ' = ' + do_codegen(node.expr, node) + ';';
  } else if(node.type == 'member_access'){
    return '(' 
      + do_codegen(node.object) 
      + (node.is_optional_chaining ? ')?.[' : ')[')
      + do_codegen(node.property)  
      + ']'
  } else if(node.type == 'unary') {
    return '(' + node.operator + ' ' + do_codegen(node.expr) + ')'
  } else if(node.type == 'binary'){
    return ''
      + do_codegen(node.args[0])
      + ' ' 
      + node.operator
      + ' '
      + do_codegen(node.args[1])
  } else if(node.type == 'spread'){
    return '...(' + do_codegen(node.expr) + ')'
  } else if(node.type == 'new') {
    return '(new (' + codegen(node.constructor) + ')(' + node.args.map(do_codegen).join(',') + '))'
  } else if(node.type == 'grouping'){
    return '(' + do_codegen(node.expr) + ')'
  } else if(node.type == 'array_destructuring') {
    return '[' + node.elements.map(n => do_codegen(n)).join(', ')  + ']'
  } else if(node.type == 'object_destructuring') {
    return '{' + node.elements.map(n => do_codegen(n)).join(', ')  + '}'
  } else if(node.type == 'destructuring_rest') {
    return '...' + do_codegen(node.name_node)
  } else if(node.type == 'destructuring_default') {
    return do_codegen(node.name_node) + ' = ' + do_codegen(node.expr);
  } else if(node.type == 'destructuring_pair') {
    return do_codegen(node.key) + ' : ' + do_codegen(node.value);
  } else if(node.type == 'import') {
    const names = node.imports.map(n => n.value)
    return `const {${names.join(',')}} = __modules['${node.full_import_path}'].exports;`;
  } else if(node.type == 'export') {
    const identifiers = collect_destructuring_identifiers(node.binding.name_node)
      .map(i => i.value)
    return do_codegen(node.binding)
      +
      `Object.assign(__exports, {${identifiers.join(',')}});`
  } else {
    console.error(node)
    throw new Error('unknown node type: ' + node.type)
  }
}

export const eval_modules = (modules, sorted, location) => {
  // TODO gensym __modules, __exports

  const codestring = 
    `
    let children, prev_children
    // TODO use native array for stack?
    const stack = new Array() 

    let call_counter = 0

    let is_entrypoint
    let searched_location
    let found_call

    const set_record_call = () => {
      for(let i = 0; i < stack.length; i++) {
        stack[i] = true
      }
    }

    const expand_calltree_node = (node) => {
      children = null
      try {
        node.fn.apply(node.context, node.args)
      } catch(e) {
        // do nothing. Exception was caught and recorded inside 'trace'
      }
      if(node.fn.__location != null) {
        // fn is hosted, it created call, this time with children
        const result = children[0]
        result.id = node.id
        result.children = prev_children
        result.has_more_children = false
        return result
      } else {
        // fn is native, it did not created call, only its child did
        return {...node, 
          children,
          has_more_children: false,
        }
      }
    }

    const find_call = (entrypoint, location) => {
      searched_location = location
      const calltree = run(entrypoint)
      searched_location = null
      const call = found_call
      found_call = null
      return {calltree, call}
    }

    const trace = (fn, name, argscount, __location, get_closure) => {
      const result = (...args) => {
        if(result.__closure == null) {
          result.__closure = get_closure()
        }

        const children_copy = children
        children = null
        stack.push(false)

        const is_found_call =
          is_entrypoint
          &&
          (searched_location != null && found_call == null)
          &&
          (
            __location.index == searched_location.index
            &&
            __location.module == searched_location.module
          )

        if(is_found_call) {
          // Assign temporary value to prevent nested calls from populating
          // found_call
          found_call = {}
        }

        let ok, value, error

        try {
          value = fn(...args)
          ok = true
          return value
        } catch(_error) {
          ok = false
          error = _error
          set_record_call()
          throw error
        } finally {

          prev_children = children

          const call = {
            id: call_counter++,
            ok,
            value,
            error,
            fn: result,
            args: argscount == null 
              ? args
              // Do not capture unused args
              : args.slice(0, argscount),
          }

          if(is_found_call) {
            found_call = call
            set_record_call()
          }

          const should_record_call = stack.pop()

          if(should_record_call) {
            call.children = children
          } else {
            call.has_more_children = children != null && children.length != 0
          }
          children = children_copy
          if(children == null) {
            children = []
          }
          children.push(call)
        }
      }

      Object.defineProperty(result, 'name', {value: name})
      result.__location = __location
      return result
    }

    const trace_call = (fn, context, args) => {
      if(fn != null && fn.__location != null) {
        return fn(...args)
      }

      if(typeof(fn) != 'function') {
        return fn.apply(context, args)
      }

      const children_copy = children
      children = null
      stack.push(false)

      const is_log = is_entrypoint 
        ? fn == console.log || fn == console.error // TODO: other console fns
        : undefined

      if(is_log) {
        set_record_call()
      }

      let ok, value, error

      try {
        if(!is_log) {
          value = fn.apply(context, args)
        } else {
          value = undefined
        }
        ok = true
        return value
      } catch(_error) {
        ok = false
        error = _error
        set_record_call()
        throw error
      } finally {

        prev_children = children

        const call = {
          id: call_counter++,
          ok,
          value,
          error,
          fn,
          args,
          context,
          is_log,
        }

        const should_record_call = stack.pop()

        if(should_record_call) {
          call.children = children
        } else {
          call.has_more_children = children != null && children.length != 0
        }

        children = children_copy
        if(children == null) {
          children = []
        }
        children.push(call)
      }
    }

    const run = entrypoint => {
      const __modules = {}
      let current_call

    `
    +
    sorted
      .map((m, i) => 
        `
         is_entrypoint = entrypoint == '${m}'
         __modules['${m}'] = {}
         children = null
         current_call = {
           toplevel: true, 
           module: '${m}', 
           id: call_counter++
         }
         __modules['${m}'].calls = current_call
         __modules['${m}'].exports = 
           (() => {
              try {
                const __exports = {};
                ${codegen(modules[m], {module: m})};
                current_call.ok = true
                return __exports
              } catch(error) {
                current_call.ok = false
                current_call.error = error
              }
           })()
         current_call.children = children
         if(!__modules['${m}'].calls.ok) {
           return __modules
         }
        `
      )
      .join('')
    +
    `
      return __modules
    }

    return {
      run,
      expand_calltree_node,
      find_call,
    }
    `

  const actions = (new Function(codestring))()

  const calltree_actions =  {
    expand_calltree_node: (node) => {
      const expanded = actions.expand_calltree_node(node)
      return assign_code(modules, expanded)
    },
    find_call: (entrypoint, loc) => {
      const {calltree, call} = actions.find_call(entrypoint, loc)
      return {
        calltree: assign_code_calltree(modules, calltree),
        // TODO: `call` does not have `code` property here. Currently it is
        // worked around by callers. Refactor
        call,
      }
    }
  }

  const entrypoint = sorted[sorted.length - 1]

  let calltree, call

  if(location == null) {
    calltree = actions.run(entrypoint)
  } else {
    const result = calltree_actions.find_call(entrypoint, location)
    calltree = result.calltree
    call = result.call
  }

  return {
    calltree: assign_code_calltree(modules, calltree),
    call,
    calltree_actions,
  }
}

// TODO: assign_code: benchmark and use imperative version for perf?
const assign_code_calltree = (modules, calltree) =>
  map_object(
    calltree,
    (module, {calls, exports}) => {
      return {exports, calls: assign_code(modules, calls, modules[module])}
    }
  )

const assign_code = (modules, call, module) => {
  if(call.toplevel) {
    return {...call, 
      code: module,
      children: call.children && call.children.map(call => assign_code(modules, call)),
    }
  } else {
    return {...call, 
      code: call.fn == null || call.fn.__location == null 
        ? null
          // TODO cache find_fn_by_location calls?
        : find_fn_by_location(modules[call.fn.__location.module], call.fn.__location),
      children: call.children && call.children.map(call => assign_code(modules, call)),
    }
  }
}

export const eval_tree = node => {
  return eval_modules({'': node}, ['']).calltree[''].calls
}


/* ------------- Metacircular interpreter ---------------------------- */

/*
Evaluate single function call

For each statement or expression, calculate if it was executed or not.

Add evaluation result to each statement or expression and put it to `result`
prop. Evaluate expressions from leaves to root, substituting function calls for
already recorded results.

Add `result` prop to each local variable.

Eval statements from top to bottom, selecting effective if branch and stopping
on `return` and `throw`. When descending to nested blocks, take scope into
account
*/

// Workaround with statement forbidden in strict mode (imposed by ES6 modules)
// Also currently try/catch is not implemented TODO
const eval_codestring = new Function('codestring', 'scope', 
  // Make a copy of `scope` to not mutate it with assignments
  `
    try {
      return {ok: true, value: eval('with({...scope}){' + codestring + '}')}
    } catch(error) {
      return {ok: false, error}
    }
  `
)

const get_args_scope = (fn_node, args) => {
  const arg_names = 
    collect_destructuring_identifiers(fn_node.function_args)
    .map(i => i.value)

  const destructuring = fn_node.function_args.children.map(n => codegen(n)).join(',')

  /*
  // TODO gensym __args. Or 
  new Function(` 
    return ({foo, bar}) => ({foo, bar})
  `)(args)

  to avoid gensym
  */
  const codestring = `(([${destructuring}]) => [${arg_names.join(',')}])(__args)`

  const {ok, value, error} = eval_codestring(codestring, {__args: args})

  if(!ok) {
    // TODO show exact destructuring error
    return {ok, error}
  } else {
    return {
      ok, 
      value: Object.fromEntries(
        zip(
          arg_names,
          value,
        )
      ),
    }
  }
}

const eval_binary_expr = (node, scope, callsleft) => {
  const {ok, children, calls} = eval_children(node, scope, callsleft)
  if(!ok) {
    return {ok, children, calls}
  }

  const op = node.operator
  const a = children[0].result.value
  const b = children[1].result.value
  const value = (new Function('a', 'b', ' return a ' + op + ' b'))(a, b)
  return {ok, children, calls, value}
}


const do_eval_frame_expr = (node, scope, callsleft) => {
  if([
    'identifier',
    'builtin_identifier',
    'number',
    'string_literal',
    'backtick_string',
  ].includes(node.type)){
    // TODO exprs inside backtick string
    // Pass scope for backtick string
    return {...eval_codestring(node.value, scope), calls: callsleft}
  } else if([
    'spread',
    'key_value_pair',
    'computed_property'
  ].includes(node.type)) {
    return eval_children(node, scope, callsleft)
  } else if(node.type == 'array_literal' || node.type == 'call_args'){
    const {ok, children, calls} = eval_children(node, scope, callsleft)
    if(!ok) {
      return {ok, children, calls}
    }
    const value = children.reduce(
      (arr, el) => {
        if(el.type == 'spread') {
          return [...arr, ...el.children[0].result.value]
        } else {
          return [...arr, el.result.value]
        }
      },
      [],
    )
    return {ok, children, calls, value}
  } else if(node.type == 'object_literal'){
    const {ok, children, calls} = eval_children(node, scope, callsleft)
    if(!ok) {
      return {ok, children, calls}
    }
    const value = children.reduce(
      (value, el) => {
        if(el.type == 'spread'){
          return {...value, ...el.children[0].result.value}
        } else if(el.type == 'identifier') {
          // TODO check that it works
          return {...value, ...{[el.value]: el.result.value}}
        } else if(el.type == 'key_value_pair') {
          const [key, val] = el.children
          let k
          if(key.type == 'computed_property') {
            k = key.children[0].result.value
          } else {
            k = key.result.value
          }
          return {
            ...value,
            ...{[k]: val.result.value},
          }
        } else {
          throw new Error('unknown node type ' + el.type)
        }
      },
      {}
    )
    return {ok, children, value, calls}
  } else if(node.type == 'function_call'){
    const {ok, children, calls} = eval_children(node, scope, callsleft)
    if(!ok) {
      return {ok: false, children, calls}
    } else {
      if(typeof(children[0].result.value) != 'function') {
        return {
          ok: false,
          // TODO pass calltree_node here and extract error
          // TODO fix error messages
          error: new Error('is not a function'),
          children,
        }
      }
      const c = calls[0]
      if(c == null) {
        throw new Error('illegal state')
      }
      return {
        ok: c.ok, 
        call: c,
        value: c.value, 
        error: c.error, 
        children,
        calls: calls.slice(1)
      }
    }
  } else if(node.type == 'function_expr'){
    // It will never be called, create empty function
    // TODO use new Function constructor with code?
    // TODO generate function name
    const fn_placeholder = Object.defineProperty(
      () => {},
      'name',
      {value: 'anonymous'}
    )
    return {
      ok: true,
      value: fn_placeholder, 
      calls: callsleft,
      children: node.children,
    }
  } else if(node.type == 'ternary'){
    const {node: cond_evaled, calls: calls_after_cond} = eval_frame_expr(
      node.cond, 
      scope, 
      callsleft
    )
    const {ok, value} = cond_evaled.result
    const branches = node.branches
    if(!ok) {
      return {
        ok: false, 
        children: [cond_evaled, branches[0], branches[1]],
        calls: calls_after_cond,
      }
    } else {
      const {node: branch_evaled, calls: calls_after_branch} = eval_frame_expr(
        branches[value ? 0 : 1], 
        scope, 
        calls_after_cond
      )
      const children = value
        ? [cond_evaled, branch_evaled, branches[1]]
        : [cond_evaled, branches[0], branch_evaled]
      const ok = branch_evaled.result.ok
      if(ok) {
        return {ok, children, calls: calls_after_branch, value: branch_evaled.result.value}
      } else {
        return {ok, children, calls: calls_after_branch}
      }
    }
  } else if(node.type == 'member_access'){
    const {ok, children, calls} = eval_children(node, scope, callsleft)
    if(!ok) {
      return {ok: false, children, calls}
    }

    const [obj, prop] = children

    const codestring = node.is_optional_chaining ? 'obj?.[prop]' : 'obj[prop]'

    // TODO do not use eval here
    return {
      ...eval_codestring(codestring, {
        obj: obj.result.value,
        prop: prop.result.value,
      }),
      children,
      calls,
    }

  } else if(node.type == 'unary') {
    const {ok, children, calls} = eval_children(node, scope, callsleft)
    if(!ok) {
      return {ok: false, children, calls}
    } else {
      const expr = children[0]
      let value
      if(node.operator == '!') {
        value = !expr.result.value
      } else if(node.operator == 'typeof') {
        value = typeof(expr.result.value)
      } else {
        throw new Error('unknown op')
      }
      return {ok: true, children, calls, value}
    }
  } else if(node.type == 'binary' && !['&&', '||', '??'].includes(node.operator)){

    return eval_binary_expr(node, scope, callsleft)

  } else if(node.type == 'binary' && ['&&', '||', '??'].includes(node.operator)){
    const {node: left_evaled, calls} = eval_frame_expr(
      node.children[0], 
      scope, 
      callsleft
    )

    const {ok, value} = left_evaled.result
    if(
      !ok
      ||
      (node.operator == '&&' && !value)
      ||
      (node.operator == '||' && value)
      ||
      (node.operator == '??' && value != null)
    ) {
      return {
        ok,
        value,
        children: [left_evaled, node.children[1]],
        calls,
      }
    } else {
      return eval_binary_expr(node, scope, callsleft)
    }

  } else if(node.type == 'new') {
    const {ok, children, calls} = eval_children(node, scope, callsleft)
    if(!ok) {
      return {ok, children, calls}
    } else {
      const [constructor, ...args] = children
      const value = new (constructor.result.value)(...args.map(a => a.result.value))
      return {ok, children, value, calls}
    }
  } else if(node.type == 'grouping'){
    const {ok, children, calls} = eval_children(node, scope, callsleft)
    if(!ok) {
      return {ok, children, calls}
    } else {
      return {ok: true, children, calls, value: children[0].result.value}
    }
  } else {
    console.error(node)
    throw new Error('unknown node type: ' + node.type)
  }
}

const eval_children = (node, scope, calls) => {
  return node.children.reduce(
    ({ok, children, calls}, child) => {
      let next_child, next_ok, next_calls
      if(!ok) {
        next_child = child;
        next_ok = false;
        next_calls = calls;
      } else {
        const result = eval_frame_expr(child, scope, calls);
        next_child = result.node;
        next_calls = result.calls;
        next_ok = next_child.result.ok;
      }
      return {ok: next_ok, children: [...children, next_child], calls: next_calls}
    },
    {ok: true, children: [], calls}
  )
}

const eval_frame_expr = (node, scope, callsleft) => {
  const {ok, error, value, call, children, calls} = do_eval_frame_expr(node, scope, callsleft)
  if(callsleft != null && calls == null) {
    // TODO remove it, just for debug
    console.error('node', node)
    throw new Error('illegal state')
  }
  return {
    node: {
      ...node, 
      children, 
      // Add `call` for step_into
      result: {ok, error, value, call}
    },
    calls,
  }
}

const apply_assignments = (do_node, assignments) => {
  const let_ids = do_node
    .children
    .filter(c => c.type == 'let')
    .map(l => l.children)
    .flat()
    .map(c => c.index)

  const unused_assignments = filter_object(assignments, (index, val) => 
    let_ids.find(i => i.toString() == index) == null
  )

  // Scope we return to parent block
  const scope = Object.fromEntries(
    Object
    .entries(assignments)
    .filter(([index, v]) => 
      let_ids.find(i => i.toString() == index) == null
    )
    .map(([k, {name, value}]) => [name, value])
  )

  const node = {...do_node, 
    children: do_node.children.map(_let => {
      if(_let.type != 'let') {
        return _let
      }
      const children = _let.children.map(id => {
        const a = assignments[id.index]
        if(a == null) {
          return id
        } else {
          return {...id, result: {ok: true, value: a.value}}
        }
      })
      return {..._let, 
        result: children.every(c => c.result != null) ? {ok: true} : null,
        children
      }
    })
  }

  return {node, scope}
}


const eval_statement = (s, scope, calls, calltree) => {
  if(s.type == 'do') {
    const node = s
    const {ok, assignments, returned, stmts, calls: nextcalls} = node.stmts.reduce(
      ({ok, returned, stmts, scope, calls, assignments}, s) => {
        if(returned || !ok) {
          return {ok, returned, scope, calls, stmts: [...stmts, s], assignments}
        } else {
          const {
            ok, 
            returned, 
            node,
            assignments: next_assignments, 
            scope: nextscope, 
            calls: next_calls, 
          } = eval_statement(s, scope, calls, calltree)
          return {
            ok,
            returned,
            assignments: {...assignments, ...next_assignments},
            scope: nextscope,
            calls: next_calls,
            stmts: [...stmts, node],
          }
        }
      },
      {ok: true, returned: false, stmts: [], scope, calls, assignments: {}}
    )
    const {node: next_node, scope: next_scope} = 
      apply_assignments({...node, children: stmts, result: {ok}}, assignments)
    return {
      ok,
      node: next_node,
      scope: {...scope, ...next_scope},
      returned,
      assignments,
      calls: nextcalls,
    }
  } else if(s.type == 'const' || s.type == 'assignment') {
    // TODO default values for destructuring can be function calls

    const {node, calls: next_calls} = eval_frame_expr(s.expr, scope, calls)
    const s_expr_evaled = {...s, children: [s.name_node, node]}
    if(!node.result.ok) {
      return {
        ok: false,
        node: {...s_expr_evaled, result: {ok: false}},
        scope,
        calls: next_calls,
      }
    }

    const name_nodes = collect_destructuring_identifiers(s.name_node)
    const names = name_nodes.map(n => n.value)
    const destructuring = codegen(s.name_node)

    // TODO unique name for __value (gensym)
    const codestring = `
      const ${destructuring} = __value; 
      ({${names.join(',')}});
    `
    const {ok, value: next_scope, error} = eval_codestring(
      codestring, 
      {...scope, __value: node.result.value}
    )

    // TODO fine-grained destructuring error, only for identifiers that failed
    // destructuring
    const name_node_with_result = map_tree(
      map_destructuring_identifiers(
        s.name_node,
        node => ({...node, 
          result: {
            ok, 
            error: ok  ? null : error,
            value: !ok ? null : next_scope[node.value],
          }
        })
      ),
      n => n.result == null
        ? {...n, result: {ok}}
        : n
    )

    const s_evaled = {...s_expr_evaled, children: [
      name_node_with_result,
      s_expr_evaled.children[1],
    ]}

    if(!ok) {
      return {
        ok: false,
        // TODO assign error to node where destructuring failed, not to every node
        node: {...s_evaled, result: {ok, error}},
        scope,
        calls,
      }
    }

    return {
      ok: true,
      node: {...s_evaled, result: {ok: true}},
      scope: {...scope, ...next_scope},
      calls: next_calls,
      assignments: s.type == 'assignment'
        ? Object.fromEntries(
            name_nodes.map(n => [
              n.definition.index, 
              {
                value: next_scope[n.value],
                name: n.value,
              }
            ])
          )
        : null
    }
  } else if(s.type == 'return') {

    const {node, calls: next_calls} = eval_frame_expr(s.expr, scope, calls)

    return {
      ok: node.result.ok,
      returned: node.result.ok,
      node: {...s, children: [node], result: {ok: node.result.ok}},
      scope,
      calls: next_calls,
    }

  } else if(s.type == 'export') {
    const {ok, scope: nextscope, calls: next_calls, node} = eval_statement(s.binding, scope, calls)
    return {
      ok,
      scope: nextscope,
      calls: next_calls,
      node: {...s, children: [node], result: {ok: node.result.ok}}
    }
  } else if(s.type == 'import') {
    const children = s.imports.map(i => (
      {...i, 
        result: {ok: true, value: calltree[s.full_import_path].exports[i.value]}
      }
    ))
    const imported_scope = Object.fromEntries(children.map(i => [i.value, i.result.value]))
    return {
      ok: true,
      scope: {...scope, ...imported_scope},
      calls,
      node: {...s, children, result: {ok: true}}
    }
  } else if(s.type == 'if') {

    const {node, calls: next_calls} = eval_frame_expr(s.cond, scope, calls)

    if(!node.result.ok) {
      return {
        ok: false,
        node: {...s, children: [node, ...s.branches], result: {ok: false}},
        scope,
        calls: next_calls,
      }
    }

    if(s.branches.length == 1) {
      // if without else
      if(node.result.value) {
        // Execute branch
        const {
          node: evaled_branch, 
          returned, 
          assignments,
          scope: next_scope,
          calls: next_calls2,
        } = eval_statement(
          s.branches[0],
          scope,
          next_calls,
        )
        return {
          ok: evaled_branch.result.ok,
          returned,
          assignments,
          node: {...s, 
            children: [node, evaled_branch],
            result: {ok: evaled_branch.result.ok}
          },
          scope: next_scope,
          calls: next_calls2,
        }
      } else {
        // Branch is not executed
        return {
          ok: true,
          node: {...s, children: [node, s.branches[0]], result: {ok: true}},
          scope,
          calls: next_calls,
        }
      }
    } else {
      // if with else
      const active_branch = node.result.value ? s.branches[0] : s.branches[1]

      const {
        node: evaled_branch, 
        returned, 
        assignments,
        scope: next_scope,
        calls: next_calls2
      } = eval_statement(
        active_branch,
        scope,
        next_calls,
      )

      const children = node.result.value
        ? [node, evaled_branch, s.branches[1]]
        : [node, s.branches[0], evaled_branch]

      return {
        ok: evaled_branch.result.ok,
        returned,
        assignments,
        node: {...s, children, result: {ok: evaled_branch.result.ok}},
        scope: next_scope,
        calls: next_calls2,
      }
    }

  } else if(s.type == 'let') {

    return { ok: true, node: s, scope, calls }

  } else if(s.type == 'throw') {

    const {node, calls: next_calls} = eval_frame_expr(s.expr, scope, calls)

    return {
      ok: false,
      node: {...s, 
        children: [node], 
        result: {
          ok: false, 
          error: node.result.ok ? node.result.value : null,
        }
      },
      scope,
      calls: next_calls,
    }

  } else {
    // stmt type is expression
    const {node, calls: next_calls} = eval_frame_expr(
      s, 
      scope,
      calls,
    )
    return {
      ok: node.result.ok,
      node,
      scope,
      calls: next_calls,
    }
  }
}

export const eval_frame = (calltree_node, calltree) => {
  if(calltree_node.has_more_children) {
    throw new Error('illegal state')
  }
  const node = calltree_node.code
  if(node.type == 'do') {
    return eval_statement(
        node,
        {}, 
        calltree_node.children,
        calltree,
      ).node
  } else {
    // TODO default values for destructuring can be function calls

    const args_scope_result = get_args_scope(node, calltree_node.args)

    // TODO fine-grained destructuring error, only for identifiers that
    // failed destructuring
    const function_args_with_result = {
      ...node.function_args,
      result: args_scope_result,
      children: node.function_args.children.map(arg => 
        map_tree(
          map_destructuring_identifiers(
            arg,
            a => ({...a, 
              result: {
                ok: args_scope_result.ok,
                error:  args_scope_result.ok ? null : args_scope_result.error,
                value: !args_scope_result.ok ? null : args_scope_result.value[a.value],
              }
            })
          ),
          n => n.result == null
            ? {...n, result: {ok: args_scope_result.ok}}
            : n
        )
      )
    }

    const body = node.body

    if(!args_scope_result.ok) {
      return {...node,
        result: {ok: false},
        children: [function_args_with_result, body],
      }
    }

    const scope = {...calltree_node.fn.__closure, ...args_scope_result.value}


    let nextbody

    if(body.type == 'do') {
      nextbody = eval_statement(
          body, 
          scope,
          calltree_node.children,
        ).node
    } else {
      nextbody = eval_frame_expr(body, scope, calltree_node.children)
        .node
    }

    return {...node,
      result: {ok: nextbody.result.ok},
      children: [function_args_with_result, nextbody],
    }
  }
}
