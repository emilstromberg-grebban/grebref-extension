# GrebRef

Minimal MV3-extension byggd med Plasmo, för att lasso-snippa en rektangel av aktuell flik,
beskära client-side och visa en förhandsvisning (med enkel export). Perfekt start för ert
UI-referensbibliotek.

## Funktioner i denna starter
- Ctrl+S för att gå in i snipp-läge
- Rita rektangel över viewporten
- Screenshot av synliga tabben (`tabs.captureVisibleTab`) via background
- Client-side beskärning i content script (canvas)
- Preview med beskrivning/taggar-fält (ingen backend än)

## Kom igång
1. **Installera**:
   ```bash
   pnpm i
   ```
2. **Kör i dev-läge** (hot reload i Chrome):
   ```bash
   pnpm run dev
   ```
3. **Ladda in i Chrome**:
   - Öppna `chrome://extensions`
   - Aktivera **Developer mode**
   - Klicka **Load unpacked** och peka på mappen `build/chrome-mv3-dev` som genereras av Plasmo dev
     (alternativt kör `pnpm run build` och ladda mappen `build/chrome-mv3-prod`).

## Vidareutveckling (nästa steg)
- **Upload**: i `overlay.tsx`, när `cropped` är klar — POST:a till din backend.
- **OCR & auto-taggar**: görs på servern efter upload.
- **Full page**: implementera scroll & stitch (senare), eller nöj er med viewport för MVP.
- **DOM-snipp**: lägg till ett läge som serialiserar `outerHTML` + computed styles (same-origin).
- **Mikrointeraktioner**: använd `tabCapture` och spara korta WebM-klipp (ev. offscreen page).

## Behörigheter
- `activeTab`, `tabs`, `scripting`, `storage`, `host_permissions: <all_urls>` (kan slimmats senare/ondemand).

---
Byggd med ❤️ på Plasmo. Detta är en startpunkt – trimma UI och lägg till backend så har ni ett riktigt arbetsflöde.


## Upload & DOM-snipp
Nytt:
- **Upload**: `Ladda upp` skickar POST till `PLASMO_PUBLIC_BACKEND_URL` (fallback `http://localhost:8787/api/references`).
- **DOM-snipp**: Tryck **Alt+D**, hovra och klicka elementet du vill spara. Vi serialiserar subtree och inline:ar *viktiga* computed styles.

### Backend-URL
Sätt en env-variabel i dev:
```bash
export PLASMO_PUBLIC_BACKEND_URL="http://localhost:8787/api/references"
pnpm run dev
```
(I produktion: bygg med `PLASMO_PUBLIC_BACKEND_URL` satt i env. Prefixet `PLASMO_PUBLIC_` krävs för att exponera värdet till klienten.)

### Payload-exempel
**Image:**
```json
{
  "type": "image",
  "url": "https://exempel.com/page",
  "title": "Sidtitel",
  "description": "min beskrivning",
  "tags": ["pdp","hover"],
  "imageDataUrl": "data:image/png;base64,..."
}
```
**DOM:**
```json
{
  "type": "dom",
  "url": "https://exempel.com/page",
  "title": "Sidtitel",
  "description": "min beskrivning",
  "tags": ["checkout","button"],
  "domHtml": "<div style=\"...\">...</div>"
}
```

### Begränsningar i DOM-läget
- Cross-origin iframes kan inte läsas.
- Externa assets (bilder/typsnitt) bäddas **inte** inline per default (CORS). Vi sätter absoluta URL:er där det går.
- CSS inliningen är förenklad för MVP – utöka listan av properties vid behov.
