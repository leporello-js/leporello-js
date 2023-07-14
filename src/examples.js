export const write_example = (name, contents) => {
  localStorage['examples_' + name] = contents
}

const read_example = name => {
  return localStorage['examples_' + name]
}

export const examples = [
  {
    path: 'github_api',
    entrypoint: 'github_api/index.js',
  },
  {
    path: 'ethers',
    entrypoint: 'ethers/block_by_timestamp.js',
  },
  {
    path: 'todos-preact',
    entrypoint: 'todos-preact/index.js',
    with_app_window: true,
    files: [
      'todos-preact/app.js',
    ]
  },
].map(e => ({...e, entrypoint: e.entrypoint ?? e.path}))

const files_list = examples
  .map(e => {
    return (e.files ?? []).concat([e.entrypoint])
  })
  .flat()
  .map(l => l.split('/'))

const get_children = path => {
  const children = files_list.filter(l => path.every((elem, i) => elem == l[i] ))
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

export const examples_dir_promise = get_children([]).then(children => {
  return {
    kind: 'directory',
    name: 'examples',
    path: null,
    children,
  }
})
