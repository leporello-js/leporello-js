/*
  For node.js tests

  It forces node.js to load Response (which is loaded lazily)

  Without this, `Response` loading code would be executed in record_io.js and
  break test by calling `now()`
*/
globalThis.Response

if(globalThis.process != null) {
  globalThis.NodeVM = await import('node:vm')
}

let iframe

export function create_app_window() {
  if(globalThis.process != null) {
    // We are in node.js
    // `NodeVM` was preloaded earlier

    const context = globalThis.NodeVM.createContext({

      process,

      // for some reason URL is not available inside VM
      URL,

      console,
      setTimeout,
      // break fetch because we dont want it to be accidentally called in unit test
      fetch: () => {
        console.error('Error! fetch called')
      },
    })
    const get_global_object = globalThis.NodeVM.compileFunction(
      'return this', 
      [], // args
      {parsingContext: context}
    )

    return get_global_object()

  } else {
    // We are in browser
    if(iframe != null) {
      globalThis.document.body.removeChild(iframe)
    }
    iframe = globalThis.document.createElement('iframe')
    document.body.appendChild(iframe)
    return iframe.contentWindow
  }
}

