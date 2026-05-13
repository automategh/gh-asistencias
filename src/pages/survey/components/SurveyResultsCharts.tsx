import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    LabelList,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from "recharts"

import type {
    DistributionChartDatum,
    RatingDistributionItem,
    RespondentDistributionItem,
    SelectionDistributionItem,
} from "../survey-results.types"
import { RATING_BAR_COLORS, toDistributionChartData, truncateLabel } from "../survey-results.utils"

const PIE_LABEL_RADIAN = Math.PI / 180

interface DistributionCardProps {
    title: string
    subtitle: string
    items: readonly RespondentDistributionItem[]
    emptyMessage: string
}

interface ChartTooltipPayload {
    payload?: DistributionChartDatum
}

interface ChartTooltipProps {
    active?: boolean
    payload?: ChartTooltipPayload[]
}

const renderDistributionPieLabel = ({
    cx,
    cy,
    midAngle,
    outerRadius,
    percent,
    fill,
}: {
    cx?: number
    cy?: number
    midAngle?: number
    outerRadius?: number
    percent?: number
    fill?: string
}) => {
    if (
        typeof cx !== "number"
        || typeof cy !== "number"
        || typeof midAngle !== "number"
        || typeof outerRadius !== "number"
        || typeof percent !== "number"
    ) {
        return null
    }

    if (percent < 0.04) {
        return null
    }

    const radius = outerRadius + 24
    const x = cx + radius * Math.cos(-midAngle * PIE_LABEL_RADIAN)
    const y = cy + radius * Math.sin(-midAngle * PIE_LABEL_RADIAN)

    return (
        <text
            x={x}
            y={y}
            fill={fill ?? "#3a5340"}
            textAnchor={x > cx ? "start" : "end"}
            dominantBaseline="central"
            fontSize={13}
            fontWeight={700}
        >
            {`${(percent * 100).toFixed(1)}%`}
        </text>
    )
}

const DistributionPieTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
        return null
    }

    const item = payload[0].payload

    return (
        <div className="rounded-2xl bg-white px-3 py-2 shadow-[0_10px_25px_rgba(39,60,42,0.12)]">
            <p className="text-sm font-semibold text-[#191c1c]">{item.label}</p>
            <p className="mt-1 text-xs text-[#5a665a]">
                {item.count} respuesta{item.count === 1 ? "" : "s"} · {item.percentage.toFixed(1)}%
            </p>
        </div>
    )
}

export const DistributionDonutCard = ({
    title,
    subtitle,
    items,
    emptyMessage,
}: DistributionCardProps) => {
    const chartData = toDistributionChartData(items)

    return (
        <div className="rounded-4xl bg-white px-4 py-4 shadow-[0_14px_28px_rgba(39,60,42,0.08)]">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">{title}</p>
                    <p className="mt-1 text-xs text-[#5a665a]">{subtitle}</p>
                </div>
                <span className="rounded-full border border-[#f3d6ad] bg-[#fff5e8] px-2.5 py-1 text-[10px] font-bold text-[#8d6327]">
                    {items.length} grupo{items.length === 1 ? "" : "s"}
                </span>
            </div>

            {items.length === 0 ? (
                <p className="mt-6 text-sm text-[#5a665a]">{emptyMessage}</p>
            ) : (
                <div className="mt-5 space-y-5">
                    <div className="rounded-3xl bg-[#fbfcfb] px-3 py-4">
                        <div className="mx-auto h-64 w-full max-w-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <RechartsTooltip content={<DistributionPieTooltip />} cursor={false} />
                                    <Pie
                                        data={chartData}
                                        dataKey="count"
                                        nameKey="label"
                                        cx="50%"
                                        cy="48%"
                                        outerRadius={86}
                                        paddingAngle={0}
                                        startAngle={90}
                                        endAngle={-270}
                                        labelLine={false}
                                        label={renderDistributionPieLabel}
                                        stroke="#ffffff"
                                        strokeWidth={2}
                                    >
                                        {chartData.map((item) => (
                                            <Cell key={item.label} fill={item.fill} />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
                        {chartData.map((item) => (
                            <div key={item.label} className="flex items-center gap-2 text-[#3a5340]">
                                <span className="h-3.5 w-3.5 rounded-[3px]" style={{ backgroundColor: item.fill }} />
                                <span className="font-medium">{item.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

interface RatingDistributionChartProps {
    items: readonly RatingDistributionItem[]
}

export const RatingDistributionChart = ({ items }: RatingDistributionChartProps) => {
    const chartData = items.map((item, index) => ({
        label: item.value.toString(),
        count: item.count,
        percentage: item.percentage,
        fill: RATING_BAR_COLORS[index % RATING_BAR_COLORS.length],
    }))

    return (
        <div className="rounded-3xl bg-white p-4 shadow-[0_10px_22px_rgba(39,60,42,0.05)]">
            <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="#eef1ee" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#5a665a", fontSize: 12 }} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#5a665a", fontSize: 12 }} />
                        <Bar dataKey="count" radius={[12, 12, 0, 0]}>
                            {chartData.map((item) => (
                                <Cell key={item.label} fill={item.fill} />
                            ))}
                            <LabelList dataKey="count" position="top" fill="#273c2a" fontSize={12} />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {chartData.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-[#e7ece7] bg-[#f8faf8] px-3 py-2 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">Valor {item.label}</p>
                        <p className="mt-1 text-base font-extrabold text-[#191c1c]">{item.count}</p>
                        <p className="text-[11px] text-[#5a665a]">{item.percentage.toFixed(0)}%</p>
                    </div>
                ))}
            </div>
        </div>
    )
}

interface SelectionDistributionChartProps {
    items: readonly SelectionDistributionItem[]
}

export const SelectionDistributionChart = ({ items }: SelectionDistributionChartProps) => {
    const chartData: DistributionChartDatum[] = items.map((item, index) => ({
        label: item.label,
        shortLabel: truncateLabel(item.label, 18),
        count: item.count,
        percentage: item.percentage,
        fill: toDistributionChartData([{ label: item.label, count: item.count, percentage: item.percentage, color: RATING_BAR_COLORS[index % RATING_BAR_COLORS.length] }])[0].fill,
    }))

    return (
        <div className="rounded-3xl border border-[#dbe5db] bg-white p-4 shadow-[0_10px_22px_rgba(39,60,42,0.05)]">
            <div className="h-65 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 20, left: 24, bottom: 8 }}>
                        <CartesianGrid horizontal={false} stroke="#eef1ee" />
                        <XAxis type="number" hide />
                        <YAxis
                            type="category"
                            dataKey="shortLabel"
                            width={116}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "#5a665a", fontSize: 12 }}
                        />
                        <Bar dataKey="count" radius={[0, 10, 10, 0]}>
                            {chartData.map((item) => (
                                <Cell key={item.label} fill={item.fill} />
                            ))}
                            <LabelList dataKey="count" position="right" fill="#434843" fontSize={12} />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
                {chartData.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl bg-[#f8faf8] px-3 py-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                            <span className="truncate font-medium text-[#191c1c]">{item.label}</span>
                        </div>
                        <span className="shrink-0 font-semibold text-[#3a5340]">{item.percentage.toFixed(0)}%</span>
                    </div>
                ))}
            </div>
        </div>
    )
}