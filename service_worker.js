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

let data

self.addEventListener('message', async function(e) {
  const msg = e.data
  let reply
  if(msg.type == 'SET') {
    data = msg.data
    reply = null
  } else if(msg.type == 'GET') {
    reply = data
  } else {
    throw new Error('unknown message type: ' + msg.type)
  }
  e.ports[0].postMessage(reply)
})
