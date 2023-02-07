import {set_record_call} from './runtime.js'
 
const io_patch = (cxt, obj, method, name, use_context = false) => {
  if(obj == null || obj[method] == null) {
    // Method is absent in current env, skip patching
    return
  }
  const original = obj[method]
  obj[method] = function(...args) {
    // TODO guard calls from prev run
    console.error('patched method', name, {
        io_cache_is_recording: cxt.io_cache_is_recording, 
        io_cache_is_replay_aborted: cxt.io_cache_is_replay_aborted, 
        io_cache_index: cxt.io_cache_is_recording
          ? cxt.io_cache.length
          : cxt.io_cache_index
    })
    // TODO guard that in find_call io methods are not called?
    // if(searched_location != null) {
    //   throw new Error('illegal state')
    // }
    if(cxt.io_cache_is_replay_aborted) {
      // Try to finish fast
      throw new Error('io replay aborted')
    } else if(cxt.io_cache_is_recording) {
      let ok, value, error
      const has_new_target = new.target != null
      try {
        // TODO. Do we need it here? Only need for IO calls view. And also
        // for expand_call and find_call, to not use cache on expand call
        // and find_call
        set_record_call(cxt)

        const index = cxt.io_cache.length

        if(name == 'setTimeout') {
          args = args.slice()
          // Patch callback
          const cb = args[0]
          args[0] = function() {
            // TODO guard calls from prev runs
            // TODO guard io_cache_is_replay_aborted
            cxt.io_cache.push({type: 'resolution', index})
            cb()
          }
        }

        value = has_new_target 
          ? new original(...args)
          : original.apply(this, args)

        console.log('value', value)

        if(value instanceof Promise) {
          // TODO use native .finally for promise, not patched then?
          value.finally(() => {
            // TODO guard calls from prev runs
            // TODO guard io_cache_is_replay_aborted
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
      /*
      TODO remove
      console.log(
        call.type != 'call'
        , call == null
        , call.has_new_target != (new.target != null)
        , call.use_context && (call.context != this)
        , call.name != name
        , JSON.stringify(call.args) != JSON.stringify(args)
      )
      */

      // TODO if call.type != 'call', and there are no more calls, should
      // we abort, or just record one more call?

      if(
        call == null
        || call.type != 'call'
        || call.has_new_target != (new.target != null)
          // TODO test
        || call.use_context && (call.context != this)
        || call.name != name
        || (
            // TODO for setTimeout, compare last arg (timeout)
            name != 'setTimeout' 
            && 
            JSON.stringify(call.args) != JSON.stringify(args)
           )
      ){
        console.log('discard cache', call)
        cxt.io_cache_is_replay_aborted = true
        // Try to finish fast
        throw new Error('io replay aborted')
      } else {
        console.log('cached call found', call)
        const next_resolution = cxt.io_cache.find((e, i) => 
          e.type == 'resolution' && i > cxt.io_cache_index
        )

        if(next_resolution != null && !cxt.io_cache_resolver_is_set) {
          console.error('set resolver')
          const original_setTimeout = globalThis.setTimeout.__original
          cxt.io_cache_resolver_is_set = true

          original_setTimeout(() => {
            // TODO guard from previous run
            console.error('resolver', {
              io_cache_is_replay_aborted: cxt.io_cache_is_replay_aborted,
              io_cache_index: cxt.io_cache_index,
            })

            cxt.io_cache_resolver_is_set = false

            // TODO check if call from prev run 

            if(cxt.io_cache_is_replay_aborted) {
              return
            }

            if(cxt.io_cache_index >= cxt.io_cache.length) {
              // TODO Do nothing or what?
              // Should not gonna happen
              throw new Error('illegal state')
            } else {
              const next_event = cxt.io_cache[cxt.io_cache_index]
              if(next_event.type == 'call') {
                // TODO Call not happened, replay?
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
                  console.log('RESOLVE', cxt.io_cache_index, resolution.index)
                }
              }
            }

            }, 0)
        }

        cxt.io_cache_index++

        if(call.ok) {
          // TODO resolve promises in the same order they were resolved on
          // initial execution

          if(call.value instanceof Promise) {
            return new Promise(resolve => {
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

const io_patch_remove = (obj, method) => {
  if(obj == null || obj[method] == null) {
    // Method is absent in current env, skip patching
    return
  }
  obj[method] = obj[method].__original
}

const Response_methods = [
  'arrayBuffer',
  'blob',
  'formData',
  'json',
  'text',
]

export const apply_io_patches = cxt => {
  io_patch(cxt, Math, 'random', 'Math.random')

  io_patch(cxt, globalThis, 'setTimeout', 'setTimeout')
  // TODO test
  io_patch(cxt, globalThis, 'clearTimeout', 'clearTimeout')


  // TODO test
  const Date = globalThis.Date
  io_patch(cxt, globalThis, 'Date', 'Date')
  globalThis.Date.parse =  Date.parse
  globalThis.Date.now =    Date.now
  globalThis.Date.UTC =    Date.UTC
  io_patch(cxt, globalThis.Date, 'now', 'Date.now')


  io_patch(cxt, globalThis, 'fetch', 'fetch')
  // Check if Response is defined, for node.js
  if(globalThis.Response != null) {
    for(let key of Response_methods) {
      io_patch(cxt, Response.prototype, key, 'Response.prototype.' + key, true)
    }
  }
}

export const remove_io_patches = cxt => {
  // TODO when to apply io_patches and promise_patches? Only once, when we
  // create window?

  io_patch_remove(Math, 'random')

  io_patch_remove(globalThis, 'setTimeout')
  // TODO test
  io_patch_remove(globalThis, 'clearTimeout')

  io_patch_remove(globalThis, 'Date')
  io_patch_remove(globalThis, 'fetch')

  // Check if Response is defined, for node.js
  if(globalThis.Response != null) {
    for(let key of Response_methods) {
      io_patch_remove(Response.prototype, key)
    }
  }
}
