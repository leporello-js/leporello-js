const PROJECT_ID = 'leporello-js'
const URL_BASE = `https://firebasestorage.googleapis.com/v0/b/${PROJECT_ID}.appspot.com/o/`

// see https://stackoverflow.com/a/48161723/795038
async function sha256(message) {
    // encode as UTF-8
    const msgBuffer = new TextEncoder().encode(message);                    

    // hash the message
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);

    // convert ArrayBuffer to Array
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    // convert bytes to hex string                  
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

async function upload_share(text) {
  const id = (await sha256(text))
    // Truncate to 20 bytes, like in git
    .slice(0, 40)
  const blob = new Blob([text], { type: 'text/plain' })
  const formData = new FormData()
  formData.append('file', blob)
  const response = await fetch(URL_BASE + id, {
    method: 'POST',
    body: formData
  })
  if(!response.ok) {
    const json = await response.json()
    const message = json?.error?.message
    throw new Error('Failed to upload: ' + message)
  }
  return id
}

async function download_share(id) {
  const response = await fetch(URL_BASE + id + '?alt=media')
  if(!response.ok) {
    const json = await response.json()
    const message = json?.error?.message
    throw new Error('Failed to fetch: ' + message)
  }
  return response.text()
}

export async function get_share() {
  const params = new URLSearchParams(window.location.search)
  const share_id = params.get('share_id')
  if(share_id == null) {
    return null
  }

  const shared_code = localStorage['share_' + share_id]
  if(shared_code != null) {
    return shared_code
  }

  try {
    return await download_share(share_id)
  } catch(e) {
    alert(e.message)
    return null
  }
}

export async function save_share(text) {
  const share_id = await upload_share(text)
  const nextURL = new URL(window.location)
  nextURL.searchParams.set('share_id', share_id)
  history.replaceState(null, null, nextURL.href)
}
