import {
  zip, 
  stringify, 
  map_object, 
  filter_object, 
} from './utils.js'

import {
  find_fn_by_location, 
  find_node,
  collect_destructuring_identifiers,
  map_destructuring_identifiers,
  map_tree,
} from './ast_utils.js'

import {has_toplevel_await} from './find_definitions.js'

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

For each invocation, we can replay function body with metacircular interpreter,
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

// TODO just export const Iframe_Function?
const make_function = (...args) => {
  const fn_constructor = globalThis.run_window.Function
  return new fn_constructor(...args)
}

const codegen_function_expr = (node, cxt) => {
  const do_codegen = n => codegen(n, cxt)

  const args = node.function_args.children.map(do_codegen).join(',')

  const decl = node.is_arrow 
    ? `(${args}) => `
    : `function ${node.name}(${args})`

  const call = (node.is_async ? 'async ' : '') + decl + (
    // TODO gensym __obj, __fn
    (node.body.type == 'do')
    ? '{ let __obj, __fn;        ' + do_codegen(node.body) + '}'
    : '{ let __obj, __fn; return ' + do_codegen(node.body) + '}'
  )

  const argscount = node
    .function_args
    .children
    .find(a => a.type == 'destructuring_rest') == null
      ? node.function_args.children.length
      : null

  const location = `{index: ${node.index}, length: ${node.length}, module: '${cxt.module}'}`

  // TODO first create all functions, then assign __closure, after everything
  // is declared. See 'out of order decl' test. Currently we assign __closure
  // on first call (see `__trace`)
  const get_closure = `() => ({${[...node.closed].join(',')}})`

  return `__trace(${call}, "${node.name}", ${argscount}, ${location}, ${get_closure})`
}

/*
  in v8 `foo().bar().baz()` gives error `foo(...).bar(...).baz is not a function`
*/
const not_a_function_error = node => node.string.replaceAll(
  new RegExp('\\(.*\\)', 'g'), 
  '(...)'
)

