# Leporello.js

Leporello.js is live coding IDE for pure functional subset of javascript. It provides novel debugging experience

## **[Try online](https://leporello-js.github.io/leporello-js/)**

## Features

- Mutating values is not allowed

![Mutating](docs/images/mutation.png)

- All values are immutable. You create new values by applying change to old values

![Immutable](docs/images/immutable.png)

- Functional programs are trees of expressions that map values to other values,
  rather than a sequence of imperative statements which update the running
  state of the program. Because data is never mutated, you can jump to any
  point in execution of your program 

![Navigation](docs/images/nav.gif)

- and inspect any intermediate values

![Inspect](docs/images/inspect.gif)

- Expressions that were evaluated have blue background. And that were not reached
have white background.

![Background](docs/images/background.png)

- Expressions that throw errors are red

![Errors](docs/images/error.png)

- When you put cursor inside function, the first call of this function is found

![Follow cursor](docs/images/follow_cursor.gif)

- You can edit this function and immediately see result

![Live coding](docs/images/edit.gif)

- Console logs are collected and displayed in a separate view. When you click
  the log you get into debugger to the call of `console.log` or
  `console.error`.  You can go back and forth like in a time machine.

![Logs](docs/images/logs.gif)

- Leporello is (mostly) self-hosted, i.e. built in itself

![Self-hosted](docs/images/self-hosted.png)


## Supported javascript subset

Variables are declared by `const` declaration. `var` is not supported. `let` variables can be declared to be assigned later, for cases when value depends on condition. Example:
```
let result
if (n == 0 || n == 1) {
  result = n
} else {
  result = fib(n - 1) + fib(n - 2)
}
```

Currenlty only one declaration for single `const` statement is supported (TODO).

Any kind of loops are not supported. Use recursion or array functions instead.

`if` / `else` can only contain blocks, not single statements (TODO).

Functions can be declared only by arrow function syntax. `function` keyword and method definitions (like `const foo = { bar() { /* body */ } }` may be supported in future. Both concise and block body are supported.

Classes are not supported. Some sort of immutable classes may be supported in future. `this` keyword is not currently supported. `new` operator is supported for instantiating builtin classes.

`switch` statements will be supported in future.

`try`, `catch` and `finally` will be supported in future. `throw` is currently supported.

ES6 modules are suppoted. Default exports are not currently supported, only named exports. Circular module dependencies are not supported (currently they crash IDE (TODO)). Import/export aliases are not supported. Exporting `let` variables is not supported. `import.meta` is not supported.

Generators are not supported.

Async/await will be supported in future.

Destructuring is mostly supported.

Some operators are not currently supported:
  - Unary negation, unary plus
  - Bitwise operators
  - `in`, `instanceof`
  - `void`
  - comma operator

Operators that are not supported by design (not pure functional):
  - increment, decrement
  - `delete`

## Importing third-party libs

Sometimes you want to import third party library that uses imperative language constructs. You may want to use it to perform side-effects or maybe it mutates data inside but still provides functional interface (does not mutate function arguments). Good example of such library is [bignumber.js](https://github.com/MikeMcl/bignumber.js/) - it makes a lot of mutating assignments inside, but `BigNumber` instances are immutable.

To use `bignumber.js` you add an `external pragma` before the import:

```
/* external */
import BigNumber from './path/to/bignumber.mjs';
```

`external pragma` is just a comment that contains only the literal string `external` (both styles for comments and extra whitespaces are allowed). Now the module is imported as a black box - you cannot debug `BigNumber` methods.

![External import](docs/images/external_import.png)

Currently every external is loaded once and cached until Leporello is restarted (TODO what happens if we load modules in iframe and then recreate iframe)

## Hotkeys

See built-in Help

## Editing local files

Editing local files is possible via [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API). Click "Allow access to local project folder" to grant access to local directory.


## Run Leporello locally
To run it locally, you need to clone repo to local folder and serve it via HTTPS protocol (HTTPS is required by [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)). See [How to use HTTPS for local development](https://web.dev/how-to-use-local-https/)

## Running test suite
run tests in node.js:

```
node test/run.js
```

run tests in leporello itself:

![Tests](docs/images/test.png)

- grant local folder access
- select `test/run.js` as entrypoint


## Roadmap

* Support async/await and calling impure (performing IO) functions
* Use production level JS parser, probably typescript parser (so it will be
  possible to program in pure functional subset of typescript)
* Implement VSCode plugin
