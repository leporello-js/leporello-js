/*
function f() {
  console.log('n', new.target)
}

f()
new f()
*/

const f = new Function(`
  return arguments.length
`)


console.log(f(1,2,3))
console.log(f(1,2,3,4))
