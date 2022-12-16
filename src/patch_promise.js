export const patch_promise = window => {
  
  if(window.Promise.Original != null) {
    // already patched
    return
  }

  class PromiseWithStatus extends Promise {
    constructor(fn) {
      const p = new Promise.Original((resolve, reject) => {
        fn(
          (value) => {
            if(value instanceof window.Promise) {
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
              p.status = {ok: true, value}
              resolve(value)
            }
          },
          (error) => {
            p.status = {ok: false, error}
            reject(error)
          },
        )
      })

      return p
    }
  }

  PromiseWithStatus.Original = Promise

  window.Promise = PromiseWithStatus
}
