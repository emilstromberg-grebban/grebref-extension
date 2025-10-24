// src/contents/overlay.tsx
// Plasmo content script: draws a simple lasso (rect) overlay for IMAGE mode,
// adds DOM mode (hover to highlight element, click to select subtree),
// captures screenshot via background, crops client-side, shows preview,
// and POST:ar till backend (konfig via PLASMO_PUBLIC_BACKEND_URL).

import React, { useEffect, useRef, useState } from "react"
import type { PlasmoCSConfig } from "plasmo"
import "./style.css"
import cssText from "data-text:~style.css"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
}

const BACKEND_URL = "https://do9fz3dkd8sl6.cloudfront.net/api/clips"
const FRONTEND_URL = "https://grebref-frontend-one.vercel.app/"


/**
 * Generates a style element with adjusted CSS to work correctly within a Shadow DOM.
 *
 * Tailwind CSS relies on `rem` units, which are based on the root font size (typically defined on the <html>
 * or <body> element). However, in a Shadow DOM (as used by Plasmo), there is no native root element, so the
 * rem values would reference the actual page's root font size—often leading to sizing inconsistencies.
 *
 * To address this, we:
 * 1. Replace the `:root` selector with `:host(plasmo-csui)` to properly scope the styles within the Shadow DOM.
 * 2. Convert all `rem` units to pixel values using a fixed base font size, ensuring consistent styling
 *    regardless of the host page's font size.
 */
export const getStyle = (): HTMLStyleElement => {
  const baseFontSize = 16

  let updatedCssText = cssText.replaceAll(":root", ":host(plasmo-csui)")
  const remRegex = /([\d.]+)rem/g
  updatedCssText = updatedCssText.replace(remRegex, (match, remValue) => {
    const pixelsValue = parseFloat(remValue) * baseFontSize

    return `${pixelsValue}px`
  })

  const styleElement = document.createElement("style")

  styleElement.textContent = updatedCssText

  return styleElement
}

type Mode = "image" | "dom" | "fullpage"

