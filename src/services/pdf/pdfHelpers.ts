import jsPDF from "jspdf"

export type Rgb = readonly [number, number, number]

export const COLOR_HEADER: Rgb = [27, 48, 34] as const
export const COLOR_TEXT: Rgb = [25, 28, 28] as const
export const COLOR_TEXT_LIGHT: Rgb = [120, 120, 120] as const
export const COLOR_ZEBRA: Rgb = [246, 247, 246] as const
export const COLOR_BORDER: Rgb = [203, 208, 204] as const
export const COLOR_DELTA_POS: Rgb = [27, 94, 32] as const
export const COLOR_DELTA_NEG: Rgb = [198, 40, 40] as const
export const COLOR_BAR: Rgb = [158, 230, 179] as const
export const COLOR_WHITE: Rgb = [255, 255, 255] as const

export interface PdfCursor {
    readonly y: number
    readonly pageNumber: number
}

export interface KpiItem {
    readonly label: string
    readonly value: string
    readonly sub: string
    readonly delta?: number | null
    readonly deltaPreviousLabel?: string
}

export interface TableColumn {
    readonly label: string
    readonly width: number
    readonly align?: "left" | "center" | "right"
}

export interface BarRowOptions {
    readonly label: string
    readonly valueLabel: string
    readonly labelW: number
    readonly valueW: number
    readonly barMaxW: number
    readonly value: number
    readonly maxValue: number
    readonly isZebra: boolean
    readonly color?: Rgb
}

const LOGO_PATH = "/Logo-heroica-green.png"

/**
 * Carga el logo desde /public y lo recorta al bounding box del contenido real.
 */
export async function loadLogoDataUrl(): Promise<string | null> {
    try {
        const res = await fetch(LOGO_PATH)
        if (!res.ok) return null
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
        })
        return await cropLogoToContent(dataUrl)
    } catch (error) {
        console.warn("No se pudo cargar el logo:", error)
        return null
    }
}

async function cropLogoToContent(dataUrl: string): Promise<string> {
    try {
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = reject
            img.src = dataUrl
        })
        const fullCanvas = document.createElement("canvas")
        fullCanvas.width = img.naturalWidth
        fullCanvas.height = img.naturalHeight
        const fullCtx = fullCanvas.getContext("2d")
        if (!fullCtx) return dataUrl
        fullCtx.drawImage(img, 0, 0)
        const data = fullCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data
        let top = -1
        let bottom = -1
        let left = img.naturalWidth
        let right = 0
        for (let y = 0; y < img.naturalHeight; y++) {
            for (let x = 0; x < img.naturalWidth; x++) {
                const off = (y * img.naturalWidth + x) * 4
                const a = data[off + 3] ?? 0
                const r = data[off] ?? 0
                const g = data[off + 1] ?? 0
                const b = data[off + 2] ?? 0
                if (a > 0 && (r < 250 || g < 250 || b < 250)) {
                    if (top < 0) top = y
                    bottom = y
                    if (x < left) left = x
                    if (x > right) right = x
                }
            }
        }
        if (top < 0 || right <= left || bottom <= top) return dataUrl
        const pad = 10
        const cropX = Math.max(0, left - pad)
        const cropY = Math.max(0, top - pad)
        const cropW = Math.min(img.naturalWidth - cropX, right - left + 1 + pad * 2)
        const cropH = Math.min(img.naturalHeight - cropY, bottom - top + 1 + pad * 2)
        const cropCanvas = document.createElement("canvas")
        cropCanvas.width = cropW
        cropCanvas.height = cropH
        const cropCtx = cropCanvas.getContext("2d")
        if (!cropCtx) return dataUrl
        cropCtx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
        return cropCanvas.toDataURL("image/png")
    } catch (error) {
        console.warn("No se pudo recortar el logo, usando original:", error)
        return dataUrl
    }
}

/**
 * Estado mutable del PDF. Usado como \u00fanico punto de coordinaci\u00f3n entre
 * las funciones de dibujo (header, footer, tablas, KPIs, etc).
 */
export interface PdfState {
    readonly pdf: jsPDF
    readonly pageW: number
    readonly pageH: number
    readonly margin: number
    readonly contentW: number
    readonly contentBottom: number
    y: number
    pageNumber: number
    nextPage: () => void
}

export function setFill(state: PdfState, rgb: Rgb): void {
    state.pdf.setFillColor(rgb[0], rgb[1], rgb[2])
}

export function setText(state: PdfState, rgb: Rgb): void {
    state.pdf.setTextColor(rgb[0], rgb[1], rgb[2])
}

export function setDraw(state: PdfState, rgb: Rgb): void {
    state.pdf.setDrawColor(rgb[0], rgb[1], rgb[2])
}

/**
 * Crea un PDF horizontal A4 con el estado del cursor inicializado.
 */
