import {stringify, zip, uniq, map_object} from './utils.js'

import {
  find_definitions, 
  topsort_modules,
  check_imports, 
  analyze,
} from './find_definitions.js'

import { find_versioned_let_vars } from './analyze_versioned_let_vars.js'

import {reserved} from './reserved.js'

import {collect_imports} from './ast_utils.js'

const builtin_identifiers = ['true', 'false', 'null']

// Workaround that regexp cannot be drained with imperative code
// TODO foreign pragma
const drain_regexp = new Function('regexp', 'str', `
  const result = []
  let match
  while((match = regexp.exec(str)) != null) {
    result.push(match)
  }
  return result
`)

// https://deplinenoise.wordpress.com/2012/01/04/python-tip-regex-based-tokenizer/
const tokenize_js = (str) => {

  const arithmetic_ops = [
    '+', '-', '*', '/', '%', '**', 
  ]
  
  const logic_ops = [
    '===', '==', '!==', '!=', '!', '&&', '||', '??',
  ]
  
  const punctuation = [
    // Braces
    '(', ')', 
  
    // Array literal, property access
    '[', ']', 
  
    // Map literal, blocks
    '{', '}', 

    // Spread
    '...',
  
    // Property access
    '.', 

    // Optional chaining
    '?.', 
  
    ';',
  
    ',', 
  
    // function expression, must be before `=` to take precedence
    '=>',
  
    ...arithmetic_ops,
  
    ...logic_ops,
  
  
    '=', 

    // Comparison
    '<=', '>=', '>', '<',
  
    // Ternary
    '?', ':', 
  
    // TODO bit operations
  ]
  
  const TOKENS = [
    {name: 'pragma_external'    , re: '//[\\s]*external[\\s]*[\r\n]'},
    {name: 'pragma_external'    , re: '\\/\\*[\\s]*external[\\s]*\\*\\/'},

    {name: 'comment'            , re: '//[^\n]*'},
    {name: 'comment'            , re: '\\/\\*[\\s\\S]*?\\*\\/'},
    {name: 'newline'            , re: '[\r\n]+'},
    

    // whitespace except newline
    //https://stackoverflow.com/a/3469155
    {name: 'whitespace'         , re: '[^\\S\\r\\n]+'}, 

    {name: 'string_literal'     , re: "'.*?'"},
    {name: 'string_literal'     , re: '".*?"'},
    
    // TODO parse vars inside backtick string
    {name: 'backtick_string'    , re: '`[\\s\\S]*?`'},

    {name: 'builtin_identifier' , re: builtin_identifiers
                                        .map(i => '\\b' + i + '\\b')
                                        .join('|')},
    {name: 'keyword'            , re: reserved.map(r => '\\b' + r + '\\b').join('|')},
    // TODO all possible notatins for js numbers
    {name: 'number'             , re: '\\d*\\.?\\d+'},
    {name: 'identifier'         , re: '[A-Za-z_$][A-Za-z0-9_$]*'},
  
    {name: 'punctuation'        , 
        re: '(' + 
          punctuation.map(
            str => [...str].map(symbol => '\\' + symbol).join('')
          ).join('|') 
        + ')'},
  ]
  
  // TODO test unbalanced quotes
  const regexp_str = TOKENS.map(({re}) => '(' + re + ')').join('|')
  const r = new RegExp(regexp_str, 'mg')

  const matches = drain_regexp(r, str)

  const tokens = matches.map(m => {
    const type = TOKENS
      .find((t,i) => 
        m[i + 1] != null
      )
      .name

    return {
      type,
      index: m.index,
      string: m[0],
      length: m[0].length,
    }
  })

  if(tokens.length == 0) {
    return {ok: true, tokens}
  } else {
    const unexpected_token = 
      zip(
        [{index: 0, length: 0}, ...tokens],
        [...tokens, {index: str.length}],
      )
      .find(([prev, current]) => prev.index + prev.length != current.index)

    if(unexpected_token != null) {
      const prev = unexpected_token[0]
      return {
        ok: false,
        index: prev.index + prev.length,
        message: 'unexpected lexical token',
      }
    } else {
      return {ok: true, tokens}
    }
  }
}

/*
  Parser combinators
*/

/*
let log_level = 1
const log = (label, fn) => {
  return (...args) => {
    const cxt = args[0];
    const prefix = '-'.repeat(log_level)
    console.log(prefix, label, 'args', cxt.str.slice(cxt.tokens[cxt.current].index));
    log_level++
    const result = fn(...args);
    log_level--
    const {ok, value, error, cxt: cxterr} = result;
    if(ok) {
      console.log(prefix, label, 'ok', stringify(value));
    } else {
      console.log(prefix, label, 'error', error, cxterr.str.slice(cxterr.tokens[cxterr.current].index));
    }
    return result
  }
}
const log_mute = (label, fn) => {
  return fn
}
*/

const current = cxt => cxt.current < cxt.tokens.length  
  ? cxt.tokens[cxt.current]
  : null

const literal = str => by_pred(token => token.string == str, 'expected ' + str)

const insignificant_types = new Set(['newline', 'pragma_external'])

