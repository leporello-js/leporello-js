// code is borrowed from 
// https://googlechrome.github.io/samples/service-worker/post-message/
const send_message = (message) => {
  return new Promise(function(resolve) {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = function(event) {
      resolve(event.data)
    };
    if(navigator.serviceWorker.controller == null) {
      // Service worker will be available after reload
      window.location.reload()
    }
    navigator.serviceWorker.controller.postMessage(message,
      [messageChannel.port2]);
  });
}

globalThis.clear_directory_handle = () => {
  send_message({type: 'SET', data: null})
  window.location.reload()
}

let dir_handle

const request_directory_handle = async () => {
  dir_handle = await globalThis.showDirectoryPicker()
  await send_message({type: 'SET', data: dir_handle})
  return dir_handle
}

export const load_persisted_directory_handle = () => {
  return navigator.serviceWorker.register('service_worker.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => send_message({type: 'GET'}))
    .then(async h => {
      if(h == null || (await h.queryPermission()) != 'granted') {
        return null
      } 
      // test if directory handle is valid
      try {
        await h.entries().next()
      } catch(e) {
        return null
      }
      dir_handle = h
      return dir_handle
    })
}

const file_handle = async (dir_handle, filename, is_directory = false, options) => {
  if(typeof(filename) == 'string') {
    filename = filename.split('/')
  }
  const [first, ...rest] = filename
  if(rest.length == 0) {
    return is_directory 
      ? await dir_handle.getDirectoryHandle(first, options)
      : await dir_handle.getFileHandle(first, options)
  } else {
    const nested_dir_handle = await dir_handle.getDirectoryHandle(first)
    return file_handle(nested_dir_handle, rest, is_directory, options)
  }
}

export const write_file = async (name, contents) => {
  const f_hanlde = await file_handle(dir_handle, name)
  // Create a FileSystemWritableFileStream to write to.
  const writable = await f_hanlde.createWritable()
  // Write the contents of the file to the stream.
  await writable.write(contents)
  // Close the file and write the contents to disk.
  await writable.close()
}

// Blacklist hidden dirs and node_modules
const is_blacklisted = h => h.name == 'node_modules' || h.name.startsWith('.')

const read_file = async handle => {
  const file_data = await handle.getFile()
  return await file_data.text()
}

const do_load_dir = async (handle, path) => {
  if(handle.kind == 'directory') {
    const children = []
    for await (let [name, h] of handle) {
      if(!is_blacklisted(h)) {
        children.push(h)
      }
    }
    return {
      name: handle.name, 
      path,
      kind: 'directory',
      children: (await Promise.all(
          children.map(c => 
            do_load_dir(c, path == null ? c.name : path + '/' + c.name)
          )
        )).sort((a, b) => a.name.localeCompare(b.name))
    }
  } else if(handle.kind == 'file') {
    return {
      name: handle.name, 
      path,
      kind: 'file', 
      contents: await read_file(handle)
    }
  } else {
    throw new Error('unknown kind')
  }
}

export const create_file = (path, is_dir) => {
  return file_handle(
    dir_handle, 
    path,
    is_dir, 
    {create: true}
  )
}

export const load_dir = async (should_request_access) => {
  let handle
  if(should_request_access) {
    handle = await request_directory_handle()
  } else {
    handle = await load_persisted_directory_handle()
    if(handle == null) {
      return null
    }
  }
  return do_load_dir(handle, null)
}
