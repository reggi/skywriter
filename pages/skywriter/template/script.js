// Client-side JavaScript

// Configuration
const SKY_PIXEL_SIZE = 12 // Size of each sky pixel block
const CLOUD_PIXEL_SIZE = 10 // Size of each cloud pixel block
const CLOUD_SPEED_MIN = 0.1 // Minimum cloud speed
const CLOUD_SPEED_MAX = 0.6 // Maximum cloud speed
const SPEED_CHANGE_RATE = 0.002 // How quickly speed changes
const NUM_CLOUDS = 12 // Number of clouds in the sky

// Cloud color palette - brighter whites with subtle cool tint
const cloudColors = [
  {r: 252, g: 252, b: 255}, // Pure soft white
  {r: 248, g: 250, b: 255}, // Very light cool white
  {r: 244, g: 248, b: 255}, // Light blue-white
  {r: 238, g: 244, b: 255}, // Bright blue-white
  {r: 246, g: 246, b: 252}, // Neutral near-white
  {r: 240, g: 244, b: 252}, // Subtle cool white
  {r: 255, g: 255, b: 255}, // White
  {r: 236, g: 240, b: 250}, // Soft cool white
]

// Function to generate random cloud shape
function generateRandomCloud(canvasWidth, canvasHeight) {
  const width = Math.floor(Math.random() * 8) + 5 // 5-12 blocks wide (more fluffy)
  const height = Math.floor(Math.random() * 5) + 3 // 3-7 blocks tall (more fluffy)
  const pixels = []

  // Generate puffy cloud shape
  for (let y = 0; y < height; y++) {
    const rowStart = y === 0 || y === height - 1 ? Math.floor(Math.random() * 2) + 1 : 0
    const rowEnd = y === 0 || y === height - 1 ? width - Math.floor(Math.random() * 2) - 1 : width

    for (let x = rowStart; x < rowEnd; x++) {
      // Add some randomness to cloud edges (more filled for fluffier look)
      if (x === rowStart || x === rowEnd - 1) {
        if (Math.random() > 0.15) {
          // Changed from 0.3 to 0.15 for fluffier edges
          // Pick random color from palette
          const color = cloudColors[Math.floor(Math.random() * cloudColors.length)]
          // Random transparency between 0.5 and 0.9 for lighter, brighter look
          const alpha = Math.random() * 0.4 + 0.5
          pixels.push([x, y, color, alpha])
        }
      } else {
        // Pick random color from palette
        const color = cloudColors[Math.floor(Math.random() * cloudColors.length)]
        // Random transparency between 0.5 and 0.9 for lighter, brighter look
        const alpha = Math.random() * 0.4 + 0.5
        pixels.push([x, y, color, alpha])
      }
    }
  }

  return {
    x: Math.random() * canvasWidth,
    // Initial Y will be overridden by spawn logic inside DOMContentLoaded
    y: Math.random() * (canvasHeight * 0.5) + 10,
    pixels: pixels,
    speed: Math.random() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN) + CLOUD_SPEED_MIN,
    targetSpeed: Math.random() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN) + CLOUD_SPEED_MIN,
    speedChangeTimer: Math.random() * 300 + 100,
  }
}

const cloudShapes = []