export function createLandscapePdf(): PdfState {
    const pdf = new jsPDF("landscape", "mm", "a4")
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const margin = 12
    const contentW = pageW - margin * 2
    const contentBottom = pageH - 14
    return {
        pdf,
        pageW,
        pageH,
        margin,
        contentW,
        contentBottom,
        y: margin,
        pageNumber: 1,
        nextPage: function (this: PdfState) {
            this.pageNumber++
        },
    }
}

export function drawHeader(
    state: PdfState,
    options: {
        readonly title: string
        readonly subtitle: string
        readonly logoDataUrl: string | null
        readonly logoWidth?: number
    },
): void {
    const { pdf, pageW, margin } = state
    const logoWidth = options.logoWidth ?? 42
    if (options.logoDataUrl) {
        const logoH = logoWidth / 3.6
        pdf.addImage(options.logoDataUrl, "PNG", margin, margin - 2, logoWidth, logoH)
    }
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(16)
    setText(state, COLOR_TEXT)
    pdf.text(options.title, pageW - margin, margin + 2, { align: "right" })
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(9)
    setText(state, COLOR_TEXT_LIGHT)
    pdf.text(options.subtitle, pageW - margin, margin + 8, { align: "right" })
    setDraw(state, COLOR_BORDER)
    pdf.setLineWidth(0.3)
    pdf.line(margin, margin + 12, pageW - margin, margin + 12)
}

