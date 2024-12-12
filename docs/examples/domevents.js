window.addEventListener('load', () => {
  const text = document.createElement('input')

  const checkbox = document.createElement('input')
  checkbox.setAttribute('type', 'checkbox')

  const radio = document.createElement('input')
  radio.setAttribute('type', 'radio')

  const range = document.createElement('input')
  range.setAttribute('type', 'range')

  const select = document.createElement('select')
  Array.from({length: 5}, (_, i) => i).forEach(i => {
    const option = document.createElement('option')
    option.setAttribute('value', i)
    option.innerText = i
    select.appendChild(option)
  })

  const div = document.createElement('div')

  const elements = { text, checkbox, range, select, radio, div}
  
  Object.entries(elements).forEach(([name, el]) => {
    document.body.appendChild(el);
    ['click', 'input', 'change'].forEach(type => {
      el.addEventListener(type, e => {
        const row = document.createElement('div')
        div.appendChild(row)
        row.innerText = [name, type, e.target.value, e.target.checked, e.target.selectedIndex].join(', ')
      })
    })
  })
})