// Pixel font for SKYWRITER (each letter is a 2D array where 1=black, 0.5=edge, 0=transparent)
const letterS = [
  [0.5, 1, 1, 1, 0.5, 0],
  [1, 1, 1, 1, 1, 0.5],
  [1, 1, 0.5, 0, 0, 0],
  [0.5, 1, 1, 1, 0.5, 0],
  [0, 0.5, 1, 1, 1, 1],
  [0, 0, 0, 0.5, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [0.5, 1, 1, 1, 0.5, 0],
]

const letterK = [
  [1, 1, 0, 0.5, 1, 1],
  [1, 1, 0.5, 1, 1, 0.5],
  [1, 1, 1, 1, 0.5, 0],
  [1, 1, 1, 0.5, 0, 0],
  [1, 1, 1, 1, 0.5, 0],
  [1, 1, 0.5, 1, 1, 0.5],
  [1, 1, 0, 0.5, 1, 1],
  [1, 1, 0, 0, 0.5, 1],
]

const letterY = [
  [1, 1, 0, 0, 1, 1],
  [1, 1, 0.5, 0.5, 1, 1],
  [0.5, 1, 1, 1, 1, 0.5],
  [0, 0.5, 1, 1, 0.5, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
]

const letterW = [
  [1, 1, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 1, 1],
  [1, 1, 0, 1, 0, 1, 1],
  [1, 1, 0, 1, 0, 1, 1],
  [1, 1, 0.5, 1, 0.5, 1, 1],
  [1, 1, 1, 0.5, 1, 1, 1],
  [1, 1, 1, 0, 1, 1, 1],
  [0.5, 1, 0.5, 0, 0.5, 1, 0.5],
]

const letterR = [
  [1, 1, 1, 1, 0.5, 0],
  [1, 1, 1, 1, 1, 0.5],
  [1, 1, 0, 0.5, 1, 1],
  [1, 1, 1, 1, 1, 0.5],
  [1, 1, 1, 1, 0.5, 0],
  [1, 1, 0.5, 1, 1, 0.5],
  [1, 1, 0, 0.5, 1, 1],
  [1, 1, 0, 0, 0.5, 1],
]

const letterI = [
  [1, 1, 1, 1],
  [0.5, 1, 1, 0.5],
  [0, 1, 1, 0],
  [0, 1, 1, 0],
  [0, 1, 1, 0],
  [0, 1, 1, 0],
  [0.5, 1, 1, 0.5],
  [1, 1, 1, 1],
]

const letterT = [
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [0, 0.5, 1, 1, 0.5, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
]

const letterE = [
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 0, 0],
  [1, 1, 1, 1, 0.5, 0],
  [1, 1, 1, 1, 0.5, 0],
  [1, 1, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
]

const logoWord = [letterS, letterK, letterY, letterW, letterR, letterI, letterT, letterE, letterR]

// Sky blue color palette
const skyColors = [
  'rgb(94, 179, 246)', // Base sky blue
  'rgb(106, 189, 250)', // Lighter
  'rgb(82, 169, 242)', // Darker
  'rgb(118, 199, 252)', // Very light
  'rgb(70, 159, 238)', // Deep blue
  'rgb(135, 206, 235)', // Sky blue
  'rgb(100, 185, 248)', // Medium
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

  // Rainbow palette for logo letters when body has class "rainbow"
  const rainbowColors = [
    '#e3342f', // red
    '#f6993f', // orange
    '#ffed4a', // yellow
    '#38c172', // green
    '#4dc0b5', // teal
    '#3490dc', // blue
    '#6574cd', // indigo
    '#9561e2', // violet
    '#f66d9b', // pink
  ]

  function hexToRgb(hex) {
    const h = hex.replace('#', '')
    const r = parseInt(h.substring(0, 2), 16)
    const g = parseInt(h.substring(2, 4), 16)
    const b = parseInt(h.substring(4, 6), 16)
    return {r, g, b}
  }
  // Vertical overscan so clouds can appear partially from top/bottom
  const CLOUD_MAX_BLOCKS_TALL = 7 // matches generator (3–7)
  const OVERSCAN_TOP_PX = CLOUD_PIXEL_SIZE * CLOUD_MAX_BLOCKS_TALL // 70px
  const OVERSCAN_BOTTOM_PX = 0 // no bottom overscan
  const MAX_Y_FRACTION = 1.2 // cap lowest spawn to ~62% down

  function cloudYBounds() {
    // Allow spawning above the top, but cap how low they can appear
    const min = -OVERSCAN_TOP_PX
    const max = Math.max(min + 1, Math.floor(cloudCanvas.height * MAX_Y_FRACTION) + OVERSCAN_BOTTOM_PX)
    return {min, max}
  }

  function randomCloudY() {
    // Uniform sampling across the allowed band to avoid center clustering
    const {min, max} = cloudYBounds()
    const t = Math.random()
    return min + t * (max - min)
  }

  // Initialize clouds
  cloudShapes.length = 0 // Clear any existing clouds
  for (let i = 0; i < NUM_CLOUDS; i++) {
    const c = generateRandomCloud(window.innerWidth, cloudCanvas.offsetHeight || 400)
    c.y = randomCloudY()
    cloudShapes.push(c)
  }

  function resizeCanvas() {
    const skyContainer = document.querySelector('.sky-container')
    const width = skyContainer.clientWidth // exclude scrollbar for perfect fit

    // Calculate the viewport-based height
    const targetHeight = window.innerHeight * 0.4 // 40vh

    // Round down to nearest multiple of SKY_PIXEL_SIZE
    const pixelRows = Math.floor(targetHeight / SKY_PIXEL_SIZE)
    const snappedHeight = pixelRows * SKY_PIXEL_SIZE

    // Set the actual sky container height to the snapped value
    skyContainer.style.height = snappedHeight + 'px'

    canvas.width = width
    canvas.height = snappedHeight

    // Match cloud canvas to sky canvas size
    cloudCanvas.width = width
    cloudCanvas.height = snappedHeight
    generateSkyGrid()

    // Setup fade canvas (match CSS height to avoid stretching)
    fadeCanvas.width = width
    // Use actual rendered height of the canvas element; fallback to 240
    fadeCanvas.height = fadeCanvas.offsetHeight || 240
    generateFadeGrid()
    drawFadeTransition()

    // Reposition clouds after resize: clamp within allowed band without pushing upward unnecessarily
    const {min, max} = cloudYBounds()
    for (const cloud of cloudShapes) {
      cloud.y = Math.max(min, Math.min(cloud.y, max))
    }
  }

  // Generate static random sky grid
  function generateSkyGrid() {
    const pixelWidth = Math.ceil(canvas.width / SKY_PIXEL_SIZE)
    const pixelHeight = Math.ceil(canvas.height / SKY_PIXEL_SIZE)
    skyGrid = []

    for (let y = 0; y < pixelHeight; y++) {
      skyGrid[y] = []
      for (let x = 0; x < pixelWidth; x++) {
        // Seed-based randomization for consistency
        const seed = x * 1000 + y
        const random = Math.abs(Math.sin(seed) * 10000) % skyColors.length
        skyGrid[y][x] = skyColors[Math.floor(random)]
      }
    }
  }

  // Generate pixel-based fade gradient with randomization
  function generateFadeGrid() {
    // Use ceil to ensure we cover partial columns/rows at edges
    const pixelWidth = Math.ceil(fadeCanvas.width / SKY_PIXEL_SIZE)
    const pixelHeight = Math.ceil(fadeCanvas.height / SKY_PIXEL_SIZE)
    const skyPixelHeight = Math.floor(canvas.height / SKY_PIXEL_SIZE)
    fadeGrid = []

    // Keep a couple of rows fully opaque to avoid any seam
    const solidRows = Math.min(2, pixelHeight > 0 ? 2 : 0)

    for (let y = 0; y < pixelHeight; y++) {
      fadeGrid[y] = []
      for (let x = 0; x < pixelWidth; x++) {
        // Continue the seed pattern from where the sky left off
        const seed = x * 1000 + (skyPixelHeight + y)
        const random = Math.abs(Math.sin(seed) * 10000) % skyColors.length
        const color = skyColors[Math.floor(random)]

        // Calculate alpha (opacity) fade from top to bottom
        // Keep first solidRows fully opaque to hide the seam with the sky
        let alpha = 1
        if (y >= solidRows) {
          const t = (y - solidRows) / Math.max(1, pixelHeight - solidRows)
          // Smooth step easing (ease-in/out) for more gradual fade
          const eased = t * t * (3 - 2 * t)
          // Subtle randomness for organic look (smaller amplitude for smoother result)
          const alphaSeed = x * 12345 + y * 67890
          const randomOffset = ((Math.abs(Math.sin(alphaSeed) * 10000) % 100) / 100) * 0.12 - 0.06
          const progress = Math.max(0, Math.min(1, eased + randomOffset))
          alpha = 1 - progress
        }

        fadeGrid[y][x] = {color, alpha}
      }
    }
  }

  // Draw the fade transition
  function drawFadeTransition() {
    // Fill with white background first
    fadeCtx.fillStyle = 'white'
    fadeCtx.fillRect(0, 0, fadeCanvas.width, fadeCanvas.height)

    // Draw pixels with alpha
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
    fadeCtx.globalAlpha = 1 // Reset
  }

  function drawPixelatedSky() {
    const pixelHeight = skyGrid.length
    for (let y = 0; y < pixelHeight; y++) {
      const pixelWidth = skyGrid[y].length
      for (let x = 0; x < pixelWidth; x++) {
        ctx.fillStyle = skyGrid[y][x]
        ctx.fillRect(x * SKY_PIXEL_SIZE, y * SKY_PIXEL_SIZE, SKY_PIXEL_SIZE, SKY_PIXEL_SIZE)
      }
    }
  }

  function drawLogo() {
    const LOGO_PIXEL_SIZE = 8
    const LETTER_SPACING = 2
    const useRainbow = document.body.classList.contains('rainbow')

    // Calculate total width
    let totalWidth = 0
    logoWord.forEach((letter, i) => {
      totalWidth += letter[0].length * LOGO_PIXEL_SIZE
      if (i < logoWord.length - 1) {
        totalWidth += LETTER_SPACING * LOGO_PIXEL_SIZE
      }
    })

    const totalHeight = 8 * LOGO_PIXEL_SIZE

    logoCanvas.width = totalWidth
    logoCanvas.height = totalHeight

    let xOffset = 0

    logoWord.forEach((letter, letterIndex) => {
      // Determine letter color
      let baseColor = {r: 0, g: 0, b: 0}
      if (useRainbow && rainbowColors[letterIndex]) {
        baseColor = hexToRgb(rainbowColors[letterIndex])
      }

      for (let y = 0; y < letter.length; y++) {
        for (let x = 0; x < letter[y].length; x++) {
          const value = letter[y][x]
          if (value > 0) {
            const alpha = value === 1 ? 1 : value
            logoCtx.fillStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`
            logoCtx.fillRect(xOffset + x * LOGO_PIXEL_SIZE, y * LOGO_PIXEL_SIZE, LOGO_PIXEL_SIZE, LOGO_PIXEL_SIZE)

            // Add white outline for dimension
            if (value === 1) {
              logoCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'
              logoCtx.fillRect(xOffset + x * LOGO_PIXEL_SIZE + 1, y * LOGO_PIXEL_SIZE + 1, 1, 1)
              logoCtx.fillRect(
                xOffset + x * LOGO_PIXEL_SIZE + LOGO_PIXEL_SIZE - 2,
                y * LOGO_PIXEL_SIZE + LOGO_PIXEL_SIZE - 2,
                1,
                1,
              )
            }
          }
        }
      }
      xOffset += (letter[0].length + LETTER_SPACING) * LOGO_PIXEL_SIZE
    })
  }

  function drawCloud(cloud) {
    // Update cloud speed gradually
    cloud.speedChangeTimer--
    if (cloud.speedChangeTimer <= 0) {
      cloud.targetSpeed = Math.random() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN) + CLOUD_SPEED_MIN
      cloud.speedChangeTimer = Math.random() * 300 + 100
    }

    // Smoothly interpolate to target speed
    if (Math.abs(cloud.speed - cloud.targetSpeed) > 0.001) {
      cloud.speed += (cloud.targetSpeed - cloud.speed) * SPEED_CHANGE_RATE
    }

    // Move cloud
    cloud.x -= cloud.speed

    // Reset cloud when it goes off screen
    if (cloud.x < -CLOUD_PIXEL_SIZE * 10) {
      cloud.x = cloudCanvas.width + CLOUD_PIXEL_SIZE * 10
      cloud.y = randomCloudY()
      // Generate new shape
      const newCloud = generateRandomCloud(cloudCanvas.width, cloudCanvas.height)
      cloud.pixels = newCloud.pixels
    }

    // Draw cloud pixels with individual colors and transparency
    cloud.pixels.forEach(([px, py, color, alpha]) => {
      const x = Math.floor(cloud.x + px * CLOUD_PIXEL_SIZE)
      const y = Math.floor(cloud.y + py * CLOUD_PIXEL_SIZE)
      cloudCtx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
      cloudCtx.fillRect(x, y, CLOUD_PIXEL_SIZE, CLOUD_PIXEL_SIZE)
    })
  }

  function animate() {
    // Clear the canvas to prevent streaking
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    cloudCtx.clearRect(0, 0, cloudCanvas.width, cloudCanvas.height)

    drawPixelatedSky()

    cloudShapes.forEach(cloud => {
      drawCloud(cloud)
    })

    requestAnimationFrame(animate)
  }

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  drawLogo()
  document.querySelector('.sky-container').style.visibility = 'visible'
  animate()

  // Observe body class changes to re-render logo when toggling rainbow mode
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        drawLogo()
        break
      }
    }
  })
  observer.observe(document.body, {attributes: true})

  // Mobile TOC toggle functionality
  const toc = document.querySelector('.toc')
  const tocHeading = toc?.querySelector('h2')

  if (toc && tocHeading) {
    // Start collapsed on mobile
    const checkMobile = () => window.innerWidth <= 900

    if (checkMobile()) {
      toc.classList.add('collapsed')
    }

    tocHeading.addEventListener('click', () => {
      if (checkMobile()) {
        toc.classList.toggle('collapsed')
      }
    })

    // Close TOC when clicking a link on mobile
    toc.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        if (checkMobile()) {
          toc.classList.add('collapsed')
        }
      })
    })

    // Handle resize - remove collapsed class when going to desktop
    window.addEventListener('resize', () => {
      if (!checkMobile()) {
        toc.classList.remove('collapsed')
      }
    })
  }
})
