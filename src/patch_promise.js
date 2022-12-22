export const patch_promise = window => {

  if(window.Promise.__patched) {
    // already patched
    return
  }

  const _then = Promise.prototype.then

  Promise.prototype.then = function then(on_resolve, on_reject) {
    let children = window.get_children()
    if(children == null) {
      children = []
      window.set_children(children)
    }

    const make_callback = cb => cb == null
      ? null
      : value => {
          const current = window.get_children()
          window.set_children(children)
          try {
            return cb(value)
          } finally {
            window.set_children(current)
          }
        }

    return _then.call(
      this,
      make_callback(on_resolve),
      make_callback(on_reject),
    )
  }

  window.Promise.__patched = true
}
