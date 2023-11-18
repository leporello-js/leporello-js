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
    this.is_expanding_calltree_node = cxt.is_expanding_calltree_node
    this.latest = initial
    this.versions = [{call_id: cxt.call_counter, value: initial}]
  }

  get() {
    const call_id = this.cxt.call_counter

    if(!this.cxt.is_expanding_calltree_node) {
      return this.latest
    } else {
      if(this.is_expanding_calltree_node) {
        // var was created during current expansion, use its latest value
        return this.latest
      } else {
        if(this.latest_copy != null) {
          // value was set during expand_calltree_node, use this value
          return this.latest
        }
        // TODO on first read, set latest and latest_copy?
        return this.get_version(call_id)
      }
    }
  }

  get_version(call_id) {
    const idx = binarySearch(this.versions, call_id, (id, el) => id - el.call_id)
    if(idx == 0) {
      // This branch is unreachable. get_version will be never called for a
      // call_id where let variable was declared.
      throw new Error('illegal state')
    } else if(idx > 0) {
      return this.versions[idx - 1].value
    } else if(idx == -1) {
      throw new Error('illegal state')
    } else {
      return this.versions[-idx - 2].value
    }
  }

  set(value) {
    const call_id = this.cxt.call_counter
    if(this.cxt.is_expanding_calltree_node) {
      if(this.is_expanding_calltree_node) {
        this.latest = value
        this.set_version(call_id, value)
        this.cxt.touched_multiversions.add(this)
      } else {
        if(this.latest_copy == null) {
          this.latest_copy = {value: this.latest}
        }
        this.cxt.touched_multiversions.add(this)
        this.latest = value
      }
    } else {
      this.latest = value
      this.set_version(call_id, value)
    }
  }

  last_version_number() {
    return this.versions.at(-1).call_id
  }

  set_version(call_id, value) {
    const last_version = this.versions.at(-1)
    if(last_version.call_id > call_id) {
      throw new Error('illegal state')
    }
    if(last_version.call_id == call_id) {
      last_version.value = value
      return
    }
    this.versions.push({call_id, value})
  }
}
