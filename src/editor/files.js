import {el} from './domutils.js'
import {map_find} from '../utils.js'
import {load_dir, create_file} from '../filesystem.js'
import {exec, get_state, open_directory} from '../index.js'

export class Files {
  constructor(ui) {
    this.ui = ui
    this.el =  el('div', 'files_container')
    this.render(get_state())
  }

  render(state) {
    if(state.project_dir == null) {
      this.el.innerHTML = ''
      this.el.appendChild(
        el('div', 'allow_file_access',
          el('a', {
              href: 'javascript:void(0)',
              click: open_directory,
          },
            `Allow access to local project folder`,
          ),
          el('div', 'subtitle', `Your files will never leave your device`)
        )
      )
    } else {
      this.render_files(state.project_dir, state.current_module)
    }
  }

  render_files(dir, current_module) {
    const files = this.el.querySelector('.files')

    const children = [
      this.render_file({name: '*scratch*', path: ''}, current_module),
      this.render_file(dir, current_module),
    ]

    if(files == null) {
      this.el.innerHTML = ''
      this.el.appendChild(
        el('div', 'file_actions',
          el('a', {
            href: 'javascript: void(0)', 
            click: this.create_file.bind(this, false),
          }, 
            'Create file'
          ),
          el('a', {
            href: 'javascript: void(0)',
            click: this.create_file.bind(this, true),
          }, 'Create dir'),
        )
      )
      this.el.appendChild(
        el('div', 'files',
          children
        )
      )
    } else {
      // Replace to preserve scroll position
      files.replaceChildren(...children)
    }
  }

  render_file(file, current_module) {
    const result =  el('div', 'file',
      el('div', {
          'class': 'file_title' + (file.path == current_module ? ' active' : ''), 
          click: e => this.on_click(e, file)
        }, 
        el('span', 'icon',
          file.kind == 'directory'
            ? '\u{1F4C1}' // folder icon
            : '\xa0',
        ),
        file.name, 
      ),
      file.children == null 
        ? null
        : file.children.map(c => this.render_file(c, current_module))
    )

    if(file.path == current_module) {
      this.active_el = result
      this.active_file = file
    }

    return result
  }

  async create_file(is_dir) {

    if(this.active_file == null) {
      throw new Error('no active file')
    }

    let name = prompt(`Enter ${is_dir ? 'directory' : 'file'} name`)
    if(name == null) {
      return
    }

    let dir

    const root = get_state().project_dir

    if(this.active_file.path == '' /* scratch */) {
      // Create in root directory
      dir = root
    } else {
      if(this.active_file.kind == 'directory') {
        dir = this.active_file
      } else {

        const find_parent = (dir, parent) => {
          if(dir.path == this.active_file.path) {
            return parent
          }
          if(dir.children == null) {
            return null
          }
          return map_find(dir.children, c => find_parent(c, dir))
        }

        dir = find_parent(root)

        if(dir == null) {
          throw new Error('illegal state')
        }
      }
    }

    const path = dir == root ? name : dir.path + '/' + name
    await create_file(path, is_dir)

    // Reload all files for simplicity
    load_dir(false).then(dir => {
      if(is_dir) {
        exec('load_dir', dir)
      } else {
        exec('create_file', dir, path)
      }
    })
  }


  on_click(e, file) {
    e.stopPropagation()
    this.active_el.querySelector('.file_title').classList.remove('active')
    this.active_el = e.currentTarget.parentElement
    e.currentTarget.classList.add('active')
    this.active_file = file
    if(file.kind != 'directory') {
      exec('change_current_module', file.path)
    }
  }
}
