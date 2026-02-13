// Client-side JavaScript

const SKY_PIXEL_SIZE = 12
const CLOUD_PIXEL_SIZE = 10
const CLOUD_SPEED_MIN = 0.1
const CLOUD_SPEED_MAX = 0.6
const SPEED_CHANGE_RATE = 0.002
const NUM_CLOUDS = 12

const cloudColors = [
  {r: 252, g: 252, b: 255},
  {r: 248, g: 250, b: 255},
  {r: 244, g: 248, b: 255},
  {r: 238, g: 244, b: 255},
  {r: 246, g: 246, b: 252},
  {r: 240, g: 244, b: 252},
  {r: 255, g: 255, b: 255},
  {r: 236, g: 240, b: 250},
]

function generateRandomCloud(canvasWidth, canvasHeight) {
  const width = Math.floor(Math.random() * 8) + 5
  const height = Math.floor(Math.random() * 5) + 3
  const pixels = []
  for (let y = 0; y < height; y++) {
    const rowStart = y === 0 || y === height - 1 ? Math.floor(Math.random() * 2) + 1 : 0
    const rowEnd = y === 0 || y === height - 1 ? width - Math.floor(Math.random() * 2) - 1 : width
    for (let x = rowStart; x < rowEnd; x++) {
      if (x === rowStart || x === rowEnd - 1) {
        if (Math.random() > 0.15) {
          const color = cloudColors[Math.floor(Math.random() * cloudColors.length)]
          const alpha = Math.random() * 0.4 + 0.5
          pixels.push([x, y, color, alpha])
        }
      } else {
        const color = cloudColors[Math.floor(Math.random() * cloudColors.length)]
        const alpha = Math.random() * 0.4 + 0.5
        pixels.push([x, y, color, alpha])
      }
    }
  }
  return {
    x: Math.random() * canvasWidth,
    y: Math.random() * (canvasHeight * 0.5) + 10,
    pixels,
    speed: Math.random() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN) + CLOUD_SPEED_MIN,
    targetSpeed: Math.random() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN) + CLOUD_SPEED_MIN,
    speedChangeTimer: Math.random() * 300 + 100,
  }
}

const cloudShapes = []

const letterS = [
  [0.5,1,1,1,0.5,0],[1,1,1,1,1,0.5],[1,1,0.5,0,0,0],[0.5,1,1,1,0.5,0],
  [0,0.5,1,1,1,1],[0,0,0,0.5,1,1],[1,1,1,1,1,1],[0.5,1,1,1,0.5,0],
]
const letterK = [
  [1,1,0,0.5,1,1],[1,1,0.5,1,1,0.5],[1,1,1,1,0.5,0],[1,1,1,0.5,0,0],
  [1,1,1,1,0.5,0],[1,1,0.5,1,1,0.5],[1,1,0,0.5,1,1],[1,1,0,0,0.5,1],
]
const letterY = [
  [1,1,0,0,1,1],[1,1,0.5,0.5,1,1],[0.5,1,1,1,1,0.5],[0,0.5,1,1,0.5,0],
  [0,0,1,1,0,0],[0,0,1,1,0,0],[0,0,1,1,0,0],[0,0,1,1,0,0],
]
const letterW = [
  [1,1,0,0,0,1,1],[1,1,0,0,0,1,1],[1,1,0,1,0,1,1],[1,1,0,1,0,1,1],
  [1,1,0.5,1,0.5,1,1],[1,1,1,0.5,1,1,1],[1,1,1,0,1,1,1],[0.5,1,0.5,0,0.5,1,0.5],
]
const letterR = [
  [1,1,1,1,0.5,0],[1,1,1,1,1,0.5],[1,1,0,0.5,1,1],[1,1,1,1,1,0.5],
  [1,1,1,1,0.5,0],[1,1,0.5,1,1,0.5],[1,1,0,0.5,1,1],[1,1,0,0,0.5,1],
]
const letterI = [
  [1,1,1,1],[0.5,1,1,0.5],[0,1,1,0],[0,1,1,0],
  [0,1,1,0],[0,1,1,0],[0.5,1,1,0.5],[1,1,1,1],
]
const letterT = [
  [1,1,1,1,1,1],[1,1,1,1,1,1],[0,0.5,1,1,0.5,0],[0,0,1,1,0,0],
  [0,0,1,1,0,0],[0,0,1,1,0,0],[0,0,1,1,0,0],[0,0,1,1,0,0],
]
const letterE = [
  [1,1,1,1,1,1],[1,1,1,1,1,1],[1,1,0,0,0,0],[1,1,1,1,0.5,0],
  [1,1,1,1,0.5,0],[1,1,0,0,0,0],[1,1,1,1,1,1],[1,1,1,1,1,1],
]

