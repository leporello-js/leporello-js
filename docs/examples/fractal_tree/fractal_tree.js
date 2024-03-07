// Original source: http://bricault.mit.edu/recursive-drawing
// Author: Sarah Bricault

// Canvas setup
const canvas = document.createElement('canvas')
canvas.width = 700
canvas.height = 700
document.body.appendChild(canvas)
const ctx = canvas.getContext('2d')
ctx.translate(canvas.width / 2, canvas.height)

// Draw a tree
fractalTreeBasic({totalIterations: 10, basicLength: 10, rotate: 25})

function fractalTreeBasic({totalIterations, basicLength, rotate}) {

  // Draw the tree trunk
  const trunkLength = basicLength * 2 * Math.pow(1.2, totalIterations + 1)
  const width = Math.pow(totalIterations, 0.6)

  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, - trunkLength)
  ctx.lineWidth = width
  ctx.strokeStyle = 'black'
  ctx.stroke()

  drawBranch(90, [0, - trunkLength], totalIterations + 1)

  function drawBranch(angle, startPoint, iterations) {
    const len = basicLength * Math.pow(1.2, iterations)

    const width = Math.pow(iterations, 0.6)

    const red = Math.floor(255 - (iterations / totalIterations) * 255)
    const green = 0
    const blue = Math.floor( 255 - (iterations / totalIterations) * 255)
    const color = `rgb(${red}, ${green}, ${blue})`

    const x1 = startPoint[0]
    const y1 = startPoint[1]

    const y2 = y1 - len * Math.sin((angle * Math.PI) / 180)
    const x2 = x1 + len * Math.cos((angle * Math.PI) / 180)

    console.log('draw branch', x1, y1, x2, y2)

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.lineWidth = width
    ctx.strokeStyle = color
    ctx.stroke()

    if (iterations - 1 > 0) {
      // draw left branch
      drawBranch(angle + rotate, [x2, y2], iterations - 1)
      // draw right branch
      drawBranch(angle - rotate, [x2, y2], iterations - 1)
    }
  }
}
