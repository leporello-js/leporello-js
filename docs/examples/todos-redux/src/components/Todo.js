const h = React.createElement

const Todo = ({ onClick, completed, text }) =>
  h(
    "li",
    {
      onClick,
      style: {
        textDecoration: completed ? "line-through" : "none",
      },
    },
    text,
  )

export default Todo
