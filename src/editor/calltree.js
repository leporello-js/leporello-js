import {exec} from '../index.js'
import {el, stringify, fn_link, scrollIntoViewIfNeeded} from './domutils.js'
import {stringify_for_header} from '../value_explorer_utils.js'
import {find_node} from '../ast_utils.js'
import {with_version_number} from '../runtime/runtime.js'
import {is_expandable, root_calltree_node, get_deferred_calls, has_error} 
  from '../calltree.js'

// TODO perf - quadratic difficulty
const join = arr => arr.reduce(
  (acc, el) => acc.length == 0 
                  ? [el]
                  : [...acc, ',', el],
  [],
)

export class CallTree {
  constructor(ui, container) {
    this.ui = ui
    this.container = container

    this.container.addEventListener('keydown', (e) => {

      // Do not scroll
      e.preventDefault()

      if(e.key == 'Escape') {
        this.ui.editor.focus()
      }

      if(e.key == 'F1') {
        this.ui.editor.focus_value_explorer(this.container)
      }

      if(e.key == 'F2') {
        this.ui.editor.focus()
      }

      if(e.key == 'a') {
        exec('calltree.select_arguments')
      }

      if(e.key == 'e') {
        exec('calltree.select_error')
      }

      if(e.key == 'r' || e.key == 'Enter') {
        exec('calltree.select_return_value')
      }

      if(e.key == 'ArrowDown' || e.key == 'j'){
        exec('calltree.arrow_down')
      }

      if(e.key == 'ArrowUp' || e.key == 'k'){
        exec('calltree.arrow_up')
      }

      if(e.key == 'ArrowLeft' || e.key == 'h'){
        exec('calltree.arrow_left')
      }

      if(e.key == 'ArrowRight' || e.key == 'l'){
        exec('calltree.arrow_right')
      }
    })

  }

  on_click_node(ev, id) {
    if(ev.target.classList.contains('expand_icon')) {
      exec('calltree.select_and_toggle_expanded', id)
    } else {
      exec('calltree.select_node', id)
    }
  }

  clear_calltree(){
    this.container.innerHTML = ''
    this.node_to_el = new Map()
    this.state = null
  }

  render_node(n){
    const is_expanded = this.state.calltree_node_is_expanded[n.id]

    const result = el('div', 'callnode',
      el('div', {
        'class': 'call_el',
        click: e => this.on_click_node(e, n.id),
      },
        !is_expandable(n)
          ? '\xa0'
          : el('span', 'expand_icon', is_expanded ? '▼' : '▶'),
        n.toplevel
        ? el('span', '',
            el('i', '', 
              'toplevel: ' + (n.module == '' ? '*scratch*' : n.module),
            ),
            n.ok ? '' : el('span', 'call_header error', '\xa0', stringify_for_header(n.error)),
          )
        : el('span', 
              'call_header ' 
                + (has_error(n) ? 'error' : '') 
                + (n.fn.__location == null ? ' native' : '')
            ,
            // TODO show `this` argument
            (n.is_new ? 'new ' : ''),
            n.fn.name,
            '(' ,
             ...join(
               // for arguments, use n.version_number - last version before call
               with_version_number(this.state.rt_cxt, n.version_number, () =>
                 n.args.map(
                   a => typeof(a) == 'function'
                    ? fn_link(a)
                    : stringify_for_header(a)
                 )
               )
             ),
            ')' ,
            // TODO: show error message only where it was thrown, not every frame?
            ': ', 
            // for return value, use n.last_version_number - last version that was
            // created during call
            with_version_number(this.state.rt_cxt, n.last_version_number, () => 
              (n.ok ? stringify_for_header(n.value) : stringify_for_header(n.error)) 
            )
          ),
      ),
      (n.children == null || !is_expanded)
        ? null
        : n.children.map(c => this.render_node(c))
    )

    this.node_to_el.set(n.id, result)

    result.is_expanded = is_expanded

    return result
  }

  render_active(node, is_active) {
    const dom = this.node_to_el.get(node.id).getElementsByClassName('call_el')[0]
    if(is_active) {
      dom.classList.add('active')
    } else {
      dom.classList.remove('active')
    }
  }

  render_select_node(prev, state) {
    if(prev != null) {
      this.render_active(prev.current_calltree_node, false)
    }
    this.state = state
    this.render_active(this.state.current_calltree_node, true)
    scrollIntoViewIfNeeded(
      this.container, 
      this.node_to_el.get(this.state.current_calltree_node.id).getElementsByClassName('call_el')[0]
    )
  }

  render_expand_node(prev_state, state) {
    this.state = state

    this.do_render_expand_node(
      prev_state.calltree_node_is_expanded,
      state.calltree_node_is_expanded,
      root_calltree_node(prev_state),
      root_calltree_node(state),
    )

    const prev_deferred_calls = get_deferred_calls(prev_state)
    const deferred_calls = get_deferred_calls(state)

    if(prev_deferred_calls != null) {
      // Expand already existing deferred calls
      for(let i = 0; i < prev_deferred_calls.length; i++) {
        this.do_render_expand_node(
          prev_state.calltree_node_is_expanded,
          state.calltree_node_is_expanded,
          prev_deferred_calls[i],
          deferred_calls[i],
        )
      }
      // Add new deferred calls
      for(let i = prev_deferred_calls.length; i < deferred_calls.length; i++) {
        this.deferred_calls_root.appendChild(
          this.render_node(deferred_calls[i])
        )
      }
    }

    this.render_select_node(prev_state, state)
  }

  do_render_expand_node(prev_exp, next_exp, prev_node, next_node) {
    if(prev_node.id != next_node.id) {
      throw new Error()
    }
    if(!!prev_exp[prev_node.id] != !!next_exp[next_node.id]) {
      const prev_dom_node = this.node_to_el.get(prev_node.id)
      const next = this.render_node(next_node)
      prev_dom_node.parentNode.replaceChild(next, prev_dom_node)
    } else {
      if(prev_node.children == null) {
        return
      }
      for(let i = 0; i < prev_node.children.length; i++) {
        this.do_render_expand_node(
          prev_exp, 
          next_exp, 
          prev_node.children[i],
          next_node.children[i],
        )
      }
    }
  }

  // TODO on hover highlight line where function defined
  // TODO hover ?
  render_calltree(state){
    this.clear_calltree()
    this.state = state
    const root = root_calltree_node(this.state)
    this.container.appendChild(this.render_node(root))
    this.render_select_node(null, state)
  }

  render_deferred_calls(state) {
    this.state = state
    this.container.appendChild(
      el('div', 'callnode', 
        el('div', 'call_el',
          el('i', '', 'deferred calls'),
          this.deferred_calls_root = el('div', 'callnode',
            get_deferred_calls(state).map(call => this.render_node(call))
          )
        )
      )
    )
  }
}
