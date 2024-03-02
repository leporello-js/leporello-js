import {find_error_origin_node} from '../src/ast_utils.js'
import {parse, print_debug_node, load_modules} from '../src/parse_js.js'
import {active_frame, pp_calltree, version_number_symbol} from '../src/calltree.js'
import {COMMANDS} from '../src/cmd.js'

// external
import {create_app_window} from './run_utils.js'

// external
import {with_version_number} from '../src/runtime/runtime.js'

Object.assign(globalThis, 
  {
    // for convenience, to type just `log` instead of `console.log`
    log: console.log,
  }
)

export const do_parse = code => parse(
  code, 
  new Set(Object.getOwnPropertyNames(globalThis))
)

export const parse_modules = (entry, modules) => 
  load_modules(
    entry, 
    module_name => modules[module_name],
    new Set(Object.getOwnPropertyNames(globalThis.app_window))
  )

export const assert_code_evals_to = (codestring, expected) => {
  const s = test_initial_state(codestring)
  if(!s.parse_result.ok) {
    console.error('parse problems', s.parse_result.problems)
    throw new Error('parse failed')
  }
  const frame = active_frame(s)
  const result = frame.children.at(-1).result
  assert_equal(result.ok, true)
  assert_equal(result.value, expected)
  return frame
}

export const assert_code_error = (codestring, error) => {
  const state = test_initial_state(codestring)
  const frame = active_frame(state)
  assert_equal(frame.result.ok, false)
  assert_equal(find_error_origin_node(frame).result.error, error)
}

export const assert_code_evals_to_async = async (codestring, expected) => {
  const s = await test_initial_state_async(codestring)
  const frame = active_frame(s)
  const result = frame.children.at(-1).result
  assert_equal(result.ok, true)
  assert_equal(result.value, expected)
}

export const assert_code_error_async = async (codestring, error) => {
  const s = await test_initial_state_async(codestring)
  const frame = active_frame(s)
  const result = frame.children[frame.children.length - 1].result
  assert_equal(result.ok, false)
  assert_equal(result.error, error)
}

function patch_app_window(app_window_patches) {
  Object.entries(app_window_patches).forEach(([path, value]) => {
    let obj = globalThis.app_window
    const path_arr = path.split('.')
    path_arr.forEach((el, i) => {
      if(i == path_arr.length - 1) {
        return
      }
      obj = obj[el]
    })
    const prop = path_arr.at(-1)
    obj[prop] = value
  })
}

export const run_code = (state, app_window_patches) => {
  globalThis.app_window = create_app_window()
  if(app_window_patches != null) {
    patch_app_window(app_window_patches)
  }
  return COMMANDS.run_code(
    state, 
    state.globals ?? new Set(Object.getOwnPropertyNames(globalThis.app_window))
  )
}

export const test_initial_state = (code, cursor_pos, options = {}) => {
  if(cursor_pos < 0) {
    throw new Error('illegal cursor_pos')
  }
  if(typeof(options) != 'object') {
    throw new Error('illegal state')
  }
  const {
    current_module,
    project_dir,
    on_deferred_call,
    app_window_patches,
  } = options
  const entrypoint = options.entrypoint ?? ''

  return run_code(
    COMMANDS.get_initial_state(
      {
        files: typeof(code) == 'object' ? code : { '' : code},
        project_dir,
        on_deferred_call,
      },
      {
        entrypoint,
        current_module: current_module ?? '',
      },
      cursor_pos
    ),
    app_window_patches,
  )
}

const wait_for_result = async state => {
  assert_equal(state.eval_modules_state != null, true)
  const result = await state.eval_modules_state.promise
  return COMMANDS.eval_modules_finished(
    state, 
    state,
    result, 
  )
}

export const test_initial_state_async = async (code, ...args) => {
  const s = test_initial_state(code, ...args)
  return wait_for_result(s)
}

export const input = (s, code, index, options = {}) => {
  if(typeof(options) != 'object') {
    throw new Error('illegal state')
  }
  const {state, effects} = COMMANDS.input(s, code, index)
  const nextstate = run_code(state, options.app_window_patches)
  if(nextstate.rt_cxt?.io_trace_is_replay_aborted) {
    const with_clear_trace = run_code(
      COMMANDS.clear_io_trace(nextstate), 
      options.app_window_patches
    )
    return { state: with_clear_trace, effects }
  } else {
    return { state: nextstate, effects }
  }
}

