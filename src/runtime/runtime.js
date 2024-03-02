import {apply_io_patches} from './record_io.js'
import {LetMultiversion} from './let_multiversion.js'
import {defineMultiversionArray, create_array, wrap_array} from './array.js'
import {create_object} from './object.js'
import {defineMultiversionSet} from './set.js'
import {defineMultiversionMap} from './map.js'

/*
Converts generator-returning function to promise-returning function. Allows to
have the same code both for sync and async. If we have only sync modules (no
toplevel awaits), then code executes synchronously, and if there are async
modules, then code executes asynchronoulsy, but we have syntactic niceties of
'yield', 'try', 'catch'
*/
const gen_to_promise = gen_fn => {
  return (...args) => {
    const gen = gen_fn(...args)
    const next = result => {
      if(result.done){
        return result.value
      } else {
        if(result.value?.[Symbol.toStringTag] == 'Promise') {
          return result.value.then(
            value => next(gen.next(value)),
            error => next(gen.throw(error)),
          )
        } else {
          return next(gen.next(result.value))
        }
      }
    }
    return next(gen.next())
  }
}

const make_promise_with_rejector = cxt => {
  let rejector
  const p = new Promise(r => rejector = r)
  return [p, rejector]
}

export const run = gen_to_promise(function*(module_fns, cxt, io_trace) {
  if(!cxt.window.__is_initialized) {
    defineMultiversion(cxt.window)
    apply_io_patches(cxt.window)
    inject_leporello_api(cxt)
    cxt.window.__is_initialized = true
  } else {
    throw new Error('illegal state')
  }

  let calltree

  const calltree_node_by_loc = new Map(
    module_fns.map(({module}) => [module, new Map()])
  )

  const [replay_aborted_promise, io_trace_abort_replay] = 
    make_promise_with_rejector(cxt)

  cxt = (io_trace == null || io_trace.length == 0)
    // TODO group all io_trace_ properties to single object?
    ? {...cxt,
      calltree_node_by_loc,
      logs: [],
      io_trace_is_recording: true,
      io_trace: [],
    }
    : {...cxt,
      calltree_node_by_loc,
      logs: [],
      io_trace_is_recording: false,
      io_trace,
      io_trace_is_replay_aborted: false,
      io_trace_resolver_is_set: false,
      // Map of (index in io_trace) -> resolve
      io_trace_resolvers: new Map(),
      io_trace_index: 0,
      io_trace_abort_replay,
    }

  // Set current context
  cxt.window.__cxt = cxt

  apply_promise_patch(cxt)

  for(let i = 0; i < module_fns.length; i++) {
    const {module, fn} = module_fns[i]

    cxt.is_entrypoint = i == module_fns.length - 1

    cxt.children = null
    calltree = {
      toplevel: true, 
      module,
      id: ++cxt.call_counter,
      version_number: cxt.version_counter,
      let_vars: {},
      literals: new Map(),
    }

    try {
      cxt.modules[module] = {}
      const result = fn(
        cxt, 
        calltree.let_vars,
        calltree.literals,
        calltree_node_by_loc.get(module),
        __trace, 
        __trace_call, 
        __await_start, 
        __await_finish,
        __save_ct_node_for_path,
        LetMultiversion,
        create_array,
        create_object,
      )
      if(result?.[Symbol.toStringTag] == 'Promise') {
        yield Promise.race([replay_aborted_promise, result])
      } else {
        yield result
      }
      calltree.ok = true
    } catch(error) {
      calltree.ok = false
      calltree.error = error
    }
    calltree.children = cxt.children
    calltree.last_version_number = cxt.version_counter
    if(!calltree.ok) {
      break
    }
  }

  cxt.is_recording_deferred_calls = true
  const _logs = cxt.logs
  cxt.logs = []
  cxt.children = null

  remove_promise_patch(cxt)

  return {
    modules: cxt.modules,
    calltree,
    logs: _logs,
    rt_cxt: cxt,
    calltree_node_by_loc,
  }
})

const inject_leporello_api = cxt => {
  cxt.window.leporello = { storage: cxt.storage }
}

const apply_promise_patch = cxt => {
  if(cxt.window.Promise.prototype.__original_then != null) {
    throw new Error('illegal state')
  }
  const original_then = cxt.window.Promise.prototype.then
  cxt.window.Promise.prototype.__original_then = cxt.window.Promise.prototype.then

  cxt.window.Promise.prototype.then = function then(on_resolve, on_reject) {

    if(cxt.children == null) {
      cxt.children = []
    }
    let children_copy = cxt.children

    const make_callback = (cb, ok) => typeof(cb) != 'function'
      ? cb
      : value => {
          if(this.status == null) {
            this.status = ok ? {ok, value} : {ok, error: value}
          }
          const current = cxt.children
          cxt.children = children_copy
          try {
            return cb(value)
          } finally {
            cxt.children = current
          }
        }

    return original_then.call(
      this,
      make_callback(on_resolve, true),
      make_callback(on_reject, false),
    )
  }
}

