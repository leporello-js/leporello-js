const h = React.createElement

const Link = ({ active, children, onClick }) =>
  h(
    "button",
    {
      onClick,
      disabled: active,
      style: {
        marginLeft: "4px",
      },
    },
    children,
  )

export default Link
