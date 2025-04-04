# Leporello.js

Leporello.js is a next-level online JavaScript and TypeScript debugger and REPL

[<img src="docs/images/video_cover.png" width="600px">](https://vimeo.com/845773267)

## **[Website](https://leporello.tech)**
## **[Try online](https://app.leporello.tech)**

## Leporello.js is funded solely by your donations

Support us on [Github Sponsors](https://github.com/sponsors/leporello-js) and be the first to gain access to the Leporello.js Visual Studio Code plugin with TypeScript support.

## Features

### Going beyond the REPL
Your code is executed instantly as you type, with the results displayed next to it. No need to set breakpoints for debugging. Just move the cursor to any line and see what's happening.

### Next level debugging capabilities
Visualise and navigate a dynamic call graph of your program in a time-travel manner.

### Develop HTML5 apps interactively
Modify your code and instantly see the updated version without losing the application state. Interact with your app and debug it later, similar to using a time machine.

### Save time when working on IO-heavy programs
IO operations are traced and transparently replayed on subsequent program executions.

### Self-hosted
Leporello.js source code is developed within Leporello.js itself

## Unsupported JavaScript/Typescript features:

Some JavaScript/TypeScript language constructs are not supported, but they will be supported in future:

- Classes
- C-style for loop
- `try` statement
- `switch` statement
- Generator functions

## IO

To enhance the interactive experience, Leporello.js traces the calls made to IO functions within your application. This trace can be replayed later, enabling you to program iteratively by making incremental changes to your code and promptly receiving feedback.

The current list of built-in functions for which calls are traced includes:
- `Date`
- `Math.random()`
- `fetch`
- `Response` methods:
    - `arrayBuffer`
    - `blob`
    - `formData`
    - `json`
    - `text`
- `setTimeout`
- `clearTimeout`

Leporello.js follows this process to manage IO calls:
- Initially, when the code is run, Leporello.js traces all IO calls, storing arguments and return values in an array as a trace.
- Whenever you edit your code, Leporello.js attempts to execute it, using the results of IO calls from the trace (replay).
- During replay, when an IO call is made, Leporello.js compares the current call to the traced call in the array. It checks if the function and arguments are the same. If they match, Leporello.js returns the result from the trace.
- To compare arguments for equality, Leporello.js uses deep equality comparison with `JSON.stringify`.
- If they do not match, the trace is discarded, and Leporello.js executes the code again, this time without the trace. This process populates a new trace array.

Additionally, there are options to manually discard the trace, including a button and a hotkey for this purpose.

## Hotkeys

See built-in Help

## Editing local files

Editing local files is possible via [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API). Click "Allow access to local project folder" to grant access to local directory.

## Selecting entrypoint module

After you granted local filesystem access you can select which javascript file
to run. See the following picture

![Entrypoint module](docs/images/entrypoint.png)

## Selecting html file

By default code in run in context of empty HTML file. If you want to use custom
HTML files with third party scripts or CSS stylesheets, you should choose HTML
file:

![HTML file](docs/images/html_file.png)

In typical HTML5 app you add to your html file a `script` element pointing to
your entry js module, like this:

```html
<script type='module' src='index.js'></script>
```

Because Leporello has built in bundler, you dont point to your entry module in
HTML file. Instead, you [select entrypoint module in
UI](#selecting-entrypoint-module).

If you want to use the same HTML file both for developing in Leporello.js and
in production, you can do it like this:

```html
<script type='module'>
  if(new URLSearchParams(window.location.search).get('leporello') == null) {
    import('./src/index.js');
  }
</script>
```

Leporello.js appends `?leporello` query parameter to your HTML file, so you can
test if HTML file is run in Leporello.js or in production.

You can add javascript libraries by including `script` tag to HTML file. If the library is exposing globals, they will be available in your javascript code after you select that HTML file as an entrypoint.


## Run and debug UI code in separate window

By default your code is run in invisible iframe. If you want to run and debug
UI code then you can open separate browser window. Click "(Re)open app window"
in statusbar or press corresponding hotkey. New browser window will be opened
and your code will be run in that window.

While you interacting with your app in separate browser tab, all function calls
are recorded. You can inspect and debug them.

To try live example, grant file system access to
[./docs/examples/preact](./docs/examples/preact) folder. Then select `index.js`
as an entrypoint and click "(Re)open app window". You will see the app where
you can calculate Fibonacci numbers:

![Entrypoint module](docs/images/fib_ui.png)

Try to click buttons and then get back to Leporello window. Now you can see
that all function calls have been recorded and you can inspect and debug
them:

![Deferred calls](docs/images/deferred_calls.png)

<!--You can even run and debug Leporello.js in Leporello.js! To do this:

- Check out Leporello.js repo and grant local filesystem access to root project directory
- Select `src/launch.js` as an entrypoint
- Select `index.html` as html file
- Click "(Re)open app window"

New instance of Leporello.js will be opened in new browser tab.

The only problem is that both instances of Leporello.js will share the same
localStorage. (TODO - inject localStorage implementation to opened window, that
allows to share localStorage between host Leporello.js instance and window
where code is run)
-->

## Saving state between page reloads

Leporello.js allows preserving the state of the application between page reloads. To achieve this, Leporello.js provides a special API:

```javascript
window.leporello.storage.get(key: string)
window.leporello.storage.set(key: string, value: any)
```

Values are cloned using [structuredClone](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone). Make sure they can be cloned using `structuredClone`.

The storage can be cleared using the "(Re)open app window" button.

You can try the online demo [here](https://app.leporello.tech/?example=todos-preact). Create TODO items, then edit the code, and you will observe that your TODOs are preserved.

The code for interacting with the Leporello API is in the file `app.js`. When `app.js` module initializes, it checks whether Leporello.js API is present and loads app state:

```javascript
let state

if(globalThis.leporello) {
  // Get initial state from Leporello storage
  state = globalThis.leporello.storage.get('state')
}
```

Later, when state changes, it saves it back to the storage:

```javascript
// on state change
if(globalThis.leporello) {
  // Save state to Leporello storage to load it after page reload
  globalThis.leporello.storage.set('state', state)
}
```

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
