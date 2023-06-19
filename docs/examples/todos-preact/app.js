import {render} from 'https://unpkg.com/preact?module';

let state, component, root

export const createApp = initial => {
  /* if state is already initialized then preserve it */
  state = state ?? initial.initialState
  component = initial.component
  root = initial.root 
  do_render()
}

export const handler = fn => (...args) => {
  state = fn(state, ...args)
  do_render()
}

export const connect = comp => props => comp(props, state)

const do_render = () => render(component(), root)
