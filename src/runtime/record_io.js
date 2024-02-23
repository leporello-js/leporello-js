import {set_record_call} from './runtime.js'

const io_patch = (window, path, use_context = false) => {
  let obj = window
  for(let i = 0; i < path.length - 1; i++) {
    obj = obj[path[i]]
  }
  const method = path.at(-1)
  if(obj == null || obj[method] == null) {
    // Method is absent in current env, skip patching
    return
  }
  const name = path.join('.')

  const original = obj[method]

  obj[method] = make_patched_method(window, original, name, use_context)

  obj[method].__original = original
}

const make_patched_method = (window, original, name, use_context) => {
  const method = function(...args) {

    const cxt = window.__cxt

    if(cxt.io_trace_is_replay_aborted) {
      // Try to finish fast
      const error = new Error('io replay was aborted')
      error.__ignore = true
      throw error
    }

    const has_new_target = new.target != null

    if(cxt.is_recording_deferred_calls) {
      // TODO record trace on deferred calls?
      return has_new_target 
        ? new original(...args)
        : original.apply(this, args)
    }

    const cxt_copy = cxt

    if(cxt.io_trace_is_recording) {
      let ok, value, error
      try {
        // save call, so on expand_call and find_call IO functions would not be
        // called. 
        // TODO: we have a problem when IO function is called from third-party
        // lib and async context is lost
        set_record_call(cxt)

        const index = cxt.io_trace.length

        if(name == 'setTimeout') {
          args = args.slice()
          // Patch callback
          const cb = args[0]
          args[0] = Object.defineProperty(function() {
            if(cxt_copy != cxt) {
              // If code execution was cancelled, then never call callback
              return
            }
            if(cxt.io_trace_is_replay_aborted) {
              // Non necessary
              return
            }
            cxt.io_trace.push({type: 'resolution', index})
            cb()
          }, 'name', {value: cb.name})
        }

        value = has_new_target 
          ? new original(...args)
          : original.apply(this, args)

        if(value?.[Symbol.toStringTag] == 'Promise') {
          value = value
            .then(val => {
              value.status = {ok: true, value: val}
              return val
            })
            .catch(error => {
              value.status = {ok: true, error}
              throw error
            })
            .finally(() => {
              if(cxt_copy != cxt) {
                return
              }
              if(cxt.io_trace_is_replay_aborted) {
                // Non necessary
                return
              }
              cxt.io_trace.push({type: 'resolution', index})
            })
        }

        ok = true
        return value
      } catch(e) {
        error = e
        ok = false
        throw e
      } finally {
        cxt.io_trace.push({
          type: 'call',
          name,
          ok, 
          value, 
          error, 
          args, 
          // To discern calls with and without 'new' keyword, primary for
          // Date that can be called with and without new
          has_new_target,
          use_context,
          context: use_context ? this : undefined,
        })
      }
    } else {
      // IO trace replay

      const call = cxt.io_trace[cxt.io_trace_index]

      // TODO if call == null or call.type == 'resolution', then do not discard
      // trace, instead switch to record mode and append new calls to the
      // trace?
      if(
        call == null
        || call.type != 'call'
        || call.has_new_target != has_new_target
        || call.use_context && (call.context != this)
        || call.name != name
        || (
            (name == 'setTimeout' && (args[1] != call.args[1])) /* compares timeout*/
            ||
            (
              name != 'setTimeout' 
              && 
              JSON.stringify(call.args) != JSON.stringify(args)
            )
           )
      ){
        cxt.io_trace_is_replay_aborted = true
        cxt.io_trace_abort_replay()
        // throw error to prevent further code execution. It
        // is not necesseary, becuase execution would not have
        // any effects anyway
        const error = new Error('io replay aborted')
        error.__ignore = true
        throw error
      } else {

        const next_resolution = cxt.io_trace.find((e, i) => 
          e.type == 'resolution' && i > cxt.io_trace_index
        )

        if(next_resolution != null && !cxt.io_trace_resolver_is_set) {
          cxt.io_trace_resolver_is_set = true

          // use setTimeout function from host window (because this module was
          // loaded as `external` by host window)
          setTimeout(() => {
            if(cxt_copy != cxt) {
              return
            }

            if(cxt.io_trace_is_replay_aborted) {
              return
            }

            cxt.io_trace_resolver_is_set = false

            // Sanity check
            if(cxt.io_trace_index >= cxt.io_trace.length) {
              throw new Error('illegal state')
            }  

            const next_event = cxt.io_trace[cxt.io_trace_index]
            if(next_event.type == 'call') {
              cxt.io_trace_is_replay_aborted = true
              cxt.io_trace_abort_replay()
            } else {
              while(
                cxt.io_trace_index < cxt.io_trace.length 
                && 
                cxt.io_trace[cxt.io_trace_index].type == 'resolution'
              ) {
                const resolution = cxt.io_trace[cxt.io_trace_index]
                const {resolve, reject} = cxt.io_trace_resolvers.get(resolution.index)

                cxt.io_trace_index++

                if(cxt.io_trace[resolution.index].name == 'setTimeout') {
                  resolve()
                } else {
                  const promise = cxt.io_trace[resolution.index].value
                  if(promise.status == null) {
                    throw new Error('illegal state')
                  }
                  if(promise.status.ok) {
                    resolve(promise.status.value)
                  } else {
                    reject(promise.status.error)
                  }
                }
              }
            }

            }, 0)
        }

        cxt.io_trace_index++

        if(call.ok) {
          // Use Symbol.toStringTag for comparison because Promise may
          // originate from another window (if window was reopened after record
          // trace) and instanceof would not work
          if(call.value?.[Symbol.toStringTag] == 'Promise') {
            // Always make promise originate from app_window
            return new cxt.window.Promise((resolve, reject) => {
              cxt.io_trace_resolvers.set(cxt.io_trace_index - 1, {resolve, reject})
            })
          } else if(name == 'setTimeout') {
            const timeout_cb = args[0]
            cxt.io_trace_resolvers.set(cxt.io_trace_index - 1, {resolve: timeout_cb})
            return call.value
          } else {
            return call.value
          }
        } else {
          throw call.error
        }
      }
    }
  }

  Object.defineProperty(method, 'name', {value: original.name})

  return method
}

