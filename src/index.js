import {UI} from './editor/ui.js'
import {EFFECTS, render_initial_state, apply_side_effects} from './effects.js'
import {
  open_dir, 
  close_dir, 
  init_window_service_worker
} from './filesystem.js'
import {examples, examples_dir_promise} from './examples.js'
import {get_share} from './share.js'

const EXAMPLE = `function fib(n) {
  if(n == 0 || n == 1) {
    return n
  } else {
    return fib(n - 1) + fib(n - 2)
  }
}

fib(6)
`


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
      const error = event.reason
      if(error.__ignore) {
        return
      }
      ui.set_status(error)
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

const on_window_load = w => {
  init_window_service_worker(w)
  exec(
    'run_code', 
    new Set(Object.getOwnPropertyNames(w))
  )
}


// By default run code in hidden iframe, until user explicitly opens visible
// window
let iframe
const open_app_iframe = (state) => {
  iframe = document.createElement('iframe')
  iframe.src = get_html_url(state)
  iframe.setAttribute('hidden', '')
  document.body.appendChild(iframe)
  // for app_window, do not set unhandled rejection, because having rejected
  // promises in user code is normal condition
  set_error_handler(iframe.contentWindow, false)
  globalThis.app_window = iframe.contentWindow
  init_app_window(globalThis.app_window)
}

// Open another browser window so user can interact with application
// TODO test in another browsers
export const open_app_window = state => {
  // TODO set_error_handler? Or we dont need to set_error_handler for child
  // window because error is always caught by parent window handler?
  exec('open_app_window')
  globalThis.app_window.close()
  globalThis.app_window = open(get_html_url(state))
  init_app_window(globalThis.app_window)
}

const init_app_window = w => {

  const is_loaded = () => {
    const nav = w.performance.getEntriesByType("navigation")[0]
    return nav != null && nav.loadEventEnd > 0
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
      on_window_load(w)
    } else {
      w.addEventListener('load', () => {
        add_unload_handler()
        // Wait until `load` event before executing code, because service worker that
        // is responsible for loading external modules seems not working until `load`
        // event fired.  TODO: better register SW explicitly and don't rely on
        // already registered SW?
        on_window_load(w)
      })
    }
  }

  const add_unload_handler = () => {
    w.addEventListener('unload', (e) => {
      // Set timeout to 100ms because it takes some time for page to get closed
      // after triggering 'unload' event
      setTimeout(() => {
        if(w.closed && w == globalThis.app_window) {
          // If by that time w.closed was set to true, then page was
          // closed. Get back to using iframe
          globalThis.app_window = iframe.contentWindow
          reload_app_window()
        } else {
          add_load_handler()
        }
      }, 100)
    })
  }

  add_load_handler()
}

export const reload_app_window = (state = get_state()) => {
  // after window location reload, `run_code` command will be fired.
  globalThis.app_window.location = get_html_url(state)
}

const get_entrypoint_settings = () => {
  return {
    current_module: localStorage.current_module ?? '',
    entrypoint: localStorage.entrypoint ?? '',
    html_file: localStorage.html_file ?? '',
  }
}

export const exec_and_reload_app_window = (...exec_args) => {
  exec(...exec_args)
  reload_app_window()
}

export const open_directory = () => {
  if(globalThis.showDirectoryPicker == null) {
    throw new Error('Your browser is not supporting File System Access API')
  }
  open_dir(true).then(dir => {
    exec_and_reload_app_window('load_dir', dir, true, get_entrypoint_settings())
  })
}

export const close_directory = async () => {
  close_dir()
  exec_and_reload_app_window('load_dir', await examples_dir_promise, false, get_entrypoint_settings())
}


let COMMANDS
let ui
let state

export const init = async (container, _COMMANDS) => {
  COMMANDS = _COMMANDS

  set_error_handler(window)

  let files = {'': localStorage.code || EXAMPLE}
  let initial_state, entrypoint_settings
  const project_dir = await open_dir(false)
  let example
  if(project_dir == null) {
    /*
      extract example_id from URL params and delete it (because we dont want to
      persist in on refresh)
    */
    const params = new URLSearchParams(window.location.search)
    const example_path = params.get('example')
    const nextURL = new URL(window.location)
    nextURL.searchParams.delete('example')
    history.replaceState(null, null, nextURL.href)

    example = examples.find(e => e.path == example_path)

    if(example == null) {
      const shared_code = await get_share()
      if(shared_code == null) {
        entrypoint_settings = get_entrypoint_settings()
      } else {
        files = {'': shared_code}
        entrypoint_settings = {
          current_module: '',
          entrypoint: '',
        }
      }
    } else {
      entrypoint_settings = {
        current_module: example.entrypoint,
        entrypoint: example.entrypoint,
      }
    }

    initial_state = {
      project_dir: await examples_dir_promise,
      files,
      has_file_system_access: false,
    }
  } else {
    entrypoint_settings = get_entrypoint_settings()
    initial_state = {
      project_dir,
      files,
      has_file_system_access: true,
    }
  }

  state = COMMANDS.get_initial_state(
    {
      ...initial_state, 
      on_deferred_call: (...args) => exec('on_deferred_call', ...args)
    },
    entrypoint_settings,
  )

  // Expose state for debugging
  globalThis.__state = state
  ui = new UI(container, state)
  // Expose for debugging
  globalThis.__ui = ui

  render_initial_state(ui, state, example)

  open_app_iframe(state)
}

export const get_state = () => state

export const with_code_execution = (action, state = get_state()) => {
  /*
    supress is_recording_deferred_calls while rendering, because rendering may
    call toJSON(), which can call trigger deferred call (see lodash.js lazy
    chaining)
  */
  if(state.rt_cxt != null) {
    state.rt_cxt.is_recording_deferred_calls = false
    state.rt_cxt.skip_save_ct_node_for_path = true
  }

  try {
    return action()
  } finally {
    if(state.rt_cxt != null) {
      state.rt_cxt.is_recording_deferred_calls = true
      state.rt_cxt.skip_save_ct_node_for_path = false
    }
  }
}

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


  // Wrap with_code_execution, because rendering values can trigger execution
  // of code by toString() and toJSON() methods

  with_code_execution(() => {
    apply_side_effects(state, nextstate, ui, cmd)

    if(effects != null) {
      (Array.isArray(effects) ? effects : [effects]).forEach(e => {
        if(e.type == 'write' || e.type == 'save_to_localstorage') {
          // do not spam to console
          console.log('apply effect', e.type)
        } else {
          console.log('apply effect', e.type, ...(e.args ?? []))
        }
        EFFECTS[e.type](nextstate, e.args, ui, state)
      })
    }
  }, nextstate)



  // Expose for debugging
  globalThis.__prev_state = state
  globalThis.__state = nextstate
  state = nextstate
}
