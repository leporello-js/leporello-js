// We test both for Object and globalThis.app_window.Object because objects may
// come both from app_window and current window (where they are created in
// metacircular interpreter
const has_custom_toString = object =>
  typeof(object.toString) == 'function'
  && object.toString != globalThis.app_window.Object.prototype.toString
  && object.toString != Object.prototype.toString

const isError = object => 
  object instanceof Error
  ||
  object instanceof globalThis.app_window.Error

const isPromise = object =>
  object instanceof globalThis.app_window.Promise

// Override behaviour for Date, becase Date has toJSON defined
const isDate = object => 
  object instanceof globalThis.app_window.Date
  ||
  object instanceof globalThis.app_window.Date.__original

// Workaround try/catch is not implemented currently
const toJSON_safe = new Function('object', `
  try {
    return object.toJSON() 
  } catch(e) {
    return object
  }
`)

export const displayed_entries = object => {
  if(object == null || typeof(object) != 'object') {
    return []
  } else if((object[Symbol.toStringTag]) == 'Module') {
    return Object.entries(object)
  } else if(isPromise(object)) {
    return displayed_entries(
      object.status.ok ? object.status.value : object.status.error
    )
  } else if(Array.isArray(object)) {
    return object.map((v, i) => [i, v])
  } else if(object[Symbol.toStringTag] == 'Set') {
    // TODO display set as list without keys as indexes, because Set in JS are
    // not ordered and it would be incorrect to imply ordering
    return [...object.values()].map((entry, i) => [i, entry])
  } else if(object[Symbol.toStringTag] == 'Map') {
    return [...object.entries()]
  } else if(typeof(object.toJSON) == 'function') {
    const result = toJSON_safe(object)
    if(result == object) {
      // avoid infinite recursion when toJSON returns itself
      return Object.entries(object)
    } else {
      return displayed_entries(result)
    }
  } else {
    return Object.entries(object)
  }
}

export const is_expandable = v => 
  isPromise(v) 
  ? (
      v.status != null 
      && is_expandable(v.status.ok ? v.status.value : v.status.error)
    )
  : (
      typeof(v) == 'object' 
      && v != null 
      && displayed_entries(v).length != 0
    )


export const stringify_for_header_object = v => {
  if(displayed_entries(v).length == 0) {
    return '{}'
  } else {
    return '{…}'
  }
}

export const stringify_for_header = (v, no_toJSON = false) => {
  const type = typeof(v)

  if(v === null) {
    return 'null'
  } else if(v === undefined) {
    return 'undefined'
  } else if(type == 'function') {
    // TODO clickable link, 'fn', cursive
    return 'fn ' + v.name
  } else if(type == 'string') {
    return JSON.stringify(v)
  } else if(type == 'object') {
    if((v[Symbol.toStringTag]) == 'Module') {
      // protect against lodash module contains toJSON function
      return stringify_for_header_object(v)
    } else if (isPromise(v)) {
      if(v.status == null) {
        return `Promise<pending>`
      } else {
        if(v.status.ok) {
          return `Promise<fulfilled: ${stringify_for_header(v.status.value)}>`
        } else {
          return `Promise<rejected: ${stringify_for_header(v.status.error)}>`
        }
      }
    } else if (isDate(v)) {
      return v.toString()
    } else if(isError(v)) {
      return v.toString()
    } else if(Array.isArray(v)) {
      if(v.length == 0) {
        return '[]'
      } else {
        return '[…]'
      }
    } else if(typeof(v.toJSON) == 'function' && !no_toJSON) {
      const json = toJSON_safe(v)
      if(json == v) {
        // prevent infinite recursion
        return stringify_for_header(json, true)
      } else {
        return stringify_for_header(json)
      }
    } else if(has_custom_toString(v)) {
      return v.toString()
    } else {
      return stringify_for_header_object(v)
    }
  } else {
    return v.toString()
  }
}

export const short_header = value => 
  Array.isArray(value)
    ? 'Array(' + value.length + ')'
    : ''

const header_object = object => {
  const prefix = 
    (object.constructor?.name == null || object.constructor?.name == 'Object')
      ? ''
      : object.constructor.name + ' '
  const inner = displayed_entries(object)
    .map(([k,v]) => {
      const value = stringify_for_header(v)
      return `${k}: ${value}`
    })
    .join(', ')
  return `${prefix}{${inner}}`
}

export const header = (object, no_toJSON = false) => {
  const type = typeof(object)

  if(object === null) {
    return 'null'
  } else if(object === undefined) {
    return 'undefined'
  } else if(type == 'function') {
    // TODO clickable link, 'fn', cursive
    return 'fn ' + object.name
  } else if(type == 'string') {
    return JSON.stringify(object)
  } else if(type == 'object') {
    if((object[Symbol.toStringTag]) == 'Module') {
      // protect against lodash module contains toJSON function
      return header_object(object)
    } else if(isPromise(object)) {
      if(object.status == null) {
        return `Promise<pending>`
      } else {
        if(object.status.ok) {
          return `Promise<fulfilled: ${header(object.status.value)}>`
        } else {
          return `Promise<rejected: ${header(object.status.error)}>`
        }
      }
    } else if(isDate(object)) {
      return object.toString()
    } else if(isError(object)) {
      return object.toString()
    } else if(Array.isArray(object)) {
      return '['
        + object
          .map(stringify_for_header)
          .join(', ')
        + ']'
    } else if(typeof(object.toJSON) == 'function' && !no_toJSON) {
      const json = toJSON_safe(object)
      if(json == object) {
        // prevent infinite recursion
        return header(object, true)
      } else {
        return header(json)
      }
    } else if(has_custom_toString(object)) {
      return object.toString()
    } else {
      return header_object(object)
    }
  } else {
    return object.toString()
  }
}

