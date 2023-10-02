/*
  Example of TODO HTML5 app built using preact library
*/

import {h, render} from 'https://unpkg.com/preact?module';

import {createApp, handler, connect} from './app.js'

// Components

const App = () => (
  h('div', null,
    h(AddTodo),
    h(TodoList),
    h(Footer),
  )
)

const Footer = () => (
  h('div', null,
    h('span', null, 'Show: '),
    h(FilterLink, {filter: 'ALL'}, 'All'),
    h(FilterLink, {filter: 'ACTIVE'}, 'Active'),
    h(FilterLink, {filter: 'COMPLETED'}, 'Completed'),
  )
)

const FilterLink = connect(({filter, children}, state) => {
  const disabled = state.filter == filter
  return h('button', {
    onClick: handler(changeFilter.bind(null, filter)),
    disabled,
    style:{
      marginLeft: '4px',
    }
  }, children)
})

const TodoList = connect( (_, state) =>
  h('ul', null,
    visibleTodos(state).map(todo =>
      h(Todo, { todo })
    )
  )
)

const Todo = ({ onClick, todo }) => (
  h('li', {
    onClick: handler(toggleTodo.bind(null, todo)),
    style: {
      textDecoration: todo.completed ? 'line-through' : 'none'
    },
  }, todo.text)
)

const AddTodo = connect((_, state) => {
  return (
    h('div', null,
      h('form', { 
        onSubmit: handler(createTodo),
      },
        h('input', {
          value: state.text, 
          onChange: handler(changeText),
          autoFocus: true,
        }),
        h('button', {type: 'submit'}, 'Add Todo')
      )
    )
  )
})


// Selectors

function visibleTodos(state) {
  if(state.filter == 'ALL') {
    return state.todos
  } else if (state.filter == 'ACTIVE') {
    return state.todos.filter(t => !t.completed)
  } else if(state.filter == 'COMPLETED') {
    return state.todos.filter(t => t.completed)
  } else {
    throw new Error('unknown filter')
  }
}

// Reducers

function changeText(state, e) {
  return {...state, text: e.target.value}
}

function changeFilter(filter, state) {
  return {...state, filter}
}

function createTodo(state, e) {
  e.preventDefault()

  if(!state.text.trim()) {
    return state
  }

  return {
    ...state, 
    todos: [...state.todos, {text: state.text}],
    text: '',
  }
}

function toggleTodo(todo, state) {
  return {
    ...state, 
    todos: state.todos.map(t =>
      (t == todo)
        ? {...todo, completed: !todo.completed}
        : t
    )
  }
}

createApp({

   initialState: {
     todos: [],
     text: '',
     filter: 'ALL',
   },

   component: App,

   root: document.body,
})

