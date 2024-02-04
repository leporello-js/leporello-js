import {exec} from '../index.js'
import {stringify_for_header} from '../value_explorer_utils.js'

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
      } else if(child !== null && child !== false) {
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

function fn_link(fn){
  // TODO if name is empty or 'anonymous', then show its source code instead
  // of name
  const str = fn.__location == null 
    ? `<span>${fn.name}</span>`
    : `<a href='javascript:void(0)'><i>fn</i> ${fn.name}</a>`
  const c = document.createElement('div')
  c.innerHTML = str
  const el = c.children[0]
  if(fn.__location != null) {
    el.addEventListener('click', e => {
      e.stopPropagation()
      exec('goto_location',fn.__location)
    })
  }
  return el
}

export function value_to_dom_el(value) {
  return typeof(value) == 'function'
    ? fn_link(value)
    : stringify_for_header(value)
}

export function join(arr, separator = ', ') {
  const result = []
  for(let i = 0; i < arr.length; i++) {
    result.push(arr[i])
    if(i != arr.length - 1) {
      result.push(separator)
    }
  }
  return result
}


// Idea is borrowed from:
// https://mhk-bit.medium.com/scroll-into-view-if-needed-10a96e0bdb61
// https://stackoverflow.com/questions/37137450/scroll-all-nested-scrollbars-to-bring-an-html-element-into-view
export const scrollIntoViewIfNeeded = (container, target) => {

  // Target is outside the viewport from the top
  if(target.offsetTop - container.scrollTop - container.offsetTop < 0){
    // The top of the target will be aligned to the top of the visible area of the scrollable ancestor
    target.scrollIntoView(true);
  }

  // Target is outside the view from the bottom
  if(target.offsetTop - container.scrollTop - container.offsetTop - container.clientHeight + target.clientHeight > 0) {
    //  The bottom of the target will be aligned to the bottom of the visible area of the scrollable ancestor.
    target.scrollIntoView(false);
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
