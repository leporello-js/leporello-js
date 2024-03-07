// Original source: 
// https://www.freecodecamp.org/news/how-to-create-animated-bubbles-with-html5-canvas-and-javascript/

const canvas = document.createElement('canvas')
canvas.style.backgroundColor = '#00b4ff'
document.body.appendChild(canvas)
canvas.width = window.innerWidth
canvas.height = window.innerHeight

const context = canvas.getContext("2d")

context.font = "30px Arial"
context.textAlign = 'center'
context.fillStyle = 'white'
context.fillText('Click to spawn bubbles', canvas.width/2, canvas.height/2)

let circles = []

function draw(circle) {
  context.beginPath()
  context.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI)
  context.strokeStyle = `hsl(${circle.hue} 100% 50%)`
  context.stroke()

  const gradient = context.createRadialGradient(
    circle.x,
    circle.y,
    1,
    circle.x + 0.5,
    circle.y + 0.5,
    circle.radius
  )

  gradient.addColorStop(0.3, "rgba(255, 255, 255, 0.3)")
  gradient.addColorStop(0.95, "#e7feff")

  context.fillStyle = gradient
  context.fill()
}

function move(circle, timeDelta) {
  circle.x = circle.x + timeDelta*circle.dx
  circle.y = circle.y - timeDelta*circle.dy
}

let intervalId

function startAnimation() {
  if(intervalId == null) {
    intervalId = setInterval(animate, 20)
  }
}

function stopAnimation() {
  if(intervalId != null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

let prevFrameTime

const animate = () => {
  const now = Date.now()
  const timeDelta = prevFrameTime == null ? 0 : now - prevFrameTime
  prevFrameTime = now

  if(circles.length == 0) {
    return
  }

	context.clearRect(0, 0, canvas.width, canvas.height)

	circles.forEach(circle => {
		move(circle, timeDelta)
		draw(circle)
	})
}

const createCircles = (event) => {
  startAnimation()

	circles = circles.concat(Array.from({length: 50}, () => (
     {
      x: event.pageX,
      y: event.pageY,
      radius: Math.random() * 50,
      dx: Math.random() * 0.3,
      dy: Math.random() * 0.7,
      hue: 200,
    }
  )))
}

canvas.addEventListener("click", createCircles)

window.onfocus = startAnimation
window.onblur = stopAnimation
