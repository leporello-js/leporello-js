//let value = Promise.reject(1)

/*
value.then(
  () => console.log('res'),
  () => console.log('rej'),
)
*/


/*
const original_value = value

value = new Promise((resolve, reject) => {
  globalThis.setTimeout(
    () => {
      console.log('timeout')
      original_value.then(resolve, reject)
    },
    1000
  )
})

try {
  console.log(await value)
} catch(e) {
  console.log('ERROR', e)
}
*/

const t = globalThis.setTimeout

t(() => console.log('timeout'), 100)
