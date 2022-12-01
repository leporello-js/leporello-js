/*
const delay = new Promise(resolve => {
  setTimeout(resolve, 1000)
})
await delay
console.log('x')
export const x = 1
*/

const p = {then: y => y(3)}

async function test() {
  return await p
}

  // TODO remove
  //const x = new Promise((resolve, reject) => resolve(10))
  //const x = Promise.reject(10)
  //const x = Promise.resolve(10)
  //console.log('x', x.status)
  //x.catch(e => {
  //  console.log('x', x.status)
  //})
  //const x = new Promise((resolve, reject) => setTimeout(() => resolve(10), 1000))
  //console.log('x', x.status)
  //x.then(() => {
  //  console.log('x', x.status)
  //})
console.log(await test())
