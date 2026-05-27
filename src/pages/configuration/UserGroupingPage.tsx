import Layout from '@/components/layouts/layout'
import { useDatabase } from '@/context/DatabaseContext'
import { useEffect, useMemo, useState } from 'react'
import { getUserGroupingDefinitions, type GroupingFieldKey, type UserGroupingId } from '@/lib/userGrouping'
import { getUserGroupingConfig, saveUserGroupingConfig, type UserGroupingConfig, type UserGroupingConfigItem, type UserGroupingConfigItemKind } from '@/services/user-grouping.service'

interface EditableItem extends UserGroupingConfigItem {
  readonly isBuiltin: boolean
}

export default function UserGroupingPage() {
  const { database } = useDatabase()

  const [items, setItems] = useState<EditableItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [creatingCustom, setCreatingCustom] = useState<boolean>(false)
  const [newCustomField, setNewCustomField] = useState<GroupingFieldKey>('department')
  const [newCustomLabel, setNewCustomLabel] = useState<string>('')

  const definitions = useMemo(() => getUserGroupingDefinitions(), [])

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      if (!database) {
        setItems([])
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const remoteConfig = await getUserGroupingConfig(database)
        const byId = new Map<UserGroupingId, UserGroupingConfigItem>()
        remoteConfig?.items.forEach((item) => {
          byId.set(item.id, item)
        })

        const mergedBuiltins: EditableItem[] = definitions.map((definition) => {
          const existing = byId.get(definition.id as UserGroupingId)
          return {
            id: definition.id as UserGroupingId,
            enabled: existing?.enabled ?? definition.id !== 'none',
            label: existing?.label ?? definition.label,
            kind: (existing?.kind ?? 'builtin') as UserGroupingConfigItemKind,
            fieldKey: existing?.fieldKey ?? null,
            isBuiltin: true,
          }
        })

        const customItems: EditableItem[] = []
        byId.forEach((item, id) => {
          const isKnown = definitions.some((definition) => definition.id === id)
          if (!isKnown) {
            customItems.push({
              id,
              enabled: item.enabled,
              label: item.label ?? id,
              kind: item.kind ?? 'byField',
              fieldKey: item.fieldKey ?? 'department',
              isBuiltin: false,
            })
          }
        })

        if (!cancelled) {
          setItems([...mergedBuiltins, ...customItems])
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'No fue posible cargar la configuración de agrupaciones'
          setError(message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load().catch(() => {
      if (!cancelled) {
        setError('No fue posible cargar la configuración de agrupaciones')
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [database, definitions])

  function updateItem(id: UserGroupingId, patch: Partial<EditableItem>): void {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function handleSave(): Promise<void> {
    if (!database) {
      setError('La base de datos no está disponible')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const config: UserGroupingConfig = {
        items: items.map<UserGroupingConfigItem>((item) => ({
          id: item.id,
          enabled: item.enabled,
          label: item.label ?? null,
          kind: item.kind ?? (item.isBuiltin ? 'builtin' : 'byField'),
          fieldKey: item.fieldKey ?? null,
        })),
      }

      await saveUserGroupingConfig(database, config)
      setSuccess('Configuración guardada correctamente')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No fue posible guardar la configuración'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  function handleStartCreateCustom(): void {
    setCreatingCustom(true)
    setNewCustomField('department')
    setNewCustomLabel('')
  }

  function handleCancelCreateCustom(): void {
    setCreatingCustom(false)
    setNewCustomLabel('')
  }

  function handleConfirmCreateCustom(): void {
    const trimmedLabel = newCustomLabel.trim()
    if (!trimmedLabel) {
      return
    }

    const baseId = `custom-${newCustomField}` as UserGroupingId
    const uniqueId: UserGroupingId = items.some((item) => item.id === baseId)
      ? (`${baseId}-${Date.now()}` as UserGroupingId)
      : baseId

    const newItem: EditableItem = {
      id: uniqueId,
      enabled: true,
      label: trimmedLabel,
      kind: 'byField',
      fieldKey: newCustomField,
      isBuiltin: false,
    }

    setItems((prev) => [...prev, newItem])
    setCreatingCustom(false)
    setNewCustomLabel('')
  }

  return (
    <Layout
      header={{
        breadcrumbs: [{ label: 'Configuracion' }, { label: 'Agrupaciones' }],
        title: 'Formas de agrupar participantes',
        description: 'Configura qué agrupaciones estarán disponibles al crear una nueva actividad.',
      }}
    >
      <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
        <div className="max-w-4xl mx-auto p-6 mt-8 space-y-6">
          {loading && <div className="p-3 text-sm text-muted-foreground">Cargando…</div>}
          {error && <div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>}
          {success && <div className="p-3 text-sm text-green-700 border border-green-300 rounded">{success}</div>}

          <section className="bg-card rounded-2xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Agrupaciones disponibles</h2>
            {items.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">No hay estrategias de agrupación configuradas.</p>
            ) : (
              <ul className="space-y-4">
                {items.map((item) => {
                  const definition = definitions.find((def) => def.id === item.id)
                  return (
                    <li
                      key={item.id}
                      className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-border rounded-lg px-4 py-3"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <input
                            id={`enabled-${item.id}`}
                            type="checkbox"
                            checked={item.enabled}
                            onChange={(e) => updateItem(item.id, { enabled: e.target.checked })}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                          />
                          <label
                            htmlFor={`enabled-${item.id}`}
                            className="text-sm font-medium text-foreground truncate"
                          >
                            {definition?.label ?? item.label ?? item.id}
                          </label>
                        </div>
                        {definition?.description && (
                          <p className="text-xs text-muted-foreground">{definition.description}</p>
                        )}
                        {!item.isBuiltin && item.fieldKey && (
                          <p className="text-[11px] text-muted-foreground">
                            Basada en el campo&nbsp;
                            <span className="font-medium">
                              {item.fieldKey === 'department' && 'Área'}
                              {item.fieldKey === 'recinto' && 'Recinto'}
                              {item.fieldKey === 'position' && 'Cargo'}
                              {item.fieldKey === 'immediateBoss' && 'Jefe inmediato'}
                              {item.fieldKey === 'company' && 'Empresa'}
                            </span>
                          </p>
                        )}
                        <div className="mt-2">
                          <label className="block text-xs font-semibold text-muted-foreground mb-1">
                            Nombre visible en los formularios
                          </label>
                          <input
                            type="text"
                            value={item.label ?? ''}
                            onChange={(e) => updateItem(item.id, { label: e.target.value })}
                            placeholder={definition?.label}
                            className="w-full px-3 py-2 bg-input border border-border rounded text-sm"
                          />
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="mt-6 flex flex-col md:flex-row gap-3 justify-between items-center">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleStartCreateCustom}
                  className="px-4 py-2 border border-border rounded-lg text-xs font-medium text-foreground hover:bg-muted/40"
                  disabled={creatingCustom}
                >
                  Nueva agrupación personalizada
                </button>
                {creatingCustom && (
                  <div className="flex flex-wrap gap-2 items-center text-xs">
                    <span className="text-muted-foreground">Agrupar por</span>
                    <select
                      value={newCustomField}
                      onChange={(e) => setNewCustomField(e.target.value as GroupingFieldKey)}
                      className="px-2 py-1 bg-input border border-border rounded"
                    >
                      <option value="department">Área</option>
                      <option value="recinto">Recinto</option>
                      <option value="position">Cargo</option>
                      <option value="immediateBoss">Jefe inmediato</option>
                      <option value="company">Empresa</option>
                    </select>
                    <input
                      type="text"
                      value={newCustomLabel}
                      onChange={(e) => setNewCustomLabel(e.target.value)}
                      placeholder="Nombre de la agrupación"
                      className="px-2 py-1 bg-input border border-border rounded min-w-40"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmCreateCustom}
                      className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-semibold hover:bg-primary-light"
                    >
                      Agregar
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelCreateCustom}
                      className="px-3 py-1 border border-border rounded text-xs text-muted-foreground hover:bg-muted/40"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-end w-full md:w-auto">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || loading}
                  className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary-light disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  )
}
