import Layout from "@/components/layouts/layout"
import { useDatabase } from "@/context/DatabaseContext"
import { useEffect, useState } from "react"
import type { Departament } from "@/types/departament"
import { createDepartament, deleteDepartament, getDepartaments, updateDepartament } from "@/services/departaments/departments.service"

interface EditableState {
  id: string | null
  name: string
}

/**
 * Página de administración de departamentos para la base de datos actual.
 * Permite crear, editar y eliminar departamentos.
 */
export default function DepartmentsPage() {
  const { database } = useDatabase()

  const [departaments, setDepartaments] = useState<Departament[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState<string>("")
  const [savingNew, setSavingNew] = useState<boolean>(false)

  const [editing, setEditing] = useState<EditableState>({ id: null, name: "" })
  const [savingEdit, setSavingEdit] = useState<boolean>(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        setLoading(true)
        setError(null)
        if (!database) {
          setDepartaments([])
          return
        }
        const list = await getDepartaments(database)
        if (!cancelled) {
          const ordered = [...list].sort((a, b) => a.name.localeCompare(b.name))
          setDepartaments(ordered)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "No fue posible cargar las áreas"
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
        setError("No fue posible cargar los areas")
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [database])

  async function handleCreate(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!database) {
      setError("La base de datos no está disponible")
      return
    }
    const trimmed = newName.trim()
    if (!trimmed) return

    setSavingNew(true)
    setError(null)
    try {
      const created = await createDepartament(database, trimmed)
      setDepartaments(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName("")
    } catch (err) {
      const message = err instanceof Error ? err.message : "No fue posible crear el área"
      setError(message)
    } finally {
      setSavingNew(false)
    }
  }

  function startEdit(dep: Departament): void {
    setEditing({ id: dep.id, name: dep.name })
  }

  function cancelEdit(): void {
    setEditing({ id: null, name: "" })
  }

  async function handleSaveEdit(): Promise<void> {
    if (!database || !editing.id) return
    const trimmed = editing.name.trim()
    if (!trimmed) return

    setSavingEdit(true)
    setError(null)
    try {
      await updateDepartament(database, editing.id, trimmed)
      setDepartaments(prev => prev.map(d => (d.id === editing.id ? { ...d, name: trimmed } : d)).sort((a, b) => a.name.localeCompare(b.name)))
      cancelEdit()
    } catch (err) {
      const message = err instanceof Error ? err.message : "No fue posible actualizar el área"
      setError(message)
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!database) {
      setError("La base de datos no está disponible")
      return
    }
    setDeletingId(id)
    setError(null)
    try {
      await deleteDepartament(database, id)
      setDepartaments(prev => prev.filter(d => d.id !== id))
      if (editing.id === id) {
        cancelEdit()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "No fue posible eliminar el área"
      setError(message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Layout
      header={{
        breadcrumbs: [{ label: 'Configuracion' }, { label: 'Areas' }],
        title: 'Áreas',
        description: 'Administra las áreas del recinto actual.',
      }}
    >
      <div className="min-h-screen bg-linear-to-br from-background via-muted/5 to-background">
        <div className="max-w-4xl mx-auto p-6 mt-8 space-y-8">
          {loading && <div className="p-3 text-sm text-muted-foreground">Cargando…</div>}
          {error && <div className="p-3 text-sm text-red-600 border border-red-300 rounded">{error}</div>}

          <section className="bg-card rounded-2xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Nueva área</h2>
            <form onSubmit={handleCreate} className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del área"
                className="flex-1 px-4 py-2 bg-input border border-border rounded-lg text-sm"
              />
              <button
                type="submit"
                disabled={savingNew}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary-light disabled:opacity-50"
              >
                {savingNew ? "Guardando…" : "Agregar"}
              </button>
            </form>
          </section>

          <section className="bg-card rounded-2xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Listado</h2>
            {departaments.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">Aún no hay áreas.</p>
            ) : (
              <ul className="space-y-3">
                {departaments.map((dep) => {
                  const isEditing = editing.id === dep.id
                  return (
                    <li key={dep.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-border rounded-lg px-4 py-3">
                      <div className="flex-1">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editing.name}
                            onChange={(e) => setEditing({ id: dep.id, name: e.target.value })}
                            className="w-full px-3 py-2 bg-input border border-border rounded text-sm"
                          />
                        ) : (
                          <p className="text-sm font-medium text-foreground">{dep.name}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">Creado: {new Date(dep.createdAt).toLocaleString("es-ES")}</p>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              disabled={savingEdit}
                              className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary-light disabled:opacity-50"
                            >
                              {savingEdit ? "Guardando…" : "Guardar"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="px-3 py-1.5 rounded text-xs border border-border text-muted-foreground hover:bg-muted/40"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(dep)}
                            className="px-3 py-1.5 rounded text-xs border border-border text-muted-foreground hover:bg-muted/40"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(dep.id)}
                          disabled={deletingId === dep.id}
                          className="px-3 py-1.5 rounded text-xs border border-red-600 text-red-600 hover:bg-red-600/10 disabled:opacity-50"
                        >
                          {deletingId === dep.id ? "Eliminando…" : "Eliminar"}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Layout>
  )
}
