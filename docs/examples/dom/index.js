Object.assign(globalThis.document.body, {innerHTML: `
  Index:
  <input type='number' id='i'>
  <br>
  Fibonacci number:
  <span id='result'></span>
`})

const fib = (i) => {
  return i*10
}

globalThis.document.getElementById('i').addEventListener('change', e => {
  Object.assign(globalThis.result, {innerText: fib(e.target.value)})
})