const by_pred = (pred, error) => {
  const result = cxt => {
    const token = current(cxt)

    if(token == null) {
      return {ok: false, error, cxt}
    }

    if(pred(token)) {
      return {
        ok: true, 
        value: {...token, value: token.string, string: undefined}, 
        cxt: {...cxt, current: cxt.current + 1}
      }
    }

    // Skip non-significant tokens if they were not asked for explicitly
    if(insignificant_types.has(token.type)) {
      return result({...cxt, current: cxt.current + 1})
    }

    return {ok: false, error, cxt}
  }

  return result
}

const by_type = type => by_pred(
  token => token.type == type,
  'expected ' + type
)

const newline = by_type('newline')

export const eof = cxt => {
  const c = current(cxt)
  if(c == null) {
    return {ok: true, cxt}
  }
  if(insignificant_types.has(c.type)) {
    return eof({...cxt, current: cxt.current + 1})
  }
  return {ok: false, error: 'unexpected token, expected eof', cxt}
}

const either = (...parsers) => cxt => {
  return parsers.reduce(
    (result, p) => {
      if(result.ok) {
        return result
      } else {
        const other = p(cxt)
        if(other.ok) {
          return other
        } else {
          // Select error that matched more tokens
          return result.cxt.current > other.cxt.current
            ? result
            : other
        }
      }
    },
    {ok: false, cxt: {current: 0}},
  )
}

const optional = parser => cxt => {
  const result = parser(cxt)
  return result.ok
    ? result
    : {ok: true, value: null, cxt}
}

const apply_location = result => {
  if(result.ok) {
    const first = result.value.find(v => v != null)
    const last = [...result.value].reverse().find(v => v != null)
    const value = {
      value: result.value,
      index: first.index,
      length: (last.index + last.length) - first.index,
    }
    return {...result, value}
  } else {
    return result
  }
}

const seq = parsers => cxt => {
  const seqresult = parsers.reduce(
    (result, parser) => {
      if(result.ok) {
        const nextresult = parser(result.cxt) 
        if(nextresult.ok) {
          return {...nextresult, value: result.value.concat([nextresult.value])}
        } else {
          return nextresult
        }
      } else {
        return result
      }
    },
    {cxt, ok: true, value: []}
  )
  if(seqresult.ok) {
    return apply_location(seqresult)
  } else {
    return seqresult
  }
}

const if_ok = (parser, fn) => cxt => {
  const result = parser(cxt)
  if(!result.ok) {
    return result
  } else {
    return {...result, value: fn(result.value)}
  }
}

const check_if_valid = (parser, check) => cxt => {
  const result = parser(cxt)
  if(!result.ok) {
    return result
  } else {
    const {ok, error} = check(result.value)
    if(!ok) {
      return {ok: false, error, cxt}
    } else {
      return result
    }
  }
}

const if_fail = (parser, error) => cxt => {
  const result = parser(cxt)
  if(result.ok) {
    return result
  } else {
    return {...result, error}
  }
}

const if_ok_then = (parser, fn) => cxt => {
  const result = parser(cxt)
  return !result.ok
    ? result
    : fn(result.value)(result.cxt)
}


const seq_select = (index, parsers) =>
  if_ok(
    seq(parsers), 
    node => ({...node, value: node.value[index]})
  )

const repeat = parser => cxt => {
  const dorepeat = (cxt, values) => {
    const result = parser(cxt)
    if(result.ok) {
      return dorepeat(result.cxt, values.concat([result.value]))
    } else {
      return values.length == 0
      ? result
      : {ok: true, value: values, cxt}
    }
  }
  const result = dorepeat(cxt, [])
  if(!result.ok) {
    return result
  } else {
    return apply_location(result)
  }
}

const repeat_until = (parser, stop) => cxt => {
  const dorepeat = (cxt, values) => {
    const result_stop = stop(cxt)
    if(result_stop.ok) {
      return {ok: true, cxt, value: values}
    } else {
      const result = parser(cxt)
      if(result.ok) {
        return dorepeat(result.cxt, values.concat([result.value]))
      } else {
        return result
      }
    }
  }
  const result = dorepeat(cxt, [])
  if(!result.ok) {
    return result
  } else {
    if(result.value.length == 0) {
      return {...result, value: {value: result.value}}
    } else {
      return apply_location(result)
    }
  }
}

const lookahead = parser => cxt => {
  const result = parser(cxt)
  if(result.ok) {
    return {...result, cxt}
  } else {
    return result
  }
}

const finished = parser =>
  if_ok(
    seq_select(0, [
      parser,
      eof
    ]),
    ({value}) => value
  )

/*
  End parser combinators
*/



//////////////////////////////////////////////////////////////
                  //          PARSER
//////////////////////////////////////////////////////////////

const not_followed_by = (followed, follower) => cxt => {
  const result = followed(cxt)
  if(!result.ok) {
    return result
  } else {
    const nextresult = follower(result.cxt)
    if(nextresult.ok) {
      return {ok: false, cxt, error: 'not_followed_by'}
    } else {
      return result
    }
  }
}

/* ret from return */
const ret = value => cxt => ({ok: true, value, cxt})