export function drawFooter(state: PdfState, generatedAt?: string): void {
    const { pdf, pageH, margin, pageW } = state
    const text = generatedAt ?? new Date().toLocaleString("es-ES", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(8)
    setText(state, COLOR_TEXT_LIGHT)
    pdf.text(`Generado el ${text}`, margin, pageH - 6)
    pdf.text(`Página ${state.pageNumber}`, pageW - margin, pageH - 6, { align: "right" })
}

export function ensureSpace(
    state: PdfState,
    needed: number,
    redrawHeader: () => void,
): void {
    if (state.y + needed > state.contentBottom) {
        drawFooter(state)
        state.pdf.addPage("a4", "landscape")
        state.nextPage()
        redrawHeader()
        state.y = state.margin + 16
    }
}

export function drawSectionTitle(state: PdfState, title: string, redrawHeader: () => void): void {
    ensureSpace(state, 12, redrawHeader)
    const { pdf, margin, contentW } = state
    const y = state.y
    setFill(state, COLOR_HEADER)
    pdf.rect(margin, y, contentW, 8, "F")
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(10)
    setText(state, COLOR_WHITE)
    pdf.text(title, margin + 2, y + 5.5)
    state.y = y + 10
}

export function drawTableHeader(
    state: PdfState,
    cols: readonly TableColumn[],
    redrawHeader: () => void,
): void {
    ensureSpace(state, 9, redrawHeader)
    const { pdf, margin, contentW } = state
    const y = state.y
    setFill(state, COLOR_HEADER)
    pdf.rect(margin, y, contentW, 7, "F")
    pdf.setFont("helvetica", "bold")
    pdf.setFontSize(8)
    setText(state, COLOR_WHITE)
    let x = margin
    for (const col of cols) {
        const align = col.align ?? "left"
        const textX = align === "left" ? x + 1.5 : align === "right" ? x + col.width - 1.5 : x + col.width / 2
        pdf.text(col.label, textX, y + 5, { align })
        x += col.width
    }
    state.y = y + 7
}

export function drawTableRow(
    state: PdfState,
    cells: readonly { text: string; align?: "left" | "center" | "right" }[],
    cols: readonly { width: number }[],
    isZebra: boolean,
): void {
    const rowH = 6
    const { pdf, margin, contentW } = state
    const y = state.y
    if (isZebra) {
        setFill(state, COLOR_ZEBRA)
        pdf.rect(margin, y, contentW, rowH, "F")
    }
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(8)
    setText(state, COLOR_TEXT)
    let x = margin
    cells.forEach((cell, i) => {
        const align = cell.align ?? "left"
        const colW = cols[i]?.width ?? 0
        const textW = colW - 3
        const textX = align === "left" ? x + 1.5 : align === "right" ? x + colW - 1.5 : x + colW / 2
        const linesArr = pdf.splitTextToSize(cell.text, textW) as string[]
        let finalText = linesArr[0] ?? ""
        if (linesArr.length > 1) {
            while (finalText.length > 0 && pdf.getTextWidth(finalText + "...") > textW) {
                finalText = finalText.slice(0, -1)
            }
            finalText = finalText + "..."
        } else if (pdf.getTextWidth(finalText) > textW) {
            while (finalText.length > 0 && pdf.getTextWidth(finalText + "...") > textW) {
                finalText = finalText.slice(0, -1)
            }
            finalText = finalText + "..."
        }
        pdf.text(finalText, textX, y + 4, { align })
        x += colW
    })
    state.y = y + rowH
}

export function drawTableEnd(state: PdfState): void {
    const { pdf, margin, pageW } = state
    const y = state.y
    setDraw(state, COLOR_BORDER)
    pdf.setLineWidth(0.2)
    pdf.line(margin, y, pageW - margin, y)
    state.y = y + 4
}

/**
 * Dibuja un grid de KPIs en formato N columnas.
 */
export function drawKpiGrid(
    state: PdfState,
    kpis: readonly KpiItem[],
    redrawHeader: () => void,
    options?: { readonly cols?: number },
): void {
    const cols = options?.cols ?? 2
    const kpiBoxW = (state.contentW - 4 * (cols - 1)) / cols
    const kpiBoxH = 26
    const startY = state.margin + 16
    const { pdf, margin } = state
    ensureSpace(state, startY + 2 * (kpiBoxH + 4) - state.y, redrawHeader)
    kpis.forEach((kpi, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = margin + col * (kpiBoxW + 4)
        const y = startY + row * (kpiBoxH + 4)
        setDraw(state, COLOR_BORDER)
        pdf.setLineWidth(0.3)
        pdf.rect(x, y, kpiBoxW, kpiBoxH)
        pdf.setFont("helvetica", "bold")
        pdf.setFontSize(8)
        setText(state, COLOR_TEXT_LIGHT)
        pdf.text(kpi.label.toUpperCase(), x + 3, y + 5)
        pdf.setFont("helvetica", "bold")
        pdf.setFontSize(22)
        setText(state, COLOR_HEADER)
        pdf.text(kpi.value, x + 3, y + 16)
        pdf.setFont("helvetica", "normal")
        pdf.setFontSize(7)
        setText(state, COLOR_TEXT_LIGHT)
        pdf.text(kpi.sub, x + 3, y + 22)
        if (kpi.delta !== null && kpi.delta !== undefined) {
            const deltaText = `${kpi.delta >= 0 ? "+" : ""}${kpi.delta.toFixed(0)}% vs ${kpi.deltaPreviousLabel ?? ""}`
            setFill(state, kpi.delta >= 0 ? COLOR_DELTA_POS : COLOR_DELTA_NEG)
            const badgeW = pdf.getTextWidth(deltaText) + 4
            pdf.rect(x + kpiBoxW - badgeW - 3, y + 2, badgeW, 5, "F")
            pdf.setFont("helvetica", "bold")
            pdf.setFontSize(7)
            setText(state, COLOR_WHITE)
            pdf.text(deltaText, x + kpiBoxW - badgeW / 2 - 3, y + 5.5, { align: "center" })
        }
    })
    const totalRows = Math.ceil(kpis.length / cols)
    state.y = startY + totalRows * (kpiBoxH + 4) + 6
}

/**
 * Dibuja un p\u00e1rrafo de texto con ajuste de l\u00ednea.
 */
export function drawParagraph(
    state: PdfState,
    text: string,
    redrawHeader: () => void,
    options?: { readonly fontSize?: number; readonly paddingBottom?: number },
): void {
    const { pdf, margin, contentW } = state
    const fontSize = options?.fontSize ?? 9
    const paddingBottom = options?.paddingBottom ?? 4
    pdf.setFont("helvetica", "normal")
    pdf.setFontSize(fontSize)
    setText(state, COLOR_TEXT)
    const lines = pdf.splitTextToSize(text, contentW)
    for (const line of lines) {
        ensureSpace(state, 5, redrawHeader)
        const y = state.y
        pdf.text(line, margin, y + 4)
        state.y = y + 5
    }
    state.y = state.y + paddingBottom
}

/**
 * Dibuja una fila de tabla con barra horizontal a la derecha.
 */
export function drawBarRow(
    state: PdfState,
    options: BarRowOptions,
    redrawHeader: () => void,
): void {
    const { label, valueLabel, labelW, valueW, barMaxW, value: rawValue, maxValue, isZebra, color } = options
    const { pdf, margin, contentW } = state
    ensureSpace(state, 7, redrawHeader)
    const y = state.y
    const rowH = 6
    if (isZebra) {
        setFill(state, COLOR_ZEBRA)
        pdf.rect(margin, y, contentW, rowH, "F")
    }
    drawTableRow(
        state,
        [
            { text: label, align: "left" },
            { text: valueLabel, align: "right" },
            { text: "", align: "left" },
        ],
        [{ width: labelW }, { width: valueW }, { width: barMaxW + 4 }],
        false,
    )
    // La barra se dibuja en el centro vertical de la fila
    const barY = y + 1.5
    const barW = maxValue > 0 ? Math.max(2, (rawValue / maxValue) * barMaxW) : 0
    setFill(state, color ?? COLOR_BAR)
    pdf.rect(margin + labelW + valueW + 2, barY, barW, 1.5, "F")
}
