import {exec} from '../index.js'
import {el, stringify, fn_link, scrollIntoViewIfNeeded} from './domutils.js'
import {FLAGS} from '../feature_flags.js'
import {stringify_for_header} from './value_explorer.js'
import {find_node} from '../ast_utils.js'
import {is_expandable, root_calltree_node} from '../calltree.js'

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

      if(e.key == 'F1') {
        this.ui.editor.focus_value_explorer(this.container)
      }

      if(e.key == 'F2') {
        this.ui.editor.focus()
      }

      if(e.key == 'F3') {
        this.ui.set_active_tab('logs')
      }

      if(e.key == 'a') {
        if(FLAGS.embed_value_explorer) {
          exec('calltree.select_arguments')
        } else {
          // TODO make clear that arguments are shown
          this.ui.eval.show_value(this.state.current_calltree_node.args)
          this.ui.eval.focus_value_or_error(this.container)
        }
      }

      if(e.key == 'r' || e.key == 'Enter') {
        if(FLAGS.embed_value_explorer) {
          exec('calltree.select_return_value')
        } else {
          // TODO make clear that return value is shown
          this.ui.eval.show_value_or_error(this.state.current_calltree_node)
          this.ui.eval.focus_value_or_error(this.container)
        }
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

  on_click_node(id) {
    exec('calltree.click', id)
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
        click: () => this.on_click_node(n.id),
      },
        !is_expandable(n)
          ? '\xa0'
          : is_expanded ? '???' : '???',
        n.toplevel
        ? el('span', '',
            el('i', '', 
              'toplevel: ' + (n.module == '' ? '*scratch*' : n.module),
            ),
            n.ok ? '' : el('span', 'call_header error', '\xa0', n.error.toString()),
          )
        : el('span', 
              'call_header ' 
                + (n.ok ? '' : 'error') 
                + (n.fn.__location == null ? ' native' : '')
            ,
            // TODO show `this` argument
            n.fn.name
            ,
            '(' ,
             ...join(
               n.args.map(
                 a => typeof(a) == 'function'
                  ? fn_link(a)
                  : stringify_for_header(a)
               )
             ),
            ')' ,
            // TODO: show error message only where it was thrown, not every frame?
            ': ', (n.ok ? stringify_for_header(n.value) : n.error.toString()) 
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

  // TODO on hover highlight line where function defined/
  // TODO hover ?
  render_calltree(state){
    this.clear_calltree()
    this.state = state
    const root = root_calltree_node(this.state)
    this.container.appendChild(this.render_node(root))
    this.render_select_node(null, state)
  }
}
