import { toggleTodo } from '../actions/index.js'
import TodoList from '../components/TodoList.js'
import { VisibilityFilters } from '../actions/index.js'

const getVisibleTodos = (todos, filter) => {
  if(filter == VisibilityFilters.SHOW_ALL) {
    return todos
  } else if(filter == VisibilityFilters.SHOW_COMPLETED) {
    return todos.filter(t => t.completed)
  } else if(filter == VisibilityFilters.SHOW_ACTIVE) {
    return todos.filter(t => !t.completed)
  } else {
    throw new Error('Unknown filter: ' + filter)
  }
}

const mapStateToProps = state => ({
  todos: getVisibleTodos(state.todos, state.visibilityFilter)
})

const mapDispatchToProps = dispatch => ({
  toggleTodo: id => dispatch(toggleTodo(id))
})

export default ReactRedux.connect(
  mapStateToProps,
  mapDispatchToProps
)(TodoList)
