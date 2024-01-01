import {Multiversion} from './multiversion.js'

// https://stackoverflow.com/a/29018745
function binarySearch(arr, el, compare_fn) {
    let m = 0;
    let n = arr.length - 1;
    while (m <= n) {
        let k = (n + m) >> 1;
        let cmp = compare_fn(el, arr[k]);
        if (cmp > 0) {
            m = k + 1;
        } else if(cmp < 0) {
            n = k - 1;
        } else {
            return k;
        }
    }
    return ~m;
}

export class LetMultiversion extends Multiversion {
  constructor(cxt, initial) {
    super(cxt)
    this.latest = initial
    this.versions = [{version_number: cxt.version_counter, value: initial}]
  }

  rollback_if_needed() {
    if(this.needs_rollback()) {
      this.latest = this.get_version(this.cxt.version_counter)
    }
  }

  get() {
    this.rollback_if_needed()
    return this.latest
  }

  set(value) {
    this.rollback_if_needed()
    const version_number = ++this.cxt.version_counter
    if(this.is_created_during_current_expansion()) {
      this.versions.push({version_number, value})
    }
    this.latest = value
  }

  get_version(version_number) {
    if(version_number == null) {
      throw new Error('illegal state')
    }
    const idx = binarySearch(this.versions, version_number, (id, el) => id - el.version_number)
    if(idx >= 0) {
      return this.versions[idx].value
    } else if(idx == -1) {
      throw new Error('illegal state')
    } else {
      return this.versions[-idx - 2].value
    }
  }
}