const logoWord = [letterS, letterK, letterY, letterW, letterR, letterI, letterT, letterE, letterR]

const skyColors = [
  'rgb(94, 179, 246)','rgb(106, 189, 250)','rgb(82, 169, 242)',
  'rgb(118, 199, 252)','rgb(70, 159, 238)','rgb(135, 206, 235)','rgb(100, 185, 248)',
]

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('skyCanvas')
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const cloudCanvas = document.getElementById('cloudCanvas')
  const cloudCtx = cloudCanvas.getContext('2d')
  cloudCtx.imageSmoothingEnabled = false
  const logoCanvas = document.getElementById('logoCanvas')
  const logoCtx = logoCanvas.getContext('2d')
  logoCtx.imageSmoothingEnabled = false
  const fadeCanvas = document.getElementById('fadeCanvas')
  const fadeCtx = fadeCanvas.getContext('2d')
  fadeCtx.imageSmoothingEnabled = false

  let skyGrid = []
  let fadeGrid = []

  const CLOUD_MAX_BLOCKS_TALL = 7
  const OVERSCAN_TOP_PX = CLOUD_PIXEL_SIZE * CLOUD_MAX_BLOCKS_TALL
  const MAX_Y_FRACTION = 1.2

  function cloudYBounds() {
    const min = -OVERSCAN_TOP_PX
    const max = Math.max(min + 1, Math.floor(cloudCanvas.height * MAX_Y_FRACTION))
    return {min, max}
  }

  function randomCloudY() {
    const {min, max} = cloudYBounds()
    return min + Math.random() * (max - min)
  }

  cloudShapes.length = 0
  for (let i = 0; i < NUM_CLOUDS; i++) {
    const c = generateRandomCloud(window.innerWidth, cloudCanvas.offsetHeight || 400)
    c.y = randomCloudY()
    cloudShapes.push(c)
  }

  function resizeCanvas() {
    const skyContainer = document.querySelector('.sky-container')
    const width = skyContainer.clientWidth
    const targetHeight = window.innerHeight * 0.4
    const pixelRows = Math.floor(targetHeight / SKY_PIXEL_SIZE)
    const snappedHeight = pixelRows * SKY_PIXEL_SIZE
    skyContainer.style.height = snappedHeight + 'px'
    canvas.width = width
    canvas.height = snappedHeight
    cloudCanvas.width = width
    cloudCanvas.height = snappedHeight
    generateSkyGrid()
    fadeCanvas.width = width
    fadeCanvas.height = fadeCanvas.offsetHeight || 240
    generateFadeGrid()
    drawFadeTransition()
    const {min, max} = cloudYBounds()
    for (const cloud of cloudShapes) {
      cloud.y = Math.max(min, Math.min(cloud.y, max))
    }
  }

  function generateSkyGrid() {
    const pw = Math.ceil(canvas.width / SKY_PIXEL_SIZE)
    const ph = Math.ceil(canvas.height / SKY_PIXEL_SIZE)
    skyGrid = []
    for (let y = 0; y < ph; y++) {
      skyGrid[y] = []
      for (let x = 0; x < pw; x++) {
        const seed = x * 1000 + y
        const random = Math.abs(Math.sin(seed) * 10000) % skyColors.length
        skyGrid[y][x] = skyColors[Math.floor(random)]
      }
    }
  }

  function generateFadeGrid() {
    const pw = Math.ceil(fadeCanvas.width / SKY_PIXEL_SIZE)
    const ph = Math.ceil(fadeCanvas.height / SKY_PIXEL_SIZE)
    const skyPh = Math.floor(canvas.height / SKY_PIXEL_SIZE)
    fadeGrid = []
    const solidRows = Math.min(2, ph > 0 ? 2 : 0)
    for (let y = 0; y < ph; y++) {
      fadeGrid[y] = []
      for (let x = 0; x < pw; x++) {
        const seed = x * 1000 + (skyPh + y)
        const random = Math.abs(Math.sin(seed) * 10000) % skyColors.length
        const color = skyColors[Math.floor(random)]
        let alpha = 1
        if (y >= solidRows) {
          const t = (y - solidRows) / Math.max(1, ph - solidRows)
          const eased = t * t * (3 - 2 * t)
          const alphaSeed = x * 12345 + y * 67890
          const randomOffset = ((Math.abs(Math.sin(alphaSeed) * 10000) % 100) / 100) * 0.12 - 0.06
          alpha = 1 - Math.max(0, Math.min(1, eased + randomOffset))
        }
        fadeGrid[y][x] = {color, alpha}
      }
    }
  }

  function drawFadeTransition() {
    fadeCtx.fillStyle = 'white'
    fadeCtx.fillRect(0, 0, fadeCanvas.width, fadeCanvas.height)
    for (let y = 0; y < fadeGrid.length; y++) {
      for (let x = 0; x < fadeGrid[y].length; x++) {
        const pixel = fadeGrid[y][x]
        if (pixel.alpha > 0) {
          fadeCtx.globalAlpha = pixel.alpha
          fadeCtx.fillStyle = pixel.color
          fadeCtx.fillRect(x * SKY_PIXEL_SIZE, y * SKY_PIXEL_SIZE, SKY_PIXEL_SIZE, SKY_PIXEL_SIZE)
        }
      }
    }
    fadeCtx.globalAlpha = 1
  }

  function drawPixelatedSky() {
    for (let y = 0; y < skyGrid.length; y++) {
      for (let x = 0; x < skyGrid[y].length; x++) {
        ctx.fillStyle = skyGrid[y][x]
        ctx.fillRect(x * SKY_PIXEL_SIZE, y * SKY_PIXEL_SIZE, SKY_PIXEL_SIZE, SKY_PIXEL_SIZE)
      }
    }
  }

  function drawLogo() {
    const LOGO_PIXEL_SIZE = 8
    const LETTER_SPACING = 2
    let totalWidth = 0
    logoWord.forEach((letter, i) => {
      totalWidth += letter[0].length * LOGO_PIXEL_SIZE
      if (i < logoWord.length - 1) totalWidth += LETTER_SPACING * LOGO_PIXEL_SIZE
    })
    const totalHeight = 8 * LOGO_PIXEL_SIZE
    logoCanvas.width = totalWidth
    logoCanvas.height = totalHeight
    let xOffset = 0
    logoWord.forEach(letter => {
      for (let y = 0; y < letter.length; y++) {
        for (let x = 0; x < letter[y].length; x++) {
          const value = letter[y][x]
          if (value > 0) {
            const alpha = value === 1 ? 1 : value
            logoCtx.fillStyle = `rgba(0, 0, 0, ${alpha})`
            logoCtx.fillRect(xOffset + x * LOGO_PIXEL_SIZE, y * LOGO_PIXEL_SIZE, LOGO_PIXEL_SIZE, LOGO_PIXEL_SIZE)
            if (value === 1) {
              logoCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'
              logoCtx.fillRect(xOffset + x * LOGO_PIXEL_SIZE + 1, y * LOGO_PIXEL_SIZE + 1, 1, 1)
              logoCtx.fillRect(xOffset + x * LOGO_PIXEL_SIZE + LOGO_PIXEL_SIZE - 2, y * LOGO_PIXEL_SIZE + LOGO_PIXEL_SIZE - 2, 1, 1)
            }
          }
        }
      }
      xOffset += (letter[0].length + LETTER_SPACING) * LOGO_PIXEL_SIZE
    })
  }

  function drawCloud(cloud) {
    cloud.speedChangeTimer--
    if (cloud.speedChangeTimer <= 0) {
      cloud.targetSpeed = Math.random() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN) + CLOUD_SPEED_MIN
      cloud.speedChangeTimer = Math.random() * 300 + 100
    }
    if (Math.abs(cloud.speed - cloud.targetSpeed) > 0.001) {
      cloud.speed += (cloud.targetSpeed - cloud.speed) * SPEED_CHANGE_RATE
    }
    cloud.x -= cloud.speed
    if (cloud.x < -CLOUD_PIXEL_SIZE * 10) {
      cloud.x = cloudCanvas.width + CLOUD_PIXEL_SIZE * 10
      cloud.y = randomCloudY()
      const newCloud = generateRandomCloud(cloudCanvas.width, cloudCanvas.height)
      cloud.pixels = newCloud.pixels
    }
    cloud.pixels.forEach(([px, py, color, alpha]) => {
      const x = Math.floor(cloud.x + px * CLOUD_PIXEL_SIZE)
      const y = Math.floor(cloud.y + py * CLOUD_PIXEL_SIZE)
      cloudCtx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
      cloudCtx.fillRect(x, y, CLOUD_PIXEL_SIZE, CLOUD_PIXEL_SIZE)
    })
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    cloudCtx.clearRect(0, 0, cloudCanvas.width, cloudCanvas.height)
    drawPixelatedSky()
    cloudShapes.forEach(cloud => drawCloud(cloud))
    requestAnimationFrame(animate)
  }

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  drawLogo()
  animate()

  document.querySelectorAll('.host-domain').forEach(el => {
    el.textContent = window.location.origin
  })
  document.querySelectorAll('.current-path').forEach(el => {
    el.textContent = window.location.pathname
  })
  const editPath = window.location.pathname.replace(/\/$/, '') + '/edit'
  document.querySelectorAll('.edit-path').forEach(el => {
    el.textContent = editPath
  })
  document.querySelectorAll('.edit-link').forEach(el => {
    el.href = editPath
  })
})

