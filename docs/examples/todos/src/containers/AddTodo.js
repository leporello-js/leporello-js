import { addTodo } from '../actions/index.js'

const h = React.createElement

const AddTodo = ({ dispatch }) => {
  let input

  return (
    h('div', null,
      h('form', { onSubmit: e => {
          e.preventDefault()
          if (!input.value.trim()) {
            return
          }
          dispatch(addTodo(input.value))
          input.value = ''
        }
      },
        h('input', {ref: node => {input = node}}),
        h('button', {type: 'submit'}, 'Add Todo')
      )
    )
  )
}

export default ReactRedux.connect()(AddTodo)
