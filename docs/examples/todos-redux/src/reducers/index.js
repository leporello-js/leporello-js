import todos from './todos.js'
import visibilityFilter from './visibilityFilter.js'

export default Redux.combineReducers({
  todos,
  visibilityFilter
})
