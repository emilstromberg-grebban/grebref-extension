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

const BACKEND_URL = "https://a31e2mrewm.sharedwithexpose.com/api/clips"


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

type Mode = "image" | "dom"

const Overlay = () => {
  const [mode, setMode] = useState<Mode | null>(null)
  const [rect, setRect] = useState<{x:number, y:number, w:number, h:number} | null>(null)
  const [drag, setDrag] = useState<{startX:number, startY:number} | null>(null)
  const [preview, setPreview] = useState<string | null>(null) // image dataURL
  const [domPreview, setDomPreview] = useState<string | null>(null) // serialized HTML string
  const [desc, setDesc] = useState("")
  const [tags, setTags] = useState("")

  // DOM mode highlighting
  const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null)
  const [pickedEl, setPickedEl] = useState<HTMLElement | null>(null)
  
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
          console.log("🎉 Preview set and mode cleared")
        }
        img.onerror = (error) => {
          console.error("❌ Image load error:", error)
        }
        img.src = dataUrl
      } catch (error) {
        console.error("❌ Error in capture process:", error)
        alert("Error: " + error)
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

  const doUpload = async () => {
    const payload: any = {
      url: location.href,
      title: document.title,
      description: desc,
      // tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      // type: preview ? "image" : "dom"
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
      alert("Uppladdad ✅")
      resetAll()
    } catch (err: any) {
      alert("Upload misslyckades: " + err?.message)
    }
  }

  // Render
  if (!mode && !preview && !domPreview) return (
    <FloatingHint />
  )

  return (
    <>
      {(mode === "image") && (
        <div className="fixed inset-0 z-overlay cursor-crosshair bg-black/5">
          <div className="fixed top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1.5 text-xs leading-tight font-sans bg-black/70 text-white rounded-md z-hint">IMAGE-snipp (Ctrl+S). Dra för att markera. Esc avbryter.</div>
          {rect && <div className="fixed border-2 border-dashed border-blue-600 bg-blue-500/15 pointer-events-none" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
        </div>
      )}
      {(mode === "dom") && (
        <>
          <div className="fixed inset-0 z-[2147483646] bg-black/4 cursor-crosshair" />
          {hoverEl && <OutlineBox el={hoverEl} />}
          <div className="fixed top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1.5 text-xs leading-tight font-sans bg-black/70 text-white rounded-md z-hint">DOM-snipp (Ctrl+D). Hovra och klicka för att välja element. Esc avbryter.</div>
        </>
      )}
      {(preview || domPreview) && (
        <div className="fixed right-5 bottom-5 z-overlay flex gap-3 p-3 bg-gray-900 text-gray-200 rounded-xl shadow-2xl max-w-[min(90vw,640px)]">
          {preview && <img src={preview} alt="Reference Snip" className="block max-w-80 max-h-60 rounded-lg object-contain bg-black" />}
          {domPreview && (
            <div className="flex flex-col gap-1.5 w-80 max-h-65">
              <div className="font-semibold text-xs text-gray-300">DOM-snipp</div>
              <textarea className="w-full h-55 bg-gray-800 text-gray-300 border border-gray-600 rounded-lg p-2 text-xs leading-snug font-mono resize-y" readOnly value={domPreview} />
            </div>
          )}
          <div className="flex flex-col gap-2 w-70">
            <input className="w-full px-2.5 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-200 text-xs font-sans" placeholder="Beskrivning (valfritt)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <input className="w-full px-2.5 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-200 text-xs font-sans" placeholder="Taggar, kommaseparerade" value={tags} onChange={(e) => setTags(e.target.value)} />
            <div className="flex gap-2">
              {preview && <button className="px-2.5 py-2 border-0 rounded-lg bg-blue-600 text-white text-xs font-sans cursor-pointer" onClick={() => downloadDataUrl(preview!, "snip.png")}>Ladda ned</button>}
              <button className="px-2.5 py-2 border-0 rounded-lg bg-blue-600 text-white text-xs font-sans cursor-pointer" onClick={doUpload}>Ladda upp</button>
              <button className="px-2.5 py-2 border-0 rounded-lg bg-blue-600 text-white text-xs font-sans cursor-pointer" onClick={resetAll}>Stäng</button>
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
  function resetAll() {
    setMode(null)
    setRect(null)
    setPreview(null)
    setDomPreview(null)
    setDesc("")
    setTags("")
    setHoverEl(null)
    setPickedEl(null)
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
    "position","display","flex","flexDirection","justifyContent","alignItems","gap","width","height",
    "minWidth","minHeight","maxWidth","maxHeight","padding","paddingTop","paddingRight","paddingBottom","paddingLeft",
    "margin","marginTop","marginRight","marginBottom","marginLeft","border","borderRadius","background","backgroundColor",
    "backgroundImage","backgroundSize","backgroundPosition","backgroundRepeat","color","font","fontFamily","fontSize",
    "fontWeight","lineHeight","letterSpacing","textAlign","textDecoration","boxShadow","overflow","overflowX","overflowY",
    "objectFit","objectPosition","opacity","transform","transition","whiteSpace"
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
      className="fixed border-2 border-blue-600 bg-blue-500/8 z-overlay pointer-events-none"
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
      Reference Snipper: tryck <b>Ctrl+S</b> (bild) eller <b>Ctrl+D</b> (DOM).
    </div>
)