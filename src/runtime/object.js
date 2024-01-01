import {Multiversion, rollback_if_needed, wrap_methods, mutate} from './multiversion.js'

export function create_object(initial, cxt, index, literals) {
  const multiversion = new Multiversion(cxt)

  let latest = {...initial}
  const redo_log = []

  function rollback_if_needed() {
    if(multiversion.needs_rollback()) {
      latest = {...initial}
      for(let i = 0; i < redo_log.length; i++) {
        const log_item = redo_log[i]
        if(log_item.version_number > multiversion.cxt.version_counter) {
          break
        }
        if(log_item.type == 'set') {
          latest[log_item.prop] = log_item.value
        } else if(log_item.type == 'delete') {
          delete latest[log_item.prop]
        } else {
          throw new Error('illegal type')
        }
      }
    }
  }

  const handler = {
    get(target, prop, receiver) {
      rollback_if_needed()
      return latest[prop]
    },

    has(target, prop) {
      rollback_if_needed()
      return prop in latest
    },

    set(obj, prop, value) {
      rollback_if_needed()
      const version_number = ++multiversion.cxt.version_counter
      if(multiversion.is_created_during_current_expansion()) {
        redo_log.push({ type: 'set', prop, value, version_number })
      }
      latest[prop] = value
      return true
    },

    ownKeys(target) {
      rollback_if_needed()
      return Object.keys(latest)
    },

    getOwnPropertyDescriptor(target, prop) {
      rollback_if_needed()
      return { 
        configurable: true, 
        enumerable: true, 
        value: latest[prop],
      };
    },

    // TODO delete property handler
  }
  const result = new Proxy(initial, handler)
  literals.set(index, result)
  return result
}