const patch_Date = (window) => {
  const Date = window.Date
  const Date_patched = make_patched_method(window, Date, 'Date', false)
  window.Date = function(...args) {
    if(args.length == 0) {
      // return current Date, IO operation
      if(new.target != null) {
        return new Date_patched(...args)
      } else {
        return Date_patched(...args)
      }
    } else {
      // pure function
      if(new.target != null) {
        return new Date(...args)
      } else {
        return Date(...args)
      }
    }
  }
  window.Date.__original = Date

  window.Date.parse = Date.parse
  window.Date.now =   Date.now
  window.Date.UTC =   Date.UTC
  io_patch(window, ['Date', 'now'])
}

export const apply_io_patches = (window) => {
  io_patch(window, ['Math', 'random'])

  io_patch(window, ['setTimeout'])
  // TODO if call setTimeout and then clearTimeout, trace it and remove call of
  // clearTimeout, and make only setTimeout, then it would never be called when
  // replaying from trace
  io_patch(window, ['clearTimeout'])

  // TODO patch setInterval to only cleanup all intervals on finish

  patch_Date(window)

  io_patch(window, ['fetch'])
  // Check if Response is defined, for node.js
  if(window.Response != null) {
    const Response_methods = [
      'arrayBuffer',
      'blob',
      'formData',
      'json',
      'text',
    ]
    for(let key of Response_methods) {
      io_patch(window, ['Response', 'prototype', key], true)
    }
  }
}