export const input_async = async (s, code, index, options) => {
  const after_input = input(s, code, index, options).state
  const state = await wait_for_result(after_input)
  if(state.rt_cxt?.io_trace_is_replay_aborted) {
    return wait_for_result(
      run_code(COMMANDS.clear_io_trace(state), options.app_window_patches)
    )
  } else {
    return state
  }
}

export const test_deferred_calls_state = (code, index) => {
  const {get_deferred_call, on_deferred_call} = (new Function(`
    let args
    return {
      get_deferred_call() {
        return args
      },
      on_deferred_call(..._args) {
        args = _args
      }
    }
  `))()

  const state = test_initial_state(code, index, { on_deferred_call })

  return {
    state, 
    get_deferred_call, 
    on_deferred_call: state => COMMANDS.on_deferred_call(state, ...get_deferred_call())
  }
}

export const stringify = val => 
  JSON.stringify(val, (key, value) => {
    if(value?.[Symbol.toStringTag] == 'Set'){
      return [...value]
    } else if(value?.[Symbol.toStringTag] == 'Map'){
      return Object.fromEntries([...value.entries()])
    } else if(value instanceof Error) {
      return {message: value.message}
    } else {
      return value
    }
  }, 2)

export const assert_equal = (exp, actual) => {
  if(typeof(exp) == 'object' && typeof(actual) == 'object'){
    const exp_json = stringify(exp)
    const act_json = stringify(actual)
    if(exp_json != act_json){
      throw new Error(`FAIL: ${exp_json} != ${act_json}`)
    }
  } else {
    if(exp != actual){
      throw new Error(`FAIL: ${exp} != ${actual}`)
    } 
  }
}

export const print_debug_ct_node = node => {
  const do_print = node => {
    const {id, fn, ok, value, error, args, has_more_children} = node
    const res = {id, fn: fn?.name, ok, value, error, args, has_more_children}
    if(node.children == null) {
      return res
    } else {
      const next_children = node.children.map(do_print)
      return {...res, children: next_children}
    }
  }
  return stringify(do_print(node))
}

export const assert_versioned_value = (state, versioned, expected) => {
  const version_number = versioned[version_number_symbol] ?? versioned.version_number
  if(version_number == null) {
    throw new Error('illegal state')
  }
  return with_version_number(state.rt_cxt, version_number, () => 
    assert_equal(versioned.value, expected)
  )
}

export const assert_value_explorer = (state, expected) => 
  assert_versioned_value(state, state.value_explorer.result, expected)

export const assert_selection = (state, expected) => 
  assert_versioned_value(state, state.selection_state.node.result, expected)

export const test = (message, test, only = false) => {
  return {
    message, 
    test: Object.defineProperty(test, 'name', {value: message}),
    only,
  }
}

export const test_only = (message, t) => test(message, t, true)

// Create `run` function like this because we do not want its internals to be
// present in calltree
export const run = new Function('create_app_window', `
return function run(tests) {
  // create app window for simple tests, that do not use 'test_initial_state'
  globalThis.app_window = create_app_window()

  // Runs test, return failure or null if not failed
  const run_test = t => {
    return Promise.resolve().then(t.test)
      .then(() => null)
      .catch(e => {
        if(globalThis.process != null) {
          // In node.js runner, fail fast
          console.error('Failed: ' + t.message)
          throw e
        } else {
          return e
        }
      })
  }

  // If not run in node, then dont apply filter
  const filter = globalThis.process && globalThis.process.argv[2]

  if(filter == null) {

    const only = tests.find(t => t.only)
    const tests_to_run = only == null ? tests : [only]

    // Exec each test. After all tests are done, we rethrow first error if
    // any. So we will mark root calltree node if one of tests failed
    return tests_to_run.reduce(
      (failureP, t) => 
        Promise.resolve(failureP).then(failure => 
          run_test(t).then(next_failure => failure ?? next_failure)
        )
      ,
      null
    ).then(failure => {

      if(failure != null) {
        throw failure
      } else {
        if(globalThis.process != null) {
          console.log('Ok')
        }
      }

    })

  } else {
    const test = tests.find(t => t.message.includes(filter))
    if(test == null) {
      throw new Error('test not found')
    } else {
      return run_test(test).then(() => {
        if(globalThis.process != null) {
          console.log('Ok')
        }
      })
    }
  }
}
`)(create_app_window)
