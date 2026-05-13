import { Briefcase, Building2, ChevronRight, Mail, MapPin, UserRound } from "lucide-react"

import type { SurveyResponseCardQuestionItem } from "../survey-results.types"
import { buildInitials, formatDateTimeLabel, QUESTION_TYPE_LABELS } from "../survey-results.utils"

interface SurveyResponseCardProps {
    respondentName: string
    respondentDepartment: string
    respondentCargo: string
    respondentRecinto: string
    respondentEmail: string
    answeredQuestions: number
    totalQuestions: number
    createdAt: string
    questions: SurveyResponseCardQuestionItem[]
}

export const SurveyResponseCard = ({
    respondentName,
    respondentDepartment,
    respondentCargo,
    respondentRecinto,
    respondentEmail,
    answeredQuestions,
    totalQuestions,
    createdAt,
    questions,
}: SurveyResponseCardProps) => {
    const respondentInitials = buildInitials(respondentName)

    return (
        <details className="group overflow-hidden rounded-[28px] border border-[#dbe5db] bg-white shadow-[0_12px_28px_rgba(39,60,42,0.06)] transition-shadow open:shadow-[0_18px_34px_rgba(39,60,42,0.10)]">
            <summary className="list-none cursor-pointer bg-[linear-gradient(135deg,#f8fbf8_0%,#f3f7f3_72%,#fff7ee_100%)] px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-4">
                        <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-[#273c2a] text-sm font-bold tracking-wide text-white shadow-[0_8px_18px_rgba(39,60,42,0.16)]">
                            {respondentInitials}
                        </div>
                        <div className="min-w-0 space-y-3">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-base font-bold text-[#191c1c]">{respondentName}</p>
                                    <span className="inline-flex items-center gap-1 rounded-full border border-[#f3d6ad] bg-[#fff5e8] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#8d6327]">
                                        <MapPin className="h-3 w-3" />
                                        {respondentRecinto}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-[#5a665a]">
                                    Respuesta registrada el {formatDateTimeLabel(createdAt)}
                                </p>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border border-[#e7ece7] bg-white/90 px-3 py-2">
                                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">
                                        <Mail className="h-3.5 w-3.5" />
                                        Correo
                                    </p>
                                    <p className="mt-1 truncate text-xs font-medium text-[#191c1c]">{respondentEmail}</p>
                                </div>
                                <div className="rounded-2xl border border-[#e7ece7] bg-white/90 px-3 py-2">
                                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">
                                        <Briefcase className="h-3.5 w-3.5" />
                                        Cargo
                                    </p>
                                    <p className="mt-1 text-xs font-medium text-[#191c1c]">{respondentCargo}</p>
                                </div>
                                <div className="rounded-2xl border border-[#e7ece7] bg-white/90 px-3 py-2">
                                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">
                                        <Building2 className="h-3.5 w-3.5" />
                                        Área
                                    </p>
                                    <p className="mt-1 text-xs font-medium text-[#191c1c]">{respondentDepartment}</p>
                                </div>
                                <div className="rounded-2xl border border-[#e7ece7] bg-white/90 px-3 py-2">
                                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">
                                        <UserRound className="h-3.5 w-3.5" />
                                        Contestó
                                    </p>
                                    <p className="mt-1 text-xs font-medium text-[#191c1c]">{answeredQuestions} de {totalQuestions} preguntas</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/85 px-3 py-2 text-xs font-semibold text-[#3a5340] shadow-sm">
                        <span>Ver respuestas</span>
                        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                    </div>
                </div>
            </summary>

            <div className="border-t border-[#eef1ee] bg-[#fcfdfc] px-5 py-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">Detalle de respuestas</p>
                        <p className="mt-1 text-xs text-[#5a665a]">Cada respuesta se muestra en una tarjeta independiente para hacer más fácil la revisión.</p>
                    </div>
                    <div className="rounded-full border border-[#e7ece7] bg-white px-3 py-1.5 text-xs font-semibold text-[#5a665a]">
                        {answeredQuestions} respuesta{answeredQuestions === 1 ? "" : "s"} registradas
                    </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                    {questions.map((question) => (
                        <article key={question.id} className="rounded-3xl border border-[#e7ece7] bg-white p-4 shadow-[0_8px_18px_rgba(39,60,42,0.04)]">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">
                                        {QUESTION_TYPE_LABELS[question.type]}
                                    </p>
                                    <p className="mt-2 text-sm font-semibold leading-6 text-[#191c1c]">{question.text}</p>
                                </div>
                                <span className="shrink-0 rounded-full border border-[#dbe5db] bg-[#f8faf8] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#5a665a]">
                                    #{question.index + 1}
                                </span>
                            </div>

                            <div className="mt-4 rounded-2xl bg-[#f8faf8] px-4 py-3">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8d6327]">Respuesta</p>
                                <p className="mt-2 text-sm leading-6 text-[#434843]">{question.answer}</p>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </details>
    )
}