const Overlay = () => {
  const [mode, setMode] = useState<Mode | null>(null)
  const [rect, setRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null)
  const [drag, setDrag] = useState<{ startX: number, startY: number } | null>(null)
  const [preview, setPreview] = useState<string | null>(null) // image dataURL
  const [domPreview, setDomPreview] = useState<string | null>(null) // serialized HTML string
  const [desc, setDesc] = useState("")
  const [tags, setTags] = useState("")

  // DOM mode highlighting
  const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null)
  const [pickedEl, setPickedEl] = useState<HTMLElement | null>(null)
  const [uploadedUuid, setUploadedUuid] = useState<string | null>(null)
  const [showUploadSuccess, setShowUploadSuccess] = useState(false)
  const [timeLeft, setTimeLeft] = useState(15)
  const [isCapturing, setIsCapturing] = useState(false)
  const uploadSuccessTimeoutRef = useRef<number | null>(null)
  const countdownIntervalRef = useRef<number | null>(null)

  // Auto-hide upload success popup after 15 seconds
  useEffect(() => {
    if (showUploadSuccess) {
      // Reset time left
      setTimeLeft(15)

      // Clear any existing timeout and interval
      if (uploadSuccessTimeoutRef.current) {
        clearTimeout(uploadSuccessTimeoutRef.current)
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
      }

      // Start countdown
      countdownIntervalRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setShowUploadSuccess(false)
            setUploadedUuid(null)
            return 15
          }
          return prev - 1
        })
      }, 1000)

      // Set timeout as backup
      uploadSuccessTimeoutRef.current = window.setTimeout(() => {
        setShowUploadSuccess(false)
        setUploadedUuid(null)
        setTimeLeft(15)
      }, 15000) // 15 seconds
    }

    // Cleanup timeout and interval on unmount or when showUploadSuccess changes
    return () => {
      if (uploadSuccessTimeoutRef.current) {
        clearTimeout(uploadSuccessTimeoutRef.current)
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
      }
    }
  }, [showUploadSuccess])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        resetAll()
        return
      }
      // Ctrl+S => IMAGE mode
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        console.log("Ctrl+S")
        e.preventDefault()
        activateImageMode()
      }
      // Ctrl+D => DOM mode
      if (e.ctrlKey && e.key.toLowerCase() === "d") {
        console.log("Ctrl+D")
        e.preventDefault()
        activateDomMode()
      }
      // Ctrl+F => Full page mode
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        console.log("Ctrl+F")
        e.preventDefault()
        activateFullPageMode()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // IMAGE MODE mouse handlers
  useEffect(() => {
    if (mode !== "image") return
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      setDrag({ startX: e.clientX, startY: e.clientY })
      setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
    }
    const onMove = (e: MouseEvent) => {
      if (!drag) return
      const x = Math.min(drag.startX, e.clientX)
      const y = Math.min(drag.startY, e.clientY)
      const w = Math.abs(e.clientX - drag.startX)
      const h = Math.abs(e.clientY - drag.startY)
      setRect({ x, y, w, h })
    }
    const onUp = async (_e: MouseEvent) => {
      console.log("🖱️ Mouse up event triggered")
      console.log("📏 Drag state:", drag)
      console.log("📐 Rect state:", rect)

      if (!drag || !rect) {
        console.log("❌ Missing drag or rect state, aborting")
        return
      }

      console.log("✅ Starting capture process...")
      setDrag(null)

      // Hide overlays during capture
      setIsCapturing(true)

      // Small delay to ensure overlays are hidden before capture
      await new Promise(resolve => setTimeout(resolve, 100))

      try {
        // Add timeout to prevent hanging
        const res = await chrome.runtime.sendMessage({ type: "CAPTURE" });

        console.log("📸 Capture response:", res)

        if (!res?.ok) {
          console.error("❌ Capture failed:", res?.error)
          alert("Capture failed: " + (res?.error ?? "unknown"))
          return
        }

        const dataUrl: string = res.dataUrl
        console.log("🖼️ Data URL length:", dataUrl.length)

        const img = new Image()
        img.onload = () => {
          console.log("🖼️ Image loaded, dimensions:", img.width, "x", img.height)
          console.log("🖼️ Window dimensions:", window.innerWidth, "x", window.innerHeight)

          const scale = img.width / window.innerWidth
          console.log("📏 Scale factor:", scale)

          const sx = Math.round(rect.x * scale)
          const sy = Math.round(rect.y * scale)
          const sw = Math.round(rect.w * scale)
          const sh = Math.round(rect.h * scale)

          console.log("✂️ Crop coordinates:", { sx, sy, sw, sh })

          const canvas = document.createElement("canvas")
          canvas.width = Math.max(1, sw)
          canvas.height = Math.max(1, sh)
          const ctx = canvas.getContext("2d")!
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
          const cropped = canvas.toDataURL("image/png")

          console.log("✅ Cropped image created, length:", cropped.length)
          setPreview(cropped)
          setMode(null)
          setIsCapturing(false) // Restore overlays
          console.log("🎉 Preview set and mode cleared")
        }
        img.onerror = (error) => {
          console.error("❌ Image load error:", error)
          setIsCapturing(false) // Restore overlays on error
        }
        img.src = dataUrl
      } catch (error) {
        console.error("❌ Error in capture process:", error)
        alert("Error: " + error)
        setIsCapturing(false) // Restore overlays on error
      }
    }
    document.addEventListener("mousedown", onDown, true)
    document.addEventListener("mousemove", onMove, true)
    document.addEventListener("mouseup", onUp, true)
    return () => {
      document.removeEventListener("mousedown", onDown, true)
      document.removeEventListener("mousemove", onMove, true)
      document.removeEventListener("mouseup", onUp, true)
    }
  }, [mode, drag, rect])

  // DOM MODE hover + pick
  useEffect(() => {
    if (mode !== "dom") return
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement
      setHoverEl(el as HTMLElement)
    }
    const onClick = async (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const el = hoverEl || (e.target as HTMLElement)
      if (!el) return
      setPickedEl(el)
      const html = serializeWithStyles(el)
      setDomPreview(html)
      setMode(null)
    }
    document.addEventListener("mousemove", onMove, true)
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("mousemove", onMove, true)
      document.removeEventListener("click", onClick, true)
    }
  }, [mode, hoverEl])

  // FULL PAGE MODE capture
  useEffect(() => {
    if (mode !== "fullpage") return

    const captureFullPage = async () => {
      console.log("📸 Starting full page capture...")
      setIsCapturing(true)

      try {
        const res = await chrome.runtime.sendMessage({ type: "CAPTURE_FULL_PAGE" })

        console.log("📸 Full page capture response:", res)

        if (!res?.ok) {
          console.error("❌ Full page capture failed:", res?.error)
          alert("Full page capture failed: " + (res?.error ?? "unknown"))
          return
        }

        const dataUrl: string = res.dataUrl
        const pageDimensions = res.pageDimensions
        console.log("🖼️ Full page data URL length:", dataUrl.length)
        console.log("📏 Page dimensions:", pageDimensions)

        setPreview(dataUrl)
        setMode(null)
        setIsCapturing(false)
        console.log("🎉 Full page preview set and mode cleared")

      } catch (error) {
        console.error("❌ Error in full page capture process:", error)
        alert("Error: " + error)
        setIsCapturing(false)
      }
    }

    // Auto-capture when entering full page mode
    captureFullPage()
  }, [mode])

  const doUpload = async () => {
    // Enhanced payload with additional context data
    const payload: any = {
      url: location.href,
      title: document.title,
      description: desc,
      // tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      // type: preview ? "image" : "dom"

      // Enhanced context data for better reference library
      context: {
        // Browser and device context
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          userAgent: navigator.userAgent,
          platform: navigator.platform
        },

        // Page context
        page: {
          domain: window.location.hostname,
          path: window.location.pathname,
          searchParams: Object.fromEntries(new URLSearchParams(window.location.search)),
          referrer: document.referrer,
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },

        // Design context
        design: {
          colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
          primaryColor: getComputedStyle(document.documentElement).getPropertyValue('--primary-color') || null,
          fontFamily: getComputedStyle(document.documentElement).fontFamily,
          fontSize: getComputedStyle(document.documentElement).fontSize
        },

        // Technical context
        technical: {
          framework: detectFramework(),
          cssFramework: detectCSSFramework(),
          hasShadowDOM: document.querySelector('*').shadowRoot !== null,
          cssVariables: extractCSSVariables(document.documentElement)
        },

        // Component context (if we have a selected element)
        component: rect ? {
          boundingRect: rect,
          centerX: rect.x + rect.w / 2,
          centerY: rect.y + rect.h / 2,
          aspectRatio: rect.w / rect.h,
          area: rect.w * rect.h
        } : null
      }
    }

    if (preview) payload.base64_file = preview
    if (domPreview) payload.domHtml = domPreview
    try {
      const res = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

      // Extract UUID from response
      const responseData = await res.json()
      const uuid = responseData.uuid
      if (uuid) {
        setUploadedUuid(uuid)
        setShowUploadSuccess(true)
      }

    } catch (err: any) {
      alert("Upload misslyckades: " + err?.message)
    }
  }

  // Render
  if (!mode && !preview && !domPreview && !showUploadSuccess) return (
    <FloatingHint />
  )

  return (
    <>
      {(mode === "image") && !isCapturing && (
        <div className="fixed inset-0 z-overlay cursor-crosshair bg-black/5">
          <div className="fixed top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1.5 text-xs leading-tight font-sans bg-black/70 text-white rounded-md z-hint">IMAGE mode (Ctrl+S). Drag to select area. Esc to cancel.</div>
          {rect && <div className="fixed border-2 border-blue-600 border-dashed pointer-events-none bg-blue-500/15" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
        </div>
      )}
      {(mode === "dom") && (
        <>
          <div className="fixed inset-0 z-[2147483646] bg-black/4 cursor-crosshair" />
          {hoverEl && <OutlineBox el={hoverEl} />}
          <div className="fixed top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1.5 text-xs leading-tight font-sans bg-black/70 text-white rounded-md z-hint">DOM mode (Ctrl+D). Hover and click to select element. Esc to cancel.</div>
        </>
      )}
      {(mode === "fullpage") && (
        <div className="fixed top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1.5 text-xs leading-tight font-sans bg-black/70 text-white rounded-md z-hint">
          Full page capture (Ctrl+F). Capturing entire page... Esc to cancel.
        </div>
      )}
      {(preview || domPreview) && !showUploadSuccess && (
        <div className="fixed right-5 bottom-5 z-overlay flex gap-3 p-3 bg-gray-900 text-gray-200 rounded-xl shadow-2xl max-w-[min(90vw,640px)]">
          {preview && <img src={preview} alt="GrebRef" className="block object-contain bg-black rounded-lg max-w-80 max-h-60" />}
          {domPreview && (
            <div className="flex flex-col gap-1.5 w-80 max-h-65">
              <div className="text-xs font-semibold text-gray-300">DOM snippet</div>
              <textarea className="w-full p-2 font-mono text-xs leading-snug text-gray-300 bg-gray-800 border border-gray-600 rounded-lg resize-y h-55" readOnly value={domPreview} />
            </div>
          )}
          <div className="flex flex-col gap-2 w-70">
            <input className="w-full px-2.5 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-200 text-xs font-sans" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <input className="w-full px-2.5 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-200 text-xs font-sans" placeholder="Tags, comma-separated" value={tags} onChange={(e) => setTags(e.target.value)} />
            <div className="flex flex-col gap-2 mt-auto">
              <button className="px-2.5 py-2 border-0 rounded-lg bg-blue-600 text-white text-xs font-sans cursor-pointer" onClick={doUpload}>Upload</button>
              <div className="flex flex-row gap-2">
                {preview && <button className="px-2.5 whitespace-nowrap flex-1 py-2 border-0 rounded-lg bg-blue-600 text-white text-xs font-sans cursor-pointer" onClick={() => downloadDataUrl(preview!, "snip.png")}>Download</button>}
                <button className="px-2.5 whitespace-nowrap flex-1 py-2 border-0 rounded-lg bg-blue-600 text-white text-xs font-sans cursor-pointer" onClick={resetAll}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showUploadSuccess && uploadedUuid && (
        <div
          className="fixed right-5 bottom-5 z-overlay flex gap-3 p-3 bg-gray-900 text-gray-200 rounded-xl shadow-2xl max-w-[min(90vw,640px)]"
          id="uploaded-container"
        >
          <div className="flex flex-col gap-3 w-80">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <div className="text-sm font-semibold text-green-400">Uploaded!</div>
            </div>
            <div className="text-xs text-gray-300">
              Your reference has been saved and can be viewed in the frontend.
            </div>
            <div className="flex flex-col gap-1">
              <div className="w-full h-1 bg-gray-700 rounded-full">
                <div
                  className="h-1 transition-all duration-1000 ease-linear bg-green-500 rounded-full"
                  style={{ width: `${(timeLeft / 15) * 100}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-400">
                Auto-closes in {timeLeft}s
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <a
                href={`${FRONTEND_URL}/library/${uploadedUuid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 font-sans text-xs text-center text-white transition-colors bg-blue-600 rounded-lg hover:bg-blue-700"
                onClick={() => {
                  // Hide popup when user clicks the link
                  setShowUploadSuccess(false)
                  setUploadedUuid(null)
                  setTimeLeft(15)
                }}
              >
                View in frontend →
              </a>
              <button
                className="px-3 py-2 font-sans text-xs text-gray-300 transition-colors border border-gray-600 rounded-lg hover:bg-gray-800"
                onClick={() => {
                  // Hide popup when user clicks close
                  setShowUploadSuccess(false)
                  setUploadedUuid(null)
                  setTimeLeft(15)
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  function activateImageMode() {
    setMode("image")
    setRect(null)
    setPreview(null)
    setDomPreview(null)
    setDesc("")
    setTags("")
  }
  function activateDomMode() {
    setMode("dom")
    setRect(null)
    setPreview(null)
    setDomPreview(null)
    setDesc("")
    setTags("")
  }

  function activateFullPageMode() {
    setMode("fullpage")
    setRect(null)
    setPreview(null)
    setDomPreview(null)
    setDesc("")
    setTags("")
  }
  function resetAll() {
    setMode(null)
    setRect(null)
    setPreview(null)
    setDomPreview(null)
    setDesc("")
    setTags("")
    setHoverEl(null)
    setPickedEl(null)
    setUploadedUuid(null)
    setShowUploadSuccess(false)
    setIsCapturing(false)

    // Clear any pending timeout and interval
    if (uploadSuccessTimeoutRef.current) {
      clearTimeout(uploadSuccessTimeoutRef.current)
      uploadSuccessTimeoutRef.current = null
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setTimeLeft(15)
  }
}

export default Overlay

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename
  a.click()
}

// Serialize element with inline computed styles (basic). Note: cross-origin images/CSS won't be embedded.
function serializeWithStyles(rootEl: HTMLElement): string {
  const clone = rootEl.cloneNode(true) as HTMLElement
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT, null)
  const clones: HTMLElement[] = [clone]

  // map of original -> clone path sync
  const stack: Array<{ orig: HTMLElement, copy: HTMLElement }> = [{ orig: rootEl, copy: clone }]
  while (stack.length) {
    const { orig, copy } = stack.pop()!
    inlineComputed(orig, copy)
    for (let i = 0; i < orig.children.length; i++) {
      const oChild = orig.children[i] as HTMLElement
      const cChild = copy.children[i] as HTMLElement
      stack.push({ orig: oChild, copy: cChild })
    }
  }

  const wrapper = document.createElement("div")
  const styleReset = document.createElement("style")
  styleReset.textContent = `*{box-sizing:border-box!important;}`
  wrapper.appendChild(styleReset)
  wrapper.appendChild(clone)
  return wrapper.innerHTML
}

function inlineComputed(src: HTMLElement, dst: HTMLElement) {
  const cs = window.getComputedStyle(src)
  const styleProps = [
    "position", "display", "flex", "flexDirection", "justifyContent", "alignItems", "gap", "width", "height",
    "minWidth", "minHeight", "maxWidth", "maxHeight", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "border", "borderRadius", "background", "backgroundColor",
    "backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat", "color", "font", "fontFamily", "fontSize",
    "fontWeight", "lineHeight", "letterSpacing", "textAlign", "textDecoration", "boxShadow", "overflow", "overflowX", "overflowY",
    "objectFit", "objectPosition", "opacity", "transform", "transition", "whiteSpace"
  ]
  const styleStr = styleProps
    .map((p) => {
      const v = (cs as any)[p]
      return v ? `${camelToKebab(p)}:${v};` : ""
    })
    .join("")
  dst.setAttribute("style", (dst.getAttribute("style") ?? "") + styleStr)

  // Resolve src/href to absolute URLs for images/links
  if (dst instanceof HTMLImageElement && src instanceof HTMLImageElement) {
    if (src.src) dst.src = src.src
  }
  if (dst instanceof HTMLAnchorElement && src instanceof HTMLAnchorElement) {
    if (src.href) dst.href = src.href
  }
}

function camelToKebab(s: string) {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())
}

const OutlineBox = ({ el }: { el: HTMLElement }) => {
  const rect = el.getBoundingClientRect()
  return (
    <div
      className="fixed border-2 border-blue-600 pointer-events-none bg-blue-500/8 z-overlay"
      style={{
        left: rect.left + "px",
        top: rect.top + "px",
        width: rect.width + "px",
        height: rect.height + "px"
      }}
    />
  )
}

const FloatingHint = () => (
  <div className="fixed bottom-3 left-3 px-2.5 py-1.5 text-xs leading-tight font-sans bg-black/70 text-white rounded-md z-hint pointer-events-none">
    GrebRef: Press <b>Ctrl+S</b> (image), <b>Ctrl+D</b> (DOM) or <b>Ctrl+F</b> (full page).
  </div>
)

// Utility functions for enhanced context detection
function detectFramework(): string | null {
  // Check for React.js
  if (!!(window as any).React ||
    !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
    !!document.querySelector('[data-reactroot], [data-reactid]')) {
    return 'React.js'
  }

  // Check for Next.js
  if (!!document.querySelector('script[id=__NEXT_DATA__]')) {
    return 'Next.js'
  }

  // Check for Gatsby.js
  if (!!document.querySelector('[id=___gatsby]')) {
    return 'Gatsby.js'
  }

  // Check for Angular.js (Angular 1.x)
  if (!!(window as any).angular ||
    !!document.querySelector('.ng-binding, [ng-app], [data-ng-app], [ng-controller], [data-ng-controller], [ng-repeat], [data-ng-repeat]') ||
    !!document.querySelector('script[src*="angular.js"], script[src*="angular.min.js"]')) {
    return 'Angular.js'
  }

  // Check for Angular 2+
  if (!!(window as any).getAllAngularRootElements ||
    !!(window as any).ng?.coreTokens?.NgZone) {
    return 'Angular 2+'
  }

  // Check for other frameworks
  if (!!(window as any).Backbone) return 'Backbone.js'
  if (!!(window as any).Ember) return 'Ember.js'
  if (!!(window as any).Vue) return 'Vue.js'
  if (!!(window as any).Meteor) return 'Meteor.js'
  if (!!(window as any).Zepto) return 'Zepto.js'
  if (!!(window as any).jQuery) return 'jQuery.js'

  return null
}

function detectCSSFramework(): string | null {
  // Check for Tailwind
  if (document.querySelector('[class*="bg-"]') || document.querySelector('[class*="text-"]')) return 'Tailwind'

  // Check for Bootstrap
  if (document.querySelector('.container') || document.querySelector('.row')) return 'Bootstrap'

  // Check for Material-UI
  if (document.querySelector('[class*="Mui"]')) return 'Material-UI'

  return null
}

function extractCSSVariables(element: HTMLElement): Record<string, string> {
  const variables: Record<string, string> = {}
  const computedStyle = getComputedStyle(element)

  // Extract common CSS custom properties
  const commonVars = [
    '--primary-color', '--secondary-color', '--accent-color',
    '--text-color', '--background-color', '--border-color',
    '--font-family', '--font-size', '--spacing'
  ]

  commonVars.forEach(varName => {
    const value = computedStyle.getPropertyValue(varName)
    if (value) {
      variables[varName] = value.trim()
    }
  })

  return variables
}