import Footer from "./Footer.js"
import AddTodo from "../containers/AddTodo.js"
import VisibleTodoList from "../containers/VisibleTodoList.js"

const h = React.createElement

const App = () => h("div", null, h(AddTodo), h(VisibleTodoList), h(Footer))

export default App
