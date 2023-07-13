// TODO paging for large arrays/objects
// TODO maps, sets
// TODO show Errors in red
// TODO fns as clickable links (jump to definition), both for header and for
// content

import {el, stringify, scrollIntoViewIfNeeded} from './domutils.js'
import {with_code_execution} from '../index.js'


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

const toJSON_safe = object => {
  try {
    return with_code_execution(() => {
      return object.toJSON() 
    })
  } catch(e) {
    return object
  }
}

const displayed_entries = object => {
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

const is_expandable = v => 
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


const stringify_for_header_object = v => {
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
  return `${prefix} {${inner}}`
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

const get_path = (o, path) => {
  if(path.length == 0) {
    return o
  } else {
    const [start, ...rest] = path
    return get_path(o[start], rest)
  }
}

export class ValueExplorer {

  constructor({
    container,
    event_target = container,
    scroll_to_element,
    on_escape = () => {},
  } = {}
  ) {
    this.container = container
    this.scroll_to_element = scroll_to_element
    this.on_escape = on_escape

    event_target.addEventListener('keydown', (e) => {

      /*
        Right - 
          - does not has children - nothing
          - has children - first click expands, second jumps to first element

        Left - 
          - root - nothing
          - not root collapse node, goes to parent if already collapsed

        Up - goes to prev visible element
        Down - goes to next visible element

        Click - select and toggles expand
      */

      if(e.key == 'F1') {
        this.on_escape()
        return
      }
      
      const current_object = get_path(this.value, this.current_path)

      if(e.key == 'ArrowDown' || e.key == 'j'){
        // Do not scroll
        e.preventDefault()

        if(is_expandable(current_object) && this.is_expanded(this.current_path)) {
          this.select_path(this.current_path.concat(
            displayed_entries(current_object)[0][0]
          ))
        } else {
          const next = p => {
            if(p.length == 0) {
              return null
            }
            const parent = p.slice(0, p.length - 1)
            const children = displayed_entries(get_path(this.value, parent))
            const child_index = children.findIndex(([k,v]) =>  
              k == p[p.length - 1]
            )
            const next_child = children[child_index + 1]
            if(next_child == null) {
              return next(parent)
            } else {
              return [...parent, next_child[0]]
            }
          }

          const next_path = next(this.current_path)
          if(next_path != null) {
            this.select_path(next_path)
          }
        }
      }

      if(e.key == 'ArrowUp' || e.key == 'k'){
        // Do not scroll
        e.preventDefault()

        if(this.current_path.length == 0) {
          this.on_escape()
          return
        }
        const parent = this.current_path.slice(0, this.current_path.length - 1)
        const children = displayed_entries(get_path(this.value, parent))
        const child_index = children.findIndex(([k,v]) =>  
          k == this.current_path[this.current_path.length - 1]
        )
        const next_child = children[child_index - 1]
        if(next_child == null) {
          this.select_path(parent)
        } else {
          const last = p => {
            if(!is_expandable(get_path(this.value, p)) || !this.is_expanded(p)) {
              return p
            } else {
              const children = displayed_entries(get_path(this.value, p))
                .map(([k,v]) => k)
              return last([...p, children[children.length - 1]])

            }
          }
          this.select_path(last([...parent, next_child[0]]))
        }
      }

      if(e.key == 'ArrowLeft' || e.key == 'h'){
        // Do not scroll
        e.preventDefault()

        const is_expanded = this.is_expanded(this.current_path)
        if(!is_expandable(current_object) || !is_expanded) {
          if(this.current_path.length != 0) {
            const parent = this.current_path.slice(0, this.current_path.length - 1)
            this.select_path(parent)
          } else {
            this.on_escape()
          }
        } else {
          this.toggle_expanded()
        }
      }

      if(e.key == 'ArrowRight' || e.key == 'l'){
        // Do not scroll
        e.preventDefault()

        if(is_expandable(current_object)) {
          const is_expanded = this.is_expanded(this.current_path)
          if(!is_expanded) {
            this.toggle_expanded()
          } else {
            const children = displayed_entries(get_path(this.value, this.current_path))
            this.select_path(
              [
                ...this.current_path,
                children[0][0],
              ]
            )
          }
        }
      }
    })
  }

  get_node_data(path, node_data = this.node_data) {
    if(path.length == 0) {
      return node_data
    } else {
      const [start, ...rest] = path
      return this.get_node_data(rest, node_data.children[start])
    }
  }

  is_expanded(path) {
    return this.get_node_data(path).is_expanded
  }

  on_click(path) {
    this.select_path(path)
    this.toggle_expanded()
  }

  clear() {
    this.container.innerHTML = ''
    this.node_data = {is_expanded: true}
  }

  render(value) {
    this.clear()
    this.value = value
    const path = []
    this.container.appendChild(this.render_value_explorer_node(null, value, path, this.node_data))
    this.select_path(path)
  }

  select_path(current_path) {
    if(this.current_path != null) {
      this.set_active(this.current_path, false)
    }
    this.current_path = current_path
    this.set_active(this.current_path, true)
    // Check that was already added to document
    if(document.contains(this.container)) {
      const target = this.get_node_data(current_path).el.getElementsByClassName('value_explorer_header')[0]
      if(this.scroll_to_element == null) {
        scrollIntoViewIfNeeded(this.container.parentNode, target)
      } else {
        this.scroll_to_element(target)
      }
    }
  }

  set_active(path, is_active) {
    const el = this.get_node_data(path).el.getElementsByClassName('value_explorer_header')[0]
    if(is_active) {
      el.classList.add('active')
    } else {
      el.classList.remove('active')
    }
  }

  set_expanded(fn) {
    if(typeof(fn) == 'boolean') {
      return this.set_expanded(() => fn)
    }
    const val = this.is_expanded(this.current_path)
    const data = this.get_node_data(this.current_path)
    data.is_expanded = fn(data.is_expanded)
    const prev_dom_node = data.el
    const key = this.current_path.length == 0 
      ? null 
      : this.current_path[this.current_path.length - 1]
    const value = get_path(this.value, this.current_path)
    const next = this.render_value_explorer_node(key, value, this.current_path, data)
    prev_dom_node.parentNode.replaceChild(next, prev_dom_node)
  }

  toggle_expanded() {
    this.set_expanded(e => !e)
    this.set_active(this.current_path, true)
  }

  render_value_explorer_node(key, value, path, node_data) {

    const is_exp = is_expandable(value)
    const is_expanded = is_exp && node_data.is_expanded

    node_data.children = {}

    const result = el('div', 'value_explorer_node',

      el('span', {
          class: 'value_explorer_header', 
          click: this.on_click.bind(this, path),
      }, 
        is_exp
          ? (is_expanded ? '▼' : '▶')
          : '\xa0',

        key == null
          ? null
          : el('span', 'value_explorer_key', key.toString(), ': '),

        key == null || !is_exp || !is_expanded
          // Full header
          ? header(value)
          // Short header
          : Array.isArray(value)
            ? 'Array(' + value.length + ')'
            : ''
      ),

      (is_exp && is_expanded)
        ? displayed_entries(value).map(([k,v]) => {
            node_data.children[k] = {}
            return this.render_value_explorer_node(k, v, [...path, k], node_data.children[k])
          })
        : []
    )
    
    node_data.el = result

    return result
  }


}
