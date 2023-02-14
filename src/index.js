import {UI} from './editor/ui.js'
import {EFFECTS, render_initial_state, render_common_side_effects} from './effects.js'
import {load_dir} from './filesystem.js'

const EXAMPLE = `const fib = n =>
  n == 0 || n == 1
    ? n
    : fib(n - 1) + fib(n - 2)
fib(6)`


const set_error_handler = (w, with_unhandled_rejection = true) => {
  // TODO err.message
  w.onerror = (msg, src, lineNum, colNum, err) => {
    if(err?.__ignore) {
      return
    }
    ui.set_status(msg)
  }
  if(with_unhandled_rejection) {
    w.addEventListener('unhandledrejection', (event) => {
      ui.set_status(event.reason)
    })
  }
}

// Fake directory, http requests to this directory intercepted by service_worker
export const FILES_ROOT = new URL('./__leporello_files', globalThis.location)

const get_html_url = state => {
  const base = FILES_ROOT + '/' 
  return state.html_file == ''
    ? base + '__leporello_blank.html'
    : base + state.html_file + '?leporello'
}

// By default run code in hidden iframe, until user explicitly opens visible
// window
const open_run_iframe = (state, onload) => {
  const iframe = document.createElement('iframe')
  iframe.src = get_html_url(state)
  iframe.setAttribute('hidden', '')
  document.body.appendChild(iframe)
  // for run_window, do not set unhandled rejection, because having rejected
  // promises in user code is normal condition
  set_error_handler(iframe.contentWindow, false)
  iframe.contentWindow.addEventListener('load', onload)
  globalThis.run_window = iframe.contentWindow
}

// Open another browser window so user can interact with application
// TODO test in another browsers
export const open_run_window = state => {
  // TODO set_error_handler? Or we dont need to set_error_handler for child
  // window because error is always caught by parent window handler?
  globalThis.run_window.close()

  const next_window = globalThis.run_window = open(get_html_url(state))

  const is_loaded = () => {
    const nav = next_window.performance.getEntriesByType("navigation")[0]
    return nav != null && nav.loadEventEnd > 0
  }

  // Wait until `load` event before executing code, because service worker that
  // is responsible for loading external modules seems not working until `load`
  // event fired.  TODO: better register SW explicitly and don't rely on
  // already registered SW?
  const onload = () => {
    exec('open_run_window')
  }

  const add_load_handler = () => {
    /*
      Wait until 'load event', then set unload handler. The page after
      window.open seems to go through these steps:

      - about:blank gets opened
      - Real URL get opened
      - 'unload' event for about:blank page
      - 'load event for real URL

      if we set unload handler right now, then it will be fired for unload
        event for about:blank page
    */
    if(is_loaded()) {
      // Already loaded
      add_unload_handler()
      onload()
    } else {
      next_window.addEventListener('load', () => {
        add_unload_handler()
        onload()
      })
    }
  }

  const add_unload_handler = () => {
    next_window.addEventListener('unload', (e) => {
      // Set timeout to 100ms because it takes some time for page to get closed
      // after triggering 'unload' event
      setTimeout(() => {
        if(next_window.closed) {
          // If by that time next_window.closed was set to true, then page was
          // closed
          // TODO get back to iframe?
        } else {
          add_load_handler()
        }
      }, 100)
    })
  }

  add_load_handler()
}

export const reload_run_window = state => {
  // TODO after window location reload, open_run_window command will be fired.
  // Maybe we should have separate commands for open_run_window and
  // reload_run_window?
  globalThis.run_window.location = get_html_url(state)
}

const read_modules = async () => {
  const default_module = {'': localStorage.code || EXAMPLE}
  const current = {
    // TODO fix when there are no such modules anymore
    current_module: localStorage.current_module ?? '',
    entrypoint: localStorage.entrypoint ?? '',
    html_file: localStorage.html_file ?? '',
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

    state = COMMANDS.get_initial_state({
      ...initial_state, 
      on_deferred_call: (...args) => exec('on_deferred_call', ...args)
    })

    // Expose state for debugging
    globalThis.__state = state
    ui = new UI(container, state)
    // Expose for debugging
    globalThis.__ui = ui

    render_initial_state(ui, state)

    open_run_iframe(state, () => {
      exec('open_run_window')
    })
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
  if(state?.current_module == null) {
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
