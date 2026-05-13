import type { SurveyOption, SurveyQuestion } from "@/services/forms.service"
import type { Meeting } from "@/types/meeting"
import type { UserProfile } from "@/types/user"

export interface TrainingSurveySummary {
    trainingId: string
    meeting: Meeting | null
    totalResponses: number
    averageRating: number | null
}

export interface RatingDistributionItem {
    value: number
    count: number
    percentage: number
}

export interface SelectionDistributionItem {
    optionId: string
    label: string
    count: number
    percentage: number
}

export interface QuestionAnalytics {
    question: SurveyQuestion
    answeredCount: number
    averageRating: number | null
    ratingDistribution: RatingDistributionItem[]
    selectionDistribution: SelectionDistributionItem[]
    comments: string[]
}

export interface RespondentDistributionItem {
    label: string
    count: number
    percentage: number
    color: string
}

export interface DistributionChartDatum {
    label: string
    shortLabel: string
    count: number
    percentage: number
    fill: string
}

export type SurveyRespondentProfile = Pick<UserProfile, "name" | "department" | "cargo">
export type ResultsTab = "summary" | "responses"

export interface SurveyResponseCardQuestionItem {
    id: string
    index: number
    type: SurveyQuestion["type"]
    text: string
    answer: string
}

export interface ResponseFiltersState {
    search: string
    recinto: string
    department: string
    cargo: string
}

export interface ResponseFilterOptions {
    recintos: string[]
    departments: string[]
    cargos: string[]
}

export type SurveyQuestionTypeLabels = Record<SurveyQuestion["type"], string>
export type SurveyCategoryLabels = Record<string, string>
export type SurveyOptionsList = readonly SurveyOption[]