const attach_or_pass = (nested, attachment, add_attachment) =>
  if_ok(
    seq([
      nested,
      optional(attachment),
    ]),
    ({value, ...node}) => {
      const [item, attachment] = value
      if(attachment == null) {
        return item
      } else {
        return {...node, ...add_attachment(item, attachment)}
      }
    }
  )

const identifier = by_type('identifier')

const builtin_identifier = if_ok(
  by_type('builtin_identifier'),
  ({...token}) => ({...token, type: 'builtin_identifier'}),
)

const string_literal = by_type('string_literal')

const unary = operator => nested =>
  if_ok(
    seq([
      optional(
        literal(operator)
      ),
      nested,
    ]),
    ({value, ...node}) => (
      value[0] == null
        ? value[1]
        : {
            ...node,
            type: 'unary',
            operator,
            children: [value[1]],
          }
    )
  )

const binary = ops => nested =>
  attach_or_pass(
    nested,

    repeat(
      seq([
        by_pred(token => ops.includes(token.string), 'expected ' + ops.join(',')),
        nested,
      ])
    ),

    (item, repetitions) => 
      repetitions.value.reduce(
        (prev_node, rep) => {
          const children = [
            prev_node,
            rep.value[1],
          ]
          return {
            // TODO refactor. This code is copypasted to other places that use 'repeat'
            index: item.index,
            length: rep.index - item.index + rep.length,
            type: 'binary',
            operator: rep.value[0].value,
            children,
          }
        },
        item,
      )
  )


/*
  // TODO check how ternary work
  (foo ? bar :  baz) ? qux : quux
   foo ? bar : (baz  ? qux : quux)
*/
const ternary = nested =>
  attach_or_pass(
    nested,
    if_ok(
      seq([
        literal('?'),
        cxt => expr(cxt),
        literal(':'),
        cxt => expr(cxt),
      ]),
      value => {
        const [_, left, __, right]  = value.value;
        return {...value, value: [left, right]}
      },
    ),
    (cond, {value: branches}) => {
      return {
        type: 'ternary',
        cond,
        branches,
        children: [cond, ...branches],
      }
    }
  )

const list = (separators, element_parser) => cxt => {
  const cs = if_ok_then(
    optional(lookahead(literal(separators[1]))),
    value => 
      value != null
      ? ret([])
      : if_ok_then(
          element_parser,
          value => if_ok_then(
            optional(literal(',')),
            comma => 
              comma == null
              ? ret([value])
              : if_ok_then(
                  cs,
                  values => ret([value, ...values])
                )
            )
        )
  )

  return seq_select(1, [
    literal(separators[0]),
    cs,
    literal(separators[1]),
  ])(cxt)

}

const comma_separated_1 = element => cxt => {

  const do_comma_separated_1 = cxt => {

    const result = element(cxt)
    if(!result.ok) {
      return result
    }

    const comma_result = literal(',')(result.cxt)
    if(!comma_result.ok) {
      return {...result, value: [result.value]}
    }

    const rest = do_comma_separated_1(comma_result.cxt)
    if(!rest.ok) {
      return rest
    }

    return {...rest, value: [result.value, ...rest.value]}
  }

  const result = do_comma_separated_1(cxt)
  if(!result.ok) {
    return result
  } else {
    return apply_location(result)
  }

}

const list_destructuring = (separators, node_type) => if_ok(

  list(
    separators,
    either(
      // identifier = value
      if_ok(
        seq([
          cxt => destructuring(cxt),
          literal('='),
          cxt => expr(cxt),
        ]),
        ({value, ...node}) => ({
          ...node,
          not_evaluatable: true,
          type: 'destructuring_default',
          children: [value[0], value[2]],
        })
      ),

      // just identifier
      cxt => destructuring(cxt),

      if_ok(
        seq_select(1, [
          literal('...'),
          cxt => destructuring(cxt),
        ]),
        ({value, ...node}) => ({
          ...node,
          type: 'destructuring_rest',
          not_evaluatable: true,
          children: [value],
        })
      )
    )
  ),

  ({value, ...node}) => ({
    // TODO check that rest is last element
    ...node,
    type: node_type,
    not_evaluatable: true,
    children: value,
  }),

)

const array_destructuring =
  list_destructuring(['[', ']'], 'array_destructuring')

const object_destructuring = if_ok(

  // TODO computed property names, like `const {[x]: y} = {}`
  // TODO default values, like `const {x = 1} = {}`
  // TODO string keys `const {'x': x} = {x: 2}`

  list(
    ['{', '}'],
    either(
      // identifier: destructuring
      if_ok(
        seq([
          // Normalize key without quotes to quoted key
          if_ok(
            identifier,
            iden => ({...iden, type: 'string_literal', value: '"' + iden.value + '"'}),
          ),
          literal(':'),
          cxt => destructuring(cxt),
        ]),
        ({value, ...node}) => ({
          ...node,
          not_evaluatable: true,
          type: 'destructuring_pair',
          children: [value[0], value[2]],
        })
      ),

      // just identifier
      identifier,

      // rest
      if_ok(
        seq_select(1, [
          literal('...'),
          identifier,
        ]),
        ({value, ...node}) => ({
          ...node,
          type: 'destructuring_rest',
          not_evaluatable: true,
          children: [value],
        })
      )
    ),
  ),

  ({value, ...node}) => ({
    // TODO check that rest is last element
    ...node,
    type: 'object_destructuring',
    not_evaluatable: true,
    children: value,
  }),

)

