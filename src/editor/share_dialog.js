import {el} from './domutils.js'
import {save_share} from '../share.js'
import {get_state} from '../index.js'

export class ShareDialog {
  constructor() {
    this.el = el('dialog', 'share_dialog', 
      this.upload_begin = el('p', '',
        el('p', '',
          'This button will upload your scratch file to the cloud for sharing with others.'),
        el('ul', '', 
          el('li', '', 
            'Please ensure that no personal data or confidential information is included.'
          ),
          el('li', '', 
            'Avoid including copyrighted materials.'
          ),
        ),
        el('span', {style: 'color: red'}, 
          'Caution: Once shared, files cannot be deleted.'
        ),
        this.upload_buttons = el('p', {style: 'text-align: center'}, 
          el('button', {
            'class': 'upload_button',
            click: () => this.upload()
          },
            "Upload"
          ),
          this.cancel_button = el('button', {
            style: 'margin-left: 1em',
            click: () => this.cancel()
          },
            "Cancel"
          )
        ),
      ),
      this.uploading = el('span', {style: 'display: none'},
        "Uploading..."
      ),
      this.upload_finish = el('p', {style: 'display: none'}, 
        el('p', '', 
          el('p', {style: `
            text-align: center; 
            margin-bottom: 1em; 
            font-size: 1.2em
          `}, 'Upload successful'),
          this.url_share = el('input', {
            type: 'text',
            readonly: true,
            style: 'min-width: 30em',
          }),
          this.copy_button = el('button', {
            click: () => this.copy(),
            style: 'margin-left: 1em',
          }, 'Copy URL')
        ),
        this.close_button = el('button', {
          style: 'display: block; margin: auto',
          click: () => this.cancel(),
        }, 'Close'),
      )
    )
  }

  async upload() {
    this.uploading.style.display = ''
    this.upload_begin.style.display = 'none'
    try {
      const id = await save_share(get_state().files[''])
      this.url = new URL(window.location)
      this.url.searchParams.append('share_id', id)
      this.url_share.value = this.url
      this.upload_finish.style.display = ''
    } catch(e) {
      alert(e.message)
      this.upload_begin.style.display = ''
    } finally {
      this.uploading.style.display = 'none'
    }
  }

  copy() {
    this.url_share.select()
    document.execCommand('copy')
  }

  cancel() {
    this.upload_finish.style.display = 'none'
    this.upload_begin.style.display = ''
    this.el.close()
  }
}
