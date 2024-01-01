import {Multiversion, wrap_methods, rollback_if_needed} from './multiversion.js'

export const defineMultiversionMap = window => {

  // We declare class in such a weird name to have its displayed name to be
  // exactly 'Map'
  window.MultiversionMap = class Map extends window.Map {

    constructor(initial, cxt) {
      super()
      this.multiversion = new Multiversion(cxt)
      this.initial = new globalThis.Map(initial)
      this.redo_log = []
      this.apply_initial()
    }

    apply_initial() {
      super.clear()
      for(let [k,v] of this.initial) {
        super.set(k,v)
      }
    }

    get size() {
      rollback_if_needed(this)
      return super.size
    }

  }


  wrap_methods(
    window.MultiversionMap,

    // all methods
    [
      'clear', 'delete', 'entries', 'forEach', 'get', 'has', 'keys', 'set', 'values',
      Symbol.iterator,
    ],

    // mutation methods
    ['set', 'delete', 'clear'],
  )

}