const destructuring =
  either(identifier, array_destructuring, object_destructuring)

/* Parse function_call, member_access or computed_member_access which are of
 * the same priority
 */
const function_call_or_member_access = nested =>
  attach_or_pass(
    nested,

    repeat(
      either(

        // Member access
        if_ok(
          seq([
            either(
              literal('?.'),
              literal('.'),
            ),
            // Adjust identifier to string literal
            if_ok(
              either(
                identifier,
                by_type('keyword'),
              ),
              iden => ({...iden, 
                type: 'string_literal', 
                value: '"' + iden.value + '"',
                not_evaluatable: true, 
              }),
            ),
          ]),

          ({value: [op, id], ...node}) => ({
            ...node, 
              value: id,
              type: 'member_access',
              is_optional_chaining: op.value == '?.',
          })
        ),

        // Computed member access
        if_ok(
          seq([
            optional(literal('?.')),
            literal('['),
            cxt => expr(cxt),
            literal(']'),
          ]),
          ({value: [optional_chaining, _1, value, _3], ...node}) => (
            {...node, 
              value,
              type: 'computed_member_access',
              is_optional_chaining: optional_chaining != null,
            }
          )
        ),

        // Function call
        if_ok(
          list(
            ['(', ')'],
            array_element,
          ),
          node => ({...node, type: 'function_call'})
        )
      )
    ),

    (object, repetitions) => repetitions.value.reduce(
      (object, rep) => {
        // TODO refactor. This code is copypasted to other places that use 'repeat'
        const index = object.index
        const length = rep.index - object.index + rep.length
        let result
        if(rep.type == 'member_access' || rep.type == 'computed_member_access') {
          result = {
            type: 'member_access',
            is_optional_chaining: rep.is_optional_chaining,
            children: [object, rep.value],
          }
        } else if(rep.type == 'function_call') {
          const fn = object

          const {value, ...rest} = rep
          const call_args = {
            ...rest,
            children: value,
            not_evaluatable: value.length == 0,
            type: 'call_args'
          }
          result = {
            type: 'function_call',
            children: [fn, call_args]
          }
        } else {
          throw new Error()
        }
        return {...result, index, length}
      },
      object
    )
  )


const grouping = nested => either(
  if_ok(
    not_followed_by(
      seq_select(1, [
        literal('('), 
        nested,
        literal(')'),
      ]),
      literal('=>')
    ),
    ({value, ...node}) => ({
      ...node,
      type: 'grouping',
      children: [value],
    })
  ),
  primary,
)

const array_element = either(
  if_ok(
    seq_select(1, [
      literal('...'),
      cxt => expr(cxt),
    ]),
    ({value, ...node}) => ({
      ...node, 
      type: 'array_spread', 
      not_evaluatable: true, 
      children: [value]
    })
  ),
  cxt => expr(cxt),
)

const array_literal =
  if_ok(
    // TODO array literal can have several commas in a row, like that:
    // `[,,,]`
    // Each comma creates empty array element
    list(
      ['[', ']'],
      array_element,
    ),
    ({value, ...node}) => ({...node, type: 'array_literal', children: value})
  )

const object_literal =
  if_ok(
    list(
      ['{', '}'],

      either(
        // Either object spread
        if_ok(
          seq_select(1, [
            literal('...'),
            cxt => expr(cxt),
          ]),
          ({value, ...node}) => ({
            ...node, 
            type: 'object_spread', 
            children: [value], 
            not_evaluatable: true
          })
        ),

        // Or key-value pair
        if_ok(
          seq([

            // key is one of
            either(

              // Normalize key without quotes to quoted key
              if_ok(
                identifier,
                iden => ({...iden, type: 'string_literal', value: '"' + iden.value + '"'}),
              ),

              string_literal,

              // Computed property name
              if_ok(
                seq_select(1, [
                  literal('['),
                  cxt => expr(cxt),
                  literal(']'),
                ]),
                ({value, ...node}) => ({...node, type: 'computed_property', not_evaluatable: true, children: [value]})
              )
            ),
            literal(':'),
            cxt => expr(cxt),
          ]),

          ({value: [key, _colon, value], ...node}) => (
            {...node, type: 'key_value_pair', not_evaluatable: true, children: [key, value]}
          ),
        ),

        // Or shorthand property
        identifier,

      ),
    ),

    ({value, ...node}) => (
      ({...node, type: 'object_literal', children: value})
    )
  )

const block_function_body = if_ok(
  seq_select(1, [
    literal('{'),
    cxt => parse_do(cxt),
    literal('}'),
  ]),

  ({value, ...node}) => ({...value, ...node}),
)

const function_expr = must_have_name => 
  if_ok(
    seq([
      optional(literal('async')),
      literal('function'),
      must_have_name ? identifier : optional(identifier),
      list_destructuring(['(', ')'], 'function_args'),
      block_function_body,
    ]),
    ({value, ...node}) => {
      const [is_async, _fn, name, args, body] = value
      const function_args = {...args,
        not_evaluatable: args.children.length == 0
      }
      return {
        ...node,
        type: 'function_expr',
        is_async: is_async != null,
        is_arrow: false,
        name: name?.value,
        body,
        children: [function_args, body]
      }
    },
  )

