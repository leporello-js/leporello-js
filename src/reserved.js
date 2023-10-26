// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#keywords

export const reserved = [
'break',
'case',
// TODO: fix parser to allow catch be an Object key, as other reserved words.
// Currently we make exception for promise.catch
// 'catch', 
'class',
'const',
'continue',
'debugger',
'default',
'delete',
'do',
'else',
'export',
'extends',
// TODO: fix parser to allow finally be an Object key, as other reserved words.
// Currently we make exception for promise.finally
// 'finally', 
'for',
'function',
'if',
'import',
'in',
'instanceof',
'new',
'return',
'super',
'switch',
'this',
'throw',
'try',
'typeof',
'var',
'void',
'while',
// TODO: fix parser to allow 'with' be an Object key, as other reserved words.
// Currently we make exception for Array.with
// 'with',
'yield',
'enum',
'implements',
'interface',
'let',
'package',
'private',
'protected',
'public',
'static',
'yield',
'await',
]
