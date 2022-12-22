export const patch_promise = window => {

  if(window.Promise.Original != null) {
    // already patched
    return
  }

  class PromiseRecordChildren extends Promise {
    then(on_resolve, on_reject) {
      let children = window.get_children()
      if(children == null) {
        children = []
        window.set_children(children)
      }
      return super.then(
        on_resolve == null
          ? null
          : value => {
              window.set_children(children)
              return on_resolve(value)
            },

        on_reject == null
          ? null
          : error => {
            window.set_children(children)
            return on_reject(error)
          }
      )
    }
  }

  class PromiseWithStatus extends window.Promise {
    constructor(fn) {
      let status 
      let is_constructor_finished = false
      const p = new PromiseRecordChildren(
        (resolve, reject) => {
          fn(
            (value) => {
              if(value instanceof window.Promise.Original) {
                value
                  .then(v => {
                    p.status = {ok: true, value: v}
                    resolve(v)
                  })
                  .catch(e => {
                    p.status = {ok: false, error: e}
                    reject(e)
                  })
              } else {
                status = {ok: true, value}
                if(is_constructor_finished) {
                  p.status = status
                }
                resolve(value)
              }
            },
            (error) => {
              status = {ok: false, error}
              if(is_constructor_finished) {
                p.status = status
              }
              reject(error)
            },
          )
        }
      )
      is_constructor_finished = true
      p.status = status
      return p
    }
  }

  PromiseWithStatus.Original = window.Promise

  window.Promise = PromiseWithStatus
}
