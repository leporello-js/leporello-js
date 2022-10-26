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

// Fake URL base prepended by code responsible for module loading
const FAKE_URL_BASE = 'https://leporello.import/'

self.addEventListener("fetch", event => {
  if(event.request.url.startsWith(FAKE_URL_BASE)) {
    if(dir_handle != null) {
      const headers = new Headers([
        ['Content-Type', 'text/javascript']
      ])
      const path = event.request.url.replace(FAKE_URL_BASE, '')
      const response = read_file(dir_handle, path).then(file => 
        new Response(file, {headers})
      )
      event.respondWith(response)
    }
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