const arrow_function_expr =
  if_ok(
    seq([
      optional(literal('async')),

      either(
        // arguments inside braces
        list_destructuring(['(', ')'], 'function_args'),
        identifier,
      ),

      literal('=>'),

      either(
        // With curly braces
        block_function_body,
        // Just expression
        cxt => expr(cxt),
      )
    ]),

    ({value, ...node}) => {
      const [is_async, args, _, body] = value
      const function_args = args.type == 'identifier'
        ? {
            ...args, 
            not_evaluatable: true,
            type: 'function_args', 
            children: [args]
          }
        : // args.type == 'function_args' 
          {
            ...args,
            not_evaluatable: args.children.length == 0
          }
      return {
        ...node,
        type: 'function_expr',
        is_async: is_async != null,
        is_arrow: true,
        body,
        children: [function_args, body]
      }
    },
  )

/*
  new is actually is operator with same precedence as function call and member access.
  So it allows to parse expressions like `new x.y.z()` as `(new x.y.z)()`.

  Currently we only allow new only in form of `new <identifier>(args)`
  or `new(expr)(args)`, where expr is closed in braces

  TODO implement complete new operator support
*/
const new_expr = if_ok(
  seq([
    literal('new'),
    either(
      identifier,
      if_ok(
        seq_select(1, [
          literal('('),
          cxt => expr(cxt),
          literal(')'),
        ]),
        ({value}) => value,
      ),
    ),
    list(
      ['(', ')'],
      array_element,
    )
  ]),
  ({value, ...node}) => {
    const {value: args, ..._call_args} = value[2]
    const call_args = {
      ..._call_args,
      children: args,
      not_evaluatable: args.length == 0,
      type: 'call_args',
    }
    return {
      ...node,
      type: 'new',
      children: [value[1], call_args],
    }
  }
)

const primary = if_fail(
  either(
    new_expr,
    object_literal,
    array_literal,
    function_expr(false),
    arrow_function_expr,

    // not_followed_by for better error messages
    // y => { <garbage> } must parse as function expr, not as identifier `y`
    // followed by `=>`
    not_followed_by(builtin_identifier, literal('=>')),
    not_followed_by(identifier, literal('=>')),

    string_literal,
    by_type('backtick_string'),
    by_type('number'),
  ),
  'expected expression'
)

// operator precedence https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_Precedence
// TODO instanceof
const expr =
  [
    grouping,
    function_call_or_member_access,
    unary('!'),
    unary('-'),
    unary('typeof'),
    unary('await'),
    // TODO 'delete' operator
    binary(['**']),
    binary(['*','/','%']),
    binary(['+','-']),
    binary(['<','>','<=','>=', 'instanceof']),
    binary(['===', '==', '!==', '!=']),
    binary(['&&']),
    binary(['||', '??']),
    ternary,
  ].reduce(
    (prev, next) => next(prev),
    cxt => expr(cxt)
  )

const function_decl = if_ok(
  function_expr(true),
  // wrap function_expr with function_decl
  node => ({...node, type: 'function_decl', children: [node]})
)

const decl_pair = if_ok(
  seq([destructuring, literal('='), expr]),
  ({value, ...node}) => {
    const [lefthand, _eq, expr] = value
    return {
      ...node,
      type: 'decl_pair',
      children: [lefthand, expr],
    }
  }
)

/*
Like decl_pair, but lefthand can be only an identifier.

The reason for having this is that currently we don't compile correctly code
like this:

  let {x} = ...

If we have just

  let x = ...

Then we compile it into

  const x = new Multiversion(cxt, ...)

For 'let {x} = ...' we should compile it to something like

  const {x} = ...
  const __x_multiversion = x;

And then inside eval.js access x value only through __x_multiversion

See branch 'let_vars_destructuring'

Same for assignment
*/
const simple_decl_pair = if_ok(
  seq([identifier, literal('='), expr]),
  ({value, ...node}) => {
    const [lefthand, _eq, expr] = value
    return {
      ...node,
      type: 'decl_pair',
      children: [lefthand, expr],
    }
  }
)

const const_or_let = is_const => if_ok(
  seq_select(1, [
    literal(is_const ? 'const' : 'let'),
    comma_separated_1(
      is_const
        ? decl_pair
        : either(simple_decl_pair, identifier)
    )
  ]),
  ({value, ...node}) => ({
    ...node,
    type: is_const ? 'const' : 'let',
    children: value.value,
  })
)

const const_statement = const_or_let(true)

const let_declaration = const_or_let(false)

// TODO object assignment required braces, like ({foo} = {foo: 1})
// require assignment cannot start with '{' by not_followed_by
// TODO chaining assignment, like 'foo = bar = baz'
// TODO +=, *= etc
// TODO make assignment an expression, not a statement. Add comma operator to
// allow multiple assignments
const assignment = if_ok(
  comma_separated_1(
    either(
      simple_decl_pair,
      check_if_valid(
        if_ok(
          seq([
            expr,
            literal('='),
            expr,
          ]),
          ({value: [lefthand, _, righthand], ...node}) => {
            return {...node,
              type: 'assignment_pair',
              children: [lefthand, righthand],
            }
          }
        ),
        (node) => {
          const [lefthand, righthand] = node.children
          if(lefthand.type != 'member_access' || lefthand.is_optional_chaining) {
            return {ok: false, error: 'Invalid left-hand side in assignment'}
          } else {
            return {ok: true}
          }
        }
      )
    )
  ),
  ({value, ...node}) => ({
    ...node,
    type: 'assignment',
    children: value,
  })
)