const remove_promise_patch = cxt => {
  cxt.window.Promise.prototype.then = cxt.window.Promise.prototype.__original_then
  delete cxt.window.Promise.prototype.__original_then
}

export const set_record_call = cxt => {
  for(let i = 0; i < cxt.stack.length; i++) {
    cxt.stack[i] = true
  }
}

export const do_eval_expand_calltree_node = (cxt, node) => {
  cxt.is_recording_deferred_calls = false

  // Save call counter and set it to the value it had when executed 'fn' for
  // the first time
  const call_counter = cxt.call_counter
  cxt.call_counter = node.fn.__location == null
    // Function is native, set call_counter to node.id
    ? node.id 
    // call_counter will be incremented inside __trace and produce the same id
    // as node.id
    : node.id - 1 


  cxt.children = null
  try {
    with_version_number(cxt, node.version_number, () => {
      if(node.is_new) {
        new node.fn(...node.args)
      } else {
        node.fn.apply(node.context, node.args)
      }
    })
  } catch(e) {
    // do nothing. Exception was caught and recorded inside '__trace'
  }

  // Restore call counter
  cxt.call_counter = call_counter


  cxt.is_recording_deferred_calls = true
  const children = cxt.children
  cxt.children = null

  if(node.fn.__location != null) {
    // fn is hosted, it created call, this time with children
    const result = children[0]
    if(result.id != node.id) {
      throw new Error('illegal state')
    }
    result.children = cxt.prev_children
    result.has_more_children = false
    return result
  } else {
    // fn is native, it did not created call, only its child did
    return {...node, 
      children: children,
      has_more_children: false,
    }
  }
}

const __await_start = (cxt, promise) => {
  // children is an array of child calls for current function call. But it
  // can be null to save one empty array allocation in case it has no child
  // calls. Allocate array now, so we can have a reference to this array
  // which will be used after await
  if(cxt.children == null) {
    cxt.children = []
  }
  const children_copy = cxt.children
  const result = {children_copy, promise}

  if(promise?.[Symbol.toStringTag] == 'Promise') {
    result.promise = promise.then(
      (value) => {
        result.status = {ok: true, value}
        // We do not return value on purpose - it will be return in
        // __await_finish
      },
      (error) => {
        result.status = {ok: false, error}
        // We do not throw error on purpose
      },
    )
  } else {
    result.status = {ok: true, value: promise}
  }

  return result
}

const __await_finish = (__cxt, await_state) => {
  __cxt.children = await_state.children_copy
  if(await_state.status.ok) {
    return await_state.status.value
  } else {
    throw await_state.status.error
  }
}

const __trace = (cxt, fn, name, argscount, __location, get_closure, has_versioned_let_vars) => {
  const result = (...args) => {
    if(result.__closure == null) {
      result.__closure = get_closure()
    }

    const children_copy = cxt.children
    cxt.children = null
    cxt.stack.push(false)

    const call_id = ++cxt.call_counter
    const version_number = cxt.version_counter

    // populate calltree_node_by_loc only for entrypoint module
    if(cxt.is_entrypoint && !cxt.skip_save_ct_node_for_path) {
      let nodes_of_module = cxt.calltree_node_by_loc.get(__location.module)
      if(nodes_of_module == null) {
        nodes_of_module = new Map()
        cxt.calltree_node_by_loc.set(__location.module, nodes_of_module)
      }
      if(nodes_of_module.get(__location.index) == null) {
        set_record_call(cxt)
        nodes_of_module.set(__location.index, call_id)
      }
    }

    let let_vars
    if(has_versioned_let_vars) {
      let_vars = cxt.let_vars = {}
    }

    // TODO only allocate map if has literals
    const literals = cxt.literals = new Map()

    let ok, value, error

    const is_toplevel_call_copy = cxt.is_toplevel_call
    cxt.is_toplevel_call = false

    try {
      value = fn(...args)
      ok = true
      if(value?.[Symbol.toStringTag] == 'Promise') {
        set_record_call(cxt)
      }
      return value
    } catch(_error) {
      ok = false
      error = _error
      set_record_call(cxt)
      if(cxt.is_recording_deferred_calls && is_toplevel_call_copy) {
        if(error instanceof cxt.window.Error) {
          error.__ignore = true
        }
      }
      throw error
    } finally {

      cxt.prev_children = cxt.children

      const call = {
        id: call_id,
        version_number,
        last_version_number: cxt.version_counter,
        let_vars,
        literals,
        ok,
        value,
        error,
        fn: result,
        args: argscount == null 
          ? args
          // Do not capture unused args
          : args.slice(0, argscount),
      }

      const should_record_call = cxt.stack.pop()

      if(should_record_call) {
        call.children = cxt.children
      } else {
        call.has_more_children = cxt.children != null && cxt.children.length != 0
      }
      cxt.children = children_copy
      if(cxt.children == null) {
        cxt.children = []
      }
      cxt.children.push(call)

      cxt.is_toplevel_call = is_toplevel_call_copy

      if(cxt.is_recording_deferred_calls && cxt.is_toplevel_call) {
        if(cxt.children.length != 1) {
          throw new Error('illegal state')
        }
        const call = cxt.children[0]
        cxt.children = null
        const _logs = cxt.logs
        cxt.logs = []
        cxt.on_deferred_call(call, cxt.calltree_changed_token, _logs)
      }
    }
  }

  Object.defineProperty(result, 'name', {value: name})
  result.__location = __location
  return result
}

