import { addTodo } from '../actions/index.js'

const h = React.createElement

const AddTodo = ({ dispatch }) => {
  const inputref = {}

  return (
    h('div', null,
      h('form', { 
        onSubmit: e => {
          e.preventDefault()
          if (inputref.input.value.trim()) {
            dispatch(addTodo(inputref.input.value))
            Object.assign(inputref.input, {value: ''})
          }
        }
      },
        h('input', {ref: input => Object.assign(inputref, {input})}),
        h('button', {type: 'submit'}, 'Add Todo')
      )
    )
  )
}

export default ReactRedux.connect()(AddTodo)
