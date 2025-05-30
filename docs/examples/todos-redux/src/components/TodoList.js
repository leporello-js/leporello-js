import Todo from "./Todo.js"

const h = React.createElement

const TodoList = ({ todos, toggleTodo }) =>
  h(
    "ul",
    null,
    todos.map(todo =>
      h(Todo, {
        key: todo.id,
        ...todo,
        onClick: () => toggleTodo(todo.id),
      }),
    ),
  )

export default TodoList
