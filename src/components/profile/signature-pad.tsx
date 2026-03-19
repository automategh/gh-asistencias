import React, {
    useRef,
    useEffect,
    useState,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from "react"
import { Button } from "@/components/ui/button"
import { Eraser, Check } from "lucide-react"

/**
 * API imperativa expuesta por el componente de firma.
 * Permite limpiar el lienzo, consultar si está vacío y obtener la imagen resultante.
 */
export interface SignaturePadHandle {
    /** Limpia la firma actual y resetea el estado interno. */
    clear: () => void
    /**
     * Devuelve la firma como Data URL.
     * @param type Tipo de imagen a generar.
     * @param quality Calidad en formato JPEG (0-1), si aplica.
     */
    getDataURL: (type?: "image/png" | "image/jpeg", quality?: number) => string | null
    /** Indica si actualmente no hay ningún trazo en el lienzo. */
    isEmpty: () => boolean
}

/**
 * Props del componente de firma.
 * onSave se dispara al pulsar "Confirmar" y onChange cuando cambia si hay firma o no.
 */
interface SignaturePadProps {
    /** Callback con la firma en formato Data URL cuando el usuario confirma. */
    onSave?: (signature: string) => void
    /** Notifica si el lienzo pasa de vacío a con firma (true) o viceversa (false). */
    onChange?: (hasSignature: boolean) => void
    /** Altura visible del área de firma en píxeles. */
    height?: number
    /** Deshabilita interacción y botones si es true. */
    disabled?: boolean
}

/**
 * Componente de área de firma basado en canvas con soporte para pantallas HiDPI
 * y eventos de puntero unificados (mouse, táctil, lápiz).
 */
export const SignaturePadCanvas = forwardRef<SignaturePadHandle, SignaturePadProps>(
    ({ onSave, onChange, height = 180, disabled = false }, ref) => {
        const containerRef = useRef<HTMLDivElement | null>(null)
        const canvasRef = useRef<HTMLCanvasElement | null>(null)
        const [isDrawing, setIsDrawing] = useState(false)
        const [hasSignature, setHasSignature] = useState(false)

        /**
         * Inicializa y ajusta el canvas según el tamaño del contenedor
         * y la densidad de píxeles de la pantalla (HiDPI).
         */
        const setupCanvas = useCallback(() => {
            const canvas = canvasRef.current
            const container = containerRef.current
            if (!canvas || !container) return

            const rect = container.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1

            // Ajustar tamaño interno del canvas para pantallas HiDPI
            canvas.width = rect.width * dpr
            canvas.height = height * dpr

            const ctx = canvas.getContext("2d")
            if (!ctx) return

            // Resetear transformaciones antes de escalar
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.scale(dpr, dpr)

            // Estilos de dibujo
            ctx.strokeStyle = "#000"
            ctx.lineWidth = 2
            ctx.lineCap = "round"
            ctx.lineJoin = "round"

            // Fondo blanco
            ctx.fillStyle = "#fff"
            ctx.fillRect(0, 0, rect.width, height)
        }, [height])

        useEffect(() => {
            setupCanvas()

            const container = containerRef.current
            if (!container) return

            const resizeObserver = new ResizeObserver(() => {
                setupCanvas()
                setHasSignature(false)
                onChange?.(false)
            })

            resizeObserver.observe(container)

            return () => {
                resizeObserver.disconnect()
            }
        }, [setupCanvas, onChange])

        /**
         * Comienza el trazo de la firma cuando el usuario presiona
         * (mouse, touch o lápiz) dentro del canvas.
         */
        const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
            if (disabled) return

            const canvas = canvasRef.current
            const ctx = canvas?.getContext("2d")
            if (!canvas || !ctx) return

            const rect = canvas.getBoundingClientRect()
            const x = event.clientX - rect.left
            const y = event.clientY - rect.top

            canvas.setPointerCapture(event.pointerId)

            ctx.beginPath()
            ctx.moveTo(x, y)
            setIsDrawing(true)
        }

        /**
         * Dibuja la línea siguiendo el movimiento del puntero mientras
         * el usuario mantiene presionado.
         */
        const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
            if (!isDrawing || disabled) return

            const canvas = canvasRef.current
            const ctx = canvas?.getContext("2d")
            if (!canvas || !ctx) return

            const rect = canvas.getBoundingClientRect()
            const x = event.clientX - rect.left
            const y = event.clientY - rect.top

            ctx.lineTo(x, y)
            ctx.stroke()

            if (!hasSignature) {
                setHasSignature(true)
                onChange?.(true)
            }
        }

        /**
         * Finaliza el trazo actual y libera la captura del puntero
         * si aplica.
         */
        const stopDrawing = (event?: React.PointerEvent<HTMLCanvasElement>) => {
            if (event && canvasRef.current) {
                try {
                    canvasRef.current.releasePointerCapture(event.pointerId)
                } catch {
                    // ignore if pointer was not captured
                }
            }
            setIsDrawing(false)
        }

        /**
         * Limpia por completo el contenido del canvas y marca el
         * estado como sin firma.
         */
        const clearSignature = useCallback(() => {
            const canvas = canvasRef.current
            const ctx = canvas?.getContext("2d")
            const container = containerRef.current
            if (!canvas || !ctx || !container) return

            const rect = container.getBoundingClientRect()

            ctx.fillStyle = "#fff"
            ctx.fillRect(0, 0, rect.width, height)

            setHasSignature(false)
            onChange?.(false)
        }, [height, onChange])

        /**
         * Genera la imagen de la firma en formato PNG y la entrega
         * mediante el callback onSave.
         */
        const saveSignature = () => {
            const canvas = canvasRef.current
            if (!canvas || !hasSignature || !onSave) return

            const dataUrl = canvas.toDataURL("image/png")
            onSave(dataUrl)
        }

        useImperativeHandle(
            ref,
            () => ({
                clear: clearSignature,
                getDataURL: (type: "image/png" | "image/jpeg" = "image/png", quality?: number) => {
                    const canvas = canvasRef.current
                    if (!canvas || !hasSignature) return null
                    return canvas.toDataURL(type, quality)
                },
                isEmpty: () => !hasSignature,
            }),
            [clearSignature, hasSignature]
        )

        return (
            <div className="flex flex-col gap-3">
                <div
                    ref={containerRef}
                    className="relative border-2 border-border rounded-md overflow-hidden bg-card"
                    style={{ height: `${height}px` }}
                >
                    <canvas
                        ref={canvasRef}
                        className="touch-none cursor-crosshair w-full h-full"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={stopDrawing}
                        onPointerLeave={stopDrawing}
                        aria-label="Área para firma manuscrita"
                        role="img"
                    />
                    <div className="absolute bottom-2 left-2 text-xs text-muted-foreground pointer-events-none">
                        Firme aquí
                    </div>
                </div>
                <div className="flex gap-2 justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearSignature}
                        className="gap-2 bg-transparent"
                        disabled={disabled}
                    >
                        <Eraser className="h-4 w-4" />
                        Borrar
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={saveSignature}
                        disabled={disabled || !hasSignature}
                        className="gap-2"
                    >
                        <Check className="h-4 w-4" />
                        Confirmar Firma
                    </Button>
                </div>
            </div>
        )
    }
)

SignaturePadCanvas.displayName = "SignaturePadCanvas"
