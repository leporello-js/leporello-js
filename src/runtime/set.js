import {Multiversion, wrap_methods, rollback_if_needed} from './multiversion.js'

export const defineMultiversionSet = window => {

  // We declare class in such a weird name to have its displayed name to be
  // exactly 'Set'
  window.MultiversionSet = class Set extends window.Set {
    
    constructor(initial, cxt) {
      super()
      this.multiversion = new Multiversion(cxt)
      this.initial = new globalThis.Set(initial)
      this.redo_log = []
      this.apply_initial()
    }

    apply_initial() {
      super.clear()
      for (const item of this.initial) {
        super.add(item)
      }
    }

    get size() {
      rollback_if_needed(this)
      return super.size
    }

  }

  wrap_methods(
    window.MultiversionSet,

    // all methods
    [
      'has', 'add', 'delete', 'clear', 'entries', 'forEach', 'values', 'keys',
      Symbol.iterator,
    ],

    // mutation methods
    ['add', 'delete', 'clear'],
  )

}
