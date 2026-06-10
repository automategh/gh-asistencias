import ExcelJS from "exceljs"

const BORDER_THIN: ExcelJS.Borders = {
    top: { style: "thin", color: { argb: "FFCBD0CC" } },
    left: { style: "thin", color: { argb: "FFCBD0CC" } },
    bottom: { style: "thin", color: { argb: "FFCBD0CC" } },
    right: { style: "thin", color: { argb: "FFCBD0CC" } },
    diagonal: { style: "thin", color: { argb: "FFCBD0CC" } },
}

export const EXCEL_BORDER_THIN: ExcelJS.Borders = BORDER_THIN

const FILL_HEADER: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1B3022" },
}

const FILL_ZEBRA: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF6F7F6" },
}

const ALIGN_DEFAULT: ExcelJS.Alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
    shrinkToFit: false,
    indent: 0,
    readingOrder: "ltr",
    textRotation: 0,
}

export const EXCEL_TITLE_STYLE: ExcelJS.Style = {
    font: { bold: true, size: 16, color: { argb: "FF1B3022" } },
    numFmt: "General",
    alignment: { ...ALIGN_DEFAULT, horizontal: "left" },
    protection: { locked: false, hidden: false },
    border: BORDER_THIN,
    fill: { type: "pattern", pattern: "none" },
}

export const EXCEL_SUBTITLE_STYLE: ExcelJS.Style = {
    font: { italic: true, size: 10, color: { argb: "FF5F6560" } },
    numFmt: "General",
    alignment: { ...ALIGN_DEFAULT, horizontal: "left" },
    protection: { locked: false, hidden: false },
    border: BORDER_THIN,
    fill: { type: "pattern", pattern: "none" },
}

export const EXCEL_SECTION_STYLE: ExcelJS.Style = {
    font: { bold: true, size: 12, color: { argb: "FFFFFFFF" } },
    numFmt: "General",
    fill: FILL_HEADER,
    alignment: { ...ALIGN_DEFAULT, horizontal: "left" },
    border: BORDER_THIN,
    protection: { locked: false, hidden: false },
}

export const EXCEL_HEADER_STYLE: ExcelJS.Style = {
    font: { bold: true, size: 11, color: { argb: "FFFFFFFF" } },
    numFmt: "General",
    fill: FILL_HEADER,
    alignment: { ...ALIGN_DEFAULT, horizontal: "center" },
    border: BORDER_THIN,
    protection: { locked: false, hidden: false },
}

export const EXCEL_BASE_CELL: ExcelJS.Style = {
    font: { name: "Arial", size: 10, color: { argb: "FF191C1C" } },
    numFmt: "General",
    border: BORDER_THIN,
    alignment: { ...ALIGN_DEFAULT, horizontal: "left" },
    protection: { locked: false, hidden: false },
    fill: { type: "pattern", pattern: "none" },
}

export const EXCEL_ZEBRA_CELL: ExcelJS.Style = {
    font: { name: "Arial", size: 10, color: { argb: "FF191C1C" } },
    numFmt: "General",
    border: BORDER_THIN,
    alignment: { ...ALIGN_DEFAULT, horizontal: "left" },
    protection: { locked: false, hidden: false },
    fill: FILL_ZEBRA,
}

export interface ApplyRowOptions {
    readonly row: ExcelJS.Row
    readonly values: readonly (string | number | null)[]
    readonly isZebra: boolean
    readonly alignCenterCols?: readonly number[]
    readonly alignRightCols?: readonly number[]
    readonly wrapCols?: readonly number[]
    readonly boldCols?: readonly number[]
}

/**
 * Aplica estilos consistentes a una fila: bordes, zebra fill, alineaci\u00f3n, wrap.
 * wrapText=true siempre para que la celda expanda su alto cuando el contenido no entra.
 */
export function applyRowStyle(options: ApplyRowOptions): void {
    const { row, values, isZebra, alignCenterCols = [], alignRightCols = [], wrapCols = [], boldCols = [] } = options
    const baseStyle: ExcelJS.Style = isZebra ? EXCEL_ZEBRA_CELL : EXCEL_BASE_CELL
    values.forEach((value, colIdx) => {
        const cell = row.getCell(colIdx + 1)
        cell.value = value
        const horizontal: ExcelJS.Alignment["horizontal"] = alignCenterCols.includes(colIdx)
            ? "center"
            : alignRightCols.includes(colIdx)
                ? "right"
                : "left"
        const wrapText = wrapCols.length === 0 ? true : wrapCols.includes(colIdx)
        const cellAlignment: ExcelJS.Alignment = {
            ...ALIGN_DEFAULT,
            horizontal,
            wrapText,
        }
        const cellStyle: ExcelJS.Style = {
            ...baseStyle,
            alignment: cellAlignment,
        }
        if (boldCols.includes(colIdx) && cellStyle.font) {
            cellStyle.font = { ...cellStyle.font, bold: true }
        }
        cell.style = cellStyle
    })
}

/**
 * Funci\u00f3n helper para crear y descargar un workbook.
 */
export async function downloadWorkbook(wb: ExcelJS.Workbook, fileName: string): Promise<void> {
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
}
