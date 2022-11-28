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
  if(msg.type == 'SET') {
    dir_handle = msg.data
    reply = null
  } else if(msg.type == 'GET') {
    reply = dir_handle
  } else {
    throw new Error('unknown message type: ' + msg.type)
  }
  e.ports[0].postMessage(reply)
})

// Fake directory, http requests to this directory intercepted by service_worker
const FILES_ROOT = '__leporello_files'

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url)
  if(url.pathname.startsWith('/' + FILES_ROOT)) {
    const path = url.pathname.replace('/' + FILES_ROOT + '/', '')

    let file

    if(path == '__leporello_blank.html') {
      file = Promise.resolve('')
    } else if(dir_handle != null) {
      file = read_file(dir_handle, path)
    } else {
      // Delegate request to browser
      return
    }

    const headers = new Headers([
      [
        'Content-Type', 
        path.endsWith('.js') || path.endsWith('.mjs')
          ? 'text/javascript'
          : 'text/html'
      ]
    ])

    const response = file.then(file => 
      new Response(file, {headers})
    )
    event.respondWith(response)
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
