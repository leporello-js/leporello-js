// TODO paging for large arrays/objects
// TODO show Errors in red
// TODO fns as clickable links (jump to definition), both for header and for
// content

import {el, stringify, scrollIntoViewIfNeeded} from './domutils.js'
import {with_code_execution} from '../index.js'
// TODO remove is_expandble, join with displayed entries
import {header, short_header, is_expandable, displayed_entries} from '../value_explorer_utils.js'
import {with_version_number} from '../runtime/runtime.js'
import {is_versioned_object, get_version_number} from '../calltree.js'

const node_props_by_path = (state, o, path) => {
  if(is_versioned_object(o)) {
    return with_version_number(
      state.rt_cxt,
      get_version_number(o),
      () => node_props_by_path(state, o.value, path),
    )
  }
  if(path.length != 0) {
    const [start, ...rest] = path
    const value = displayed_entries(o).find(([k,v]) => k == start)[1]
    return node_props_by_path(state, value, rest)
  } else {
    return {
      displayed_entries: displayed_entries(o),
      header: header(o),
      short_header: short_header(o),
      is_exp: is_expandable(o),
    }
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

    event_target.addEventListener('keydown', e => with_code_execution(() => {

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
      
      const current_node = node_props_by_path(this.state, this.value, this.current_path)

      if(e.key == 'ArrowDown' || e.key == 'j'){
        // Do not scroll
        e.preventDefault()

        if(current_node.is_exp && this.is_expanded(this.current_path)) {
          this.select_path(this.current_path.concat(
            current_node.displayed_entries[0][0]
          ))
        } else {
          const next = p => {
            if(p.length == 0) {
              return null
            }
            const parent = p.slice(0, p.length - 1)
            const children = node_props_by_path(this.state, this.value, parent)
              .displayed_entries
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
        const children = node_props_by_path(this.state, this.value, parent).displayed_entries
        const child_index = children.findIndex(([k,v]) =>  
          k == this.current_path[this.current_path.length - 1]
        )
        const next_child = children[child_index - 1]
        if(next_child == null) {
          this.select_path(parent)
        } else {
          const last = p => {
            const node_props = node_props_by_path(this.state, this.value, p)
            if(!node_props.is_exp || !this.is_expanded(p)) {
              return p
            } else {
              const children = node_props
                .displayed_entries
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
        if(!current_node.is_exp || !is_expanded) {
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

        if(current_node.is_exp) {
          const is_expanded = this.is_expanded(this.current_path)
          if(!is_expanded) {
            this.toggle_expanded()
          } else {
            const children = node_props_by_path(this.state, this.value, this.current_path)
              .displayed_entries
            this.select_path(
              [
                ...this.current_path,
                children[0][0],
              ]
            )
          }
        }
      }
    }))
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

  render(state, value, node_data) {
    this.state = state
    this.value = value
    this.node_data = node_data
    const path = []
    this.container.appendChild(this.render_value_explorer_node(path, this.node_data))
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
    const next = this.render_value_explorer_node(this.current_path, data)
    prev_dom_node.parentNode.replaceChild(next, prev_dom_node)
  }

  toggle_expanded() {
    this.set_expanded(e => !e)
    this.set_active(this.current_path, true)
  }

  render_value_explorer_node(path, node_data) {
    return with_code_execution(() => (
      this.do_render_value_explorer_node(path, node_data)
    ), this.state)
  }

  do_render_value_explorer_node(path, node_data) {
    const key = path.length == 0 
      ? null 
      : path[path.length - 1]

    const {displayed_entries, header, short_header, is_exp} 
      = node_props_by_path(this.state, this.value, path)

    const is_expanded = is_exp && node_data.is_expanded

    node_data.children ??= {}

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
          ? header
          // Short header
          : key == '*arguments*' 
            ? ''
            : short_header
      ),

      (is_exp && is_expanded)
        ? displayed_entries.map(([k,v]) => {
            node_data.children[k] ??= {}
            return this.do_render_value_explorer_node([...path, k], node_data.children[k])
          })
        : []
    )
    
    node_data.el = result

    return result
  }


}
