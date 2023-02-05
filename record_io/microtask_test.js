console.log('start')

let r
const x = new Promise(resolve => r = resolve).then(() => {console.log('resolved')})

console.log('before resolve')
r()
console.log('after resolve')
/*
console.log('start')

Promise.resolve().then(() => {
  console.log('1')
  Promise.resolve().then(() => {
    console.log('2')
  })
})

console.log('end')
Promise.resolve().then(() => {
  console.log('3')
  Promise.resolve().then(() => {
    console.log('4')
  })
})
*/
