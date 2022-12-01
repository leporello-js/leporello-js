export const unwrap_settled_promises = calltree => {
  let is_finished = false

  const unwrap = call => {
    // TODO use run_window.Promise

    if(!call.ok) {
      return
    }

    if(call.value instanceof Promise) {
      call.value
        .then(value => {
          if(is_finished) {
            return
          }
          call.unwrapped_value = {ok: true, value}
        })
        .catch(error => {
          if(is_finished) {
            return
          }
          call.unwrapped_value = {ok: false, error}
        })
    }
  }

  const unwrap_tree = call => {
    unwrap(call)
    if(call.children != null) {
      for(let c of call.children) {
        unwrap(c)
      }
    }
  }

  unwrap_tree(calltree)

  return Promise.resolve().then(() => {
    is_finished = true
    return calltree
  })
}

/*
const delay = new Promise(resolve => setTimeout(() => resolve('123'), 1000))

const tree = {
  value: Promise.resolve('resolved'),
  ok: true,
  children: [
    {value: delay, ok: true}
  ]
}

await unwrap_settled_promises(tree)
console.log('tree', tree)
*/

