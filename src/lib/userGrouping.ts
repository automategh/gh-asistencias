import type { RecintoKey } from '@/lib/firebase/databaseResolver'

/**
 * Identificadores de las estrategias de agrupación de usuarios
 * disponibles en la aplicación.
 *
 * Para agregar nuevas formas de agrupar (por ejemplo, por "cargo" o
 * "jefe inmediato"), basta con extender este tipo y registrar la
 * configuración en `USER_GROUPING_DEFINITIONS`.
 */
export type UserGroupingId = 'none' | 'recinto' | 'department' | 'recintoDepartment' | 'position' | 'immediateBoss' | 'company'

/**
 * Estructura mínima que debe tener un usuario para poder ser
 * agrupado utilizando las estrategias definidas en este módulo.
 */
export interface UserForGrouping {
    readonly recinto: RecintoKey
    readonly department?: string | null
    readonly immediateBoss?: string | null
    readonly cargo?: string | null
    readonly companyName?: string | null
}

/**
 * Metadatos de un grupo concreto resultante de aplicar una estrategia
 * de agrupación a una lista de usuarios.
 */
export interface UserGroupMeta {
    /** Identificador de la estrategia que originó el grupo */
    readonly id: UserGroupingId
    /** Clave interna del grupo (se utiliza como key en React) */
    readonly key: string
    /** Texto principal que se mostrará como encabezado del grupo */
    readonly header: string
    /** Texto auxiliar opcional que describe el grupo */
    readonly helperText?: string | null
}

/**
 * Grupo de usuarios con sus metadatos de visualización.
 */
export interface UserGroup<TUser extends UserForGrouping> extends UserGroupMeta {
    readonly users: readonly TUser[]
}

export type UserGroups<TUser extends UserForGrouping> = readonly UserGroup<TUser>[]
export type GroupingFieldKey = 'recinto' | 'department' | 'position' | 'immediateBoss' | 'company'

/**
 * Definición de una forma de agrupar usuarios.
 *
 * Cada definición conoce cómo construir la clave de agrupación a partir
 * de un usuario y cómo representar esa clave de forma amigable para la UI.
 */
export interface UserGroupingDefinition {
    /** Identificador estable de la estrategia */
    readonly id: UserGroupingId
    /** Etiqueta que se muestra en el selector de "Agrupar por" */
    readonly label: string
    /** Descripción corta opcional para documentación interna o tooltips */
    readonly description?: string
    /**
     * Construye la clave de agrupación para un usuario concreto.
     * Devuelve `null` cuando el usuario no debe participar en ningún grupo.
     */
    buildKey(user: UserForGrouping): string | null
    /**
     * Construye el encabezado visible a partir de la clave de agrupación.
     */
    buildHeader(key: string): string
    /**
     * Construye un texto auxiliar opcional para el grupo a partir de la clave.
     */
    buildHelperText?(key: string): string | null
}

function normalizeDepartment(rawDepartment: string | null | undefined): string {
    const trimmed = (rawDepartment ?? '').trim()
    return trimmed.length > 0 ? trimmed : 'Sin área'
}

function normalizeGeneric(rawValue: string | null | undefined, emptyLabel: string): string {
    const trimmed = (rawValue ?? '').trim()
    return trimmed.length > 0 ? trimmed : emptyLabel
}

const USER_GROUPING_DEFINITIONS: readonly UserGroupingDefinition[] = [
    {
        id: 'none',
        label: 'Sin agrupación',
        description: 'Lista plana sin agrupar a los usuarios.',
        buildKey: () => null,
        buildHeader: () => 'Sin agrupación',
        buildHelperText: () => null,
    },
    {
        id: 'recinto',
        label: 'Recinto',
        description: 'Agrupa a los usuarios por el recinto (base de datos origen).',
        buildKey: (user) => user.recinto,
        buildHeader: (key) => `Recinto: ${key}`,
        buildHelperText: (key) => `Estos son los usuarios del recinto ${key.toLowerCase()}.`,
    },
    {
        id: 'department',
        label: 'Área',
        description: 'Agrupa a los usuarios por su área o departamento.',
        buildKey: (user) => normalizeDepartment(user.department),
        buildHeader: (key) => `Área: ${key}`,
        buildHelperText: (key) => `Estos son los de ${key.toLowerCase()}.`,
    },
    {
        id: 'recintoDepartment',
        label: 'Recinto y área',
        description: 'Agrupa combinando recinto y área en un mismo encabezado.',
        buildKey: (user) => {
            const departmentLabel = normalizeDepartment(user.department)
            return `${user.recinto}||${departmentLabel}`
        },
        buildHeader: (key) => {
            const [recintoKey, departmentLabel] = key.split('||')
            return `Recinto: ${recintoKey} · Área: ${departmentLabel}`
        },
        buildHelperText: (key) => {
            const [recintoKey, departmentLabel] = key.split('||')
            if (!recintoKey || !departmentLabel) return null
            return `Estos son los de ${departmentLabel.toLowerCase()} del recinto ${recintoKey.toLowerCase()}.`
        },
    },
    {
        id: 'position',
        label: 'Cargo',
        description: 'Agrupa a los usuarios por el cargo registrado en su perfil.',
        buildKey: (user) => normalizeGeneric(user.cargo, 'Sin cargo'),
        buildHeader: (key) => `Cargo: ${key}`,
        buildHelperText: (key) => `Estos son los de ${key.toLowerCase()}.`,
    },
    {
        id: 'immediateBoss',
        label: 'Jefe inmediato',
        description: 'Agrupa a los usuarios por su jefe inmediato.',
        buildKey: (user) => normalizeGeneric(user.immediateBoss, 'Sin jefe inmediato'),
        buildHeader: (key) => `Jefe inmediato: ${key}`,
        buildHelperText: (key) => `Colaboradores a cargo de ${key.toLowerCase()}.`,
    },
    {
        id: 'company',
        label: 'Empresa',
        description: 'Agrupa a los usuarios por la empresa en la que trabajan.',
        // Por defecto, quienes no tienen empresa se consideran "Grupo Heroica".
        buildKey: (user) => normalizeGeneric(user.companyName, 'Grupo Heroica'),
        buildHeader: (key) => `Empresa: ${key}`,
        buildHelperText: (key) => `Estos son los colaboradores de la empresa ${key.toLowerCase()}.`,
    },
]

