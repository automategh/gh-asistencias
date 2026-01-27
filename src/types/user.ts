/**
 * Perfil de usuario almacenado en Realtime Database.
 *
 * Campos esperados según el esquema actual:
 * - `uid`: identificador único del usuario en Firebase Auth.
 * - `email`: correo electrónico del usuario.
 * - `name`: nombre completo del usuario.
 * - `role`: rol del usuario (p. ej. "User").
 * - `active`: indica si la cuenta está activa.
 * - `createdAt`: fecha ISO cuando se creó el registro.
 * - `lastLogin`: fecha ISO del último inicio de sesión.
 */
export interface UserProfile {
  readonly uid: string
  readonly email: string
  readonly name: string
  readonly role: string
  readonly active: boolean
  readonly createdAt: string
  readonly lastLogin: string
  readonly department?: string | null
  readonly identify?: string | null
  readonly immediateBoss?: string | null
}

import type { RecintoKey } from "@/lib/firebase/databaseResolver"

/**
 * Usuario agregado con metadatos de base de datos para administración multi-recinto.
 */
export interface CrossDbUserItem {
  readonly uid: string
  readonly name: string
  readonly email: string
  readonly role?: string | null
  readonly active?: boolean | null
  readonly department?: string | null
  readonly recinto: RecintoKey
  readonly databaseUrl: string
}

export interface RegisterFormData {
  name: string
  email: string
  identify: string
  department: string
  password: string
  confirmPassword: string
  recint: string
  leader: string
}