// TODO if statically can prove that function is hosted, then do not codegen
// __trace
const codegen_function_call = (node, cxt) => {

  const do_codegen = n => codegen(n, cxt)

  const args = `[${node.args.children.map(do_codegen).join(',')}]`

  const errormessage = not_a_function_error(node.fn)

  let call
  if(node.fn.type == 'member_access') {
    const op = node.fn.is_optional_chaining ? '?.' : ''

    // TODO gensym __obj, __fn
    // We cant do `codegen(obj)[prop].bind(codegen(obj))` because codegen(obj)
    // can be expr we dont want to eval twice. Use comma operator to perform
    // assignments in expression context
    return `(
      __obj = ${do_codegen(node.fn.object)},
      __fn = __obj${op}[${do_codegen(node.fn.property)}],
      __trace_call(__fn, __obj, ${args}, ${JSON.stringify(errormessage)})
    )`
  } else {
    return `__trace_call(${do_codegen(node.fn)}, null, ${args}, \
${JSON.stringify(errormessage)})`
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
    return [
        // hoist function decls to the top
        ...node.stmts.filter(s => s.type == 'function_decl'),
        ...node.stmts.filter(s => s.type != 'function_decl'),
      ].reduce(
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
            + ': (' + do_codegen(el.value, el) + ')'
        } else {
          throw new Error('unknown node type ' + el.type)
        }
      })
      .join(',')
    return '({' + elements + '})'
  } else if(node.type == 'function_call'){
    return codegen_function_call(node, cxt)
  } else if(node.type == 'function_expr'){
    return codegen_function_expr(node, cxt)
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
      // deduce function name from variable it was assigned to if anonymous
      // works for point-free programming, like
      // const parse_statement = either(parse_import, parse_assignment, ...)
      return res + `
        if(
          typeof(${node.name_node.value}) == 'function' 
          && 
          ${node.name_node.value}.name == 'anonymous'
        ) {
          Object.defineProperty(
            ${node.name_node.value}, 
            "name", 
            {value: "${node.name_node.value}"}
          );
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
    if(node.operator == 'await') {
      return `(await __do_await(${do_codegen(node.expr)}))`
    } else {
      return '(' + node.operator + ' ' + do_codegen(node.expr) + ')'
    }
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
    const args = `[${node.args.children.map(do_codegen).join(',')}]`
    const errormessage = not_a_function_error(node.constructor)
    return `__trace_call(${do_codegen(node.constructor)}, null, ${args}, \
${JSON.stringify(errormessage)}, true)`
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
    if(names.length == 0) {
      return ''
    } else {
      return `const {${names.join(',')}} = __modules['${node.full_import_path}'];`;
    }
  } else if(node.type == 'export') {
    const identifiers = collect_destructuring_identifiers(node.binding.name_node)
      .map(i => i.value)
    return do_codegen(node.binding)
      +
      `Object.assign(__exports, {${identifiers.join(',')}});`
  } else if(node.type == 'function_decl') {
    const expr = node.children[0]
    return `const ${expr.name} = ${codegen_function_expr(expr, cxt)};`
  } else {
    console.error(node)
    throw new Error('unknown node type: ' + node.type)
  }
}

export const eval_modules = (
  parse_result,
  external_imports, 
  on_deferred_call,
  calltree_changed_token,
  location
) => {
  // TODO gensym __modules, __exports, __trace, __trace_call

  // TODO bug if module imported twice, once as external and as regular

  const is_async = has_toplevel_await(parse_result.modules)

  const codestring = `

    let children, prev_children

    // TODO use native array for stack for perf? stack contains booleans
    const stack = new Array() 

    let logs = []

    let call_counter = 0

    let current_module

    let searched_location
    let found_call

    let is_recording_deferred_calls
    let is_toplevel_call = true

    let promise_then

    function apply_promise_patch() {

      promise_then = Promise.prototype.then

      Promise.prototype.then = function then(on_resolve, on_reject) {

        if(children == null) {
          children = []
        }
        let children_copy = children

        const make_callback = (cb, ok) => typeof(cb) != 'function'
          ? cb
          : value => {
              if(this.status == null) {
                this.status = ok ? {ok, value} : {ok, error: value}
              }
              const current = children
              children = children_copy
              try {
                return cb(value)
              } finally {
                children = current
              }
            }

        return promise_then.call(
          this,
          make_callback(on_resolve, true),
          make_callback(on_reject, false),
        )
      }
    }

    function remove_promise_patch() {
      Promise.prototype.then = promise_then
    }

    apply_promise_patch()

    const set_record_call = () => {
      for(let i = 0; i < stack.length; i++) {
        stack[i] = true
      }
    }

    const do_expand_calltree_node = node => {
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

    const expand_calltree_node = (node) => {
      is_recording_deferred_calls = false
      children = null
      try {
        if(node.is_new) {
          new node.fn(...node.args)
        } else {
          node.fn.apply(node.context, node.args)
        }
      } catch(e) {
        // do nothing. Exception was caught and recorded inside '__trace'
      }
      is_recording_deferred_calls = true
      return do_expand_calltree_node(node)
    }

    const run_and_find_call = (location) => {
      searched_location = location

      const run_result = run()

      const after_run = ({calltree, modules, logs}) => {
        searched_location = null
        const call = found_call
        found_call = null

        return {
          calltree, 
          modules,
          logs,
          call,
        }
      }

      // Support to paths, one for async 'run', and one for sync, to avoid
      // refactoring code (mostly test code) to always async
      if(run_result instanceof Promise) {
        return run_result.then(after_run)
      } else {
        return after_run(run_result)
      }
    }


    /*
      Try to find call of function with given 'location'

      Function is synchronous, because we recorded calltree nodes for all async
      function calls. Here we walk over calltree, find leaves that have
      'has_more_children' set to true, and rerunning fns in these leaves with
      'searched_location' being set, until we find find call or no children
      left.

      We dont rerun entire execution because we want find_call to be
      synchronous for simplicity
    */
    const find_call = (calltree, location) => {
      // TODO remove
      if(children != null) {
        throw new Error('illegal state')
      }

      const do_find = node => {
        if(node.children != null) {
          for(let c of node.children) {
            const result = do_find(c)
            if(result != null) {
              return result
            }
          }
          // call was not find in children, return null
          return null
        }


        if(node.has_more_children) {
          try {
            if(node.is_new) {
              new node.fn(...node.args)
            } else {
              node.fn.apply(node.context, node.args)
            }
          } catch(e) {
            // do nothing. Exception was caught and recorded inside '__trace'
          }

          if(found_call != null) {
            return {
              node: do_expand_calltree_node(node),
              call: found_call,
            }
          } else {
            children = null
          }
        }

        // node has no children, return null
        return null
      }

      is_recording_deferred_calls = false
      searched_location = location

      const result = do_find(calltree)

      children = null
      searched_location = null
      found_call = null
      is_recording_deferred_calls = true

      return result
    }

    const __do_await = async value => {
      // children is an array of child calls for current function call. But it
      // can be null to save one empty array allocation in case it has no child
      // calls. Allocate array now, so we can have a reference to this array
      // which will be used after await
      if(children == null) {
        children = []
      }
      const children_copy = children
      if(value instanceof Promise) {
        promise_then.call(value,
          v => {
            value.status = {ok: true, value: v}
          },
          e => {
            value.status = {ok: false, error: e}
          }
        )
      }
      try {
        return await value
      } finally {
        children = children_copy
      }
    }

    const __trace = (fn, name, argscount, __location, get_closure) => {
      const result = (...args) => {
        if(result.__closure == null) {
          result.__closure = get_closure()
        }

        const children_copy = children
        children = null
        stack.push(false)

        const is_found_call =
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

        const is_toplevel_call_copy = is_toplevel_call
        is_toplevel_call = false

        try {
          value = fn(...args)
          ok = true
          if(value instanceof Promise) {
            set_record_call()
          }
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

          is_toplevel_call = is_toplevel_call_copy

          if(is_recording_deferred_calls && is_toplevel_call) {
            if(children.length != 1) {
              throw new Error('illegal state')
            }
            const call = children[0]
            children = null
            const _logs = logs
            logs = []
            on_deferred_call(call, calltree_changed_token, _logs)
          }
        }
      }

      Object.defineProperty(result, 'name', {value: name})
      result.__location = __location
      return result
    }

    const __trace_call = (fn, context, args, errormessage, is_new = false) => {
      if(fn != null && fn.__location != null && !is_new) {
        // Call will be traced, because tracing code is already embedded inside
        // fn
        return fn(...args)
      }

      if(typeof(fn) != 'function') {
        throw new TypeError(
          errormessage 
          + ' is not a ' 
          + (is_new ? 'constructor' : 'function')
        )
      }

      const children_copy = children
      children = null
      stack.push(false)

      // TODO: other console fns
      const is_log = fn == console.log || fn == console.error

      if(is_log) {
        set_record_call()
      }

      let ok, value, error

      try {
        if(!is_log) {
          if(is_new) {
            value = new fn(...args)
          } else {
            value = fn.apply(context, args)
          }
        } else {
          value = undefined
        }
        ok = true
        if(value instanceof Promise) {
          set_record_call()
        }
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
          is_new,
        }
        
        if(is_log) {
          // TODO do not collect logs on find_call?
          logs.push(call)
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

    const run = ${is_async ? 'async' : ''} () => {

      is_recording_deferred_calls = false

      const __modules = {
        /* external_imports passed as an argument to function generated with
         * 'new Function' constructor */
        ...external_imports
      }
      let current_call

    `
    +
    parse_result.sorted
      .map((m, i) => 
        `
         current_module = '${m}'
         found_call = null
         children = null
         current_call = {
           toplevel: true, 
           module: current_module, 
           id: call_counter++
         }
         __modules[current_module] = ${is_async ? 'await (async' : '('} () => {
            try {
              const __exports = {};
              ${codegen(parse_result.modules[m], {module: m})};
              current_call.ok = true
              return __exports
            } catch(error) {
              current_call.ok = false
              current_call.error = error
            }
         })()
         current_call.children = children
         if(!current_call.ok) {
           is_recording_deferred_calls = true
           const _logs = logs
           logs = []
           children = null
           remove_promise_patch()
           return { modules: __modules, calltree: current_call, logs: _logs }
         }
        `
      )
      .join('')
    +
    `
      is_recording_deferred_calls = true
      const _logs = logs
      logs = []
      children = null
      remove_promise_patch()
      return { modules: __modules, calltree: current_call, logs: _logs }
    }

    return {
      run,
      run_and_find_call,
      expand_calltree_node,
      find_call,
    }
    `

  const actions = make_function(
    'external_imports', 
    'on_deferred_call', 
    'calltree_changed_token',
    codestring
  )(
    /* external_imports */
    external_imports == null
    ? null
    : map_object(external_imports, (name, {module}) => module),

    /* on_deferred_call */
    (call, calltree_changed_token, logs) => {
      return on_deferred_call(
        assign_code(parse_result.modules, call),
        calltree_changed_token,
        logs,
      )
    },

    /* calltree_changed_token */
    calltree_changed_token
  )

  const calltree_actions =  {
    expand_calltree_node: (node) => {
      const expanded = actions.expand_calltree_node(node)
      return assign_code(parse_result.modules, expanded)
    },
    find_call: (calltree, location) => {
      const result = actions.find_call(calltree, location)
      if(result == null) {
        return null
      }
      const {node, call} = result
      const node_with_code = assign_code(parse_result.modules, node)
      const call_with_code = find_node(node_with_code, n => n.id == call.id)
      return {
        node: node_with_code,
        call: call_with_code,
      }
    }
  }

  const result = location == null
    ? actions.run()
    : actions.run_and_find_call(location)

  const make_result = result => ({
    modules: result.modules,
    calltree: assign_code(parse_result.modules, result.calltree),
    call: result.call,
    logs: result.logs,
    calltree_actions,
  })

  return is_async 
    ? result.then(make_result)
    : make_result(result)
}

// TODO: assign_code: benchmark and use imperative version for perf?
const assign_code = (modules, call) => {
  if(call.toplevel) {
    return {...call, 
      code: modules[call.module],
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
  return eval_modules(
    {
      modules: {'': node}, 
      sorted: ['']
    }
  ).calltree
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


// TODO also create in Iframe Context?
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

const eval_binary_expr = (node, scope, callsleft, context) => {
  const {ok, children, calls} = eval_children(node, scope, callsleft, context)
  if(!ok) {
    return {ok, children, calls}
  }

  const op = node.operator
  const a = children[0].result.value
  const b = children[1].result.value
  const value = (new Function('a', 'b', ' return a ' + op + ' b'))(a, b)
  return {ok, children, calls, value}
}


const do_eval_frame_expr = (node, scope, callsleft, context) => {
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
    return eval_children(node, scope, callsleft, context)
  } else if(node.type == 'array_literal' || node.type == 'call_args'){
    const {ok, children, calls} = eval_children(node, scope, callsleft, context)
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
    const {ok, children, calls} = eval_children(node, scope, callsleft, context)
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
  } else if(node.type == 'function_call' || node.type == 'new'){
    const {ok, children, calls} = eval_children(node, scope, callsleft, context)
    if(!ok) {
      return {ok: false, children, calls}
    } else {
      if(typeof(children[0].result.value) != 'function') {
        return {
          ok: false,
          error: context.calltree_node.error,
          children,
          calls,
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
    const fn_placeholder = Object.defineProperty(
      () => {},
      'name',
      {value: node.name}
    )
    return {
      ok: true,
      value: fn_placeholder, 
      calls: callsleft,
      children: node.children,
    }
  } else if(node.type == 'ternary') {
    const {node: cond_evaled, calls: calls_after_cond} = eval_frame_expr(
      node.cond, 
      scope, 
      callsleft,
      context
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
        calls_after_cond,
        context
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
    const {ok, children, calls} = eval_children(node, scope, callsleft, context)
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
    const {ok, children, calls} = eval_children(node, scope, callsleft, context)
    if(!ok) {
      return {ok: false, children, calls}
    } else {
      const expr = children[0]
      let ok, value, error
      if(node.operator == '!') {
        ok = true
        value = !expr.result.value
      } else if(node.operator == 'typeof') {
        ok = true
        value = typeof(expr.result.value)
      } else if(node.operator == '-') {
        ok = true
        value = - expr.result.value
      } else if(node.operator == 'await') {
        if(expr.result.value instanceof globalThis.run_window.Promise) {
          const status = expr.result.value.status
          if(status == null) {
            // Promise must be already resolved
            throw new Error('illegal state')
          } else {
            ok = status.ok
            error = status.error
            value = status.value
          }
        } else {
          ok = true
          value = expr.result.value
        }
      } else {
        throw new Error('unknown op')
      }
      return {ok, children, calls, value, error}
    }
  } else if(node.type == 'binary' && !['&&', '||', '??'].includes(node.operator)){

    return eval_binary_expr(node, scope, callsleft, context)

  } else if(node.type == 'binary' && ['&&', '||', '??'].includes(node.operator)){
    const {node: left_evaled, calls} = eval_frame_expr(
      node.children[0], 
      scope, 
      callsleft,
      context
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
      return eval_binary_expr(node, scope, callsleft, context)
    }

  } else if(node.type == 'grouping'){
    const {ok, children, calls} = eval_children(node, scope, callsleft, context)
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

const eval_children = (node, scope, calls, context) => {
  return node.children.reduce(
    ({ok, children, calls}, child) => {
      let next_child, next_ok, next_calls
      if(!ok) {
        next_child = child
        next_ok = false
        next_calls = calls
      } else {
        const result = eval_frame_expr(child, scope, calls, context)
        next_child = result.node
        next_calls = result.calls
        next_ok = next_child.result.ok
      }
      return {ok: next_ok, children: [...children, next_child], calls: next_calls}
    },
    {ok: true, children: [], calls}
  )
}

const eval_frame_expr = (node, scope, callsleft, context) => {
  const {ok, error, value, call, children, calls} 
    = do_eval_frame_expr(node, scope, callsleft, context)
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

const eval_statement = (s, scope, calls, context) => {
  if(s.type == 'do') {
    const node = s
    // hoist function decls to the top
    const function_decls = node.stmts
      .filter(s => s.type == 'function_decl')
      .map(s => {
        const {ok, children, calls: next_calls} = eval_children(s, scope, calls, context)
        if(!ok) {
          // Function decl can never fail
          throw new Error('illegal state')
        }
        if(next_calls != calls) {
          throw new Error('illegal state')
        }
        return {...s, children, result: {ok: true}}
      })

    const hoisted_functions_scope = Object.fromEntries(
      function_decls.map(decl =>
        [decl.children[0].name, decl.children[0].result.value]
      )
    )

    const initial_scope = {...scope, ...hoisted_functions_scope}

    const {ok, assignments, returned, stmts, calls: next_calls} = node.stmts.reduce(
      ({ok, returned, stmts, scope, calls, assignments}, s) => {
        if(returned || !ok) {
          return {ok, returned, scope, calls, stmts: [...stmts, s], assignments}
        } else if(s.type == 'function_decl') {
          const node = function_decls.find(decl => decl.index == s.index)
          return {
            ok: true,
            returned: false,
            node,
            assignments,
            scope,
            calls,
            stmts: [...stmts, node],
          }
        } else {
          const {
            ok, 
            returned, 
            node,
            assignments: next_assignments, 
            scope: nextscope, 
            calls: next_calls, 
          } = eval_statement(s, scope, calls, context)
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
      {ok: true, returned: false, stmts: [], scope: initial_scope, calls, assignments: {}}
    )
    const {node: next_node, scope: next_scope} = 
      apply_assignments({...node, children: stmts, result: {ok}}, assignments)
    return {
      ok,
      node: next_node,
      scope: {...scope, ...next_scope},
      returned,
      assignments,
      calls: next_calls,
    }
  } else if(s.type == 'const' || s.type == 'assignment') {
    // TODO default values for destructuring can be function calls

    const {node, calls: next_calls} 
      = eval_frame_expr(s.expr, scope, calls, context)
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

    const {node, calls: next_calls} = 
      eval_frame_expr(s.expr, scope, calls, context)

    return {
      ok: node.result.ok,
      returned: node.result.ok,
      node: {...s, children: [node], result: {ok: node.result.ok}},
      scope,
      calls: next_calls,
    }

  } else if(s.type == 'export') {
    const {ok, scope: nextscope, calls: next_calls, node} 
      = eval_statement(s.binding, scope, calls, context)
    return {
      ok,
      scope: nextscope,
      calls: next_calls,
      node: {...s, children: [node], result: {ok: node.result.ok}}
    }
  } else if(s.type == 'import') {
    const children = s.imports.map(i => (
      {...i, 
        result: {ok: true, value: context.modules[s.full_import_path][i.value]}
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

    const {node, calls: next_calls} = eval_frame_expr(s.cond, scope, calls, context)

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
          context
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
        context,
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

    const {node, calls: next_calls} = eval_frame_expr(s.expr, scope, calls, context)

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
    const {node, calls: next_calls} = eval_frame_expr(s, scope, calls, context)
    return {
      ok: node.result.ok,
      node,
      scope,
      calls: next_calls,
    }
  }
}

export const eval_frame = (calltree_node, modules) => {
  if(calltree_node.has_more_children) {
    throw new Error('illegal state')
  }
  const node = calltree_node.code
  const context = {calltree_node, modules}
  if(node.type == 'do') {
    return eval_statement(
        node,
        {}, 
        calltree_node.children,
        context,
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
          context,
        ).node
    } else {
      nextbody = eval_frame_expr(body, scope, calltree_node.children, context)
        .node
    }

    return {...node,
      result: {ok: nextbody.result.ok},
      children: [function_args_with_result, nextbody],
    }
  }
}
