export const patch_promise = window => {

  if(window.Promise.Original != null) {
    // already patched
    return
  }

  class PromiseWithStatus extends Promise {
    constructor(fn) {
      let status 
      let is_constructor_finished = false
      const p = new Promise.Original(
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

  PromiseWithStatus.Original = Promise

  window.Promise = PromiseWithStatus
}
