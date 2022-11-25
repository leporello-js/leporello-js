import {get_initial_state} from './cmd.js'
import {UI} from './editor/ui.js'
import {EFFECTS, render_initial_state, render_common_side_effects} from './effects.js'
import {load_dir} from './filesystem.js'

const EXAMPLE = `const fib = n =>
  n == 0 || n == 1
    ? n
    : fib(n - 1) + fib(n - 2)
fib(6)`

const set_error_handler = w => {
  // TODO err.message
  w.onerror = (msg, src, lineNum, colNum, err) => {
    ui.set_status(msg)
  }
  w.addEventListener('unhandledrejection', (event) => {
    ui.set_status(event.reason)
  })
}

// By default run code in hidden iframe, until user explicitly opens visible
// window
globalThis.run_window = (() => {
  const iframe = document.createElement('iframe')
  iframe.src = 'about:blank'
  iframe.setAttribute('hidden', '')
  document.body.appendChild(iframe)
  set_error_handler(iframe.contentWindow)
  return iframe.contentWindow
})()

export const open_run_window = () => {
  if(globalThis.run_window != null) {
    globalThis.run_window.close()
  }
  globalThis.run_window = open('about:blank')
  exec('rerun_code')
}

const read_modules = async () => {
  const default_module = {'': localStorage.code || EXAMPLE}
  const current = {
    // TODO fix when there are no such modules anymore
    current_module: localStorage.current_module ?? '',
    entrypoint: localStorage.entrypoint ?? '',
  }
  const project_dir = await load_dir(false)
  if(project_dir == null) {
    // Single anonymous module
    return {
      ...current,
      files: default_module,
    }
  } else {
    return {
      ...current,
      project_dir,
      files: default_module,
    }
  }
}

let COMMANDS
let ui
let state

export const init = (container, _COMMANDS) => {
  COMMANDS = _COMMANDS

  set_error_handler(window)

  read_modules().then(initial_state => {
    state = get_initial_state({
      ...initial_state, 
      on_async_call: (...args) => exec('on_async_call', ...args)
    })
    // Expose state for debugging
    globalThis.__state = state
    ui = new UI(container, state)
    // Expose for debugging
    globalThis.__ui = ui
    render_initial_state(ui, state)
  })
}

export const get_state = () => state

export const exec = (cmd, ...args) => {
  if(cmd == 'input' || cmd == 'write') {
    // Do not print file to console
    console.log('exec', cmd)
  } else {
    console.log('exec', cmd, ...args)
  }

  const comm = cmd.split('.').reduce(
    (comm, segment) => comm?.[segment],
    COMMANDS
  )
  if(comm == null) {
    throw new Error('command ' + cmd + ' + not found')
  }

  const result = comm(state, ...args)
  console.log('nextstate', result)

  let nextstate, effects
  if(result.state != null) {
    ({state: nextstate, effects} = result)
  } else {
    nextstate = result
    effects = null
  }

  // Sanity check
  if(state?.parse_result == null) {
    console.error('command did not return state, returned', result)
    throw new Error('illegal state')
  }

  render_common_side_effects(state, nextstate, cmd, ui);

  if(effects != null) {
    (Array.isArray(effects) ? effects : [effects]).forEach(e => {
      if(e.type == 'write' || e.type == 'save_to_localstorage') {
        // do not spam to console
        console.log('apply effect', e.type)
      } else {
        console.log('apply effect', e.type, ...(e.args ?? []))
      }
      EFFECTS[e.type](nextstate, e.args, ui)
    })
  }

  // Expose for debugging
  globalThis.__prev_state = state
  globalThis.__state = nextstate
  state = nextstate
}
