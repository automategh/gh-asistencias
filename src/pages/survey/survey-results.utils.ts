import type { SurveyAnswerValue, SurveyOption, SurveyQuestion, SurveyResponse } from "@/services/forms.service"
import type {
    DistributionChartDatum,
    QuestionAnalytics,
    RatingDistributionItem,
    RespondentDistributionItem,
    SelectionDistributionItem,
} from "./survey-results.types"

export const RESPONSES_PER_PAGE = 10
export const ALL_FILTER_VALUE = "__all__"

export const QUESTION_TYPE_LABELS: Record<SurveyQuestion["type"], string> = {
    rating: "Escala de valoración",
    single: "Selección única",
    multiple: "Selección múltiple",
    text: "Texto libre",
}

export const SURVEY_CATEGORY_LABELS: Record<string, string> = {
    training: "Capacitación",
    meeting: "Reunión",
    custom: "Personalizada",
}

export const DISTRIBUTION_COLORS = [
    "#273c2a",
    "#3a5340",
    "#6f8b73",
    "#9fb09f",
    "#F2B05F",
    "#efbe82",
    "#d8e0d7",
]

export const RATING_BAR_COLORS = [
    "#d8e0d7",
    "#bfd0be",
    "#9fb09f",
    "#6f8b73",
    "#273c2a",
    "#273c2a",
    "#3a5340",
    "#6f8b73",
    "#F2B05F",
    "#efbe82",
]

export const formatDateLabel = (value: number): string => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return "Fecha no disponible"
    }

    return date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    })
}

export const formatDateTimeLabel = (value: string): string => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }

    return date.toLocaleString("es-ES", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

export const truncateLabel = (value: string, maxLength = 22): string => {
    if (value.length <= maxLength) {
        return value
    }

    return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export const buildInitials = (value: string): string => {
    const normalized = value.trim()
    if (normalized.length === 0) {
        return "SN"
    }

    const parts = normalized.split(/\s+/).filter((part) => part.length > 0)
    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase()
    }

    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
}

export const buildFilterOptions = (values: Array<string | null | undefined>): string[] => {
    return Array.from(
        new Set(
            values
                .map((value) => (typeof value === "string" ? value.trim() : ""))
                .filter((value) => value.length > 0),
        ),
    ).sort((first, second) => first.localeCompare(second, "es-ES"))
}

export const buildDistribution = (values: Array<string | null | undefined>): RespondentDistributionItem[] => {
    const counts = new Map<string, number>()

    for (const value of values) {
        const normalized = typeof value === "string" ? value.trim() : ""
        if (normalized.length === 0) {
            continue
        }

        counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }

    const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0)

    return Array.from(counts.entries())
        .sort((first, second) => {
            if (second[1] !== first[1]) {
                return second[1] - first[1]
            }

            return first[0].localeCompare(second[0], "es-ES")
        })
        .map(([label, count], index) => ({
            label,
            count,
            percentage: total > 0 ? (count / total) * 100 : 0,
            color: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
        }))
}

export const toDistributionChartData = (
    items: readonly RespondentDistributionItem[],
): DistributionChartDatum[] => items.map((item) => ({
    label: item.label,
    shortLabel: truncateLabel(item.label),
    count: item.count,
    percentage: item.percentage,
    fill: item.color,
}))

export const computeResponseAverageRating = (
    response: SurveyResponse,
    ratingQuestionIds: readonly string[],
): number | null => {
    if (ratingQuestionIds.length === 0) {
        return null
    }

    let sum = 0
    let count = 0

    for (const questionId of ratingQuestionIds) {
        const value = response.answers[questionId]
        if (typeof value === "number") {
            sum += value
            count += 1
        }
    }

    if (count === 0) {
        return null
    }

    return sum / count
}

export const getQuestionOptions = (
    questionId: string,
    options: readonly SurveyOption[],
): SurveyOption[] => options.filter((option) => option.questionId === questionId)

export const formatAnswerValue = (
    question: SurveyQuestion,
    value: SurveyAnswerValue,
    options: readonly SurveyOption[],
): string => {
    if (question.type === "text") {
        if (typeof value === "string") {
            return value
        }
        return String(value)
    }

    if (question.type === "rating") {
        if (typeof value === "number") {
            return value.toString()
        }
        const numeric = Number(value)
        return Number.isNaN(numeric) ? String(value) : numeric.toString()
    }

    if (question.type === "single") {
        const option = options.find((candidate) => candidate.id === value)
        if (option) {
            return option.text
        }
        return typeof value === "string" ? value : String(value)
    }

    const valuesArray: string[] = Array.isArray(value)
        ? value
        : [typeof value === "string" ? value : String(value)]

    const labels = valuesArray.map((optionId) => {
        const option = options.find((candidate) => candidate.id === optionId)
        return option ? option.text : optionId
    })

    return labels.join(", ")
}

export const buildQuestionAnalytics = (
    question: SurveyQuestion,
    responses: readonly SurveyResponse[],
    options: readonly SurveyOption[],
): QuestionAnalytics => {
    const questionOptions = getQuestionOptions(question.id, options)
    let answeredCount = 0
    let ratingTotal = 0
    let ratingCount = 0
    const ratingMap = new Map<number, number>()
    const selectionMap = new Map<string, number>()
    const comments: string[] = []

    for (const response of responses) {
        const rawValue = response.answers[question.id]

        if (typeof rawValue === "undefined") {
            continue
        }

        if (question.type === "text") {
            const textValue = typeof rawValue === "string" ? rawValue.trim() : String(rawValue).trim()
            if (textValue.length > 0) {
                answeredCount += 1
                comments.push(textValue)
            }
            continue
        }

        if (question.type === "rating") {
            const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue)
            if (!Number.isNaN(numericValue)) {
                answeredCount += 1
                ratingTotal += numericValue
                ratingCount += 1
                ratingMap.set(numericValue, (ratingMap.get(numericValue) ?? 0) + 1)
            }
            continue
        }

        if (question.type === "single") {
            const optionId = typeof rawValue === "string" ? rawValue : String(rawValue)
            if (optionId.trim().length > 0) {
                answeredCount += 1
                selectionMap.set(optionId, (selectionMap.get(optionId) ?? 0) + 1)
            }
            continue
        }

        const selectedOptionIds = Array.isArray(rawValue)
            ? rawValue.map((item) => String(item)).filter((item) => item.trim().length > 0)
            : [String(rawValue)].filter((item) => item.trim().length > 0)

        if (selectedOptionIds.length > 0) {
            answeredCount += 1
            for (const optionId of selectedOptionIds) {
                selectionMap.set(optionId, (selectionMap.get(optionId) ?? 0) + 1)
            }
        }
    }

    const ratingDistribution: RatingDistributionItem[] = question.type === "rating"
        ? Array.from({ length: 10 }, (_, index) => {
            const value = index + 1
            const count = ratingMap.get(value) ?? 0
            return {
                value,
                count,
                percentage: answeredCount > 0 ? (count / answeredCount) * 100 : 0,
            }
        })
        : []

    const selectionDistribution: SelectionDistributionItem[] =
        question.type === "single" || question.type === "multiple"
            ? questionOptions.map((option) => {
                const count = selectionMap.get(option.id) ?? 0
                return {
                    optionId: option.id,
                    label: option.text,
                    count,
                    percentage: answeredCount > 0 ? (count / answeredCount) * 100 : 0,
                }
            })
            : []

    return {
        question,
        answeredCount,
        averageRating: ratingCount > 0 ? ratingTotal / ratingCount : null,
        ratingDistribution,
        selectionDistribution,
        comments,
    }
}