/**
 * Devuelve la lista de estrategias de agrupación disponibles.
 *
 * Se expone como función para permitir futuras extensiones dinámicas
 * (por ejemplo, cargar configuraciones desde base de datos) sin cambiar
 * los consumidores actuales.
 */
export function getUserGroupingDefinitions(): readonly UserGroupingDefinition[] {
    return USER_GROUPING_DEFINITIONS
}

/**
 * Obtiene una definición concreta de agrupación por su identificador.
 */
export function getUserGroupingDefinition(id: UserGroupingId): UserGroupingDefinition | null {
    return USER_GROUPING_DEFINITIONS.find((definition) => definition.id === id) ?? null
}

/**
 * Construye los grupos de usuarios aplicando una estrategia de
 * agrupación concreta.
 *
 * - Cuando `groupingId` es `"none"`, devuelve un arreglo vacío.
 * - Cuando no se encuentra la estrategia solicitada, también devuelve
 *   un arreglo vacío para mantener un comportamiento seguro por defecto.
 */
export function buildUserGroups<TUser extends UserForGrouping>(
    users: readonly TUser[],
    groupingId: UserGroupingId,
): UserGroups<TUser> {
    if (groupingId === 'none') {
        return []
    }

    const definition = getUserGroupingDefinition(groupingId)
    if (!definition) {
        return []
    }

    const groupsMap = new Map<string, { meta: UserGroupMeta; users: TUser[] }>()

    users.forEach((user) => {
        const key = definition.buildKey(user)
        if (!key) {
            return
        }

        if (!groupsMap.has(key)) {
            const header = definition.buildHeader(key)
            const helperText = definition.buildHelperText?.(key) ?? null
            groupsMap.set(key, {
                meta: {
                    id: definition.id,
                    key,
                    header,
                    helperText,
                },
                users: [],
            })
        }

        const entry = groupsMap.get(key)
        if (entry) {
            entry.users.push(user)
        }
    })

    const groups: UserGroup<TUser>[] = []
    groupsMap.forEach((value) => {
        groups.push({
            ...value.meta,
            users: value.users,
        })
    })

    // Ordena los grupos alfabéticamente por su encabezado para una UX consistente
    return groups.sort((first, second) => first.header.localeCompare(second.header))
}

export function buildUserGroupsByField<TUser extends UserForGrouping>(
    users: readonly TUser[],
    fieldKey: GroupingFieldKey,
): UserGroups<TUser> {
    const definitionForField: Record<GroupingFieldKey, { labelPrefix: string; emptyLabel: string; helperBuilder: (value: string) => string | null }> = {
        recinto: {
            labelPrefix: 'Recinto',
            emptyLabel: 'Sin recinto',
            helperBuilder: (value) => `Estos son los usuarios del recinto ${value.toLowerCase()}.`,
        },
        department: {
            labelPrefix: 'Área',
            emptyLabel: 'Sin área',
            helperBuilder: (value) => `Estos son los de ${value.toLowerCase()}.`,
        },
        position: {
            labelPrefix: 'Cargo',
            emptyLabel: 'Sin cargo',
            helperBuilder: (value) => `Estos son los de ${value.toLowerCase()}.`,
        },
        immediateBoss: {
            labelPrefix: 'Jefe inmediato',
            emptyLabel: 'Sin jefe inmediato',
            helperBuilder: (value) => `Colaboradores a cargo de ${value.toLowerCase()}.`,
        },
        company: {
            labelPrefix: 'Empresa',
            emptyLabel: 'Grupo Heroica',
            helperBuilder: (value) => `Estos son los colaboradores de la empresa ${value.toLowerCase()}.`,
        },
    }

    const fieldDefinition = definitionForField[fieldKey]

    const groupsMap = new Map<string, { meta: UserGroupMeta; users: TUser[] }>()

    users.forEach((user) => {
        let rawValue: string | null | undefined
        if (fieldKey === 'recinto') {
            rawValue = user.recinto
        } else if (fieldKey === 'department') {
            rawValue = user.department
        } else if (fieldKey === 'position') {
            rawValue = user.cargo
        } else if (fieldKey === 'immediateBoss') {
            rawValue = user.immediateBoss
        } else {
            rawValue = user.companyName
        }

        const normalized = normalizeGeneric(rawValue, fieldDefinition.emptyLabel)
        const key = normalized

        if (!groupsMap.has(key)) {
            const header = `${fieldDefinition.labelPrefix}: ${normalized}`
            const helperText = fieldDefinition.helperBuilder(normalized)
            groupsMap.set(key, {
                meta: {
                    id: fieldKey,
                    key,
                    header,
                    helperText,
                },
                users: [],
            })
        }

        const entry = groupsMap.get(key)
        if (entry) {
            entry.users.push(user)
        }
    })

    const groups: UserGroup<TUser>[] = []
    groupsMap.forEach((value) => {
        groups.push({
            ...value.meta,
            users: value.users,
        })
    })

    return groups.sort((first, second) => first.header.localeCompare(second.header))
}
