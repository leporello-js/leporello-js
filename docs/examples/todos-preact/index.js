/*
  Example of a TODO app built using the Preact library
*/

import * as React from "preact/compat"

// Core

// Global application state
let state

// Preserve state (list of TODOs) when editing code
if (globalThis.leporello) {
  // Retrieve initial state from Leporello storage
  // See: https://github.com/leporello-js/leporello-js?tab=readme-ov-file#saving-state-between-page-reloads
  state = globalThis.leporello.storage.get("state")
}

/*
  Application logic is structured as pure functions with the signature `(state, ...args) => state`.
  This helper function wraps such a function so that its result updates the global state
  and can be used as an event handler.
*/
const handler =
  fn =>
  (...args) => {
    state = fn(state, ...args)
    if (globalThis.leporello) {
      // Persist state to Leporello storage to restore it after page reloads
      globalThis.leporello.storage.set("state", state)
    }
    render()
  }

// Higher-order function that injects the current state into a component
const connect = comp => props => comp(props, state)

const render = () => React.render(<App />, document.body)

// Initialize application state if not already restored from storage
if (state == null) {
  state = {
    todos: [],
    text: "",
    filter: "ALL",
  }
}

window.addEventListener("load", render)

// Components

const App = () => (
  <div>
    <AddTodo />
    <TodoList />
    <Footer />
  </div>
)

const Footer = () => (
  <div>
    <span>Show: </span>
    <FilterLink filter="ALL">All</FilterLink>
    <FilterLink filter="ACTIVE">Active</FilterLink>
    <FilterLink filter="COMPLETED">Completed</FilterLink>
  </div>
)

const FilterLink = connect(({ filter, children }, state) => {
  const disabled = state.filter == filter
  return (
    <button
      onClick={handler(changeFilter.bind(null, filter))}
      disabled={disabled}
      style={{ marginLeft: "4px" }}
    >
      {children}
    </button>
  )
})

const TodoList = connect((_, state) => (
  <ul>
    {visibleTodos(state).map(todo => (
      <Todo key={todo.id} todo={todo} />
    ))}
  </ul>
))

const Todo = ({ todo }) => (
  <li
    onClick={handler(toggleTodo.bind(null, todo))}
    style={{ textDecoration: todo.completed ? "line-through" : "none" }}
  >
    {todo.text}
  </li>
)

const AddTodo = connect((_, state) => {
  return (
    <div>
      <form onSubmit={handler(createTodo)}>
        <input value={state.text} onChange={handler(changeText)} autoFocus />
        <button type="submit">Add Todo</button>
      </form>
    </div>
  )
})

// Selectors

// Returns a filtered list of TODOs based on the current filter state
function visibleTodos(state) {
  if (state.filter == "ALL") {
    return state.todos
  } else if (state.filter == "ACTIVE") {
    return state.todos.filter(t => !t.completed)
  } else if (state.filter == "COMPLETED") {
    return state.todos.filter(t => t.completed)
  } else {
    throw new Error("Unknown filter")
  }
}

// Reducers

// Updates the input text state
function changeText(state, e) {
  return { ...state, text: e.target.value }
}

// Updates the active filter state
function changeFilter(filter, state) {
  return { ...state, filter }
}

// Creates a new TODO item if the input text is not empty
function createTodo(state, e) {
  e.preventDefault()

  if (!state.text.trim()) {
    return state
  }

  return {
    ...state,
    todos: [...state.todos, { text: state.text }],
    text: "",
  }
}

// Toggles the completion state of a TODO item
function toggleTodo(todo, state) {
  return {
    ...state,
    todos: state.todos.map(t =>
      t == todo ? { ...todo, completed: !todo.completed } : t,
    ),
  }
}
