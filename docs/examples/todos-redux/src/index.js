import App from "./components/App.js"
import rootReducer from "./reducers/index.js"

const h = React.createElement

const store = Redux.createStore(rootReducer)

ReactDOM.render(
  h(ReactRedux.Provider, { store }, h(App)),
  document.getElementById("root"),
)
