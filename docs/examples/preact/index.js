/* external */
import {h, render} from 'https://unpkg.com/preact?module';

/* external */
import {Stateful} from './stateful.js'

const Counter = Stateful({
  getInitialState: () => ({counter: 0}),

  handlers: {
    inc: ({counter}) => ({counter: counter + 1}),
    dec: ({counter}) => ({counter: counter - 1}),
  },
  
  render: (props, state, handlers) => 
    h('div', null,
      h('span', null, state.counter),
      h('button', {onClick: handlers.inc}, 'Increment'),
      h('button', {onClick: handlers.dec}, 'Decrement'),
    )
})

render(h(Counter), globalThis.document.body)
