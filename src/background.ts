// src/background.ts
// Handles CAPTURE requests from content script and returns a screenshot dataURL of the visible tab.
// We keep it lean (no offscreen) for the starter.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("📨 Background received message:", msg, "from sender:", sender)
  
  if (msg?.type === "CAPTURE") {
    console.log("📸 Starting capture for tab:", sender.tab?.id, "window:", sender.tab?.windowId)
    
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
})
