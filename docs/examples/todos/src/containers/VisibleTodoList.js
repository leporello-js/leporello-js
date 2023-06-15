import { toggleTodo } from '../actions/index.js'
import TodoList from '../components/TodoList.js'
import { VisibilityFilters } from '../actions/index.js'

const getVisibleTodos = (todos, filter) => {
  return {
    [VisibilityFilters.SHOW_ALL]: todos,
    [VisibilityFilters.SHOW_COMPLETED]: todos.filter(t => t.completed),
    [VisibilityFilters.SHOW_ACTIVE]: todos.filter(t => !t.completed),
  }[filter]
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
