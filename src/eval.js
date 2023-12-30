import {
  zip, 
  stringify, 
  map_object, 
  filter_object, 
} from './utils.js'

import {
  find_fn_by_location, 
  find_declaration,
  find_leaf,
  collect_destructuring_identifiers,
  map_destructuring_identifiers,
  map_tree,
} from './ast_utils.js'

import {has_toplevel_await} from './find_definitions.js'

// import runtime as external because it has non-functional code
// external
import {run, do_eval_expand_calltree_node, LetMultiversion} from './runtime/runtime.js'

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

const codegen_function_expr = (node, node_cxt) => {
  const do_codegen = n => codegen(n, node_cxt)

  const args = node.function_args.children.map(do_codegen).join(',')

  const decl = node.is_arrow 
    ? `(${args}) => `
    : `function(${args})`

  // TODO gensym __obj, __fn, __call_id, __let_vars
  const prolog = 
    '{const __call_id = __cxt.call_counter;' 
    + (
        node.has_versioned_let_vars
        ? 'const __let_vars = __cxt.let_vars;'
        : ''
      )

  const call = (node.is_async ? 'async ' : '') + decl + (
    (node.body.type == 'do')
    ? prolog +             do_codegen(node.body) + '}'
    : prolog + 'return ' + do_codegen(node.body) + '}'
  )

  const argscount = node
    .function_args
    .children
    .find(a => a.type == 'destructuring_rest') == null
      ? node.function_args.children.length
      : null

  const location = `{index: ${node.index}, length: ${node.length}, module: '${node_cxt.module}'}`

  // TODO first create all functions, then assign __closure, after everything
  // is declared. See 'out of order decl' test. Currently we assign __closure
  // on first call (see `__trace`)
  const get_closure = `() => ({${[...node.closed].join(',')}})`

  return `__trace(__cxt, ${call}, "${node.name}", ${argscount}, ${location}, \
${get_closure}, ${node.has_versioned_let_vars})`
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
const codegen_function_call = (node, node_cxt) => {

  const do_codegen = n => codegen(n, node_cxt)

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
      __trace_call(__cxt, __fn, __obj, ${args}, ${JSON.stringify(errormessage)})
    )`
  } else {
    return `__trace_call(__cxt, ${do_codegen(node.fn)}, null, ${args}, \
${JSON.stringify(errormessage)})`
  }

}

// Note that we use 'node.index + 1' as index, which
// does not correspond to any ast node, we just use it as a convenient
// marker
export const get_after_if_path = node => node.index + 1

const codegen = (node, node_cxt) => {

  const do_codegen = n => codegen(n, node_cxt)

  if(node.type == 'identifier') {

    if(node.definition == 'self' || node.definition == 'global') {
      return node.value
    }

    if(node.definition.index == null) {
      throw new Error('illegal state')
    }
    if(
      !node_cxt.literal_identifiers && 
      find_leaf(node_cxt.toplevel, node.definition.index).is_versioned_let_var
    ) {
      return node.value + '.get()'
    }

    return node.value
  } else if([
    'number',
    'string_literal',
    'builtin_identifier',
    'backtick_string',
  ].includes(node.type)){
    return node.value
  } else if(node.type == 'do'){
    return [
        // hoist function decls to the top
        ...node.children.filter(s => s.type == 'function_decl'),
        ...node.children.filter(s => s.type != 'function_decl'),
      ].reduce(
        (result, stmt) => result + (do_codegen(stmt)) + ';\n',
        ''
      )
  } else if(node.type == 'return') {
    return 'return ' + do_codegen(node.expr) + ';'
  } else if(node.type == 'throw') {
    return 'throw ' + do_codegen(node.expr) + ';'
  } else if(node.type == 'if') {
    const codegen_branch = branch => 
      `{ __save_ct_node_for_path(__cxt, __calltree_node_by_loc, ${branch.index}, __call_id);`
      + do_codegen(branch) 
      + '}' 
    const left = 'if(' + do_codegen(node.cond) + ')'
      + codegen_branch(node.branches[0])
    const result = node.branches[1] == null
      ? left
      : left + ' else ' + codegen_branch(node.branches[1])
    // add path also for point after if statement, in case there was a return
    // inside if statement. 
    return result + 
      `__save_ct_node_for_path(__cxt, __calltree_node_by_loc, `
        + `${get_after_if_path(node)}, __call_id);`
  } else if(node.type == 'array_literal'){
    return '[' + node.elements.map(c => do_codegen(c)).join(', ') + ']'
  } else if(node.type == 'object_literal'){
    const elements = 
      node.elements.map(el => {
        if(el.type == 'object_spread'){
          return do_codegen(el)
        } else if(el.type == 'identifier') {
          const value = do_codegen(el)
          return el.value + ': ' + value
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
    return codegen_function_call(node, node_cxt)
  } else if(node.type == 'function_expr'){
    return codegen_function_expr(node, node_cxt)
  } else if(node.type == 'ternary'){
    const branches = node.branches.map(branch => 
      `(__save_ct_node_for_path(__cxt, __calltree_node_by_loc, ${branch.index}, __call_id), `
      + do_codegen(branch)
      + ')'
    )
    return ''
    + '(' 
    + do_codegen(node.cond)
    + ')\n? '
    + branches[0]
    +'\n: '
    + branches[1]
  } else if(['const', 'let', 'assignment'].includes(node.type)) {
    const prefix = node.type == 'assignment'
      ? ''
      : node.type + ' '
    return prefix + node
      .children
      .map(c => {
        if(node.type == 'let') {
          let lefthand, righthand
          if(c.type == 'identifier') {
            // let decl without assignment, like 'let x'
            lefthand = c
            if(!lefthand.is_versioned_let_var) {
              return lefthand.value
            }
          } else if(c.type == 'decl_pair') {
            lefthand = c.children[0], righthand = c.children[1]
            if(lefthand.type != 'identifier') {
              // TODO
              // See comment for 'simple_decl_pair' in 'src/parse_js.js'
              // Currently it is unreachable
              throw new Error('illegal state')
            }
          } else {
            throw new Error('illegal state')
          }
          if(lefthand.is_versioned_let_var) {
            const name = lefthand.value
            const symbol = symbol_for_let_var(lefthand)
            return  name + (
              righthand == null
                ?  ` = __let_vars['${symbol}'] = new __Multiversion(__cxt)`
                :  ` = __let_vars['${symbol}'] = new __Multiversion(__cxt, ${do_codegen(righthand)})`
            )
          } // Otherwise goes to the end of the func
        }
        
        if(node.type == 'assignment') {
          const [lefthand, righthand] = c.children
          if(lefthand.type != 'identifier') {
            // TODO
            // See comment for 'simple_decl_pair' in 'src/parse_js.js'
            // Currently it is unreachable
            throw new Error('TODO: illegal state')
          }
          const let_var = find_leaf(node_cxt.toplevel, lefthand.definition.index)
          if(let_var.is_versioned_let_var){
            return lefthand.value + '.set(' + do_codegen(righthand, node) + ')'
          }
        }

        return do_codegen(c.children[0]) + ' = ' + do_codegen(c.children[1])
      })
      .join(',') 
    + ';'
    + node.children.map(decl => {
        if(
          node.type != 'assignment'
          &&
          decl.type != 'identifier' 
          && 
          decl.name_node.type == 'identifier' 
          && 
          decl.expr.type == 'function_call'
        ) {
          // deduce function name from variable it was assigned to if anonymous
          // works for point-free programming, like
          // const parse_statement = either(parse_import, parse_assignment, ...)
          return `
            if(
              typeof(${decl.name_node.value}) == 'function' 
              && 
              ${decl.name_node.value}.name == 'anonymous'
            ) {
              Object.defineProperty(
                ${decl.name_node.value}, 
                "name", 
                {value: "${decl.name_node.value}"}
              );
            }
          `
        } else {
          return ''
        }
      })
      .join('')
  } else if(node.type == 'member_access'){
    return '(' 
      + do_codegen(node.object) 
      + (node.is_optional_chaining ? ')?.[' : ')[')
      + do_codegen(node.property)  
      + ']'
  } else if(node.type == 'unary') {
    if(node.operator == 'await') {
      return `(await __do_await(__cxt, ${do_codegen(node.expr)}))`
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
  } else if(node.type == 'array_spread' || node.type == 'object_spread'){
    return '...(' + do_codegen(node.expr) + ')'
  } else if(node.type == 'new') {
    const args = `[${node.args.children.map(do_codegen).join(',')}]`
    const errormessage = not_a_function_error(node.constructor)
    return `__trace_call(__cxt, ${do_codegen(node.constructor)}, null, ${args},\
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
    let names, def
    if(node.default_import != null) {
      def = `default: ${node.default_import},`
      names = node.children.slice(1).map(n => n.value)
    } else {
      def = ''
      names = node.children.map(n => n.value)
    }
    return `const {${def} ${names.join(',')}} = __cxt.modules['${node.full_import_path}'];`;
  } else if(node.type == 'export') {
    if(node.is_default) {
      return `__cxt.modules['${node_cxt.module}'].default = ${do_codegen(node.children[0])};`
    } else {
      const identifiers = node
        .binding
        .children
        .flatMap(n => collect_destructuring_identifiers(n.name_node))
        .map(i => i.value)
      return do_codegen(node.binding)
        +
        `Object.assign(__cxt.modules['${node_cxt.module}'], {${identifiers.join(',')}});`
    }
  } else if(node.type == 'function_decl') {
    const expr = node.children[0]
    return `const ${expr.name} = ${codegen_function_expr(expr, node_cxt)};`
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
  io_trace,
  location
) => {
  // TODO gensym __cxt, __trace, __trace_call, __calltree_node_by_loc,
  // __do_await, __Multiversion

  // TODO bug if module imported twice, once as external and as regular

  const is_async = has_toplevel_await(parse_result.modules)

  const Function = is_async
    ? globalThis.app_window.eval('(async function(){})').constructor
    : globalThis.app_window.Function

  const module_fns = parse_result.sorted.map(module => {
    const code = codegen(
      parse_result.modules[module], 
      {
        module,
        toplevel: parse_result.modules[module], 
      }
    )
    return {
      module,
      // TODO refactor, instead of multiple args prefixed with '__', pass
      // single arg called `runtime`
      fn: new Function(
        '__cxt',
        '__let_vars',
        '__calltree_node_by_loc',
        '__trace',
        '__trace_call',
        '__do_await',
        '__save_ct_node_for_path',
        '__Multiversion',

        /* Add dummy __call_id for toplevel. It does not make any sence
         * (toplevel is executed only once unlike function), we only add it
         * because we dont want to codegen differently for if statements in
         * toplevel and if statements within functions*/
        'const __call_id = __cxt.call_counter;' + 
        code
      )
    }
  })

  const cxt = {
    modules: external_imports == null
      ? {}
      : map_object(external_imports, (name, {module}) => module),

    call_counter: 0,
    version_counter: 0,
    children: null,
    prev_children: null,
    // TODO use native array for stack for perf? stack contains booleans
    stack: new Array(),

    is_recording_deferred_calls: false,
    on_deferred_call: (call, calltree_changed_token, logs) => {
      return on_deferred_call(
        assign_code(parse_result.modules, call),
        calltree_changed_token,
        logs,
      )
    },
    calltree_changed_token,
    is_toplevel_call: true,

    window: globalThis.app_window,
  }

  const result = run(module_fns, cxt, io_trace)

  const make_result = result => {
    const calltree = assign_code(parse_result.modules, result.calltree)
    return {
      modules: result.modules,
      logs: result.logs,
      rt_cxt: result.rt_cxt,
      calltree,
      calltree_node_by_loc: result.calltree_node_by_loc,
      io_trace: result.rt_cxt.io_trace,
    }
  }

  if(is_async) {
    return result.__original_then(make_result)
  } else {
    return make_result(result)
  }
}


export const eval_expand_calltree_node = (cxt, parse_result, node) => {
  return assign_code(
    parse_result.modules, 
    do_eval_expand_calltree_node(cxt, node)
  )
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
export const eval_codestring = (codestring, scope) => 
  // Note that we eval code in context of app_window
  (new (globalThis.app_window.Function)('codestring', 'scope', 
    // Make a copy of `scope` to not mutate it with assignments
    `
      try {
        return {ok: true, value: eval('with({...scope}){' + codestring + '}')}
      } catch(error) {
        return {ok: false, error, is_error_origin: true}
      }
    `
  ))(codestring, scope)

const get_args_scope = (fn_node, args, closure) => {
  const arg_names = 
    collect_destructuring_identifiers(fn_node.function_args)
    .map(i => i.value)

  const destructuring = fn_node
    .function_args
    .children.map(n => codegen(n, {literal_identifiers: true}))
    .join(',')

  /*
  // TODO gensym __args. Or 
  new Function(` 
    return ({foo, bar}) => ({foo, bar})
  `)(args)

  to avoid gensym
  */
  const codestring = `(([${destructuring}]) => [${arg_names.join(',')}])(__args)`

  const {ok, value, error} = eval_codestring(codestring, {
    ...closure,
    __args: args,
  })

  if(!ok) {
    // TODO show exact destructuring error
    return {ok, error, is_error_origin: true}
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

const eval_binary_expr = (node, eval_cxt, frame_cxt) => {
  const {ok, children, eval_cxt: next_eval_cxt} = eval_children(node, eval_cxt, frame_cxt)
  if(!ok) {
    return {ok, children, eval_cxt: next_eval_cxt}
  }

  const op = node.operator
  const a = children[0].result.value
  const b = children[1].result.value
  const value = (new Function('a', 'b', ' return a ' + op + ' b'))(a, b)
  return {ok, children, value, eval_cxt: next_eval_cxt}
}

const is_symbol_for_let_var = symbol =>
  symbol.startsWith('!')

const symbol_for_let_var = let_var_node => 
  '!' + let_var_node.value + '_' + let_var_node.index

const symbol_for_closed_let_var = name => 
  '!' + name + '_' + 'closed'

/*
  For versioned let vars, any function call within expr can mutate let vars, so
  it can change current scope and outer scopes. Since current scope and outer
  scope can have let var with the same name, we need to address them with
  different names. Prepend '!' symbol because it is not a valid js identifier,
  so it will not be mixed with other variables
*/
const symbol_for_identifier = (node, frame_cxt) => {
  if(node.definition == 'global') {
    return node.value
  }

  const index = node.definition == 'self' ? node.index : node.definition.index
  const declaration = find_declaration(frame_cxt.calltree_node.code, index)

  const variable = node.definition == 'self'
    ? node
    : find_leaf(frame_cxt.calltree_node.code, node.definition.index)
  if(declaration == null) {
    /*
    Variable was declared in outer scope. Since there can be only one variable
    with given name in outer scope, generate a name for it
    */
    return symbol_for_closed_let_var(node.value)
  }
  if(declaration.type == 'let'){
    return symbol_for_let_var(variable)
  } else {
    return node.value
  }
}
  
const do_eval_frame_expr = (node, eval_cxt, frame_cxt) => {
  if(node.type == 'identifier') {
    let value
    if(node.definition == 'global') {
      value = globalThis.app_window[node.value]
    } else {
      value = eval_cxt.scope[symbol_for_identifier(node, frame_cxt)]
    }
    return {
      ok: true,
      value,
      eval_cxt,
    }
  } else if([
    'builtin_identifier',
    'number',
    'string_literal',
    'backtick_string',
  ].includes(node.type)){
    // TODO exprs inside backtick string
    // TODO for string literal and number, do not use eval
    return {...eval_codestring(node.value, eval_cxt.scope), eval_cxt}
  } else if(node.type == 'array_spread') {
    const result = eval_children(node, eval_cxt, frame_cxt)
    if(!result.ok) {
      return result
    }
    const child = result.children[0]
    if((typeof(child.result.value?.[Symbol.iterator])) == 'function') {
      return result
    } else {
      return {
        ok: false,
        children: result.children,
        eval_cxt: result.eval_cxt,
        error: new TypeError(child.string + ' is not iterable'),
        is_error_origin: true,
      }
    }
  } else if([
    'object_spread',
    'key_value_pair',
    'computed_property'
  ].includes(node.type)) {
    return eval_children(node, eval_cxt, frame_cxt)
  } else if(node.type == 'array_literal' || node.type == 'call_args'){
    const {ok, children, eval_cxt: next_eval_cxt} = eval_children(node, eval_cxt, frame_cxt)
    if(!ok) {
      return {ok, children, eval_cxt: next_eval_cxt}
    }
    const value = children.reduce(
      (arr, el) => {
        if(el.type == 'array_spread') {
          return [...arr, ...el.children[0].result.value]
        } else {
          return [...arr, el.result.value]
        }
      },
      [],
    )
    return {ok, children, value, eval_cxt: next_eval_cxt}
  } else if(node.type == 'object_literal'){
    const {ok, children, eval_cxt: next_eval_cxt} = eval_children(node, eval_cxt, frame_cxt)
    if(!ok) {
      return {ok, children, eval_cxt: next_eval_cxt}
    }
    const value = children.reduce(
      (value, el) => {
        if(el.type == 'object_spread'){
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
    return {ok, children, value, eval_cxt: next_eval_cxt}
  } else if(node.type == 'function_call' || node.type == 'new'){
    const {ok, children, eval_cxt: next_eval_cxt} = eval_children(node, eval_cxt, frame_cxt)
    if(!ok) {
      return {ok: false, children, eval_cxt: next_eval_cxt}
    } else {
      if(typeof(children[0].result.value) != 'function') {
        return {
          ok: false,
          error: frame_cxt.calltree_node.error,
          is_error_origin: true,
          children,
          eval_cxt: next_eval_cxt,
        }
      }
      const calls = frame_cxt.calltree_node.children
      const call = calls == null ? null : calls[next_eval_cxt.call_index]
      if(call == null) {
        throw new Error('illegal state')
      }

      const closure = frame_cxt.calltree_node.fn?.__closure
      const closure_let_vars = closure == null
        ? null
        : Object.fromEntries(
            Object.entries(closure)
              .filter(([k,value]) => value instanceof LetMultiversion)
              .map(([k,value]) => [symbol_for_closed_let_var(k), value])
          )

      const let_vars = {
        ...frame_cxt.calltree_node.let_vars, 
        ...closure_let_vars,
      }

      const updated_let_scope = map_object(let_vars, (name, v) => 
        v.get_version(call.last_version_number)
      )

      return {
        ok: call.ok, 
        call,
        value: call.value, 
        error: call.error, 
        is_error_origin: !call.ok,
        children,
        eval_cxt: {
          ...next_eval_cxt, 
          call_index: next_eval_cxt.call_index + 1,
          scope: {...next_eval_cxt.scope, ...updated_let_scope},
        },
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
      eval_cxt,
      children: node.children,
    }
  } else if(node.type == 'ternary') {
    const {node: cond_evaled, eval_cxt: eval_cxt_after_cond} = eval_frame_expr(
      node.cond, 
      eval_cxt,
      frame_cxt,
    )
    const {ok, value} = cond_evaled.result
    const branches = node.branches
    if(!ok) {
      return {
        ok: false, 
        children: [cond_evaled, branches[0], branches[1]],
        eval_cxt: eval_cxt_after_cond,
      }
    } else {
      const {node: branch_evaled, eval_cxt: eval_cxt_after_branch} 
        = eval_frame_expr(
        branches[value ? 0 : 1], 
        eval_cxt_after_cond,
        frame_cxt
      )
      const children = value
        ? [cond_evaled, branch_evaled, branches[1]]
        : [cond_evaled, branches[0], branch_evaled]
      const ok = branch_evaled.result.ok
      if(ok) {
        return {ok, children, eval_cxt: eval_cxt_after_branch, 
          value: branch_evaled.result.value}
      } else {
        return {ok, children, eval_cxt: eval_cxt_after_branch}
      }
    }
  } else if(node.type == 'member_access'){
    const {ok, children, eval_cxt: next_eval_cxt} = eval_children(node, eval_cxt, frame_cxt)
    if(!ok) {
      return {ok: false, children, eval_cxt: next_eval_cxt}
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
      eval_cxt: next_eval_cxt,
    }

  } else if(node.type == 'unary') {
    const {ok, children, eval_cxt: next_eval_cxt} = eval_children(node, eval_cxt, frame_cxt)
    if(!ok) {
      return {ok: false, children, eval_cxt: next_eval_cxt}
    } else {
      const expr = children[0]
      let ok, value, error, is_error_origin
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
        if(expr.result.value instanceof globalThis.app_window.Promise) {
          const status = expr.result.value.status
          if(status == null) {
            // Promise must be already resolved
            throw new Error('illegal state')
          } else {
            ok = status.ok
            error = status.error
            value = status.value
            is_error_origin = !ok
          }
        } else {
          ok = true
          value = expr.result.value
        }
      } else {
        throw new Error('unknown op')
      }
      return {ok, children, value, error, is_error_origin, eval_cxt: next_eval_cxt}
    }
  } else if(node.type == 'binary' && !['&&', '||', '??'].includes(node.operator)){

    return eval_binary_expr(node, eval_cxt, frame_cxt)

  } else if(node.type == 'binary' && ['&&', '||', '??'].includes(node.operator)){
    const {node: left_evaled, eval_cxt: next_eval_cxt} = eval_frame_expr(
      node.children[0], 
      eval_cxt,
      frame_cxt
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
        eval_cxt: next_eval_cxt,
      }
    } else {
      return eval_binary_expr(node, eval_cxt, frame_cxt)
    }

  } else if(node.type == 'grouping'){
    const {ok, children, eval_cxt: next_eval_cxt} = eval_children(node, eval_cxt, frame_cxt)
    if(!ok) {
      return {ok, children, eval_cxt: next_eval_cxt}
    } else {
      return {ok: true, children, value: children[0].result.value, eval_cxt: next_eval_cxt}
    }
  } else {
    console.error(node)
    throw new Error('unknown node type: ' + node.type)
  }
}

const eval_children = (node, eval_cxt, frame_cxt) => {
  return node.children.reduce(
    ({ok, children, eval_cxt}, child) => {
      let next_child, next_ok, next_eval_cxt
      if(!ok) {
        next_child = child
        next_ok = false
        next_eval_cxt = eval_cxt
      } else {
        const result = eval_frame_expr(child, eval_cxt, frame_cxt)
        next_child = result.node
        next_ok = next_child.result.ok
        next_eval_cxt = result.eval_cxt
      }
      return {
        ok: next_ok, 
        children: [...children, next_child], 
        eval_cxt: next_eval_cxt,
      }
    },
    {ok: true, children: [], eval_cxt}
  )
}

const eval_frame_expr = (node, eval_cxt, frame_cxt) => {
  const {ok, error, is_error_origin, value, call, children, eval_cxt: next_eval_cxt} 
    = do_eval_frame_expr(node, eval_cxt, frame_cxt)
  return {
    node: {
      ...node, 
      children, 
      // Add `call` for step_into
      result: {ok, error, value, call, is_error_origin}
    },
    eval_cxt: next_eval_cxt,
  }
}

const eval_decl_pair = (s, eval_cxt, frame_cxt) => {
  if(s.type != 'decl_pair') {
    throw new Error('illegal state')
  }
  // TODO default values for destructuring can be function calls

  const {node, eval_cxt: next_eval_cxt} 
    = eval_frame_expr(s.expr, eval_cxt, frame_cxt)
  const s_expr_evaled = {...s, children: [s.name_node, node]}
  if(!node.result.ok) {
    return {
      ok: false,
      node: {...s_expr_evaled, result: {ok: false}},
      eval_cxt: next_eval_cxt,
    }
  }

  const name_nodes = collect_destructuring_identifiers(s.name_node)
  const names = name_nodes.map(n => n.value)
  const destructuring = codegen(s.name_node, {literal_identifiers: true})

  // TODO if destructuring is just one id, then do not use eval_codestring

  // TODO unique name for __value (gensym)
  const codestring = `
    const ${destructuring} = __value; 
    ({${names.join(',')}});
  `
  const {ok, value: values, error} = eval_codestring(
    codestring, 
    {...next_eval_cxt.scope, __value: node.result.value}
  )

  const next_scope = Object.fromEntries(name_nodes.map(n => 
    [symbol_for_identifier(n, frame_cxt), values[n.value]]
  ))

  // TODO fine-grained destructuring error, only for identifiers that failed
  // destructuring
  const name_node_with_result = map_tree(
    map_destructuring_identifiers(
      s.name_node,
      node => ({...node, 
        result: {
          ok, 
          error: ok  ? null : error,
          value: !ok ? null : next_scope[symbol_for_identifier(node, frame_cxt)],
        }
      })
    ),
    n => 
      // TODO this should set result for default values in destructuring
      // Currently not implemented
      n.result == null
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
      node: {...s_evaled, result: {ok, error, is_error_origin: true}},
      eval_cxt: next_eval_cxt,
    }
  }

  return {
    ok: true,
    node: {...s_evaled, result: {...node.result, call: null}},
    eval_cxt: {
      ...next_eval_cxt,
      scope: {...next_eval_cxt.scope, ...next_scope},
    }
  }
}


const eval_statement = (s, eval_cxt, frame_cxt) => {
  if(s.type == 'do') {
    const stmt = s
    // hoist function decls to the top
    const function_decls = s.children
      .filter(s => s.type == 'function_decl')
      .map(s => {
        const {ok, children, eval_cxt: next_eval_cxt} = eval_children(s, eval_cxt, frame_cxt)
        if(!ok) {
          // Function decl can never fail
          throw new Error('illegal state')
        }
        if(eval_cxt != next_eval_cxt) {
          throw new Error('illegal state')
        }
        return {...s, children, result: {ok: true}}
      })

    const hoisted_functions_scope = Object.fromEntries(
      function_decls.map(decl =>
        [decl.children[0].name, decl.children[0].result.value]
      )
    )

    const initial_scope = {...eval_cxt.scope, ...hoisted_functions_scope}
    const initial = {
      ok: true, 
      returned: false, 
      children: [], 
      eval_cxt: {...eval_cxt, scope: initial_scope}
    }

    const {ok, returned, children, eval_cxt: next_eval_cxt}  = 
      s.children.reduce( ({ok, returned, children, eval_cxt}, s) => {
        if(returned || !ok) {
          return {ok, returned, eval_cxt, children: [...children, s]}
        } else if(s.type == 'function_decl') {
          const node = function_decls.find(decl => decl.index == s.index)
          return {
            ok: true,
            returned: false,
            node,
            eval_cxt,
            children: [...children, node],
          }
        } else {
          const {
            ok, 
            returned, 
            node,
            eval_cxt: next_eval_cxt,
          } = eval_statement(s, eval_cxt, frame_cxt)
          return {
            ok,
            returned,
            eval_cxt: next_eval_cxt,
            children: [...children, node],
          }
        }
      },
      initial,
    )
    const let_vars_scope = filter_object(next_eval_cxt.scope, (k, v) => 
      is_symbol_for_let_var(k)
    )
    return {
      ok,
      node: {...s, children: children, result: {ok}},
      returned,
      eval_cxt: {
        ...next_eval_cxt,
        scope: {...eval_cxt.scope, ...let_vars_scope},
      }
    }
  } else if(['let', 'const', 'assignment'].includes(s.type)) {
    const stmt = s

    const initial = {ok: true, children: [], eval_cxt}

    const {ok, children, eval_cxt: next_eval_cxt} = s.children.reduce(
      ({ok, children, eval_cxt}, s) => {
        if(!ok) {
          return {ok, eval_cxt, children: [...children, s]}
        } 
        if(stmt.type == 'let' && s.type == 'identifier') {
          const node = {...s, result: {ok: true}}
          const scope = {...eval_cxt.scope, [symbol_for_identifier(s, frame_cxt)]: undefined}
          return {
            ok, 
            children: [...children, node], 
            eval_cxt: {...eval_cxt, scope},
          }
        }
        const {
          ok: next_ok, 
          node,
          eval_cxt: next_eval_cxt,
        } = eval_decl_pair(s, eval_cxt, frame_cxt)
        return {
          ok: next_ok,
          eval_cxt: next_eval_cxt,
          children: [...children, node],
        }
      },
      initial
    )
    return {
      ok,
      node: {...s, children, result: {ok}},
      eval_cxt: next_eval_cxt,
    }
  } else if(s.type == 'return') {

    const {node, eval_cxt: next_eval_cxt} = 
      eval_frame_expr(s.expr, eval_cxt, frame_cxt)

    return {
      ok: node.result.ok,
      returned: node.result.ok,
      node: {...s, children: [node], result: {ok: node.result.ok}},
      eval_cxt: next_eval_cxt,
    }

  } else if(s.type == 'export') {
    const {ok, eval_cxt: next_eval_cxt, node} 
      = eval_statement(s.binding, eval_cxt, frame_cxt)
    return {
      ok,
      eval_cxt: next_eval_cxt,
      node: {...s, children: [node], result: {ok: node.result.ok}}
    }
  } else if(s.type == 'import') {
    const module = frame_cxt.modules[s.full_import_path]
    const children = s.children.map((imp, i) => (
      {...imp, 
        result: {
          ok: true, 
          value: imp.definition.is_default
            ? module['default']
            : module[imp.value]
        }
      }
    ))
    const imported_scope = Object.fromEntries(
      children.map(imp => [imp.value, imp.result.value])
    )
    return {
      ok: true,
      eval_cxt: {
        ...eval_cxt,
        scope: {...eval_cxt.scope, ...imported_scope}
      },
      node: {...s, children, result: {ok: true}}
    }
  } else if(s.type == 'if') {

    const {node, eval_cxt: eval_cxt_after_cond} = 
      eval_frame_expr(s.cond, eval_cxt, frame_cxt)

    if(!node.result.ok) {
      return {
        ok: false,
        node: {...s, children: [node, ...s.branches], result: {ok: false}},
        eval_cxt: eval_cxt_after_cond,
      }
    }

    if(s.branches.length == 1) {
      // if without else
      if(node.result.value) {
        // Execute branch
        const {
          node: evaled_branch, 
          returned, 
          eval_cxt: eval_cxt_after_branch,
        } = eval_statement(
          s.branches[0],
          eval_cxt_after_cond,
          frame_cxt
        )
        return {
          ok: evaled_branch.result.ok,
          returned,
          node: {...s, 
            children: [node, evaled_branch],
            result: {ok: evaled_branch.result.ok}
          },
          eval_cxt: eval_cxt_after_branch,
        }
      } else {
        // Branch is not executed
        return {
          ok: true,
          node: {...s, children: [node, s.branches[0]], result: {ok: true}},
          eval_cxt: eval_cxt_after_cond,
        }
      }
    } else {
      // if with else
      const active_branch = node.result.value ? s.branches[0] : s.branches[1]

      const {
        node: evaled_branch, 
        returned, 
        eval_cxt: eval_cxt_after_branch,
      } = eval_statement(
        active_branch,
        eval_cxt_after_cond,
        frame_cxt,
      )

      const children = node.result.value
        ? [node, evaled_branch, s.branches[1]]
        : [node, s.branches[0], evaled_branch]

      return {
        ok: evaled_branch.result.ok,
        returned,
        node: {...s, children, result: {ok: evaled_branch.result.ok}},
        eval_cxt: eval_cxt_after_branch,
      }
    }

  } else if(s.type == 'throw') {

    const {node, eval_cxt: next_eval_cxt} = 
      eval_frame_expr(s.expr, eval_cxt, frame_cxt)

    return {
      ok: false,
      node: {...s, 
        children: [node], 
        result: {
          ok: false, 
          is_error_origin: node.result.ok,
          error: node.result.ok ? node.result.value : null,
        }
      },
      eval_cxt: next_eval_cxt,
    }

  } else {
    // stmt type is expression
    const {node, eval_cxt: next_eval_cxt} = eval_frame_expr(s, eval_cxt, frame_cxt)
    return {
      ok: node.result.ok,
      node,
      eval_cxt: next_eval_cxt,
    }
  }
}

const check_eval_result = result => {
  // Ensure that eval_cxt is only constructed within eval_frame
  if(!result.eval_cxt.__eval_cxt_marker) {
    throw new Error('illegal state')
  }
}

export const eval_frame = (calltree_node, modules) => {
  if(calltree_node.has_more_children) {
    throw new Error('illegal state')
  }
  const node = calltree_node.code
  const frame_cxt = {calltree_node, modules}
  if(node.type == 'do') {
    // eval module toplevel
    const eval_result = eval_statement(
      node,
      {
        __eval_cxt_marker: true,
        scope: {},
        call_index: 0,
      },
      frame_cxt,
    )

    check_eval_result(eval_result)

    return eval_result.node
  } else {
    // TODO default values for destructuring can be function calls

    const closure = map_object(calltree_node.fn.__closure, (_key, value) => {
      return value instanceof LetMultiversion
        ? value.get_version(calltree_node.version_number)
        : value
    })
    const args_scope_result = get_args_scope(
      node, 
      calltree_node.args,
      closure
    )

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
                error: args_scope_result.ok ? null : args_scope_result.error,
                is_error_origin: !args_scope_result.ok,
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

    const closure_scope = Object.fromEntries(
      Object.entries(closure).map(([key, value]) => {
        return [
          symbol_for_closed_let_var(key),
          value,
        ]
      })
    )

    const scope = {...closure_scope, ...args_scope_result.value}

    let nextbody

    const eval_cxt = {
      __eval_cxt_marker: true,
      scope,
      call_index: 0,
    }

    let eval_result
    if(body.type == 'do') {
      eval_result = eval_statement(body, eval_cxt, frame_cxt)
    } else {
      eval_result = eval_frame_expr(body, eval_cxt, frame_cxt)
    }

    check_eval_result(eval_result)

    return {...node,
      result: {ok: eval_result.node.result.ok},
      children: [function_args_with_result, eval_result.node],
    }
  }
}
