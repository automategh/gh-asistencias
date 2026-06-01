/**
 * Valida la política de contraseña usada en registro.
 *
 * Reglas:
 * - Mínimo 6 caracteres.
 * - Al menos una letra mayúscula.
 * - Al menos un carácter especial.
 */
export function validatePasswordPolicy(password: string): string | null {
    if (!password) {
        return 'La contraseña es obligatoria.'
    }

    if (password.length < 6) {
        return 'La contraseña debe tener al menos 6 caracteres.'
    }

    if (!/[A-Z]/.test(password)) {
        return 'La contraseña debe incluir al menos una letra mayúscula.'
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
        return 'La contraseña debe incluir al menos un carácter especial.'
    }

    return null
}