const return_statement = either(
  // return expr
  if_ok(
    seq_select(1, [
      not_followed_by(
        literal('return'),
        newline,
      ),
      expr,
    ]),
    ({value, ...node}) => ({
      ...node,
      type: 'return',
      children: [value],
    })
  ),

  // bare return statement 
  if_ok(
    literal('return'),
    node => ({
      ...node,
      type: 'return',
      children: [],
      value: null,
    })
  ),
)

const if_branch = if_ok(
  seq_select(1, [
    literal('{'),
    cxt => parse_do(cxt),
    literal('}'),
  ]),
  ({value, ...node}) => ({...value, ...node})
)

const if_statement =
  // TODO allow single statement without curly braces?
  if_ok(
    seq([
      literal('if'),
      literal('('),
      expr,
      literal(')'),
      if_branch,
      if_ok_then(
        optional(literal('else')),
        value => value == null
          ? ret(null)
          : either(
              if_branch,

              // else if
              cxt => if_statement(cxt),
            )
      )
    ]),

    ({value, ...node}) => {
      const cond = value[2]
      const left = value[4]
      const else_ = value[5]
      if(else_ == null) {
        return {
          ...node,
          type: 'if',
          children: [cond, left],
        }
      } else {
        return {
          ...node,
          type: 'if',
          children: [cond, left, else_],
        }
      }
    },
  )

const throw_statement = if_ok(
  seq_select(1, [
    not_followed_by(
      literal('throw'),
      newline,
    ),
    expr,
  ]),
  ({value, ...node}) => ({
    ...node,
    type: 'throw',
    children: [value],
  })
)

const import_statement = 
  // TODO import *, import as
  if_ok(
    seq([
      optional(by_type('pragma_external')),
      seq([
        literal('import'),
        // TODO import can have both named import and default import,
        // like 'import foo, {bar} from "module"'
        optional(
          seq_select(0, [
            either(
              list(
                ['{', '}'],
                identifier,
              ),
              identifier,
            ),
            literal('from'),
          ]),
        ),
        string_literal
      ])
    ]),
    ({value: [pragma_external, imp]}) => {
      const {value: [_import, imports, module], ...node} = imp
      let default_import, children
      if(imports == null) {
        children = []
      } else if(imports.value.type == 'identifier') {
        default_import = imports.value.value
        children = [imports.value]
      } else {
        children = imports.value.value
      }
      // remove quotes
      const module_string = module.value.slice(1, module.value.length - 1)
      // if url starts with protocol, then it is always external
      const is_external_url = new RegExp('^\\w+://').test(module_string)
      return {
        ...node,
        not_evaluatable: true,
        type: 'import',
        is_external: is_external_url || pragma_external != null,
        // TODO refactor hanlding of string literals. Drop quotes from value and
        // fix codegen for string_literal
        module: module_string,
        default_import,
        children,
      }
    }
  )

const export_statement =
  either(
    if_ok(
      seq_select(1, [
        literal('export'),
        // TODO export let statement, export function, export default, etc. 
        // Should we allow let statement? (it is difficult to transpile)
        const_statement,
      ]),
      ({value, ...node}) => ({
        ...node,
        not_evaluatable: true,
        type: 'export',
        is_default: false,
        children: [value],
      })
    ),
    if_ok(
      seq_select(2, [
        literal('export'),
        literal('default'),
        expr,
      ]),
      ({value, ...node}) => ({
        ...node,
        not_evaluatable: true,
        type: 'export',
        is_default: true,
        children: [value],
      })
    ),

  )


const do_statement = either(
  const_statement,
  let_declaration,
  assignment,
  if_statement,
  throw_statement,
  return_statement,
  function_decl,
)

const module_statement = either(
  const_statement,
  let_declaration,
  assignment,
  if_statement,
  throw_statement,
  import_statement,
  export_statement,
  function_decl,
)

const parse_do_or_module = (is_module) =>
  if_ok(
    repeat_until(
      either(
        // allows to repeat semicolons
        literal(';'),

        // expr or statement
        if_ok(
          seq_select(0, [
            either(
              is_module
                ? module_statement
                : do_statement,
              expr,
            ),
            if_fail(
              either(
                literal(';'),
                // Parse newline as semicolon (automatic semicolon insertion)
                newline,
                eof,
                lookahead(literal('}')),
              ),
              'unexpected token'
            )
            ]),
          // TODO fix that here we drop ';' from string. use node.length and node.index
          node => node.value
        )
      ),

      // Until
      either(
        eof,
        lookahead(literal('}')),
      ),
    ),
    ({value, ...node}) => ({
      ...node,
      type: 'do',
      children: value
        // drop semicolons
        .filter(n => n.type != 'punctuation'),
    })
  )

