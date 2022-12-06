export const patch_promise = window => {

  if(window.Promise.Original != null) {
    // already patched
    return
  }

  class PromiseWithStatus extends Promise {
    constructor(fn) {
      let status 
      let is_constructor_finished = false
      super(
        (resolve, reject) => {
          fn(
            (value) => {
              status = {ok: true, value}
              if(is_constructor_finished) {
                this.status = status
              }
              resolve(value)
            },
            (error) => {
              status = {ok: false, error}
              if(is_constructor_finished) {
                this.status = status
              }
              reject(error)
            },
          )
        }
      )
      is_constructor_finished = true
      this.status = status
    }
  }

  PromiseWithStatus.Original = Promise

  window.Promise = PromiseWithStatus
}