const defineMultiversion = window => {
  defineMultiversionArray(window)
  defineMultiversionSet(window)
  defineMultiversionMap(window)
}

const wrap_multiversion_value = (value, cxt) => {

  // TODO use a WeakMap value => wrapper ???

  if(value instanceof cxt.window.Set) {
    if(!(value instanceof cxt.window.MultiversionSet)) {
      return new cxt.window.MultiversionSet(value, cxt)
    } else {
      return value
    }
  }

  if(value instanceof cxt.window.Map) {
    if(!(value instanceof cxt.window.MultiversionMap)) {
      return new cxt.window.MultiversionMap(value, cxt)
    } else {
      return value
    }
  }

  if(value instanceof cxt.window.Array) {
    if(!(value instanceof cxt.window.MultiversionArray)) {
      return wrap_array(value, cxt)
    } else {
      return value
    }
  }

  return value
}

const __trace_call = (cxt, fn, context, args, errormessage, is_new = false) => {
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

  const children_copy = cxt.children
  cxt.children = null
  cxt.stack.push(false)

  const call_id = ++cxt.call_counter
  const version_number = cxt.version_counter

  // TODO: other console fns
  const is_log = fn == cxt.window.console.log || fn == cxt.window.console.error

  if(is_log) {
    set_record_call(cxt)
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
    if(value?.[Symbol.toStringTag] == 'Promise') {
      set_record_call(cxt)
    }

    value = wrap_multiversion_value(value, cxt)

    return value

  } catch(_error) {
    ok = false
    error = _error
    set_record_call(cxt)
    throw error
  } finally {

    cxt.prev_children = cxt.children

    const call = {
      id: call_id,
      version_number,
      last_version_number: cxt.version_counter,
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
      cxt.logs.push(call)
    }

    const should_record_call = cxt.stack.pop()

    if(should_record_call) {
      call.children = cxt.children
    } else {
      call.has_more_children = cxt.children != null && cxt.children.length != 0
    }

    cxt.children = children_copy
    if(cxt.children == null) {
      cxt.children = []
    }
    cxt.children.push(call)
  }
}

const __save_ct_node_for_path = (cxt, __calltree_node_by_loc, index, __call_id) => {
  if(!cxt.is_entrypoint) {
    return
  }

  if(cxt.skip_save_ct_node_for_path) {
    return
  }
  if(__calltree_node_by_loc.get(index) == null) {
    __calltree_node_by_loc.set(index, __call_id)
    set_record_call(cxt)
  }
}

let ct_expansion_id_gen = 0

export const with_version_number = (rt_cxt, version_number, action) => {
  if(rt_cxt.logs == null) {
    // check that argument is rt_cxt
    throw new Error('illegal state')
  }
  if(version_number == null) {
    throw new Error('illegal state')
  }
  if(rt_cxt.is_expanding_calltree_node) {
    throw new Error('illegal state')
  }
  rt_cxt.is_expanding_calltree_node = true
  const version_counter_copy = rt_cxt.version_counter 
  rt_cxt.version_counter = version_number
  const ct_expansion_id = rt_cxt.ct_expansion_id
  rt_cxt.ct_expansion_id = ct_expansion_id_gen++
  try {
    return action()
  } finally {
    rt_cxt.ct_expansion_id = ct_expansion_id
    rt_cxt.is_expanding_calltree_node = false
    rt_cxt.version_counter = version_counter_copy
  }
}
