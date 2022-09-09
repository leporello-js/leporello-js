export function el(tag, className, ...children){
  const result = document.createElement(tag)
  if(typeof(className) == 'string'){
    result.setAttribute('class', className)
  } else {
    const attrs = className
    for(let attrName in attrs){
      const value = attrs[attrName]
      if(['change','click'].includes(attrName)){
        result.addEventListener(attrName, value)
      } else if(attrName == 'checked') {
        if(attrs[attrName]){
          result.setAttribute(attrName, "checked")
        }
      } else {
        result.setAttribute(attrName, value)
      }
    }
  }
  children.forEach(child => {
    const append = child => {
      if(typeof(child) == 'undefined') {
        throw new Error('illegal state')
      } else if(child !== null) {
        result.appendChild(
          typeof(child) == 'string'
            ? document.createTextNode(child)
            : child
        )
      }
    }
    if(Array.isArray(child)) {
      child.forEach(append)
    } else {
      append(child)
    }
  })
  return result
}

export function stringify(val){
  function fn_to_str(fn){
    // TODO if name is 'anonymous', then change name for code
    return fn.__location == null 
      ? `<span>${fn.name}</span>`
      : `<a 
          href='javascript:void(0)' 
          data-location=${JSON.stringify(fn.__location)}
         ><i>fn</i> ${fn.name}</a>`
  }
  if(typeof(val) == 'undefined') {
    return 'undefined'
  } else if(typeof(val) == 'function'){
    return fn_to_str(val)
  } else {
    return JSON.stringify(val, (key, value) => {
      if(typeof(value) == 'function'){
        return fn_to_str(value)
      } else {
        return value
      }
    })
  }
}

export function fn_link(fn){
  const str = stringify(fn)
  const c = document.createElement('div')
  c.innerHTML = str
  return c.children[0]
}



// Idea is borrowed from:
// https://mhk-bit.medium.com/scroll-into-view-if-needed-10a96e0bdb61
// https://stackoverflow.com/questions/37137450/scroll-all-nested-scrollbars-to-bring-an-html-element-into-view
export const scrollIntoViewIfNeeded = (container, target) => {

  // Target is outside the viewport from the top
  if(target.offsetTop - container.scrollTop - container.offsetTop < 0){
    // The top of the target will be aligned to the top of the visible area of the scrollable ancestor
    target.scrollIntoView(true);
    // Do not scroll horizontally
    container.scrollLeft = 0
  }

  // Target is outside the view from the bottom
  if(target.offsetTop - container.scrollTop - container.offsetTop - container.clientHeight + target.clientHeight > 0) {
    //  The bottom of the target will be aligned to the bottom of the visible area of the scrollable ancestor.
    target.scrollIntoView(false);
    // Do not scroll horizontally
    container.scrollLeft = 0
  }

  /*
  Also works

  // Target is outside the view from the top
  if (target.getBoundingClientRect().y < container.getBoundingClientRect().y) {
      // The top of the target will be aligned to the top of the visible area of the scrollable ancestor
      target.scrollIntoView();
  }

  // Target is outside the view from the bottom
  if (
    target.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom + 
      // Adjust for scrollbar size
      container.offsetHeight - container.clientHeight
          > 0
  ) {
    //  The bottom of the target will be aligned to the bottom of the visible area of the scrollable ancestor.
    target.scrollIntoView(false);
  }
  */

};
