// src/background.ts
// Handles CAPTURE requests from content script and returns a screenshot dataURL of the visible tab.
// We keep it lean (no offscreen) for the starter.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("📨 Background received message:", msg, "from sender:", sender)
  
  if (msg?.type === "CAPTURE") {
    console.log("📸 Starting viewport capture for tab:", sender.tab?.id, "window:", sender.tab?.windowId)
    
    // Use async/await pattern instead of callbacks
    const handleCapture = async () => {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else {
              resolve(dataUrl)
            }
          })
        })
        
        console.log("📸 Capture completed, dataUrl length:", dataUrl?.length)
        
        // Get tab info
        const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
          chrome.tabs.get(sender.tab.id, (tab) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else {
              resolve(tab)
            }
          })
        })
        
        console.log("📊 Tab info:", { width: tab.width, height: tab.height })
        
        const response = { ok: true, dataUrl }
        console.log("✅ Sending response to content script")
        sendResponse(response)
        
      } catch (error) {
        console.error("❌ Capture error:", error)
        sendResponse({ ok: false, error: error.message })
      }
    }
    
    handleCapture()
    return true // async
  }
  
  if (msg?.type === "CAPTURE_FULL_PAGE") {
    console.log("📸 Starting full page capture for tab:", sender.tab?.id)
    
    const handleFullPageCapture = async () => {
      try {
        // Inject script to capture full page
        const results = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          func: captureFullPage
        })
        
        if (results && results[0] && results[0].result) {
          const result = results[0].result as { dataUrl: string; pageDimensions: { width: number; height: number } }
          const { dataUrl, pageDimensions } = result
          console.log("📸 Full page capture completed, dataUrl length:", dataUrl?.length)
          console.log("📊 Page dimensions:", pageDimensions)
          
          const response = { ok: true, dataUrl, pageDimensions }
          sendResponse(response)
        } else {
          throw new Error("Failed to capture full page")
        }
        
      } catch (error) {
        console.error("❌ Full page capture error:", error)
        sendResponse({ ok: false, error: error.message })
      }
    }
    
    handleFullPageCapture()
    return true // async
  }
})

// Function to be injected into the page for full page capture
function captureFullPage() {
  return new Promise((resolve) => {
    // Get page dimensions
    const pageWidth = Math.max(
      document.body.scrollWidth,
      document.body.offsetWidth,
      document.documentElement.clientWidth,
      document.documentElement.scrollWidth,
      document.documentElement.offsetWidth
    )
    
    const pageHeight = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    )
    
    // Create canvas for full page
    const canvas = document.createElement('canvas')
    canvas.width = pageWidth
    canvas.height = pageHeight
    const ctx = canvas.getContext('2d')
    
    // Fill with white background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pageWidth, pageHeight)
    
    // Improved element capture with proper text handling
    const captureElement = (element: Node, offsetX: number = 0, offsetY: number = 0) => {
      if (element.nodeType === Node.TEXT_NODE) {
        // Handle text nodes
        const textContent = element.textContent?.trim()
        if (textContent) {
          const parent = element.parentElement
          if (parent) {
            const rect = parent.getBoundingClientRect()
            const style = window.getComputedStyle(parent)
            
            // Set font properties
            ctx.fillStyle = style.color || '#000000'
            ctx.font = `${style.fontWeight || 'normal'} ${style.fontSize || '16px'} ${style.fontFamily || 'Arial'}`
            ctx.textAlign = 'left'
            ctx.textBaseline = 'top'
            
            // Draw text at correct position
            const textX = offsetX + rect.left
            const textY = offsetY + rect.top + parseInt(style.fontSize) || 16
            
            // Handle text wrapping for long text
            const maxWidth = rect.width
            const words = textContent.split(' ')
            let line = ''
            let y = textY
            
            for (let n = 0; n < words.length; n++) {
              const testLine = line + words[n] + ' '
              const metrics = ctx.measureText(testLine)
              const testWidth = metrics.width
              
              if (testWidth > maxWidth && n > 0) {
                ctx.fillText(line, textX, y)
                line = words[n] + ' '
                y += parseInt(style.lineHeight) || parseInt(style.fontSize) || 16
              } else {
                line = testLine
              }
            }
            ctx.fillText(line, textX, y)
          }
        }
        return
      }
      
      if (element.nodeType === Node.ELEMENT_NODE) {
        const el = element as HTMLElement
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        
        // Skip hidden elements
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
          return
        }
        
        // Draw background
        if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
          ctx.fillStyle = style.backgroundColor
          ctx.fillRect(offsetX + rect.left, offsetY + rect.top, rect.width, rect.height)
        }
        
        // Draw border
        if (style.borderWidth && style.borderWidth !== '0px') {
          ctx.strokeStyle = style.borderColor || '#000000'
          ctx.lineWidth = parseInt(style.borderWidth) || 1
          ctx.strokeRect(offsetX + rect.left, offsetY + rect.top, rect.width, rect.height)
        }
        
        // Process all child nodes (including text nodes)
        for (let i = 0; i < el.childNodes.length; i++) {
          captureElement(el.childNodes[i], offsetX, offsetY)
        }
      }
    }
    
    // Capture the entire document starting from body
    captureElement(document.body)
    
    // Convert to data URL
    const dataUrl = canvas.toDataURL('image/png')
    
    resolve({
      dataUrl,
      pageDimensions: { width: pageWidth, height: pageHeight }
    })
  })
}