const parse_do = parse_do_or_module(false)

const program = (is_module) => either(
  // either empty program
  if_ok(eof, _ => ({type: 'do', index: 0, length: 0, children: []})),

  is_module ? parse_do_or_module(true) : parse_do
)

const finished_program = (is_module) => finished(program(is_module))

const update_children_not_rec = (node, children = node.children) => {
  if(node.type == 'object_literal'){
    return { ...node, elements: children}
  } else if(node.type == 'array_literal'){
    return {...node, elements: children}
  } else if([
    'identifier', 
    'number', 
    'string_literal', 
    'builtin_identifier', 
    'backtick_string',
    ].includes(node.type))
  {
    return node
  } else if(node.type == 'function_expr'){
    return {...node,
      function_args: children[0],
      body: children[children.length - 1],
    }
  } else if(node.type == 'ternary'){
    return {...node,
      cond: children[0],
      branches: children.slice(1),
    }
  } else if(node.type == 'const'){
    return {...node,
      is_statement: true,
    }
  } else if(node.type == 'let'){
    return {...node, is_statement: true }
  } else if(node.type == 'decl_pair') {
    return {...node, expr: children[1], name_node: children[0]}
  } else if(node.type == 'assignment_pair') {
    return {...node, children}
  } else if(node.type == 'assignment'){
    return {...node, is_statement: true}
  } else if(node.type == 'do'){
    return {...node, is_statement: true}
  } else if(node.type == 'function_decl'){
    return {...node,
      is_statement: true,
    }
  } else if(node.type == 'unary') {
    return {...node,
      expr: children[0],
    }
  } else if(node.type == 'binary'){
    return {...node,
      args: children,
    }
  } else if(node.type == 'member_access'){
    return {...node,
      object: children[0],
      property: children[1],
    }
  } else if(node.type == 'function_call'){
    return {...node,
      fn: children[0],
      args: children[1],
    }
  } else if(node.type == 'call_args') {
    return node
  } else if(node.type == 'array_spread' || node.type == 'object_spread') {
    return {...node,
      expr: children[0],
    }
  } else if(node.type == 'key_value_pair') {
    return {...node,
      key: children[0],
      value: children[1],
    }
  } else if(node.type == 'computed_property') {
    return {...node,
      expr: children[0]
    }
  } else if(node.type == 'new') {
    return {...node, constructor: children[0], args: children[1]}
  } else if(node.type == 'grouping') {
    return {...node, expr: children[0]}
  } else if(node.type == 'return') {
    return {...node, 
      expr: children[0],
      is_statement: true,
    }
  } else if(node.type == 'throw') {
    return {...node,
      expr: children[0],
      is_statement: true,
    }
  } else if(node.type == 'if'){
    return {...node,
      cond: children[0],
      branches: children.slice(1),
      is_statement: true,
    }
  } else if(
    ['array_destructuring', 'object_destructuring', 'function_args']
      .includes(node.type)
  ) {
    return {...node,
      elements: children,
    }
  } else if(node.type == 'destructuring_default') {
    return {...node,
      name_node: children[0], 
      expr: children[1],
    }
  } else if(node.type == 'destructuring_rest') {
    return {...node,
      name_node: children[0],
    }
  } else if(node.type == 'destructuring_pair') {
    return {...node,
      key: children[0],
      value: children[1],
    }
  } else if(node.type == 'import') {
    return {...node,
      is_statement: true,
    }
  } else if(node.type == 'export') {
    return {...node,
      binding: children[0],
      is_statement: true,
    }
  } else {
    console.error('invalid node', node)
    throw new Error('unknown node type ' + node.type)
  }
}

export const update_children = node => {
  if(Array.isArray(node)) {
    return node.map(update_children)
  } else {
    const children = node.children == null
      ? null
      : update_children(node.children);

    return {...update_children_not_rec(node, children), children}
  }
}

const do_deduce_fn_names = (node, parent) => {
  let changed, node_result
  if(node.children == null) {
    node_result = node
    changed = false
  } else {
    const children_results = node
      .children
      .map(c => do_deduce_fn_names(c, node))
    changed = children_results.some(c => c[1])
    if(changed) {
      node_result = {...node, children: children_results.map(c => c[0])}
    } else {
      node_result = node
    }
  }

  if(
    node_result.type == 'function_expr' 
    && 
    // not a named function
    node_result.name == null
  ) {
    let name
    if(parent?.type == 'decl_pair') {
      if(parent.name_node.type == 'identifier') {
        name = parent.name_node.value
      }
    } else if(parent?.type == 'key_value_pair') {
      // unwrap quotes with JSON.parse
      name = JSON.parse(parent.key.value)
    } else {
      name = 'anonymous'
    }
    changed = true
    node_result = {...node_result, name}
  }

  return [node_result, changed]
}

const deduce_fn_names = node => {
  return do_deduce_fn_names(node, null)[0]
}

