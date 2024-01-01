export class Multiversion {
  constructor(cxt) {
    this.cxt = cxt
    this.ct_expansion_id = cxt.ct_expansion_id
  }

  is_created_during_current_expansion() {
    return this.ct_expansion_id == this.cxt.ct_expansion_id
  }

  needs_rollback() {
    if(this.cxt.is_expanding_calltree_node) {
      if(this.is_created_during_current_expansion()) {
        // do nothing, keep using current version
      } else {
        if(this.rollback_expansion_id == this.cxt.ct_expansion_id) {
          // do nothing, keep using current version
          // We are in the same expansion rollback was done, keep using current version
        } else {
          this.rollback_expansion_id = this.cxt.ct_expansion_id
          return true
        }
      }
    } else {
      if(this.rollback_expansion_id != null) {
        this.rollback_expansion_id = null
        return true
      } else {
        // do nothing
      }
    }
  }
}


export function rollback_if_needed(object) {
  if(object.multiversion.needs_rollback()) {
    // Rollback to initial value
    object.apply_initial()
    // Replay redo log
    for(let i = 0; i < object.redo_log.length; i++) {
      const log_item = object.redo_log[i]
      if(log_item.version_number > object.multiversion.cxt.version_counter) {
        break
      }
      log_item.method.apply(object, log_item.args)
    }
  }
}

function wrap_readonly_method(clazz, method) {
  const original = clazz.__proto__.prototype[method]
  clazz.prototype[method] = {
    [method](){
      rollback_if_needed(this)
      return original.apply(this, arguments)
    }
  }[method]
}

export function mutate(object, method, args) {
  rollback_if_needed(object)
  const version_number = ++object.multiversion.cxt.version_counter
  if(object.multiversion.is_created_during_current_expansion()) {
    object.redo_log.push({
      method, 
      args, 
      version_number,
    })
  }
  return method.apply(object, args)
}

function wrap_mutating_method(clazz, method) {
  const original = clazz.__proto__.prototype[method]
  clazz.prototype[method] = {
    [method]() {
      return mutate(this, original, arguments)
    }
  }[method]
}

export function wrap_methods(clazz, all_methods, mutating_methods) {
  for (let method of all_methods) {
    if(mutating_methods.includes(method)) {
      wrap_mutating_method(clazz, method)
    } else {
      wrap_readonly_method(clazz, method)
    }
  }
}
