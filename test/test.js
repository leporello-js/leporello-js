import {find_leaf, ancestry, find_node} from '../src/ast_utils.js'
import {print_debug_node} from '../src/parse_js.js'
import {eval_frame, eval_modules} from '../src/eval.js'
import {COMMANDS, with_version_number_of_log} from '../src/cmd.js'
import {header} from '../src/value_explorer_utils.js'
import {
  root_calltree_node, 
  active_frame, 
  pp_calltree, 
  get_deferred_calls,
  current_cursor_position,
  get_execution_paths,
} from '../src/calltree.js'

import {color_file} from '../src/color.js'
import {
  test, 
  test_only,
  assert_equal, 
  stringify, 
  do_parse,
  assert_code_evals_to, assert_code_evals_to_async,
  assert_code_error, assert_code_error_async,
  assert_versioned_value, assert_value_explorer, assert_selection,
  parse_modules,
  test_initial_state, test_initial_state_async,
  test_deferred_calls_state,
  print_debug_ct_node,
  command_input_async,
  patch_builtin,
  original_setTimeout,
} from './utils.js'

export const tests = [

  test('reserved words', () => {
    const result = do_parse('let catch')
    assert_equal(result.ok, false)
    assert_equal(result.problems[0].index, 4)
  }),

  test('invalid token in the beginning', () => {
    const result = do_parse('# import')
    assert_equal(result, { 
      ok: false, 
      problems: [ { message: 'unexpected lexical token', index: 0 } ] 
    })
  }),

  test('invalid token in the middle', () => {
    const result = do_parse(': # import')
    assert_equal(result, { 
      ok: false, 
      problems: [ { message: 'unexpected lexical token', index: 2 } ] 
    })
  }),

  test('invalid token in the end', () => {
    const result = do_parse(': ^')
    assert_equal(result, { 
      ok: false, 
      problems: [ { message: 'unexpected lexical token', index: 2 } ] 
    })
  }),

  test('empty program', () => {
    const i = test_initial_state('')
    const frame = active_frame(i)
    assert_equal(frame.children, [])
    assert_equal(frame.result, {ok: true})
  }),
  
  test('empty if branch', () => {
    const r = do_parse(`
      if(true) {
      } else {
      }
    `)
    assert_equal(r.ok, true)
  }),

  test('Must be finished by eof', () => {
    const result = do_parse('}')
    assert_equal(result.ok, false)
  }),

  test('Only semicolons', () => {
    const i = test_initial_state(';;;;')
    const frame = active_frame(i)
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

  // TODO
  // test('backtick_string let vars', () => {
  //   assert_code_evals_to(
  //     'let x = `b`; `a${x}a`',
  //     'aba',
  //   )
  // }),

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
    const code = `
      const x = 1
      const y = () => x;
      y()
    `
    const i = test_initial_state(code, code.indexOf('x;'))
    const frame = active_frame(i)
    assert_equal(frame.children[1].result.value, 1)
  }),

  
  //  foo() call fails when tries to get closed variables, because
  //  NOT_INITIALIZED is not initialized at the moment `foo` is called
  //  TODO fix later

  //  test('closure bug', () => {
  //    test_initial_state(`
  //      foo()
  //      const NOT_INITIALIZED = 1
  //      function foo(){
  //        return NOT_INITIALIZED
  //      }
  //    `)
  //  }),


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

  /*
  test('let variable', () => {
    const code = `
      let x, y = 2, unused, [z,q] = [3,4]
      x = 1
    `
    const i = test_initial_state(code, code.indexOf('x'))
    assert_equal(i.value_explorer.result.value, {y: 2, z: 3, q: 4})
  }),
  */

  test('let variable not initialized bug', () => {
    const code = `
      let x
      x /*label*/
    `
    const i = test_initial_state(code, code.indexOf('x /*label'))
    assert_equal(i.value_explorer.result.ok, true)
    assert_equal(i.value_explorer.result.value === undefined, true)
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
    const i = test_initial_state( `
      const y = () => x;
      const x = 1;
      y();
    `)
    assert_equal(root_calltree_node(i).children[0].value, 1)
  }),

  test('nested closure', () => {
    assert_code_evals_to(
      `
        const x = () => () => y
        const y = 1
        x()()
      `,
      1
    )
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

  test('parse assignment error', () => {
    const code = `
      const x = [0]
      x[0] = 1, x?.[0] = 2
    `
    const parse_result = do_parse(code)
    assert_equal(parse_result.ok, false)
  }),

  test('parse assignment ok', () => {
    const code = `
      const x = [0]
      x[0] = 1
    `
    const parse_result = do_parse(code)
    assert_equal(parse_result.ok, true)
  }),

  test('ASI_1', () => {
    const parse_result = do_parse(`
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
    const parse_result = do_parse(`
      1
      2
    `)
    assert_equal(parse_result.ok, true)
    assert_equal(
      parse_result.node.children.map(c => c.type),
      ['number', 'number']
    )
  }),

  test('ASI_restricted', () => {
    assert_equal(
      do_parse(`
        return
        1
      `).ok,
      true
    )
    assert_equal(
      do_parse(`
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

  /* TODO
  test('named function scope', () => {
    const code = 'const x = function y() { y }'
    const parse_result = do_parse(code)
    assert_equal(parse_result.ok, true)
  }),
  */

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
    const i = test_initial_state(`
      1 + 1
    `)
    assert_equal(active_frame(i).children[0].result.value, 2)
  }),

  test('eval_frame instanceof', () => {
    assert_code_evals_to('1 instanceof Object', false)
    assert_code_evals_to('{} instanceof Object', true)
  }),

  test('eval_frame grouping', () => {
    const i = test_initial_state('(1+1)')
    assert_equal(active_frame(i).children[0].result.value, 2)
  }),

  test('eval_frame member_access', () => {
    const i = test_initial_state('{foo: "bar"}["foo"]')
    assert_equal(active_frame(i).children[0].result.value, 'bar')
  }),

  test('eval_frame member_access null', () => {
    const frame = active_frame(test_initial_state('null["foo"]'))
    const result = frame.children[0].result
    assert_equal(result.ok, false)
    assert_equal(
      result.error, 
      new TypeError("Cannot read properties of null (reading 'foo')")
    )
  }),

  test('eval_frame new', () => {
    const i = test_initial_state('new Error("foobar")')
    assert_equal(active_frame(i).children[0].result.value.message, 'foobar')
  }),

  test('eval_frame function_call', () => {
    const i = test_initial_state(`
      const x = () => 1;
      2 * x();
    `)
    assert_equal(active_frame(i).children[1].result.value, 2)
  }),

  test('eval_frame function_body_expr', () => {
    const code = `
      const x = y => y;
      x(2);
    `
    const i = test_initial_state(code, code.indexOf('y;'))
    const result = active_frame(i).children[1].result
    assert_equal(result.ok, true)
    assert_equal(result.value, 2)
  }),

  test('eval_frame function_body_do', () => {
    const code = `
      const x = y => {
        return y;
        const z = 1;
      };
      x(2);
    `
    const i = test_initial_state(code, code.indexOf('return y'))
    const frame = active_frame(i)
    const ret = frame.children[1].children[0]
    const z_after_ret = frame.children[1].children[1]
    assert_equal(ret.result, {ok: true})
    assert_equal(z_after_ret.result, null)
  }),

  test('eval_frame if', () => {
    const i = test_initial_state(`
      if(1) {
        const x = 1;
      } else {
        const x = 1;
      }
    `)
    const frame = active_frame(i)
    const _if = frame.children[0]
    assert_equal(_if.children[0].result.ok, true)
    assert_equal(_if.children[0].result.value, 1)
    assert_equal(_if.children[1].result, {ok: true})
    assert_equal(_if.children[2].result, null)
  }),

  test('eval_frame if without else', () => {
    const i = test_initial_state(`
      if(1) {
        const x = 1;
      }
    `)
    const frame = active_frame(i)
    const _if = frame.children[0]
    assert_equal(_if.children.length, 2)
    assert_equal(_if.children[0].result.ok, true)
    assert_equal(_if.children[0].result.value, 1)
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
    assert_equal(
      find_node(frame, n => n.string == 'b').result.value,
      2
    )
  }),

  test('eval_frame error', () => {
    const code = `
      const x = ({a}) => 0;
      x(null);
    `
    const frame = active_frame(
      test_initial_state(code, code.indexOf('0'))
    )
    assert_equal(frame.result, {ok: false})
  }),

  test('eval_frame binary &&', () => {
    const frame = active_frame(test_initial_state(`
      const x = () => 1;
      const y = () => 2;
      false && x();
      y();
    `))
    assert_equal(frame.children[3].result.value, 2)
  }),

  test('eval_frame binary ||', () => {
    const frame = active_frame(test_initial_state(`
      const x = () => 1;
      const y = () => 2;
      true || x();
      y();
    `))
    assert_equal(frame.children[3].result.value, 2)
  }),

  test('eval_frame binary ??', () => {
    const frame = active_frame(test_initial_state(`
      const x = () => 1;
      const y = () => 2;
      1 ?? x();
      y();
    `))
    assert_equal(frame.children[3].result.value, 2)
  }),

  test('eval_frame null call', () => {
    const frame = active_frame(test_initial_state(`null()`))
    assert_equal(frame.children[0].result.ok, false)
  }),

  test('eval_frame non-function call bug', () => {
    const frame = active_frame(test_initial_state(`Object.assign({}, {}); null()`))
    assert_equal(frame.children[frame.children.length - 1].result.ok, false)
  }),

  test('eval_frame destructuring args', () => {
    const code = `
      const x = (...a) => a;
      x(1,2,3);
    `
    const i = test_initial_state(code, code.indexOf('a;'))
    const frame = active_frame(i)
    assert_equal(frame.children[0].children[0].children[0].result.value, [1,2,3])
  }),

  test('eval_frame default arg', () => {
    const code = `
      const x = 1
      function y(z = x) {
        return z 
      }
      y()
    `
    const i = test_initial_state(code, code.indexOf('return z'))
    const frame = active_frame(i)
    assert_equal(
      // value for z in return statement
      find_node(frame.children[1], n => n.value == 'z').result.value,
      1
    )
    // TODO not implemented
    //assert_equal(
    //  // value for x in arguments
    //  find_node(frame.children[0], n => n.value == 'x').result.value,
    //  1
    //)
  }),

  test('eval_frame const lefthand', () => {
    const code = `
      const x = 1
    `
    const initial = test_initial_state(code)
    const frame = active_frame(initial)
    const x = find_node(frame, n => n.string == 'x')
    assert_equal(x.result.value, 1)
    assert_equal(x.result.version_number, 0)
  }),

  test('bare return statement', () => {
    const code = `
      function test() {
        return
      }
      test() /*call*/
    `
    assert_value_explorer(
      test_initial_state(code, code.indexOf('test() /*call*/')),
      undefined,
    )
    assert_value_explorer(
      test_initial_state(code, code.indexOf('return')),
      undefined,
    )
  }),

  test('array spread not iterable', () => {
    assert_code_error(
      `[...null]`,
      new Error('null is not iterable'),
    )
  }),

  test('args spread not iterable', () => {
    assert_code_error(
      `
        function x() {} 
        x(...null)
      `,
      new Error('null is not iterable'),
    )
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
    const result = do_parse(`
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
    assert_equal(effects[0].type, 'write')
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

  test('export value explorer', () => {
    const code = 'export const x = 1'
    const i = test_initial_state(code)
    assert_equal(i.value_explorer.result.value, 1)
  }),

  // Static analysis

  test('undeclared', () => {
    const undeclared_test = `
      const foo = 1;
      const bar = baz => qux(foo, bar, baz, quux);
      const qux = 3;
    `
    const result = do_parse(undeclared_test)
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
    return assert_equal(do_parse(code).problems[0].message, 'undeclared identifier: x')
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
  
  test('await only inside async fns', () => {
    const parse_result = do_parse('function x() { await 1 }')
    assert_equal(parse_result.ok, false)
  }),
  
  test('identifier has already been declared', () => {
    const code = `
      const x = 1
      const x = 2
    `
    const i = test_initial_state(code)
    assert_equal(i.parse_result.ok, false)
    assert_equal(
      i.parse_result.problems, 
      [
        {
          index: code.indexOf('x = 2'),
          length: 1,
          message: "Identifier 'x' has already been declared",
          module: '',
        }
      ]
    )
  }),

  test('identifier has already been declared in fn arg', () => {
    const code = `
      function foo(x) {
        const x = 1
      }

    `
    const i = test_initial_state(code)
    assert_equal(i.parse_result.ok, false)
    assert_equal(
      i.parse_result.problems, 
      [
        {
          index: code.indexOf('x = 1'),
          length: 1,
          message: "Identifier 'x' has already been declared",
          module: '',
        }
      ]
    )
  }),

  test('identifier has been declared twice in args', () => {
    const code = `
      function foo({x,x}) {
      }

    `
    const i = test_initial_state(code)
    assert_equal(i.parse_result.ok, false)
    assert_equal(
      i.parse_result.problems, 
      [
        {
          index: code.indexOf('x}'),
          length: 1,
          message: "Identifier 'x' has already been declared",
          module: '',
        }
      ]
    )
  }),
  
  test('identifier has already been declared fn decl', () => {
    const code = `
      const x = 1
      function x() {
      }
    `
    const i = test_initial_state(code)
    assert_equal(i.parse_result.ok, false)
    assert_equal(
      i.parse_result.problems, 
      [
        {
          index: code.indexOf('function x()'),
          length: 1,
          message: "Identifier 'x' has already been declared",
          module: '',
        }
      ]
    )
  }),
  
  test('identifier has already been declared export', () => {
    const code = `
      export const x = 1
      function x() {
      }
    `
    const i = test_initial_state(code)
    assert_equal(i.parse_result.ok, false)
    assert_equal(
      i.parse_result.problems, 
      [
        {
          index: code.indexOf('function x()'),
          length: 1,
          message: "Identifier 'x' has already been declared",
          module: '',
        }
      ]
    )
  }),
  
  test('identifier has already been declared import', () => {
    const code = {
      '': `
        import {x} from 'x.js'
        function x() {
        }
      `,
      'x.js': `
        export const x = 1
      `
    }
    const i = test_initial_state(code)
    assert_equal(i.parse_result.ok, false)
    assert_equal(
      i.parse_result.problems, 
      [
        {
          index: code[''].indexOf('function x()'),
          length: 1,
          message: "Identifier 'x' has already been declared",
          module: '',
        }
      ]
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
    return assert_equal(do_parse(test).problems[0].message, 'undeclared identifier: x')
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
  }),

  test('multiple assignments', () => {
    assert_code_evals_to(
      `
        let x, y
        x = 1, y = 2
        {x,y}
      `,
      {x: 1, y: 2}
    )
  }),

  /* TODO assignments destructuring
  test('multiple assignments destructuring', () => {
    assert_code_evals_to(
      `
        let x, y
        x = 1, {y} = {y: 2}
        {x,y}
      `,
      {x: 1, y: 2}
    )
  }),
  */

  test('assigments value explorer', () => {
    const code = `
      let x
      x = 1
    `
    const i = test_initial_state(code, code.indexOf('x = 1'))
    assert_equal(i.value_explorer.result.value, 1)
  }),

  test('multiple assigments value explorer', () => {
    const code = `
      let x, y
      x = 1, y = 2
    `
    const i = test_initial_state(code, code.indexOf('x = 1'))
    assert_equal(i.value_explorer.result.value, {x: 1, y: 2})
  }),

  /* TODO
  test('assignments destructuring value explorer', () => {
    const code = `
      let x, y
      x = 1, {y} = {y:2}
    `
    const i = test_initial_state(code, code.indexOf('x = 1'))
    assert_equal(i.value_explorer.result.value, {x: 1, y: 2})
  }),
  */

  test('assigments error', () => {
    const code = `
      let x, y
      x = 1, y = null.foo
    `
    const i = test_initial_state(code, code.indexOf('x = 1'))
    assert_equal(i.value_explorer.result.ok, false)
  }),

  test('block scoping const', () => {
    assert_code_evals_to(
      `
        const x = 0
        if(true) {
          const x = 1
        }
        x
      `,
      0
    )
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

  test('block scoping shadow bug', () => {
    assert_code_evals_to(
      `
        let y = 3
        if(true) {
          let y
          y = 1
          if(true) {
            let y
            y = 2
          }
          y
        }
        y
      `,
      3
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

  test('step_into native bug', () => {
    const code = `Object()`
    const initial = test_initial_state(code)
    const {state, effects} = COMMANDS.step_into(initial, 0)
    assert_equal(initial == state, true)
    assert_equal(effects, {
      "type": "set_status",
      "args": [
        "Cannot step into: function is either builtin or from external lib"
      ]
    })
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
          result: { ok: false, is_error_origin: true } 
        }
      ]
    )

    const x_call = root_calltree_node(initial).children[0]
    const step_into = COMMANDS.calltree.select_and_toggle_expanded(initial, x_call.id)
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
          result: { ok: false, is_error_origin: true } 
        },
        { 
          index: code.indexOf('x()'), 
          length: "x()".length, 
          result: { ok: false, is_error_origin: true } 
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
      [ { index: 1, length: 7, result: { ok: false, is_error_origin: true } } ],
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
    const x_call = root_calltree_node(initial).children[0]
    const step_into = COMMANDS.calltree.select_and_toggle_expanded(initial, x_call.id)

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
          result: { ok: false, is_error_origin: true } 
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

  test('coloring function body after move inside', () => {
    const code = `
      const x = () => {
        1
      }
      x()
    `
    const i = test_initial_state(code)
    const moved = COMMANDS.move_cursor(i, code.indexOf('1'))
    const coloring = color_file(moved, '')
    const color_body = coloring.find(c => c.index == code.indexOf('('))
    assert_equal(color_body.result.ok, true)
  }),

  test('coloring error with nested fns', () => {
    const code = `[1].map(_ => {throw new Error()}).map(x => x + 1)`
    const i = test_initial_state(code)
    const coloring = color_file(i, '')

    const result = {ok: false, is_error_origin: true}
    assert_equal(
      coloring,
      [
        {
          index: 0, 
          length: code.indexOf('_ =>'),
          result
        },
        {
          index: code.indexOf(').map(x =>'), 
          length: 1,
          result
        },
      ]
      
    )
  }),

  test('better parse errors', () => {
    const code = `
      const x = z => {
        1 2
      }
    `
    const r = do_parse(code)
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
    const r = do_parse(code)
    assert_equal(r.ok, false)
    const p = r.problems[0]
    assert_equal(p.index, code.indexOf(','))
  }),
  
  test('better parse errors 3', () => {
    const code = `[() => { , }] `
    const r = do_parse(code)
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

    const s2 = COMMANDS.calltree.select_and_toggle_expanded(
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
      n.calltree_node_by_loc.get('').get(edited.indexOf('foo =>')) == null,
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
    assert_equal(first.value, 10)
    const s2 = COMMANDS.calltree.select_and_toggle_expanded(s, first.id)
    const first2 = root_calltree_node(s2).children[0]
    assert_equal(first2.children[0].value, 9)
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
    const expanded_new_call = COMMANDS.calltree.select_and_toggle_expanded(s, new_call.id)
    const x_call = root_calltree_node(expanded_new_call)
      .children.at(-1)
      .children[0]
    assert_equal(x_call.fn.name, 'x')
  }),

  test('expand_calltree_node native', () => {
    const s = test_initial_state(`[1,2,3].map(x => x + 1)`)
    const map = root_calltree_node(s).children[0]
    const s2 = COMMANDS.calltree.select_and_toggle_expanded(s, map.id)
    const map_expanded = root_calltree_node(s2).children[0]
    assert_equal(map_expanded.children.length, 3)
  }),

  test('value_explorer arguments', () => {
    const i = test_initial_state(`
      function foo(x, {y}) {
      }

      foo(1, {y: 2})
    `)
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, root_calltree_node(i).children[0].id)
    const args = expanded.value_explorer.result.value['*arguments*']
    assert_equal(args, {value: {x: 1, y: 2}})
  }),

  test('click native calltree node', () => {
    const s = test_initial_state(`Object.fromEntries([])`)
    const index = 0 // Where call starts
    const call = root_calltree_node(s).children[0]
    const state = COMMANDS.calltree.select_and_toggle_expanded(s, call.id)
    assert_equal(current_cursor_position(state), index)
    assert_equal(
      state.value_explorer,
      {
        index,
        result: {
          "ok": true,
          "is_calltree_node_explorer": true,
          "value": {
            "*arguments*": {
              value: [
                []
              ],
            },
            "*return*": {
              value: {},
            }
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

    const assert_loc = (s, substring) => {
      const state = COMMANDS.calltree.arrow_right(s)
      const index = code.indexOf(substring)
      assert_equal(current_cursor_position(state), index)
      assert_equal(active_frame(state) != null, true)
      return state
    }


    const s1 = test_initial_state(code)

    // Select call of `y()`
    const s2 = assert_loc(s1, 'y([')

    // Expand call of `y()`
    const s3 = assert_loc(s2, 'arr =>')

    // Select call of arr.map
    const s4 = assert_loc(s3, 'arr.map')

    // Expand call of arr.map
    // native call is not expandable
    const s5 = assert_loc(s4, 'arr.map')

    // Select call of x
    const s6 = assert_loc(s5, 'foo =>')
  }),

  test('jump_calltree select callsite', () => {
    const code = `
      function x(y) {}
      x()
    `
    const i = test_initial_state(code)
    const call_selected = COMMANDS.calltree.arrow_right(i)
    const node = call_selected.selection_state.node
    assert_equal(node.index, code.indexOf('x()'))
    assert_equal(node.length, 'x()'.length)
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
    const s2 = COMMANDS.calltree.select_and_toggle_expanded(s, call_fn.id)
    const good = s2.current_calltree_node.children[0]
    assert_equal(good.code.index, code.indexOf('() => {/*good'))
  }),

  test('jump_calltree select another call of the same fn', () => {
    const code = '[1,2].map(x => x*10)'
    const i = test_initial_state(code, code.indexOf('10'))
    assert_equal(i.value_explorer.result.value, 10)
    const second_iter = COMMANDS.calltree.arrow_down(i)
    const moved = COMMANDS.move_cursor(second_iter, code.indexOf('x*10'))
    assert_equal(moved.value_explorer.result.value, 20)
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
  
  test('eval_selection bug', () => {
    const code = `{foo: 1}`
    const i = test_initial_state(code)
    const index = code.indexOf('1')
    const moved = COMMANDS.move_cursor(i, index)
    const selection = COMMANDS.eval_selection(moved, index, true).state
    const selection2 = COMMANDS.eval_selection(selection, index, true).state
    const selection3 = COMMANDS.eval_selection(selection2, index, false).state
    assert_equal(selection3.selection_state.node.value, '1')
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

      return find_target(node.children[1], i + 1)
    }

    const [depth, target] = find_target(first)
    assert_equal(depth, 10)
    assert_equal(target.args, [10])

    const target2 = target.children[0]
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
    assert_equal(s3.state.value_explorer.result.ok, true)
    assert_equal(s3.state.value_explorer.result.value, [1])
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
    assert_equal(
      s3.state.value_explorer.result, 
      {
        ok: true, 
        value: {a: 1},
        version_number: 0,
      }
    )
    assert_equal(current_cursor_position(s3.state), code.indexOf('(a)'))
    assert_equal(s3.effects, {type: 'set_focus'})
  }),

  test('select_arguments new call', () => {
    const code = `new String("1")`
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.calltree.arrow_right(s1)
    const s3 = COMMANDS.calltree.select_arguments(s2).state
    assert_equal(s3.value_explorer.result.ok, true)
    assert_equal(s3.value_explorer.result.value, ["1"])
  }),

  test('select_error', () => {
    const code = `
      const deep = x => {
        if(x == 10) {
          throw new Error()
        } else {
          deep(x + 1)
        }
      }

      deep(0)
    `
    const i = test_initial_state(code, code.indexOf('deep(x + 1)'))
    const {state: found_err_state, effects} = COMMANDS.calltree.select_error(i)
    assert_equal(found_err_state.active_calltree_node.args, [10])
    assert_equal(current_cursor_position(found_err_state), code.indexOf('throw'))
  }),

  test('select_error in native fn', () => {
    const code = `
      function x() {
        Object.entries(null)
      }
      
      x()
    `
    const i = test_initial_state(code)
    const {state: found_err_state} = COMMANDS.calltree.select_error(i)
    assert_equal(found_err_state.active_calltree_node.fn.name, 'x')
    assert_equal(
      current_cursor_position(found_err_state), 
      code.indexOf('Object.entries')
    )
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
    const selected = '(a, b)'
    assert_equal(s4.value_explorer, {
      index: code.indexOf(selected),
      length: selected.length,
      result: {ok: true, value: {a: 1, b: 2}, version_number: 0},
    })
  }),

  test('move_cursor concise fn', () => {
    const code = `
      const x = y => y*2
      x(2)
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('2'))
    assert_equal(s2.value_explorer.index, code.indexOf('y*2'))
    assert_equal(s2.value_explorer.length, 3)
    assert_equal(s2.value_explorer.result.ok, true)
    assert_equal(s2.value_explorer.result.value, 4)
  }),

  test('move_cursor let', () => {
    const code = `
      let x = 1
    `
    const s1 = test_initial_state(code)
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('x'))
    const lettext = 'let x = 1'
    assert_equal(s2.value_explorer, {
      index: code.indexOf(lettext),
      length: lettext.length,
      result: {ok: true, value: 1, version_number: 0},
    })
  }),

  test('move_cursor destructuring default', () => {
    const code = `const [x = 1, y] = [undefined, 2]`
    const s = test_initial_state(code)
    assert_equal(s.value_explorer.result.value, {x: 1, y: 2})
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

  test('move_cursor error in fn args bug', () => {
    const code = `
    function x() {} 
    x(null.foo)
    `
    const i = test_initial_state(code)
    
    const m = COMMANDS.move_cursor(i, code.indexOf('x(null'))
    assert_equal(
      m.value_explorer.result.error, 
      new TypeError("Cannot read properties of null (reading 'foo')")
    )
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
    assert_equal(s3.rt_cxt == null, false)
    const s4 = COMMANDS.move_cursor(
      {...s3, 
        // Set rt_cxt to null, ensure eval would not be called again
        rt_cxt: null
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
    assert_equal(s2.rt_cxt != null, true)
    const s3 = COMMANDS.move_cursor(
      // Set rt_cxt to null, ensure it would not be called again
      {...s2, rt_cxt: null},
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

  test('find branch initial', () => {
    const code = `
      function x(cond) {
        if(cond) {
          return true
        } else {
          return false
        }
      }

      x(true)
      x(false)
    `
    const i = test_initial_state(code, code.indexOf('return false'))
    assert_equal(i.value_explorer.result.value, false)
  }),

  test('find branch empty branch', () => {
    const code = `
      function x(cond) {
        if(cond) {
          /* label */
        }
      }

      x(false)
      x(true)
    `
    const i = test_initial_state(code, code.indexOf('label'))
    assert_equal(i.active_calltree_node.args[0], true)
  }),

  test('find branch move_cursor', () => {
    const code = `
      function x(cond) {
        if(cond) {
          return true
        } else {
          return false
        }
      }

      x(true)
      x(false)
    `
    const i = test_initial_state(code)
    const moved = COMMANDS.move_cursor(i, code.indexOf('return false'))
    assert_equal(moved.value_explorer.result.value, false)
    assert_equal(
      i.colored_frames != moved.colored_frames,
      true
    )
  }),

  test('find branch ternary', () => {
    const code = `
      function x(cond) {
        return cond ? true : false
      }

      x(true)
      x(false)
    `
    const i = test_initial_state(code, code.indexOf('false'))
    assert_equal(i.value_explorer.result.value, false)
  }),

  test('find branch move cursor within fn', () => {
    const code = `
      function x(cond) {
        if(cond) {
          return true
        } else {
          return false
        }
      }

      x(true)
      x(false)
    `
    const i = test_initial_state(code)
    const s1 = COMMANDS.move_cursor(i, code.indexOf('return false'))
    const s2 = COMMANDS.move_cursor(s1, code.indexOf('return true'))
    assert_equal(s2.value_explorer.result.value, true)
    assert_equal(
      s1.colored_frames != s2.colored_frames,
      true
    )
  }),

  test('find branch fibonacci', () => {
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
    const moved = COMMANDS.move_cursor(i, code.indexOf('return n'))
    assert_equal(moved.value_explorer.result.value, 1)
  }),

  test('find branch after if with return', () => {
    const code = `
      function x(cond) {
        if(cond) {
          return true
        }
        1
      }
      x(true)
      x(false)
    `
    const i = test_initial_state(code, code.indexOf('1'))
    assert_equal(i.value_explorer.result.value, 1)
  }),

  test('find branch after if with return complex', () => {
    const code = `
      function x(a, b) {
        if(a) {
          return true
        }
        if(a) {
          return true
        }
        if(b) {
          return true
        } else {
          if(false) {
            return null
          }
          1
        }

      }
      x(true)
      x(false, true)
      x(false, false)
    `
    const i = test_initial_state(code, code.indexOf('1'))
    assert_equal(i.value_explorer.result.value, 1)
    assert_equal(i.active_calltree_node.args, [false, false])
  }),

  test('find branch get_execution_paths', () => {
    const code = `
      function x() {
        if(true) {/*1*/
        }
        if(false) {
        } else {/*2*/
          if(true) {/*3*/
            true ? 4 : 5
          }
          return null
        }
        // not executed
        if(true) {
        }
        // not executed
        true ? 6 : 7
      }
      x()
    `
    const i = test_initial_state(code, code.indexOf('if'))
    assert_equal(
      [...get_execution_paths(active_frame(i))].toSorted((a,b) => a - b),
      [
        code.indexOf('if(true)') + 1,
        code.indexOf('/*1*/') - 1,
        code.indexOf('/*2*/') - 1,
        code.indexOf('if(true) {/*3*/') + 1,
        code.indexOf('/*3*/') - 1,
        code.indexOf('4'),
      ]
    )
  }),

  test('find branch get_execution_paths consice body', () => {
    const code = `
      const x = () => true ? 1 : 2
      x()
    `
    const i = test_initial_state(code, code.indexOf('true'))
    assert_equal(
      get_execution_paths(active_frame(i)),
      [code.indexOf('1')],
    )
  }),

  test('find branch get_execution_paths nested fn', () => {
    const code = `
      function x() {
        function y() {
          true ? 1 : 2
        }
      }
      x()
    `
    const i = test_initial_state(code, code.indexOf('{'))
    assert_equal(
      get_execution_paths(active_frame(i)),
      [],
    )
  }),

  test('find branch jump_calltree_node', () => {
    const code = `
      function test(x) {
        if(x > 0) {
          'label'
        }
      }
      test(1)
      test(2)
    `
    const i = test_initial_state(code, code.indexOf('label'))
    assert_equal(i.active_calltree_node.args[0], 1)
    // select second call
    const second = COMMANDS.calltree.select_and_toggle_expanded(i, root_calltree_node(i).children[1].id)
    assert_equal(second.active_calltree_node.args[0], 2)
  }),

  test('find branch preserve selected calltree node when moving inside fn', () => {
    const code = `
      function x(cond) {
        if(cond) {
          true
        } else {
          false
        }
        'finish'
      }
      x(true)
      x(false)
    `
    const i = test_initial_state(code)
    const first_call_id = root_calltree_node(i).children[0].id
    // explicitly select first call
    const selected = COMMANDS.calltree.select_and_toggle_expanded(i, first_call_id)
    // implicitly select second call by moving cursor
    const moved = COMMANDS.move_cursor(selected, code.indexOf('false'))
    const finish = COMMANDS.move_cursor(moved, code.indexOf('finish'))
    assert_equal(finish.active_calltree_node.id, first_call_id)
  }),

  test('find branch select calltree node from logs', () => {
    const code = `
      function f(x) {
        if(x > 1) {
          console.log(x)
        } else {
          console.log(x)
        }
      }
      f(5)
      f(10)
    `
    const i = test_initial_state(code)
    const log_selected = COMMANDS.calltree.navigate_logs_position(i, 1)
    const moved = COMMANDS.move_cursor(
      log_selected, 
      code.indexOf('console.log')
    )
    assert_equal(moved.active_calltree_node.args, [10])
  }),

  test('find branch deferred calls', () => {
    const code = `
      export const foo = arg => {
        return arg
      }
      foo(1)
    `
    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].foo(2)

    const state = on_deferred_call(i)
    const call = get_deferred_calls(state)[0]
    assert_equal(call.value, 2)

    // Expand call
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(state, call.id)
    const moved = COMMANDS.move_cursor(expanded, code.indexOf('return arg'))
    assert_equal(moved.active_calltree_node.value, 2)
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
      undefined,
      {
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
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(state, call.id)
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

  test('deferred_calls several calls bug', () => {
    const code = `
      export const fn = i => i == 0 ? 0 : fn(i - 1)
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].fn(10)

    const state = on_deferred_call(i)
    const call = get_deferred_calls(state)[0]
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(state, call.id)
    // Make deferred call again. There was a runtime error
    expanded.modules[''].fn(10)
  }),

  test('deferred_calls find call bug', () => {
    const code = `
      export const fn = () => 1
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    const moved = COMMANDS.move_cursor(i, code.indexOf('1'))
    assert_equal(moved.active_calltree_node, null)

    // Make deferred call
    moved.modules[''].fn(10)

    const after_call = on_deferred_call(moved)
    const moved2 = COMMANDS.move_cursor(after_call, code.indexOf('1'))

    assert_equal(moved2.active_calltree_node.value, 1)
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
    assert_equal(next.rt_cxt.io_trace_index, 1)

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


  test('record io trace discarded if args does not match', async () => {
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

  test('record io clear io trace', async () => {
    const s1 = test_initial_state(`Math.random()`)
    const rnd = s1.value_explorer.result.value
    const s2 = COMMANDS.input(s1, `Math.random() + 1`, 0).state
    assert_equal(s2.value_explorer.result.value, rnd + 1)
    const cleared = COMMANDS.clear_io_trace(s2)
    assert_equal(
      cleared.value_explorer.result.value == rnd + 1,
      false
    )
  }),

  test('record io no io trace on deferred calls', async () => {
    const code = `
      const x = Math.random
      export const fn = () => x()
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].fn()

    const state = on_deferred_call(i)

    // Deferred calls should not be record in cache
    assert_equal(state.rt_cxt.io_trace.length, 0)
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

  test('record io Date', () => {
    assert_equal(
      test_initial_state('new Date()').io_trace.length,
      1
    )
    assert_equal(
      test_initial_state('new Date("2020-01-01")').io_trace,
      undefined,
    )
    assert_equal(
      typeof(test_initial_state('Date()').io_trace[0].value),
      'string',
    )
    assert_equal(
      typeof(test_initial_state('new Date()').io_trace[0].value),
      'object',
    )
  }),

  test('record io hangs bug', async () => {
    patch_builtin(
      'fetch', 
      () => new Promise(resolve => original_setTimeout(resolve, 0))
    )

    const code = `
      const p = fetch('')
      Math.random()
      await p
    `

    const i = await test_initial_state_async(code)

    assert_equal(i.io_trace.length, 3)

    const next_code = `await fetch('')`

    const state = await command_input_async(i, next_code, 0)
    assert_equal(state.io_trace.length, 2)

    patch_builtin('fetch', null)
  }),

  test('record io logs recorded twice bug', () => {
    const code = `Math.random()`
    const i = test_initial_state(code)
    const second = COMMANDS.input(
      i, 
      `console.log(1); Math.random(); Math.random()`, 
      0
    )
    assert_equal(second.state.logs.logs.length, 1)
  }),

  test('value_explorer Set', () => {
    assert_equal(
      header(new Set(['foo', 'bar'])),
      'Set {0: "foo", 1: "bar"}'
    )
  }),

  test('value_explorer Map', () => {
    assert_equal(
      header(new Map([['foo', 'bar'], ['baz', 'qux']])),
      'Map {foo: "bar", baz: "qux"}'
    )
  }),

  test('let_versions find_versioned_lets toplevel', () => {
    const result = do_parse(`
      let x
      x = 1
      function foo() {
        x
      }
    `)
    assert_equal(result.node.has_versioned_let_vars, true)
  }),

  test('let_versions find_versioned_lets', () => {
    function assert_is_versioned_let(code, is_versioned) {
      const result = do_parse(code)
      const root = find_node(result.node, 
        n => n.name == 'root' && n.type == 'function_expr'
      )
      assert_equal(root.has_versioned_let_vars, is_versioned)
      const node = find_node(result.node, n => n.index == code.indexOf('x'))
      assert_equal(!(!node.is_versioned_let_var), is_versioned)
    }

    assert_is_versioned_let(
      `
      function root() {
        let x
        x = 1
        function foo() {
          x
        }
      }
      `,
      true
    )

    // closed but constant
    assert_is_versioned_let(
      `
      function root() {
        let x
        function foo() {
          x
        }
      }
      `,
      false
    )

    // assigned but not closed
    assert_is_versioned_let(
      `
      function root() {
        let x
        x = 1
      }
      `,
      false
    )

    // not closed, var has the same name
    assert_is_versioned_let(
      `
      function root() {
        let x
        x = 1
        function foo() {
          let x
          x
        }
      }
      `,
      false
    )

    // not closed, var has the same name
    assert_is_versioned_let(
      `
      function root() {
        let x
        x = 1
        if(true) {
          let x
          function foo() {
            x
          }
        }
      }
      `,
      false
    )
  }),

  test('let_versions assign to let variable', () => {
    const code = `
      let result = 0
      function unused() {
        result = 2
      }
      result = 1
    `
    const i = test_initial_state(code, code.indexOf('result = 1'))
    assert_value_explorer(i, 1)
  }),

  test('let_versions', () => {
    const code = `
      let x
      [1,2].forEach(y => {
        x /*x*/
        x = y
      })
    `
    const x_pos = code.indexOf('x /*x*/')
    const i = test_initial_state(code, x_pos)
    const second_iter = COMMANDS.calltree.arrow_down(i)
    const select_x = COMMANDS.move_cursor(second_iter, x_pos)
    assert_equal(select_x.value_explorer.result.value, 1)
  }),

  test('let_versions close let var bug', () => {
    const code = `
      let x
      x = 1
      function y() {
        return {x}
      }
      y() /*y()*/
    `
    const i = test_initial_state(code, code.indexOf('y() /*y()*/'))
    assert_equal(i.value_explorer.result.value, {x: 1})
  }),

  test('let_versions initial let value', () => {
    const code = `
      let x
      function y() {
        x /*x*/
      }
      y()
    `
    const x_pos = code.indexOf('x /*x*/')
    const i = test_initial_state(code, x_pos)
    assert_equal(i.value_explorer.result.ok, true)
    assert_equal(i.value_explorer.result.value, undefined)
  }),

  test('let_versions save version bug', () => {
    const code = `
      let x = 0

      function set_x(value) {
        x = value
      }

      function get_x() {
        x /* result */
      }

      get_x()

      set_x(10)
      x = 10
      set_x(10)
      x = 10
    `
    const i = test_initial_state(code, code.indexOf('x /* result */'))
    assert_equal(i.value_explorer.result.value, 0)
  }),

  test('let_versions expand_calltree_node', () => {
    const code = `
      let y

      function foo(x) {
        y /*y*/
        bar(y)
      }

      function bar(arg) {
      }

      foo(0)
      y = 11
      foo(0)
      y = 12
    `
    const i = test_initial_state(code)
    const second_foo_call = root_calltree_node(i).children[1]
    assert_equal(second_foo_call.has_more_children, true)
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, second_foo_call.id)
    const bar_call = root_calltree_node(expanded).children[1].children[0]
    assert_equal(bar_call.fn.name, 'bar')
    assert_equal(bar_call.args, [11])
    const moved = COMMANDS.move_cursor(expanded, code.indexOf('y /*y*/'))
    assert_equal(moved.value_explorer.result.value, 11)
  }),

  test('let_versions expand_calltree_node 2', () => {
    const code = `
      let y

      function deep(x) {
        if(x < 10) {
          y /*y*/
          y = x
          deep(x + 1)
        }
      }

      deep(0)
      y = 11
      deep(0)
      y = 12
    `
    const i = test_initial_state(code)
    const second_deep_call = root_calltree_node(i).children[1]
    assert_equal(second_deep_call.has_more_children, true)
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, second_deep_call.id)
    const moved = COMMANDS.move_cursor(expanded, code.indexOf('y /*y*/'))
    assert_equal(moved.value_explorer.result.value, 11)
  }),

  test('let_versions create multiversion within expand_calltree_node', () => {
    const code = `
      function x() {
        let y
        function set(value) {
          y = value
        }
        set(1)
        y /*result*/
        set(2)
      }

      x()
      x()

    `
    const i = test_initial_state(code)
    const second_x_call = root_calltree_node(i).children[1]
    assert_equal(second_x_call.has_more_children, true)
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, second_x_call.id)
    const moved = COMMANDS.move_cursor(expanded, code.indexOf('y /*result*/'))
    assert_equal(moved.value_explorer.result.value, 1)
  }),

  test('let_versions mutable closure', () => {
    const code = `
      const holder = (function() {
        let value
        return {
          get: () => value,
          set: (v) => {
            value /*value*/
            value = v
          }
        }
      })()
      Array.from({length: 10}).map((_, i) => {
        holder.set(i)
      })
      holder.get()
    `
    const i = test_initial_state(code, code.indexOf('holder.get'))
    assert_equal(i.value_explorer.result.value, 9)

    const map_expanded = COMMANDS.calltree.select_and_toggle_expanded(
      i, 
      root_calltree_node(i).children[2].id
    )
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(
      map_expanded, 
      root_calltree_node(map_expanded).children[2].children[5].id
    )
    const set_call = COMMANDS.calltree.arrow_right(
      COMMANDS.calltree.arrow_right(
        expanded
      )
    )
    assert_equal(
      set_call.active_calltree_node.code.index, 
      code.indexOf('(v) =>')
    )
    const moved = COMMANDS.move_cursor(set_call, code.indexOf('value /*value*/'))
    assert_equal(moved.value_explorer.result.value, 4)
  }),

  test('let_versions forEach', () => {
    const code = `
      let sum = 0
      [1,2,3].forEach(v => {
        sum = sum + v
      })
      sum /*first*/
      [1,2,3].forEach(v => {
        sum = sum + v
      })
      sum /*second*/
    `
    const i = test_initial_state(code, code.indexOf('sum /*first*/'))
    assert_equal(i.value_explorer.result.value, 6)
    const second = COMMANDS.move_cursor(i, code.indexOf('sum /*second*/'))
    assert_equal(second.value_explorer.result.value, 12)
  }),

  test('let_versions scope', () => {
    assert_code_evals_to(`
      let x = 1
      let y = 1
      function change_x() {
        x = 2
      }
      function change_y() {
        y = 2
      }
      function unused() {
        return {}
      }
      if(false) {
      } else {
        if((change_y() || true) ? true : null) {
          const a = [...[{...{
            y: unused()[!(1 + (true ? {y: [change_x()]} : null))]
          }}]]
        }
      }
      {x,y} /*result*/
      `,
      {x: 2, y: 2}
    )
  }),

  test('let_versions expr', () => {
    assert_code_evals_to(`
      let x = 0
      function inc() {
        x = x + 1
        return 0
      }
      x + inc() + x + inc() + x
      `,
      3
    )
  }),

  test('let_versions update in assignment', () => {
    assert_code_evals_to(`
      let x
      function set(value) {
        x = 1
        return 0
      }
      x = set()
      x
      `,
      0
    )
  }),

  test('let_versions update in assignment closed', () => {
    const code = `
      function test() {
        let x
        function set(value) {
          x = 1
          return 0
        }
        x = set()
        return x
      }
      test()
      `
    const i = test_initial_state(code, code.indexOf('return x'))
    assert_equal(i.value_explorer.result.value, 0)
  }),

  test('let_versions multiple vars with same name', () => {
    const code = `
      let x
      function x_1() {
        x = 1
      }
      if(true) {
        let x = 0
        function x_2() {
          x = 2
        }
        x /* result 0 */
        x_1()
        x /* result 1 */
        x_2()
        x /* result 2 */
      }
    `
    const i = test_initial_state(code, code.indexOf('x /* result 0 */'))
    const frame = active_frame(i)
    const result_0 = find_node(frame, n => n.index == code.indexOf('x /* result 0 */')).result
    assert_equal(result_0.value, 0)
    const result_1 = find_node(frame, n => n.index == code.indexOf('x /* result 1 */')).result
    assert_equal(result_1.value, 0)
    const result_2 = find_node(frame, n => n.index == code.indexOf('x /* result 2 */')).result
    assert_equal(result_2.value, 2)
  }),

  test('let_versions closed let vars bug', () => {
    const code = `
      let x = 0
      function inc() {
        x = x + 1
      }
      function test() {
        inc()
        x /*x*/
      }
      test()
    `
    const i = test_initial_state(code, code.indexOf('x /*x*/'))
    assert_equal(i.value_explorer.result.value, 1)
  }),

  test('let_versions assign and read variable multiple times within call', () => {
    const code = `
      let x;
      (() => {
        x = 1
        console.log(x)
        x = 2
        console.log(x)
      })()
    `
  }),

  test('let_versions let assigned undefined bug', () => {
    const code = `
      let x = 1
      function set(value) {
        x = value
      }
      set(2)
      set(undefined)
      x /*x*/
    `
    const i = test_initial_state(code, code.indexOf('x /*x*/'))
    assert_equal(i.value_explorer.result.value, undefined)
  }),

  // TODO function args should have multiple versions same as let vars

  // test('let_versions function args closure', () => {
  //   const code = `
  //     (function(x) {
  //       function y() {
  //         x /*x*/
  //       }
  //       y()
  //       x = 1
  //       y()
  //     })(0)
  //   `
  //   const i = test_initial_state(code)
  //   const second_y_call = root_calltree_node(i).children[0].children[1]
  //   const selected = COMMANDS.calltree.select_and_toggle_expanded(i, second_y_call.id)
  //   const moved = COMMANDS.move_cursor(selected, code.indexOf('x /*x*/'))
  //   assert_equal(moved.value_explorer.result.value, 1)
  // }),

  test('let_versions async/await', async () => {
    const code = `
      let x
      function set(value) {
        x = value
      }
      await set(1)
      x /*x*/
    `
    const i = await test_initial_state_async(code, code.indexOf('x /*x*/'))
    assert_equal(i.value_explorer.result.value, 1)
  }),

  /*
    TODO this test fails. To fix it, we should record version_counter after
    await finished and save it in calltree_node
  */
  //test('let_versions async/await 2', async () => {
  //  const code = `
  //    let x
  //    function set(value) {
  //      x = value
  //      Promise.resolve().then(() => {
  //        x = 10
  //      })
  //    }
  //    await set(1)
  //    x /*x*/
  //  `
  //  const i = await test_initial_state_async(code, code.indexOf('x /*x*/'))
  //  assert_equal(i.value_explorer.result.value, 10)
  //}),

  // Test that expand_calltree_node produces correct id for expanded nodes
  test('let_versions native call', () => {
    const code = `
      function x() {}
      [1,2].map(x)
      [1,2].map(x)
    `
    const i =  test_initial_state(code)
    const second_map_call = i.calltree.children[0].children[1]
    assert_equal(second_map_call.has_more_children, true)
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, second_map_call.id)
    const second_map_call_exp = expanded.calltree.children[0].children[1]
    assert_equal(second_map_call.id == second_map_call_exp.id, true)
    assert_equal(second_map_call_exp.children[0].id == second_map_call_exp.id + 1, true)
  }),

  test('let_versions expand_calltree_node twice', () => {
    const code = `
      function test() {
        let x = 0
        function test2() {
          function foo() {
            x /*x*/
          }
          x = x + 1
          foo()
        }
        test2()
      }
      test()
      test()
    `
    const i = test_initial_state(code)
    const test_call = root_calltree_node(i).children[1]
    assert_equal(test_call.has_more_children , true)

    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, test_call.id)
    const test2_call = root_calltree_node(expanded).children[1].children[0]
    assert_equal(test2_call.has_more_children, true)

    const expanded2 = COMMANDS.calltree.select_and_toggle_expanded(expanded, test2_call.id)
    const foo_call = root_calltree_node(expanded2).children[1].children[0].children[0]

    const expanded3 = COMMANDS.calltree.select_and_toggle_expanded(expanded2, foo_call.id)

    const moved = COMMANDS.move_cursor(expanded3, code.indexOf('x /*x*/'))
    assert_equal(moved.value_explorer.result.value, 1)
  }),

  test('let_versions deferred calls', () => {
    const code = `
      let x = 0
      export const inc = () => {
        return do_inc()
      }
      const do_inc = () => {
        x = x + 1
        return x
      }
      inc()
    `

    const {state: i, on_deferred_call} = test_deferred_calls_state(code)

    // Make deferred call
    i.modules[''].inc()

    const state = on_deferred_call(i)
    const call = get_deferred_calls(state)[0]
    assert_equal(call.has_more_children, true)
    assert_equal(call.value, 2)

    // Expand call
    // first arrow rights selects do_inc call, second steps into it
    const expanded = COMMANDS.calltree.arrow_right(
      COMMANDS.calltree.arrow_right(
        COMMANDS.calltree.select_and_toggle_expanded(state, call.id)
      )
    )
    // Move cursor
    const moved = COMMANDS.move_cursor(expanded, code.indexOf('return x'))
    assert_equal(moved.value_explorer.result.value, 2)
  }),


  test('let_versions deferred calls get value', () => {
    const code = `
      let x = 0

      function noop() {
      }
      
      function set(value) {
        x = value
        noop()
      }

      set(1)
      set(2)
      set(3)

      export const get = () => x
    `

    const {state: i} = test_deferred_calls_state(code)

    const second_set_call = root_calltree_node(i).children[1]
    assert_equal(second_set_call.has_more_children, true)

    const exp = COMMANDS.calltree.select_and_toggle_expanded(i, second_set_call.id)
    assert_equal(exp.modules[''].get(), 3)
  }),

  test('let_versions multiple assignments', () => {
    const code = `
      let x
      function foo () {
        x /*x foo*/
      }
      x = 1
      foo()
      x = 2
      foo() /*foo 2*/
      x = 3
      x /*x*/
    `
    const i = test_initial_state(code, code.indexOf('x /*x*/'))
    assert_value_explorer(i, 3)
    const stepped = COMMANDS.step_into(i, code.indexOf('foo() /*foo 2*/'))
    const moved = COMMANDS.move_cursor(stepped, code.indexOf('x /*x foo*/'))
    assert_value_explorer(moved, 2)
  }),

  test('let_versions bug access before init', () => {
    const code = `
      Object.assign({})
      const x = {}
      x.y = 1
      let result = 0
      function() {
        result = 1
      }
    `
    const i = test_initial_state(code, code.indexOf('let result'))
    assert_value_explorer(i, 0)
  }),

  test('let_versions bug version counter', () => {
    const code = `
      let i = 0
      const x = {value: 1}
      function unused() {
        i = 1
      }
      i = 2
      x.value = 2
      x /*result*/
    `
    const i = test_initial_state(code, code.indexOf('x /*result*/'))
    assert_value_explorer(i, {value: 2})
  }),

  test('let_versions bug version counter 2', () => {
    const code = `
      let i = 0
      function unused() {
        i = 1
      }
      i = 1
      i /*result*/
      i = 2
    `
    const i = test_initial_state(code, code.indexOf('i /*result*/'))
    assert_value_explorer(i, 1)
  }),

  test('let_versions bug version counter multiple assignments', () => {
    const code = `
      let i = 0, j = 0
      function unused() {
        i = 1
      }
      i = 1, j = 1
      i /*result*/
      i = 2
    `
    const i = test_initial_state(code, code.indexOf('i /*result*/'))
    assert_value_explorer(i, 1)
  }),

  test('mutability array', () => {
    const code = `
      const arr = [2,1]
      arr.at(1)
      arr.push(3)
      arr /*after push*/
      arr.sort()
      arr /*after sort*/
      arr[0] = 4
      arr /*after set*/
    `
    const i = test_initial_state(code, code.indexOf('arr.at'))
    assert_value_explorer(i, 1)

    const s1 = COMMANDS.move_cursor(i, code.indexOf('arr /*after push*/'))
    assert_value_explorer(s1, [2,1,3])

    const s2 = COMMANDS.move_cursor(i, code.indexOf('arr /*after sort*/'))
    assert_value_explorer(s2, [1,2,3])

    const s3 = COMMANDS.move_cursor(i, code.indexOf('arr /*after set*/'))
    assert_value_explorer(s3, [4,2,3])
  }),

  test('mutability array set length', () => {
    const code = `
      const x = [1,2,3]
      x.length = 2
      x /*x*/
      x.length = 1
    `
    const i = test_initial_state(code, code.indexOf('x /*x*/'))
    assert_value_explorer(i, [1,2])
  }),

  test('mutability array method name', () => {
    assert_code_evals_to(`[].sort.name`, 'sort')
    assert_code_evals_to(`[].forEach.name`, 'forEach')
  }),

  test('mutability array method returns itself', () => {
    const code = `
      const x = [3,2,1]
      const y = x.sort()
      if(x != y) {
        throw new Error('not eq')
      }
      x.push(4)
    `
    const i = test_initial_state(code, code.indexOf('const y'))
    assert_equal(root_calltree_node(i).ok, true)
    assert_value_explorer(i, [1,2,3])
  }),

  test('mutability set', () => {
    const code = `
      const s = new Set([1,2])
      s.delete(2)
      if(s.size != 1) {
        throw new Error('size not eq')
      }
      s.add(3)
      s /*s*/
    `
    const i = test_initial_state(code, code.indexOf('const s'))
    assert_value_explorer(i, new Set([1,2]))
    const moved = COMMANDS.move_cursor(i, code.indexOf('s /*s*/'))
    assert_value_explorer(moved, new Set([1,3]))
  }),

  test('mutability set method name', () => {
    assert_code_evals_to(`new Set().delete.name`, 'delete')
  }),

  // This test is for browser environment where runtime is loaded from the main
  // (IDE) window, and user code is loaded from app window
  test('mutability instanceof', () => {
    assert_code_evals_to(`{} instanceof Object`, true)
    assert_code_evals_to(`new Object() instanceof Object`, true)
    assert_code_evals_to(`[] instanceof Array`, true)
    assert_code_evals_to(`new Array() instanceof Array`, true)
    assert_code_evals_to(`new Set() instanceof Set`, true)
    assert_code_evals_to(`new Map() instanceof Map`, true)
  }),

  test('mutability map', () => {
    const code = `
      const s = new Map([['foo', 1], ['bar', 2]])
      s.delete('foo')
      s.set('baz', 3)
      s /*s*/
    `
    const i = test_initial_state(code, code.indexOf('const s'))
    assert_value_explorer(i, {foo: 1, bar: 2})
    const moved = COMMANDS.move_cursor(i, code.indexOf('s /*s*/'))
    assert_value_explorer(moved, {bar: 2, baz: 3})
  }),

  test('mutability object', () => {
    const code = `
      const s = {foo: 1, bar: 2}
      s.foo = 2
      s.baz = 3
      s /*s*/
    `
    const i = test_initial_state(code, code.indexOf('const s'))
    assert_value_explorer(i, {foo: 1, bar: 2})
    const moved = COMMANDS.move_cursor(i, code.indexOf('s /*s*/'))
    assert_value_explorer(moved, {foo: 2, bar: 2, baz: 3})
  }),

  test('mutability', () => {
    const code = `
      const make_array = () => [3,2,1]
      const x = make_array()
      x.sort()
    `

    const i = test_initial_state(code)

    const index = code.indexOf('x.sort()')

    const selected_x = COMMANDS.eval_selection(i, index, true).state

    assert_equal(selected_x.selection_state.node.length, 'x'.length)

    assert_selection(selected_x, [3, 2, 1])

    const selected_sort = COMMANDS.eval_selection(
      COMMANDS.eval_selection(selected_x, index, true).state, index, true
    ).state

    assert_equal(selected_sort.selection_state.node.length, 'x.sort()'.length)

    assert_selection(selected_sort, [1,2,3])
  }),

  test('mutability value_explorer bug', () => {
    const code = `
      const x = [3,2,1]
      x.sort()
      x /*x*/
    `
    const i = test_initial_state(code, code.indexOf('x /*x*/'))
    assert_value_explorer(
      i,
      [1,2,3]
    )
  }),

  test('mutability with_version_number', () => {
    const code = `
      const make_array = () => [3,2,1]
      const x = make_array()
      x.sort()
    `
    const i = test_initial_state(code, code.indexOf('const x'))

   assert_value_explorer(i, [3,2,1])
  }),

  test('mutability member access version', () => {
    const code = `
      const x = [0]
      x[0] /*x[0]*/
      x[0] = 1
    `
    const i = test_initial_state(code, code.indexOf('x[0] /*x[0]*/'))
    assert_equal(i.value_explorer.result.value, 0)
  }),

  test('mutability assignment', () => {
    const code = `
      const x = [0]
      x[0] = 1
    `
    const i = test_initial_state(code)
    const index = code.indexOf('x[0]')
    const evaled = COMMANDS.eval_selection(
      COMMANDS.eval_selection(i, index).state,
      index,
    ).state
    assert_equal(evaled.selection_state.node.length, 'x[0]'.length)
    assert_selection(evaled, 1)
  }),

  test('mutability assignment value explorer', () => {
    const code = `
      const x = [0]
      x[0] = 1
    `
    const i = test_initial_state(code, code.indexOf('x[0]'))
    assert_value_explorer(i, 1)
  }),

  test('mutability multiple assignment value explorer', () => {
    const code = `
      const x = [0]
      x[0] = 1, x[0] = 2
      x /*x*/
    `
    const i = test_initial_state(code, code.indexOf('x[0]'))
    assert_equal(i.value_explorer, null)
    const moved = COMMANDS.move_cursor(i, code.indexOf('x /*x*/'))
    assert_value_explorer(moved, [2])
  }),

  test('mutability assignment value explorer new value', () => {
    const code = `
      const x = [0]
      x[0] = 1
      x[0] /*x*/
    `
    const i = test_initial_state(code, code.indexOf('x[0] /*x*/'))
    assert_value_explorer(i, [1])
  }),

  test('mutability eval_selection lefthand', () => {
    const code = `
      const x = [0]
      x[0] = 1
    `
    const i = test_initial_state(code)
    const evaled = COMMANDS.eval_selection(i, code.indexOf('x[0]')).state
    assert_selection(evaled, [0])
    // expand eval to x[0]
    const evaled2 = COMMANDS.eval_selection(evaled, code.indexOf('x[0]')).state
    assert_selection(evaled2, 1)
  }),

  test('mutability multiple assignments', () => {
    const code = `
      const x = [0]
      x[0] = 1
      x /*x*/
      x[0] = 2
    `
    const i = test_initial_state(code, code.indexOf('x /*x*/'))
    assert_value_explorer(i, [1])
  }),

  test('mutability value explorer', () => {
    const code = `
      const x = [0]
      x[0] = 1
    `
    const i = test_initial_state(code, code.indexOf('x[0] = 1'))
    assert_value_explorer(i, 1)
  }),

  test('mutability calltree value explorer', () => {
    const i = test_initial_state(`
      const array = [3,2,1]
      function sort(array) {
        return array.sort()
      }
      sort(array)
    `)
    const selected = COMMANDS.calltree.select_and_toggle_expanded(i, root_calltree_node(i).children[0].id)

    const args = selected.value_explorer.result.value['*arguments*']
    assert_versioned_value(i, args, {array: [3,2,1]})

    const returned = selected.value_explorer.result.value['*return*']
    assert_versioned_value(i, returned, [1,2,3])
  }),

  test('mutability import mutable value', () => {
    const code = {
      '': `
        import {array} from 'x.js'
        import {change_array} from 'x.js'
        change_array()
        array /*result*/
      `,
      'x.js': `
        export const array = ['initial']
        export const change_array = () => {
          array[0] = 'changed'
        }
      `
    }
    const main = code['']
    const i = test_initial_state(code, main.indexOf('import'))
    assert_value_explorer(i, {array: ['initial']})
    const sel = COMMANDS.eval_selection(i, main.indexOf('array')).state
    assert_selection(sel, ['initial'])
    const moved = COMMANDS.move_cursor(sel, main.indexOf('array /*result*/'))
    assert_value_explorer(moved, ['changed'])
  }),

  test('mutability Object.assign', () => {
    const i = test_initial_state(`Object.assign({}, {foo: 1})`)
    assert_value_explorer(i, {foo: 1})
  }),

  test('mutability wrap external arrays', () => {
    const code = `
      const x = "foo bar".split(' ')  
      x.push('baz')
      x /*x*/
    `
    const i = test_initial_state(code, code.indexOf('const x'))
    assert_value_explorer(i, ['foo', 'bar'])
  }),

  test('mutability logs', () => {
    const i = test_initial_state(`
      const x = [1]
      console.log(x)
      x.push(2)
      console.log(x)
    `)
    const log1 = i.logs.logs[0]
    with_version_number_of_log(i, log1, () =>
      assert_equal(
        [[1]],
        log1.args,
      )
    )
    const log2 = i.logs.logs[1]
    with_version_number_of_log(i, log2, () =>
      assert_equal(
        [[1,2]],
        log2.args,
      )
    )

  }),

  // copypasted from the same test for let_versions
  test('mutability expand_calltree_node', () => {
    const code = `
      const y = []

      function foo(x) {
        y /*y*/
        bar(y)
      }

      function bar(arg) {
      }

      foo(0)
      y[0] = 11
      foo(0)
      y[0] = 12
    `
    const i = test_initial_state(code)
    const second_foo_call = root_calltree_node(i).children[1]
    assert_equal(second_foo_call.has_more_children, true)
    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, second_foo_call.id)
    const bar_call = root_calltree_node(expanded).children[1].children[0]
    assert_equal(bar_call.fn.name, 'bar')
    const moved = COMMANDS.move_cursor(expanded, code.indexOf('y /*y*/'))
    assert_value_explorer(moved, [11])
  }),

  // copypasted from the same test for let_versions
  test('mutability expand_calltree_node twice', () => {
    const code = `
      function test() {
        let x = {value: 0}
        function test2() {
          function foo() {
            x /*x*/
          }
          x.value = x.value + 1
          foo()
        }
        test2()
      }
      test()
      test()
    `
    const i = test_initial_state(code)
    const test_call = root_calltree_node(i).children[1]
    assert_equal(test_call.has_more_children , true)

    const expanded = COMMANDS.calltree.select_and_toggle_expanded(i, test_call.id)
    const test2_call = root_calltree_node(expanded).children[1].children[0]
    assert_equal(test2_call.has_more_children, true)

    const expanded2 = COMMANDS.calltree.select_and_toggle_expanded(expanded, test2_call.id)
    const foo_call = root_calltree_node(expanded2).children[1].children[0].children[0]

    const expanded3 = COMMANDS.calltree.select_and_toggle_expanded(expanded2, foo_call.id)

    const moved = COMMANDS.move_cursor(expanded3, code.indexOf('x /*x*/'))
    assert_equal(moved.value_explorer.result.value, {value: 1 })
  }),

  test('mutability quicksort', () => {
    const code = `
      const loop = new Function('action', 'while(true) { if(action()) { return } }')

      function partition(arr, begin, end) {
        const pivot = arr[begin]
        
        let i = begin - 1, j = end + 1
        
        loop(() => {
          
          i = i + 1
          loop(() => {
            if(arr[i] < pivot) {
              i = i + 1
            } else {
              return true /* stop */
            }
          })
          
          j = j - 1
          loop(() => {
            if(arr[j] > pivot) {
              j = j - 1
            } else {
              return true // stop iteration
            }
          })
          
          if(i >= j) {
            return true // stop iteration
          }
          
          const temp = arr[i]
          arr[i] = arr[j]
          arr[j] = temp
        })
        
        return j
      }


      function qsort(arr, begin = 0, end = arr.length - 1) {
        if(begin >= 0 && end >= 0 && begin < end) {
          const p = partition(arr, begin, end)
          qsort(arr, begin, p)
          qsort(arr, p + 1, end)
        }
      }

      const arr = [ 2, 15, 13, 12, 3, 9, 14, 3, 18, 0 ]

      qsort(arr)

      arr /*result*/
    `
    const i = test_initial_state(code, code.indexOf('arr /*result*/'))
    const expected = [ 0,  2,  3,  3,  9, 12, 13, 14, 15, 18 ]
    assert_value_explorer(i, expected)

  }),
]