export const parse = (str, globals, is_module = false, module_name) => {

  // Add string to node for debugging
  // TODO remove, only need for debug
  const populate_string = node => {
    if(
      (node.index == null || node.length == null || isNaN(node.index) || isNaN(node.length))
    ) {
      console.error(node)
      throw new Error('invalid node')
    } else {
      const withstring = {...node, string: str.slice(node.index, node.index + node.length)}
      return withstring.children == null
      ? withstring
      : {...withstring, children: withstring.children.map(populate_string)}
    }
  }

  const {tokens, ok, index, message} = tokenize_js(str)
  if(!ok) {
    return {ok: false, problems: [{message, index}]}
  } else {
    const significant_tokens = tokens.filter(token => 
      token.type != 'whitespace' && token.type != 'comment'
    )

    const cxt = {
      tokens: significant_tokens,
      current: 0,
      // TODO remove, str here is only for debug (see `log` function)
      str
    }
    const result = finished_program(is_module)(cxt)
    if(!result.ok) {
      const token = current(result.cxt)
      const index = token == null ? str.length - 1 : token.index
      return {
        ok: false, 
        problems: [{
          message: result.error, 
          token, 
          index,
          // Only for debugging
          errorlocation: str.slice(index, 20)
        }],
      }
    } else {
      const {node, undeclared} = find_definitions(
        update_children(result.value), 
        globals,
        null, 
        null, 
        module_name
      )
      if(undeclared.length != 0){
        return {
          ok: false,
          problems: undeclared.map(u => ({
            index: u.index,
            length: u.length,
            message: 'undeclared identifier: ' + u.value,
          }))
        } 
      } else {
        // TODO remove populate_string (it is left for debug)
        //
        // call update_children, becase find_definitions adds `definition`
        // property to some nodes, and children no more equal to other properties
        // of nodes by idenitity, which somehow breaks code (i dont remember how
        // exactly). Refactor it?
        const fixed_node = update_children(
          find_versioned_let_vars(deduce_fn_names(populate_string(node))).node
        )
        const problems = analyze(fixed_node)
        if(problems.length != 0) {
          return {ok: false, problems}
        } else {
          return {ok: true, node: fixed_node}
        }
      }
    }
  }
}

export const print_debug_node = node => {
  const do_print_debug_node = node => {
    const {index, length, string, type, children} = node
    const res = {index, length, string, type}
    if(children == null) {
      return res
    } else {
      const next_children = children.map(do_print_debug_node)
      return {...res, children: next_children}
    }
  }
  return stringify(do_print_debug_node(node))
}

const do_load_modules = (module_names, loader, already_loaded, globals) => {
  const parsed = module_names
    .filter(module_name => already_loaded[module_name] == null)
    .map(module_name => {
      const m = loader(module_name)
      if(m == null) {
        return [module_name, {ok: false, problems: [{is_load_error: true}]}]
      } else if(typeof(m) == 'object' && m.ok != null) {
        // Allows cache parse result
        return [module_name, m]
      } else if(typeof(m) == 'string') {
        return [module_name, parse(m, globals, true, module_name)]
      } else {
        throw new Error('illegal state')
      }
    })

  const {ok, problems} = parsed.reduce(
    ({ok, problems}, [module_name, parsed]) => ({
      ok: ok && parsed.ok,
      problems: [
        ...problems, 
        ...(parsed.problems ?? []).map(p => ({...p, module: module_name}))
      ],
    }),
    {ok: true, problems: []}
  )

  const cache = Object.fromEntries(parsed)

  if(!ok) {
    return {ok: false, problems, cache}
  }

  const modules = Object.fromEntries(
    parsed.map(([module_name, parsed]) => 
      [module_name, parsed.node]
    )
  )

  const deps = uniq(
    Object.values(modules)
      .map(m => collect_imports(m))
      .flat()
  )

  if(deps.length == 0) {
    return {ok: true, modules, cache}
  }

  // TODO when refactor this function to async, do not forget that different
  // deps can be loaded independently. So dont just put `await Promise.all(`
  // here
  const loaded_deps = do_load_modules(
    deps, 
    loader, 
    {...already_loaded, ...modules}, 
    globals
  )
  if(loaded_deps.ok) {
    return {
      ok: true, 
      modules: {...modules, ...loaded_deps.modules},
      cache: {...cache, ...loaded_deps.cache},
    }
  } else {
    // Match modules failed to load with import statements and generate
    // problems for this import statements

    const failed_to_load = loaded_deps.problems
      .filter(p => p.is_load_error)
      .map(p => p.module)

    const load_problems = Object.entries(modules)
      .map(([module, node]) => 
        node.children
          .filter(n => n.type == 'import')
          .map(i => [module, i])
      )
      .flat()
      .filter(([module, i]) => 
        failed_to_load.find(m => m == i.full_import_path) != null
      )
      .map(([module, i]) => ({
        message: 'failed lo load module ' + i.full_import_path, 
        module,
        index: i.index
      }))

    return {
      ok: false, 
      problems: [
        ...load_problems,
        ...loaded_deps.problems.filter(p => !p.is_load_error),
      ],
      cache: {...cache, ...loaded_deps.cache},
    }
  }
}

export const load_modules = (entry_module, loader, globals) => {
  // TODO check_imports. detect cycles while modules are loading, in
  // do_load_modules

  const result = do_load_modules([entry_module], loader, {}, globals)
  if(!result.ok) {
    return result
  } else {
    return {...result, sorted: topsort_modules(result.modules)}
  }
}
