const x = async () => 1

const trace = fn => {
  try {
    const value = fn()
    if(value instanceof Promise) {
      return value
        .then(v => {
          value.status = {ok: true, value: v}
          return v
        })
        .catch(e => {
          value.status = {ok: false, error: e}
          throw e
        })
    } else {
      return value
    }
  } catch(e) {

  } finally {
  }
}

//trace(x)

//const c = () => {
//  return Promise.reject(1)
//}
//
//const b = () => {
//    return c()
//      .then(value => {
//        console.log('v', value)
//        return value
//      })
//      .catch(e => {
//        console.log('e')
//        throw e
//      })
//}
//
//
//try {
//  console.log(b()/*.catch(x => 1)*/)
//} catch(e) {
//  console.log('error', e)
//}

const throws_p = () => {throw Promise.reject('err')}


try {
  await throws_p()
} catch(e) {
  console.log('e', e)
  try {
    await e
  } catch(e2) {

    console.log('e2', e2)
  }
}
