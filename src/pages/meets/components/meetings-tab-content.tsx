import MeetingCard from '@/components/meet/meeting-card'
import type { MeetingStatus } from '@/types/meeting'
import type { MeetingWithIndex } from '@/services/meetings.listing.service'
import { Link } from 'react-router-dom'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

interface MeetingsTabContentProps {
  readonly items: ReadonlyArray<MeetingWithIndex>
  readonly viewMode: 'grid' | 'list'
  readonly page: number
  readonly setPage: Dispatch<SetStateAction<number>>
  readonly pageSize: number
  readonly userUid: string | undefined
  readonly completing: Readonly<Record<string, boolean>>
  readonly onCompleteMeeting: (meeting: MeetingWithIndex) => Promise<void>
  readonly onOpenDetails: (meeting: MeetingWithIndex) => void
  readonly onOpenCheckin: (meeting: MeetingWithIndex) => void
  readonly canUserCompleteMeeting: (meeting: MeetingWithIndex, currentUserId: string | undefined) => boolean
  readonly buildMeetingPath: (basePath: '/meeting' | '/checkin', meeting: MeetingWithIndex) => string
  readonly formatDateTimeLabel: (timestamp: number) => string
  readonly getStatusPill: (status: MeetingStatus) => { label: string; className: string }
  readonly getMeetingKey: (meeting: MeetingWithIndex) => string
  readonly emptyState: ReactNode
}

/**
 * Renderiza una sección de actividades con vista de cuadrícula o tabla,
 * incluyendo paginación y acciones reutilizables.
 */
export default function MeetingsTabContent({
  items,
  viewMode,
  page,
  setPage,
  pageSize,
  userUid,
  completing,
  onCompleteMeeting,
  onOpenDetails,
  onOpenCheckin,
  canUserCompleteMeeting,
  buildMeetingPath,
  formatDateTimeLabel,
  getStatusPill,
  getMeetingKey,
  emptyState,
}: MeetingsTabContentProps) {
  if (items.length === 0) {
    return <>{emptyState}</>
  }

  const totalPages = Math.ceil(items.length / pageSize)
  const currentPage = Math.min(page, totalPages || 1)
  const startIndex = (currentPage - 1) * pageSize
  const pageItems = items.slice(startIndex, startIndex + pageSize)

  if (viewMode === 'grid') {
    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pageItems.map((meeting) => {
            const canComplete = canUserCompleteMeeting(meeting, userUid)
            const meetingKey = getMeetingKey(meeting)
            return (
              <MeetingCard
                key={meetingKey}
                meeting={meeting}
                canComplete={canComplete}
                completing={completing[meetingKey]}
                onComplete={async () => onCompleteMeeting(meeting)}
                onOpenDetails={() => onOpenDetails(meeting)}
                onOpenCheckin={() => onOpenCheckin(meeting)}
              />
            )
          })}
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Mostrando {startIndex + 1}–{Math.min(startIndex + pageSize, items.length)} de {items.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                className={`px-3 py-1 rounded-lg border text-xs font-medium ${currentPage <= 1 ? 'border-muted text-muted-foreground cursor-not-allowed' : 'border-border hover:bg-muted/60'}`}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                className={`px-3 py-1 rounded-lg border text-xs font-medium ${currentPage >= totalPages ? 'border-muted text-muted-foreground cursor-not-allowed' : 'border-border hover:bg-muted/60'}`}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Titulo</th>
            <th className="px-4 py-2 text-left font-semibold">Tipo</th>
            <th className="px-4 py-2 text-left font-semibold">Fecha</th>
            <th className="px-4 py-2 text-left font-semibold">Estado</th>
            <th className="px-4 py-2 text-left font-semibold">Lugar</th>
            <th className="px-4 py-2 text-left font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((meeting) => {
            const canComplete = canUserCompleteMeeting(meeting, userUid)
            const { label, className } = getStatusPill(meeting.status)
            const meetingKey = getMeetingKey(meeting)
            return (
              <tr key={meetingKey} className="border-t border-border hover:bg-muted/40">
                <td className="px-4 py-2 align-top">
                  <div className="font-medium text-foreground">{meeting.title}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{meeting.description || 'Sin descripcion'}</div>
                </td>
                <td className="px-4 py-2 align-top text-xs text-muted-foreground">
                  {meeting.type === 'training' ? 'Capacitacion' : meeting.type === 'custom' ? 'Personalizado' : 'Actividad'}
                </td>
                <td className="px-4 py-2 align-top text-xs text-foreground">
                  {formatDateTimeLabel(meeting.startTime)}
                </td>
                <td className="px-4 py-2 align-top">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>
                    {label}
                  </span>
                </td>
                <td className="px-4 py-2 align-top text-xs text-foreground">
                  {meeting.location}
                </td>
                <td className="px-4 py-2 align-top">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={buildMeetingPath('/meeting', meeting)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/60"
                    >
                      Detalles
                    </Link>
                    <Link
                      to={buildMeetingPath('/checkin', meeting)}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                    >
                      Asistencia
                    </Link>
                    {canComplete && (
                      <button
                        type="button"
                        disabled={completing[meetingKey]}
                        onClick={async () => onCompleteMeeting(meeting)}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {completing[meetingKey] ? 'Finalizando...' : 'Completar'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="px-4 py-3 flex items-center justify-between text-xs text-muted-foreground border-t border-border">
          <span>
            Mostrando {startIndex + 1}–{Math.min(startIndex + pageSize, items.length)} de {items.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className={`px-3 py-1 rounded-lg border text-xs font-medium ${currentPage <= 1 ? 'border-muted text-muted-foreground cursor-not-allowed' : 'border-border hover:bg-muted/60'}`}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className={`px-3 py-1 rounded-lg border text-xs font-medium ${currentPage >= totalPages ? 'border-muted text-muted-foreground cursor-not-allowed' : 'border-border hover:bg-muted/60'}`}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
