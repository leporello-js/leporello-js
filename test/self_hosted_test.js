import fs from 'fs'

import {load_modules} from '../src/parse_js.js'
import {eval_modules, eval_frame} from '../src/eval.js'

import {
  assert_equal, 
  run, 
  stringify, 
  test, 
} from './utils.js'

const entry = `
  import {parse, load_modules} from './src/parse_js.js';

  import {get_initial_state} from './src/cmd.js';
  //console.time('p');
  //const parsed = parse(globalThis.module_cache['./src/parse_js.js']);
  //console.timeEnd('p');
  //const parsed = parse('1');

  const loader = module => globalThis.module_cache[module];
  console.time('p2');
  load_modules('src/parse_js.js', (m) => {
    return loader(m)

  });
  console.timeEnd('p2')
  //import {} from './test/test.js'
`

globalThis.module_cache = {}

const load_module = (dir, module) => {
  return (globalThis.module_cache[module] = fs.readFileSync(dir + module, 'utf8'))
}
const loader = module => {
  return module == ''
    ? entry
    : load_module('./', module)
}

run([
  test('self-hosted', () => {
    //console.time('p0')
    const parsed = load_modules('', loader)
    //log('cache', Object.keys(globalThis.module_cache))
    //console.log('p', parsed)
    //console.timeEnd('p0')
    if(!parsed.ok) {
      const p = parsed.problems[0]
      console.error('FAIL', p.index, p.message, p.module)
      console.log(loader(p.module).slice(p.index, p.index + 100))
    } else {
      assert_equal(parsed.ok, true)
      console.time('eval')
      const result = eval_modules(parsed.modules, parsed.sorted).calltree
      console.timeEnd('eval')

      /* TODO remove

      const count_nodes = node => node.children == null
        ? 1
        : 1 + node.children.reduce(
            (total, c) => total + count_nodes(c),
            0,
          )
      console.log(
        Object.entries(result)
          .map(([k,v]) => count_nodes(v.calls))
          .reduce((total, c) => total +c)
      )
      */
      ///const frame = eval_frame(result[''].calls, result)
      ///log('f', frame.children[frame.children.length - 1])
      ///assert_equal(
      ///  frame.children[frame.children.length - 1].result.value.value,
      ///  1
      ///)
    }
  })
])
