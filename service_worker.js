/*
Should prevent navigator.serviceWorker.controller from being null on first load, but doesn't work for some reason.
TODO: compare with
https://googlechrome.github.io/samples/service-worker/post-message/
which seems to work on first load

self.addEventListener('install', function(event) {
  //event.waitUntil(self.skipWaiting()); // Activate worker immediately
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim()); // Become available to all pages
});
*/

let dir_handle

self.addEventListener('message', async function(e) {
  const msg = e.data
  let reply
  if(msg.type == 'SET_DIR_HANDLE') {
    dir_handle = msg.data
    reply = null
  } else if(msg.type == 'GET_DIR_HANDLE') {
    reply = dir_handle
  } else {
    throw new Error('unknown message type: ' + msg.type)
  }
  e.ports[0].postMessage(reply)
})

const send_message = (client, message) => {
  return new Promise(function(resolve) {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = function(event) {
      resolve(event.data)
    };
    client.postMessage(message,
      [messageChannel.port2]);
  });
}

// Fake directory, http requests to this directory intercepted by service_worker
const FILES_ROOT = new URL('.', globalThis.location).pathname + '__leporello_files/'

const serve_response_from_dir = async event => {
  const url = new URL(event.request.url)
  const path = url.pathname.replace(FILES_ROOT, '')

  let file

  if(path == '__leporello_blank.html') {
    file = '<!doctype html>'
  } else if(dir_handle != null) {
    file = await read_file(dir_handle, path)
  } else {
    let client = await self.clients.get(event.clientId)

    if(client == null) {
      // Try to find main window and get dir_handle from it
      for(const c of await self.clients.matchAll()) {
        if(new URL(c.url).pathname == '/') {
          client = c
        }
      }
    }


    // client is null for app_window initial page load, and is app_window for
    // js scripts
    if(client == null) {
      // User probably reloaded app_window by manually hitting F5 after IDE
      // window was closed
      return new Response("", {status: 404})
    } else {
      dir_handle = await send_message(client, {type: 'GET_DIR_HANDLE'})
      if(dir_handle == null) {
        return new Response("", {status: 404})
      } else {
        file = await read_file(dir_handle, path)
      }
    }
  }

  const headers = new Headers([
    [
      'Content-Type', 
      path.endsWith('.js') || path.endsWith('.mjs')
        ? 'text/javascript'
        : 'text/html'
    ]
  ])

  return new Response(file, {headers})
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url)

  if(url.pathname.startsWith(FILES_ROOT)) {
    event.respondWith(serve_response_from_dir(event))
  }
})

const read_file = async (dir_handle, filename) => {
  if(typeof(filename) == 'string') {
    filename = filename.split('/')
  }
  const [first, ...rest] = filename
  if(rest.length == 0) {
    const fhandle = await dir_handle.getFileHandle(first)
    const file_data = await fhandle.getFile()
    return await file_data.text()
  } else {
    const nested_dir_handle = await dir_handle.getDirectoryHandle(first)
    return read_file(nested_dir_handle, rest)
  }
}
