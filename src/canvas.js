// TODO time-travel for canvas ImageData

import {abort_replay} from './runtime/record_io.js'
import {set_record_call} from './runtime/runtime.js'
import {is_expandable} from './calltree.js'

const context_reset = globalThis?.CanvasRenderingContext2D?.prototype?.reset

function reset(context) {
  if(context_reset != null) {
    context_reset.call(context)
  } else {
    // For older browsers, `reset` may be not available
    // changing width does the same as `reset`
    // see https://stackoverflow.com/a/45871243/795038
    context.canvas.width = context.canvas.width + 0
  }
}

function canvas_reset(canvas_ops) {
  for(let context of canvas_ops.contexts) {
    reset(context)
  }
}

export function apply_canvas_patches(window) {
  const proto = window?.CanvasRenderingContext2D?.prototype

  if(proto == null) {
    return
  }

  const props = Object.getOwnPropertyDescriptors(proto)

  Object.entries(props).forEach(([name, p]) => {
    if(p.value != null) {
      if(typeof(p.value) != 'function') {
        // At the moment this was written, all canvas values were functions
        return
      }
      const method = p.value
      proto[name] = { 
        // declare function like this so it has `name` property set
        [name]() {
          const cxt = window.__cxt

          set_record_call(cxt)

          /*
          abort replay, because otherwise animated_fractal_tree would replay
          instantly (because setTimeout is in io_trace)
          */
          if(!cxt.io_trace_is_recording && !cxt.is_recording_deferred_calls) {
            abort_replay(cxt)
          }

          const version_number = ++cxt.version_counter

          try {
            return method.apply(this, arguments)
          } finally {
            cxt.canvas_ops.contexts.add(this)
            cxt.canvas_ops.ops.push({
              canvas_context: this,
              method,
              version_number,
              args: arguments,
            })
          }
        }
      }[name]
    }

    if(p.set != null) {
      const set_op = p.set
      Object.defineProperty(proto, name, {
        set(prop_value) {
          const cxt = window.__cxt

          set_record_call(cxt)

          if(!cxt.io_trace_is_recording && !cxt.is_recording_deferred_calls) {
            abort_replay(cxt)
          }

          const version_number = ++cxt.version_counter

          try {
            set_op.call(this, prop_value)
          } finally {
            cxt.canvas_ops.contexts.add(this)
            cxt.canvas_ops.ops.push({
              canvas_context: this,
              version_number,
              set_op,
              prop_value,
            })
          }
        }
      })
    }
  })
}

function replay_op(op) {
  if(op.method != null) {
    op.method.apply(op.canvas_context, op.args)
  } else if(op.set_op != null) {
    op.set_op.call(op.canvas_context, op.prop_value)
  } else {
    throw new Error('illegal op')
  }
}

export function redraw_canvas(state, is_replay_all_canvs_ops) {
  if(state.calltree == null) {
    // code is invalid or not executed yet
    return
  }

  const cxt = state.rt_cxt

  if(cxt.canvas_ops.ops == null) {
    return
  }

  canvas_reset(cxt.canvas_ops)

  if(is_replay_all_canvs_ops) {
    for(let op of cxt.canvas_ops.ops) {
      replay_op(op)
    }
  } else {
    const current = state.current_calltree_node
      // replay all ops up to current_calltree_node, including
    const version_number = state.current_calltree_node.last_version_number
    for(let op of cxt.canvas_ops.ops) {
      if(op.version_number > version_number) {
        break
      }
      replay_op(op)
    }
  }
}
