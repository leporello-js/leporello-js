/*
  Loads Leporello then runs tests inside Leporello.
  Benchmarks how fast test suite is executed inside leporello
*/

import fs from 'fs'
import * as pathlib from 'path'
import {COMMANDS} from '../src/cmd.js'
import {root_calltree_node} from '../src/calltree.js'
import { assert_equal, test_initial_state, } from './utils.js'
import {tests} from './test.js'

// Should work same as src/filesystem.js:load_dir
const load_dir = path => {
  const kind = fs.statSync(path).isDirectory() ? 'directory' : 'file'

  const props = {
    path,
    name: pathlib.basename(path),
    kind,
  }

  if(kind == 'file') {
    return  {...props, contents: fs.readFileSync(path, 'utf8')}
  } else {
    return {
      ...props, 
      children: fs.readdirSync(path)
        .filter(f => !f.startsWith('.'))
        .map(file => 
          load_dir(pathlib.join(path, file))
        )
    }
  }
}

// Convert path to modules relative to '.' into path relative to this file
const adjust_path = path => {
  return pathlib.join(
    pathlib.relative(
      pathlib.dirname(import.meta.url.replace('file://', '')),
      pathlib.resolve('.'), 
    ),
    path
  )
}

const load_external_modules = async state => {
  const urls = state.loading_external_imports_state.external_imports
  const results = await Promise.all(
    urls.map(u => import(adjust_path(u)))
  )
  return Object.fromEntries(
    results.map((module, i) => (
      [
        urls[i],
        {
          ok: true,
          module,
        }
      ]
    ))
  )
}

const dir = load_dir('.')

console.time('run')

const i = test_initial_state(
  {}, // files
  {project_dir: dir, entrypoint: 'test/run.js'}
)

assert_equal(i.loading_external_imports_state != null, true)
const external_imports = await load_external_modules(i)
const loaded = COMMANDS.external_imports_loaded(i, i, external_imports)

assert_equal(loaded.eval_modules_state != null, true)
const s = loaded.eval_modules_state
const result = await s.promise
const state = COMMANDS.eval_modules_finished(loaded, loaded, result, s.node, s.toplevel)
const root = root_calltree_node(state)
const run = root.children[0]

assert_equal(root_calltree_node(state).ok, true)

// Assert that run children are tests
assert_equal(run.children.length, tests.length)

console.timeEnd('run')
