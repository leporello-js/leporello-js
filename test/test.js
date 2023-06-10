import {find_leaf, ancestry, find_node} from '../src/ast_utils.js'
import {parse, print_debug_node} from '../src/parse_js.js'
import {eval_tree, eval_frame, eval_modules} from '../src/eval.js'
import {COMMANDS} from '../src/cmd.js'
import {
  root_calltree_node, 
  active_frame, 
  pp_calltree, 
  get_deferred_calls,
  current_cursor_position,
} from '../src/calltree.js'
import {color_file} from '../src/color.js'
import {
  test, 
  test_only,
  assert_equal, 
  stringify, 
  assert_code_evals_to, assert_code_evals_to_async,
  assert_code_error, assert_code_error_async,
  parse_modules,
  test_initial_state, test_initial_state_async,
  test_deferred_calls_state,
  print_debug_ct_node,
  command_input_async,
  patch_builtin,
  original_setTimeout,
} from './utils.js'

export const tests = [

  test('invalid token in the beginning', () => {
    const result = parse('# import')
    assert_equal(result, { 
      ok: false, 
      problems: [ { message: 'unexpected lexical token', index: 0 } ] 
    })
  }),

  test('invalid token in the middle', () => {
    const result = parse(': # import')
    assert_equal(result, { 
      ok: false, 
      problems: [ { message: 'unexpected lexical token', index: 2 } ] 
    })
  }),

  test('invalid token in the end', () => {
    const result = parse(': ^')
    assert_equal(result, { 
      ok: false, 
      problems: [ { message: 'unexpected lexical token', index: 2 } ] 
    })
  }),

  test('empty program', () => {
    const parse_result = parse('')
    assert_equal(parse_result.ok, true)
    const tree = eval_tree(parse_result.node)
    const frame = eval_frame(tree)
    assert_equal(frame.children, [])
    assert_equal(frame.result, {ok: true})
  }),
  
  test('empty if branch', () => {
    const r = parse(`
      if(true) {
      } else {
      }
    `)
    assert_equal(r.ok, true)
  }),

  test('Must be finished by eof', () => {
    const result = parse('}')
    assert_equal(result.ok, false)
  }),

  test('Only semicolons', () => {
    const parse_result = parse(';;;;')
    assert_equal(parse_result.ok, true)
    const tree = eval_tree(parse_result.node)
    const frame = eval_frame(tree)
    assert_equal(frame.children, [])
    assert_equal(frame.result, {ok: true})
  }),

  test('Comments', () => {
    assert_code_evals_to(`
      /*Qux

      */
      // Foo
      1 //Bar
      /* Baz */

      `,
      1
    )
  }),

  test('backtick_string', () => {
    assert_code_evals_to(
      'const x = `b`; `a${x}a`',
      'aba',
    )
  }),

  test('Simple expression', () => {
    return assert_code_evals_to('1+1;', 2)
  }),

  test('Logical not', () => {
    return assert_code_evals_to('!false', true)
  }),

  test('function expr', () => {
    assert_code_evals_to(
      `
        const x = function(){}
        x.name
      `,
      'x'
    )
    assert_code_evals_to(
      `
        const x = function foo(){}
        x.name
      `,
      'foo'
    )
    assert_code_evals_to(
      `
        (function foo(x) {
          return x*2
        }).name
      `,
      'foo'
    )
    assert_code_evals_to(
      `
        (function foo(x) {
          return x*2
        })(1)
      `,
      2
    )
  }),

  test('function declaration', () => {
    assert_code_evals_to(
      `
        function x() {return 1}
        x()
      `,
      1
    )
  }),

  test('More complex expression', () => {
    assert_code_evals_to(
      `
        const plusone = x => x + 1;
        plusone(3);
      `,
      4
    )
  }),

  test('closure', () => {
    const parsed = parse(
      `
        const x = 1
        const y = () => x;
        y()
      `
    )
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree.children[0])
    assert_equal(frame.children[1].result.value, 1)
  }),

  test('member access', () => {
    assert_code_evals_to(
      'const foo = {bar: {baz: 2}};foo.bar.baz;',
      2
    )
  }),

  test('optional chaining', () => {
    assert_code_evals_to(`null?.foo`, undefined)
    assert_code_evals_to(`{foo:1}?.foo`, 1)
  }),

  test('optional chaining computed', () => {
    assert_code_evals_to(`null?.['foo']`, undefined)
    assert_code_evals_to(`{foo: 1}?.['foo']`, 1)
  }),

  test('factorial', () => {
    assert_code_evals_to(
      `
      const fac = x => x == 0 ? 1 : x * fac(x - 1);
      fac(10);
      `,
      3628800
    )
  }),

  test('sort_1', () => {
    assert_code_evals_to(
      `
      const sort = x => x.length == 0 
      ? []
      : [
          ...sort(x.slice(1).filter(y => y < x[0])),
          x[0],
          ...sort(x.slice(1).filter(y => x[0] <= y)),
        ];
      sort([4, 7, 8, 9, 15, 1, 3, 2, 1]);
      `,
      [1, 1, 2, 3, 4, 7, 8, 9, 15]
    )
  }),

  test('sort_2', () => {
    assert_code_evals_to(
      `
      const sort = x => {
        return x.length == 0 
          ? []
          : [
              ...sort(x.slice(1).filter(y => y < x[0])),
              x[0],
              ...sort(x.slice(1).filter(y => x[0] <= y)),
            ]
      };
      sort([4, 7, 8, 9, 15, 1, 3, 2, 1]);
      `,
      [1, 1, 2, 3, 4, 7, 8, 9, 15]
    )
  }),

  test('chaining', () => {
    assert_code_evals_to(
      'const foo = () => ({bar: 42}); foo().bar;',
      42
    )
  }),

  test('logic ops', () => {
    assert_code_evals_to(
      `
        const foo = false;
        const bar = true;
        const baz = false;
        const foo2 = false;
        foo || bar && baz || (foo2);
      `,
      false
    )
  }),

  test('strict eq', () => {
    assert_code_evals_to(
      `null === undefined`,
      false
    )
  }),

  test('ternary', () => {
    assert_code_evals_to(`true ? 1 : 2;`, 1)
  }),

  test('nested ternary', () => {
    assert_code_evals_to(`false ? 0 : true ? 1 : 2`, 1)
  }),

  test('complex expression', () => {
    assert_code_evals_to('(x => 2*x)(({foo: 1}).foo + 2 + 3)*10;', 120)
  }),

  test('function_call spread', () => {
    assert_code_evals_to(
      `
        const test = (...args) => args[0] + args[1];
        const data = [1,2];
        const result = test(...data);
        result
      `,
      3
    )
  }),

  test('destructuring array', () => {
    assert_code_evals_to(
      `
        const [a,b=2,...c] = [1, undefined, 3,4];
        [a,b,...c];
      `,
      [1,2,3,4]
    )
  }),

  test('destructuring object', () => {
    assert_code_evals_to(
      `
        const {a, b: [b], ...c} = {a: 1, b: [2], c: 3, d: 4};
        [a,b,c];
      `,
      [1, 2, {c:3, d: 4}]
    )
  }),

  test('destructuring function arguments', () => {
    assert_code_evals_to(
      `
        const test = (first, ...others) => [first, others];
        test(1,2,3);
      `,
      [1, [2,3]]
    )
  }),

  test('else if', () => {
    const code = `
      let x
      if(false) {
        let x
        x = 0
      } else if(true) {
        x = 1
      } else {
        x = 2
      };
      x
    `
    const parse_result = parse(code)
    const assignment = find_leaf(
      parse_result.node,
      code.indexOf('x = 0')
    )
    assert_code_evals_to(
      code,
      1
    )
  }),

  test('if without else', () => {
    assert_code_evals_to(
      `
        let x
        if(true) {
          x = 1
        }
        if(false) {
          throw new Error()
        }
        x
      `,
      1
    )
  }),

  test('out of order decl', () => {
    const code = 
      `
        const y = () => x;
        const x = 1;
        y();
      `
    const parsed = parse(code)
    assert_equal(parsed.ok, true)
    const tree = eval_tree(parsed.node)
    assert_equal(tree.children[0].value, 1)
  }),

  test('nested closure', () => {
    const code = 
      `
        const x = () => () => y;
        x();
        const y = 1;
      `
    const parsed = parse(code)
    assert_equal(parsed.ok, true)
    const tree = eval_tree(parsed.node)
    assert_equal(tree.ok, true)
    // TODO assert
  }),

  test('Simple expression ASI', () => {
    return assert_code_evals_to('1+1', 2)
  }),

  test('Closing bracket ASI', () => {
    return assert_code_evals_to(
      `
        let x
        if(true) {
          x = 1
        } else {
          x = 2
        };
        x
      `,
      1
    )
  }),

  test('ASI_1', () => {
    const parse_result = parse(`
      1
      const y = 2;
    `)
    assert_equal(parse_result.ok, true)
    assert_equal(
      parse_result.node.children.map(c => c.type),
      ['number', 'const']
    )
  }),

  test('ASI_2', () => {
    const parse_result = parse(`
      1
      2
    `)
    assert_equal(parse_result.ok, true)
    assert_equal(
      parse_result.node.children.map(c => c.type),
      ['number', 'number']
    )
  }),

  test('ASI_restrited', () => {
    // Currently we forbid bare return statement, TODO
    assert_equal(
      parse(`
        return
        1
      `).ok,
      false
    )
    assert_equal(
      parse(`
        throw
        1
      `).ok,
      false
    )
  }),

  test('throw', () => {
    assert_code_error(`
        const x = () => { throw 1 };
        x()
      `, 
      1
    )
  }),

  test('throw null', () => {
    assert_code_error(`throw null`, null)
  }),

  test('throw null from function', () => {
    const code = `
      const throws = () => { throw null }
      throws()
    `
    const s = test_initial_state(code)
    const moved = COMMANDS.move_cursor(s, code.indexOf('throws()'))
    assert_equal(moved.value_explorer.result.ok, false)
    assert_equal(moved.value_explorer.result.error, null)
  }),

  test('new', () => {
    assert_code_evals_to('new Error("test").message', 'test')
  }),

  test('new constructor expr', () => {
    assert_code_evals_to(`
      const x = {Error};
      new (x.Error)('test').message
    `, 'test')
  }),

  test('new calls are recorded in calltree', () => {
    const code = `
      const make_class = new Function("return class { constructor(x) { x() } }")
      const clazz = make_class()
      const x = () => 1
      new clazz(x)
    `
    const i = test_initial_state(code)
    const find_call = COMMANDS.move_cursor(i, code.indexOf('1'))
    assert_equal(root_calltree_node(find_call).children.length, 3)
    const x_call = root_calltree_node(find_call).children[2].children[0]
    assert_equal(x_call.fn.name, 'x')
  }),

  test('new calls step into', () => {
    const code = `new Set()`
    const i = test_initial_state(code)
    const into = COMMANDS.calltree.arrow_down(i)
    assert_equal(into.current_calltree_node.fn.name, 'Set')
    assert_equal(into.current_calltree_node.is_new, true)
  }),

  test('new call non-constructor', () => {
    assert_code_error(
      `const x = () => 1; new x()`,
      'TypeError: fn is not a constructor'
    )
  }),

  test('method chaining', () => {
    assert_code_evals_to(
      `
        const x = [1,2,3,4];
        x.slice(1).slice(1).slice(1);
      `,
      [4]
    )
  }),

  test('error is not a function', () => {
    assert_code_error(
      `
      const x = null
      x()
      `,
      'TypeError: x is not a function'
    )
    assert_code_error(
      `
        const foo = () => ([{bar: {}}])
        foo()[0].bar.baz()
      `,
      'TypeError: foo(...)[0].bar.baz is not a function'
    )
  }),

  test('native throws', () => {
    const s1 = test_initial_state(
      `
      const throws = new Function('throw new Error("sorry")')
      throws()
      `
    )
    assert_equal(
      root_calltree_node(s1).error.message, 
      "sorry"
    )
  }),

  test('function name from object literal', () => {
    const code = `
      const fns = {x: () => 1}
      fns.x()
      fns.x.name
    `
    const i = test_initial_state(code)
    assert_equal(root_calltree_node(i).children[0].fn.name, 'x')
    assert_code_evals_to(code, 'x')
  }),

  test('function name from const decl', () => {
    const code = `
      const x = () => 1
      x()
      x.name
    `
    const i = test_initial_state(code)
    assert_equal(root_calltree_node(i).children[0].fn.name, 'x')
    assert_code_evals_to(
      code,
      'x',
    )
  }),

  test('function name deduce', () => {
    const code = `
      const make_fn = () => () => 1
      const x = make_fn()
      x()
      x.name
    `
    const i = test_initial_state(code)
    assert_equal(root_calltree_node(i).children[1].fn.name, 'x')
    assert_code_evals_to(
      code,
      'x',
    )
  }),

  test('function name dont deduce if already has name', () => {
    const code = `
      const make_fn = () => {
        const y = () => 1
        return y
      }
      const x = make_fn()
      x()
      x.name
    `
    const i = test_initial_state(code)
    assert_equal(root_calltree_node(i).children[1].fn.name, 'y')
    assert_code_evals_to(
      code,
      'y',
    )
  }),

  test('record call chain', () => {
    const code = ` 
      const x = () => ({
        y: () => 1,
      })
      x().y()
    `
    const s1 = test_initial_state(code)
    assert_equal(s1.current_calltree_node.children.length, 2)
  }),

  test('record native call chain', () => {
    const code = ` Object.entries({}).map(() => null) `
    const s1 = test_initial_state(code)
    assert_equal(s1.current_calltree_node.children.length, 2)
  }),

  test('eval_frame logical short circuit', () => {
    assert_code_evals_to(
      `true || false`,
      true,
    )
  }),

  test('eval_frame array_literal', () => {
    assert_code_evals_to(
      `[1,2,3,...[4,5]];`,
      [1,2,3,4,5]
    )
  }),

  test('eval_frame object_literal', () => {
    assert_code_evals_to(
      `{foo: 1, ...{bar: 2}, ['baz']: 3};`,
      {foo:1, bar:2, baz: 3}
    )
  }),

  test('eval_frame ternary', () => {
    assert_code_evals_to(`false ? 1 : 2`, 2)
  }),

  test('eval_frame unary', () => {
    assert_code_evals_to(`! false`, true)
  }),

  test('typeof', () => {
    assert_code_evals_to('typeof 1', 'number')
  }),

  test('eval_frame unary minus', () => {
    assert_code_evals_to(`-(1)`, -1)
    assert_code_evals_to(`-1`, -1)
    assert_code_evals_to(`-(-1)`, 1)
  }),

  test('eval_frame binary', () => {
    const parsed = parse(`
      1 + 1
    `)
    const tree = eval_tree(parsed.node)
    assert_equal(eval_frame(tree).children[0].result.value, 2)
  }),

  test('eval_frame instanceof', () => {
    assert_code_evals_to('1 instanceof Object', false)
    assert_code_evals_to('{} instanceof Object', true)
  }),

  test('eval_frame grouping', () => {
    const parsed = parse('(1+1)')
    const tree = eval_tree(parsed.node)
    assert_equal(eval_frame(tree).children[0].result.value, 2)
  }),

  test('eval_frame member_access', () => {
    const parsed = parse('{foo: "bar"}["foo"]')
    const tree = eval_tree(parsed.node)
    assert_equal(eval_frame(tree).children[0].result.value, 'bar')
  }),

  test('eval_frame new', () => {
    const parsed = parse('new Error("foobar")')
    const tree = eval_tree(parsed.node)
    assert_equal(eval_frame(tree).children[0].result.value.message, 'foobar')
  }),

  test('eval_frame function_call', () => {
    const parsed = parse(`
      const x = () => 1;
      2 * x();
    `)
    const tree = eval_tree(parsed.node)
    assert_equal(eval_frame(tree).children[1].result.value, 2)
  }),

  test('eval_frame function_body_expr', () => {
    const parsed = parse(`
      const x = y => y;
      x(2);
    `)
    const tree = eval_tree(parsed.node)
    assert_equal(eval_frame(tree.children[0]).children[1].result, {ok: true, value: 2})
  }),

  test('eval_frame function_body_do', () => {
    const parsed = parse(`
      const x = y => {
        return y;
        const z = 1;
      };
      x(2);
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree.children[0])
    const ret = frame.children[1].children[0]
    const z_after_ret = frame.children[1].children[1]
    assert_equal(ret.result, {ok: true})
    assert_equal(z_after_ret.result, null)
  }),

  test('eval_frame if', () => {
    const parsed = parse(`
      if(1) {
        const x = 1;
      } else {
        const x = 1;
      }
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree)
    const _if = frame.children[0]
    assert_equal(_if.children[0].result, {ok: true, value: 1})
    assert_equal(_if.children[1].result, {ok: true})
    assert_equal(_if.children[2].result, null)
  }),

  test('eval_frame if without else', () => {
    const parsed = parse(`
      if(1) {
        const x = 1;
      }
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree)
    const _if = frame.children[0]
    assert_equal(_if.children.length, 2)
    assert_equal(_if.children[0].result, {ok: true, value: 1})
    assert_equal(_if.children[1].result, {ok: true})
  }),

  test('eval_frame modules', () => {
    const parsed = parse_modules(
      'b',
      {
        'a'  : 'export const a = 1;',
        'b'  : 'import {a} from "a"; export const b = a*2;',
      }
    )
    const {calltree, modules} = eval_modules(parsed);
    const frame = eval_frame(calltree, modules)
    assert_equal(frame.children[1].result, {ok: true})
    assert_equal(frame.children[1].children[0].children[1].result, {ok: true, value: 2})
  }),

  test('eval_frame error', () => {
    const parsed = parse(`
      const x = ({a}) => 0;
      x(null);
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree.children[0])
    assert_equal(frame.result, {ok: false})
  }),

  test('eval_frame binary &&', () => {
    const parsed = parse(`
      const x = () => 1;
      const y = () => 2;
      false && x();
      y();
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree)
    assert_equal(frame.children[3].result.value, 2)
  }),

  test('eval_frame binary ||', () => {
    const parsed = parse(`
      const x = () => 1;
      const y = () => 2;
      true || x();
      y();
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree)
    assert_equal(frame.children[3].result.value, 2)
  }),

  test('eval_frame binary ??', () => {
    const parsed = parse(`
      const x = () => 1;
      const y = () => 2;
      1 ?? x();
      y();
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree)
    assert_equal(frame.children[3].result.value, 2)
  }),

  test('eval_frame null call', () => {
    const parsed = parse(`null()`)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree)
    assert_equal(frame.children[0].result.ok, false)
  }),

  test('eval_frame non-function call bug', () => {
    const parsed = parse(`Object.assign({}, {}); null()`)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree)
    assert_equal(frame.children[frame.children.length - 1].result.ok, false)
  }),

  test('eval_frame destructuring args', () => {
    const parsed = parse(`
      const x = (...a) => a;
      x(1,2,3);
    `)
    const tree = eval_tree(parsed.node)
    const frame = eval_frame(tree.children[0])
    assert_equal(frame.children[0].children[0].children[0].result.value, [1,2,3])
  }),

  test('module not found', () => {
    const parsed = parse_modules(
      'a',
      {
        'a'  : 'import {b} from "b"; import {c} from "c"',
        'b'  : 'for'
      }
    )
    assert_equal(parsed.ok, false)
    assert_equal(
      parsed.problems.map(p => ({message: p.message, index: p.index, module: p.module})),
      [
        {
          message: "failed lo load module c",
          index: 21,
          module: "a",
        }, 
        {
          message: 'expected expression',
          index: 0,
          module: "b"
        }
      ]
    )
  }),

  test('module parse cache', () => {
    const s = test_initial_state({
      '' : `import {b} from 'b'`,
      'b' : `import {c} from 'c'`,
      'c' : `export const c = 1`,
    })

    // Break file c. If parse result is cached then the file will not be parsed
    // and the code would not break
    const spoil_file = {...s, files: {...s.files, 'c': ',,,'}}

    // change module ''
    const {state: s2} = COMMANDS.input(spoil_file, 'import {c} from "c"', 0)

    assert_equal(s2.parse_result.ok, true)
  }),

  test('modules', () => {
    const parsed = parse_modules(
      'd',
      {
        'a'  : 'export const a = 1;',
        'b'  : 'import {a} from "a"; export const b = a*2;',
        'c1' : 'import {b} from "b"; import {a} from "a"; export const c1 = b*2;',
        'c2' : 'import {b} from "b"; import {a} from "a"; export const c2 = b*2;',
        'd'  : 'import {c1} from "c1"; import {c2} from "c2"; export const d = c1 + c2;',
      }
    )
    assert_equal(parsed.sorted, ['a', 'b', 'c1', 'c2', 'd'])
    const modules = eval_modules(parsed).modules;
    assert_equal(modules.d.d, 8)
  }),

  test('module loaded just once', () => {
    /*
        root -> intermediate1 -> leaf
        root -> intermediate2 -> leaf
    */
    const parsed = parse_modules(
      'root',
      {
        'root'  : `
            import {l1} from "intermediate1"; 
            import {l2} from "intermediate2";
            export const is_eq = l1 == l2;
        `,
        'intermediate1'  : 'import {leaf} from "leaf"; export const l1 = leaf;',
        'intermediate2'  : 'import {leaf} from "leaf"; export const l2 = leaf;',
        'leaf'  : 'export const leaf = {}',
      }
    )
    const mods = eval_modules(parsed).modules
    // Check that the same symbol improted through different paths gives the
    // same result
    assert_equal(mods.root.is_eq, true)
  }),

  test('modules empty import', () => {
    const i = test_initial_state({
      '':  'import {} from "a"',
      'a': 'Object.assign(globalThis, {test_import: true})',
    })
    assert_equal(i.active_calltree_node.ok, true)
    assert_equal(globalThis.test_import, true)
  }),

  test('modules bare import', () => {
    const i = test_initial_state({
      '':  'import "a"',
      'a': 'Object.assign(globalThis, {test_import: true})',
    })
    assert_equal(i.active_calltree_node.ok, true)
    assert_equal(globalThis.test_import, true)
  }),

  test('bug parser pragma external', () => {
    const result = parse(`
      // external
    `)
    assert_equal(result.ok, true)
  }),


  test('module external', () => {
    const code = `
      // external
      import {foo_var} from 'foo.js'
      console.log(foo_var)
    `
    const s1 = test_initial_state(code)
    assert_equal(s1.loading_external_imports_state.external_imports, ['foo.js'])

    const state = COMMANDS.external_imports_loaded(s1, s1, {
      'foo.js': {
        ok: true,
        module: {
          'foo_var': 'foo_value'
        },
      }
    })
    assert_equal(state.logs.logs[0].args, ['foo_value'])
    assert_equal(state.loading_external_imports_state, null)
  }),

  test('module external input', () => {
    const initial_code = ``
    const initial = test_initial_state(initial_code)
    const edited = `
      // external
      import {foo_var} from 'foo.js'
      console.log(foo_var)
    `

    const index = edited.indexOf('foo_var')

    const {state, effects} = COMMANDS.input(
      initial, 
      edited, 
      index
    )
    // embed_value_explorer suspended until external imports resolved
    assert_equal(effects.length, 1)
    assert_equal(effects[0].type, 'save_to_localstorage')
    assert_equal(
      state.loading_external_imports_state.external_imports,
      ['foo.js'],
    )

    // TODO must have effect embed_value_explorer
    const next = COMMANDS.external_imports_loaded(state, state, {
      'foo.js': {
        ok: true,
        module: {
          'foo_var': 'foo_value'
        },
      }
    })
    assert_equal(next.loading_external_imports_state, null)
    assert_equal(next.logs.logs[0].args, ['foo_value'])
  }),

  test('module external load error', () => {
    const code = `
      // external
      import {foo_var} from 'foo.js'
      console.log(foo_var)
    `
    const initial = test_initial_state(code)

    const next = COMMANDS.external_imports_loaded(initial, initial, {
      'foo.js': {
        ok: false,
        error: new Error('Failed to resolve module'),
      }
    })

    assert_equal(next.parse_result.ok, false)
    assert_equal(
      next.parse_result.problems, 
      [
        {
          index: code.indexOf('import'),
          message: 'Failed to resolve module',
          module: '',
        }
      ]
    )
  }),

  test('module external cache', () => {
    const code = `
      // external
      import {foo_var} from 'foo.js'
      console.log(foo_var)
    `
    const initial = test_initial_state(code)

    const next = COMMANDS.external_imports_loaded(initial, initial, {
      'foo.js': {
        ok: true,
        module: {
          'foo_var': 'foo_value'
        },
      }
    })

    const edited = `
      // external
      import {foo_var} from 'foo.js'
      foo_var
    `

    const {state} = COMMANDS.input(
      next, 
      edited, 
      edited.lastIndexOf('foo_var'),
    )

    // If cache was not used then effects will be `load_external_imports`
    assert_equal(state.value_explorer.result.value, 'foo_value')
  }),

  test('module external cache error bug', () => {
    const code = `
      // external
      import {foo_var} from 'foo.js'
      console.log(foo_var)
    `
    const initial = test_initial_state(code)

    // simulate module load error
    const next = COMMANDS.external_imports_loaded(initial, initial, {
      'foo.js': {
        ok: false,
        error: new Error('Failed to resolve module'),
      }
    })

    const edited = `
      // external
      import {foo_var} from 'foo.js'
      // edit
      console.log(foo_var)
    `

    // edit code
    const {state} = COMMANDS.input(
      next, 
      edited, 
      edited.lastIndexOf('foo_var'),
    )

    // Error must preserve after error
    assert_equal(next.parse_result.ok, false)
    assert_equal(
      next.parse_result.problems, 
      [
        {
          index: code.indexOf('import'),
          message: 'Failed to resolve module',
          module: '',
        }
      ]
    )
  }),

  test('module external cache invalidation bug', () => {
    const code = `
      // external
      import {foo_var} from 'foo.js'
    `
    const initial = test_initial_state(code)

    // simulate module load error
    const next = COMMANDS.external_imports_loaded(initial, initial, {
      'foo.js': {
        ok: false,
        error: new Error('Failed to resolve module'),
      }
    })

    const edited = ``

    // edit code
    const {state, effects} = COMMANDS.input(
      next, 
      edited, 
      0,
    )

    assert_equal(state.parse_result.ok, true)
  }),

  test('modules default export', () => {
    const modules = {
      '' : "import foo from 'foo'; foo",
      'foo': `export default 1`
    }
    assert_code_evals_to(modules , 1)

    const i = test_initial_state(modules)
    const s = COMMANDS.goto_definition(i, modules[''].indexOf('foo')).state
    assert_equal(current_cursor_position(s), modules['foo'].indexOf('1'))
    assert_equal(s.current_module, 'foo')
  }),

  test('modules default import', () => {
    const code = `
      // external
      import foo from 'foo.js'
      foo
    `
    const initial = test_initial_state(code)

    const next = COMMANDS.external_imports_loaded(initial, initial, {
      'foo.js': {
        ok: true,
        module: {
          'default': 'foo_value'
        },
      }
    })
    assert_equal(active_frame(next).children.at(-1).result.value, 'foo_value')
  }),

  // Static analysis

  test('undeclared', () => {
    const undeclared_test = `
      const foo = 1;
      const bar = baz => qux(foo, bar, baz, quux);
      const qux = 3;
    `
    const result = parse(undeclared_test)
    assert_equal(result.problems.length, 1)
    assert_equal(result.problems[0].message, 'undeclared identifier: quux')
  }),

  test('name reuse', () => {
    assert_code_evals_to(
      `
        const f = f => f;
        f(x => x + 1)(10);
      `,
      11
    )
  }),

  test('assign to itself', () => {
    const code = `
      const x = x;
    `
    return assert_equal(parse(code).problems[0].message, 'undeclared identifier: x')
  }),

  test('function hoisting', () => {
    assert_code_evals_to(`
      function x() {
        return 1
      }
      x()
      `,
      1
    )
    assert_code_evals_to(`
      const y = x()
      function x() {
        return 1
      }
      y
      `,
      1
    )
  }),

  test('function decl', () => {
    const code = `
      function fib(n) {
        if(n == 0 || n == 1) {
          return n
        } else {
          return fib(n - 1) + fib(n - 2)
        }
      }

      fib(6)
    `
    const i = test_initial_state(code)
    const s = COMMANDS.calltree.arrow_right(COMMANDS.calltree.arrow_down(
        COMMANDS.calltree.arrow_right(COMMANDS.calltree.arrow_down(i))
      ))
    const s2 = COMMANDS.calltree.arrow_down(s)
    assert_equal(s2.active_calltree_node.value, 5)
  }),

  /*
  TODO use before assignment
  test('no use before assignment', () => {
    const test = `
      let x;
      x;
    `
    return assert_equal(parse(test).problems[0].message, 'undeclared identifier: x')
  }),
  */

  test('goto_definition', () => {
    const entry = `
      import {x} from 'a'
      const y = x*x
    `
    const a = `export const x = 2`
    const s = test_initial_state({
      '' : entry,
      a,
    })
    const y_result = COMMANDS.goto_definition(s, entry.indexOf('y'))
    assert_equal(y_result.effects, null)

    const x_result_1 = COMMANDS.goto_definition(s, entry.indexOf('x*x'))
    assert_equal(x_result_1.state.current_module, '')
    assert_equal(current_cursor_position(x_result_1.state), entry.indexOf('x'))

    const x_result_2 = COMMANDS.goto_definition(s, entry.indexOf('x'))
    assert_equal(x_result_2.state.current_module, 'a')
    assert_equal(current_cursor_position(x_result_2.state), a.indexOf('x = 2'))
  }),

  test('assignment', () => {
    const frame = assert_code_evals_to(
      `
        let x;
        x = 1;
        x;
      `,
      1
    )
    // assert let has result
    assert_equal(frame.children[0].result, {ok: true})
    // assert x value
    assert_equal(frame.children[0].children[0].result, {ok: true, value: 1})
  }),

  test('block scoping', () => {
    assert_code_evals_to(
      `
        const x = 10
        let y
        if(true) {
          const x = 1
          y = x
        } else {
          const x = 2
          y = x
        }
        y
      `,
      1
    )
  }),

  test('block scoping shadow', () => {
    assert_code_evals_to(
      `
        let y
        y = 1
        if(true) {
          let y
          y = 2
        }
        y
      `,
      1
    )
  }),

  test('step_into', () => {
    const code = `
      const x = () => 1;
      const y = () => 1;

      if(1) {
          x();
      } else {
          y();
      }
    `
    const initial = test_initial_state(code)
    const state = COMMANDS.step_into(initial, code.indexOf('x()'))
    const call_code = state.current_calltree_node.code
    assert_equal(call_code.index, code.indexOf('() =>'))
    assert_equal(current_cursor_position(state), code.indexOf('() =>'))
    assert_equal(state.value_explorer.index, code.indexOf('() =>'))
  }),

  test('step_into deepest', () => {
    const code = `
      const x = () => () => 1;
      x(2)(3);
    `
    const initial = test_initial_state(code)
    const next = COMMANDS.step_into(initial, code.indexOf('3'))
    const cn = next.current_calltree_node.code
    assert_equal(cn.index, code.indexOf('() => 1'))
  }),

  test('step_into expand_calltree_node', () => {
    const code = `
      const x = () => 1
      const y = () => x()
      y()

    `
    const initial = test_initial_state(code)
    const next = COMMANDS.step_into(initial, code.indexOf('y()'))
    const cn = next.current_calltree_node.code
    assert_equal(cn.index, code.indexOf('() => x()'))
  }),

  test('coloring', () => {
    const code = `
      const x = () => {
        throw new Error()
      }
      const y = x()
    `

    const initial = test_initial_state(code)
    // only `throw new Error()` colored
    assert_equal(
      color_file(initial, ''),
      [
        { 
          index: code.indexOf('const x'), 
          length: 'const x = '.length, 
          result: { ok: true } 
        },
        {
          index: code.indexOf('x()'), 
          length: 'x()'.length, 
          result: { ok: false, error_origin: true } 
        }
      ]
    )

    const step_into = COMMANDS.calltree.click(initial, 1)
    assert_equal(
      color_file(step_into, '').sort((a,b) => a.index - b.index),
      [
        { 
          index: code.indexOf('const x'), 
          length: 'const x = '.length,
          result: { ok: true } 
        },
        { 
          index: code.indexOf('() =>'), 
          length: '()'.length,
          result: { ok: true } 
        },
        { 
          index: code.indexOf('throw'), 
          length: 'throw new Error()'.length, 
          result: { ok: false, error_origin: true } 
        },
        { 
          index: code.indexOf('x()'), 
          length: "x()".length, 
          result: { ok: false, error_origin: true } 
        }
      ]
    )
  }),

  test('coloring failed member access', () => {
    const code = '(null[1])';
    const initial = test_initial_state(code)
    // Color only index access, not grouping braces
    assert_equal(
      color_file(initial, ''),
      [ { index: 1, length: 7, result: { ok: false, error_origin: true } } ],
    )
  }),

  test('coloring if', () => {
    const code = `
      const x = () => {
        if(false) {/*m1*/
          if(true) {
            1
          }
          2
        } else {
          3
        }
      }/*end*/

      x()`
    const initial = test_initial_state(code)
    const step_into = COMMANDS.calltree.click(initial, 1)

    assert_equal(
      color_file(step_into, '').sort((c1, c2) => c1.index - c2.index),
      [
        { 
          index: code.indexOf('const x'), 
          length: code.indexOf('() =>') - code.indexOf('const x'),  
          result: { ok: true } 
        },
        { 
          index: code.indexOf('() =>'), 
          length: code.indexOf(' {/*m1*/') - code.indexOf('() =>') + 1,  
          result: { ok: true } 
        },
        { 
          index: code.indexOf(' else'), 
          length: code.indexOf('/*end*/') - code.indexOf(' else'),
          result: { ok: true } 
        },
        { 
          index: code.indexOf('/*end*/'), 
          length: code.length - code.indexOf('/*end*/'),
          result: { ok: true } 
        },
      ]
    )
  }),
  

  test('coloring failed toplevel', () => {
    const code = `throw new Error()`
    const initial = test_initial_state(code)
    assert_equal(
      color_file(initial, ''),
      [ 
        { 
          index: 0, 
          length: code.length, 
          result: { ok: false, error_origin: true } 
        } 
      ]
    )
  }),

  test('coloring short circuit', () => {
    const code = `true || false`
    const initial = test_initial_state(code)
    assert_equal(
      color_file(initial, ''),
      [ 
        { 
          index: 0, 
          length: "true".length, 
          result: { ok: true } 
        } 
      ]
    )
  }),

  test('coloring nested', () => {
    const code = 
    // TODO reformat using .trim()
    `const x = () => {
   return () => {
     return 123
   }
}
const y = x()`
    const initial = test_initial_state(code)
    const s = COMMANDS.move_cursor(initial, code.indexOf('return'))
    const coloring = color_file(s, '').sort((c1, c2) => c1.index - c2.index)
    // Checked by eye, test for regression
    assert_equal(
      coloring,
      [
        { index: 0, length: 10, result: { ok: true } },
        { index: 10, length: 18, result: { ok: true } },
        { index: 56, length: 2, result: { ok: true } },
        { index: 58, length: 14, result: { ok: true } }
      ]
    )
  }),

  test('better parse errors', () => {
    const code = `
      const x = z => {
        1 2
      }
    `
    const r = parse(code)
    assert_equal(r.ok, false)
    const p = r.problems[0]
    assert_equal(p.index, code.indexOf('2'))
  }),

  test('better parse errors 2', () => {
    const code = `
      if(true) {
        const x = 1
      } else {
        ,
      }
    `
    const r = parse(code)
    assert_equal(r.ok, false)
    const p = r.problems[0]
    assert_equal(p.index, code.indexOf(','))
  }),
  
  test('better parse errors 3', () => {
    const code = `[() => { , }] `
    const r = parse(code)
    const p = r.problems[0]
    assert_equal(p.index, code.indexOf(','))
  }),

  test('edit function', () => {
    const s = test_initial_state(`
      const x = foo => {
        return foo*2
      };

      x(2);
    `)

    const s2 = COMMANDS.calltree.click(
      s, 
      root_calltree_node(s).children[0].id,
    )

    // Make code invalid
    const invalid = `
      const x = foo => {
        return 
      };

      x(2);
    `
    const s3 = COMMANDS.input(s2, invalid, invalid.indexOf('return')).state

    const edited = `
      const x = foo => {
        return foo*3
      };

      x(2);
    `

    const n = COMMANDS.input(s3, edited, edited.indexOf('return')).state

    const res = find_leaf(active_frame(n), edited.indexOf('*'))

    assert_equal(res.result.value, 6)
    assert_equal(
      n.calltree_node_by_loc[''][edited.indexOf('foo =>')] == null,
      false
    )
  }),

  test('edit function 2', () => {
    const code = `
      const x = () => {
        return 1
      }
      [1,2,3].map(x)
    `
    const s1 = test_initial_state(code)

    // Go into first call of `x`
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const s3 = COMMANDS.calltree.arrow_right(s2)
    const s4 = COMMANDS.calltree.arrow_right(s3)
    
    assert_equal(s4.current_calltree_node.code.index, code.indexOf('() =>'))

    const edited = `
      const x = () => {
        return 2
      }
      [1,2,3].map(x)
    `

    const e = COMMANDS.input(s4, edited, edited.indexOf('2')).state

    const active = active_frame(e)

    assert_equal(active.index, edited.indexOf('() =>'))
  }),

  test('edit function modules bug', () => {
    const s1 = test_initial_state({
      '' : `
        import {x} from 'x.js'
        const fn = () => {
        }
      `,
      'x.js': `
        export const x = 1
      `
    })

    const edited = `
        import {x} from 'x.js'
        const fn = () => {
          1
        }
      `

    const {state: s2} = COMMANDS.input(s1, edited, edited.indexOf('1'))
    const s3 = COMMANDS.move_cursor(s2, edited.indexOf('import'))
    assert_equal(s3.value_explorer.result.value.x, 1)
  }),

  test('edit toplevel', () => {
    const code = `
      const x = () => {
        return 1
      }
      x()
    `
    const s1 = test_initial_state(code)

    // Go into call of `x`
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const s3 = COMMANDS.calltree.arrow_right(s2)
    
    assert_equal(s3.current_calltree_node.code.index, code.indexOf('() =>'))

    const edited = `
      const y = 123
      const x = () => {
        return 1
      }
      x()
    `

    const e = COMMANDS.input(s3, edited, edited.indexOf('123')).state

    assert_equal(e.active_calltree_node.toplevel, true)
  }),

  test('edit module not_loaded', () => {
    const s1 = COMMANDS.change_current_module(
      test_initial_state({
        '' : '',
        "x": 'export const x = 1',
      }),
      'x'
    )
    const e = COMMANDS.input(s1, 'export const x = 2', 0).state
    assert_equal(e.current_calltree_node.module, '')
    assert_equal(e.active_calltree_node, null)
  }),

  test('edit function unreachable', () => {
    const code = `
      const x = () => {
        return 1
      }
      const y = () => {
        return 2
      }
      x()
    `
    const s1 = test_initial_state(code)

    // Go into call of `x`
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const s3 = COMMANDS.calltree.arrow_right(s2)
    
    const edited = `
      const x = () => {
        return 1
      }
      const y = () => {
        return 3
      }
      x()
    `

    const moved = COMMANDS.move_cursor(s3, code.indexOf('2'))
    const e = COMMANDS.input(moved, edited, edited.indexOf('3')).state
    assert_equal(e.active_calltree_node, null)
    assert_equal(e.current_calltree_node.toplevel, true)
  }),

  test('edit function step out', () => {
    const code = `
      const x = () => {
        return 1
      }
      x()
    `
    const i = test_initial_state(code)
    const edited = COMMANDS.input(i, code.replace('1', '100'), code.indexOf('1')).state
    const left = COMMANDS.calltree.arrow_left(edited)
    assert_equal(left.active_calltree_node.toplevel, true)
  }),

  test('expand_calltree_node', () => {
    // Test expecting MAX_DEPTH = 1
    const s = test_initial_state(`
      const countdown = c => c == 0 ? 0 : 1 + countdown(c - 1);
      countdown(10)
    `)
    const first = root_calltree_node(s).children[0]
    assert_equal(first.children, undefined)
    assert_equal(first.has_more_children, true)
    assert_equal(first.value, 10)
    const s2 = COMMANDS.calltree.click(s, first.id)
    const first2 = root_calltree_node(s2).children[0]
    assert_equal(first2.children[0].value, 9)
    assert_equal(first2.children[0].children, undefined)
    assert_equal(first2.children[0].has_more_children, true)
    assert_equal(first2.code, first2.children[0].code)
  }),

  test('expand_calltree_node new', () => {
    const code = `
      const make_class = new Function("return class { constructor(x) { x() } }")
      const clazz = make_class()
      const x = () => 1
      new clazz(x)
    `
    const s = test_initial_state(code)
    const new_call = root_calltree_node(s).children.at(-1)
    const expanded_new_call = COMMANDS.calltree.click(s, new_call.id)
    const x_call = root_calltree_node(expanded_new_call)
      .children.at(-1)
      .children[0]
    assert_equal(x_call.fn.name, 'x')
  }),

  test('expand_calltree_node native', () => {
    const s = test_initial_state(`[1,2,3].map(x => x + 1)`)
    const map = root_calltree_node(s).children[0]
    assert_equal(map.children, null)
    const s2 = COMMANDS.calltree.click(s, map.id)
    const map_expanded = root_calltree_node(s2).children[0]
    assert_equal(map_expanded.children.length, 3)
  }),

  test('click native calltree node', () => {
    const s = test_initial_state(`Object.fromEntries([])`)
    const index = 0 // Where call starts
    const call = root_calltree_node(s).children[0]
    const state = COMMANDS.calltree.click(s, call.id)
    assert_equal(current_cursor_position(state), index)
    assert_equal(
      state.value_explorer,
      {
        index,
        result: {
          "ok": true,
          "value": {
            "*arguments*": [
              []
            ],
            "*return*": {}
          }
        }
      }
    )
  }),

  test('jump_calltree_location' , () => {
    const code = `
      const x = foo => foo + 1;
      const y = arr => {
        return arr.map(x)
      }
      y([1,2,3])
    `

    const assert_loc = (s, substring, is_assert_node_by_loc) => {
      const state = COMMANDS.calltree.arrow_right(s)
      const index = code.indexOf(substring)
      assert_equal(current_cursor_position(state), index)
      if(is_assert_node_by_loc) {
        assert_equal(
          state.calltree_node_by_loc[''][index] == null,
          false
        )
      }
      assert_equal(active_frame(state) != null, true)

      return state
    }


    const s1 = test_initial_state(code)

    // Select call of `y()`
    const s2 = assert_loc(s1, 'y([')

    // Expand call of `y()`
    const s3 = assert_loc(s2, 'arr =>', true)

    // Select call of arr.map
    const s4 = assert_loc(s3, 'arr.map')

    // Expand call of arr.map
    // native call is not expandable
    const s5 = assert_loc(s4, 'arr.map')

    // Select call of x
    const s6 = assert_loc(s5, 'foo =>', true)

  }),

  // Test very specific case
  test('jump_calltree_location after error', () => {
    const code = `
      const fail = () => {
        throw new Error('fail')
      }
      const good = () => {/*good*/}
      [good, fail].forEach(fn => fn())
    `
    const s = test_initial_state(code)
    const call_fn = root_calltree_node(s).children[0].children[0]
    const s2 = COMMANDS.calltree.click(s, call_fn.id)
    const good = s2.current_calltree_node.children[0]
    assert_equal(good.code.index, code.indexOf('() => {/*good'))
  }),


  test('unwind_stack', () => {
    const s = test_initial_state(`
      const y = () => 1
      const deep_error = x => {
        if(x == 10) {
          throw 'deep_error'
        } else {
          y()
          deep_error(x + 1)
        }
      }
      deep_error(0)
    `)

    assert_equal(s.active_calltree_node.toplevel, true)
    assert_equal(s.current_calltree_node.id, s.active_calltree_node.id)

    const first = root_calltree_node(s).children[0]

    const depth = (node, i = 0) => {
      if(node.children == null) {
        return i
      }
      assert_equal(s.calltree_node_is_expanded[node.id], true)
      assert_equal(node.children.length, 2)
      return depth(node.children[1], i + 1)
    }

    assert_equal(depth(first), 10)
    assert_equal(first.ok, false)
    assert_equal(first.error, 'deep_error')
  }),

  /* Test when node where error occured has subcalls */
  test('unwind_stack 2', () => {
    const code = `
      const x = () => 1
      const error = () => {
        x()
        null.y
      }
      error()
    `
    const s = test_initial_state(code)
    assert_equal(s.current_calltree_node.toplevel, true)
  }),

  //TODO this test is fine standalone, but it breaks self-hosted test
  /*
  test('unwind_stack overflow', () => {
    const s = test_initial_state(`
      const overflow = x => overflow(x + 1);
      overflow(0)
    `)
    assert_equal(
      s.current_calltree_node.error.message, 
      'Maximum call stack size exceeded'
    )
    assert_equal(s.current_calltree_node.toplevel, true)
    assert_equal(s.calltree_node_is_expanded[s.current_calltree_node.id], true)
  }),
  */

  test('eval_selection', () => {
    const code = `
      const x = () => () => 1
      x()
      2*2
      false && 4
      if(true) {
      }
    `
    const s0 = test_initial_state(code)
    const s1 = COMMANDS.eval_selection(s0, code.indexOf('2'), true).state
    assert_equal(s1.value_explorer.result.value, 2)
    
    // Expand selection
    const s2 = COMMANDS.eval_selection(s1, code.indexOf('2'), true).state
    assert_equal(s2.value_explorer.result.value, 4)
    
    const s3 = COMMANDS.eval_selection(s2, code.indexOf('2'), true).state
    // Selection is not expanded beyond expression to statement
    assert_equal(s3.value_explorer.result.value, 4)
    assert_equal(s3.selection_state.node.index, code.indexOf('2'))
    assert_equal(s3.selection_state.node.length, 3)

    const s4 = COMMANDS.step_into(s0, code.indexOf('x()'))
    const s5 = COMMANDS.eval_selection(s4, code.indexOf('2'))
    assert_equal(s5.effects, {type: 'set_status', args: ['out of scope']})

    const s6 = COMMANDS.eval_selection(s4, code.indexOf('1'))
    assert_equal(
      s6.effects, 
      {
        type: 'set_status', 
        args: ['cannot eval inside function: first step into it']
      }
    )

    const s7 = COMMANDS.eval_selection(s0, code.indexOf('4'))
    assert_equal(
      s7.effects,
      {
        type: 'set_status',
        args: ['expression was not reached during program execution'],
      }
    )

    const s8 = COMMANDS.eval_selection(s0, code.indexOf('if'))
    assert_equal(
      s8.effects,
      {
        type: 'set_status',
        args: ['can only evaluate expression, not statement'],
      }
    )
  }),

  test('find_call', () => {
    const code = `
      const y = () => y2()
      const z = () => z2()
      const y2 = () => 1
      const z2 = () => 2
      const target = (x) => target2(x)
      const target2 = (x) => target3(x)
      const target3 = (x) => 3
      const deep_call = x => {
        if(x == 10) {
          target(x)
        } else {
          y()
          deep_call(x + 1)
          z()
        }
      }
      deep_call(0)
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('target2(x)'))

    assert_equal(s2.current_calltree_node.id, s2.active_calltree_node.id)

    assert_equal(s2.current_calltree_node.args, [10])
    assert_equal(s2.current_calltree_node.code.index, code.indexOf('(x) => target2'))

    const root = root_calltree_node(s2)
    const first = root.children[0]

    assert_equal(first.ok, true)

    const find_target = (node, i = 0) => {
      if(node.children.length == 1) {
        return [i, node.children[0]]
      }

      assert_equal(s2.calltree_node_is_expanded[node.id], true)
      assert_equal(node.children.length, 3)
      assert_equal(node.code != null, true)

      // Siblings are not expanded
      assert_equal(node.children[0].has_more_children, true)
      assert_equal(node.children[2].has_more_children, true)

      return find_target(node.children[1], i + 1)
    }

    const [depth, target] = find_target(first)
    assert_equal(depth, 10)
    assert_equal(target.args, [10])

    const target2 = target.children[0]
    // Target is expanded, but only one level deep
    assert_equal(target2.has_more_children, true)
  }),

  test('find_call error', () => {
    const code = `
      const unreachable = () => {
        1
      }

      const throws = () => {
        throw new Error('bad')
      }

      throws()
    `

    const s1 = test_initial_state(code)
    const state = COMMANDS.move_cursor(s1, code.indexOf('1'))
    assert_equal(state.active_calltree_node, null)
    assert_equal(state.current_calltree_node.toplevel, true)
    assert_equal(state.value_explorer === null, true)
  }),

  test('find_call with native call', () => {
    const code = `
      [1,2,3].map(x => x + 1)
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('x + 1'))
    assert_equal(s2.current_calltree_node.code.index, code.indexOf('x =>'))
  }),

  test('find_call should find first call', () => {
    const code = `
      const rec = i => i == 0 ? 0 : rec(i - 1)
      rec(10)
    `
    const s1 = test_initial_state(code)
    const state = COMMANDS.move_cursor(s1, code.indexOf('i == 0'))
    assert_equal(state.current_calltree_node.args, [10])
  }),
  
  test('select_return_value not expanded', () => {
    const code = `
      const x = (a) => 1
      x()
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const {state: s3, effects} = COMMANDS.calltree.select_return_value(s2)
    assert_equal(s3.value_explorer.result.value, 1)
    assert_equal(s3.selection_state.node.index, code.indexOf('x()'))
    assert_equal(current_cursor_position(s3), code.indexOf('x()'))
    assert_equal(effects, {type: 'set_focus'})
  }),

  test('select_return_value expanded', () => {
    const code = `
      const x = (a) => 1
      x()
    `
    const s1 = test_initial_state(code)
    const s2_0 = COMMANDS.calltree.arrow_right(s1)
    // Expand
    const s2 = COMMANDS.calltree.arrow_right(s2_0)
    const {state: s3, effects} = COMMANDS.calltree.select_return_value(s2)
    assert_equal(s3.value_explorer.result.value, 1)
    assert_equal(s3.selection_state.node.index, code.indexOf('1'))
    assert_equal(current_cursor_position(s3), code.indexOf('1'))
    assert_equal(effects, {type: 'set_focus'})
  }),

  test('select_return_value fn curly braces', () => {
    const code = `
      const x = (a) => {return 1}
      x()
    `
    const s1 = test_initial_state(code)
    const s2_0 = COMMANDS.calltree.arrow_right(s1)
    // Expand
    const s2 = COMMANDS.calltree.arrow_right(s2_0)
    const {state: s3, effects} = COMMANDS.calltree.select_return_value(s2)
    assert_equal(s3.value_explorer.result.value, 1)
    assert_equal(s3.selection_state.node.index, code.indexOf('1'))
    assert_equal(current_cursor_position(s3), code.indexOf('1'))
    assert_equal(effects, {type: 'set_focus'})
  }),

  test('select_return_value fn curly braces no return', () => {
    const code = `
      const x = (a) => { 1 }
      x()
    `
    const s1 = test_initial_state(code)
    const s2_0 = COMMANDS.calltree.arrow_right(s1)
    // Expand
    const s2 = COMMANDS.calltree.arrow_right(s2_0)
    const {state: s3, effects} = COMMANDS.calltree.select_return_value(s2)
    assert_equal(s3.selection_state, null)
    assert_equal(current_cursor_position(s3), code.indexOf('{'))
    assert_equal(effects, {type: 'set_focus'})
  }),

  test('select_return_value native', () => {
    const code = `
      [1,2,3].map(() => 1)
    `
    const s1 = test_initial_state(code)
    // Select map
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const {state: s3, effects} = COMMANDS.calltree.select_return_value(s2)
    assert_equal(s3.value_explorer.result.value, [1, 1, 1])
  }),

  test('select_return_value new call', () => {
    const code = `new String('1')`
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const {state: s3, effects} = COMMANDS.calltree.select_return_value(s2)
    assert_equal(s3.value_explorer.result.value, '1')
  }),
  
  test('select_arguments not_expanded', () => {
    const code = `
      const x = (a) => { 1 }
      x(1)
    `
    const s1 = test_initial_state(code)
    // focus call
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const s3 = COMMANDS.calltree.select_arguments(s2)
    assert_equal(s3.state.value_explorer.result, {ok: true, value: [1]})
    assert_equal(current_cursor_position(s3.state), code.indexOf('(1)'))
    assert_equal(s3.effects, {type: 'set_focus'})
  }),

  test('select_arguments expanded', () => {
    const code = `
      const x = (a) => { 1 }
      x(1)
    `
    const s1 = test_initial_state(code)
    // focus call
    const s2_0 = COMMANDS.calltree.arrow_right(s1)
    // expand call
    const s2 = COMMANDS.calltree.arrow_right(s2_0)
    const s3 = COMMANDS.calltree.select_arguments(s2)
    assert_equal(s3.state.value_explorer.result, {ok: true, value: {a: 1}})
    assert_equal(current_cursor_position(s3.state), code.indexOf('(a)'))
    assert_equal(s3.effects, {type: 'set_focus'})
  }),

  test('select_arguments new call', () => {
    const code = `new String("1")`
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const s3 = COMMANDS.calltree.select_arguments(s2).state
    assert_equal(s3.value_explorer.result, {ok: true, value: ["1"]})
  }),

  test('move_cursor arguments', () => {
    const code = `
      const x = (a, b) => { }
      x(1, 2)
    `
    const s1 = test_initial_state(code)
    // focus call
    const s2 = COMMANDS.calltree.arrow_right(s1)
    // expand call
    const s3 = COMMANDS.calltree.arrow_right(s2)
    const s4 = COMMANDS.move_cursor(s3, code.indexOf('a'))
    assert_equal(s4.value_explorer, {
      index: code.indexOf('(a, b)'),
      result: {ok: true, value: {a: 1, b: 2}},
    })
  }),

  test('move_cursor concise fn', () => {
    const code = `
      const x = y => y*2
      x(2)
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('2'))
    assert_equal(s2.value_explorer, {
      index: code.indexOf('y*2'),
      result: {ok: true, value: 4},
    })
  }),

  test('move_cursor let', () => {
    const code = `
      let x
      x = 1
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('x'))
    assert_equal(s2.value_explorer, {
      index: code.indexOf('let x'),
      result: {ok: true, value: {x: 1}},
    })
  }),

  test('move_cursor after type toplevel', () => {
    const code = `1`
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1') + 1)
    assert_equal(s2.value_explorer.result.value, 1)
  }),

  test('move_cursor after type fn', () => {
    const code = `
      const x = () => { 1 }
      x()
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.step_into(s1, code.indexOf('x()'))
    const s3 = COMMANDS.move_cursor(s2, code.indexOf('1') + 1)
    assert_equal(s3.value_explorer.result.value, 1)
  }),

  test('move_cursor between statements', () => {
    const code = `
      1

      /*marker*/
      1
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('/') - 1)
    assert_equal(s2.value_explorer === null, true)
  }),

  test('move_cursor step_into fn', () => {
    const code = `
      const x = () => {
        1
      }
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1'))
    assert_equal(s2.value_explorer === null, true)
  }),

  test('move_cursor brace', () => {
    const code = `
      if(true) {
        1
      }
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('{'))
    assert_equal(s2.value_explorer === null, true)
  }),

  test('move_cursor concise fn throws', () => {
    const code = `
      const throws = () => {
        throw new Error('boom')
      }

      const x = () => 2 * (throws() + 1)

      x()
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('throws()'))
    assert_equal(s2.value_explorer.result.error.message, 'boom')
  }),

  test('frame follows cursor toplevel', () => {
    const code = `
      const x = () => {
        1
      }
      x()
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('const'))
    assert_equal(s2.current_calltree_node.toplevel, true)
    assert_equal(s2.active_calltree_node.toplevel, true)
  }),

  test('frame follows cursor fn', () => {
    const code = `
      const x = () => {
        1
        2
      }
      x()
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1'))
    assert_equal(s2.current_calltree_node.code.index, code.indexOf('() =>'))
    // Move within current node
    const s3 = COMMANDS.move_cursor(s2, code.indexOf('2'))
    assert_equal(s3.current_calltree_node.code.index, code.indexOf('() =>'))
  }),

  test('frame follows cursor return back to fn', () => {
    const code = `
      const x = () => {
        1
      }
      x()
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1'))

    // Go back toplevel
    const s3 = COMMANDS.move_cursor(s2, code.indexOf('const'))
    assert_equal(s3.current_calltree_node.toplevel, true)

    // Go back to fn
    assert_equal(s3.eval_cxt == null, false)
    const s4 = COMMANDS.move_cursor(
      {...s3, 
        // Set eval_cxt to null, ensure eval would not be called again
        eval_cxt: null
      },
      code.indexOf('1')
    )
    assert_equal(s4.current_calltree_node.code.index, code.indexOf('() =>'))
  }),

  // Tests for one specific bug
  test('frame follows cursor change fn', () => {
    const code = `
      const x = () => {
        1
      }
      const y = () => {/*y*/
        2
        z()
      }
      const z = () => {
        3
      }
      x()
      y()
    `
    const s1 = test_initial_state(code)

    // goto x()
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1'))

    // goto y()
    const s3 = COMMANDS.move_cursor(s2, code.indexOf('2'))

    assert_equal(s3.active_calltree_node.code.index, code.indexOf('() => {/*y'))
  }),

  test('frame follows cursor deep nested fn', () => {
    const code = `
      const y = () => {
        1
      }
      const x = i => i == 0 ? y() : x(i - 1)
      x(5)
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1'))
    assert_equal(s2.current_calltree_node.code.index, code.indexOf('() =>'))
  }),

  test('frame follows cursor intermediate fn', () => {
    const code = `
      const y = () => {
        z()
      }
      const z = () => {
        1
      }
      const x = i => i == 0 ? y() : x(i - 1)
      x(5)
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1'))
    const s3 = COMMANDS.move_cursor(s2, code.indexOf('z()'))
    assert_equal(s3.current_calltree_node.code.index, code.indexOf('() =>'))
    // Check that node for `y` call was reused
    assert_equal(
      find_node(root_calltree_node(s2), n => n == s3.current_calltree_node) 
                                                                      == null,
      false
    )
  }),

  test('frame follows cursor unreachable fn', () => {
    const code = `
      const x = () => {
        1
        2
      }
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('1'))
    assert_equal(s2.current_calltree_node.toplevel, true)
    assert_equal(s2.active_calltree_node, null)

    // Check that when we move cursor inside unreachable function, find_call
    // not called again
    const s3 = COMMANDS.move_cursor(
      // Set calltree_actions to null, ensure it would not be called again
      {...s2, calltree_actions: null},
      code.indexOf('2')
    )
    assert_equal(s3.active_calltree_node, null)
  }),

  test('frame follows cursor only find_call in entrypoint module', () => {
    const scratch = `import {x} from 'x'; x()`
    const x_code = `export const x = () => 1;   x()`
    const s1 = test_initial_state({
      ''  : scratch,
      'x' : x_code,
    })
    const s2 = COMMANDS.move_cursor(
      {...s1, current_module: 'x'}, 
      x_code.indexOf('1')
    )
    assert_equal(root_calltree_node(s2).module, '')
  }),

  test('stale id in frame function_call.result.calls bug', () => {
    const code = `
      const x = () => {/*x*/
        y()
      }

      const y = () => {
        1 
      }

      x()
    `

    // Eval toplevel frame, id of call (x) will be saved in frame
    const s1 = test_initial_state(code)

    // Expand call of x(), id will be changed (bug)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('y()'))

    // Step into from toplevel to call of x(), the stale id will be used
    const s3 = COMMANDS.move_cursor(s2, code.indexOf('x()'))
    const s4 = COMMANDS.step_into(s3, code.indexOf('x()'))

    assert_equal(s4.active_calltree_node.code.index, code.indexOf('() => {/*x'))
  }),

  test('get_initial_state toplevel not entrypoint', () => {
    const s = test_initial_state(
      {
        ''  : `import {x} from 'x'; x()`,
        'x' : `export const x = () => 1; x()`,
      },
      {
        entrypoint: '',
        current_module: 'x',
      }
    )
    assert_equal(s.current_calltree_node.toplevel, true)
    assert_equal(s.active_calltree_node, null)
  }),

  test('module not evaluated because of error in module it depends on', () => {
    const s = test_initial_state({
      ''  : `import {x} from 'x'`,
      'x' : `
        const has_child_calls = i => i == 0 ? 0 : has_child_calls(i - 1)
        has_child_calls(10)
        console.log('log')
        throw new Error('fail')
      `,
    })
    assert_equal(root_calltree_node(s).module, 'x')

    // Must collect logs from failed module
    assert_equal(s.logs.logs.length, 1)

    const s2 = COMMANDS.move_cursor(
      COMMANDS.change_current_module(s, 'x'),
      s.files['x'].indexOf('throw')
    )
    assert_equal(s2.value_explorer.index, s.files['x'].indexOf('throw'))

    const s3 = COMMANDS.calltree.arrow_right(s)
    assert_equal(s3.current_calltree_node.fn.name, 'has_child_calls')

  }),

  test('logs simple', () => {
    const code = `console.log(10)`
    const i = test_initial_state(code)
    assert_equal(i.logs.logs.length, 1)
    assert_equal(i.logs.logs[0].args, [10])
  }),

  test('logs', () => {
    const code = `
      const deep = x => {
        if(x == 10) {
          console.log(x)
        } else {
          deep(x + 1)
        }
      }

      deep(0)
    `

    const i = test_initial_state(code)
    assert_equal(i.logs.logs.length, 1)
    assert_equal(i.logs.logs[0].args, [10])
    const state = COMMANDS.calltree.navigate_logs_position(i, 0)
    assert_equal(state.logs.log_position, 0)
    assert_equal(state.value_explorer.result.value, [10])
    assert_equal(current_cursor_position(state), code.indexOf('(x)'))
  }),

  test('deferred calls', () => {
    const code = `
      export const fn = (x) => {
        fn2(x)
      }
      
      const fn2 = () => {
        console.log(1)
      }
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].fn(10)

    const state = on_deferred_call(i)
    assert_equal(state.logs.logs.length, 1)

    const call = get_deferred_calls(state)[0]
    assert_equal(call.fn.name, 'fn')
    assert_equal(call.code.index, code.indexOf('(x) => {'))
    assert_equal(call.args, [10])

    // Expand call
    const expanded = COMMANDS.calltree.click(state, call.id)
    assert_equal(get_deferred_calls(expanded)[0].children[0].fn.name, 'fn2')

    // Navigate logs
    const nav = COMMANDS.calltree.navigate_logs_position(expanded, 0)
    assert_equal(nav.current_calltree_node.is_log, true)

    const nav2 = COMMANDS.calltree.arrow_left(nav)
    assert_equal(nav2.current_calltree_node.fn.name, 'fn2')
  }),

  test('deferred calls calltree nav', () => {
    const code = `
      const normal_call = (x) => {
      }

      normal_call(0)
      
      export const deferred_call = (x) => {
      }
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // When there are no deferred calls, and we press arrow down, nothing should
    // happen
    const no_deferred_down = 
      COMMANDS.calltree.arrow_down(
        COMMANDS.calltree.arrow_down(i)
      )

    assert_equal(no_deferred_down.current_calltree_node.fn.name, 'normal_call')

    const after_deferred_calls = [1, 2, 3].reduce(
      (s, a) => {
        // Make deferred calls
        i.modules[''].deferred_call(a)
        return on_deferred_call(s)
      },
      i
    )

    assert_equal(
      get_deferred_calls(after_deferred_calls).map(c => c.args[0]),
      [1,2,3]
    )

    assert_equal(after_deferred_calls.current_calltree_node.toplevel, true)

    const down = COMMANDS.calltree.arrow_down(after_deferred_calls)

    const first_deferred_call_selected = COMMANDS.calltree.arrow_down(
      COMMANDS.calltree.arrow_down(after_deferred_calls)
    )

    // After we press arrow down, first deferred call gets selected
    assert_equal(
      first_deferred_call_selected.current_calltree_node.args[0],
      1,
    )

    // One more arrow down, second deferred call gets selected
    assert_equal(
      COMMANDS.calltree.arrow_down(first_deferred_call_selected)
        .current_calltree_node
        .args[0],
      2
    )

    // After we press arrow up when first deferred call selected, we select last
    // visible non deferred call
    assert_equal(
      COMMANDS.calltree.arrow_up(first_deferred_call_selected)
        .current_calltree_node
        .args[0],
      0
    )

    // After we press arrow left when first deferred call selected, we stay on
    // this call
    assert_equal(
      COMMANDS.calltree.arrow_left(first_deferred_call_selected)
        .current_calltree_node
        .args[0],
      1
    )


  }),

  test('deferred_calls find_call', () => {
    const code = `
      export const fn = () => {
        fn2()
      }
      
      const fn2 = () => {
        console.log(1)
      }
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].fn()

    const state = on_deferred_call(i)

    const moved = COMMANDS.move_cursor(state, code.indexOf('fn2'))
    assert_equal(moved.active_calltree_node.fn.name, 'fn')

    // Move cursor to toplevel and back, find cached (calltree_node_by_loc) call
    const move_back = COMMANDS.move_cursor(
      COMMANDS.move_cursor(moved, 0),
      code.indexOf('fn2')
    )

    assert_equal(move_back.active_calltree_node.fn.name, 'fn')
  }),

  test('deferred_calls find_call then deferred_call bug', () => {
    const code = `
      export const fn = (x) => { /* label */ }
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].fn(1)

    const state = on_deferred_call(i)

    // find call
    const moved = COMMANDS.move_cursor(state, code.indexOf('label'))

    // Make deferred call
    i.modules[''].fn(2)

    const result = on_deferred_call(moved)

    // there was a bug throwing error when added second deferred call
    assert_equal(get_deferred_calls(result).map(c => c.args), [[1], [2]])
  }),

  test('deferred_calls discard on code rerun', () => {
    const code = `
      export const fn = () => { /* label */ }
    `
    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    const input = COMMANDS.input(i, code, 0).state

    // Make deferred call, calling fn from previous code
    i.modules[''].fn(1)

    const result = on_deferred_call(input)

    // deferred calls must be null, because deferred calls from previous executions
    // must be discarded
    assert_equal(get_deferred_calls(result), null)
  }),

  test('async/await await non promise', async () => {
    await assert_code_evals_to_async(
      `
        await 1
      `,
      1
    )
  }),

  test('async/await await Promise resolved immediately', async () => {
    await assert_code_evals_to_async(
      `
        await new Promise(resolve => resolve(1))
      `,
      1
    )
  }),

  test('async/await return from async function', async () => {
    await assert_code_evals_to_async(
      `
        const x = async () => 123
        const y = async () => await x()
        await y()
      `,
      123
    )
  }),

  test('async/await await resolved Promise', async () => {
    await assert_code_evals_to_async(
      `
        await Promise.resolve(123)
      `,
      123
    )
  }),

  test('async/await await Promise resolved with resolved Promise', async () => {
    await assert_code_evals_to_async(
      `
        await Promise.resolve(Promise.resolve(123))
      `,
      123
    )
  }),

  test('async/await await Promise resolved with async', async () => {
    await assert_code_evals_to_async(
      `
        const x = async () => 1
        await Promise.resolve(x())
      `,
      1
    )
  }),

  test('async/await await Promise resolved with rejected Promise', async () => {
    await assert_code_error_async(
      `
        await Promise.resolve(Promise.reject('boom'))
      `,
      'boom',
    )
  }),

  test('async/await await Promise returned from async function', async () => {
    await assert_code_evals_to_async(
      `
        const x = async () => {
          return Promise.resolve(123)
        }
        await x()
      `,
      123
    )
  }),

  test('async/await throw from async function', async () => {
    await assert_code_error_async(
      `
        const x = async () => { throw 'boom' }
        await x()
      `,
      'boom'
    )
  }),

  test('async/await await rejected Promise', async () => {
    await assert_code_error_async(
      `
        await Promise.reject('boom')
      `,
      'boom'
    )
  }),

  test('async/await promise rejected with null', async () => {
    await assert_code_error_async(
      `await Promise.reject()`,
      undefined
    )
  }),

  test('async/await await rejected Promise returned from async', async () => {
    await assert_code_error_async(
      `
        const x = async () => Promise.reject('boom')
        await x()
      `,
      'boom'
    )
  }),

  test('async/await Promise.all', async () => {
    await assert_code_evals_to_async(
      `
        const x = async i => i
        await Promise.all([x(0), x(1), x(2)])
      `,
      [0,1,2]
    )
  }),

  test('async/await calltree', async () => {
    const i = await test_initial_state_async(`
      const x = () => 1
      const delay = async time => {
        await 1
        x()
      }
      await delay(3)
    `)
    const root = root_calltree_node(i)
    assert_equal(root.children.length, 1)
    const call_delay = root.children[0]
    assert_equal(call_delay.fn.name, 'delay')
    assert_equal(call_delay.fn.name, 'delay')
  }),

  test('async/await Promise.all set child promises status ok', async () => {
    const i = await test_initial_state_async(`
      const async_fn = async () => 1
      await Promise.all([1,2,3].map(async_fn))
    `)
    const async_fn_call =
      root_calltree_node(i)
      .children[0] // map
      .children[0] // first call of async_fn
    assert_equal(async_fn_call.value.status.ok, true)
    assert_equal(async_fn_call.value.status.value, 1)
  }),

  test('async/await Promise.all set child promises status error', 
  async () => {
    const i = await test_initial_state_async(`
      const async_fn = async () => { throw 1 }
      await Promise.all([1,2,3].map(async_fn))
    `)
    const async_fn_call =
      root_calltree_node(i)
      .children[0] // map
      .children[0] // first call of async_fn
    assert_equal(async_fn_call.value.status.ok, false)
    assert_equal(async_fn_call.value.status.error, 1)
  }),

  test('async/await logs out of order', async () => {
    const i = await test_initial_state_async(`
      // Init promises p1 and p2 that are resolved in different order (p2 then
      // p1)
      const p2 = Promise.resolve(2)
      const p1 = p2.then(() => 1)

      const log = async p => {
        const v = await p
        console.log(v)
      }

      await Promise.all([log(p1), log(p2)])
    `)
    const logs = i.logs.logs.map(l => l.args[0])
    assert_equal(logs, [2, 1])
  }),

  test('async/await logs out of order timeout', async () => {
    const i = await test_initial_state_async(`
      const delay = async time => {
        await new Promise(res => setTimeout(res, time*10))
        console.log(time)
      }

      await Promise.all([delay(2), delay(1)])
    `)
    const logs = i.logs.logs.map(l => l.args[0])
    assert_equal(logs, [1, 2])
  }),

  test('async/await external async fn', async () => {
    await assert_code_evals_to_async(
      `
        const AsyncFunction = 
          new Function('return (async () => {}).constructor')()
        const async_fn = new AsyncFunction('return 1')
        await async_fn()
      `,
      1
    )
  }),

  test('async/await then bug', async () => {
    await assert_code_evals_to_async(
      `
        const p2 = Promise.resolve(2)
        const p1 = p2.then(() => 1)
        const x = () => 1
        await x()
      `,
      1
    )
  }),

  test('async/await then non-function', async () => {
    await assert_code_evals_to_async(
      `
        await Promise.resolve(1).then(2)
      `,
      1
    )
  }),

  test('async/await Promise.then creates subcall', async () => {
    const i = await test_initial_state_async(`
      const x = () => 1
      await Promise.resolve(1).then(x)
    `)
    const root = root_calltree_node(i)
    assert_equal(root.children.at(-1).fn.name, 'then')
    assert_equal(root.children.at(-1).children[0].fn.name, 'x')
  }),

  test('async/await Promise.catch creates subcall', async () => {
    const i = await test_initial_state_async(`
      const x = () => 1
      await Promise.reject(1).catch(x)
    `)
    const root = root_calltree_node(i)
    assert_equal(root.children.at(-1).fn.name, 'catch')
    assert_equal(root.children.at(-1).children[0].fn.name, 'x')
  }),

  test('async/await native Promise.then creates subcall', async () => {
    const i = await test_initial_state_async(`
      const x = () => 1
      const async_fn = async () => 1
      await async_fn().then(x)
    `)
    const root = root_calltree_node(i)
    assert_equal(root.children.at(-1).children[0].fn.name, 'x')
  }),

  test('async/await await promise wrapped to some data structure', async () => {
    const i = await assert_code_evals_to_async(
      `
        const async_fn = async () => 1
        const x = () => {
          return {promise: async_fn()}
        }
        await x().promise
      `,
      1
    )
  }),

  test('async/await edit', async () => {
    const code = `
      const f = async () => {

      }
      await f()
    `
    const i = await test_initial_state_async(code)
    const code2 = `
      const f = async () => {
        1
      }
      await f()
    `
    const next = await command_input_async(i, code2, code2.indexOf('1'))
    assert_equal(next.active_calltree_node.fn.name, 'f')
    assert_equal(next.value_explorer.result.value, 1)
  }),

  test('async/await move_cursor', async () => {
    const code = `
      const f = async () => {
        1
      }
      await f()
    `
    const i = await test_initial_state_async(code)
    const after_move = await COMMANDS.move_cursor(i, code.indexOf('1'))
    assert_equal(after_move.active_calltree_node.fn.name, 'f')
  }),

  test('async/await move_cursor deferred call', async () => {
    const code = `
      export const fn = async () => {
        await fn2()
      }

      const fn2 = async () => {
        return 1
      }
    `
    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].fn()

    const state = on_deferred_call(i)
    const moved_state = COMMANDS.move_cursor(state, code.indexOf('1'))
    assert_equal(moved_state.active_calltree_node.fn.name, 'fn2')
  }),
  
  test('async/await async deferred call', async () => {
    const code = `
      await new Object()
      export const fn = () => 1
    `
    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    await i.eval_modules_state.promise.__original_then(result => {
      const s = COMMANDS.eval_modules_finished(
        i, 
        i,
        result, 
        i.eval_modules_state.node, 
        i.eval_modules_state.toplevel
      )

      // Make deferred call
      s.modules[''].fn()
      const state = on_deferred_call(s)
      assert_equal(get_deferred_calls(state).length, 1)
      assert_equal(get_deferred_calls(state)[0].value, 1)
    })

  }),

  test('async/await await argument bug', async () => {
    await assert_code_evals_to_async(
      `
        Object.assign({}, await {foo: 1})
      `,
      {foo: 1}
    )
  }),

  test('async/await move_cursor before code evaluated', async () => {
    const i = test_initial_state(` 
      await new Promise(resolve => null)
    `)
    const moved = COMMANDS.move_cursor(i, 0)
    // No assertion, must not throw
  }),

  test('record io', () => {
    // Patch Math.random to always return 1
    patch_builtin('random', () => 1)

    const initial = test_initial_state(`
      const x = Math.random()
    `)
    
    // Now call to Math.random is cached, break it to ensure it was not called
    // on next run
    patch_builtin('random', () => { throw 'fail' })

    const next = COMMANDS.input(initial, `const x = Math.random()*2`, 0).state
    assert_equal(next.value_explorer.result.value, 2)
    assert_equal(next.eval_cxt.io_cache_index, 1)

    // Patch Math.random to return 2. 
    // TODO The first call to Math.random() is cached with value 1, and the
    // second shoud return 2
    patch_builtin('random', () => 2)
    const replay_failed = COMMANDS.input(
      initial, 
      `const x = Math.random() + Math.random()`, 
      0
    ).state

    // TODO must reuse first cached call?
    assert_equal(replay_failed.value_explorer.result.value, 4)

    // Remove patch
    patch_builtin('random', null)
  }),

  test('record io cache discarded if args does not match', async () => {
    // Patch fetch
    patch_builtin('fetch', async () => 'first')

    const initial = await test_initial_state_async(`
      console.log(await fetch('url', {method: 'GET'}))
    `)
    assert_equal(initial.logs.logs[0].args[0], 'first')

    // Patch fetch again
    patch_builtin('fetch', async () => 'second')

    const cache_discarded = await command_input_async(initial, `
      console.log(await fetch('url', {method: 'POST'}))
    `, 0)
    assert_equal(cache_discarded.logs.logs[0].args[0], 'second')

    // Remove patch
    patch_builtin('fetch', null)
  }),

  test('record io fetch rejects', async () => {
    // Patch fetch
    patch_builtin('fetch', () => Promise.reject('fail'))

    const initial = await test_initial_state_async(`
      await fetch('url', {method: 'GET'})
    `)
    assert_equal(root_calltree_node(initial).error, 'fail')

    // Patch fetch again
    patch_builtin('fetch', () => async () => 'result')

    const with_cache = await command_input_async(initial, `
      await fetch('url', {method: 'GET'})
    `, 0)
    assert_equal(root_calltree_node(initial).error, 'fail')

    // Remove patch
    patch_builtin('fetch', null)
  }),

  test('record io preserve promise resolution order', async () => {
    // Generate fetch function which calls get resolved in reverse order
    const {fetch, resolve} = new Function(`
      const calls = []
      return {
        fetch(...args) {
          let resolver
          const promise = new Promise(r => resolver = r)
          calls.push({resolver, promise, args})
          return promise
        },

        resolve() {
          [...calls].reverse().forEach(call => call.resolver(...call.args))
        },
      }
    `)()

    // Patch fetch
    patch_builtin('fetch', fetch)

    const code = `
      await Promise.all(
        [1, 2, 3].map(async v => {
          const result = await fetch(v)  
          console.log(result)
        })
      )
    `

    const initial_promise = test_initial_state_async(code)

    resolve()

    const initial = await initial_promise

    // calls to fetch are resolved in reverse order
    assert_equal(initial.logs.logs.map(l => l.args[0]), [3,2,1])

    // Break fetch to ensure it is not get called anymore
    patch_builtin('fetch', () => {throw 'broken'})

    const with_cache = await command_input_async(
      initial, 
      code,
      0
    )

    // cached calls to fetch should be resolved in the same (reverse) order as
    // on the first run, so first call wins
    assert_equal(with_cache.logs.logs.map(l => l.args[0]), [3,2,1])

    // Remove patch
    patch_builtin('fetch', null)
  }),

  test('record io setTimeout', async () => {
    // Patch fetch to return result in 10ms
    patch_builtin(
      'fetch', 
      () => new Promise(resolve => original_setTimeout(resolve, 10))
    )

    const code = `
      setTimeout(() => console.log('timeout'), 0)
      await fetch().then(() => console.log('fetch'))
    `

    const i = await test_initial_state_async(code)

    // First executed setTimeout, then fetch
    assert_equal(i.logs.logs.map(l => l.args[0]), ['timeout', 'fetch'])

    // Break fetch to ensure it would not be called
    patch_builtin('fetch', async () => {throw 'break'})

    const with_cache = await command_input_async(i, code, 0)

    // Cache must preserve resolution order
    assert_equal(with_cache.logs.logs.map(l => l.args[0]), ['timeout', 'fetch'])

    patch_builtin('fetch', null)
  }),

  test('record io clear io cache', async () => {
    const s1 = test_initial_state(`Math.random()`)
    const rnd = s1.value_explorer.result.value
    const s2 = COMMANDS.input(s1, `Math.random() + 1`, 0).state
    assert_equal(s2.value_explorer.result.value, rnd + 1)
    const cleared = COMMANDS.clear_io_cache(s2)
    assert_equal(
      cleared.value_explorer.result.value == rnd + 1,
      false
    )
  }),

  test('record io no io cache on deferred calls', async () => {
    const code = `
      const x = Math.random
      export const fn = () => x()
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].fn()

    const state = on_deferred_call(i)

    // Deferred calls should not be record in cache
    assert_equal(state.eval_cxt.io_cache.length, 0)
  }),

  test('record io discard prev execution', () => {
    // Populate cache
    const i = test_initial_state(`Math.random(0)`)
    const rnd = i.active_calltree_node.children[0].value

    // Run two versions of code in parallel
    const next = COMMANDS.input(i, `await Promise.resolve()`, 0)
    const next2 = COMMANDS.input(i, `Math.random(1)`, 0).state
    const next_rnd = i.active_calltree_node.children[0].value
    assert_equal(rnd, next_rnd)
  }),
]
