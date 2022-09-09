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
        this.ui.editor.focus()
      }

      if(e.key == 'F2') {
        this.ui.editor.focus_value_explorer(this.container)
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

  render_node(n, current_node){
    const is_expanded = this.state.calltree_node_is_expanded[n.id]

    const result = el('div', 'callnode',
      el('div', {
        'class': (n == current_node ? 'call_el active' : 'call_el'),
        click: () => this.on_click_node(n.id),
      },
        !is_expandable(n)
          ? '\xa0'
          : is_expanded ? '▼' : '▶',
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
            n.fn.__location == null
              ? fn_link(n.fn)
              : n.fn.name
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
        : n.children.map(c => this.render_node(c, current_node))
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

  render_select_node(state) {
    this.render_active(this.state.current_calltree_node, false)
    this.state = state
    this.render_active(this.state.current_calltree_node, true)
    scrollIntoViewIfNeeded(
      this.container, 
      this.node_to_el.get(this.state.current_calltree_node.id).getElementsByClassName('call_el')[0]
    )
  }

  render_expand_node(state) {
    this.state = state
    const current_node = this.state.current_calltree_node
    const prev_dom_node = this.node_to_el.get(current_node.id)
    const next = this.render_node(current_node, current_node)
    prev_dom_node.parentNode.replaceChild(next, prev_dom_node)
  }

  // TODO on hover highlight line where function defined/
  // TODO hover ?
  render_calltree(state){
    this.clear_calltree()
    this.state = state
    const root = root_calltree_node(this.state)
    const current_node = state.current_calltree_node
    this.container.appendChild(this.render_node(root, current_node))
    this.render_select_node(state, root, current_node)
  }
}
