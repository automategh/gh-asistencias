import { ALL_FILTER_VALUE } from "../survey-results.utils"

interface SurveyResponseFiltersProps {
    search: string
    selectedRecinto: string
    selectedDepartment: string
    selectedCargo: string
    recintoOptions: string[]
    departmentOptions: string[]
    cargoOptions: string[]
    onSearchChange: (value: string) => void
    onRecintoChange: (value: string) => void
    onDepartmentChange: (value: string) => void
    onCargoChange: (value: string) => void
    onClear: () => void
}

export const SurveyResponseFilters = ({
    search,
    selectedRecinto,
    selectedDepartment,
    selectedCargo,
    recintoOptions,
    departmentOptions,
    cargoOptions,
    onSearchChange,
    onRecintoChange,
    onDepartmentChange,
    onCargoChange,
    onClear,
}: SurveyResponseFiltersProps) => {
    return (
        <div className="rounded-[28px] border border-[#dbe5db] bg-[#f8faf8] p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
                <label className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">Buscar respondiente</span>
                    <input
                        type="text"
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="Nombre, correo, área, cargo o recinto"
                        className="h-11 w-full rounded-2xl border border-[#dbe5db] bg-white px-4 text-sm text-[#191c1c] outline-none transition focus:border-[#3a5340] focus:ring-2 focus:ring-[#dbe5db]"
                    />
                </label>

                <label className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">Recinto</span>
                    <select
                        value={selectedRecinto}
                        onChange={(event) => onRecintoChange(event.target.value)}
                        className="h-11 w-full rounded-2xl border border-[#dbe5db] bg-white px-4 text-sm text-[#191c1c] outline-none transition focus:border-[#3a5340] focus:ring-2 focus:ring-[#dbe5db]"
                    >
                        <option value={ALL_FILTER_VALUE}>Todos</option>
                        {recintoOptions.map((recinto) => (
                            <option key={recinto} value={recinto}>{recinto}</option>
                        ))}
                    </select>
                </label>

                <label className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">Área</span>
                    <select
                        value={selectedDepartment}
                        onChange={(event) => onDepartmentChange(event.target.value)}
                        className="h-11 w-full rounded-2xl border border-[#dbe5db] bg-white px-4 text-sm text-[#191c1c] outline-none transition focus:border-[#3a5340] focus:ring-2 focus:ring-[#dbe5db]"
                    >
                        <option value={ALL_FILTER_VALUE}>Todas</option>
                        {departmentOptions.map((department) => (
                            <option key={department} value={department}>{department}</option>
                        ))}
                    </select>
                </label>

                <label className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#3a5340]">Cargo</span>
                    <select
                        value={selectedCargo}
                        onChange={(event) => onCargoChange(event.target.value)}
                        className="h-11 w-full rounded-2xl border border-[#dbe5db] bg-white px-4 text-sm text-[#191c1c] outline-none transition focus:border-[#3a5340] focus:ring-2 focus:ring-[#dbe5db]"
                    >
                        <option value={ALL_FILTER_VALUE}>Todos</option>
                        {cargoOptions.map((cargo) => (
                            <option key={cargo} value={cargo}>{cargo}</option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[#5a665a]">
                    Usa los filtros para encontrar perfiles concretos o segmentar por contexto organizacional.
                </p>
                <button
                    type="button"
                    onClick={onClear}
                    className="rounded-full border border-[#dbe5db] bg-white px-3 py-1.5 text-xs font-semibold text-[#3a5340] transition hover:border-[#3a5340] hover:bg-[#f3f7f3]"
                >
                    Limpiar filtros
                </button>
            </div>
        </div>
    )
}