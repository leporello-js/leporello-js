import {render} from 'https://unpkg.com/preact?module';

let state, component, root

if(globalThis.leporello) {
  // See https://github.com/leporello-js/leporello-js?tab=readme-ov-file#saving-state-between-page-reloads
  // Get initial state from Leporello storage
  state = globalThis.leporello.storage.get('state')
}

export const createApp = initial => {
  /* if state was loaded from Leporello storage then keep it,
   * otherwise initialize with initial state */
  state = state ?? initial.initialState
  component = initial.component
  root = initial.root 
  do_render()
}

export const handler = fn => (...args) => {
  state = fn(state, ...args)
  if(globalThis.leporello) {
    // Save state to Leporello storage to load it after page reload
    globalThis.leporello.storage.set('state', state)
  }
  do_render()
}

export const connect = comp => props => comp(props, state)

const do_render = () => render(component(), root)
