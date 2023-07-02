export const write_example = (name, contents) => {
  localStorage['examples_' + name] = contents
}

const read_example = name => {
  return localStorage['examples_' + name]
}

const list = [
  'github_api/index.js',
  'ethers/block_by_timestamp.js',
  'ethers/index.js',
  // TODO for html5 example, open run window or hint that it should be opened
]
.map(l => l.split('/'))


const get_children = path => {
  const children = list.filter(l => path.every((elem, i) => elem == l[i] ))
  const files = children.filter(c => c.length == path.length + 1)
  const dirs = [...new Set(children
    .filter(c => c.length != path.length + 1)
    .map(c => c[path.length])
  )]
  return Promise.all(files.map(async f => {
      const name = f[path.length]
      const filepath = f.slice(0, path.length + 1).join('/')
      return {
        name,
        path: filepath,
        kind: 'file',
        contents: 
          read_example(filepath) ??
          await fetch(globalThis.location.origin + '/docs/examples/'+ filepath)
            .then(r => r.text()),
      }
    })
    .concat(dirs.map(async d => {
      const p = [...path, d] 
      return {
        name: d,
        path: p.join('/'),
        kind: 'directory',
        children: await get_children(p),
      }
    })))
}

export const examples_promise = get_children([]).then(children => {
  return {
    kind: 'directory',
    name: 'examples',
    path: null,
    children,
  }
})

