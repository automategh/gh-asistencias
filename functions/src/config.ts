/**
 * Configuración de Azure para autenticar contra Microsoft Graph API
 * usando flujo de credenciales de aplicación (app-only).
 */
export interface AzureConfig {
    tenantId: string
    clientId: string
    clientSecret: string
    /**
     * Correo del organizador por defecto para reuniones de calendario/Teams.
     * Se utiliza como respaldo cuando el organizador dinámico no pertenece al tenant
     * o no se proporciona explícitamente.
     */
    defaultOrganizerEmail?: string
    /**
     * Token secreto requerido para disparar migraciones one-shot de datos
     * (por ejemplo, `migrateImmediateBossToUid`). Se valida contra el header
     * `x-migration-token` que envía el operador. Mantenlo fuera del repo.
     */
    migrationToken?: string
}

/**
 * Obtiene la configuración de Azure desde las variables de entorno.
 * Lanza un error si alguna variable requerida no está presente.
 */
export const getAzureConfig = (): AzureConfig => {

    const tenantId = process.env.AZURE_TENANT_ID
    const clientId = process.env.AZURE_CLIENT_ID
    const clientSecret = process.env.AZURE_CLIENT_SECRET
    const defaultOrganizerEmail = process.env.AUTOMATION_EMAIL
    const migrationToken = process.env.MIGRATION_TOKEN

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error("Azure configuration is missing. Please set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET in environment variables.")
    }

    return {
        tenantId,
        clientId,
        clientSecret,
        defaultOrganizerEmail,
        migrationToken,
    }
}