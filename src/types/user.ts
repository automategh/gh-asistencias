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
