import {Multiversion, rollback_if_needed, wrap_methods, mutate} from './multiversion.js'

function set(prop, value) {
  this[prop] = value
}

export const defineMultiversionArray = window => {
  // We declare class in such a weird name to have its displayed name to be
  // exactly 'Array'
  window.MultiversionArray = class Array extends window.Array {

    constructor(initial, cxt) {
      super()
      this.multiversion = new Multiversion(cxt)
      this.initial = [...initial]
      this.redo_log = []
      this.apply_initial()
    }

    apply_initial() {
      super.length = this.initial.length
      for(let i = 0; i < this.initial.length; i++) {
        this[i] = this.initial[i]
      }
    }

    static get [Symbol.species]() {
      return globalThis.Array
    }

  }

  wrap_methods(
    window.MultiversionArray,

    [
      'at',
      'concat',
      'copyWithin',
      'entries',
      'every',
      'fill',
      'filter',
      'find',
      'findIndex',
      'findLast',
      'findLastIndex',
      'flat',
      'flatMap',
      'forEach',
      'includes',
      'indexOf',
      'join',
      'keys',
      'lastIndexOf',
      'map',
      'pop',
      'push',
      'reduce',
      'reduceRight',
      'reverse',
      'shift',
      'slice',
      'some',
      'sort',
      'splice',
      'toLocaleString',
      'toReversed',
      'toSorted',
      'toSpliced',
      'toString',
      'unshift',
      'values',
      'with',
      Symbol.iterator,
    ],

    [
      'copyWithin',
      'fill',
      'pop',
      'push',
      'reverse',
      'shift',
      'sort',
      'splice',
      'unshift',
    ]
  )
}

const methods_that_return_self = new Set([
  'copyWithin',
  'fill',
  'reverse',
  'sort',
])

export function wrap_array(initial, cxt) {
  const array = new cxt.window.MultiversionArray(initial, cxt)
  const handler = {
    get(target, prop, receiver) {
      rollback_if_needed(target)
      const result = target[prop]
      if(
        typeof(prop) == 'string' 
        && isNaN(Number(prop)) 
        && typeof(result) == 'function'
      ) {
        if(methods_that_return_self.has(prop)) {
          // declare object with key prop for function to have a name
          return {
            [prop]() {
              result.apply(target, arguments)
              return receiver
            }
          }[prop]
        } else {
          return {
            [prop]() {
              return result.apply(target, arguments)
            }
          }[prop]
        }
      } else {
        return result
      }
    },

    set(obj, prop, val) {
      mutate(obj, set, [prop, val])
      return true
    },
  }
  return new Proxy(array, handler)
}

export function create_array(initial, cxt, index, literals) {
  const result = wrap_array(initial, cxt)
  literals.set(index, result)
  return result
}
