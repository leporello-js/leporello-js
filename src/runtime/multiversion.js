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

export class Multiversion {
  constructor(cxt, initial) {
    this.cxt = cxt
    this.expand_calltree_node_number = cxt.expand_calltree_node_number
    this.latest = initial
    this.versions = [{version_number: cxt.version_counter, value: initial}]
  }

  is_created_during_current_expand() {
    return this.expand_calltree_node_number == this.cxt.expand_calltree_node_number
  }

  get() {
    if(!this.cxt.is_expanding_calltree_node) {
      return this.latest
    } else {
      if(this.is_created_during_current_expand()) {
        return this.latest
      } else {
        const version_number = this.cxt.version_counter
        return this.get_version(version_number)
      }
    }
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

  set(value) {
    const version_number = ++this.cxt.version_counter
    if(this.cxt.is_expanding_calltree_node) {
      if(this.is_created_during_current_expand()) {
        this.latest = value
        this.set_version(version_number, value)
      } else {
        // do nothing
      }
    } else {
      this.latest = value
      this.set_version(version_number, value)
    }
  }

  set_version(version_number, value) {
    this.versions.push({version_number, value})
  }
}
