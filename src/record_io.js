import {set_record_call} from './runtime.js'

// Current context for current execution of code
let cxt

export const set_current_context = _cxt => {
  const should_apply_io_patches = cxt == null || cxt.window != _cxt.window
  cxt = _cxt
  if(should_apply_io_patches) {
    apply_io_patches()
  }
}

const io_patch = (path, use_context = false) => {
  let obj = cxt.window
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
  obj[method] = function(...args) {
    if(cxt.io_cache_is_replay_aborted) {
      // Try to finish fast
      // TODO invoke callback to notify that code must be restarted?
      throw new Error('io replay aborted')
    }

    const has_new_target = new.target != null

    if(cxt.is_recording_deferred_calls) {
      // TODO record cache on deferred calls?
      return has_new_target 
        ? new original(...args)
        : original.apply(this, args)
    }

    const cxt_copy = cxt

    if(cxt.io_cache_is_recording) {
      let ok, value, error
      try {
        // save call, so on expand_call and find_call IO functions would not be
        // called. 
        // TODO: we have a problem when IO function is called from third-party
        // lib and async context is lost
        set_record_call(cxt)

        const index = cxt.io_cache.length

        if(name == 'setTimeout') {
          args = args.slice()
          // Patch callback
          const cb = args[0]
          args[0] = Object.defineProperty(function() {
            if(cxt_copy != cxt) {
              // If code execution was cancelled, then never call callback
              return
            }
            if(cxt.io_cache_is_replay_aborted) {
              // Non necessary
              return
            }
            cxt.io_cache.push({type: 'resolution', index})
            cb()
          }, 'name', {value: cb.name})
        }

        value = has_new_target 
          ? new original(...args)
          : original.apply(this, args)

        if(value instanceof cxt.window.Promise) {
          // TODO use cxt.promise_then, not finally which calls
          // patched 'then'?
          value = value.finally(() => {
            if(cxt_copy != cxt) {
              return
            }
            if(cxt.io_cache_is_replay_aborted) {
              // Non necessary
              return
            }
            cxt.io_cache.push({type: 'resolution', index})
          })
        }

        ok = true
        return value
      } catch(e) {
        error = e
        ok = false
        throw e
      } finally {
        cxt.io_cache.push({
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
      const call = cxt.io_cache[cxt.io_cache_index]

      // TODO if call == null or call.type == 'resolution', then do not discard
      // cache, instead switch to record mode and append new calls to the
      // cache?
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
        cxt.io_cache_is_replay_aborted = true
        // Try to finish fast
        throw new Error('io replay aborted')
      } else {

        const next_resolution = cxt.io_cache.find((e, i) => 
          e.type == 'resolution' && i > cxt.io_cache_index
        )

        if(next_resolution != null && !cxt.io_cache_resolver_is_set) {
          const original_setTimeout = cxt.window.setTimeout.__original
          cxt.io_cache_resolver_is_set = true

          original_setTimeout(() => {
            if(cxt_copy != cxt) {
              return
            }

            if(cxt.io_cache_is_replay_aborted) {
              return
            }

            cxt.io_cache_resolver_is_set = false

            // Sanity check
            if(cxt.io_cache_index >= cxt.io_cache.length) {
              throw new Error('illegal state')
            }  

            const next_event = cxt.io_cache[cxt.io_cache_index]
            if(next_event.type == 'call') {
              cxt.io_cache_is_replay_aborted = true
            } else {
              while(
                cxt.io_cache_index < cxt.io_cache.length 
                && 
                cxt.io_cache[cxt.io_cache_index].type == 'resolution'
              ) {
                const resolution = cxt.io_cache[cxt.io_cache_index]
                const resolver = cxt.io_cache_resolvers.get(resolution.index)

                cxt.io_cache_index++

                if(cxt.io_cache[resolution.index].name == 'setTimeout') {
                  resolver()
                } else {
                  resolver(cxt.io_cache[resolution.index].value)
                }
              }
            }

            }, 0)
        }

        cxt.io_cache_index++

        if(call.ok) {
          if(call.value instanceof cxt.window.Promise) {
            // Always make promise originate from run_window
            return new cxt.window.Promise(resolve => {
              cxt.io_cache_resolvers.set(cxt.io_cache_index - 1, resolve)
            })
          } else if(name == 'setTimeout') {
            const timeout_cb = args[0]
            cxt.io_cache_resolvers.set(cxt.io_cache_index - 1, timeout_cb)
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

  Object.defineProperty(obj[method], 'name', {value: original.name})

  obj[method].__original = original
}

export const apply_io_patches = () => {
  // TODO remove, only for dev
  // TODO test open_run_window
  if(cxt.window.__io_patched) {
    throw new Error('illegal state')
  }
  cxt.window.__io_patched = true

  io_patch(['Math', 'random'])

  io_patch(['setTimeout'])
  // TODO if call setTimeout and then clearTimeout, cache it and remove call of
  // clearTimeout, and make only setTimeout, then it would never be called when
  // replaying from cache
  io_patch(['clearTimeout'])

  // TODO patch setInterval to only cleanup all intervals on finish

  const Date = cxt.window.Date
  io_patch(['Date'])
  cxt.window.Date.parse = Date.parse
  cxt.window.Date.now =   Date.now
  cxt.window.Date.UTC =   Date.UTC
  io_patch(['Date', 'now'])


  io_patch(['fetch'])
  // Check if Response is defined, for node.js
  if(cxt.window.Response != null) {
    const Response_methods = [
      'arrayBuffer',
      'blob',
      'formData',
      'json',
      'text',
    ]
    for(let key of Response_methods) {
      io_patch(['Response', 'prototype', key], true)
    }
  }
}
