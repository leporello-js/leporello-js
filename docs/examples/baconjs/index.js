// external
import {} from 'https://unpkg.com/jquery'
// external
import {fromEvent} from 'https://unpkg.com/baconjs?module'

const upEl = globalThis.document.createElement('button')
const downEl = globalThis.document.createElement('button')
const counterEl = globalThis.document.createElement('div')

globalThis.document.body.appendChild(upEl)
globalThis.document.body.appendChild(downEl)
globalThis.document.body.appendChild(counterEl)

const up = fromEvent(upEl, 'click');
const down = fromEvent(downEl, 'click');

const counter =
  // map up to 1, down to -1
  up.map(1).merge(down.map(-1))
  // accumulate sum
    .scan(0, (x,y) => x + y);

// assign observable value to jQuery property text
counter.onValue(text => Object.assign(counterEl, {innerText: text}));
